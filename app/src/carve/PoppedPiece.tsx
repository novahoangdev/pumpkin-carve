import React, { useEffect } from "react";
import { BlurMask, Fill, Group, Image, LinearGradient, Path, Rect, vec, type SkImage, type SkPath } from "react-native-skia";
import { Easing, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { ms } from "../scene/clock";
import { CROP } from "../scene/layout";

const DUR = 560;

/**
 * Mảnh vỏ vừa khắc xong là một miếng vỏ dày thật bị đẩy vào trong quả bí:
 * 1. khe cắt tối hiện quanh mép ngay khi khép nét, miếng còn kẹt một nhịp;
 * 2. miếng NGẢ RA SAU quanh mép dưới (xoay 3D có phối cảnh, mép trên đi vào trước) → lộ mặt cắt thịt bí vàng ướt ở mép trên
 *    (bề dày vỏ), mặt vỏ tối dần vì đi vào bóng trong lòng bí;
 * 3. rồi tụt xuống và khuất sau mép dưới của lỗ (mọi thứ bị cắt theo đúng hình lỗ: không lòi ra ngoài mặt vỏ).
 * Lỗ (mask mới) đã hiện ngay phía sau, nên khi miếng tụt mất là thấy lòng bí.
 */
export function PoppedPiece({
  path,
  skinLit,
  skinDark,
  porch,
  onDone,
}: {
  path: SkPath;
  skinLit: SkImage;
  skinDark: SkImage;
  porch: SharedValue<number>;
  onDone: () => void;
}) {
  const p = useSharedValue(0);
  const b = path.computeTightBounds();
  const cx = b.x + b.width / 2;
  const by = b.y + b.height; // bản lề: mép dưới miếng vỏ
  const spin = (cx < CROP.x + CROP.s / 2 ? -1 : 1) * 0.1;
  const thick = Math.max(2.2, Math.min(9, Math.min(b.width, b.height) * 0.16)); // bề dày vỏ thấy ở mặt cắt (pt)
  const persp = Math.max(160, b.height * 4);

  useEffect(() => {
    p.set(withTiming(1, { duration: ms(DUR), easing: Easing.linear }));
    const id = setTimeout(onDone, ms(DUR + 40));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // khựng một nhịp (dao vừa rút, miếng còn kẹt), ngả ra sau (nhanh dần như bị đẩy), rồi rơi tụt xuống
  const q = useDerivedValue(() => Math.max(0, (p.value - 0.1) / 0.9));
  const tip = useDerivedValue(() => {
    const t = Math.min(1, q.value / 0.65);
    return t * t * (3 - 2 * t) * 1.15; // rad
  });
  const drop = useDerivedValue(() => {
    const t = Math.max(0, (q.value - 0.35) / 0.65);
    return t * t * (b.height * 0.9 + 10);
  });
  const transform = useDerivedValue(() => [
    { translateX: cx },
    { translateY: by + drop.value },
    { perspective: persp },
    { rotateX: tip.value },
    { rotate: spin * q.value },
    { scale: 1 - 0.12 * q.value },
    { translateX: -cx },
    { translateY: -by },
  ]);
  // mặt cắt (thịt bí) ở mép trên: cùng hình, nằm "sau" mặt vỏ một bề dày → khi miếng ngả ra sau thì lộ ra phía trên
  const edgeTransform = useDerivedValue(() => {
    const a = tip.value;
    return [
      { translateX: cx },
      { translateY: by + drop.value - thick * Math.sin(a) * 1.4 },
      { perspective: persp },
      { rotateX: a },
      { rotate: spin * q.value },
      { scale: (1 - 0.12 * q.value) * 0.985 },
      { translateX: -cx },
      { translateY: -by },
    ];
  });
  const shade = useDerivedValue(() => 0.06 + 0.8 * Math.pow(q.value, 1.3));
  const edgeShade = useDerivedValue(() => 0.12 + 0.6 * q.value);
  const darkOp = useDerivedValue(() => 1 - porch.value);
  const kerf = useDerivedValue(() => Math.min(1, p.value * 8) * (1 - q.value));
  const edgeOp = useDerivedValue(() => Math.min(1, tip.value * 3));
  const opacity = useDerivedValue(() => 1 - Math.pow(Math.max(0, (q.value - 0.8) / 0.2), 2));

  return (
    <Group>
      <Group clip={path} opacity={opacity}>
        {/* mặt cắt thịt bí: vàng ướt, sáng ở rìa ngoài, tối dần vào trong */}
        <Group transform={edgeTransform} opacity={edgeOp}>
          <Path path={path} color="#e7a446" />
          <Group clip={path}>
            <Rect x={b.x} y={b.y} width={b.width} height={b.height}>
              <LinearGradient start={vec(0, b.y)} end={vec(0, b.y + b.height)} colors={["#ffd99000", "#5a2206cc"]} />
            </Rect>
          </Group>
          <Path path={path} color="#3a1000" opacity={edgeShade} />
        </Group>
        {/* mặt vỏ */}
        <Group transform={transform}>
          <Group clip={path}>
            <Image image={skinLit} x={CROP.x} y={CROP.y} width={CROP.s} height={CROP.s} />
            <Image image={skinDark} x={CROP.x} y={CROP.y} width={CROP.s} height={CROP.s} opacity={darkOp} />
            <Fill color="#140500" opacity={shade} />
          </Group>
          {/* mép vỏ bắt sáng mảnh khi vừa ngả */}
          <Path path={path} style="stroke" strokeWidth={0.8} color="#ffcf8a" opacity={edgeOp}>
            <BlurMask blur={0.6} style="normal" />
          </Path>
        </Group>
      </Group>
      {/* khe cắt: viền tối quanh lỗ ngay khi khép nét (vẽ trên cùng, mờ dần khi miếng tụt) */}
      <Path path={path} style="stroke" strokeWidth={2.2} color="#1a0600" opacity={kerf}>
        <BlurMask blur={1} style="normal" />
      </Path>
    </Group>
  );
}
