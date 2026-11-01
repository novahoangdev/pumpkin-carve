import React from "react";
import { Atlas } from "react-native-skia";
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import type { Basis } from "../scene/view";
import { MOUTH } from "../scene/layout";
import type { Burst } from "./Particles";
import { BASE_BASIS, NONE, SAMPLING, proj, pumpkinWorld, put, useSpriteBuffers } from "./pfx_atlas";
import { useGpuImage } from "../perf/gpu";

/**
 * Wisp of smoke after the candle is blown out.
 *
 * Hot smoke from the wick climbs inside the shell and escapes through the highest carved holes (the eyes, usually):
 * one thin strand per hole (up to 2), leaving the hole along the surface normal, then rising and starting to
 * twist. Lives in scene space (m) and is projected through the view camera every frame, so it keeps true parallax
 * when the camera tilts / looks around.
 *
 * Strand model: sample j was emitted at te (after the flame died) and has age a. Its height grows with a
 * (buoyancy), its sideways offset is a function of (height, global time) only — neighbours in te are neighbours
 * in space, so the samples form one continuous ribbon: straight (laminar) just above the hole, then a widening,
 * travelling helix, then soft puffs that thin out. Emission fades as the ember cools, so the ribbon detaches
 * from the hole and drifts away.
 */
const SHEET = require("../../assets/fx/pfx_match.png"); // soft smoke puff 32×32 at (96, 0)
const SPR = [96, 0, 32, 32] as const;
const PER = 72; // samples per strand
const STRANDS = 2;
const MAX = PER * STRANDS;
const DELAY = 0.08; // s after the flame dies before smoke reaches the hole
const EMIT = 2.4; // s of emission (the ember cools)
const LIFE = 3.4; // s a sample lives

const sstep = (a: number, b: number, x: number) => {
  "worklet";
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Exit = { x: number; y: number; z: number; nx: number; ny: number; w: number; ph: number };

export function Smoke({
  outAt,
  time,
  basis,
  holes,
  porch,
  storm,
}: {
  /** app time the candle went out (-1: burning). */
  outAt: SharedValue<number>;
  time: SharedValue<number>;
  basis?: SharedValue<Basis>;
  /** carved holes (pumpkin image pt, same list Particles uses). */
  holes: SharedValue<Burst[]>;
  porch: SharedValue<number>;
  storm: SharedValue<number>;
}) {
  const sheet = useGpuImage(SHEET, { mipmapped: true });
  const exits = useSharedValue<Exit[]>([]);

  // pick the exits once, when the flame dies: the 2 highest holes (smoke rises), top part of each hole
  useAnimatedReaction(
    () => outAt.value,
    (o, prev) => {
      if (o < 0 || o === prev) return;
      const hs = holes.value.slice().sort((a, b) => a.y - a.ry - (b.y - b.ry));
      const pick: Exit[] = [];
      for (let i = 0; i < hs.length && pick.length < STRANDS; i++) {
        const h = hs[i];
        if (pick.length && Math.abs(hs[0].y - hs[0].ry - (h.y - h.ry)) > 40) break; // second strand only from a hole as high
        const w = pumpkinWorld(h.x, h.y - h.ry * 0.35);
        pick.push({ x: w[0], y: w[1], z: w[2], nx: w[3], ny: w[4], w: pick.length ? 0.8 : 1, ph: h.x * 0.37 + o });
      }
      if (!pick.length) {
        const w = pumpkinWorld(MOUTH.x, MOUTH.y);
        pick.push({ x: w[0], y: w[1], z: w[2], nx: w[3], ny: w[4], w: 1, ph: o });
      }
      exits.set(pick);
    },
  );

  const data = useDerivedValue(() => {
    const o = outAt.value;
    if (o < 0) return NONE;
    const u = time.value - o - DELAY;
    if (u <= 0 || u > EMIT + LIFE) return NONE;
    const b = basis ? basis.value : BASE_BASIS;
    const ex = exits.value;
    const P = [0, 0, 0, 0];
    const out: number[] = [];
    // lit by the moon (cool), the porch light once it is back (warm), lightning
    const pl = porch.value, st = storm.value;
    const lum = 0.9 + 0.35 * pl + 1.4 * st;
    const cr = (0.62 + 0.25 * pl) * lum, cg = (0.66 + 0.16 * pl) * lum, cb = (0.78 + 0.02 * pl) * lum;
    const ember = Math.exp(-u / 1.4);
    for (let s = 0; s < ex.length; s++) {
      const E = ex[s];
      // horizontal outward direction of the hole (smoke leaves the face, then rises)
      const hl = Math.hypot(E.nx, E.ny) || 1;
      const ox = E.nx / hl, oy = E.ny / hl;
      for (let j = 0; j < PER; j++) {
        const te = (j / PER) * EMIT;
        const a = u - te;
        if (a <= 0 || a > LIFE) continue;
        const amt = Math.pow(1 - te / EMIT, 1.4) * E.w;
        const h = 0.032 * a + 0.04 * a * a; // rise (m)
        const fwd = 0.022 * (1 - Math.exp(-a * 2.6)); // out of the hole
        // twist: grows with height, travels up the strand
        const A = 0.0015 + 0.03 * sstep(0.02, 0.22, h);
        const w1 = h * 36 - u * 2.6 + E.ph;
        const w2 = h * 81 - u * 4.9 + E.ph * 1.7;
        const side = A * (Math.sin(w1) + 0.4 * Math.sin(w2)) + 0.05 * a * a * (s ? -1 : 1) * 0.3;
        const deep = A * 0.8 * Math.cos(w1 * 0.9 + 0.6);
        // side ⟂ outward, horizontal
        const x = E.x + ox * (fwd + deep) - oy * side;
        const y = E.y + oy * (fwd + deep) + ox * side;
        const z = E.z + h;
        proj(b, x, y, z, P);
        if (P[2] < 0.05) continue;
        const dm = 0.0075 + 0.034 * sstep(0, 2.4, a); // sprite diameter (m): thin laminar thread → wide soft puffs
        const d = dm * P[3];
        // thin thread: dense, nearly opaque once samples overlap; wide puffs: thin (same smoke spread over more area)
        const al = amt * Math.min(0.75, 0.0058 / dm) * Math.pow(1 - a / LIFE, 1.3) * Math.min(1, a / 0.08);
        if (al < 0.004) continue;
        // ember glow on the base of the strand
        const eg = ember * Math.exp(-h / 0.025) * 0.9;
        put(out, P[0], P[1], 16, 16, d / 32, a * 0.9 + j * 0.37, SPR[0], SPR[1], SPR[2], SPR[3], cr + eg, cg + eg * 0.35, cb + eg * 0.08, al);
      }
    }
    return out.length ? out : NONE;
  });
  const buf = useSpriteBuffers(data, MAX);

  return <Atlas image={sheet} sprites={buf.sprites} transforms={buf.transforms} colors={buf.colors} colorBlendMode="modulate" sampling={SAMPLING} />;
}
