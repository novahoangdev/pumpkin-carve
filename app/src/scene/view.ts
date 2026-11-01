import { CAM, CROP, PUMPKIN, VIEW } from "./layout";

const NECK_UP = 0.1;   // mắt cao hơn khớp cổ (m)
const NECK_FWD = 0.08; // mắt ở trước khớp cổ (m)

/**
 * Camera xem: xoay (yaw, pitch), đổi tiêu cự (zoom) và DỊCH mắt vài cm như đầu người thật:
 *   - quay đầu: mắt nằm trước–trên khớp cổ nên xoay đầu là mắt dịch theo cung nhỏ (parallax tự nhiên khi nhìn quanh)
 *   - nghiêng máy: mắt đi vòng quanh quả bí (ox, oy) để thấy bí và lòng bí lệch đúng phối cảnh
 * Shader dựng lại ảnh bằng độ sâu (bg_depth): điểm màn hình → tia từ mắt → điểm thế giới → ảnh camera gốc / panorama.
 * Quả bí dùng ellipsoid giải tích làm độ sâu. Không dịch mắt thì đúng bằng homography của camera gốc.
 */
export type ViewState = { yaw: number; pitch: number; zoom: number; ox?: number; oy?: number };
/** Trục camera xem trong hệ thế giới (x phải, y lên, z ngược hướng nhìn), tiêu cự (pt), vị trí mắt (m). */
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

// xoay vector v quanh trục đơn vị k một góc a (Rodrigues)
const rot = (v: number[], k: number[], a: number) => {
  "worklet";
  const c = Math.cos(a), s = Math.sin(a), kd = dot(k, v) * (1 - c);
  return [
    v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * kd,
    v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * kd,
    v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * kd,
  ];
};

/** yaw dương = nhìn sang phải (xoay quanh trục đứng thế giới), pitch dương = ngước lên (quanh trục ngang camera). */
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

/** Điểm màn hình (pt) → điểm trên ảnh camera gốc (pt); null nếu ở sau camera gốc. */
export const screenToBase = (b: Basis, x: number, y: number): [number, number] | null => {
  "worklet";
  const sx = (x - CX) / b.f, sy = -(y - CY) / b.f;
  const d = [b.x[0] * sx + b.y[0] * sy - b.z[0], b.x[1] * sx + b.y[1] * sy - b.z[1], b.x[2] * sx + b.y[2] * sy - b.z[2]];
  const cz = dot(Z0, d);
  if (cz >= -1e-4) return null;
  return [CX + (F0 * dot(X0, d)) / -cz, CY - (F0 * dot(Y0, d)) / -cz];
};

/** Điểm trên ảnh camera gốc (pt) → điểm màn hình (pt) của camera xem. */
export const baseToScreen = (b: Basis, x: number, y: number): [number, number] => {
  "worklet";
  const sx = (x - CX) / F0, sy = -(y - CY) / F0;
  const d = [X0[0] * sx + Y0[0] * sy - Z0[0], X0[1] * sx + Y0[1] * sy - Z0[1], X0[2] * sx + Y0[2] * sy - Z0[2]];
  const cz = Math.min(dot(b.z, d), -1e-4);
  return [CX + (b.f * dot(b.x, d)) / -cz, CY - (b.f * dot(b.y, d)) / -cz];
};

/** Điểm thế giới (m) → ảnh camera gốc (pt). */
export const projectBase = (p: number[]) => {
  "worklet";
  const d = [p[0] - CAM.pos[0], p[1] - CAM.pos[1], p[2] - CAM.pos[2]];
  const cz = dot(Z0, d);
  return [CX + (F0 * dot(X0, d)) / -cz, CY - (F0 * dot(Y0, d)) / -cz] as const;
};

