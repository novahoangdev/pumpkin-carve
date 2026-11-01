/**
 * Hệ số thời gian của app (EXPO_PUBLIC_TIMESCALE, mặc định 1). Quay clip 120 fps: build với 0.5 → mọi chuyển động chạy chậm
 * một nửa, simulator ghi 60 khung/giây thật = 120 khung/giây demo; ffmpeg `setpts=0.5*PTS` nén lại thành 120 fps CFR.
 * Mọi chuyển động phải đi qua đây: đồng hồ `time` (PumpkinScene nhân TIMESCALE), thời lượng withTiming (`ms`), spring (`spring`).
 */
export const TIMESCALE = Number(process.env.EXPO_PUBLIC_TIMESCALE ?? "1") || 1;

/** Thời lượng (ms, theo đồng hồ demo) → ms thật để đưa vào withTiming / withDelay / setTimeout. */
export const ms = (d: number) => {
  "worklet";
  return d / TIMESCALE;
};

/**
 * Cấu hình spring theo đồng hồ demo: chậm lại TIMESCALE lần (k·s², c·s, cùng khối lượng) → cùng hình dạng chuyển động.
 * Mặc định phải là của Reanimated 4 (GentleSpringConfig: mass 4, damping 120, stiffness 900) — KHÔNG phải R3 (1/10/100):
 * withSpring({ damping: 7, stiffness: 120 }) cũ chạy với mass 4.
 */
export const spring = (c: { damping?: number; stiffness?: number; mass?: number } = {}) => {
  "worklet";
  const s = TIMESCALE;
  return { ...c, damping: (c.damping ?? 120) * s, stiffness: (c.stiffness ?? 900) * s * s, mass: c.mass ?? 4 };
};
