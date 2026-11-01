import React from "react";
import { Atlas, BlurMask, Group, Path, Skia, type SkPath } from "react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import type { Impact } from "./jump";
import { PUMPKIN_FOOT_W, type Basis } from "../scene/view";
import { BASE_BASIS, NONE, SAMPLING, behindPumpkin, clamp01, fall, proj, put, smoothstep, useSpriteBuffers, wrap } from "./pfx_atlas";
import { useGpuImage } from "../perf/gpu";

const LIFE = 3.4; // s, everything is fully gone after this (leaves fall slowly + rest a bit)
const RING_LIFE = 0.42;
const TAU = Math.PI * 2;
const SLOTS = 3; // number of most recent landings drawn at once
const PER_IMPACT = 96;
const MAX_SPRITES = SLOTS * PER_IMPACT;
const M = 1 / 646; // m per original-image pt at the pumpkin depth (keeps the pace / size of the old version)
const G = 7.6;

const SHEET = require("../../assets/fx/pfx_dust.png");
// pfx_dust.png:
//   rows 0–7 (64 cells): 8 autumn leaves (4 maple, 4 oak; real photos, curled + lit in Blender) × 12 flip angles around the main
//     vein (30°/cell; 90°/270° are edge-on, 120..240° show the paler back side)
//   row 512: 4 dust puffs 128×64 (fbm, ragged edges, warm-lit upper-left, cool dark bottom) | dust grain 16 | shadow 64×32
const C = 64;
const ROW_PUFF = 8 * C;
const SPR_MOTE = [512, ROW_PUFF, 16, 16];
const SPR_SHADOW = [576, ROW_PUFF, 64, 32];
const FILL_LEAF = 0.92;
const FILL_PUFF = 0.85;

const E = Skia.PathBuilder.Make().build();
const RING_NONE = { path: E, w: 0, a: 0 };

const hash = (n: number) => {
  "worklet";
  const s = Math.sin(n * 63.71 + 19.19) * 43758.5453;
  return s - Math.floor(s);
};

/** Leaf (m, before floor contact): tossed up, strong air drag, falls slowly, swings like a pendulum. → [across, height, sway, calm] */
const leafPath = (a: number, vh0: number, vz0: number, sway: number, w: number, ph: number) => {
  "worklet";
  const kd = 2.8;
  const vt = 34 * M;
  const e = (1 - Math.exp(-kd * a)) / kd;
  const calm = 1 - Math.exp(-1.5 * a);
  const sw = Math.sin(w * a + ph);
  return [vh0 * e, vz0 * e - vt * (a - e) + Math.abs(Math.cos(w * a + ph)) * 2.5 * M * calm, sw * sway * calm, calm];
};

/**
 * Dust + dry leaves kicked up each time the pumpkin lands — in SCENE SPACE (m), projected through the view camera, so when looking around /
 * tilting the phone the dust and leaves sit correctly on the porch around the pumpkin base, puffs behind are hidden by the pumpkin, sized by depth.
 *
 * - Soft dust puffs (fbm sprites) burst from the edge of the base area, spreading along the porch (forward + sideways), slowing from drag,
 *   swelling + rising slightly then dissipating.
 * - Heavy grit: shot out low, falls under gravity, bounces on the porch. Fine dust floats and sparkles catching the light.
 * - Real autumn leaves (8 kinds × 12 flip angles): tossed up, high air drag, fall slowly, swing + flip; on landing they lie flat on the porch
 *   — flip angle and vein direction computed from the real floor perspective; with a soft shadow on the floor.
 * - Hard landing: a thin shock ring spreads over the floor boards (circle on the porch plane projected to screen → perspective-correct ellipse).
 * Size / count / opacity scale with strength. Without `basis`, the original camera is used.
 */
