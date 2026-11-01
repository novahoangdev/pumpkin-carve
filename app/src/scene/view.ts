import { CAM, CROP, PUMPKIN, VIEW } from "./layout";

const NECK_UP = 0.1;   // eyes sit above the neck joint (m)
const NECK_FWD = 0.08; // eyes sit in front of the neck joint (m)

/**
 * View camera: rotate (yaw, pitch), change focal length (zoom) and SHIFT the eye a few cm like a real head:
 *   - turning the head: the eye sits in front of and above the neck joint, so turning moves it along a small arc (natural parallax when looking around)
 *   - tilting the phone: the eye orbits the pumpkin (ox, oy) so the pumpkin and its interior shift with correct perspective
 * The shader reconstructs the image from depth (bg_depth): screen point → ray from the eye → world point → original camera image / panorama.
 * The pumpkin uses an analytic ellipsoid for depth. With no eye shift this is exactly the original camera's homography.
 */
export type ViewState = { yaw: number; pitch: number; zoom: number; ox?: number; oy?: number };
/** View camera axes in world space (x right, y up, z opposite the view direction), focal length (pt), eye position (m). */
export type Basis = { x: number[]; y: number[]; z: number[]; f: number; e: number[] };

const X0 = CAM.rot[0], Y0 = CAM.rot[1], Z0 = CAM.rot[2];
export const F0 = CAM.f;
const CX = VIEW.w / 2, CY = VIEW.h / 2;

export const YAW_MAX = 1.2;     // ~69°
export const PITCH_MIN = -0.85; // ~-49°
export const PITCH_MAX = 0.8;   // ~46°
export const ZOOM_MIN = 0.55;
export const ZOOM_MAX = 1.8;

const dot = (a: number[], b: number[]) => {
  "worklet";
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
};

// rotate vector v around unit axis k by angle a (Rodrigues)
const rot = (v: number[], k: number[], a: number) => {
  "worklet";
  const c = Math.cos(a), s = Math.sin(a), kd = dot(k, v) * (1 - c);
  return [
    v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * kd,
    v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * kd,
    v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * kd,
  ];
};

/** positive yaw = look right (around the world vertical axis), positive pitch = look up (around the camera horizontal axis). */
export const viewBasis = (v: ViewState): Basis => {
  "worklet";
  const up = [0, 0, 1];
  const x1 = rot(X0, up, -v.yaw), y1 = rot(Y0, up, -v.yaw), z1 = rot(Z0, up, -v.yaw);
  const y2 = rot(y1, x1, v.pitch), z2 = rot(z1, x1, v.pitch);
  const ox = v.ox ?? 0, oy = v.oy ?? 0;
  const e = [0, 1, 2].map(
    (i) => CAM.pos[i] + (y2[i] - Y0[i]) * NECK_UP - (z2[i] - Z0[i]) * NECK_FWD + X0[i] * ox + Y0[i] * oy,
  );
  return { x: x1, y: y2, z: z2, f: F0 * v.zoom, e };
};

/** Screen point (pt) → point on the original camera image (pt); null if behind the original camera. */
export const screenToBase = (b: Basis, x: number, y: number): [number, number] | null => {
  "worklet";
  const sx = (x - CX) / b.f, sy = -(y - CY) / b.f;
  const d = [b.x[0] * sx + b.y[0] * sy - b.z[0], b.x[1] * sx + b.y[1] * sy - b.z[1], b.x[2] * sx + b.y[2] * sy - b.z[2]];
  const cz = dot(Z0, d);
  if (cz >= -1e-4) return null;
  return [CX + (F0 * dot(X0, d)) / -cz, CY - (F0 * dot(Y0, d)) / -cz];
};

/** Point on the original camera image (pt) → screen point (pt) of the view camera. */
export const baseToScreen = (b: Basis, x: number, y: number): [number, number] => {
  "worklet";
  const sx = (x - CX) / F0, sy = -(y - CY) / F0;
  const d = [X0[0] * sx + Y0[0] * sy - Z0[0], X0[1] * sx + Y0[1] * sy - Z0[1], X0[2] * sx + Y0[2] * sy - Z0[2]];
  const cz = Math.min(dot(b.z, d), -1e-4);
  return [CX + (b.f * dot(b.x, d)) / -cz, CY - (b.f * dot(b.y, d)) / -cz];
};

