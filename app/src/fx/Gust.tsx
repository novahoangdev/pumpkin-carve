import React from "react";
import { Atlas, useColorBuffer, useRSXformBuffer, useRectBuffer } from "react-native-skia";
import type { SharedValue } from "react-native-reanimated";
import { VIEW } from "../scene/layout";
import type { Basis } from "../scene/view";
import { BASE_BASIS, SAMPLING, behindPumpkin } from "./pfx_atlas";
import { useGpuImage } from "../perf/gpu";

/**
 * Cơn gió cuốn lá phong ở intro (mặc định t ≈ 1,6 s, lúc camera đang cẩu từ trăng xuống). Cả cơn gió ngắn: mọi lá bay đã ra khỏi
 * khung trước 2,3 s (INTRO.settle, camera dừng), nên không lá nào đè lên mặt bí ở khung nghỉ.
 * - TIỀN CẢNH: 9 lá phong bay ngang sát ống kính (cách mắt 0,32–0,62 m), lật + xoay, nhoè vì ngoài vùng nét (sheet lá đã thu nhỏ +
 *   blur sẵn: `pfx_leaf_fg.png`), có motion blur (2 bóng mờ dọc quãng đường 1/60 s). Đặt theo hệ camera trong dải mép trên / dưới
 *   khung (6–28 % chiều cao tính từ mép) nên dù camera đang cẩu cũng không bao giờ đi qua giữa khung; lướt qua trong ~0,5 s, khá trong.
 * - TRUNG CẢNH: 9 lá cuốn ngang qua hiên (0,8–2,5 m), sắc nét, lượn lên xuống, bị quả bí che khi bay sau nó; qua trong ~0,55 s.
 * - SÀN: 6 lá nằm sẵn trên ván thềm; gió tới thì trượt + nảy lật theo hướng gió rồi nằm lại (bóng tiếp xúc mềm).
 * Mọi lá có toạ độ mét trong cảnh, chiếu qua `basis` mỗi frame.
 *
 * Hiệu năng: không tạo object / mảng nào mỗi frame — mỗi sprite tính thẳng trong callback của buffer Atlas (ghi tại chỗ), mảng
 * nháp cấp phát một lần. Ngoài cửa sổ gió chỉ còn lá sàn nằm yên (6 sprite + 6 bóng). 2 draw call.
 */
const FG = 9;
const FG_COPIES = 3; // thân + 2 bóng mờ chuyển động
const MID = 9;
const FLOOR = 6;
const N_FG = FG * FG_COPIES;
const N_SC = MID + FLOOR * 2;

const FG_SHEET = require("../../assets/fx/pfx_leaf_fg.png"); // 12 góc lật × 8 lá, ô 32 px, đã blur (lá phong: hàng 0–3)
const SC_SHEET = require("../../assets/fx/pfx_dust.png"); // ô 64 px, cùng bố cục; bóng mềm ở (576, 512, 64, 32)
const FILL = 0.92;
const TAU = Math.PI * 2;
const FG_LIFE = 0.5; // s một lá tiền cảnh trong khung; lá cuối bắt đầu ≤ 0,175 s → hết trước u = 0,68 (2,28 s)
const MID_LIFE = 0.55; // lá trung cảnh: bắt đầu ≤ 0,12 s → hết trước u = 0,67

const hash = (n: number) => {
  "worklet";
  const s = Math.sin(n * 57.31 + 11.17) * 43758.5453;
  return s - Math.floor(s);
};

// chiếu điểm thế giới → màn hình camera xem (giống proj của pfx_atlas, viết lại để ghi vào mảng nháp riêng)
const project = (b: Basis, x: number, y: number, z: number, out: number[], vw: number, vh: number) => {
  "worklet";
  const dx = x - b.e[0], dy = y - b.e[1], dz = z - b.e[2];
  const zz = -(b.z[0] * dx + b.z[1] * dy + b.z[2] * dz);
  const k = b.f / Math.max(zz, 1e-3);
  out[0] = vw / 2 + k * (b.x[0] * dx + b.x[1] * dy + b.x[2] * dz);
  out[1] = vh / 2 - k * (b.y[0] * dx + b.y[1] * dy + b.y[2] * dz);
  out[2] = zz;
  out[3] = k;
};

