import { useMemo } from "react";
import { useImage, type DataSourceParam, type SkImage } from "react-native-skia";

/**
 * Raster (CPU) image → GPU image, uploaded once on the calling thread.
 *
 * Why: Skia's implicit upload cache for raster images is capped at 128 MB (RNImageProvider.h,
 * kDefaultBudgetInBytes). The scene binds ~220 MB of decoded images (4 panoramas 3200×2400, bg/shadow/depth
 * 1206×2622, …), so the LRU cache thrashed and the render threads re-uploaded ~100 MB of textures EVERY frame
 * (Time Profiler: 40 % of a render thread in DawnContext::upload). A GPU image is drawn by every canvas without
 * a copy and is not counted in that cache.
 */
export const toGpu = <T extends SkImage | null>(img: T, opts?: { mipmapped?: boolean }): T => {
  if (!img) return img;
  try {
    return img.makeTextureImage(opts) as T;
  } catch {
    return img;
  }
};

/**
 * useImage + toGpu: the image is decoded, then uploaded once (null until both are done).
 * `mipmapped: true` for sprite sheets drawn with mipmap sampling (pfx_atlas SAMPLING): otherwise the render thread uploads
 * AND builds the mip chain on the CPU the first frame the effect appears (bat sheet 2048×3072 → visible hitch).
 */
export const useGpuImage = (src: DataSourceParam, opts?: { mipmapped?: boolean }) => {
  const img = useImage(src);
  const mip = !!opts?.mipmapped;
  return useMemo(() => toGpu(img, { mipmapped: mip }), [img, mip]);
};