/** World point (m) → original camera image (pt). */
export const projectBase = (p: number[]) => {
  "worklet";
  const d = [p[0] - CAM.pos[0], p[1] - CAM.pos[1], p[2] - CAM.pos[2]];
  const cz = dot(Z0, d);
  return [CX + (F0 * dot(X0, d)) / -cz, CY - (F0 * dot(Y0, d)) / -cz] as const;
};

/** Pumpkin base (porch contact point) and center on the original camera image: pivot for rotation/squash when it jumps. */
export const PUMPKIN_FOOT = projectBase([PUMPKIN.c[0], PUMPKIN.c[1] - PUMPKIN.r[1] * 0.35, 0]);
export const PUMPKIN_MID = projectBase(PUMPKIN.c);
/** Pumpkin width on the original image (pt), ~ 0.94 of the crop side. */
export const PUMPKIN_W = CROP.s * 0.94;

/** World point (m) → view camera screen (pt); z = depth (m) along the view direction, ≤ 0 if behind the camera. */
export const worldToScreen = (b: Basis, p: number[]): [number, number, number] => {
  "worklet";
  const d = [p[0] - b.e[0], p[1] - b.e[1], p[2] - b.e[2]];
  const z = -dot(b.z, d);
  const zz = Math.max(z, 1e-3);
  return [CX + (b.f * dot(b.x, d)) / zz, CY - (b.f * dot(b.y, d)) / zz, z];
};

const PC = PUMPKIN.c, PR = PUMPKIN.r;
/**
 * Ray from o along d hits the pumpkin ellipsoid (front face). On a miss, take the point closest to the center in the ellipsoid metric
 * (equal to the tangent point at the silhouette, so it is continuous): the stem / rim areas still get a sensible depth.
 */
export const pumpkinHit = (o: number[], d: number[]) => {
  "worklet";
  const a = [d[0] / PR[0], d[1] / PR[1], d[2] / PR[2]];
  const q = [(o[0] - PC[0]) / PR[0], (o[1] - PC[1]) / PR[1], (o[2] - PC[2]) / PR[2]];
  const A = dot(a, a), B = 2 * dot(a, q), C = dot(q, q) - 1;
  const disc = B * B - 4 * A * C;
  const t = disc > 0 ? (-B - Math.sqrt(disc)) / (2 * A) : -B / (2 * A);
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
};

/** Screen point → point on the original image of the (static) pumpkin under the finger, accounting for eye shift. */
export const screenToPumpkin = (b: Basis, x: number, y: number): [number, number] => {
  "worklet";
  const sx = (x - CX) / b.f, sy = -(y - CY) / b.f;
  const d = [b.x[0] * sx + b.y[0] * sy - b.z[0], b.x[1] * sx + b.y[1] * sy - b.z[1], b.x[2] * sx + b.y[2] * sy - b.z[2]];
  const p = projectBase(pumpkinHit(b.e, d));
  return [p[0], p[1]];
};

/** Point on the pumpkin (original image pt) → view camera screen (correct parallax when the eye shifts). */
export const pumpkinToScreen = (b: Basis, px: number, py: number): [number, number] => {
  "worklet";
  const sx = (px - CX) / F0, sy = -(py - CY) / F0;
  const d = [X0[0] * sx + Y0[0] * sy - Z0[0], X0[1] * sx + Y0[1] * sy - Z0[1], X0[2] * sx + Y0[2] * sy - Z0[2]];
  const s = worldToScreen(b, pumpkinHit(CAM.pos, d));
  return [s[0], s[1]];
};

/**
 * Approximate affine transform around a point on the pumpkin (overlay layers: knife trail, rind piece, debris): screen ≈ S + k·(p − P).
 */
export const localAffine = (b: Basis, px: number, py: number) => {
  "worklet";
  const [sx, sy] = pumpkinToScreen(b, px, py);
  const [ax, ay] = pumpkinToScreen(b, px + 10, py);
  const k = Math.hypot(ax - sx, ay - sy) / 10;
  return { sx, sy, k };
};

/** Like localAffine but for any world point (e.g. the pumpkin base on the porch). */
export const worldAffine = (b: Basis, p: number[]) => {
  "worklet";
  const [sx, sy, z] = worldToScreen(b, p);
  const d = [p[0] - CAM.pos[0], p[1] - CAM.pos[1], p[2] - CAM.pos[2]];
  const z0 = -dot(Z0, d);
  return { sx, sy, k: b.f / Math.max(z, 1e-3) / (F0 / z0) };
};

/** Pumpkin base on the porch (m). */
export const PUMPKIN_FOOT_W = [PC[0], PC[1] - PR[1] * 0.35, 0];
