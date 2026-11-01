import * as Haptics from "expo-haptics";

export type HapticKind = "select" | "light" | "medium" | "heavy" | "success" | "error";

/** Gọi từ worklet qua scheduleOnRN. */
export const fireHaptic = (kind: HapticKind) => {
  const p =
    kind === "select"
      ? Haptics.selectionAsync()
      : kind === "success"
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : kind === "error"
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          : Haptics.impactAsync(
              kind === "light"
                ? Haptics.ImpactFeedbackStyle.Light
                : kind === "medium"
                  ? Haptics.ImpactFeedbackStyle.Medium
                  : Haptics.ImpactFeedbackStyle.Heavy,
            );
  p.catch(() => {});
};
