import raw from "../../assets/scene/layout.json";

/**
 * Scene layout exported from Blender (render_passes.py), units are pt on the design frame = iPhone 17 Pro Max screen (440×956, `view` in layout.json).
 * Every draw layer sits in a Group already "cover"-scaled to this frame, so shader coordinates are design pt too.
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
// equirect panorama from the exact camera position (render_passes.py); if missing, derived from the original camera's view direction
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

// extras for the 3D reconstruction (render_passes.py); if missing, use estimated values
type Extra = { depth?: { min: number; max: number }; flameW?: number[]; shell?: number; roof?: number[] };
const ex = raw as unknown as Extra;
/** Depth encoding of bg_depth*.png: v/255 = ln(d/min)/ln(max/min), d = distance (m) from the original camera. */
export const DEPTH = ex.depth ?? { min: 0.25, max: 200 };
/** Flame center (m). */
export const FLAME_W = ex.flameW ?? [0, 0.015, 0.049];
/** Pumpkin rind thickness (m). */
export const SHELL = ex.shell ?? 0.017;
/** Porch roof: xmin, xmax, ymin, ymax, roof edge height (m) — no rain under the roof. */
export const ROOF = ex.roof ?? [-2.5, 2.5, -0.75, 2.2, 2.4];

/** Carve mask resolution (px) covering exactly the square crop frame. */
export const MASK = 512;

export type Fit = { k: number; ox: number; oy: number };

/** "cover" scale of the design frame into the canvas size. */
export const fitView = (w: number, h: number): Fit => {
  "worklet";
  const k = Math.max(w / VIEW.w, h / VIEW.h) || 1;
  return { k, ox: (w - VIEW.w * k) / 2, oy: (h - VIEW.h * k) / 2 };
};

/** design pt → mask px. */
export const toMask = (x: number, y: number) => {
  "worklet";
  return [((x - CROP.x) / CROP.s) * MASK, ((y - CROP.y) / CROP.s) * MASK] as const;
};
