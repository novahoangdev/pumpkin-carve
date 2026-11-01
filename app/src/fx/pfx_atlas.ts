import { FilterMode, MipmapMode, useColorBuffer, useRSXformBuffer, useRectBuffer } from "react-native-skia";
import type { SharedValue } from "react-native-reanimated";
import { CAM, PUMPKIN, VIEW } from "../scene/layout";
import { F0, pumpkinHit, viewBasis, type Basis } from "../scene/view";

/**
 * Shared helpers for Atlas-drawn effects (one draw call for hundreds of sprites).
 *
 * Every frame, a useDerivedValue computes a flat number array, STRIDE numbers per sprite:
 *   [scos, ssin, tx, ty,  rx, ry, rw, rh,  r, g, b, a]
 * (RSXform | sprite cell in the sheet (px) | color multiplied into the sprite, a = opacity).
 * Three buffers (transform / cell / color) read that array back and modify in place, avoiding Skia object allocation every frame.
 * When nothing is alive, the derived value returns the exact same shared empty array → Reanimated sees an unchanged value,
 * does not rerun the buffers, nothing extra is redrawn.
 */
export const STRIDE = 12;
/**
 * "Off" sprite: tiny but INVERTIBLE scale, placed off screen. Do NOT use RSXform (0, 0, 0, 0): Graphite prints
 * "[skia] WARNING - Skipping draw with non-invertible/non-finite transform" to stderr for EVERY such sprite every frame
 * (Release build: ~32 000 lines/second, eating ~1/3 of each render thread's time → stutter).
 */
export const HIDDEN_XF = [1e-3, 0, -1e4, -1e4] as const;
export const NONE: number[] = [];

/** Mipmapped sampling: sprites are usually shrunk 2–4× on screen. */
export const SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.Linear };

/**
 * Pushes one sprite into `out`. The anchor (ax, ay) in the sprite cell (px) lands exactly on (cx, cy) on the canvas,
 * `s` = pt per sprite px, `rot` = rotation angle (rad).
 */
export const put = (
  out: number[],
  cx: number,
  cy: number,
  ax: number,
  ay: number,
  s: number,
  rot: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  r: number,
  g: number,
  b: number,
  a: number,
) => {
  "worklet";
  if (!(Math.abs(s) >= 1e-3)) {
    // scale 0 / NaN → non-invertible matrix (see HIDDEN_XF): push a hidden sprite instead of a degenerate one
    out.push(HIDDEN_XF[0], HIDDEN_XF[1], HIDDEN_XF[2], HIDDEN_XF[3], rx, ry, rw, rh, r, g, b, 0);
    return;
  }
  const sc = s * Math.cos(rot);
  const ss = s * Math.sin(rot);
  out.push(sc, ss, cx - (sc * ax - ss * ay), cy - (ss * ax + sc * ay), rx, ry, rw, rh, r, g, b, a < 0 ? 0 : a > 1 ? 1 : a);
};

