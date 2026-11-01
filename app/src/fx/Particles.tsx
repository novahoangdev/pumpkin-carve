import React from "react";
import { Atlas, Group } from "react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { FLAME_W } from "../scene/layout";
import { PUMPKIN_FOOT_W, type Basis } from "../scene/view";
import type { Impact } from "./jump";
import { useGpuImage } from "../perf/gpu";
import {
  BASE_BASIS,
  LANTERN_W,
  NONE,
  SAMPLING,
  behindPumpkin,
  fall,
  proj,
  pumpkinWorld,
  put,
  rotv,
  smoothstep,
  useSpriteBuffers,
  wrap,
} from "./pfx_atlas";

/** One debris burst: center and radius of the just-carved hole (original image pt), time (scene clock seconds). */
export type Burst = { x: number; y: number; rx: number; ry: number; t: number; seed: number };

const PER_BURST = 9; // FEEDBACK-2300 #2: fewer, small orange-yellow flesh crumbs only (was 18 incl. seeds / big chunks)
const LIFE = 75; // real debris does not vanish by itself: it stays on the porch (glowing in candlelight once lit), only fading after a very long time
const G = 7.6; // m/s² — close to real gravity, slightly slower so the eye can follow
const TAU = Math.PI * 2;

const SHEET = require("../../assets/fx/pfx_debris.png");
// pfx_debris.png (64 px cells, baked with Blender + numpy):
//   rows 0–3  pumpkin flesh bits: 4 shapes × 16 light directions (light rotating around the view axis, 22.5°/cell)
//   rows 4–7  pumpkin seeds: 8 flip angles (0..180°) × 8 light directions, index = flip·8 + light
//   row 8     pumpkin pulp strings: 2 styles × 8 light directions
//   row 9     contact shadow 64×32 | motion smear 64×16 | ember glow 64 | ember core 16 | sparkle 32
const C = 64;
const ROW_SEED = 4 * C;
const ROW_STRAND = 8 * C;
const ROW_MISC = 9 * C;
const SPR_SHADOW = [0, ROW_MISC, 64, 32];
const SPR_STREAK = [64, ROW_MISC, 64, 16];
const SPR_GLOW = [128, ROW_MISC, 64, 64];
const SPR_CORE = [192, ROW_MISC, 16, 16];
const SPR_GLINT = [224, ROW_MISC, 32, 32];
const FILL_CHUNK = 0.72;
const FILL_SEED = 0.875;
const FILL_STRAND = 0.855;

const MAX_BURSTS = 6;
const MAX_SPRITES = MAX_BURSTS * PER_BURST * 4; // wet stain + shadow + motion smear + body
const EMBERS = 16;
const MAX_GLOW = EMBERS * 2 + MAX_BURSTS * PER_BURST;

const IDLE = { body: NONE, glint: NONE };

