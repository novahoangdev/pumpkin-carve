import { useAnimatedReaction, useSharedValue, type SharedValue } from "react-native-reanimated";
import { PUMPKIN_ASPECT, type PumpkinJump } from "./jump";

/**
 * Tap script for the demo / clip recording (seconds, from the start mark):
 * one single jump → pause → juggle 5 taps in a row → the 5th one flies into the Dynamic Island.
 */
export const SCRIPT_TAPS = [0, 1.5, 1.75, 2.15, 2.65, 3.25];

/**
 * Auto-taps per the script: when `start` ≥ 0, calls jump.tap at each start + taps[i],
 * tap points alternate left/right on the pumpkin body (so it drifts back and forth). Set start = −1 to stop/reset.
 */
export function useScriptedTaps(opts: {
  time: SharedValue<number>;
  start: SharedValue<number>;
  jump: PumpkinJump;
  anchor: SharedValue<{ x: number; y: number; w: number }>;
  taps?: number[];
}) {
  const { time, start, jump, anchor } = opts;
  const taps = opts.taps ?? SCRIPT_TAPS;
  const idx = useSharedValue(0);
  useAnimatedReaction(
    () => time.get(),
    (t) => {
      const s0 = start.get();
      if (s0 < 0) {
        if (idx.get() !== 0) idx.set(0);
        return;
      }
      const i = idx.get();
      if (i >= taps.length || t < s0 + taps[i]) return;
      idx.set(i + 1);
      const A = anchor.get();
      const side = i % 2 === 0 ? -1 : 1;
      jump.tap(A.x + side * A.w * 0.18, A.y - A.w * PUMPKIN_ASPECT * 0.5);
    },
  );
}