// ── lá tiền cảnh ──
// out: [x, y, scale(pt/px), rot, cellX, cellY, a]
const fgLeaf = (k: number, u: number, b: Basis, P: number[], out: number[], vw: number, vh: number) => {
  "worklet";
  const r1 = hash(k * 3.1), r2 = hash(k * 3.1 + 1), r3 = hash(k * 3.1 + 2), r4 = hash(k * 3.1 + 3), r5 = hash(k * 3.1 + 4), r6 = hash(k * 3.1 + 5);
  const t = u - (0.01 + k * 0.018 + r1 * 0.02);
  out[6] = 0;
  if (t <= 0 || t > FG_LIFE) return;
  const s = t / FG_LIFE;
  // hệ camera: sâu d trước mắt, X ngang (trái → phải, vượt mép 30 % mỗi bên), Y trong dải mép trên (lá chẵn) / dưới (lá lẻ)
  const d = 0.32 + 0.3 * r4;
  const hw = ((vw / 2) * d) / b.f, hh = ((vh / 2) * d) / b.f;
  const X = hw * (-1.3 + 2.6 * s + 0.05 * Math.sin(t * 9 + r3 * 6));
  const side = k % 2 === 0 ? 1 : -1;
  const Y = side * hh * (0.72 + 0.16 * r3 + 0.06 * Math.sin(t * 6.5 + r5 * 6));
  const x = b.e[0] - b.z[0] * d + b.x[0] * X + b.y[0] * Y;
  const y = b.e[1] - b.z[1] * d + b.x[1] * X + b.y[1] * Y;
  const z = b.e[2] - b.z[2] * d + b.x[2] * X + b.y[2] * Y;
  project(b, x, y, z, P, vw, vh);
  if (P[2] < 0.09) return;
  const sizeM = 0.055 + 0.035 * r5;
  const L = sizeM * P[3];
  const flip = r6 * TAU + (9 + 7 * r2) * t;
  out[0] = P[0];
  out[1] = P[1];
  out[2] = L / (32 * FILL);
  out[3] = r5 * TAU + (4 + 5 * r1) * t;
  const fi = Math.round((((flip % TAU) + TAU) % TAU) / (TAU / 12)) % 12;
  out[4] = fi * 32;
  out[5] = Math.floor(r4 * 4) * 32; // chỉ lá phong
  out[6] = Math.min(1, t / 0.06) * Math.min(1, (FG_LIFE - t) / 0.1);
};

