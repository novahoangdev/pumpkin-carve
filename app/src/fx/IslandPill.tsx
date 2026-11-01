import React, { useMemo } from "react";
import { BlurMask, Circle, Group, Image, Path, Skia, Text, matchFont, type SkImage, type SkPath } from "react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import {
  ISLAND,
  ISLAND_ARRIVE,
  ISLAND_CX,
  ISLAND_CY,
  ISLAND_END,
  ISLAND_OPEN,
  ISLAND_CONTENT_Y,
  ISLAND_SHAKE_AT,
  ISLAND_SPIT_AT,
  ISLAND_TIMING,
  MINI_BODY,
} from "./jump";
import { PERF, PerfHud } from "../perf/PerfHud";

/** Thân bí chiếm bao nhiêu phần bề ngang ảnh skin (ảnh crop vuông). Chỉnh nếu bí mini to/nhỏ hơn bí thật lúc bàn giao. */
export const SKIN_BODY_FRAC = 0.8;
/** Tâm thân bí lệch so với tâm ảnh skin (tỉ lệ cạnh ảnh, dương = xuống/phải). */
export const SKIN_BODY_OFFSET = { x: 0, y: 0.04 };
/** Bí mini to thêm bao nhiêu khi nằm trong pill đã nở. */
const MINI_GROW = 0.35;
const IMG = MINI_BODY / SKIN_BODY_FRAC;
const TAU = Math.PI * 2;

const EMPTY = Skia.PathBuilder.Make().build();

