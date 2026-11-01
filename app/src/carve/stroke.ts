import { PathOp, Skia, StrokeCap, StrokeJoin, type SkPath } from "react-native-skia";
import { CENTER, CROP } from "../scene/layout";

/** Flat point list [x0, y0, x1, y1, …] (design pt). */
export type Pts = number[];

/** Smooth path through the points: quadTo via midpoints (no overshoot like Catmull-Rom). */
export const smoothPath = (p: Pts, close = false): SkPath => {
  "worklet";
  const b = Skia.PathBuilder.Make();
  const n = p.length / 2;
  if (n < 2) return b.build();
  b.moveTo(p[0], p[1]);
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2], y = p[i * 2 + 1];
    b.quadTo(x, y, (x + p[i * 2 + 2]) / 2, (y + p[i * 2 + 3]) / 2);
  }
  b.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
  if (close) b.close();
  return b.build();
};

export const pathLength = (p: Pts) => {
  "worklet";
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
};

/** Polygon area (shoelace), used to drop shapes that are too small. */
const area = (p: Pts) => {
  let a = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return Math.abs(a) / 2;
};

// carvable area (approx. the front face of the pumpkin): the collapsing rind piece is clipped to it, the shader uses the exact data.png
const FACE = Skia.Path.Oval({ x: CENTER.x - CROP.s * 0.36, y: CENTER.y - CROP.s * 0.3, width: CROP.s * 0.72, height: CROP.s * 0.56 });

/**
 * Knife stroke → carved hole. If start and end are close it closes into a filled shape, an open stroke becomes a thin 5pt groove.
 * Returns null if the stroke is too short / the shape is too small.
 */
export const strokeToHole = (p: Pts): { path: SkPath; closed: boolean } | null => {
  const n = p.length / 2;
  if (n < 3) return null;
  const len = pathLength(p);
  const gap = Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]);
  const closed = gap < 40 && len > 3 * gap && len > 50;
  let path: SkPath | null;
  if (closed) {
    if (area(p) < 140) return null;
    path = smoothPath(p, true);
  } else {
    if (len < 24) return null;
    path = Skia.Path.Stroke(smoothPath(p), { width: 5, cap: StrokeCap.Round, join: StrokeJoin.Round });
  }
  if (!path) return null;
  const clipped = Skia.Path.MakeFromOp(path, FACE, PathOp.Intersect);
  if (!clipped || clipped.isEmpty()) return null;
  const b = clipped.computeTightBounds();
  if (b.width * b.height < 60) return null;
  return { path: clipped, closed };
};
