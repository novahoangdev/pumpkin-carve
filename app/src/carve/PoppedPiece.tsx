import React, { useEffect } from "react";
import { BlurMask, Fill, Group, Image, LinearGradient, Path, Rect, vec, type SkImage, type SkPath } from "react-native-skia";
import { Easing, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { ms } from "../scene/clock";
import { CROP } from "../scene/layout";

const DUR = 560;

/**
 * A just-carved piece is a real thick slab of rind pushed into the pumpkin:
 * 1. a dark cut gap appears around the edge as soon as the stroke closes, the piece stays stuck for a beat;
 * 2. the piece TILTS BACK around its bottom edge (3D rotation with perspective, top edge goes in first) → reveals the wet yellow flesh cut face at the top edge
 *    (rind thickness), the rind face darkens as it moves into the shadow inside the pumpkin;
 * 3. then it drops and disappears behind the bottom edge of the hole (everything is clipped to the exact hole shape: nothing pokes out over the rind).
 * The hole (new mask) is already visible behind it, so once the piece drops out you see the pumpkin interior.
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
  const by = b.y + b.height; // hinge: bottom edge of the rind piece
  const spin = (cx < CROP.x + CROP.s / 2 ? -1 : 1) * 0.1;
  const thick = Math.max(2.2, Math.min(9, Math.min(b.width, b.height) * 0.16)); // rind thickness seen at the cut face (pt)
  const persp = Math.max(160, b.height * 4);

  useEffect(() => {
    p.set(withTiming(1, { duration: ms(DUR), easing: Easing.linear }));
    const id = setTimeout(onDone, ms(DUR + 40));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // stall for a beat (knife just pulled out, piece still stuck), tilt back (accelerating as if pushed), then drop down
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
  // cut face (pumpkin flesh) at the top edge: same shape, sits one thickness "behind" the rind face → shows above as the piece tilts back
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
        {/* flesh cut face: wet yellow, bright at the outer rim, darker toward the inside */}
        <Group transform={edgeTransform} opacity={edgeOp}>
          <Path path={path} color="#e7a446" />
          <Group clip={path}>
            <Rect x={b.x} y={b.y} width={b.width} height={b.height}>
              <LinearGradient start={vec(0, b.y)} end={vec(0, b.y + b.height)} colors={["#ffd99000", "#5a2206cc"]} />
            </Rect>
          </Group>
          <Path path={path} color="#3a1000" opacity={edgeShade} />
        </Group>
        {/* rind face */}
        <Group transform={transform}>
          <Group clip={path}>
            <Image image={skinLit} x={CROP.x} y={CROP.y} width={CROP.s} height={CROP.s} />
            <Image image={skinDark} x={CROP.x} y={CROP.y} width={CROP.s} height={CROP.s} opacity={darkOp} />
            <Fill color="#140500" opacity={shade} />
          </Group>
          {/* thin rind edge catching light just as it tilts */}
          <Path path={path} style="stroke" strokeWidth={0.8} color="#ffcf8a" opacity={edgeOp}>
            <BlurMask blur={0.6} style="normal" />
          </Path>
        </Group>
      </Group>
      {/* cut gap: dark outline around the hole as soon as the stroke closes (drawn on top, fades as the piece drops) */}
      <Path path={path} style="stroke" strokeWidth={2.2} color="#1a0600" opacity={kerf}>
        <BlurMask blur={1} style="normal" />
      </Path>
    </Group>
  );
}