// ── lá trung cảnh + lá sàn ──
// out: [x, y, scale, rot, cellX, cellY, a, isShadow]
const scLeaf = (i: number, u: number, b: Basis, P: number[], out: number[], vw: number, vh: number) => {
  "worklet";
  out[6] = 0;
  out[7] = 0;
  if (i < MID) {
    const r1 = hash(i * 7.3 + 50), r2 = hash(i * 7.3 + 51), r3 = hash(i * 7.3 + 52), r4 = hash(i * 7.3 + 53), r5 = hash(i * 7.3 + 54);
    const t = u - r1 * 0.12;
    if (t <= 0 || t > MID_LIFE) return;
    const x = -1.6 - 0.4 * r2 + (3.6 + 2.2 * r3) * t;
    const y = -0.3 + 1.4 * r4 + 0.1 * Math.sin(t * 3 + r1 * 6);
    const z = 0.08 + 0.55 * r5 + 0.35 * t + 0.06 * Math.sin(t * 9 + r2 * 6);
    if (behindPumpkin(b.e, x, y, z)) return; // bay sau quả bí
    project(b, x, y, z, P, vw, vh);
    if (P[2] < 0.1) return;
    const L = (0.05 + 0.025 * r2) * P[3];
    const flip = r3 * TAU + (10 + 8 * r4) * t;
    out[0] = P[0];
    out[1] = P[1];
    out[2] = L / (64 * FILL);
    out[3] = r1 * TAU + (4 + 5 * r5) * t;
    out[4] = (Math.round((((flip % TAU) + TAU) % TAU) / (TAU / 12)) % 12) * 64;
    out[5] = Math.floor(r4 * 4) * 64;
    out[6] = Math.min(1, t / 0.06) * Math.min(1, (MID_LIFE - t) / 0.1);
    return;
  }
  // lá sàn: j = 0..FLOOR-1, chẵn = bóng, lẻ = lá
  const j = Math.floor((i - MID) / 2);
  const shadow = (i - MID) % 2 === 0;
  const r1 = hash(j * 5.9 + 90), r2 = hash(j * 5.9 + 91), r3 = hash(j * 5.9 + 92), r4 = hash(j * 5.9 + 93), r5 = hash(j * 5.9 + 94);
  // chỗ nằm: trên thềm trước và hai bên quả bí, trong khung nhìn nghỉ
  const side = j % 2 === 0 ? -1 : 1;
  const x0 = side * (0.22 + 0.35 * r1) - 0.1;
  const y0 = -0.42 + 0.4 * r2;
  const tw = u - (0.04 + 0.03 * j + 0.03 * r3); // gió tới chỗ lá
  const D = 0.12 + 0.3 * r4; // quãng trượt (m)
  const tau = Math.max(0, tw);
  const s = D * (1 - Math.exp(-7 * tau)); // nằm yên trước ~0,6 s
  const hopT = 0.22 + 0.12 * r5;
  const hop = tau > 0 && tau < hopT ? (0.025 + 0.04 * r5) * Math.sin((Math.PI * tau) / hopT) : 0;
  const x = x0 + s;
  const y = y0 - 0.12 * s;
  const z = 0.002 + hop;
  project(b, x, y, z, P, vw, vh);
  if (P[2] < 0.1) return;
  const L = (0.055 + 0.02 * r3) * P[3];
  if (shadow) {
    project(b, x, y, 0, P, vw, vh);
    out[0] = P[0];
    out[1] = P[1] + 1;
    out[2] = (L * (1.05 + hop * 6)) / 64;
    out[3] = 0;
    out[4] = 576;
    out[5] = 512;
    out[6] = 0.22 * (1 - Math.min(1, hop / 0.06));
    out[7] = 1;
    return;
  }
  // nằm bẹp: góc lật = góc giữa trục đứng và tia nhìn; đang nảy thì lật thêm (vài lá lật mặt)
  const vx = b.e[0] - x, vy = b.e[1] - y, vz = b.e[2] - z;
  const cf = vz / (Math.hypot(vx, vy, vz) || 1);
  const lay = Math.acos(Math.min(1, Math.abs(cf)));
  const turned = r5 > 0.5 ? Math.PI * Math.min(1, tau / hopT) : 0;
  const flip = lay + turned + (tau > 0 && tau < hopT ? Math.sin((Math.PI * tau) / hopT) * 0.9 : 0);
  // gân lá nằm ngang theo hướng r1, chiếu ra màn hình; gió xoay lá một chút khi trượt
  const va = r1 * Math.PI + s * 3 * side;
  const px = P[0], py = P[1];
  project(b, x + Math.cos(va) * 0.01, y + Math.sin(va) * 0.01, z, P, vw, vh);
  const rot = Math.atan2(P[1] - py, P[0] - px) - Math.PI / 2;
  out[0] = px;
  out[1] = py;
  out[2] = L / (64 * FILL);
  out[3] = rot;
  out[4] = (Math.round((((flip % TAU) + TAU) % TAU) / (TAU / 12)) % 12) * 64;
  out[5] = Math.floor(r4 * 4) * 64;
  out[6] = 1;
};

