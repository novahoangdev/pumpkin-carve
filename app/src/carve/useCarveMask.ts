import { useCallback, useMemo, useState } from "react";
import { Skia, TileMode, type SkImage, type SkPath } from "react-native-skia";
import { CROP, MASK } from "../scene/layout";
import { toGpu } from "../perf/gpu";

export type MaskImages = { mask: SkImage; blur: SkImage };

/**
 * Vẽ toàn bộ lỗ khắc vào một surface raster (CPU, MASK×MASK phủ khung crop): nền đen, lỗ trắng.
 * Kèm bản blur (quầng sáng, vỏ trong mờ, bóng in trên thềm). Chỉ vẽ lại khi danh sách lỗ đổi
 * (nhấc tay, undo, reset), nên chạy trên JS thread là đủ nhanh.
 */
const renderMask = (holes: SkPath[]): MaskImages => {
  const s = Skia.Surface.MakeRaster(MASK, MASK)!;
  const c = s.getCanvas();
  c.clear(Skia.Color("black"));
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color("white"));
  c.save();
  c.scale(MASK / CROP.s, MASK / CROP.s);
  c.translate(-CROP.x, -CROP.y);
  for (const h of holes) c.drawPath(h, p);
  c.restore();
  const mask = s.makeImageSnapshot();

  const s2 = Skia.Surface.MakeRaster(MASK, MASK)!;
  const c2 = s2.getCanvas();
  c2.clear(Skia.Color("black"));
  const pb = Skia.Paint();
  pb.setImageFilter(Skia.ImageFilter.MakeBlur(9, 9, TileMode.Decal, null));
  c2.drawImage(mask, 0, 0, pb);
  // GPU images: uploaded once here instead of by the render threads (see perf/gpu.ts)
  return { mask: toGpu(mask), blur: toGpu(s2.makeImageSnapshot()) };
};

export function useCarveMask() {
  const [holes, setHoles] = useState<SkPath[]>([]);
  const images: MaskImages = useMemo(() => renderMask(holes), [holes]);
  const add = useCallback((h: SkPath) => setHoles((hs) => [...hs, h]), []);
  const undo = useCallback(() => setHoles((hs) => hs.slice(0, -1)), []);
  const reset = useCallback(() => setHoles([]), []);
  return { holes, images, add, undo, reset };
}
