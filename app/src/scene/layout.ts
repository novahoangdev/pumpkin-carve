import raw from "../../assets/scene/layout.json";

/**
 * Bố cục cảnh do Blender xuất (render_passes.py), đơn vị pt trên khung thiết kế = màn iPhone 17 Pro Max (440×956, `view` trong layout.json).
 * Mọi lớp vẽ trong một Group đã scale "cover" về khung này, nên toạ độ shader cũng là pt thiết kế.
 */
export const VIEW = { w: raw.view[0], h: raw.view[1] };
export const CROP = { x: raw.crop[0], y: raw.crop[1], s: raw.crop[2] };
export const FLAME = { x: raw.flame[0], y: raw.flame[1] };
export const MOUTH = { x: raw.mouth[0], y: raw.mouth[1] };
export const CENTER = { x: raw.center[0], y: raw.center[1] };
export const LANTERN = { x: raw.lantern[0], y: raw.lantern[1] };
export const CAM = raw.cam;
export const PUMPKIN = raw.pumpkin;

type Pano = { fwd: number[]; right: number[]; lon: number[]; lat: number[] };
// panorama equirect từ đúng vị trí camera (render_passes.py); thiếu thì suy từ hướng nhìn của camera gốc
const fwdH = (() => {
  const z = CAM.rot[2];
  const l = Math.hypot(z[0], z[1]) || 1;
  return [-z[0] / l, -z[1] / l, 0];
})();
export const PANO: Pano = (raw as { pano?: Pano }).pano ?? {
  fwd: fwdH,
  right: [fwdH[1], -fwdH[0], 0],
  lon: [-80, 80],
  lat: [-62, 58],
};

// thêm cho dựng lại 3D (render_passes.py); thiếu thì dùng giá trị ước lượng
type Extra = { depth?: { min: number; max: number }; flameW?: number[]; shell?: number; roof?: number[] };
const ex = raw as unknown as Extra;
/** Mã hoá độ sâu bg_depth*.png: v/255 = ln(d/min)/ln(max/min), d = khoảng cách (m) từ camera gốc. */
export const DEPTH = ex.depth ?? { min: 0.25, max: 200 };
/** Tâm ngọn lửa (m). */
export const FLAME_W = ex.flameW ?? [0, 0.015, 0.049];
/** Độ dày vỏ bí (m). */
export const SHELL = ex.shell ?? 0.017;
/** Mái hiên: xmin, xmax, ymin, ymax, độ cao mép mái (m) — dưới mái không có mưa. */
export const ROOF = ex.roof ?? [-2.5, 2.5, -0.75, 2.2, 2.4];

/** Độ phân giải mask khắc (px) phủ đúng khung crop vuông. */
export const MASK = 512;

export type Fit = { k: number; ox: number; oy: number };

/** Scale "cover" khung thiết kế vào kích thước canvas. */
export const fitView = (w: number, h: number): Fit => {
  "worklet";
  const k = Math.max(w / VIEW.w, h / VIEW.h) || 1;
  return { k, ox: (w - VIEW.w * k) / 2, oy: (h - VIEW.h * k) / 2 };
};

/** pt thiết kế → px mask. */
export const toMask = (x: number, y: number) => {
  "worklet";
  return [((x - CROP.x) / CROP.s) * MASK, ((y - CROP.y) / CROP.s) * MASK] as const;
};