export function Gust({
  time,
  basis,
  at = 1.6,
  layer,
}: {
  time: SharedValue<number>;
  basis?: SharedValue<Basis>;
  /** thời điểm cơn gió (giây đồng hồ cảnh); < 0 = tắt */
  at?: number;
  /** "scene": lá trung cảnh + lá sàn (vẽ sau quả bí, trước mưa); "fg": lá tiền cảnh sát ống kính (vẽ trên sương / atmos) */
  layer: "scene" | "fg";
}) {
  const fgSheet = useGpuImage(FG_SHEET, { mipmapped: true });
  const scSheet = useGpuImage(SC_SHEET, { mipmapped: true });
  const vw = VIEW.w, vh = VIEW.h;
  // chỉ lớp đang vẽ mới tính (lớp kia giữ 1 sprite rỗng)
  const nFg = layer === "fg" ? N_FG : 1;
  const nSc = layer === "scene" ? N_SC : 1;
  const off = layer === "fg" ? -1 : 1; // >0: tắt tiền cảnh, <0: tắt cảnh

  // ── tiền cảnh: sprite i = lá k, bản c (0 = thân, 1..2 = bóng mờ lùi về 1/3, 2/3 của 1/60 s) ──
  const P1 = [0, 0, 0, 0];
  const O1 = [0, 0, 0, 0, 0, 0, 0];
  const fgX = useRSXformBuffer(nFg, (v, i) => {
    "worklet";
    const u = at < 0 || off > 0 ? -1 : time.value - at;
    const k = Math.floor(i / FG_COPIES), c = i % FG_COPIES;
    fgLeaf(k, u - (c / FG_COPIES) / 60, basis ? basis.value : BASE_BASIS, P1, O1, vw, vh);
    if (O1[6] <= 0) {
      v.set(1e-3, 0, -1e4, -1e4); // ẩn: scale 0 làm Skia log mỗi frame (notes/perf.md)
      return;
    }
    const sc = O1[2] * Math.cos(O1[3]), ss = O1[2] * Math.sin(O1[3]);
    v.set(sc, ss, O1[0] - (sc * 16 - ss * 16), O1[1] - (ss * 16 + sc * 16));
  });
  const P2 = [0, 0, 0, 0];
  const O2 = [0, 0, 0, 0, 0, 0, 0];
  const fgR = useRectBuffer(nFg, (v, i) => {
    "worklet";
    const u = at < 0 || off > 0 ? -1 : time.value - at;
    const k = Math.floor(i / FG_COPIES), c = i % FG_COPIES;
    fgLeaf(k, u - (c / FG_COPIES) / 60, basis ? basis.value : BASE_BASIS, P2, O2, vw, vh);
    v.setXYWH(O2[4], O2[5], 32, 32);
  });
  const P3 = [0, 0, 0, 0];
  const O3 = [0, 0, 0, 0, 0, 0, 0];
  const fgC = useColorBuffer(nFg, (v, i) => {
    "worklet";
    const u = at < 0 || off > 0 ? -1 : time.value - at;
    const k = Math.floor(i / FG_COPIES), c = i % FG_COPIES;
    fgLeaf(k, u - (c / FG_COPIES) / 60, basis ? basis.value : BASE_BASIS, P3, O3, vw, vh);
    // sát ống kính, ngược sáng đèn hiên: tối, hơi ấm; bóng mờ chuyển động nhạt hơn
    v[0] = 0.62;
    v[1] = 0.52;
    v[2] = 0.48;
    v[3] = O3[6] * (c === 0 ? 0.55 : 0.22); // ngoài nét, sát ống kính: trong, không thành mảng tối
  });

  // ── trung cảnh + sàn ──
  const P4 = [0, 0, 0, 0];
  const O4 = [0, 0, 0, 0, 0, 0, 0, 0];
  const scX = useRSXformBuffer(nSc, (v, i) => {
    "worklet";
    if (off < 0) {
      v.set(1e-3, 0, -1e4, -1e4); // ẩn: scale 0 làm Skia log mỗi frame (notes/perf.md)
      return;
    }
    const u = at < 0 ? -1 : time.value - at;
    scLeaf(i, u, basis ? basis.value : BASE_BASIS, P4, O4, vw, vh);
    if (O4[6] <= 0) {
      v.set(1e-3, 0, -1e4, -1e4); // ẩn: scale 0 làm Skia log mỗi frame (notes/perf.md)
      return;
    }
    const ax = 32, ay = O4[7] ? 16 : 32;
    const sc = O4[2] * Math.cos(O4[3]), ss = O4[2] * Math.sin(O4[3]);
    v.set(sc, ss, O4[0] - (sc * ax - ss * ay), O4[1] - (ss * ax + sc * ay));
  });
  const P5 = [0, 0, 0, 0];
  const O5 = [0, 0, 0, 0, 0, 0, 0, 0];
  const scR = useRectBuffer(nSc, (v, i) => {
    "worklet";
    if (off < 0) {
      v.setXYWH(0, 0, 1, 1);
      return;
    }
    const u = at < 0 ? -1 : time.value - at;
    scLeaf(i, u, basis ? basis.value : BASE_BASIS, P5, O5, vw, vh);
    v.setXYWH(O5[4], O5[5], 64, O5[7] ? 32 : 64);
  });
  const P6 = [0, 0, 0, 0];
  const O6 = [0, 0, 0, 0, 0, 0, 0, 0];
  const scC = useColorBuffer(nSc, (v, i) => {
    "worklet";
    if (off < 0) {
      v[3] = 0;
      return;
    }
    const u = at < 0 ? -1 : time.value - at;
    scLeaf(i, u, basis ? basis.value : BASE_BASIS, P6, O6, vw, vh);
    if (O6[7]) {
      v[0] = 0;
      v[1] = 0;
      v[2] = 0;
    } else {
      // tông đêm dưới đèn hiên, như lá nướng sẵn trong ảnh nền
      v[0] = 0.7;
      v[1] = 0.62;
      v[2] = 0.6;
    }
    v[3] = O6[6];
  });

  return layer === "fg" ? (
    <Atlas image={fgSheet} sprites={fgR} transforms={fgX} colors={fgC} colorBlendMode="modulate" sampling={SAMPLING} />
  ) : (
    <Atlas image={scSheet} sprites={scR} transforms={scX} colors={scC} colorBlendMode="modulate" sampling={SAMPLING} />
  );
}
