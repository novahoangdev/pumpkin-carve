/**
 * Giông: thời điểm sét đánh, độ sáng loé (nhiều nhịp như sét thật) và hình tia sét trên nền trời.
 * Toạ độ tia sét: (phương vị, cao độ) theo rad trong hệ thế giới — az = atan2(x, y), el = asin(z) của hướng nhìn.
 * synth_audio.py đọc STRIKES để đặt tiếng sấm (trễ theo khoảng cách `dist` (m), tốc độ âm 343 m/s).
 */
export const STRIKES = [
  { t: 9.95, az: -0.55, el: 0.62, dist: 700 }, // demo: đang nhìn sang trái (sân, trời)
  { t: 22.35, az: -0.24, el: 0.46, dist: 1100 }, // demo: lúc nghiêng máy, trước khi dơi ra
];
/** Tia sét: kênh chính BOLT_MAIN điểm + BOLT_BR nhánh × BOLT_BRN điểm; 2 phần tử đầu là khung bao (az, el) min / max. */
export const BOLT_MAIN = 33;
export const BOLT_BR = 3;
export const BOLT_BRN = 9;
export const BOLT_N = 2 + BOLT_MAIN + BOLT_BR * BOLT_BRN;

const hash = (n: number) => {
  "worklet";
  const s = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return s - Math.floor(s);
};

/** Độ sáng loé của một cú sét theo thời gian kể từ lúc đánh (s): 3 nhịp chớp rồi tắt dần. */
export const flashCurve = (u: number) => {
  "worklet";
  if (u < 0 || u > 1.2) return 0;
  const pulse = (c: number, w: number, a: number) => a * Math.exp(-((u - c) * (u - c)) / (w * w));
  return Math.min(1, pulse(0.02, 0.025, 1) + pulse(0.13, 0.03, 0.75) + pulse(0.3, 0.05, 0.45) + 0.15 * Math.exp(-u / 0.35));
};

/** Cú sét đang hiện (demo: theo STRIKES; tương tác: 15–28 s một lần, vị trí ngẫu nhiên trên nền trời bên trái). */
export const currentStrike = (t: number, demo: boolean) => {
  "worklet";
  if (demo) {
    for (let i = 0; i < STRIKES.length; i++) {
      const s = STRIKES[i];
      if (t >= s.t && t < s.t + 1.2) return { u: t - s.t, az: s.az, el: s.el, seed: i + 1 };
    }
    return null;
  }
  let at = 6;
  for (let i = 0; i < 400; i++) {
    const next = at + 15 + hash(i) * 13;
    if (t < at) return null;
    if (t < at + 1.2) return { u: t - at, az: -0.95 + hash(i + 50) * 0.7, el: 0.45 + hash(i + 90) * 0.2, seed: i + 1 };
    at = next;
  }
  return null;
};

/**
 * Đường tia sét trong (phương vị, cao độ), mỗi điểm [az, el, w] với w = độ sáng đoạn từ điểm này tới điểm sau (0 = ngắt nét).
 * Kênh chính từ mây xuống chân trời dựng bằng midpoint displacement (gấp khúc fractal: khúc lớn gãy mạnh, khúc nhỏ lăn tăn như
 * sét thật), 3 nhánh phụ tách ra ở nửa trên, chĩa xuống chéo ra ngoài, mờ dần về đầu nhánh. 2 phần tử đầu: khung bao.
 */
export const boltPoints = (az: number, el: number, seed: number) => {
  "worklet";
  const fractal = (n: number, ax: number, ay: number, bx: number, by: number, rough: number, s: number) => {
    const xs = new Array(n).fill(0), ys = new Array(n).fill(0);
    xs[0] = ax; ys[0] = ay; xs[n - 1] = bx; ys[n - 1] = by;
    let k = 0;
    for (let step = n - 1; step > 1; step = step / 2) {
      const h = step / 2;
      for (let i = h; i < n - 1; i += step) {
        const x0 = xs[i - h], y0 = ys[i - h], x1 = xs[i + h], y1 = ys[i + h];
        const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1e-6;
        const off = (hash(s * 13.7 + i * 1.91 + k * 7.3) - 0.5) * len * rough;
        xs[i] = (x0 + x1) / 2 - (dy / len) * off;
        ys[i] = (y0 + y1) / 2 + (dx / len) * off;
        k++;
      }
    }
    return [xs, ys];
  };
  const out: number[][] = [];
  const endAz = az + (hash(seed * 3.1) - 0.5) * 0.16;
  const [mx, my] = fractal(BOLT_MAIN, az, el, endAz, -0.004, 0.62, seed);
  for (let i = 0; i < BOLT_MAIN; i++) out.push([mx[i], my[i], i < BOLT_MAIN - 1 ? 1 : 0]);
  for (let b = 0; b < BOLT_BR; b++) {
    const at = 4 + Math.floor(hash(seed * 5.7 + b * 11.3) * 14);       // tách ở nửa trên kênh chính
    const side = (b % 2 === 0 ? 1 : -1) * (hash(seed + b * 2.9) < 0.75 ? 1 : -1);
    const L = 0.09 + hash(seed * 2.3 + b) * 0.1;
    const ang = 0.5 + hash(seed * 7.1 + b * 3.3) * 0.5;                   // lệch khỏi phương thẳng đứng (rad)
    const ex = mx[at] + side * Math.sin(ang) * L, ey = Math.max(0.005, my[at] - Math.cos(ang) * L);
    const [bx, by] = fractal(BOLT_BRN, mx[at], my[at], ex, ey, 0.7, seed * 17 + b);
    for (let i = 0; i < BOLT_BRN; i++) out.push([bx[i], by[i], i < BOLT_BRN - 1 ? 0.7 * (1 - i / (BOLT_BRN - 1)) + 0.15 : 0]);
  }
  let x0 = 1e3, y0 = 1e3, x1 = -1e3, y1 = -1e3;
  for (const p of out) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return [[x0, y0, 0], [x1, y1, 0], ...out];
};
