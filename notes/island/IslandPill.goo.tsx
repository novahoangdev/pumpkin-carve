import React, { useMemo } from "react";
import { BlurMask, Circle, Group, Image, Path, Rect, Shader, Skia, Text, matchFont, type SkImage } from "react-native-skia";
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
  JUMP,
  MINI_BODY,
  PUMPKIN_ASPECT,
} from "./jump";
import { VIEW } from "../scene/layout";
import { GOO_MARGIN, islandGooEffect } from "../shaders/islandGoo";
import { PERF, PerfHud } from "../perf/PerfHud";

/** Thân bí chiếm bao nhiêu phần bề ngang ảnh skin (ảnh crop vuông). Chỉnh nếu bí mini to/nhỏ hơn bí thật lúc bàn giao. */
export const SKIN_BODY_FRAC = 0.8;
/** Tâm thân bí lệch so với tâm ảnh skin (tỉ lệ cạnh ảnh, dương = xuống/phải). */
export const SKIN_BODY_OFFSET = { x: 0, y: 0.04 };
/** Bí mini to thêm bao nhiêu khi nằm trong pill đã nở. */
const MINI_GROW = 0.35;
const IMG = MINI_BODY / SKIN_BODY_FRAC;
const SNAP = 0.22; // s sau lúc nhả thì sợi goo đứt
const EMPTY = Skia.PathBuilder.Make().build();

// vùng vẽ shader goo (pt màn hình)
const RX = ISLAND_CX - (ISLAND_OPEN.w * 1.1) / 2 - GOO_MARGIN.side;
const RW = ISLAND_OPEN.w * 1.1 + GOO_MARGIN.side * 2;
const RH = ISLAND.y + ISLAND_OPEN.h * 1.12 + GOO_MARGIN.below;

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

const tri = (x: number) => {
  "worklet";
  return Math.max(0, 1 - Math.abs(x));
};

// mặt jack-o'-lantern nhỏ, toạ độ quanh tâm thân bí, bề ngang thân = MINI_BODY. Mắt tách riêng để nháy.
const EYE_Y = -0.1 * MINI_BODY;
const { EYES, MOUTH } = (() => {
  const k = MINI_BODY;
  const mk = (tris: number[][]) => {
    const b = Skia.PathBuilder.Make();
    for (const pts of tris) {
      b.moveTo(pts[0] * k, pts[1] * k);
      for (let i = 2; i < pts.length; i += 2) b.lineTo(pts[i] * k, pts[i + 1] * k);
      b.close();
    }
    return b.build();
  };
  return {
    EYES: mk([
      [-0.3, -0.02, -0.1, -0.02, -0.19, -0.18],
      [0.3, -0.02, 0.1, -0.02, 0.19, -0.18],
    ]),
    MOUTH: mk([
      [-0.05, 0.06, 0.05, 0.06, 0, -0.01],
      [-0.32, 0.1, -0.2, 0.15, -0.12, 0.11, -0.04, 0.16, 0.04, 0.11, 0.12, 0.16, 0.2, 0.11, 0.32, 0.1, 0.2, 0.25, 0, 0.29, -0.2, 0.25],
    ]),
  };
})();

type Frame = {
  on: number;
  // hình goo (đơn vị pt màn hình)
  px: number;
  py: number;
  hw: number;
  hh: number;
  a: number[]; // x, y, r, k
  b: number[];
  c1: number[]; // x, y0, y1, r
  c2: number[];
  k: number[];
  glow: number[]; // rim, halo, core, t
  // nội dung Live Activity
  content: number;
  mini: number;
  mx: number;
  my: number;
  mrot: number;
  ms: number;
  eye: number; // scaleY mắt (nháy)
  text: number;
  tx: number;
  ty: number;
  ts: number;
  jx: number;
};

const OFF: Frame = {
  on: 0,
  px: ISLAND_CX,
  py: ISLAND_CY,
  hw: ISLAND.w / 2,
  hh: ISLAND.h / 2,
  a: [0, 0, 0, 0],
  b: [0, 0, 0, 0],
  c1: [0, 0, 0, 0],
  c2: [0, 0, 0, 0],
  k: [0, 0],
  glow: [0, 0, 0, 0],
  content: 0,
  mini: 0,
  mx: ISLAND_CX,
  my: ISLAND_CY,
  mrot: 0,
  ms: 1,
  eye: 1,
  text: 0,
  tx: 0,
  ty: 0,
  ts: 1,
  jx: 0,
};

