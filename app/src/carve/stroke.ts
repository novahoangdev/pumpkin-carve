import { PathOp, Skia, StrokeCap, StrokeJoin, type SkPath } from "react-native-skia";
import { CENTER, CROP } from "../scene/layout";

/** Danh sách điểm phẳng [x0, y0, x1, y1, …] (pt thiết kế). */
export type Pts = number[];

/** Path mượt qua các điểm: quadTo qua trung điểm (không vượt quá điểm như Catmull-Rom). */
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

/** Diện tích đa giác (shoelace), dùng để bỏ hình quá nhỏ. */
const area = (p: Pts) => {
  let a = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return Math.abs(a) / 2;
};

// vùng khắc được (xấp xỉ mặt trước quả bí): mảnh vỏ sụp bị cắt theo vùng này, shader thì dùng data.png chính xác
const FACE = Skia.Path.Oval({ x: CENTER.x - CROP.s * 0.36, y: CENTER.y - CROP.s * 0.3, width: CROP.s * 0.72, height: CROP.s * 0.56 });

/**
 * Nét dao → lỗ khắc. Đầu–cuối gần nhau thì khép thành hình kín (fill), nét hở thành rãnh mảnh 5pt.
 * Trả null nếu nét quá ngắn / hình quá nhỏ.
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