const hash = (n: number) => {
  "worklet";
  const s = Math.sin(n * 78.233 + 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => {
  "worklet";
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

const smooth = (u: number) => {
  "worklet";
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};

/** Lò xo tắt dần từ 0 → 1 (có vọt lố), t tính bằng giây. */
const spring = (t: number, w: number, z: number) => {
  "worklet";
  if (t <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
};

// mặt jack-o'-lantern nhỏ, toạ độ quanh tâm thân bí, bề ngang thân = MINI_BODY
const FACE = (() => {
  const k = MINI_BODY;
  const b = Skia.PathBuilder.Make();
  const tri = (pts: number[]) => {
    b.moveTo(pts[0] * k, pts[1] * k);
    for (let i = 2; i < pts.length; i += 2) b.lineTo(pts[i] * k, pts[i + 1] * k);
    b.close();
  };
  tri([-0.3, -0.02, -0.1, -0.02, -0.19, -0.18]);
  tri([0.3, -0.02, 0.1, -0.02, 0.19, -0.18]);
  tri([-0.05, 0.06, 0.05, 0.06, 0, -0.01]);
  // miệng răng cưa
  tri([-0.32, 0.1, -0.2, 0.15, -0.12, 0.11, -0.04, 0.16, 0.04, 0.11, 0.12, 0.16, 0.2, 0.11, 0.32, 0.1, 0.2, 0.25, 0, 0.29, -0.2, 0.25]);
  return b.build();
})();

type Frame = {
  on: number; // 0/1 có vẽ không
  pill: SkPath;
  glow: number;
  mx: number;
  my: number;
  mrot: number;
  ms: number;
  mini: number; // 0/1 bí mini có hiện không
  text: number;
  tx: number;
  ty: number;
  ts: number;
  sparks: SkPath;
  spit: SkPath;
};

/**
 * Dynamic Island "nuốt" quả bí: pill nở ra như Live Activity (lò xo), viền và glow cam bên trong,
 * bí mini nhún nhảy + xoay giữa đám tia lấp lánh, mặt bí sáng nếu nến đã thắp, chữ BOO! ở phía sau.
 * Giữ ~1,6s rồi rung, co thắt, nhả bí ra (lúc đó usePumpkinJump hiện lại bí thật ở tâm đảo).
 * Vẽ bằng pt MÀN HÌNH, đặt trên cùng (ngoài Group scale cảnh).
 */
export function IslandPill({
  islandT,
  time,
  skin,
  lit,
}: {
  islandT: SharedValue<number>;
  time: SharedValue<number>;
  skin: SkImage | null;
  lit: SharedValue<number>;
}) {
  const font = useMemo(() => matchFont({ fontFamily: "Helvetica", fontSize: 21, fontWeight: "bold" }), []);
  const textW = useMemo(() => font.measureText("BOO!").width, [font]);

  const F = useDerivedValue<Frame>(() => {
    const t0 = islandT.get();
    const now = time.get();
    const tau = t0 >= 0 ? now - t0 : -1;
    const off: Frame = {
      on: 0,
      pill: EMPTY,
      glow: 0,
      mx: ISLAND_CX,
      my: ISLAND_CY,
      mrot: 0,
      ms: 1,
      mini: 0,
      text: 0,
      tx: 0,
      ty: 0,
      ts: 1,
      sparks: EMPTY,
      spit: EMPTY,
    };
    const pre = ISLAND_ARRIVE - 0.2;
    if (tau < pre || tau > ISLAND_END) return off;

    const shakeEnd = ISLAND_SHAKE_AT + ISLAND_TIMING.shake;
    const ta = tau - ISLAND_ARRIVE; // tính từ lúc bí chui vào
    const bw = ISLAND.w;
    const bh = ISLAND.h;
    let w = bw;
    let h = bh;
    let jx = 0;
    let glow = 0;

    if (tau < ISLAND_ARRIVE) {
      // há miệng chờ: phình nhẹ khi bí lao tới
      const a = smooth((tau - pre) / 0.2);
      w = bw * (1 + 0.1 * a);
      h = bh * (1 + 0.08 * a);
      glow = 0.45 * a;
    } else if (tau < shakeEnd) {
      // nở ra kiểu Live Activity
      const k = spring(ta, 17, 0.42);
      const w0 = bw * 1.1;
      const h0 = bh * 1.08;
      w = w0 + (ISLAND_OPEN.w - w0) * k;
      h = h0 + (ISLAND_OPEN.h - h0) * k;
      glow = 0.8 + 0.12 * Math.sin(now * 9) + 0.08 * Math.sin(now * 23);
      if (tau >= ISLAND_SHAKE_AT) {
        // rung lắc mạnh dần, glow chớp
        const u = (tau - ISLAND_SHAKE_AT) / ISLAND_TIMING.shake;
        const amp = 1.5 + 4.5 * u;
        jx = Math.sin(now * 83) * amp;
        w += Math.sin(now * 61) * amp * 1.6;
        h += Math.cos(now * 57) * amp * 0.6;
        glow = 1 + 0.35 * u + 0.25 * Math.sin(now * 40);
      }
    } else if (tau < ISLAND_SPIT_AT) {
      // co thắt về dáng gốc, nhanh dần
      const u = (tau - shakeEnd) / ISLAND_TIMING.squeeze;
      const e = u * u;
      w = ISLAND_OPEN.w + (bw * 0.96 - ISLAND_OPEN.w) * e;
      h = ISLAND_OPEN.h + (bh * 0.96 - ISLAND_OPEN.h) * e;
      glow = 1.3;
    } else {
      // nhả bí: phồng giật một cái rồi lắng về đúng phần cứng, glow tắt dần
      const ts = tau - ISLAND_SPIT_AT;
      const bump = Math.exp(-7 * ts) * Math.sin(22 * ts);
      w = bw * (1 + 0.16 * bump);
      h = bh * (1 + 0.3 * bump);
      glow = 1.3 * Math.max(0, 1 - ts / (ISLAND_TIMING.tail * 0.8));
    }

    // giữ mép trên cố định (Live Activity nở xuống dưới); nhỏ hơn gốc thì co về tâm
    const x = ISLAND_CX + jx - w / 2;
    const y = h >= bh ? ISLAND.y : ISLAND_CY - h / 2;
    const pb = Skia.PathBuilder.Make();
    pb.addRRect(Skia.RRectXY(Skia.XYWHRect(x, y, w, h), h / 2, h / 2));
    const pill = pb.build();

    // ── bí mini ──
    let mini = 0;
    let mx = ISLAND_CX;
    let my = ISLAND_CY;
    let mrot = 0;
    let ms = 1;
    const sparks = Skia.PathBuilder.Make();
    if (tau >= ISLAND_ARRIVE && tau < ISLAND_SPIT_AT) {
      mini = 1;
      const k = spring(ta, 15, 0.5);
      const slotX = ISLAND_CX - 38;
      const slotY = ISLAND_CONTENT_Y;
      // co thắt cuối: kéo bí về lại tâm đảo để bàn giao cho bí thật
      const back = smooth((tau - ISLAND_SHAKE_AT) / (ISLAND_SPIT_AT - ISLAND_SHAKE_AT));
      const settle = k * (1 - back);
      mx = ISLAND_CX + (slotX - ISLAND_CX) * settle + jx;
      my = ISLAND_CY + (slotY - ISLAND_CY) * settle + Math.sin(ta * 5.2) * 2.6 * settle;
      // xoay một vòng theo đà bay rồi lắc lư, về đúng 2π lúc nhả
      const rock = 0.3 * Math.sin(ta * 4.4) * k * (1 - back);
      mrot = TAU * (1 - Math.exp(-3 * ta)) + rock;
      if (tau >= ISLAND_SHAKE_AT) mrot += Math.sin(now * 70) * 0.12 * (1 - back * back);
      // nảy "ực" lúc chui vào + to ra trong pill
      ms = (1 + MINI_GROW * settle) * (1 + 0.28 * Math.exp(-8 * ta) * Math.sin(20 * ta));

      // tia lấp lánh + tàn lửa quanh bí mini
      const R = (MINI_BODY * ms) / 2;
      for (let i = 0; i < 12; i++) {
        const r1 = hash(i * 3.7);
        const r2 = hash(i * 9.1 + 2);
        const period = 0.9 + r2 * 0.8;
        const u = ((ta + r1 * period) % period) / period;
        const life = Math.sin(Math.PI * u) * Math.min(1, ta * 3);
        if (life < 0.05) continue;
        const ang = r1 * TAU + ta * 0.6;
        const dist = R * (0.9 + 0.9 * u);
        const px = mx + Math.cos(ang) * dist * 1.25;
        const py = my + Math.sin(ang) * dist * 0.8 - u * 8;
        const s = (0.8 + r2 * 2.2) * life;
        if (i % 3 === 0) {
          sparks.addCircle(px, py, s * 0.6);
        } else {
          // sao 4 cánh
          const q = s * 0.28;
          sparks.moveTo(px, py - s * 1.6);
          sparks.lineTo(px + q, py - q);
          sparks.lineTo(px + s * 1.6, py);
          sparks.lineTo(px + q, py + q);
          sparks.lineTo(px, py + s * 1.6);
          sparks.lineTo(px - q, py + q);
          sparks.lineTo(px - s * 1.6, py);
          sparks.lineTo(px - q, py - q);
          sparks.close();
        }
      }
    }

    // ── chữ BOO! phía sau ──
    const textIn = smooth((ta - 0.22) / 0.25);
    const textOut = 1 - smooth((tau - ISLAND_SHAKE_AT) / 0.18);
    const text = tau >= ISLAND_ARRIVE ? textIn * textOut : 0;
    const tsc = 0.6 + 0.4 * spring(ta - 0.22, 18, 0.35);

    // ── tàn lửa phụt ra lúc nhả bí ──
    const spit = Skia.PathBuilder.Make();
    const st = tau - ISLAND_SPIT_AT;
    if (st >= 0 && st < 0.7) {
      for (let i = 0; i < 16; i++) {
        const r1 = hash(i * 5.3 + 1);
        const r2 = hash(i * 2.1 + 7);
        const a = Math.PI / 2 + (r1 - 0.5) * 2.4;
        const sp = 90 + r2 * 160;
        const px = ISLAND_CX + Math.cos(a) * sp * st * 1.4;
        const py = ISLAND_CY + 10 + Math.sin(a) * sp * st + 260 * st * st;
        const life = 1 - st / 0.7;
        spit.addCircle(px, py, (0.8 + r2 * 1.6) * life);
      }
    }

    return {
      on: 1,
      pill,
      glow,
      mx,
      my,
      mrot,
      ms,
      mini,
      text,
      tx: ISLAND_CX + 30 + jx,
      ty: ISLAND_CONTENT_Y + 1,
      ts: tsc,
      sparks: sparks.build(),
      spit: spit.build(),
    };
  });

  const on = useDerivedValue(() => F.get().on);
  const pill = useDerivedValue(() => F.get().pill);
  const innerGlow = useDerivedValue(() => Math.min(1, F.get().glow));
  const outerGlow = useDerivedValue(() => Math.min(1, F.get().glow) * 0.45);
  const rim = useDerivedValue(() => Math.min(1, F.get().glow * 0.8));
  const miniOp = useDerivedValue(() => F.get().mini);
  const miniT = useDerivedValue(() => {
    const f = F.get();
    return [{ translateX: f.mx }, { translateY: f.my }, { rotate: f.mrot }, { scale: f.ms }];
  });
  const miniGlowR = useDerivedValue(() => MINI_BODY * F.get().ms * 0.75);
  const miniGlowX = useDerivedValue(() => F.get().mx);
  const miniGlowY = useDerivedValue(() => F.get().my);
  const miniGlowOp = useDerivedValue(() => F.get().mini * (0.3 + 0.5 * lit.get()) * Math.min(1, F.get().glow));
  const faceOp = useDerivedValue(() => {
    const t = time.get();
    return lit.get() * (0.85 + 0.1 * Math.sin(t * 13) + 0.05 * Math.sin(t * 29));
  });
  const sparks = useDerivedValue(() => F.get().sparks);
  const spit = useDerivedValue(() => F.get().spit);
  const textOp = useDerivedValue(() => F.get().text);
  const textT = useDerivedValue(() => {
    const f = F.get();
    const wob = Math.sin(time.get() * 6) * 0.06 * f.text;
    return [{ translateX: f.tx }, { translateY: f.ty }, { rotate: wob }, { scale: f.ts }];
  });

  const ix = -IMG / 2 - SKIN_BODY_OFFSET.x * IMG;
  const iy = -IMG / 2 - SKIN_BODY_OFFSET.y * IMG;

  return (
    <>
    {PERF && <PerfHud time={time} />}
    <Group opacity={on}>
      {/* glow cam toả ra ngoài pill */}
      <Path path={pill} color="#ff7a1a" opacity={outerGlow}>
        <BlurMask blur={12} style="outer" />
      </Path>
      <Path path={pill} color="#000000" />
      <Group clip={pill}>
        {/* glow cam ôm sát mép trong */}
        <Path path={pill} style="stroke" strokeWidth={12} color="#ff6a10" opacity={innerGlow}>
          <BlurMask blur={8} style="normal" />
        </Path>
        <Circle cx={miniGlowX} cy={miniGlowY} r={miniGlowR} color="#ff8a2a" opacity={miniGlowOp}>
          <BlurMask blur={10} style="normal" />
        </Circle>
        <Group transform={miniT} opacity={miniOp}>
          {skin && <Image image={skin} x={ix} y={iy} width={IMG} height={IMG} fit="contain" />}
          <Group opacity={faceOp}>
            <Path path={FACE} color="#ffdb7a">
              <BlurMask blur={1.4} style="solid" />
            </Path>
          </Group>
        </Group>
        <Path path={sparks} color="#ffd98a" blendMode="plus">
          <BlurMask blur={1} style="solid" />
        </Path>
        <Group transform={textT} opacity={textOp}>
          <Text x={-textW / 2} y={7} text="BOO!" font={font} color="#ff6a10" opacity={0.7}>
            <BlurMask blur={5} style="normal" />
          </Text>
          <Text x={-textW / 2} y={7} text="BOO!" font={font} color="#ffb24a" />
        </Group>
      </Group>
      {/* viền sáng mảnh */}
      <Path path={pill} style="stroke" strokeWidth={1.2} color="#ff9a3c" opacity={rim} />
      <Path path={spit} color="#ffb04a" blendMode="plus">
        <BlurMask blur={1.4} style="solid" />
      </Path>
    </Group>
    </>
  );
}

/**
 * Vệt bay mờ cam khi bí lao vào / rơi ra khỏi đảo. Vẽ NGAY SAU (dưới) quả bí, pt màn hình.
 * `trail` lấy từ usePumpkinJump().trail.
 */
export function JumpTrail({ trail, time }: { trail: SharedValue<number[]>; time: SharedValue<number> }) {
  const LIFE = 0.22;
  const path = useDerivedValue(() => {
    const tr = trail.get();
    if (tr.length === 0) return EMPTY;
    const now = time.get();
    if (now - tr[tr.length - 1] > LIFE) return EMPTY;
    const b = Skia.PathBuilder.Make();
    for (let i = 0; i < tr.length; i += 4) {
      const age = now - tr[i + 3];
      if (age < 0 || age > LIFE) continue;
      const k = 1 - age / LIFE;
      b.addCircle(tr[i], tr[i + 1], tr[i + 2] * 0.7 * k);
    }
    return b.build();
  });
  return (
    <Group>
      <Path path={path} color="#ff8a2a" opacity={0.35} blendMode="plus">
        <BlurMask blur={8} style="normal" />
      </Path>
      <Path path={path} color="#ffd27a" opacity={0.18} blendMode="plus">
        <BlurMask blur={2} style="normal" />
      </Path>
    </Group>
  );
}
