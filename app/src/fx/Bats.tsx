import React, { useMemo } from "react";
import { Atlas, Group, Skia, matchFont, useColorBuffer, useRSXformBuffer, useRectBuffer } from "react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { PUMPKIN, VIEW } from "../scene/layout";
import { viewBasis, type Basis } from "../scene/view";
import { REST } from "../demo/script";
import { HIDDEN_XF, SAMPLING, proj, smoothstep, wrap } from "./pfx_atlas";
import { useGpuImage } from "../perf/gpu";

/** Số dơi (= số điểm đích của chữ). synth_audio.py đọc hằng số này. */
export const BAT_COUNT = 720;
/** Toàn bộ màn dơi: ùa ra → xếp chữ → giữ → tan ra lướt qua ống kính (s, tính từ lúc dơi ra). */
export const BAT_DURATION = 5.8;

/** Mốc (s, tính từ lúc dơi ra) — ghi trong notes/fx.md cho agent chính / synth_audio. */
export const BAT_TIMES = { emergeEnd: 1.25, formed: 3.0, holdEnd: 4.2, gone: 5.8 };

// [text, font size (pt), line centre (fraction of the view height), bats, max width (fraction of the view width),
//  max letter height (pt)]
// Heavy font: the letters are FILLED with bats (dense dark silhouettes), not dotted outlines.
// Two lines only (the end card carries the handle); both sit inside the sky gap of the BAT_SKY view: below the porch
// ceiling edge (≈250 pt on the left), above the neighbour's roof (≈430 pt), the moon between them on the right.
const LINES: [string, number, number, number, number, number][] = [
  ["HAPPY", 92, 0.31, 265, 0.54, 63],
  ["HALLOWEEN", 80, 0.403, 455, 0.684, 56],
];
const TEXT_DEPTH = 2.1; // m from the eye: the text hangs over the rail, in front of the sky
const TEXT_CX = 0.405; // centre of the sky gap (left frame edge → porch post at ~356 pt)
const TRACKING = 0.1; // extra letter spacing (× font size) // text centre (fraction of the view width): the sky gap ends at the porch post on the right

/**
 * Sky view for the text (demo): the camera looks up-left at the moonlit sky over the yard, so the black bats stand out
 * against a bright background. The text is laid out in THIS view (offset from REST), anchored in the world; the main
 * agent adds `batLook(t − batsAt)` to the demo camera so that the view is exactly this one while the text holds.
 */
export const BAT_SKY = { yaw: -0.36, pitch: 0.24 };
const SKY_BASIS = viewBasis({ yaw: REST.yaw + BAT_SKY.yaw, pitch: REST.pitch + BAT_SKY.pitch, zoom: REST.zoom, oy: REST.oy });
const easeIO = (x: number) => {
  "worklet";
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
/** Camera offset [yaw, pitch] during the bat finale (tb = seconds since the bats came out): pan up-left to the sky while
 * the bats fly up (0.5–2.4), hold through the text and the dispersal, come back after (5.7–7.0). */
export const batLook = (tb: number): [number, number] => {
  "worklet";
  if (tb < 0.5 || tb > 7.0) return [0, 0];
  const k = tb < 2.4 ? easeIO((tb - 0.5) / 1.9) : tb < 5.7 ? 1 : 1 - easeIO((tb - 5.7) / 1.3);
  return [BAT_SKY.yaw * k, BAT_SKY.pitch * k];
};

const hash = (n: number) => {
  "worklet";
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const CANDLE = [PUMPKIN.c[0], PUMPKIN.c[1], PUMPKIN.c[2] - 0.05];

// ── sprite sheet Blender: blender/fx/bat_sheet.py → assets/fx/pfx_bat.png (xem notes/fx.md) ──
const SHEET = require("../../assets/fx/pfx_bat.png");
const CELL = 128;
const ORTHO = 0.36;
const PHASES = 8;
const ELS = [-50, 0, 50].map((d) => (d * Math.PI) / 180);
const CELL_UP: number[] = [];
for (let az = 0; az < 8; az++) {
  for (let el = 0; el < 3; el++) {
    const a = (az * Math.PI) / 4, e = ELS[el];
    const d = [Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)];
    const up = [-d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2]];
    const l = Math.hypot(up[0], up[1], up[2]);
    CELL_UP.push(up[0] / l, up[1] / l, up[2] / l);
  }
}