export const clamp01 = (v: number) => {
  "worklet";
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

export const smoothstep = (a: number, b: number, x: number) => {
  "worklet";
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Always-positive modulo. */
export const wrap = (v: number, n: number) => {
  "worklet";
  return ((v % n) + n) % n;
};

/** Three fixed buffers of `max` elements for <Atlas>, filled from the flat array `data` (extra sprites: shrunk to 0, transparent). */
export const useSpriteBuffers = (data: SharedValue<number[]>, max: number) => {
  const transforms = useRSXformBuffer(max, (v, i) => {
    "worklet";
    const d = data.value;
    const o = i * STRIDE;
    if (o < d.length) v.set(d[o], d[o + 1], d[o + 2], d[o + 3]);
    else v.set(HIDDEN_XF[0], HIDDEN_XF[1], HIDDEN_XF[2], HIDDEN_XF[3]);
  });
  const sprites = useRectBuffer(max, (v, i) => {
    "worklet";
    const d = data.value;
    const o = i * STRIDE;
    if (o < d.length) v.setXYWH(d[o + 4], d[o + 5], d[o + 6], d[o + 7]);
    else v.setXYWH(0, 0, 1, 1);
  });
  const colors = useColorBuffer(max, (v, i) => {
    "worklet";
    const d = data.value;
    const o = i * STRIDE;
    if (o < d.length) {
      v[0] = d[o + 8];
      v[1] = d[o + 9];
      v[2] = d[o + 10];
      v[3] = d[o + 11];
    } else v[3] = 0;
  });
  return { transforms, sprites, colors };
};

// ───────────────────────── 3D: particles living in scene space (m), projected through the view camera ─────────────────────────

/** Original camera (no rotation, no eye shift): used when the scene has not passed `basis` → projects to the original image coordinates. */
export const BASE_BASIS: Basis = viewBasis({ yaw: 0, pitch: 0, zoom: 1 });

const X0 = CAM.rot[0], Y0 = CAM.rot[1], Z0 = CAM.rot[2];
const CX0 = VIEW.w / 2, CY0 = VIEW.h / 2; // design frame center (layout.json, 17 Pro Max 440×956)

/** Point on the pumpkin (original image pt) → world point (m) on the ellipsoid surface + outward normal. */
export const pumpkinWorld = (px: number, py: number) => {
  "worklet";
  const sx = (px - CX0) / F0, sy = -(py - CY0) / F0;
  const d = [X0[0] * sx + Y0[0] * sy - Z0[0], X0[1] * sx + Y0[1] * sy - Z0[1], X0[2] * sx + Y0[2] * sy - Z0[2]];
  const p = pumpkinHit(CAM.pos, d);
  const c = PUMPKIN.c, r = PUMPKIN.r;
  let nx = (p[0] - c[0]) / (r[0] * r[0]), ny = (p[1] - c[1]) / (r[1] * r[1]), nz = (p[2] - c[2]) / (r[2] * r[2]);
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  return [p[0], p[1], p[2], nx, ny, nz];
};

/** World → view camera screen (design pt). out = [x, y, depth m, pt/m at that depth]. */
export const proj = (b: Basis, x: number, y: number, z: number, out: number[]) => {
  "worklet";
  const dx = x - b.e[0], dy = y - b.e[1], dz = z - b.e[2];
  const zz = -(b.z[0] * dx + b.z[1] * dy + b.z[2] * dz);
  const w = Math.max(zz, 1e-3);
  const k = b.f / w;
  out[0] = CX0 + k * (b.x[0] * dx + b.x[1] * dy + b.x[2] * dz);
  out[1] = CY0 - k * (b.y[0] * dx + b.y[1] * dy + b.y[2] * dz);
  out[2] = zz;
  out[3] = k;
};

/** Is the eye → p segment hidden by the pumpkin (ellipsoid intersection shrunk slightly so particles near the rind do not flicker). */
export const behindPumpkin = (e: number[], x: number, y: number, z: number) => {
  "worklet";
  const c = PUMPKIN.c, r = PUMPKIN.r;
  const s = 0.97;
  const ox = (e[0] - c[0]) / (r[0] * s), oy = (e[1] - c[1]) / (r[1] * s), oz = (e[2] - c[2]) / (r[2] * s);
  const dx = (x - e[0]) / (r[0] * s), dy = (y - e[1]) / (r[1] * s), dz = (z - e[2]) / (r[2] * s);
  const A = dx * dx + dy * dy + dz * dz, B = 2 * (ox * dx + oy * dy + oz * dz), C = ox * ox + oy * oy + oz * oz - 1;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return false;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t > 0 && t < 0.985;
};

/**
 * Free fall with bounces on the porch plane (z = rad) then sliding with friction until it stops — analytic solution, no state needed.
 * e: bounce coefficient, fr: horizontal velocity lost per bounce, mu: sliding friction.
 * out = [x, y, z, vx, vy, vz, tFirst (first contact time, −1 if none yet), tSlide (slide start, −1), rest (0/1), bounce count]
 */
export const fall = (
  t: number,
  px: number, py: number, pz: number,
  vx: number, vy: number, vz: number,
  G: number, rad: number, e: number, fr: number, mu: number,
  out: number[],
) => {
  "worklet";
  let tt = t;
  let tFirst = -1;
  let n = 0;
  for (let k = 0; k < 5; k++) {
    const h = pz - rad;
    const th = (vz + Math.sqrt(Math.max(0, vz * vz + 2 * G * h))) / G;
    if (tt < th) {
      out[0] = px + vx * tt; out[1] = py + vy * tt; out[2] = pz + vz * tt - 0.5 * G * tt * tt;
      out[3] = vx; out[4] = vy; out[5] = vz - G * tt;
      out[6] = tFirst; out[7] = -1; out[8] = 0; out[9] = n;
      return;
    }
    px += vx * th; py += vy * th; pz = rad;
    const vzi = vz - G * th;
    tt -= th;
    if (tFirst < 0) tFirst = t - tt;
    n++;
    vz = -vzi * e;
    vx *= 1 - fr; vy *= 1 - fr;
    if (vz < 0.14) break;
  }
  // sliding on the porch, uniformly decelerating until it stops
  const sp = Math.hypot(vx, vy);
  const a = mu * G;
  const ts = sp / Math.max(a, 1e-4);
  const u = Math.min(tt, ts);
  const d = sp > 1e-5 ? (sp * u - 0.5 * a * u * u) / sp : 0;
  const f = sp > 1e-5 ? 1 - u / ts : 0;
  out[0] = px + vx * d; out[1] = py + vy * d; out[2] = rad;
  out[3] = vx * f; out[4] = vy * f; out[5] = 0;
  out[6] = tFirst; out[7] = t - tt; out[8] = tt >= ts ? 1 : 0; out[9] = n;
};

/** Rotate vector v around the unit axis (ax, ay, az) by angle a (Rodrigues), written to out[o..o+2]. */
export const rotv = (vx: number, vy: number, vz: number, ax: number, ay: number, az: number, a: number, out: number[], o: number) => {
  "worklet";
  const c = Math.cos(a), s = Math.sin(a), kd = (ax * vx + ay * vy + az * vz) * (1 - c);
  out[o] = vx * c + (ay * vz - az * vy) * s + ax * kd;
  out[o + 1] = vy * c + (az * vx - ax * vz) * s + ay * kd;
  out[o + 2] = vz * c + (ax * vy - ay * vx) * s + az * kd;
};

/** Porch light (m): hangs on the door frame behind the pumpkin (original image ~ (192, 166) pt), on the wall at y ≈ 1.5 m. */
export const LANTERN_W = (() => {
  const sx = (191.9 - CX0) / F0, sy = -(165.76 - CY0) / F0;
  const d = [X0[0] * sx + Y0[0] * sy - Z0[0], X0[1] * sx + Y0[1] * sy - Z0[1], X0[2] * sx + Y0[2] * sy - Z0[2]];
  const t = (1.35 - CAM.pos[1]) / d[1];
  return [CAM.pos[0] + d[0] * t, CAM.pos[1] + d[1] * t, CAM.pos[2] + d[2] * t];
})();

/** Original image point (pt) → point on the porch plane z = h (m) along the ray from the original camera. */
export const baseToFloor = (px: number, py: number, h = 0) => {
  const sx = (px - CX0) / F0, sy = -(py - CY0) / F0;
  const d = [X0[0] * sx + Y0[0] * sy - Z0[0], X0[1] * sx + Y0[1] * sy - Z0[1], X0[2] * sx + Y0[2] * sy - Z0[2]];
  const t = (h - CAM.pos[2]) / d[2];
  return [CAM.pos[0] + d[0] * t, CAM.pos[1] + d[1] * t, h];
};

/** View camera screen point (pt) → point on the pumpkin surface (m) along the ray from the eye (on a miss, take the nearest point). */
export const screenToPumpkinWorld = (b: Basis, x: number, y: number) => {
  "worklet";
  const sx = (x - CX0) / b.f, sy = -(y - CY0) / b.f;
  const d = [b.x[0] * sx + b.y[0] * sy - b.z[0], b.x[1] * sx + b.y[1] * sy - b.z[1], b.x[2] * sx + b.y[2] * sy - b.z[2]];
  return pumpkinHit(b.e, d);
};