const hash = (n: number) => {
  "worklet";
  const s = Math.sin(n * 91.7 + 47.3) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Pumpkin flesh bits, seeds, pulp strings and juice droplets thrown from the hole edge when the rind piece collapses — living in SCENE SPACE (meters):
 * spawned on the pumpkin ellipsoid surface right at the carved hole, fly along the normal + tossed up, fall under gravity, spin in 3D, bounce on
 * the porch plane (z = 0) with per-type restitution (seeds bounce, wet flesh sticks to the floor), slide with friction then settle, leaving wet stains.
 * Every point is projected through the view camera (`basis`) so when looking around / tilting the phone the debris sits correctly on the porch (real parallax),
 * hidden by the pumpkin when behind it, sized by depth. "Stateless" particles: position computed directly from seed and time.
 *
 * Look: Blender sprites (wet flesh with SSS, flat ridged seeds, strings), cell chosen by the light direction projected on screen. Seeds
 * have a real 3D orientation (normal + long axis): flip angle = angle between the normal and the view ray, lying on the porch they become thin
 * perspective-correct ellipses. Lighting: before lighting the candle it is the porch light (warm, from above) + moon; afterwards the candlelight spilling out.
 *
 * `basis`: the scene view camera. When passed, Particles is drawn OUTSIDE the `pumpkinTransform` group (design screen coordinates).
 * When not passed, projects with the original camera (= original image coordinates, like the old version inside the pumpkinTransform group).
 */
export function Particles({
  bursts,
  time,
  litAt,
  basis,
  impacts,
}: {
  bursts: SharedValue<Burst[]>;
  time: SharedValue<number>;
  litAt: SharedValue<number>;
  basis?: SharedValue<Basis>;
  /** pumpkin landings (jump.impacts): debris lying near the pumpkin base bounces up slightly with them */
  impacts?: SharedValue<Impact[]>;
}) {
  const sheet = useGpuImage(SHEET, { mipmapped: true });

  // spawn point on the pumpkin surface (ray–ellipsoid intersection) depends only on the burst → computed once per new burst, not every frame
  const spawn = useDerivedValue(() => {
    const bs = bursts.value;
    const out: number[][] = [];
    for (let bi = 0; bi < bs.length; bi++) {
      const B = bs[bi];
      const W0 = pumpkinWorld(B.x, B.y);
      const arr: number[] = [];
      for (let i = 0; i < PER_BURST; i++) {
        const ang = hash(B.seed + i * 3.1) * TAU;
        const S0 = pumpkinWorld(B.x + Math.cos(ang) * B.rx * 0.9, B.y + Math.sin(ang) * B.ry * 0.9);
        let tx = S0[0] - W0[0], ty = S0[1] - W0[1], tz = S0[2] - W0[2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;
        arr.push(S0[0], S0[1], S0[2], S0[3], S0[4], S0[5], tx, ty, tz);
      }
      out.push(arr);
    }
    return out;
  });

  const debris = useDerivedValue(() => {
    const now = time.value;
    const bs = bursts.value;
    if (bs.length === 0 || now - bs[bs.length - 1].t > LIFE + 0.2) return IDLE;
    const b = basis ? basis.value : BASE_BASIS;
    const la = litAt.value;
    const lit = la >= 0 && now - la > 0.39;
    const wet: number[] = [];
    const shadows: number[] = [];
    const streaks: number[] = [];
    const bodies: number[] = [];
    const glints: number[] = [];
    const st = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const P = [0, 0, 0, 0];
    const Q = [0, 0, 0, 0];
    const R = [0, 0, 0, 0, 0, 0];
    // light direction on screen: project the light source
    const lightW = lit ? FLAME_W : LANTERN_W;
    const LS = [0, 0, 0, 0];
    proj(b, lightW[0], lightW[1], lightW[2], LS);
    // latest pumpkin landing (floor still shaking): pumpkin base position (m) + time + strength
    const imps = impacts ? impacts.value : null;
    const hits: number[] = [];
    if (imps && imps.length) {
      proj(b, PUMPKIN_FOOT_W[0], PUMPKIN_FOOT_W[1], 0, Q);
      for (let j = Math.max(0, imps.length - 3); j < imps.length; j++) {
        const I = imps[j];
        const a = now - I.t;
        if (a > 0 && a < 0.5) hits.push(PUMPKIN_FOOT_W[0] + (I.x - Q[0]) / Q[3], PUMPKIN_FOOT_W[1], I.t, Math.min(1.3, I.strength));
      }
    }
    for (let bi = 0; bi < bs.length; bi++) {
      const B = bs[bi];
      const age = now - B.t;
      if (age < 0 || age > LIFE + 0.2) continue;
      const SP = spawn.value[bi];
      if (!SP) continue;
      for (let i = 0; i < PER_BURST; i++) {
        const k = B.seed + i * 3.1;
        const r1 = hash(k), r2 = hash(k + 1.3), r3 = hash(k + 2.7), r4 = hash(k + 5.9), r5 = hash(k + 8.3), r6 = hash(k + 11.1);
        const t = age - r4 * 0.09;
        if (t <= 0) continue;
        // 0 seed, 1 flesh bit, 2 string, 3 juice droplet
        // FEEDBACK-2300 #2: no seeds / strands any more (read as pebbles stuck around the eyes): wet flesh crumbs + juice drops
        const kind: number = i % 3 === 2 ? 3 : 1;
        // spawn point on the hole edge (original image) → pumpkin surface (m) + normal
        const o9 = i * 9;
        const S0x = SP[o9], S0y = SP[o9 + 1], S0z = SP[o9 + 2], N0x = SP[o9 + 3], N0y = SP[o9 + 4], N0z = SP[o9 + 5];
        const tx = SP[o9 + 6], tz = SP[o9 + 8];
        // velocity: pieces drop out of the cut and land IN FRONT of the pumpkin (where the carved piece fell), not in a ring:
        // small sideways spread, pushed toward the camera (−y), uneven speeds (most land close, a few roll far)
        // FEEDBACK-2300 #2: drop off the face at once — enough push toward the camera to clear the bulge below the cut,
        // almost no upward kick (no hang time in front of the face), then gravity takes them to the floor
        const out = 0.16 + 0.22 * r2 * r2;
        const spread = 0.08 + 0.12 * r3;
        const light = kind === 3 ? 1.25 : kind === 0 ? 1.1 : 1;
        let vx = (N0x * out * 0.5 + tx * spread * 0.45 + (r5 - 0.5) * 0.12) * light;
        let vy = (N0y * out * 0.6 - 0.1 - 0.32 * r6 * r6) * light;
        const vz = (N0z * out * 0.3 + tz * spread * 0.2 + 0.02 + 0.08 * r3 * r3) * light;
        if (vy > -0.24) vy = -0.24 - 0.1 * r6;
        vx = Math.max(-0.35, Math.min(0.35, vx));
        // real size (m): heavy-tailed, mostly small crumbs, a few big chunks
        const sizeM = kind === 1 ? 0.0035 + 0.0065 * r2 * r2 * r2 : kind === 0 ? 0.0125 + 0.005 * r2 : kind === 2 ? 0.018 + 0.016 * r2 : 0.0016 + 0.0016 * r2;
        const rad = kind === 0 ? 0.0015 : kind === 2 ? 0.001 : kind === 3 ? 0 : sizeM * 0.32;
        const e = kind === 0 ? 0.42 : kind === 1 ? 0.2 : kind === 2 ? 0.05 : 0;
        const fr = kind === 0 ? 0.25 : 0.45;
        const mu = kind === 0 ? 0.45 : kind === 3 ? 4 : 0.9;
        // juice droplet: shot from the cut edge itself, small and fast
        fall(t, S0x + N0x * 0.01, S0y + N0y * 0.01, S0z + N0z * 0.01, vx, vy, vz, G, rad, e, fr, mu, st);
        let x = st[0], y = st[1], z = st[2];
        const tFirst = st[6], tSlide = st[7], rest = st[8];
        // pumpkin lands on the floor: settled debris near the base hops up slightly (closer + stronger = higher), flung a bit outward
        if (tSlide >= 0) {
          for (let j = 0; j < hits.length; j += 4) {
            if (hits[j + 2] < B.t + r4 * 0.09 + tSlide) continue;
            const a = now - hits[j + 2];
            const dx = x - hits[j], dy = y - hits[j + 1];
            const d = Math.hypot(dx, dy) || 1;
            const h = 0.016 * hits[j + 3] * Math.exp(-Math.max(0, d - 0.14) / 0.1) * (kind === 0 ? 1.3 : kind === 1 ? 0.8 : 0.5);
            if (h < 0.0006) continue;
            const v0 = Math.sqrt(2 * G * h);
            const tf = (2 * v0) / G;
            const u = Math.min(1, a / tf);
            if (a < tf) z += v0 * a - 0.5 * G * a * a;
            x += (dx / d) * h * 0.8 * u;
            y += (dy / d) * h * 0.8 * u;
          }
        }
        if (behindPumpkin(b.e, x, y, z)) continue;
        proj(b, x, y, z, P);
        if (P[2] < 0.05) continue;
        const k1 = P[3]; // pt per meter at this depth
        // fade out at end of life; droplets vanish as soon as they hit the floor
        let alpha = 1 - smoothstep(LIFE - 2.2, LIFE, t);
        if (kind === 3 && tFirst >= 0) alpha = 0;
        if (alpha <= 0.01 && kind !== 3) continue;

        // ── lighting ──
        const lightDir = Math.atan2(LS[1] - P[1], LS[0] - P[0]);
        let lr: number, lg: number, lb: number;
        if (lit) {
          const dd = Math.hypot(x - FLAME_W[0], y - FLAME_W[1], z - FLAME_W[2]);
          const near = 0.3 + 0.62 * Math.exp(-dd / 0.16);
          lr = Math.min(1, 0.92 * near);
          lg = 0.76 * near;
          lb = 0.6 * near;
        } else {
          // warm porch light from above: brighter when higher, partly shadowed by the pumpkin base near the floor
          const hk = 0.56 + 0.16 * Math.min(1, z / 0.18);
          lr = 0.86 * hk;
          lg = 0.82 * hk;
          lb = 0.76 * hk;
        }
        // motion smear from fast flight (pt/s on screen)
        const airborne = tFirst < 0 || (tSlide < 0 && st[9] > 0 && Math.abs(st[5]) > 0.05);
        let svx = 0, svy = 0;
        if (airborne) {
          proj(b, x + st[3] * 0.01, y + st[4] * 0.01, z + st[5] * 0.01, Q);
          svx = (Q[0] - P[0]) * 100;
          svy = (Q[1] - P[1]) * 100;
        }
        const speed = Math.hypot(svx, svy);

        // spin: angular speed drops with each bounce, stops when sliding/resting
        const w = (8 + 22 * r5) * (r1 < 0.5 ? -1 : 1);
        const tSpin = tSlide >= 0 ? tSlide : t;
        const spin = tFirst < 0 ? w * t : w * tFirst + w * 0.45 * (tSpin - tFirst);
        let D = 0;

        if (kind === 1) {
          D = sizeM * k1;
          if (D < 0.6) continue;
          const li = wrap(Math.round((lightDir - spin) / (TAU / 16)), 16);
          const shape = Math.floor(r6 * 4);
          const tumble = Math.cos(spin * 0.7 + r1 * 6);
          // FEEDBACK-2300 #2: fresh flesh is orange-yellow and bright (the sprite's dark side read as brown pebbles):
          // lift the floor of the light and tint warm instead of the neutral grey light
          const br = (0.9 + 0.1 * tumble) * (0.62 + 0.38 * Math.max(lr, 0.5));
          put(bodies, P[0], P[1], 32, 32, D / (C * FILL_CHUNK), spin, li * C, shape * C, C, C, Math.min(1, 1.15 * br), Math.min(1, 0.86 * br), 0.42 * br, alpha);
        } else if (kind === 0) {
          // particle 3D orientation: normal n and long axis a, rotating around its own spin axis in flight
          let ax = r2 - 0.5, ay = r3 - 0.5, az = r6 - 0.5;
          const al = Math.hypot(ax, ay, az) || 1;
          ax /= al; ay /= al; az /= al;
          // n0, a0 perpendicular to each other
          const n0x = 0, n0y = -1, n0z = 0;
          let a0x = 1, a0y = 0, a0z = 0.2 * (r5 - 0.5);
          const a0l = Math.hypot(a0x, a0y, a0z);
          a0x /= a0l; a0y /= a0l; a0z /= a0l;
          const th = spin;
          rotv(n0x, n0y, n0z, ax, ay, az, th, R, 0);
          rotv(a0x, a0y, a0z, ax, ay, az, th, R, 3);
          if (tSlide >= 0) {
            // lying flat on the porch: normal points up, long axis horizontal (fast transition over 60 ms)
            const u = Math.min(1, (t - tSlide) / 0.06);
            const sz = R[2] >= 0 ? 1 : -1;
            const hl = Math.hypot(R[3], R[4]) || 1;
            R[0] += (0 - R[0]) * u; R[1] += (0 - R[1]) * u; R[2] += (sz - R[2]) * u;
            R[3] += (R[3] / hl - R[3]) * u; R[4] += (R[4] / hl - R[4]) * u; R[5] += (0 - R[5]) * u;
          }
          // flip angle = angle between the particle normal and the view ray
          const vx2 = b.e[0] - x, vy2 = b.e[1] - y, vz2 = b.e[2] - z;
          const vl = Math.hypot(vx2, vy2, vz2) || 1;
          const nl = Math.hypot(R[0], R[1], R[2]) || 1;
          const cf = (R[0] * vx2 + R[1] * vy2 + R[2] * vz2) / (vl * nl);
          const flip = Math.acos(Math.max(-1, Math.min(1, cf)));
          // long axis projected on screen → sprite rotation (sprite: long axis vertical)
          proj(b, x + R[3] * 0.01, y + R[4] * 0.01, z + R[5] * 0.01, Q);
          const rotS = Math.atan2(Q[1] - P[1], Q[0] - P[0]) - Math.PI / 2;
          const L = sizeM * k1;
          if (L < 1) continue;
          D = L * 0.7;
          const fi = wrap(Math.round(flip / (Math.PI / 8)), 8);
          const li = wrap(Math.round((lightDir - rotS) / (TAU / 8)), 8);
          const idx = fi * 8 + li;
          // cream-colored seed: the source sprite is slightly gray → multiply near 1, less blue removal than flesh bits
          const br = (0.86 + 0.14 * Math.abs(cf)) * 1.3;
          put(bodies, P[0], P[1], 32, 32, L / (C * FILL_SEED), rotS, (idx % 16) * C, ROW_SEED + Math.floor(idx / 16) * C, C, C, Math.min(1, lr * br), Math.min(1, lg * br * 1.02), Math.min(1, lb * br * 0.98), alpha);
        } else if (kind === 2) {
          const L = sizeM * k1;
          if (L < 1) continue;
          D = L * 0.3;
          const rotX = spin * 0.45 + r3 * TAU;
          const li = wrap(Math.round((lightDir - rotX) / (TAU / 8)), 8);
          put(bodies, P[0], P[1], 32, 32, L / (C * FILL_STRAND), rotX, ((r6 < 0.5 ? 0 : 8) + li) * C, ROW_STRAND, C, C, lr * 0.95, lg * 0.95, lb * 0.95, alpha);
        } else {
          // juice droplet: small transparent highlight dot, smeared in flight
          D = sizeM * k1;
          if (tFirst < 0) {
            const len = Math.max(D * 1.2, Math.min(speed * 0.022, D * 6));
            put(glints, P[0], P[1], 56, 8, len / 64, Math.atan2(svy, svx), SPR_STREAK[0], SPR_STREAK[1], SPR_STREAK[2], SPR_STREAK[3], lr, lg * 1.05, lb * 0.9, 0.55);
          }
        }

        const hgt = z;
        // ── wet stain on the porch where a bit / droplet lands: dark on contact, spreads slightly then dries ──
        if (tFirst >= 0 && (kind === 1 || kind === 3)) {
          const since = t - tFirst;
          // first contact point: use the current position if already settled nearby (short slide)
          proj(b, x, y, 0.0005, Q);
          const ws = (kind === 3 ? sizeM * 5 : sizeM * 2.4) * Q[3] * (0.7 + 0.3 * Math.min(1, since / 0.2));
          const wa = (kind === 3 ? 0.32 : 0.22) * Math.min(1, since / 0.05) * (1 - smoothstep(2.5, 10, since));
          if (ws > 0.8 && wa > 0.01) put(wet, Q[0], Q[1], 32, 16, ws / 64, 0, SPR_SHADOW[0], SPR_SHADOW[1], SPR_SHADOW[2], SPR_SHADOW[3], 0.12, 0.05, 0.02, wa);
        }
        if (kind === 3) continue;

        // ── contact shadow on the porch: darker and tighter as the particle comes down near the floor ──
        if (hgt < 0.08) {
          const k2 = 1 - hgt / 0.08;
          proj(b, x, y, 0, Q);
          const sw = D * (1.25 + hgt * 8);
          put(shadows, Q[0], Q[1] + D * 0.08, 32, 16, sw / 64, 0, SPR_SHADOW[0], SPR_SHADOW[1], SPR_SHADOW[2], SPR_SHADOW[3], 0, 0, 0, (lit ? 0.42 : 0.5) * k2 * k2 * alpha);
        }

        // ── motion smear (motion blur) in fast flight ──
        if (airborne && speed > 160) {
          const len = Math.min(speed * 0.02, D * 3.4);
          const a = 0.3 * smoothstep(160, 600, speed) * alpha;
          const sr = kind === 0 ? 0.9 : 0.98, sg = kind === 0 ? 0.84 : 0.66, sb = kind === 0 ? 0.7 : 0.3;
          put(streaks, P[0], P[1], 56, 8, len / 64, Math.atan2(svy, svx), SPR_STREAK[0], SPR_STREAK[1], SPR_STREAK[2], SPR_STREAK[3], sr * lr, sg * lg, sb * lb, a);
        }

        // ── wet sparkle: flashes when a bit catches the light at the right angle; settled bits keep a faint wet sheen ──
        if (kind === 1 && r4 > 0.3) {
          const g = rest ? 0.25 * (0.5 + 0.5 * Math.sin(now * 0.7 + r1 * 9)) : smoothstep(0.86, 1.0, Math.cos(spin * 0.7 + r1 * 6 + 1.3));
          if (g > 0.02) {
            const gs = Math.max(1.4, D * 0.55);
            const ox = Math.cos(lightDir) * D * 0.22, oy = Math.sin(lightDir) * D * 0.22;
            put(glints, P[0] + ox, P[1] + oy, 16, 16, gs / 32, 0.3 + r1, SPR_GLINT[0], SPR_GLINT[1], SPR_GLINT[2], SPR_GLINT[3], 1, lit ? 0.84 : 0.95, lit ? 0.6 : 0.86, g * 0.8 * alpha);
          }
        }
      }
    }
    if (bodies.length === 0 && wet.length === 0) return IDLE;
    return { body: wet.concat(shadows, streaks, bodies), glint: glints };
  });

  const body = useDerivedValue(() => debris.value.body);
  const deb = useSpriteBuffers(body, MAX_SPRITES);

  // ── embers: after lighting, small sparks escape through the upper carved holes, rising with the heat (m, 3D projected) ──
  const glow = useDerivedValue(() => {
    const extra = debris.value.glint;
    const la = litAt.value;
    if (la < 0) return extra;
    const now = time.value;
    const t = now - la - 0.4;
    if (t < 0) return extra;
    const b = basis ? basis.value : BASE_BASIS;
    const out: number[] = extra.length ? extra.slice() : [];
    const bs = bursts.value;
    // sources: carved holes above the candle flame (heat escapes through them); if none, right above the candle
    const srcs: number[][] = [];
    for (let j = 0; j < bs.length; j++) {
      const w = pumpkinWorld(bs[j].x, bs[j].y);
      if (w[2] > FLAME_W[2] + 0.02) srcs.push([w[0], w[1], w[2], bs[j].rx / 600]);
    }
    if (srcs.length === 0) srcs.push([FLAME_W[0], FLAME_W[1] - 0.12, FLAME_W[2] + 0.08, 0.04]);
    const P = [0, 0, 0, 0];
    const ramp = Math.min(1, t / 1.2);
    for (let i = 0; i < EMBERS; i++) {
      const r1 = hash(i * 5.3), r2 = hash(i * 2.9 + 4);
      const Pd = 2.4 + r2 * 2.0;
      const tt = t + r1 * Pd;
      const cyc = Math.floor(tt / Pd);
      const a = tt - cyc * Pd;
      if (t - a < 0) continue;
      const q1 = hash(i * 7.1 + cyc * 3.3), q2 = hash(i * 1.7 + cyc * 9.1), q3 = hash(i * 4.3 + cyc * 1.9), q4 = hash(i * 6.1 + cyc * 5.7);
      const lifeA = Pd * (0.35 + 0.6 * q1);
      if (a > lifeA) continue;
      const s = srcs[Math.floor(q4 * srcs.length) % srcs.length];
      // rise (z), drift sideways in a light breeze, wobble; drift slightly forward out of the hole
      const x = s[0] + (q2 - 0.5) * s[3] * 1.6 + (q4 - 0.5) * 0.04 * a + Math.sin(a * (2.2 + 2 * q3) + q1 * 6) * (0.006 + 0.01 * q2) * Math.min(1, a);
      const y = s[1] - 0.01 - 0.02 * a * q3;
      const z = s[2] + (0.035 + 0.04 * q3) * a + 0.025 * a * a;
      proj(b, x, y, z, P);
      if (P[2] < 0.05) continue;
      const T = 1 - a / lifeA;
      const flick = 0.72 + 0.28 * Math.sin(now * (17 + 9 * q2) + i * 3) * Math.sin(now * (6.3 + 4 * q1) + i);
      const k = Math.min(1, a / 0.12) * flick * ramp;
      const g = 0.35 + 0.55 * Math.pow(T, 1.2);
      const bl = 0.08 + 0.45 * T * T * T;
      const gd = (0.014 + 0.011 * T) * P[3];
      put(out, P[0], P[1], 32, 32, gd / 64, 0, SPR_GLOW[0], SPR_GLOW[1], SPR_GLOW[2], SPR_GLOW[3], 1, 0.42 + 0.25 * T, 0.12, 0.34 * T * k);
      const cd = Math.max(1.1, (0.0024 + 0.0022 * T) * P[3]);
      put(out, P[0], P[1], 8, 8, cd / 16, 0, SPR_CORE[0], SPR_CORE[1], SPR_CORE[2], SPR_CORE[3], 1, g, bl, Math.min(1, 1.25 * Math.pow(T, 0.8)) * k);
    }
    return out;
  });
  const add = useSpriteBuffers(glow, MAX_GLOW);

  return (
    <Group>
      <Atlas image={sheet} sprites={deb.sprites} transforms={deb.transforms} colors={deb.colors} colorBlendMode="modulate" sampling={SAMPLING} />
      <Atlas
        image={sheet}
        sprites={add.sprites}
        transforms={add.transforms}
        colors={add.colors}
        colorBlendMode="modulate"
        blendMode="plus"
        sampling={SAMPLING}
      />
    </Group>
  );
}