/**
 * Điểm đích: lấy mẫu vùng tô của text path Skia (Skia.Path.MakeFromText) trên lưới mịn có jitter rồi chọn đều bằng
 * farthest-point sampling → N điểm phủ đều nét chữ. Toạ độ màn hình khung nghỉ → chiếu ra mặt phẳng cách camera gốc
 * TEXT_DEPTH (m) theo camera lúc dơi ra. Trả về [x, y (pt quanh tâm khung, y lên), khoảng cách (pt), dòng, r1..r5, thứ tự ra] × BAT_COUNT. Chạy MỘT lần lúc mount (JS thread).
 */
const buildTargets = (): number[] => {
  const out: number[] = [];
  const line = (text: string, size: number, cy: number, n: number, lineIdx: number, wFrac: number, hMax: number) => {
    let font;
    try {
      // heavy font: thick strokes → bats fill the letters as solid dark shapes (readable from far)
      // condensed heavy: thick strokes AND tall letters for the width we have (the sky gap ends at the porch post)
      font = matchFont({ fontFamily: "Avenir Next Condensed", fontSize: size, fontWeight: lineIdx === 0 ? "800" : "700" });
    } catch {
      font = matchFont({ fontSize: size });
    }
    // letter by letter with extra tracking (the bats' spread wings smear sideways; a gap keeps the letters apart).
    // Not with space characters: Avenir has no hair/thin space glyph and draws a filled "missing" box instead.
    const pb = Skia.PathBuilder.Make();
    let pen = 0;
    for (const ch of text) {
      const g = Skia.Path.MakeFromText(ch, pen, 0, font);
      if (g) pb.addPath(g);
      pen += font.measureText(ch).width + size * TRACKING;
    }
    const path = pb.detach();
    const pts: number[] = [];
    let step = size / 40;
    let inside = (_x: number, _y: number) => true;
    if (!path.isEmpty()) {
      const bb = path.computeTightBounds();
      const sc = Math.min((VIEW.w * wFrac) / bb.width, hMax / bb.height);
      step = (size * sc) / 40;
      const ox = VIEW.w * TEXT_CX - (bb.x + bb.width / 2) * sc;
      const oy = VIEW.h * cy - (bb.y + bb.height / 2) * sc;
      inside = (X: number, Y: number) => path.contains((X - ox) / sc, (Y - oy) / sc);
      for (let y = bb.y; y <= bb.y + bb.height; y += step / sc) {
        for (let x = bb.x; x <= bb.x + bb.width; x += step / sc) {
          const jx = x + (hash(x * 3.7 + y) - 0.5) * (step / sc) * 0.6;
          const jy = y + (hash(y * 5.1 + x) - 0.5) * (step / sc) * 0.6;
          if (path.contains(jx, jy)) pts.push(ox + jx * sc, oy + jy * sc);
        }
      }
    }
    if (pts.length < 2) {
      // không có font: một vòng elip dự phòng
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push(VIEW.w / 2 + Math.cos(a) * 150, VIEW.h * cy + Math.sin(a) * 40);
      }
    }
    // farthest-point sampling: n điểm phủ đều
    const m = pts.length / 2;
    const dist = new Float64Array(m).fill(1e18);
    const pick: number[] = [];
    let cur = 0;
    for (let k = 0; k < n; k++) {
      pick.push(cur % m);
      const cx = pts[(cur % m) * 2], cyy = pts[(cur % m) * 2 + 1];
      let best = -1, bi = 0;
      for (let j = 0; j < m; j++) {
        const d = (pts[j * 2] - cx) ** 2 + (pts[j * 2 + 1] - cyy) ** 2;
        if (d < dist[j]) dist[j] = d;
        if (dist[j] > best) {
          best = dist[j];
          bi = j;
        }
      }
      cur = bi;
    }
    // khoảng cách giữa các con (pt) → cỡ dơi: sải cánh ≈ 1,7 × khoảng cách
    // khoảng cách trung bình tới con gần nhất (pt) → cỡ dơi
    let gsum = 0;
    for (let a = 0; a < n; a++) {
      let best = 1e18;
      for (let c = 0; c < n; c++) {
        if (c === a) continue;
        const d = (pts[pick[a] * 2] - pts[pick[c] * 2]) ** 2 + (pts[pick[a] * 2 + 1] - pts[pick[c] * 2 + 1]) ** 2;
        if (d < best) best = d;
      }
      gsum += Math.sqrt(best);
    }
    const gap = gsum / n;
    for (let k = 0; k < n; k++) {
      const i = out.length / TS;
      const X = pts[pick[k] * 2], Y = pts[pick[k] * 2 + 1];
      const r1 = hash(i), r2 = hash(i + 17.3), r3 = hash(i + 41.9), r4 = hash(i + 73.1), r5 = hash(i + 5.7);
      const order = Math.min(1, Math.max(0, X / VIEW.w) * 0.7 + r1 * 0.3);
      // edge bats: outside just above → top edge (moon rim), outside left/right → side edge (fainter); interior: none
      const d = gap * 1.1;
      const edge = !inside(X, Y - d) ? 1 : !inside(X - d, Y - d * 0.5) || !inside(X + d, Y - d * 0.5) ? 0.4 : 0;
      out.push(X - VIEW.w / 2, -(Y - VIEW.h / 2), gap, lineIdx, r1, r2, r3, r4, r5, order, edge);
    }
  };
  LINES.forEach(([text, size, cy, n, wf, hm], li) => line(text, size, cy, n, li, wf, hm));
  return out;
};