export function ImpactDust({
  impacts,
  time,
  basis,
}: {
  impacts: SharedValue<Impact[]>;
  time: SharedValue<number>;
  spread?: number;
  basis?: SharedValue<Basis>;
}) {
  const sheet = useGpuImage(SHEET, { mipmapped: true });

  const data = useDerivedValue<number[]>(() => {
    const list = impacts.get();
    const now = time.get();
    if (list.length === 0 || now - list[list.length - 1].t > LIFE) return NONE;
    const b = basis ? basis.get() : BASE_BASIS;
    const P = [0, 0, 0, 0];
    const Q = [0, 0, 0, 0];
    const st = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    // pumpkin base on screen now → convert the landing's horizontal offset (screen pt) to meters
    proj(b, PUMPKIN_FOOT_W[0], PUMPKIN_FOOT_W[1], 0, Q);
    const footX = Q[0], kFoot = Q[3];
    const out: number[] = [];
    for (let n = Math.max(0, list.length - SLOTS); n < list.length; n++) {
      const I = list[n];
      const age = now - I.t;
      if (age < 0 || age > LIFE) continue;
      const S = Math.min(1.3, Math.max(0.05, I.strength));
      const seed = I.t * 13.7 + I.x * 0.31;
      const fx = PUMPKIN_FOOT_W[0] + (I.x - footX) / kFoot, fy = 0;
      const RC = 0.12; // radius of the pumpkin base contact area (m)
      const shadows: number[] = [];
      const puffs: number[] = [];
      const grit: number[] = [];
      const leaves: number[] = [];
      const motes: number[] = [];

      // ── dust puffs: spread along the porch, slow down, swell then dissipate ──
      const nPuff = Math.round(8 + 12 * S);
      for (let i = 0; i < nPuff; i++) {
        const k = seed + i * 1.7;
        const r1 = hash(k), r2 = hash(k + 0.31), r3 = hash(k + 0.77), r4 = hash(k + 1.19);
        // spread direction: forward + sideways (behind is hidden by the pumpkin)
        const th = -Math.PI / 2 + (i % 2 === 0 ? -1 : 1) * (0.25 + 1.35 * r1);
        const dx = Math.cos(th), dy = Math.sin(th);
        const sp = (70 + 200 * r2) * (0.45 + 0.8 * S) * M;
        const d = RC * (0.7 + 0.3 * r4) + (sp * (1 - Math.exp(-3.2 * age))) / 3.2;
        const rise = ((5 + 14 * r3) * S * (1 - Math.exp(-1.6 * age)) + 4 * age) * M;
        const R = (15 + 16 * r1) * (0.55 + 0.6 * S) * (0.45 + 1.2 * (1 - Math.exp(-2.4 * age))) * M;
        const tau = (0.45 + 0.55 * r4) * (0.6 + 0.5 * S);
        const a = 0.34 * (0.35 + 0.65 * Math.min(1, S)) * (1 - Math.exp(-age / 0.04)) * Math.exp(-age / tau);
        if (a < 0.008) continue;
        const x = fx + dx * d, y = fy + dy * d * 0.8, z = R * 0.35 + rise;
        if (behindPumpkin(b.e, x, y, z)) continue;
        proj(b, x, y, z, P);
        if (P[2] < 0.05) continue;
        const v = Math.floor(r3 * 4);
        const rot = (r2 - 0.5) * 0.35 + (dx < 0 ? -1 : 1) * age * 0.12;
        put(puffs, P[0], P[1], 64, 32, (2 * R * P[3]) / (128 * FILL_PUFF), rot, v * 128, ROW_PUFF, 128, 64, 0.86, 0.8, 0.74, a);
      }

      // ── heavy grit: shot out low, falls, bounces on the porch ──
      const nGrit = Math.round(5 + 12 * S);
      for (let i = 0; i < nGrit; i++) {
        const k = seed + 40 + i * 2.3;
        const r1 = hash(k), r2 = hash(k + 0.41), r3 = hash(k + 0.93);
        const th = -Math.PI / 2 + (r1 - 0.5) * 3.4;
        const dx = Math.cos(th), dy = Math.sin(th);
        const sp = (60 + 220 * r2) * (0.5 + 0.8 * S) * M * 1.6;
        const vz = (30 + 150 * r3) * (0.3 + S) * M * 2.2;
        fall(age, fx + dx * RC, fy + dy * RC * 0.8, 0.003, dx * sp, dy * sp, vz, G, 0.001, 0.3, 0.4, 1.2, st);
        const life = 1 - smoothstep(0.5, 1.0, age);
        if (life <= 0) continue;
        if (behindPumpkin(b.e, st[0], st[1], st[2])) continue;
        proj(b, st[0], st[1], st[2], P);
        const sz = (0.8 + 1.2 * r1) * (0.7 + 0.5 * S) * M * P[3];
        put(grit, P[0], P[1], 8, 8, (sz / 16) * 1.6, 0, SPR_MOTE[0], SPR_MOTE[1], SPR_MOTE[2], SPR_MOTE[3], 0.42, 0.33, 0.26, 0.85 * life);
      }

      // ── autumn leaves: tossed up, swing + 3D flip, fall slowly, lie flat on the porch then fade ──
      const nLeaf = S < 0.22 ? 0 : Math.round(1 + 5 * S);
      for (let i = 0; i < nLeaf; i++) {
        const k = seed + 90 + i * 4.1;
        const r1 = hash(k), r2 = hash(k + 0.53), r3 = hash(k + 1.07), r4 = hash(k + 1.61), r5 = hash(k + 2.13), r6 = hash(k + 2.71);
        const side = i % 2 === 0 ? 1 : -1;
        const th = -Math.PI / 2 + side * (0.3 + 1.1 * r1);
        const dx = Math.cos(th), dy = Math.sin(th);
        const vh0 = (25 + 95 * r2) * (0.5 + 0.7 * S) * M;
        const vz0 = (110 + 170 * r3) * (0.45 + 0.7 * S) * M;
        const sway = (7 + 7 * r6) * M;
        const w = 3.2 + 2.4 * r4;
        const ph = r5 * 6;
        const x0 = fx + dx * RC * (0.6 + 0.6 * r6), y0 = fy + dy * RC * 0.6;
        let p = leafPath(age, vh0, vz0, sway, w, ph);
        let landT = -1;
        if (p[1] < 0 && age > 0.15) {
          let lo = 0.15, hi = age;
          for (let it = 0; it < 12; it++) {
            const mid = (lo + hi) / 2;
            if (leafPath(mid, vh0, vz0, sway, w, ph)[1] < 0) hi = mid;
            else lo = mid;
          }
          landT = age - hi;
          p = leafPath(hi, vh0, vz0, sway, w, ph);
          p[1] = 0;
        }
        // across: along the spread direction + perpendicular sway
        const x = x0 + dx * p[0] - dy * p[2], y = y0 + dy * p[0] + dx * p[2], z = Math.max(0, p[1]) + 0.0015;
        if (behindPumpkin(b.e, x, y, z)) continue;
        proj(b, x, y, z, P);
        if (P[2] < 0.05) continue;
        const ta = landT < 0 ? age : age - landT;
        const e2 = (1 - Math.exp(-1.4 * ta)) / 1.4;
        let flip = r1 * TAU + (6 + 8 * r2) * side * e2 + p[3] * 0.9 * (p[2] / sway);
        let rot = r3 * TAU + side * (2.5 + 3 * r4) * e2 + 0.35 * (p[2] / sway) * p[3];
        let alpha = 1;
        if (landT >= 0) {
          // lying flat: leaf normal points up → flip angle = angle between the vertical axis and the view ray; vein lies horizontal along the flight direction
          const e = 1 - Math.exp(-landT * 12);
          const vx = b.e[0] - x, vy = b.e[1] - y, vz = b.e[2] - z;
          const cf = vz / (Math.hypot(vx, vy, vz) || 1);
          const f0 = wrap(flip, TAU);
          const back = f0 > Math.PI / 2 && f0 < (3 * Math.PI) / 2;
          const lay = Math.acos(Math.min(1, Math.abs(cf)));
          const ft = back ? Math.PI - lay : f0 > Math.PI ? TAU - lay : lay;
          flip = f0 + (ft - f0) * e;
          const va = r6 * Math.PI;
          proj(b, x + Math.cos(va) * 0.01, y + Math.sin(va) * 0.01, z, Q);
          const h = Math.atan2(Q[1] - P[1], Q[0] - P[0]) - Math.PI / 2;
          const dr = Math.atan2(Math.sin(h - rot), Math.cos(h - rot));
          const dr2 = Math.abs(dr) > Math.PI / 2 ? dr - Math.sign(dr) * Math.PI : dr; // a leaf vein has no direction
          rot = rot + dr2 * e;
          alpha = 1 - smoothstep(0.5, 1.2, landT);
        }
        alpha *= 1 - smoothstep(LIFE - 0.4, LIFE, age);
        if (alpha <= 0.01) continue;
        const L = (14 + 8 * r2) * (0.85 + 0.25 * S) * M * P[3];
        const type = Math.floor(r5 * 8);
        const fi = wrap(Math.round(flip / (TAU / 12)), 12);
        const pop = Math.min(1, age / 0.06);
        put(leaves, P[0], P[1], 32, 32, (L * pop) / (C * FILL_LEAF), rot, fi * C, type * C, C, C, 0.86, 0.8, 0.76, alpha);
        const hgt = z;
        if (hgt < 0.09) {
          const k2 = 1 - hgt / 0.09;
          proj(b, x, y, 0, Q);
          put(shadows, Q[0], Q[1] + 1, 32, 16, (L * 1.1) / 64, 0, SPR_SHADOW[0], SPR_SHADOW[1], SPR_SHADOW[2], SPR_SHADOW[3], 0, 0, 0, 0.3 * k2 * k2 * alpha);
        }
      }

      // ── fine floating dust: shot out, stalls from air drag, drifts slowly and sparkles when catching the light ──
      const nMote = Math.round(8 + 22 * S);
      for (let i = 0; i < nMote; i++) {
        const k = seed + 160 + i * 1.9;
        const r1 = hash(k), r2 = hash(k + 0.37), r3 = hash(k + 0.83), r4 = hash(k + 1.31);
        const L = 1.4 + 1.6 * r4;
        if (age > L) continue;
        const th = -Math.PI / 2 + (r1 - 0.5) * 3.6;
        const dx = Math.cos(th), dy = Math.sin(th);
        const vh = (40 + 160 * r2) * (0.4 + 0.7 * S) * M;
        const vz = (40 + 160 * r3) * (0.3 + 0.8 * S) * M;
        const e = (1 - Math.exp(-3.6 * age)) / 3.6;
        const wob = Math.sin(age * (1.3 + 2 * r4) + r1 * 9) * 4 * M * Math.min(1, age);
        const x = fx + dx * (RC + vh * e) - dy * wob, y = fy + dy * (RC + vh * e) * 0.8 + dx * wob, z = 0.003 + vz * e - 9 * M * age;
        if (z < 0 || behindPumpkin(b.e, x, y, z)) continue;
        proj(b, x, y, z, P);
        const tw = 0.5 + 0.5 * Math.sin(now * (5 + 6 * r2) + r1 * 20);
        const a = (1 - Math.exp(-age / 0.05)) * Math.pow(1 - age / L, 1.5) * (0.25 + 0.75 * tw * tw);
        const sz = (0.6 + 1.0 * r1) * (0.8 + 0.3 * S) * M * P[3];
        put(motes, P[0], P[1], 8, 8, (sz * 1.8) / 16, 0, SPR_MOTE[0], SPR_MOTE[1], SPR_MOTE[2], SPR_MOTE[3], 1, 0.88, 0.7, a * 0.9);
      }

      const all = shadows.concat(puffs, grit, leaves, motes);
      const cap = PER_IMPACT * 12;
      for (let j = 0; j < all.length && j < cap; j++) out.push(all[j]);
    }
    return out.length ? out : NONE;
  });
  const buf = useSpriteBuffers(data, MAX_SPRITES);

  // ── thin shock ring on the floor boards (hard landings only): circle on the porch plane, projected through the camera ──
  const ring = useDerivedValue(() => {
    const list = impacts.get();
    if (list.length === 0) return RING_NONE;
    const I = list[list.length - 1];
    const age = time.get() - I.t;
    const S = Math.min(1.3, I.strength);
    if (S < 0.5 || age < 0 || age > RING_LIFE) return RING_NONE;
    const b = basis ? basis.get() : BASE_BASIS;
    const Q = [0, 0, 0, 0];
    proj(b, PUMPKIN_FOOT_W[0], PUMPKIN_FOOT_W[1], 0, Q);
    const fx = PUMPKIN_FOOT_W[0] + (I.x - Q[0]) / Q[3], fy = 0;
    const u = age / RING_LIFE;
    const e = 1 - (1 - u) * (1 - u) * (1 - u);
    const R = 0.13 + (50 + 110 * S) * e * M;
    const pb = Skia.PathBuilder.Make();
    for (let j = 0; j <= 40; j++) {
      const a = (j / 40) * TAU;
      proj(b, fx + Math.cos(a) * R, fy + Math.sin(a) * R, 0.001, Q);
      if (j === 0) pb.moveTo(Q[0], Q[1]);
      else pb.lineTo(Q[0], Q[1]);
    }
    return { path: pb.build(), w: (1.2 + 2.2 * S) * (1 - u), a: 0.14 * clamp01((S - 0.5) / 0.5) * (1 - u) * (1 - u) };
  });
  const ringPath = useDerivedValue<SkPath>(() => ring.get().path);
  const ringW = useDerivedValue(() => ring.get().w);
  const ringA = useDerivedValue(() => ring.get().a);

  return (
    <Group>
      <Path path={ringPath} style="stroke" strokeWidth={ringW} color="#f2dcc0" opacity={ringA} blendMode="plus">
        <BlurMask blur={1.6} style="normal" />
      </Path>
      <Atlas image={sheet} sprites={buf.sprites} transforms={buf.transforms} colors={buf.colors} colorBlendMode="modulate" sampling={SAMPLING} />
    </Group>
  );
}
