import { CENTER, FLAME, VIEW } from "../scene/layout";
import type { Pts } from "../carve/stroke";

/**
 * Stencil: các nét khắc dựng sẵn, toạ độ tương đối tâm quả bí (pt, thiết kế cho khung 402 pt; nhân K theo khung thật).
 * Mỗi nét là một đường viền khép kín mà "ngón tay" đi theo, dùng cho chế độ demo và nút stencil.
 */
/** Tỉ lệ khung thật so với khung thiết kế stencil (402 pt, 17 Pro): 17 Pro Max = 440/402. */
export const K = VIEW.w / 402;
type Shape = number[][];

const mirror = (s: Shape): Shape => s.map(([x, y]) => [-x, y]).reverse();

// đường viền miệng cười: mép trên cong, có răng nhô xuống; mép dưới cong sâu, có một răng nhô lên
const grin = (w: number, top: number, bot: number, teeth: number[], botTooth = true): Shape => {
  const pts: Shape = [];
  const N = 22;
  const yTop = (x: number) => top + (1 - (x / w) ** 2) * 9 - (x / w) ** 2 * 6;
  for (let i = 0; i <= N; i++) {
    const x = -w + (2 * w * i) / N;
    let y = yTop(x);
    for (const tx of teeth) if (Math.abs(x - tx) < 7) y += 9;
    pts.push([x, y]);
  }
  for (let i = N; i >= 0; i--) {
    const x = -w + (2 * w * i) / N;
    let y = bot - (x / w) ** 2 * (bot - top - 2);
    if (botTooth && Math.abs(x) < 7) y -= 9;
    pts.push([x, y]);
  }
  return pts;
};

const leftEye: Shape = [[-56, -14], [-19, -14], [-34, -47]];
export const STENCILS: Record<string, Shape[]> = {
  classic: [leftEye, mirror(leftEye), [[-9, 8], [9, 8], [0, -8]], grin(60, 16, 50, [-21, 21])],
  spooky: [
    [[-58, -36], [-18, -20], [-26, -6], [-52, -10]],
    [[58, -36], [52, -10], [26, -6], [18, -20]],
    [[-8, 6], [8, 6], [0, -10]],
    grin(64, 16, 54, [-34, -12, 12, 34], false),
  ],
  cat: [
    [[-50, -22], [-36, -40], [-20, -22], [-36, -12]],
    [[50, -22], [36, -12], [20, -22], [36, -40]],
    [[-7, 2], [7, 2], [0, 10]],
    [[-36, 22], [-18, 30], [0, 22], [18, 30], [36, 22], [18, 40], [0, 32], [-18, 40]],
  ],
};