// trạng thái mỗi con, ghi tại chỗ trong một mảng sống trên UI runtime (không tạo object mỗi frame)
const TS = 11; // per bat in the target array: x, y, gap, line, r1..r5, order, edge
const ST = 16; // [x, y, s, rot, cellX, cellY, aA, trailX, trailY, trailA, rimR, rimG, rimB, rimA, formed, _]
type Store = { __fxBats?: Float64Array; __fxBatsP?: number[]; __fxB0?: Float64Array; __fxB0t?: number; __fxB1?: Float64Array };
const getStore = () => {
  "worklet";
  const g = globalThis as unknown as Store;
  if (!g.__fxBats) {
    g.__fxBats = new Float64Array(BAT_COUNT * ST);
    g.__fxBatsP = [0, 0, 0, 0, 0, 0, 0, 0];
    g.__fxB0 = new Float64Array(13);
    g.__fxB0t = -1;
  }
  // live camera when the bats start (eye + axes): the lens-skimming bats aim at it
  if (!g.__fxB1) g.__fxB1 = new Float64Array(12);
  return g;
};

/**
 * Màn dơi cuối clip, toàn bộ trong KHÔNG GIAN CẢNH (m), chiếu qua camera xem:
 * 1. BAY TỚI (0–≈2 s): đàn dơi bay tới từ sân tối sau lan can / bầu trời xa, sà qua hiên về phía ống kính (vài con
 *    lướt sát ống kính), vòng lên rồi mới rẽ vào chữ. Không có gì phát ra từ quả bí.
 * 2. XẾP CHỮ (→ 3,0 s): mỗi con lái về điểm đích của nó trong chữ "HAPPY / HALLOWEEN" / "@novahoangdev" (3 dòng, dòng dưới nhỏ) (lấy mẫu từ text path
 *    Skia, mặt phẳng cách camera 2,1 m) bằng lò xo tắt dần tới hạn — steering mượt, nghiệm giải tích từ vị trí + vận tốc lúc rẽ,
 *    kèm lượn lờ nhẹ riêng từng con. Đến nơi thì ngóc lên quay về camera, cánh dang.
 * 3. GIỮ (3,0–4,2 s): vẫn vỗ cánh nhẹ (chậm lại) + chao nhẹ; viền trăng lạnh (pass A) + ánh cam hắt từ quả bí (pass B) → chữ đọc
 *    được cả trên nền trời lẫn tường tối.
 * 4. TAN RA (4,2–5,8 s): toả từ giữa chữ ra hai bên (trễ theo khoảng cách tới tâm), lao thẳng về phía ống kính, phóng to, nhoè
 *    chuyển động và lướt qua mặt phẳng ống kính.
 * Hình: sprite Blender 24 hướng nhìn × 8 pha vỗ có motion blur cánh.
 *
 * Hiệu năng: 1 mapper tính 600 con / frame, ghi vào Float64Array dùng chung trên UI runtime; 3 Atlas đọc lại tại chỗ. Không cấp
 * phát object / mảng mỗi frame.
 */