type Anchor = { x: number; y: number; w: number };

/**
 * Dynamic Island như chất lỏng đen (SDF smooth-min trong `islandGoo.ts`):
 *  1. bí bay tới → đảo vươn một giọt goo xuống đón, nuốt bí rồi nở thành Live Activity với độ nảy jelly;
 *  2. Live Activity: viền cam thở theo nhịp, bí mini có mặt sáng chập chờn như nến + nháy mắt, BOO! nảy ra;
 *  3. nhả: phình lên, rung nhẹ, co thắt, PHỤT bí ra bằng một sợi goo kéo dài rồi đứt như giọt mực,
 *     đảo nảy lại về đúng viên thuốc gốc, đen tuyền.
 * Giữ nguyên mốc ISLAND_TIMING. Vẽ bằng pt MÀN HÌNH, đặt trên cùng (ngoài Group scale cảnh).
 * `anchor` (tuỳ chọn) = anchor của usePumpkinJump để sợi goo bám đúng đỉnh bí đang rơi; thiếu thì lấy chỗ nghỉ mặc định.
 */
export function IslandPill({
  islandT,
  time,
  skin,
  lit,
  anchor,
}: {
  islandT: SharedValue<number>;
  time: SharedValue<number>;
  skin: SkImage | null;
  lit: SharedValue<number>;
  anchor?: SharedValue<Anchor>;
}) {
  const font = useMemo(() => matchFont({ fontFamily: "Helvetica", fontSize: 21, fontWeight: "bold" }), []);
  const textW = useMemo(() => font.measureText("BOO!").width, [font]);

  const F = useDerivedValue<Frame>(() => {
    const t0 = islandT.get();
    const now = time.get();
    const tau = t0 >= 0 ? now - t0 : -1;
    const pre = ISLAND_ARRIVE - 0.34;
    if (tau < pre || tau > ISLAND_END) return OFF;

    const shakeEnd = ISLAND_SHAKE_AT + ISLAND_TIMING.shake;
    const ta = tau - ISLAND_ARRIVE;
    const bw = ISLAND.w;
    const bh = ISLAND.h;
    const OW = ISLAND_OPEN.w;
    const OH = ISLAND_OPEN.h;
    let w = bw;
    let h = bh;
    let jx = 0;
    let rim = 0;
    let halo = 0;
    let core = 0;
    let ax = ISLAND_CX;
    let ay = 0;
    let ar = 0;
    let ak = 0;
    let bx = ISLAND_CX;
    let by = 0;
    let br = 0;
    let bk = 0;
    let c1y0 = 0;
    let c1y1 = 0;
    let c1r = 0;
    let c2y0 = 0;
    let c2y1 = 0;
    let c2r = 0;
    let k1 = 0;
    let k2 = 0;
    const top = ISLAND.y;

    if (tau < ISLAND_ARRIVE) {
      // ── 1. đón: giọt goo vươn xuống, cuối cùng hớp lên chụp lấy quả bí ──
      const u = smooth((tau - pre) / 0.24);
      w = bw * (1 + 0.04 * u);
      h = bh * (1 + 0.06 * u);
      const bottom = top + h;
      ax = ISLAND_CX + Math.sin(now * 7) * 1.5 * u;
      ay = bottom + 1 + 12 * u + Math.sin(now * 11) * 1.2 * u;
      ar = 6 + 6 * u;
      ak = 15; // cổ dày, giọt dính liền vào đảo
      const g = smooth((tau - (ISLAND_ARRIVE - 0.09)) / 0.09);
      ay += (ISLAND_CY + 6 - ay) * g;
      ar += (16 - ar) * g;
      rim = 0.35 * u;
      halo = 0.3 * u;
    } else if (tau < ISLAND_SHAKE_AT) {
      // ── 2. nuốt + nở Live Activity, nảy jelly, thở ──
      const gulp = smooth(ta / 0.2);
      ax = ISLAND_CX;
      ay = ISLAND_CY + 6 + 12 * gulp;
      ar = 16 * (1 - gulp) + 4;
      ak = 10;
      const ks = spring(ta, 15, 0.3);
      const kh = spring(ta - 0.035, 13, 0.27);
      const w0 = bw * 1.04;
      const h0 = bh * 1.12;
      w = w0 + (OW - w0) * ks;
      h = h0 + (OH - h0) * kh;
      const wob = Math.exp(-4 * ta) * Math.sin(22 * ta);
      w += 6 * wob;
      h -= 4 * wob;
      const breathe = 0.5 + 0.5 * Math.sin(now * 3.4);
      w += 1.4 * Math.sin(now * 3.4) * gulp;
      h += 1.0 * Math.sin(now * 3.4 + 0.8) * gulp;
      const on = smooth(ta / 0.25);
      rim = on * (0.5 + 0.45 * breathe + 0.06 * Math.sin(now * 23));
      halo = on * (0.3 + 0.35 * breathe);
      core = on * (0.25 + 0.15 * breathe);
    } else if (tau < shakeEnd) {
      // ── 3a. phình lên, rung nhẹ ──
      const u = (tau - ISLAND_SHAKE_AT) / ISLAND_TIMING.shake;
      const sw = smooth(u * 1.4);
      w = OW * (1 + 0.07 * sw);
      h = OH * (1 + 0.1 * sw);
      const amp = 0.5 + 1.8 * u;
      jx = Math.sin(now * 75) * amp;
      w += Math.sin(now * 61) * amp * 0.9;
      h += Math.cos(now * 53) * amp * 0.6;
      rim = 1 + 0.25 * u + 0.15 * Math.sin(now * 31);
      halo = 0.65 + 0.35 * u;
      core = 0.4 + 0.5 * u;
    } else if (tau < ISLAND_SPIT_AT) {
      // ── 3b. co thắt (bí bị ép xuống đáy, đáy phồng một cục) ──
      const u = (tau - shakeEnd) / ISLAND_TIMING.squeeze;
      const e = u * u;
      w = OW * 1.07 + (bw * 0.97 - OW * 1.07) * e;
      h = OH * 1.1 + (bh * 0.94 - OH * 1.1) * e;
      ax = ISLAND_CX;
      ay = top + bh + 3 * e;
      ar = 4 + 7 * e;
      ak = 9;
      rim = 1.25;
      halo = 1;
      core = 0.9;
    } else {
      // ── 3c. PHỤT: sợi goo bám đỉnh bí đang rơi, kéo dài, đứt; đảo nảy về viên thuốc gốc ──
      const st = tau - ISLAND_SPIT_AT;
      const settle = 1 - smooth((st - 0.42) / 0.26);
      const bump = Math.exp(-6.5 * st) * Math.sin(20 * st) * settle;
      w = bw * (1 - 0.08 * bump);
      h = bh * (1 + 0.2 * bump);
      const fade = 1 - smooth(st / 0.38);
      rim = 1.25 * fade;
      halo = fade;
      core = 0.9 * fade * fade;

      // đỉnh quả bí thật (cùng công thức M_FALL trong jump.ts)
      const A = anchor ? anchor.get() : { x: ISLAND_CX, y: VIEW.h * 0.78, w: 240 };
      const pTop = (tf: number) => {
        const g = JUMP.gravity;
        const v0 = JUMP.dropV0;
        const ph = A.w * PUMPKIN_ASPECT;
        const H = Math.max(1, A.y - ph / 2 - ISLAND_CY);
        const T = (-v0 + Math.sqrt(v0 * v0 + 2 * g * H)) / g;
        const f = clamp01(tf / T);
        const sMini = Math.min(1, Math.max(0.02, MINI_BODY / Math.max(1, A.w)));
        const scl = sMini + (1 - sMini) * smooth(f / 0.85);
        const cy = ISLAND_CY + v0 * tf + 0.5 * g * tf * tf;
        return cy - A.w * scl * PUMPKIN_ASPECT * 0.5 + 3;
      };
      const bottom = (h >= bh ? top : ISLAND_CY - h / 2) + h;
      if (st < SNAP) {
        const u = st / SNAP;
        by = Math.max(pTop(st), bottom - 6);
        br = 7.5 - 2.5 * u;
        bk = 0;
        c1y0 = bottom - 6;
        c1y1 = by;
        c1r = 1.1 + 4.6 * Math.pow(1 - u, 1.6);
        k1 = 8;
        k2 = 7;
        ax = ISLAND_CX;
        ay = bottom + 1;
        ar = 8 * (1 - u);
        ak = 8;
      } else {
        const s2 = st - SNAP;
        // phần trên: mẩu goo còn treo bật ngược vào đảo (lò xo)
        const yS = Math.max(pTop(SNAP), bottom);
        const L = (yS - bottom) * 0.42 * (1 - spring(s2, 24, 0.32));
        const gone = smooth(s2 / 0.3);
        c1y0 = bottom - 6;
        c1y1 = bottom + L;
        c1r = 1.6 * (1 - gone);
        k1 = 6;
        ax = ISLAND_CX;
        ay = bottom + L;
        ar = 3.4 * (1 - gone);
        ak = 5;
        // phần dưới: giọt mực rơi theo bí, đuôi rút lại thành giọt tròn rồi tan
        const shrink = 1 - smooth(s2 / 0.32);
        by = pTop(st) + 2 + 60 * s2 * s2;
        br = 5.5 * shrink;
        bk = 5;
        const tail = 16 * (1 - smooth(s2 / 0.16));
        c2y0 = by - br - tail;
        c2y1 = by;
        c2r = br * 0.38;
        k2 = 3;
      }
    }

    const py = h >= bh ? top + h / 2 : ISLAND_CY;
    const px = ISLAND_CX + jx;

    // ── nội dung Live Activity ──
    let mini = 0;
    let mx = px;
    let my = py;
    let mrot = 0;
    let ms = 1;
    let eye = 1;
    let content = 0;
    let text = 0;
    let tsc = 1;
    let tyHop = 0;
    if (tau >= ISLAND_ARRIVE && tau < ISLAND_SPIT_AT) {
      // bí bị nuốt (tối đi) rồi sáng lên ở khe trái; co thắt thì kéo về tâm, tắt dần để bàn giao cho bí thật
      mini = smooth((ta - 0.1) / 0.22) * (1 - smooth((tau - shakeEnd) / ISLAND_TIMING.squeeze));
      const k = spring(ta - 0.08, 14, 0.42);
      const back = smooth((tau - ISLAND_SHAKE_AT) / (ISLAND_SPIT_AT - ISLAND_SHAKE_AT));
      const settle = k * (1 - back);
      mx = ISLAND_CX + (ISLAND_CX - 40 - ISLAND_CX) * settle + jx;
      my = ISLAND_CY + (ISLAND_CONTENT_Y - ISLAND_CY) * settle + Math.sin(ta * 5.2) * 2.2 * settle;
      mrot = 0.22 * Math.sin(ta * 4.4) * settle;
      if (tau >= ISLAND_SHAKE_AT) mrot += Math.sin(now * 70) * 0.1 * (1 - back);
      ms = (1 + MINI_GROW * settle) * (1 + 0.3 * Math.exp(-7 * Math.max(0, ta - 0.1)) * Math.sin(18 * Math.max(0, ta - 0.1)));
      eye = 1 - 0.92 * Math.max(tri((ta - 0.78) / 0.07), tri((ta - 1.32) / 0.07), tri((ta - 1.46) / 0.06));

      content = smooth((ta - 0.15) / 0.2) * (1 - smooth((tau - ISLAND_SHAKE_AT) / 0.16));
      const tb = ta - 0.3;
      text = tb > 0 ? clamp01(tb / 0.05) * content : 0;
      tsc = spring(tb, 16, 0.28) * (1 + 0.07 * Math.pow(Math.max(0, Math.sin(now * 4.2)), 6));
      tyHop = -8 * Math.exp(-5 * Math.max(0, tb)) * Math.abs(Math.sin(13 * Math.max(0, tb)));
    }

    return {
      on: 1,
      px,
      py,
      hw: w / 2,
      hh: h / 2,
      a: [ax, ay, ar, ak],
      b: [bx, by, br, bk],
      c1: [ISLAND_CX, c1y0, c1y1, c1r],
      c2: [ISLAND_CX, c2y0, c2y1, c2r],
      k: [k1, k2],
      glow: [rim, halo, core, now],
      content,
      mini,
      mx,
      my,
      mrot,
      ms,
      eye,
      text,
      tx: ISLAND_CX + 32 + jx,
      ty: ISLAND_CONTENT_Y + 1 + tyHop,
      ts: tsc,
      jx,
    };
  });

  const on = useDerivedValue(() => F.get().on);
  const rectW = useDerivedValue(() => (F.get().on > 0 ? RW : 0));
  const uniforms = useDerivedValue(() => {
    const f = F.get();
    return { uPill: [f.px, f.py, f.hw, f.hh], uA: f.a, uB: f.b, uC1: f.c1, uC2: f.c2, uK: f.k, uGlow: f.glow };
  });
  const clip = useDerivedValue(() => {
    const f = F.get();
    const r = Math.min(f.hw, f.hh);
    return Skia.RRectXY(Skia.XYWHRect(f.px - f.hw, f.py - f.hh, f.hw * 2, f.hh * 2), r, r);
  });
  const miniOp = useDerivedValue(() => F.get().mini);
  const miniT = useDerivedValue(() => {
    const f = F.get();
    return [{ translateX: f.mx }, { translateY: f.my }, { rotate: f.mrot }, { scale: f.ms }];
  });
  const eyeT = useDerivedValue(() => [{ translateY: EYE_Y }, { scaleY: F.get().eye }, { translateY: -EYE_Y }]);
  // ánh nến bên trong: chập chờn nhiều tần số, mạnh hơn khi nến thật đã thắp
  const flicker = useDerivedValue(() => {
    const t = time.get();
    const fl = 0.8 + 0.1 * Math.sin(t * 13) + 0.07 * Math.sin(t * 29 + 1.3) + 0.05 * Math.sin(t * 47 + 0.4);
    return Math.min(1, fl * (0.9 + 0.15 * lit.get()));
  });
  const miniGlowR = useDerivedValue(() => MINI_BODY * F.get().ms * (0.7 + 0.08 * flicker.get()));
  const miniGlowX = useDerivedValue(() => F.get().mx);
  const miniGlowY = useDerivedValue(() => F.get().my);
  const miniGlowOp = useDerivedValue(() => F.get().mini * F.get().content * 0.55 * flicker.get());
  const textOp = useDerivedValue(() => F.get().text);
  const textGlowOp = useDerivedValue(() => F.get().text * (0.55 + 0.35 * flicker.get()));
  const textT = useDerivedValue(() => {
    const f = F.get();
    const wob = Math.sin(time.get() * 6) * 0.07 * f.text;
    return [{ translateX: f.tx }, { translateY: f.ty }, { rotate: wob }, { scale: f.ts }];
  });


  const ix = -IMG / 2 - SKIN_BODY_OFFSET.x * IMG;
  const iy = -IMG / 2 - SKIN_BODY_OFFSET.y * IMG;

  return (
    <>
      {PERF && <PerfHud time={time} />}
      <Group opacity={on}>
        {/* đảo goo: thân đen + viền cam thở + quầng sáng ngoài */}
        <Rect x={RX} y={0} width={rectW} height={RH}>
          <Shader source={islandGooEffect} uniforms={uniforms} />
        </Rect>
        <Group clip={clip}>
          <Circle cx={miniGlowX} cy={miniGlowY} r={miniGlowR} color="#ff7a1a" opacity={miniGlowOp}>
            <BlurMask blur={9} style="normal" />
          </Circle>
          <Group transform={miniT} opacity={miniOp}>
            {skin && <Image image={skin} x={ix} y={iy} width={IMG} height={IMG} fit="contain" />}
            <Group opacity={flicker}>
              <Group transform={eyeT}>
                <Path path={EYES} color="#ffe08a">
                  <BlurMask blur={1.4} style="solid" />
                </Path>
              </Group>
              <Path path={MOUTH} color="#ffd070">
                <BlurMask blur={1.4} style="solid" />
              </Path>
            </Group>
          </Group>
          <Group transform={textT}>
            <Text x={-textW / 2} y={7} text="BOO!" font={font} color="#ff5a08" opacity={textGlowOp}>
              <BlurMask blur={6} style="normal" />
            </Text>
            <Text x={-textW / 2} y={7} text="BOO!" font={font} color="#ffb24a" opacity={textOp} />
          </Group>
        </Group>
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
