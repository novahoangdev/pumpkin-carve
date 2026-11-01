import { FilterMode, MipmapMode, useColorBuffer, useRSXformBuffer, useRectBuffer } from "react-native-skia";
import type { SharedValue } from "react-native-reanimated";
import { CAM, PUMPKIN, VIEW } from "../scene/layout";
import { F0, pumpkinHit, viewBasis, type Basis } from "../scene/view";

/**
 * Tiện ích chung cho các hiệu ứng vẽ bằng Atlas (một draw call cho cả trăm sprite).
 *
 * Mỗi frame, một useDerivedValue tính ra mảng số phẳng, mỗi sprite STRIDE số:
 *   [scos, ssin, tx, ty,  rx, ry, rw, rh,  r, g, b, a]
 * (RSXform | ô sprite trong sheet (px) | màu nhân vào sprite, a = độ đục).
 * Ba buffer (transform / ô / màu) đọc lại mảng đó và sửa tại chỗ, khỏi cấp phát object Skia mỗi frame.
 * Khi không còn gì sống, derived trả về đúng một mảng rỗng dùng chung → Reanimated thấy giá trị không đổi,
 * không chạy lại buffer, không vẽ lại gì thêm.
 */
export const STRIDE = 12;
/**
 * Sprite "tắt": scale nhỏ nhưng KHẢ NGHỊCH, đặt ngoài màn hình. KHÔNG dùng RSXform (0, 0, 0, 0): Graphite in
 * "[skia] WARNING - Skipping draw with non-invertible/non-finite transform" ra stderr cho TỪNG sprite như vậy mỗi frame
 * (bản Release: ~32 000 dòng/giây, chiếm ~1/3 thời gian của mỗi luồng render → khựng).
 */
export const HIDDEN_XF = [1e-3, 0, -1e4, -1e4] as const;
export const NONE: number[] = [];

/** Lấy mẫu có mipmap: sprite thường được thu nhỏ 2–4 lần trên màn hình. */
export const SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.Linear };

/**
 * Đẩy một sprite vào `out`. Điểm neo (ax, ay) trong ô sprite (px) rơi đúng vào (cx, cy) trên canvas,
 * `s` = số pt cho mỗi px sprite, `rot` = góc xoay (rad).
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
    // scale 0 / NaN → ma trận không khả nghịch (xem HIDDEN_XF): đẩy sprite ẩn thay vì sprite suy biến
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

/** Chia lấy dư luôn dương. */
export const wrap = (v: number, n: number) => {
  "worklet";
  return ((v % n) + n) % n;
};

/** Ba buffer cố định `max` phần tử cho <Atlas>, nạp từ mảng phẳng `data` (sprite thừa: thu về 0, trong suốt). */
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

// ───────────────────────── 3D: hạt sống trong không gian cảnh (m), chiếu qua camera xem ─────────────────────────

/** Camera gốc (không xoay, không dịch mắt): dùng khi cảnh chưa truyền `basis` → chiếu ra đúng toạ độ ảnh gốc. */
export const BASE_BASIS: Basis = viewBasis({ yaw: 0, pitch: 0, zoom: 1 });

const X0 = CAM.rot[0], Y0 = CAM.rot[1], Z0 = CAM.rot[2];
const CX0 = VIEW.w / 2, CY0 = VIEW.h / 2; // tâm khung thiết kế (layout.json, 17 Pro Max 440×956)

/** Điểm trên quả bí (pt ảnh gốc) → điểm thế giới (m) trên mặt ellipsoid + pháp tuyến ngoài. */
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

/** Thế giới → màn hình camera xem (pt thiết kế). out = [x, y, độ sâu m, pt/m ở độ sâu đó]. */
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

/** Đoạn mắt → p có bị quả bí che không (giao ellipsoid hơi co lại một chút để hạt sát mặt vỏ không nhấp nháy). */
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
 * Vật rơi tự do có nảy trên mặt thềm (z = rad) rồi trượt có ma sát tới khi dừng — nghiệm giải tích, không cần trạng thái.
 * e: hệ số nảy, fr: mất vận tốc ngang mỗi lần nảy, mu: ma sát trượt.
 * out = [x, y, z, vx, vy, vz, tFirst (thời điểm chạm lần đầu, −1 nếu chưa), tSlide (bắt đầu trượt, −1), rest (0/1), số lần nảy]
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
  // trượt trên thềm, chậm dần đều tới khi dừng
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

/** Xoay vector v quanh trục đơn vị (ax, ay, az) góc a (Rodrigues), ghi vào out[o..o+2]. */
export const rotv = (vx: number, vy: number, vz: number, ax: number, ay: number, az: number, a: number, out: number[], o: number) => {
  "worklet";
  const c = Math.cos(a), s = Math.sin(a), kd = (ax * vx + ay * vy + az * vz) * (1 - c);
  out[o] = vx * c + (ay * vz - az * vy) * s + ax * kd;
  out[o + 1] = vy * c + (az * vx - ax * vz) * s + ay * kd;
  out[o + 2] = vz * c + (ax * vy - ay * vx) * s + az * kd;
};

/** Đèn hiên (m): treo trên khung cửa phía sau quả bí (ảnh gốc ~ (192, 166) pt), trên tường y ≈ 1.5 m. */
export const LANTERN_W = (() => {
  const sx = (191.9 - CX0) / F0, sy = -(165.76 - CY0) / F0;
  const d = [X0[0] * sx + Y0[0] * sy - Z0[0], X0[1] * sx + Y0[1] * sy - Z0[1], X0[2] * sx + Y0[2] * sy - Z0[2]];
  const t = (1.35 - CAM.pos[1]) / d[1];
  return [CAM.pos[0] + d[0] * t, CAM.pos[1] + d[1] * t, CAM.pos[2] + d[2] * t];
})();

/** Điểm ảnh gốc (pt) → điểm trên mặt thềm z = h (m) theo tia từ camera gốc. */
export const baseToFloor = (px: number, py: number, h = 0) => {
  const sx = (px - CX0) / F0, sy = -(py - CY0) / F0;
  const d = [X0[0] * sx + Y0[0] * sy - Z0[0], X0[1] * sx + Y0[1] * sy - Z0[1], X0[2] * sx + Y0[2] * sy - Z0[2]];
  const t = (h - CAM.pos[2]) / d[2];
  return [CAM.pos[0] + d[0] * t, CAM.pos[1] + d[1] * t, h];
};

/** Điểm màn hình camera xem (pt) → điểm trên mặt quả bí (m) theo tia từ mắt (trượt ngoài thì lấy điểm gần nhất). */
export const screenToPumpkinWorld = (b: Basis, x: number, y: number) => {
  "worklet";
  const sx = (x - CX0) / b.f, sy = -(y - CY0) / b.f;
  const d = [b.x[0] * sx + b.y[0] * sy - b.z[0], b.x[1] * sx + b.y[1] * sy - b.z[1], b.x[2] * sx + b.y[2] * sy - b.z[2]];
  return pumpkinHit(b.e, d);
};