/** Đáy (điểm chạm thềm) và tâm quả bí trên ảnh camera gốc: tâm xoay/nén khi bí nhảy. */
export const PUMPKIN_FOOT = projectBase([PUMPKIN.c[0], PUMPKIN.c[1] - PUMPKIN.r[1] * 0.35, 0]);
export const PUMPKIN_MID = projectBase(PUMPKIN.c);
/** Bề ngang quả bí trên ảnh gốc (pt), ~ 0.94 cạnh crop. */
export const PUMPKIN_W = CROP.s * 0.94;

/** Điểm thế giới (m) → màn hình (pt) của camera xem; z = độ sâu (m) theo hướng nhìn, ≤ 0 nếu ở sau camera. */
export const worldToScreen = (b: Basis, p: number[]): [number, number, number] => {
  "worklet";
  const d = [p[0] - b.e[0], p[1] - b.e[1], p[2] - b.e[2]];
  const z = -dot(b.z, d);
  const zz = Math.max(z, 1e-3);
  return [CX + (b.f * dot(b.x, d)) / zz, CY - (b.f * dot(b.y, d)) / zz, z];
};

const PC = PUMPKIN.c, PR = PUMPKIN.r;
/**
 * Tia từ o theo hướng d chạm ellipsoid quả bí (mặt trước). Trượt ngoài thì lấy điểm gần tâm nhất theo metric ellipsoid
 * (đúng bằng điểm tiếp xúc ở viền nên liên tục): vùng cuống / viền vẫn có độ sâu hợp lý.
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

/** Điểm màn hình → điểm trên ảnh gốc của quả bí (đứng yên) dưới ngón tay, có tính dịch mắt. */
export const screenToPumpkin = (b: Basis, x: number, y: number): [number, number] => {
  "worklet";
  const sx = (x - CX) / b.f, sy = -(y - CY) / b.f;
  const d = [b.x[0] * sx + b.y[0] * sy - b.z[0], b.x[1] * sx + b.y[1] * sy - b.z[1], b.x[2] * sx + b.y[2] * sy - b.z[2]];
  const p = projectBase(pumpkinHit(b.e, d));
  return [p[0], p[1]];
};

/** Điểm trên quả bí (pt ảnh gốc) → màn hình của camera xem (đúng parallax khi mắt dịch). */
export const pumpkinToScreen = (b: Basis, px: number, py: number): [number, number] => {
  "worklet";
  const sx = (px - CX) / F0, sy = -(py - CY) / F0;
  const d = [X0[0] * sx + Y0[0] * sy - Z0[0], X0[1] * sx + Y0[1] * sy - Z0[1], X0[2] * sx + Y0[2] * sy - Z0[2]];
  const s = worldToScreen(b, pumpkinHit(CAM.pos, d));
  return [s[0], s[1]];
};

/**
 * Biến đổi affine xấp xỉ quanh một điểm trên quả bí (lớp vẽ đè: vệt dao, mảnh vỏ, vụn): screen ≈ S + k·(p − P).
 */
export const localAffine = (b: Basis, px: number, py: number) => {
  "worklet";
  const [sx, sy] = pumpkinToScreen(b, px, py);
  const [ax, ay] = pumpkinToScreen(b, px + 10, py);
  const k = Math.hypot(ax - sx, ay - sy) / 10;
  return { sx, sy, k };
};

/** Như localAffine nhưng cho một điểm thế giới bất kỳ (vd. đáy quả bí trên thềm). */
export const worldAffine = (b: Basis, p: number[]) => {
  "worklet";
  const [sx, sy, z] = worldToScreen(b, p);
  const d = [p[0] - CAM.pos[0], p[1] - CAM.pos[1], p[2] - CAM.pos[2]];
  const z0 = -dot(Z0, d);
  return { sx, sy, k: b.f / Math.max(z, 1e-3) / (F0 / z0) };
};

/** Đáy quả bí trên thềm (m). */
export const PUMPKIN_FOOT_W = [PC[0], PC[1] - PR[1] * 0.35, 0];
