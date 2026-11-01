import { useAnimatedReaction, useSharedValue, type SharedValue } from "react-native-reanimated";
import { PUMPKIN_ASPECT, type PumpkinJump } from "./jump";

/**
 * Kịch bản chạm cho demo/quay clip (giây, tính từ mốc start):
 * một cú nhảy lẻ → nghỉ → tung hứng 5 cú liên tiếp → cú thứ 5 bay vào Dynamic Island.
 */
export const SCRIPT_TAPS = [0, 1.5, 1.75, 2.15, 2.65, 3.25];

/**
 * Tự bấm theo kịch bản: khi `start` ≥ 0, lần lượt gọi jump.tap tại các mốc start + taps[i],
 * điểm chạm xen kẽ trái/phải trên thân bí (để bí trôi qua lại). Đặt start = −1 để dừng/reset.
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
