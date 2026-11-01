/**
 * App time scale (EXPO_PUBLIC_TIMESCALE, default 1). For 120 fps clips: build with 0.5 → all motion runs at half
 * speed, the simulator records 60 real frames/s = 120 demo frames/s; ffmpeg `setpts=0.5*PTS` compresses it back to 120 fps CFR.
 * All motion must go through here: the `time` clock (PumpkinScene multiplies by TIMESCALE), withTiming durations (`ms`), springs (`spring`).
 */
export const TIMESCALE = Number(process.env.EXPO_PUBLIC_TIMESCALE ?? "1") || 1;

/** Duration (ms, on the demo clock) → real ms to pass to withTiming / withDelay / setTimeout. */
export const ms = (d: number) => {
  "worklet";
  return d / TIMESCALE;
};

/**
 * Spring config on the demo clock: slowed down TIMESCALE times (k·s², c·s, same mass) → same motion shape.
 * Defaults must be Reanimated 4's (GentleSpringConfig: mass 4, damping 120, stiffness 900) — NOT R3's (1/10/100):
 * the old withSpring({ damping: 7, stiffness: 120 }) ran with mass 4.
 */
export const spring = (c: { damping?: number; stiffness?: number; mass?: number } = {}) => {
  "worklet";
  const s = TIMESCALE;
  return { ...c, damping: (c.damping ?? 120) * s, stiffness: (c.stiffness ?? 900) * s * s, mass: c.mass ?? 4 };
};