/** Một đường viền → chuỗi điểm dày đặc (bước ~4pt), quay về đúng điểm đầu. */
export const densify = (shape: Shape, step = 4): Pts => {
  const out: Pts = [];
  const pts = [...shape, shape[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push(CENTER.x + (ax + ((bx - ax) * k) / n) * K, CENTER.y + (ay + ((by - ay) * k) / n) * K);
  }
  out.push(CENTER.x + pts[0][0] * K, CENTER.y + pts[0][1] * K);
  return out;
};

// EXPO_PUBLIC_STENCIL=spooky|cat: quay demo với stencil khác (mặc định classic)
const DEMO_FACE = STENCILS[process.env.EXPO_PUBLIC_STENCIL ?? "classic"] ?? STENCILS.classic;

/**
 * Kịch bản demo (giây tính từ lúc app mở): zoom từ xa vào quả bí → khắc mắt, mũi, miệng → nhìn quanh hiên →
 * chạm cho bí nhảy, chạm dồn để bí bay vào Dynamic Island rồi rơi lại → kéo que diêm → nghiêng máy → dơi.
 */
export const DEMO = {
  strokes: [
    { at: 3.2, pts: densify(DEMO_FACE[0]), speed: K * 150 },
    { at: 4.2, pts: densify(DEMO_FACE[1]), speed: K * 150 },
    { at: 5.2, pts: densify(DEMO_FACE[2]), speed: K * 110 },
    { at: 5.9, pts: densify(DEMO_FACE[3]), speed: K * 260 },
  ],
  // nhìn quanh: ngón tay kéo nền (yaw dương = nhìn sang phải)
  look: [
    { t: 7.5, yaw: 0, pitch: 0 },
    { t: 8.4, yaw: 0.62, pitch: 0.16 },
    { t: 8.9, yaw: 0.62, pitch: 0.16 },
    { t: 10.0, yaw: -0.66, pitch: 0.3 },
    { t: 10.4, yaw: -0.66, pitch: 0.3 },
    { t: 11.1, yaw: 0, pitch: 0 },
  ],
  // 2 cú nhảy đơn, rồi chạm dồn (cú thứ 5 đưa bí vào Dynamic Island, bí tiếp đất lại ≈ 16.6, đứng yên ≈ 18.4)
  taps: [11.4, 12.05, 12.7, 13.15, 13.35, 13.55, 13.75],
  matchAt: 18.6, // bắt đầu kéo que diêm
  matchDur: 1.1,
  bats: 24.9,
  matchTarget: { x: FLAME.x + 6, y: FLAME.y + 16 },
};

/**
 * Khung nghỉ (sau intro): mắt hạ ~8 cm cho góc thấp ngang tầm bí → bí to ~55 % bề ngang, giữa khung, ở ~58 % chiều cao;
 * trăng và đèn hiên vẫn ở nửa trên, bớt sàn trống phía trước.
 */
export const REST = { yaw: -0.01, pitch: 0, zoom: 0.95, oy: -0.08 };

/**
 * Intro 0–3 s (cả app thật lẫn demo; synth_audio.py đọc các mốc này):
 *   0–0.45 tối gần đen, ngước nhìn trăng sau mây · 0.45 sét mở màn 2 nhịp (sáng 70 ms, tối 110 ms, sáng 50 ms), chữ tiêu đề
 *   loé rồi nguội cam · 0.6–2.3 cẩu máy từ trăng xuống (pitch về khung nghỉ, yaw quay về bí, zoom 1.4 → 0.85 → 1.12, mắt hạ dần)
 *   · ≈1.4 đèn hiên chập chờn 2 lần · ≈1.6 gió cuốn lá · 2.3–2.9 dừng bằng spring hơi quá đà, bí khẽ lắc.
 */
export const INTRO = {
  start: { yaw: -0.29, pitch: 0.44, zoom: 1.32, oy: 0.12 }, // lệch so với REST (zoom: nhân)
  flash: [0.45, 0.52, 0.63, 0.68], // sáng [0.45, 0.52), tối, sáng [0.63, 0.68)
  crane: [0.6, 2.3],
  zoomMid: { t: 1.45, zoom: 0.85 },
  zoomEnd: 1.12,
  flicker: [[1.38, 1.43], [1.5, 1.56]], // đèn hiên tắt chớp
  gust: 1.6,
  settle: 2.3, // spring về khung nghỉ, bí lắc
  bolt: { az: -0.47, el: 0.84 },
};

const smooth3 = (u: number) => {
  "worklet";
  const x = Math.min(1, Math.max(0, u));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Độ lệch camera so với REST trong intro: [yaw, pitch, zoom nhân, oy]. */
export const introView = (t: number): [number, number, number, number] => {
  "worklet";
  const I = INTRO;
  const p = smooth3((t - I.crane[0]) / (I.crane[1] - I.crane[0]));
  // spring sau khi cẩu xong: vượt qua khung nghỉ một chút rồi đứng yên
  const s = t - I.settle;
  const over = s > 0 ? Math.exp(-s * 6) * Math.sin(s * 12) : 0;
  const k = 1 - p - 0.07 * over;
  let z: number;
  if (t < I.crane[0]) z = I.start.zoom;
  else if (t < I.zoomMid.t) z = I.start.zoom + (I.zoomMid.zoom - I.start.zoom) * smooth3((t - I.crane[0]) / (I.zoomMid.t - I.crane[0]));
  else if (t < I.settle) z = I.zoomMid.zoom + (I.zoomEnd - I.zoomMid.zoom) * smooth3((t - I.zoomMid.t) / (I.settle - I.zoomMid.t));
  else z = 1 + (I.zoomEnd - 1) * Math.exp(-s * 6) * Math.cos(s * 11);
  return [I.start.yaw * k, I.start.pitch * k, z, I.start.oy * k];
};

/** Độ loé sét mở màn (0..1). */
export const introStorm = (t: number) => {
  "worklet";
  const f = INTRO.flash;
  if (t < f[0]) return 0;
  if (t < f[1]) return 0.62;
  if (t < f[2]) return 0.08;
  if (t < f[3]) return 0.5;
  return 0.18 * Math.exp(-(t - f[3]) / 0.25);
};

/** Màn tối phủ trong intro (0..1). */
export const introDark = (t: number) => {
  "worklet";
  const f = INTRO.flash;
  if (t < f[0]) return 0.5; // trước cú chớp: trăng mờ sau mây (khung đầu clip = ảnh chờ trên X, không được đen)
  if (t < f[1]) return 0;
  if (t < f[2]) return 0.55;
  if (t < f[3]) return 0;
  return 0.4 * (1 - smooth3((t - f[3]) / 0.7));
};

/** Đèn hiên chập chờn lúc camera lướt qua (1 = sáng bình thường). */
export const introPorch = (t: number) => {
  "worklet";
  const [a, b] = INTRO.flicker;
  if (t >= a[0] && t < a[1]) return 0.18;
  if (t >= a[1] && t < b[0]) return 0.85;
  if (t >= b[0] && t < b[1]) return 0.32;
  return 1;
};

/** Bí khẽ lắc như vừa bị gió đẩy khi camera dừng: [xoay rad, nén]. */
export const introWobble = (t: number): [number, number] => {
  "worklet";
  const s = t - INTRO.settle - 0.05;
  if (s < 0 || s > 1.2) return [0, 0];
  const e = Math.exp(-s * 5);
  return [0.03 * e * Math.sin(s * 15), 0.025 * e * Math.sin(s * 15 + 0.6)];
};

/** yaw/pitch nhìn quanh theo kịch bản (nội suy mượt giữa các mốc). */
export const demoLook = (t: number): [number, number] => {
  "worklet";
  const k = DEMO.look;
  if (t <= k[0].t || t >= k[k.length - 1].t) return [0, 0];
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (t < b.t) {
      const u = (t - a.t) / (b.t - a.t);
      const e = u * u * (3 - 2 * u);
      return [a.yaw + (b.yaw - a.yaw) * e, a.pitch + (b.pitch - a.pitch) * e];
    }
  }
  return [0, 0];
};

/** Đường nghiêng giả lập (simulator không có gyro): lắc nhẹ lúc đầu, sau khi thắp lắc trái rồi phải. */
export const demoTilt = (t: number, litAt: number): [number, number] => {
  "worklet";
  const idle = [Math.sin(t * 0.9) * 0.18, Math.sin(t * 0.6 + 1) * 0.08] as [number, number];
  if (litAt < 0) return idle;
  const u = t - litAt - 1.2;
  if (u < 0) return idle;
  if (u > 3.6) return [idle[0] * Math.min(1, (u - 3.6) / 2), idle[1]];
  const e = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1));
  // 0 → -1 (1.1s) → +1 (1.6s) → 0 (0.9s)
  const x = u < 1.1 ? -e(u / 1.1) : u < 2.7 ? -1 + 2 * e((u - 1.1) / 1.6) : 1 - e((u - 2.7) / 0.9);
  return [x * 0.95, Math.sin(u * 1.7) * 0.35];
};