export function Bats({
  t0,
  time,
  basis,
  sky = false,
}: {
  t0: SharedValue<number>;
  time: SharedValue<number>;
  basis: SharedValue<Basis>;
  /** Lay the text out in the sky view (BAT_SKY): pass true when the camera follows `batLook` (demo). */
  sky?: boolean;
}) {
  const sheet = useGpuImage(SHEET, { mipmapped: true });
  const T = useMemo(() => buildTargets(), []);

  const tick = useDerivedValue(() => {
    const start = t0.value;
    const now = time.value;
    const t = now - start;
    const g = getStore();
    const S = g.__fxBats!;
    const P = g.__fxBatsP!;
    if (start < 0 || t < 0 || t > BAT_DURATION + 0.2) {
      for (let i = 0; i < BAT_COUNT; i++) {
        S[i * ST + 6] = 0;
        S[i * ST + 9] = 0;
        S[i * ST + 13] = 0;
      }
      return -1;
    }
    const b = basis.value;
    // text frame: the sky view (demo) or the camera at the moment the bats come out; fixed in the world after that
    const B0 = g.__fxB0!;
    if (g.__fxB0t !== start) {
      g.__fxB0t = start;
      const bb = sky ? SKY_BASIS : b;
      for (let j = 0; j < 3; j++) {
        B0[j] = bb.e[j];
        B0[3 + j] = bb.x[j];
        B0[6 + j] = bb.y[j];
        B0[9 + j] = bb.z[j];
      }
      B0[12] = bb.f;
      const B1 = g.__fxB1!;
      for (let j = 0; j < 3; j++) {
        B1[j] = b.e[j];
        B1[3 + j] = b.x[j];
        B1[6 + j] = b.y[j];
        B1[9 + j] = b.z[j];
      }
    }
    const B1 = g.__fxB1!;
    const kSpan = (1.6 * TEXT_DEPTH) / B0[12] / 0.3;
    for (let i = 0; i < BAT_COUNT; i++) {
      const o = i * ST;
      S[o + 6] = 0;
      S[o + 9] = 0;
      S[o + 13] = 0;
      const q0 = i * TS;
      const r1 = T[q0 + 4], r2 = T[q0 + 5], r3 = T[q0 + 6], r4 = T[q0 + 7], r5 = T[q0 + 8];
      // đích (m): tia của camera lúc dơi ra qua điểm chữ, cách mắt TEXT_DEPTH
      const sx = T[q0] / B0[12], sy = T[q0 + 1] / B0[12];
      const tx = B0[0] + (B0[3] * sx + B0[6] * sy - B0[9]) * TEXT_DEPTH;
      const ty = B0[1] + (B0[4] * sx + B0[7] * sy - B0[10]) * TEXT_DEPTH;
      const tz = B0[2] + (B0[5] * sx + B0[8] * sy - B0[11]) * TEXT_DEPTH;
      const kT = T[q0 + 2] * kSpan * 1.55; // bats overlap in the text → solid letters
      // FEEDBACK-2300 #5: nothing comes out of the pumpkin. The flock arrives from OUTSIDE — the dark yard beyond the
      // rail (most) or the far sky (a quarter) — sweeps in over the porch toward the camera (a few skim the lens), curls
      // back up and only then steers into its letter. Path: quadratic Bézier spawn → swoop point (passed at u = ½) →
      // hand-off point, then the critically damped spring below takes over with the Bézier's end velocity.
      const delay = 0.55 * T[q0 + 9]; // arrival order: left part of the text first, with a little shuffle
      const tt = t - delay;
      if (tt <= 0) continue;
      const r6 = hash(i * 1.31 + 9.7), r7 = hash(i * 2.17 + 3.3), r8 = hash(i * 0.73 + 21.1);
      const skim = r6 < 0.035; // ≈25 bats whoosh right past the lens
      const fromSky = !skim && r6 > 0.75;
      // spawn (m; world: x right, y away from the camera into the yard, z up). Rail / open yard: x < −0.3, y > 1.55.
      const p0x = fromSky ? -5 + 5 * r2 : -4.6 + 4 * r2;
      const p0y = fromSky ? 8 + 6 * r3 : 3.6 + 2.8 * r3;
      const p0z = fromSky ? 3.4 + 2.4 * r5 : 0.7 + 1.5 * r5;
      // swoop point over the porch (above the pumpkin's top, never at its face)
      // (the Bézier overshoots the swoop point toward the camera by ≈0.5 m from the yard, ≈1.3 m from the sky, and dips
      // ≈0.3 m lower from the sky: offsets below keep them ≥0.35 m from the lens and well above the pumpkin's top)
      let mx = -1.3 + 2.5 * r4, my = fromSky ? 1.0 + 1.0 * r7 : 0.25 + 1.0 * r7, mz = fromSky ? 0.95 + 0.8 * r8 : 0.5 + 0.85 * r8;
      if (skim) {
        // 0.2–0.26 m in front of the lens, 7–13 cm to the side: fills the frame for a few frames
        const side = (r7 < 0.5 ? -1 : 1) * (0.07 + 0.06 * r8);
        const fwd = 0.2 + 0.06 * r4, up = -0.03 + 0.09 * r3;
        mx = B1[0] + B1[3] * side + B1[6] * up - B1[9] * fwd;
        my = B1[1] + B1[4] * side + B1[7] * up - B1[10] * fwd;
        mz = B1[2] + B1[5] * side + B1[8] * up - B1[11] * fwd;
      }
      // hand-off point: part way from the swoop toward the letter, lifted (they climb out of the swoop)
      const p2x = mx + (tx - mx) * 0.45, p2y = my + (ty - my) * 0.45, p2z = mz + (tz - mz) * 0.45 + 0.25;
      const cx = 2 * mx - 0.5 * (p0x + p2x), cy = 2 * my - 0.5 * (p0y + p2y), cz = 2 * mz - 0.5 * (p0z + p2z);
      const tg = skim ? 1.0 + 0.2 * r1 : 1.15 + 0.3 * r1; // Bézier duration (s)
      const u = Math.min(tt, tg) / tg, iu = 1 - u;
      let x = iu * iu * p0x + 2 * iu * u * cx + u * u * p2x;
      let y = iu * iu * p0y + 2 * iu * u * cy + u * u * p2y;
      let z = iu * iu * p0z + 2 * iu * u * cz + u * u * p2z;
      let vx = (2 * iu * (cx - p0x) + 2 * u * (p2x - cx)) / tg;
      let vy = (2 * iu * (cy - p0y) + 2 * u * (p2y - cy)) / tg;
      let vz = (2 * iu * (cz - p0z) + 2 * u * (p2z - cz)) / tg;
      let formed = 0; // 0..1 đã vào chữ
      // tan từ giữa chữ ra hai bên
      const tD = BAT_TIMES.holdEnd + 0.18 * Math.min(1, Math.abs(T[q0]) / 200);
      if (tt > tg) {
        // 2. lò xo tắt dần tới hạn về đích (+ lượn lờ riêng)
        const w = 5.6 + 1.6 * r4;
        const tau = Math.min(tt, tD - delay) - tg;
        const e = Math.exp(-w * tau);
        const c1x = x - tx, c1y = y - ty, c1z = z - tz;
        const c2x = vx + w * c1x, c2y = vy + w * c1y, c2z = vz + w * c1z;
        x = tx + (c1x + c2x * tau) * e;
        y = ty + (c1y + c2y * tau) * e;
        z = tz + (c1z + c2z * tau) * e;
        vx = (c2x - w * (c1x + c2x * tau)) * e;
        vy = (c2y - w * (c1y + c2y * tau)) * e;
        vz = (c2z - w * (c1z + c2z * tau)) * e;
        formed = smoothstep(0.25, 0.9, tau);
        const wob = 0.004 + 0.006 * (1 - formed);
        x += Math.sin(now * (1.7 + r3) + i) * wob;
        z += Math.sin(now * (2.3 + r5) + i * 1.7) * wob * 0.8;
        if (t > tD) {
          // 4. tan ra: lao về phía ống kính, tản ra quanh camera
          const q = t - tD;
          const aimX = B0[0] + (r2 - 0.5) * 0.7, aimY = B0[1] - 0.1, aimZ = B0[2] + (r4 - 0.45) * 0.5;
          let dx = aimX - x, dy = aimY - y, dz = aimZ - z;
          const dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl;
          dy /= dl;
          dz /= dl;
          const sp = 1.2 + 1.4 * r1, acc = 2.2 + 1.5 * r3;
          const s = sp * q + 0.5 * acc * q * q;
          x += dx * s;
          y += dy * s;
          z += dz * s + 0.15 * q * q * (r5 - 0.5);
          vx = dx * (sp + acc * q);
          vy = dy * (sp + acc * q);
          vz = dz * (sp + acc * q);
          formed = Math.max(0, formed - q * 3);
        }
      }
      proj(b, x, y, z, P);
      const depth = P[2];
      if (depth < 0.12) continue;
      const px = P[0], py = P[1], kpt = P[3];

      // hướng thân: theo vận tốc; lơ lửng thì ngóc lên, quay về phía mắt (thấy dơi dang cánh trước mặt)
      const spd = Math.hypot(vx, vy, vz);
      let ex = b.e[0] - x, ey = b.e[1] - y;
      const ehl = Math.hypot(ex, ey) || 1;
      ex /= ehl;
      ey /= ehl;
      const hv = 1 - smoothstep(0.25, 0.9, spd);
      let fx = (spd > 1e-4 ? vx / spd : 0) * (1 - hv) + ex * 0.45 * hv;
      let fy = (spd > 1e-4 ? vy / spd : 0) * (1 - hv) + ey * 0.45 * hv;
      let fz = (spd > 1e-4 ? vz / spd : 1) * (1 - hv) + 0.9 * hv;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl;
      fy /= fl;
      fz /= fl;
      let rx = fy, ry = -fx;
      const rl = Math.hypot(rx, ry) || 1;
      rx /= rl;
      ry /= rl;
      let ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;
      const bank = Math.max(-0.6, Math.min(0.6, Math.sin(tt * 3 + i) * 0.18 * (1 - 0.8 * formed) + (r2 - 0.5) * 0.3 * (1 - formed)));
      const cb = Math.cos(bank), sb = Math.sin(bank);
      const Rx = rx * cb + ux * sb, Ry = ry * cb + uy * sb, Rz = uz * sb;
      ux = ux * cb - rx * sb;
      uy = uy * cb - ry * sb;
      uz = uz * cb;

      // cỡ: dơi thật khi bay (k 0,42–0,6), co về cỡ "điểm chữ" khi xếp, lớn lại khi tan
      const kNat = 0.42 + r5 * 0.18;
      const k = kNat + (kT - kNat) * formed;

      // chọn ô theo hướng mắt trong hệ thân dơi
      const vxx = b.e[0] - x, vyy = b.e[1] - y, vzz = b.e[2] - z;
      const vl = Math.hypot(vxx, vyy, vzz) || 1;
      const vr = (vxx * Rx + vyy * Ry + vzz * Rz) / vl;
      const vf = (vxx * fx + vyy * fy + vzz * fz) / vl;
      const vu = (vxx * ux + vyy * uy + vzz * uz) / vl;
      const elI = vu < -0.42 ? 0 : vu > 0.42 ? 2 : 1;
      const azI = wrap(Math.round(Math.atan2(vr, -vf) / (Math.PI / 4)), 8);
      const row = azI * 3 + elI;
      const fq = (9 + r3 * 3) * (1 - 0.65 * formed); // giữ chữ: vỗ chậm, nhẹ
      const ph = wrap(Math.round((tt * fq + r2) * PHASES), PHASES);
      const Ux = CELL_UP[row * 3], Uy = CELL_UP[row * 3 + 1], Uz = CELL_UP[row * 3 + 2];
      const uwx = Rx * Ux + fx * Uy + ux * Uz, uwy = Ry * Ux + fy * Uy + uy * Uz, uwz = Rz * Ux + fz * Uy + uz * Uz;
      proj(b, x + uwx * 0.02, y + uwy * 0.02, z + uwz * 0.02, P);
      const rot = Math.atan2(P[1] - py, P[0] - px) + Math.PI / 2;
      const s = (ORTHO * k * kpt) / CELL;
      if (s * CELL < 2.5) continue;

      const fog = 1 - 0.3 * smoothstep(2.5, 4, depth);
      const lens = smoothstep(0.12, 0.28, depth);
      const alpha = fog * lens * smoothstep(0, 0.3, tt);
      S[o] = px;
      S[o + 1] = py;
      S[o + 2] = s;
      S[o + 3] = rot;
      S[o + 4] = ph * CELL;
      S[o + 5] = row * CELL;
      S[o + 6] = alpha;
      // (motion blur: đã nướng trong sprite — cánh nhoè theo màn trập Cycles)
      // pass B: ánh nến (gần bí) + ánh cam hắt lên chữ từ quả bí phía dưới + viền trăng lạnh nhẹ
      // rim when in the text: moonlight from above on the upper part of each letter, pumpkin orange from below on the lower
      // part (per bat: its height inside its line + a little noise), so the letters get a two-tone edge
      const dc = Math.hypot(x - CANDLE[0], y - CANDLE[1], z - CANDLE[2]);
      const warmFly = 0.38 * Math.exp(-dc / 0.2);
      // in the text: interior bats pure black; only bats on the letter's top edge (and a little the sides) catch a thin
      // cold moon rim
      const rf = formed * T[q0 + 10] * 0.32;
      const nf = 1 - formed;
      S[o + 10] = Math.min(1, 0.95 * warmFly + 0.035 * nf + rf * 0.55);
      S[o + 11] = Math.min(1, 0.46 * warmFly + 0.06 * nf + rf * 0.68);
      S[o + 12] = Math.min(1, 0.16 * warmFly + 0.11 * nf + rf * 1.0);
      S[o + 13] = lens;
      S[o + 14] = formed;
    }
    return now;
  });

  // ── pass A ──
  const aX = useRSXformBuffer(BAT_COUNT, (v, i) => {
    "worklet";
    if (tick.value < 0) {
      v.set(HIDDEN_XF[0], HIDDEN_XF[1], HIDDEN_XF[2], HIDDEN_XF[3]);
      return;
    }
    const S = getStore().__fxBats!;
    const trail = i >= BAT_COUNT;
    const o = (trail ? i - BAT_COUNT : i) * ST;
    const a = trail ? S[o + 9] : S[o + 6];
    if (a <= 0) {
      v.set(HIDDEN_XF[0], HIDDEN_XF[1], HIDDEN_XF[2], HIDDEN_XF[3]);
      return;
    }
    const x = trail ? S[o + 7] : S[o], y = trail ? S[o + 8] : S[o + 1];
    const sc = S[o + 2] * Math.cos(S[o + 3]), ss = S[o + 2] * Math.sin(S[o + 3]);
    v.set(sc, ss, x - (sc * 64 - ss * 64), y - (ss * 64 + sc * 64));
  });
  const aR = useRectBuffer(BAT_COUNT, (v, i) => {
    "worklet";
    if (tick.value < 0) {
      v.setXYWH(0, 0, 1, 1);
      return;
    }
    const S = getStore().__fxBats!;
    const o = (i >= BAT_COUNT ? i - BAT_COUNT : i) * ST;
    v.setXYWH(S[o + 4], S[o + 5], CELL, CELL);
  });
  const aC = useColorBuffer(BAT_COUNT, (v, i) => {
    "worklet";
    if (tick.value < 0) {
      v[3] = 0;
      return;
    }
    const S = getStore().__fxBats!;
    const trail = i >= BAT_COUNT;
    const o = (trail ? i - BAT_COUNT : i) * ST;
    // night: wing membrane desaturated; in the text the bats go darker → black silhouettes against the bright sky
    const f = S[o + 14];
    v[0] = 0.3 - 0.29 * f;
    v[1] = 0.31 - 0.295 * f;
    v[2] = 0.42 - 0.4 * f;
    v[3] = trail ? S[o + 9] : S[o + 6];
  });
  // ── pass B (cộng sáng): rim nến / cam / trăng ──
  const bX = useRSXformBuffer(BAT_COUNT, (v, i) => {
    "worklet";
    if (tick.value < 0) {
      v.set(HIDDEN_XF[0], HIDDEN_XF[1], HIDDEN_XF[2], HIDDEN_XF[3]);
      return;
    }
    const S = getStore().__fxBats!;
    const o = i * ST;
    if (S[o + 13] <= 0 || S[o + 6] <= 0) {
      v.set(HIDDEN_XF[0], HIDDEN_XF[1], HIDDEN_XF[2], HIDDEN_XF[3]);
      return;
    }
    const sc = S[o + 2] * Math.cos(S[o + 3]), ss = S[o + 2] * Math.sin(S[o + 3]);
    v.set(sc, ss, S[o] - (sc * 64 - ss * 64), S[o + 1] - (ss * 64 + sc * 64));
  });
  const bR = useRectBuffer(BAT_COUNT, (v, i) => {
    "worklet";
    if (tick.value < 0) {
      v.setXYWH(0, 0, 1, 1);
      return;
    }
    const S = getStore().__fxBats!;
    const o = i * ST;
    v.setXYWH(S[o + 4] + PHASES * CELL, S[o + 5], CELL, CELL);
  });
  const bC = useColorBuffer(BAT_COUNT, (v, i) => {
    "worklet";
    if (tick.value < 0) {
      v[3] = 0;
      return;
    }
    const S = getStore().__fxBats!;
    const o = i * ST;
    v[0] = S[o + 10];
    v[1] = S[o + 11];
    v[2] = S[o + 12];
    v[3] = S[o + 6] > 0 ? S[o + 13] : 0;
  });

  return (
    <Group>
      <Atlas image={sheet} sprites={aR} transforms={aX} colors={aC} colorBlendMode="modulate" sampling={SAMPLING} />
      <Atlas image={sheet} sprites={bR} transforms={bX} colors={bC} colorBlendMode="modulate" blendMode="plus" sampling={SAMPLING} />
    </Group>
  );
}
