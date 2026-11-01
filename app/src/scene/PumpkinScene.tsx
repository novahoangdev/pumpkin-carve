import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import {
  BlurMask,
  Canvas,
  Circle,
  Fill,
  Group,
  ImageShader,
  Path,
  Shader,
  drawAsImage,
  type SkImage,
  type SkPath,
} from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  SensorType,
  useAnimatedSensor,
  useAnimatedStyle,
  useDerivedValue,
  interpolateColor,
  useFrameCallback,
  useSharedValue,
  withDecay,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { background } from "../shaders/background";
import { pumpkin } from "../shaders/pumpkin";
import { atmosDepth } from "../shaders/atmos";
import { rain } from "../shaders/rain";
import { TIMESCALE, ms, spring } from "./clock";
import { candleFloorUniforms, candleLight } from "../shaders/candleLight";
import { lightningMap, lightningMapUniforms, lightningThrough, lightningUniforms } from "../shaders/lightningThrough";
import { CAM, CROP, DEPTH, FLAME_W, LANTERN, MASK, PANO, PUMPKIN, ROOF, SHELL, VIEW, fitView, type Fit } from "./layout";
import {
  F0,
  PITCH_MAX,
  PITCH_MIN,
  PUMPKIN_FOOT,
  PUMPKIN_FOOT_W,
  PUMPKIN_MID,
  PUMPKIN_W,
  YAW_MAX,
  ZOOM_MAX,
  ZOOM_MIN,
  baseToScreen,
  localAffine,
  pumpkinToScreen,
  screenToPumpkin,
  viewBasis,
  worldAffine,
  worldToScreen,
  type Basis,
} from "./view";
import { smoothPath, strokeToHole, type Pts } from "../carve/stroke";
import { useCarveMask } from "../carve/useCarveMask";
import { toGpu, useGpuImage } from "../perf/gpu";
import { PoppedPiece } from "../carve/PoppedPiece";
import { Match, MATCH_REST } from "../fx/Match";
import { Bats, batLook } from "../fx/Bats";
import { Gust } from "../fx/Gust";
import { FF_DEMO, flameDemoFinger, useFlameFollow } from "../fx/flameFollow";
import { Smoke } from "../fx/Smoke";
import { BLOW_DEMO, blowFlicker, blowLean, useBlowOut } from "../fx/blowOut";
import { BlackCat } from "../fx/BlackCat";
import { Particles, type Burst } from "../fx/Particles";
import { usePumpkinJump } from "../fx/jump";
import { IslandPill } from "../fx/IslandPill"; // JumpTrail dropped (FEEDBACK 23:xx: the detached beige streak under the pumpkin looked fake)
import { ImpactDust } from "../fx/ImpactDust";
import { fireHaptic, type HapticKind } from "../fx/haptics";
import { boltPoints, currentStrike, flashCurve } from "../fx/storm";
import {
  DEMO as SCRIPT,
  INTRO,
  K,
  REST,
  STENCILS,
  demoLook,
  demoTilt,
  densify,
  introDark,
  introPorch,
  introStorm,
  introView,
  introWobble,
} from "../demo/script";

/** EXPO_PUBLIC_DEMO=1: the app plays the exact storyboard by itself for clip recording. */
const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
/** Clean screen for recordings (FEEDBACK-2300): no title, subtitle or button row. Demo is always clean; the regular app enables it with EXPO_PUBLIC_CLEAN=1. */
const CLEAN = DEMO || process.env.EXPO_PUBLIC_CLEAN === "1";
// tilting the phone = the eye orbits the pumpkin (m at tilt 1) and turns back to look straight at the pumpkin center
const ORBIT_X = 0.16;
const ORBIT_Y = 0.08;
// pumpkin center depth relative to the original camera (m): converts original image pt ↔ m when the pumpkin jumps
const D0 = -[0, 1, 2].reduce((a, i) => a + CAM.rot[2][i] * (PUMPKIN.c[i] - CAM.pos[i]), 0);
const D2R = Math.PI / 180;
const LIGHT_K = 2; // candlelight map resolution (px / original image pt)
/** Fog (atmos.ts) is drawn in its own canvas at 1/ATMOS_DOWN pixel density then scaled back up: ATMOS_DOWN² times cheaper, fog is soft anyway. */
const ATMOS_DOWN = 3;
const clamp = (v: number, a: number, b: number) => {
  "worklet";
  return Math.max(a, Math.min(b, v));
};

type Auto = { at: number; pts: Pts; speed: number };
type Piece = { id: number; path: SkPath };

const sceneAssets = {
  bgLit: require("../../assets/scene/bg_lit.jpg"),
  bgDark: require("../../assets/scene/bg_dark.jpg"),
  bgGlow: require("../../assets/scene/bg_glow.jpg"),
  panoLit: require("../../assets/scene/bg_lit_pano.jpg"),
  panoDark: require("../../assets/scene/bg_dark_pano.jpg"),
  panoGlow: require("../../assets/scene/bg_glow_pano.jpg"),
  shadowLit: require("../../assets/scene/shadow_lit.png"),
  shadowDark: require("../../assets/scene/shadow_dark.png"),
  skinLit: require("../../assets/scene/skin_lit.png"),
  skinDark: require("../../assets/scene/skin_dark.png"),
  inLit: require("../../assets/scene/interior_lit.png"),
  inUnlit: require("../../assets/scene/interior_unlit.png"),
  data: require("../../assets/scene/data.png"),
  flesh: require("../../assets/scene/flesh.jpg"),
  depthB: require("../../assets/scene/bg_depth.png"),
  depthP: require("../../assets/scene/bg_depth_pano.png"),
};

// the pumpkin standing still on the original image: ellipse used for hit testing (carve / jump)
const onPumpkin = (bx: number, by: number) => {
  "worklet";
  const dx = (bx - PUMPKIN_MID[0]) / (CROP.s * 0.47);
  const dy = (by - PUMPKIN_MID[1]) / (CROP.s * 0.36);
  return dx * dx + dy * dy < 1;
};

export function PumpkinScene() {
  const bgLit = useGpuImage(sceneAssets.bgLit);
  const bgDark = useGpuImage(sceneAssets.bgDark);
  const bgGlow = useGpuImage(sceneAssets.bgGlow);
  const panoLit = useGpuImage(sceneAssets.panoLit);
  const panoDark = useGpuImage(sceneAssets.panoDark);
  const panoGlow = useGpuImage(sceneAssets.panoGlow);
  const shadowLit = useGpuImage(sceneAssets.shadowLit);
  const shadowDark = useGpuImage(sceneAssets.shadowDark);
  const skinLit = useGpuImage(sceneAssets.skinLit);
  const skinDark = useGpuImage(sceneAssets.skinDark);
  const inLit = useGpuImage(sceneAssets.inLit);
  const inUnlit = useGpuImage(sceneAssets.inUnlit);
  const data = useGpuImage(sceneAssets.data);
  const flesh = useGpuImage(sceneAssets.flesh);
  const depthB = useGpuImage(sceneAssets.depthB);
  const depthP = useGpuImage(sceneAssets.depthP);

  const carve = useCarveMask();
  // candlelight map leaking through the carved holes: recomputed (GPU, offscreen) whenever the carve mask changes
  const [lightMap, setLightMap] = useState<SkImage | null>(null);
  useEffect(() => {
    if (!depthB) return;
    let live = true;
    const W = Math.round(VIEW.w * LIGHT_K), H = Math.round(VIEW.h * LIGHT_K);
    const u = {
      lk: LIGHT_K,
      view: [VIEW.w, VIEW.h],
      cam0: CAM.pos,
      camX: CAM.rot[0],
      camY: CAM.rot[1],
      camZ: CAM.rot[2],
      focal: CAM.f,
      pc: PUMPKIN.c,
      pr: PUMPKIN.r,
      flameW: FLAME_W,
      shell: SHELL,
      crop: [CROP.x, CROP.y, CROP.s],
      maskK: MASK / CROP.s,
      dK: depthB.width() / VIEW.w,
      dRange: [DEPTH.min, Math.log(DEPTH.max / DEPTH.min)],
    };
    drawAsImage(
      <Fill>
        <Shader source={candleLight} uniforms={u}>
          <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
          <ImageShader image={depthB} tx="clamp" ty="clamp" />
          <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
        </Shader>
      </Fill>,
      { width: W, height: H },
    ).then((img) => live && setLightMap(toGpu(img)));
    return () => {
      live = false;
    };
  }, [carve.images.blur, carve.images.mask, depthB]);
  // lightning through the carved face: patch on the boards, baked once per mask change (lightningThrough.ts)
  const [ltMap, setLtMap] = useState<SkImage | null>(null);
  useEffect(() => {
    if (!depthB) return;
    let live = true;
    drawAsImage(
      <Fill>
        <Shader source={lightningMap} uniforms={lightningMapUniforms(1, depthB.width())}>
          <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
          <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
          <ImageShader image={depthB} tx="clamp" ty="clamp" />
        </Shader>
      </Fill>,
      { width: Math.round(VIEW.w), height: Math.round(VIEW.h) },
    ).then((img) => live && setLtMap(toGpu(img)));
    return () => {
      live = false;
    };
  }, [carve.images.blur, carve.images.mask, depthB]);
  const ready = !!(
    bgLit && bgDark && bgGlow && panoLit && panoDark && panoGlow && shadowLit && shadowDark &&
    skinLit && skinDark && inLit && inUnlit && data && flesh && depthB && depthP && lightMap && ltMap
  );
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [lit, setLit] = useState(false);
  const fit = useSharedValue<Fit>({ k: 1, ox: 0, oy: 0 });
  const [fitState, setFitState] = useState<Fit>({ k: 1, ox: 0, oy: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });

  // ── clock + lighting state ──
  const time = useSharedValue(0);
  const porch = useSharedValue(1);
  const candle = useSharedValue(0);
  const flash = useSharedValue(0);
  const storm = useSharedValue(0); // lightning flash
  const boltA = useSharedValue(0);
  const bolt = useSharedValue<number[][]>(boltPoints(0, 0.5, 1));
  const strikeSeed = useSharedValue(0);
  const introHap = useSharedValue(0);
  const litAt = useSharedValue(-1);
  const batsAt = useSharedValue(-1);
  const batsFired = useSharedValue(false);
  const uiFade = useSharedValue(0);

  // ── view camera: the user drags the background to look around, pinches to zoom; the intro zooms in from afar ──
  const yawU = useSharedValue(0);
  const pitchU = useSharedValue(0);
  const zoomU = useSharedValue(1);
  const look0 = useSharedValue({ yaw: 0, pitch: 0, zoom: 1 });
  const basis = useSharedValue<Basis>(viewBasis({ yaw: 0, pitch: 0, zoom: 1 }));

  // ── carving ──
  const pts = useSharedValue<Pts>([]); // knife stroke points on the original image (pt)
  const mode = useSharedValue<"none" | "carve" | "match" | "look">("none");
  const sawLen = useSharedValue(0);
  const finger = useSharedValue({ x: 0, y: 0, a: 0 }); // virtual finger (screen)
  const auto = useSharedValue<Auto[]>([]);
  const bursts = useSharedValue<Burst[]>([]);
  // pumpkin flesh debris while carving: fully off (Hoa 23:3x — debris on the floor looked like it was floating); Particles now only does embers after lighting
  const noDebris = useSharedValue<typeof bursts.value>([]);
  const holeN = useSharedValue(0);
  const autoIdx = useSharedValue(0);
  const tapIdx = useSharedValue(0);

  // ── match (screen coordinates) ──
  const mx = useSharedValue(MATCH_REST.x);
  const my = useSharedValue(MATCH_REST.y);
  const burn = useSharedValue(0);
  const matchFade = useSharedValue(0);

  // ── blowing out the candle (mic or demo script, fx/blowOut.ts): once the candle is out the match reappears on the porch, tap to relight ──
  const blow = useBlowOut({
    time,
    candle,
    porch,
    litAt,
    demo: DEMO,
    onOut: () => {
      "worklet";
      mx.set(MATCH_REST.x);
      my.set(MATCH_REST.y);
      burn.set(0);
      matchFade.set(withDelay(900, withTiming(0, { duration: 500 })));
    },
  });
  const relitDemo = useSharedValue(0);

  // ── tilt: gyro (real device) or script (demo) → carved hole parallax + slight camera rotation ──
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 16 });
  const tilt = useSharedValue<[number, number]>([0, 0]);
  const grav0 = useSharedValue<number | null>(null);

  // ── pumpkin jump / flight into the Dynamic Island ──
  const anchor = useSharedValue({ x: VIEW.w / 2, y: VIEW.h * 0.78, w: 240 });
  const jump = usePumpkinJump({ time, anchor });
  // the flame follows the finger (demo: virtual finger; app: real touch)
  const touch = useSharedValue({ x: 0, y: 0, a: 0 });
  const ffFinger = DEMO ? finger : touch;
  const ff = useFlameFollow({ time, basis, finger: ffFinger, candle, jumpOff: jump.off, width: anchor });

  // React Compiler skips this component (`time` is passed into a later hook → "may be modified later"); keep manual useCallback as in
  // every previous recording so memo behavior does not change right before the final cut.
  /* eslint-disable react-hooks/preserve-manual-memoization */
  const commitStroke = useCallback(
    (p: Pts) => {
      const hole = strokeToHole(p);
      if (!hole) {
        fireHaptic("error");
        return;
      }
      carve.add(hole.path);
      const b = hole.path.computeTightBounds();
      const burst = { x: b.x + b.width / 2, y: b.y + b.height / 2, rx: b.width / 2, ry: b.height / 2, t: time.get() + 0.12, seed: Math.random() * 100 };
      bursts.set([...bursts.get().slice(-5), burst]);
      setPieces((ps) => [...ps, { id: Date.now() + Math.random(), path: hole.path }]);
      fireHaptic("light");
    },
    [carve, bursts, time],
  );
  /* eslint-enable react-hooks/preserve-manual-memoization */

  const onLit = useCallback(() => {
    setLit(true);
    setTimeout(() => fireHaptic("heavy"), ms(390));
    setTimeout(() => fireHaptic("success"), ms(620));
  }, []);

  const batHaptics = useCallback(() => {
    for (let i = 0; i < 7; i++) setTimeout(() => fireHaptic(i % 3 === 0 ? "medium" : "light"), ms(i * 90));
  }, []);

  /** Light the candle: porch light goes off, fully dark for 0.3s, the candle flares (overshoot) then flickers. Called on the UI thread. */
  const lightUp = () => {
    "worklet";
    if (litAt.value >= 0 && blow.outAt.value < 0) return;
    blow.relit();
    litAt.set(time.value);
    porch.set(withTiming(0, { duration: ms(90) }));
    candle.set(withDelay(ms(390), withSequence(withTiming(1.45, { duration: ms(150) }), withSpring(1, spring({ damping: 7, stiffness: 120 })))));
    flash.set(withDelay(ms(390), withSequence(withTiming(1, { duration: ms(50) }), withTiming(0, { duration: ms(650) }))));
    matchFade.set(withDelay(ms(250), withTiming(1, { duration: ms(300) })));
    burn.set(withDelay(ms(250), withTiming(0, { duration: ms(300) })));
    uiFade.set(withDelay(ms(600), withTiming(1, { duration: ms(900) })));
    if (!DEMO && batsAt.value < 0) batsAt.set(time.value + 4.2);
    scheduleOnRN(onLit);
  };

  /** The flame on screen (following the view camera + the jumping pumpkin). */
  const flameScreen = () => {
    "worklet";
    const [x, y] = worldToScreen(basis.value, FLAME_W);
    const o = jump.off.value;
    return [x + o.x, y + o.y] as const;
  };

  /** The candle was blown out: tap the match → it strikes itself, lifts up, lowers into the pumpkin mouth and relights. */
  const strikeMatch = () => {
    "worklet";
    if (blow.outAt.value < 0 || mode.value === "match") return;
    const [fx, fy] = flameScreen();
    burn.set(withTiming(1, { duration: 160 }));
    mx.set(withDelay(60, withTiming(fx + 6, { duration: 760, easing: Easing.inOut(Easing.cubic) })));
    my.set(
      withSequence(
        withTiming(Math.min(my.value, fy + 16) - 70, { duration: 360, easing: Easing.out(Easing.quad) }),
        withTiming(fy + 16, { duration: 460, easing: Easing.inOut(Easing.quad) }, (done) => {
          "worklet";
          if (done) lightUp();
        }),
      ),
    );
  };

  // own start mark: the callback is re-registered on every component render, timeSinceFirstFrame resets to 0
  // the clock only runs once the scene images have loaded (the big panorama loads slowly), so the intro is not lost
  const t0 = useSharedValue(-1);
  const readyS = useSharedValue(false);
  useEffect(() => readyS.set(ready), [ready, readyS]);
  useFrameCallback(({ timestamp }) => {
    "worklet";
    if (!readyS.value) return;
    // wait for textures to reach the GPU and for the GPU to compile shaders on the first frame (demo: wait longer so the opening zoom is not lost)
    if (t0.value < 0) t0.set(timestamp + (DEMO ? 1600 : 700));
    const t = Math.max(0, ((timestamp - t0.value) / 1000) * TIMESCALE);
    time.set(t);

    // tilt
    if (DEMO) tilt.set(demoTilt(t, litAt.value));
    else if (gravity.isAvailable) {
      const g = gravity.sensor.value;
      if (grav0.value === null && (g.x !== 0 || g.y !== 0)) grav0.set(g.y);
      // the "held level" reference drifts slowly toward the current pose (~3s) so changing between sitting/lying does not get stuck tilted
      const base = grav0.value ?? g.y;
      grav0.set(base + (g.y - base) * 0.003);
      const tx = clamp((g.x / 9.81) * 2.6, -1, 1);
      const ty = clamp(((g.y - base) / 9.81) * 2.6, -1, 1);
      const [ox, oy] = tilt.value;
      tilt.set([ox + (tx - ox) * 0.15, oy + (ty - oy) * 0.15]);
    }

    // view camera = rest frame + intro (crane down from the moon) + user + scripted look-around + phone tilt
    const [iy, ip, iz, ioy] = introView(t);
    const [dy0, dp0] = DEMO ? demoLook(t) : [0, 0];
    // demo: camera tilts up-left toward the sky area with the moon while the bats form the text
    const [by, bp] = DEMO && batsAt.value > 0 ? batLook(t - batsAt.value) : [0, 0];
    const dy = dy0 + by, dp = dp0 + bp;
    const [tx, ty] = tilt.value;
    const v = {
      yaw: REST.yaw + yawU.value + iy + dy + Math.atan((tx * ORBIT_X) / D0),
      pitch: REST.pitch + pitchU.value + ip + dp - Math.atan((ty * ORBIT_Y) / D0),
      zoom: REST.zoom * zoomU.value * iz,
      ox: -tx * ORBIT_X,
      oy: REST.oy + ioy + ty * ORBIT_Y,
    };

    // intro: porch light flickers as the camera sweeps past, haptics on the opening lightning and when the camera stops
    if (litAt.value < 0 && t < 2) porch.set(introPorch(t));
    if (introHap.value === 0 && t >= INTRO.flash[0]) {
      introHap.set(1);
      scheduleOnRN(fireHaptic, "heavy" as HapticKind);
    } else if (introHap.value === 1 && t >= INTRO.settle + 0.25) {
      introHap.set(2);
      scheduleOnRN(fireHaptic, "light" as HapticKind);
    }
    // keep the view inside the panorama area (lon ±80°, lat −62..58°): bounds depend on the zoom level
    const halfV = Math.atan(VIEW.h / 2 / (F0 * v.zoom)), halfH = Math.atan(VIEW.w / 2 / (F0 * v.zoom));
    const tiltBase = Math.asin(-CAM.rot[2][2]); // the original camera looks slightly down
    v.pitch = clamp(v.pitch, (PANO.lat[0] + 4) * D2R + halfV - tiltBase, (PANO.lat[1] - 4) * D2R - halfV - tiltBase);
    v.yaw = clamp(v.yaw, (PANO.lon[0] + 6) * D2R + halfH, (PANO.lon[1] - 6) * D2R - halfH);
    const b = viewBasis(v);
    basis.set(b);
    const aff = worldAffine(b, PUMPKIN_FOOT_W);
    anchor.set({ x: aff.sx, y: aff.sy, w: PUMPKIN_W * aff.k });

    // thunderstorm: multi-pulse lightning flash, bolt drawn in the sky
    const st = currentStrike(t, DEMO);
    if (t < INTRO.flash[3] + 0.6) {
      // opening lightning (outside the STRIKES schedule): 2 pulses, bolt next to the moon
      if (strikeSeed.value !== -1) {
        strikeSeed.set(-1);
        bolt.set(boltPoints(INTRO.bolt.az, INTRO.bolt.el, 7));
      }
      const fl = introStorm(t);
      storm.set(fl);
      boltA.set(t < INTRO.flash[3] + 0.1 ? fl : 0);
    } else if (st) {
      if (strikeSeed.value !== st.seed) {
        strikeSeed.set(st.seed);
        bolt.set(boltPoints(st.az, st.el, st.seed));
        scheduleOnRN(fireHaptic, "medium" as HapticKind);
      }
      const fl = flashCurve(st.u);
      storm.set(fl);
      boltA.set(st.u < 0.55 ? fl : 0);
    } else if (storm.value !== 0) {
      storm.set(0);
      boltA.set(0);
    }

    // automatic carve strokes (demo / stencil): the virtual finger traces the stroke at real human speed
    const q = auto.value;
    const i = autoIdx.value;
    if (i < q.length) {
      const s = q[i];
      const total = s.pts.length / 2;
      let len = 0;
      for (let k = 2; k < s.pts.length; k += 2) len += Math.hypot(s.pts[k] - s.pts[k - 2], s.pts[k + 1] - s.pts[k - 1]);
      const u = (t - s.at) / (len / s.speed);
      if (u >= -0.25 && u < 0) {
        const [fx, fy] = pumpkinToScreen(b, s.pts[0], s.pts[1]);
        finger.set({ x: fx, y: fy, a: (u + 0.25) * 4 });
      } else if (u >= 0) {
        const n = Math.min(total, Math.max(2, Math.floor(u * total)));
        pts.set(s.pts.slice(0, n * 2));
        const [fx, fy] = pumpkinToScreen(b, s.pts[(n - 1) * 2], s.pts[(n - 1) * 2 + 1]);
        const prev = finger.value;
        sawLen.set(sawLen.get() + Math.hypot(fx - prev.x, fy - prev.y));
        if (sawLen.value > 18) {
          sawLen.set(0);
          scheduleOnRN(fireHaptic, "select" as HapticKind);
        }
        finger.set({ x: fx, y: fy, a: 1 });
        if (u >= 1) {
          const full = s.pts;
          pts.set([]);
          autoIdx.set(i + 1);
          scheduleOnRN(commitStroke, full);
          finger.set({ x: fx, y: fy, a: i + 1 < q.length && q[i + 1].at - t < 0.6 ? 1 : 0 });
        }
      }
    } else if (DEMO && t > SCRIPT.look[0].t - 0.3 && t < SCRIPT.look[SCRIPT.look.length - 1].t) {
      // demo look-around: the virtual finger drags the background opposite to the rotation
      const [ly, lp] = demoLook(t);
      const a = Math.min(1, (t - SCRIPT.look[0].t + 0.3) / 0.3, (SCRIPT.look[SCRIPT.look.length - 1].t - t) / 0.3);
      finger.set({ x: VIEW.w * 0.62 - ly * 160, y: VIEW.h * 0.34 + lp * 160, a });
    } else if (finger.value.a > 0 && mode.value !== "match") {
      finger.set({ ...finger.value, a: Math.max(0, finger.value.a - 0.08) });
    }

    // demo: tap to make the pumpkin jump (virtual finger taps the pumpkin)
    if (DEMO) {
      const taps = SCRIPT.taps;
      const ti = tapIdx.value;
      if (ti < taps.length && t >= taps[ti]) {
        tapIdx.set(ti + 1);
        const o = jump.off.value;
        const tx2 = aff.sx + o.x + (ti % 2 ? 18 : -14), ty2 = aff.sy + o.y - 70;
        finger.set({ x: tx2, y: ty2, a: 1 });
        jump.tap(tx2, ty2);
      } else if (ti > 0 && ti <= taps.length && t - taps[ti - 1] < 0.25) {
        finger.set({ ...finger.value, a: 1 - (t - taps[ti - 1]) / 0.25 });
      }
    }

    // demo: drag the match into the pumpkin mouth
    if (DEMO && litAt.value < 0) {
      const u = (t - SCRIPT.matchAt) / SCRIPT.matchDur;
      if (u > -0.3 && u < 0) finger.set({ x: MATCH_REST.x, y: MATCH_REST.y, a: (u + 0.3) / 0.3 });
      if (u >= 0) {
        const e = u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u);
        const [fx, fy] = flameScreen();
        const tx3 = fx + 6, ty3 = fy + 16;
        // curved arc: lift up then lower into the mouth
        mx.set(MATCH_REST.x + (tx3 - MATCH_REST.x) * e);
        my.set(MATCH_REST.y + (ty3 - MATCH_REST.y) * e - Math.sin(Math.PI * e) * 70);
        burn.set(Math.min(1, u * 4));
        finger.set({ x: mx.value, y: my.value, a: 1 });
        if (u >= 1) {
          finger.set({ x: mx.value, y: my.value, a: 0 });
          lightUp();
        }
      }
    }
    if (DEMO && litAt.value >= 0) {
      const [ffx, ffy] = flameScreen();
      const g = flameDemoFinger(t - FF_DEMO.at, ffx, ffy, anchor.value.w);
      if (g) finger.set(g);
    }
    if (DEMO && litAt.value >= 0 && batsAt.value < 0 && t >= SCRIPT.bats) batsAt.set(t);
    // demo: blow out (BLOW_DEMO) then the virtual finger taps the match to relight
    if (DEMO && BLOW_DEMO.relight !== null && blow.outAt.value >= 0) {
      const u = t - BLOW_DEMO.relight;
      if (u > -0.3 && u < 0) finger.set({ x: MATCH_REST.x, y: MATCH_REST.y + 20, a: (u + 0.3) / 0.3 });
      else if (u >= 0 && relitDemo.value === 0) {
        relitDemo.set(1);
        finger.set({ x: MATCH_REST.x, y: MATCH_REST.y + 20, a: 1 });
        strikeMatch();
      }
    }

    // bats: haptic buzz when they start
    const ba = batsAt.value;
    if (ba > 0 && t >= ba && !batsFired.value) {
      batsFired.set(true);
      scheduleOnRN(batHaptics);
    }
  });

  useEffect(() => holeN.set(carve.holes.length), [carve.holes.length, holeN]);

  useEffect(() => {
    if (!DEMO) return;
    auto.set(SCRIPT.strokes);
    autoIdx.set(0);
  }, [auto, autoIdx]);

  // ── gesture ──
  const toDesign = (x: number, y: number) => {
    "worklet";
    const f = fit.value;
    return [(x - f.ox) / f.k, (y - f.oy) / f.k] as const;
  };
  /** Release after looking around: coast with inertia then slowly return to the main frame. */
  const settleView = (vx: number, vy: number) => {
    "worklet";
    const f = F0 * zoomU.value;
    yawU.set(withSequence(withDecay({ velocity: -vx / f, clamp: [-YAW_MAX, YAW_MAX] }), withDelay(2200, withSpring(0, { damping: 20, stiffness: 40 }))));
    pitchU.set(withSequence(withDecay({ velocity: vy / f, clamp: [PITCH_MIN, PITCH_MAX] }), withDelay(2200, withSpring(0, { damping: 20, stiffness: 40 }))));
  };
  const pan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(3)
    .enabled(!DEMO)
    .onStart((e) => {
      const [x, y] = toDesign(e.x - e.translationX, e.y - e.translationY);
      if ((litAt.value < 0 || blow.outAt.value >= 0) && Math.hypot(x - mx.value, y - (my.value + 20)) < 46) {
        mode.set("match");
        return;
      }
      const bp = screenToPumpkin(basis.value, x, y);
      const canCarve = onPumpkin(bp[0], bp[1]) && jump.phase.value === "rest" && autoIdx.value >= auto.value.length;
      if (canCarve) {
        mode.set("carve");
        pts.set([bp[0], bp[1]]);
        sawLen.set(0);
        return;
      }
      mode.set("look");
      look0.set({ yaw: yawU.value, pitch: pitchU.value, zoom: zoomU.value });
    })
    .onUpdate((e) => {
      const [x, y] = toDesign(e.x, e.y);
      if (mode.value === "match") {
        mx.set(x);
        my.set(y - 20);
        if (burn.value === 0 && Math.hypot(x - MATCH_REST.x, y - MATCH_REST.y) > 14) burn.set(withTiming(1, { duration: 180 }));
        return;
      }
      if (mode.value === "look") {
        const f = F0 * zoomU.value * fit.value.k;
        yawU.set(clamp(look0.value.yaw - e.translationX / f, -YAW_MAX, YAW_MAX));
        pitchU.set(clamp(look0.value.pitch + e.translationY / f, PITCH_MIN, PITCH_MAX));
        return;
      }
      if (mode.value !== "carve") return;
      const bp = screenToPumpkin(basis.value, x, y);
      const p = pts.value;
      const lx = p[p.length - 2], ly = p[p.length - 1];
      const d = Math.hypot(bp[0] - lx, bp[1] - ly);
      if (d < 2.5) return;
      pts.set([...p, bp[0], bp[1]]);
      sawLen.set(sawLen.get() + d);
      if (sawLen.value > 18) {
        sawLen.set(0);
        scheduleOnRN(fireHaptic, "select" as HapticKind);
      }
    })
    .onFinalize((e, success) => {
      if (mode.value === "match") {
        const [fx, fy] = flameScreen();
        const near = Math.hypot(mx.value - fx, my.value - fy) < 60;
        if (success && near && holeN.value > 0 && jump.phase.value === "rest") lightUp();
        else {
          mx.set(withSpring(MATCH_REST.x));
          my.set(withSpring(MATCH_REST.y));
          burn.set(withTiming(0, { duration: 250 }));
        }
      } else if (mode.value === "carve") {
        const p = pts.value;
        pts.set([]);
        if (success && p.length >= 6) scheduleOnRN(commitStroke, p);
      } else if (mode.value === "look") {
        settleView(e.velocityX / fit.value.k, e.velocityY / fit.value.k);
      }
      mode.set("none");
    });
  // tap on the pumpkin: jump (rapid taps → fly into the Dynamic Island)
  const tap = Gesture.Tap()
    .maxDuration(300)
    .maxDistance(10)
    .enabled(!DEMO)
    .onEnd((e, success) => {
      if (!success) return;
      const [x, y] = toDesign(e.x, e.y);
      if (blow.outAt.value >= 0 && Math.hypot(x - mx.value, y - (my.value + 20)) < 46) {
        strikeMatch();
        return;
      }
      const o = jump.off.value;
      const bp = screenToPumpkin(basis.value, x - o.x, y - o.y);
      if (onPumpkin(bp[0], bp[1])) jump.tap(x, y);
    });
  const pinch = Gesture.Pinch()
    .enabled(!DEMO)
    .onStart(() => {
      look0.set({ yaw: yawU.value, pitch: pitchU.value, zoom: zoomU.value });
    })
    .onUpdate((e) => {
      zoomU.set(clamp(look0.value.zoom * e.scale, ZOOM_MIN, ZOOM_MAX));
    })
    .onEnd(() => {
      zoomU.set(withDelay(2200, withSpring(1, { damping: 20, stiffness: 40 })));
    });
  // real touch (app): the flame leans toward wherever the finger is, runs alongside pan / tap / pinch
  const touchG = Gesture.Manual()
    .enabled(!DEMO)
    .manualActivation(true)
    .onTouchesDown((e) => {
      const p = e.allTouches[0];
      const [x, y] = toDesign(p.x, p.y);
      touch.set({ x, y, a: 1 });
    })
    .onTouchesMove((e) => {
      const p = e.allTouches[0];
      const [x, y] = toDesign(p.x, p.y);
      touch.set({ x, y, a: 1 });
    })
    .onTouchesUp((e) => {
      if (e.numberOfTouches === 0) touch.set({ ...touch.value, a: 0 });
    })
    .onTouchesCancelled(() => touch.set({ ...touch.value, a: 0 }));
  const gesture = Gesture.Simultaneous(touchG, Gesture.Race(pinch, pan, tap));

  const playStencil = (name: string) => {
    if (autoIdx.value < auto.value.length) return;
    carve.reset();
    let at = time.value + 0.2;
    const list: Auto[] = STENCILS[name].map((s) => {
      const p = densify(s);
      const item = { at, pts: p, speed: 420 * K };
      let len = 0;
      for (let k = 2; k < p.length; k += 2) len += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
      at += len / (420 * K) + 0.18;
      return item;
    });
    auto.set(list);
    autoIdx.set(0);
  };

  const resetAll = () => {
    carve.reset();
    setPieces([]);
    setLit(false);
    litAt.set(-1);
    batsAt.set(-1);
    batsFired.set(false);
    auto.set([]);
    autoIdx.set(0);
    pts.set([]);
    flash.set(0);
    grav0.set(null);
    blow.relit();
    relitDemo.set(0);
    porch.set(withTiming(1, { duration: 300 }));
    candle.set(withTiming(0, { duration: 200 }));
    uiFade.set(withTiming(0, { duration: 300 }));
    matchFade.set(withTiming(0, { duration: 300 }));
    mx.set(MATCH_REST.x);
    my.set(MATCH_REST.y);
    burn.set(0);
    yawU.set(withSpring(0));
    pitchU.set(withSpring(0));
    zoomU.set(withSpring(1));
  };

  // ── uniforms ──
  const flick = useDerivedValue(() => {
    const t = time.value;
    const n = (Math.sin(t * 11.3) * 0.06 + Math.sin(t * 23.7 + 1.3) * 0.04 + Math.sin(t * 5.1 + 0.4) * 0.05) * (1 + 1.6 * ff.value.gust);
    const jerk = Math.sin(t * 2.3) > 0.97 ? -0.12 : 0;
    return candle.value * (0.9 + n + jerk) * blowFlicker(t, blow.gust.value);
  });
  // jump transform (screen → original image) shared by the shaders
  const viewU = useDerivedValue(() => {
    const b = basis.value;
    const k = Math.max(anchor.value.w / PUMPKIN_W, 1e-3);
    const o = jump.off.value;
    const jx = o.x / k, jy = o.y / k;
    const wob = introWobble(time.value);
    const m = D0 / CAM.f;
    return {
      view: [VIEW.w, VIEW.h],
      vX: b.x,
      vY: b.y,
      vZ: b.z,
      vf: b.f,
      eye: b.e,
      cam0: CAM.pos,
      camX: CAM.rot[0],
      camY: CAM.rot[1],
      camZ: CAM.rot[2],
      focal: CAM.f,
      pc: PUMPKIN.c,
      pr: PUMPKIN.r,
      jFoot: [PUMPKIN_FOOT[0], PUMPKIN_FOOT[1]],
      jMid: [PUMPKIN_MID[0], PUMPKIN_MID[1]],
      jOff: [jx, jy],
      jW: [0, 1, 2].map((i) => (CAM.rot[0][i] * jx - CAM.rot[1][i] * jy) * m),
      jSq: [jump.sx.value * (1 + wob[1]), jump.sy.value * (1 - wob[1])],
      jRot: jump.rot.value + wob[0],
      jScale: jump.scale.value,
    };
  });
  // scene depth: shared by the background (reconstructed when the eye shifts) and the rain (occlusion)
  const depthU = useDerivedValue(() => ({
    ...viewU.value,
    dK: depthB ? depthB.width() / VIEW.w : 1,
    dpSize: depthP ? [depthP.width(), depthP.height()] : [1, 1],
    dRange: [DEPTH.min, Math.log(DEPTH.max / DEPTH.min)],
    pFwd: PANO.fwd,
    pRight: PANO.right,
    pRange: [PANO.lon[0] * D2R, PANO.lon[1] * D2R, PANO.lat[0] * D2R, PANO.lat[1] * D2R],
  }));
  const bgU = useDerivedValue(() => ({
    ...depthU.value,
    bgK: bgLit ? bgLit.width() / VIEW.w : 1,
    shK: shadowLit ? shadowLit.width() / VIEW.w : 1,
    pSize: panoLit ? [panoLit.width(), panoLit.height()] : [1, 1],
    porch: porch.value,
    candle: flick.value,
    storm: storm.value,
    jumpH: jump.height.value / Math.max(anchor.value.w / PUMPKIN_W, 1e-3),
    // drawAsImage may render at the device pixel density: take the real ratio from the image size
    lk: lightMap ? lightMap.width() / VIEW.w : LIGHT_K,
    fOff: ff.value.off,
    ...candleFloorUniforms(time.value, PUMPKIN_FOOT),
  }));
  const rainU = useDerivedValue(() => ({
    ...depthU.value,
    time: time.value,
    porch: porch.value,
    candle: jump.hidden.value ? 0 : flick.value,
    storm: storm.value,
    roof: ROOF.slice(0, 4),
    eave: ROOF[4],
    hidden: jump.hidden.value ? 1 : 0,
    bolt: bolt.value.flat(),
    boltA: boltA.value,
  }));
  // lightning through the holes (lightningThrough.ts); the wall face is lightMap.g (candleLight.ts)
  const ltU = useDerivedValue(() => ({
    ...depthU.value,
    ...lightningUniforms(storm.value * (holeN.value > 0 ? 1 : 0), flick.value, jump.hidden.value, ltMap ? ltMap.width() / VIEW.w : 1),
    imgS: inLit ? inLit.width() : 1,
  }));
  const pU = useDerivedValue(() => ({
    ...viewU.value,
    crop: [CROP.x, CROP.y, CROP.s],
    imgS: skinLit ? skinLit.width() : 1,
    maskS: MASK,
    porch: porch.value,
    storm: storm.value,
    candle: flick.value,
    time: time.value,
    flameW: FLAME_W,
    shell: SHELL,
    lean: -tilt.value[0] * 0.9 + Math.sin(time.value * 1.7) * 0.08 - jump.rot.value * 2 + blowLean(time.value, blow.gust.value) + ff.value.lean,
    fStretch: ff.value.stretch,
    fGust: ff.value.gust,
    fTip: ff.value.tip,
    gust: blow.gust.value,
    ember: blow.ember.value,
    hidden: jump.hidden.value ? 1 : 0,
  }));
  const aU = useDerivedValue(() => {
    const b = basis.value;
    const [lx, ly] = baseToScreen(b, LANTERN.x, LANTERN.y);
    const [fx, fy] = worldToScreen(b, FLAME_W);
    const o = jump.off.value;
    return {
      ...depthU.value,
      crop: [CROP.x, CROP.y, CROP.s],
      maskS: MASK,
      time: time.value,
      tilt: tilt.value,
      porch: porch.value,
      candle: jump.hidden.value ? 0 : flick.value,
      flame: [fx + o.x, fy + o.y],
      lantern: [lx, ly],
      flash: flash.value,
      fOff: ff.value.off,
      storm: storm.value,
      imgS: skinLit ? skinLit.width() : 1,
      zs: b.f / F0,
      hidden: jump.hidden.value ? 1 : 0,
      pAff: (() => {
        const m = localAffine(b, PUMPKIN_MID[0], PUMPKIN_MID[1]);
        return [m.sx + o.x, m.sy + o.y, m.k];
      })(),
    };
  });

  const fitTransform = useDerivedValue(() => {
    const f = fit.value;
    // haptics: candle flares, bats swarm out, pumpkin lands hard
    const t = time.value;
    const bt = batsAt.value > 0 ? t - batsAt.value : -1;
    let shake = flash.value * 2.2 + (bt > 0 && bt < 1.2 ? (1.2 - bt) * 2.4 : 0);
    const im = jump.impacts.value;
    if (im.length) {
      const last = im[im.length - 1];
      const a = t - last.t;
      if (a >= 0 && a < 0.4) shake += (1 - a / 0.4) * last.strength * 7;
    }
    const sx = Math.sin(t * 61) * shake, sy = Math.cos(t * 53) * shake;
    return [{ translateX: f.ox + sx }, { translateY: f.oy + sy }, { scale: f.k }];
  });
  // low-density fog canvas: same transform, divided by ATMOS_DOWN
  const fitTransformLow = useDerivedValue(() => {
    const t = fitTransform.value as { translateX?: number; translateY?: number; scale?: number }[];
    return [{ translateX: t[0].translateX! / ATMOS_DOWN }, { translateY: t[1].translateY! / ATMOS_DOWN }, { scale: t[2].scale! / ATMOS_DOWN }];
  });
  // overlay layers attached to the pumpkin (knife trail, rind piece, debris, bats): approximate affine original image → screen
  const pumpkinTransform = useDerivedValue(() => {
    const a = localAffine(basis.value, PUMPKIN_MID[0], PUMPKIN_MID[1]);
    return [
      { translateX: a.sx },
      { translateY: a.sy },
      { scale: a.k },
      { translateX: -PUMPKIN_MID[0] },
      { translateY: -PUMPKIN_MID[1] },
    ];
  });
  const trail = useDerivedValue(() => smoothPath(pts.value));
  const fingerX = useDerivedValue(() => finger.value.x);
  const fingerY = useDerivedValue(() => finger.value.y);
  const fingerA = useDerivedValue(() => (DEMO ? finger.value.a * 0.85 : 0));
  const blackout = useDerivedValue(() => {
    // fully dark for ~0.3s between the porch light going off and the candle flaring
    const la = litAt.value;
    if (la < 0) return introDark(time.value);
    const u = time.value - la;
    return u < 0.39 ? Math.min(1, u / 0.09) * 0.55 : Math.max(0, 0.55 - (u - 0.39) * 4);
  });

  // title flashes white with the opening lightning then cools to warm orange; subtitle appears after
  const titleStyle = useAnimatedStyle(() => {
    const t = time.value;
    const f = INTRO.flash;
    const on = t >= f[0] ? 1 : 0;
    const dim = t >= f[1] && t < f[2] ? 0.45 : 1;
    return {
      opacity: on * dim,
      color: interpolateColor(t, [f[0], f[3], f[3] + 0.5, f[3] + 1.4], ["#ffffff", "#fff3dc", "#ffc27a", "#ffb35c"]),
      textShadowColor: interpolateColor(t, [f[0], f[3] + 1.2], ["#ffffffcc", "#ff7a1a66"]),
    };
  });
  const subStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, (time.value - 1.2) / 0.6)) * 0.7 }));
  const uiStyle = useAnimatedStyle(() => ({ opacity: 1 - uiFade.value }));
  // the title (RN view above the canvas) makes room for the expanding Dynamic Island
  const headerStyle = useAnimatedStyle(() => {
    const p = jump.phase.value;
    const open = p === "toIsland" || p === "island" || (p === "drop" && jump.islandT.value >= 0 && time.value - jump.islandT.value < 3.2);
    return { opacity: withTiming(open ? 0 : 1, { duration: ms(open ? 160 : 450) }) };
  });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const f = fitView(width, height);
    fit.set(f);
    setFitState(f);
    setSize({ w: width, h: height });
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Canvas style={StyleSheet.absoluteFill}>
          {ready && (
            <Group transform={fitTransform}>
              <Fill>
                <Shader source={background} uniforms={bgU}>
                  <ImageShader image={bgLit} tx="clamp" ty="clamp" />
                  <ImageShader image={bgDark} tx="clamp" ty="clamp" />
                  <ImageShader image={bgGlow} tx="clamp" ty="clamp" />
                  <ImageShader image={panoLit} tx="clamp" ty="clamp" />
                  <ImageShader image={panoDark} tx="clamp" ty="clamp" />
                  <ImageShader image={panoGlow} tx="clamp" ty="clamp" />
                  <ImageShader image={shadowLit} tx="clamp" ty="clamp" />
                  <ImageShader image={shadowDark} tx="clamp" ty="clamp" />
                  <ImageShader image={lightMap} tx="decal" ty="decal" />
                  <ImageShader image={depthB} tx="clamp" ty="clamp" />
                  <ImageShader image={depthP} tx="clamp" ty="clamp" />
                </Shader>
              </Fill>
              <BlackCat time={time} basis={basis} storm={storm} porch={porch} candle={flick} />
              <Fill>
                <Shader source={pumpkin} uniforms={pU}>
                  <ImageShader image={skinLit} tx="decal" ty="decal" />
                  <ImageShader image={skinDark} tx="decal" ty="decal" />
                  <ImageShader image={inLit} tx="clamp" ty="clamp" />
                  <ImageShader image={inUnlit} tx="clamp" ty="clamp" />
                  <ImageShader image={data} tx="decal" ty="decal" />
                  <ImageShader image={flesh} tx="repeat" ty="repeat" />
                  <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
                </Shader>
              </Fill>
              <Fill blendMode="plus">
                <Shader source={lightningThrough} uniforms={ltU}>
                  <ImageShader image={ltMap} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
                  <ImageShader image={depthB} tx="clamp" ty="clamp" />
                  <ImageShader image={depthP} tx="clamp" ty="clamp" />
                  <ImageShader image={inLit} tx="clamp" ty="clamp" />
                </Shader>
              </Fill>
              <ImpactDust impacts={jump.impacts} time={time} basis={basis} />
              <Group transform={pumpkinTransform}>
                {pieces.map((p) => (
                  <PoppedPiece
                    key={p.id}
                    path={p.path}
                    skinLit={skinLit!}
                    skinDark={skinDark!}
                    porch={porch}
                    onDone={() => setPieces((ps) => ps.filter((q) => q.id !== p.id))}
                  />
                ))}
                {/* knife trail: open cut gap showing bright flesh, lower edge casts a dark shadow, upper edge catches light, wet juice */}
                <Group transform={[{ translateX: 0.7 }, { translateY: 1.1 }]}>
                  <Path path={trail} style="stroke" strokeWidth={3.2} strokeCap="round" strokeJoin="round" color="#3a1404" opacity={0.75}>
                    <BlurMask blur={0.8} style="normal" />
                  </Path>
                </Group>
                <Path path={trail} style="stroke" strokeWidth={2.2} strokeCap="round" strokeJoin="round" color="#e9a548" />
                <Path path={trail} style="stroke" strokeWidth={0.9} strokeCap="round" strokeJoin="round" color="#ffe2a0" />
                <Group transform={[{ translateX: -0.8 }, { translateY: -1.0 }]}>
                  <Path path={trail} style="stroke" strokeWidth={0.6} strokeCap="round" strokeJoin="round" color="#fff4dc" opacity={0.55} />
                </Group>
              </Group>
              <Particles bursts={noDebris} time={time} litAt={litAt} basis={basis} impacts={jump.impacts} />
              <Gust layer="scene" time={time} basis={basis} />
              <Smoke outAt={blow.outAt} time={time} basis={basis} holes={bursts} porch={porch} storm={storm} />
              <Fill>
                <Shader source={rain} uniforms={rainU}>
                  <ImageShader image={depthB} tx="clamp" ty="clamp" />
                  <ImageShader image={depthP} tx="clamp" ty="clamp" />
                </Shader>
              </Fill>
              <Match x={mx} y={my} burn={burn} fade={matchFade} time={time} basis={basis} />
            </Group>
          )}
        </Canvas>
      </GestureDetector>
      {/* fog: 1/ATMOS_DOWN density canvas, scaled back up by the view transform */}
      {ready && size.w > 0 && (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, top: 0, width: size.w / ATMOS_DOWN, height: size.h / ATMOS_DOWN, transformOrigin: "0 0", transform: [{ scale: ATMOS_DOWN }] }}
        >
          <Canvas style={StyleSheet.absoluteFill}>
            <Group transform={fitTransformLow}>
              <Fill>
                <Shader source={atmosDepth} uniforms={aU}>
                  <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
                  <ImageShader image={skinLit} tx="decal" ty="decal" />
                  <ImageShader image={depthB} tx="clamp" ty="clamp" />
                  <ImageShader image={depthP} tx="clamp" ty="clamp" />
                </Shader>
              </Fill>
            </Group>
          </Canvas>
        </View>
      )}
      {/* layer above the fog: bats, blackout, virtual finger, Dynamic Island */}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {ready && (
          <Group transform={fitTransform}>
              <Gust layer="fg" time={time} basis={basis} />
              <Bats t0={batsAt} time={time} basis={basis} sky={DEMO} />
              <Fill color="black" opacity={blackout} />
              {/* virtual finger (demo only) */}
              <Group opacity={fingerA}>
                <Circle cx={fingerX} cy={fingerY} r={17} color="#ffffff" opacity={0.22} />
                <Circle cx={fingerX} cy={fingerY} r={17} color="#ffffff" opacity={0.55} style="stroke" strokeWidth={1.5} />
              </Group>
          </Group>
        )}
          {ready && <IslandPill islandT={jump.islandT} time={time} skin={skinLit} lit={candle} />}
      </Canvas>

      {!CLEAN && (
        <Animated.View style={[StyleSheet.absoluteFill, uiStyle]} pointerEvents={lit ? "none" : "box-none"}>
          <Animated.View style={[styles.header, { top: fitState.oy + 64 * fitState.k }, headerStyle]} pointerEvents="none">
            <Animated.Text style={[styles.title, titleStyle]}>PUMPKIN CARVE</Animated.Text>
            <Animated.Text style={[styles.subtitle, subStyle]}>carve · tap · look around · light the match</Animated.Text>
          </Animated.View>
          <View style={[styles.bar, { bottom: 34 }]} pointerEvents="box-none">
            <Chip label="Undo" onPress={carve.undo} />
            <Chip label="Reset" onPress={resetAll} />
            <View style={styles.sep} />
            {Object.keys(STENCILS).map((k) => (
              <Chip key={k} label={k[0].toUpperCase() + k.slice(1)} onPress={() => playStencil(k)} />
            ))}
          </View>
        </Animated.View>
      )}
      {lit && !DEMO && (
        <Pressable style={styles.again} onPress={resetAll}>
          <Text style={styles.againText}>↺</Text>
        </Pressable>
      )}
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141a33" },
  header: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  title: { color: "#ffb35c", fontSize: 15, fontWeight: "800", letterSpacing: 5, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
  subtitle: { color: "#c8d2f0", fontSize: 12, marginTop: 4, letterSpacing: 1 },
  bar: { position: "absolute", left: 14, right: 74, flexDirection: "row", justifyContent: "flex-start", alignItems: "center", gap: 5 },
  sep: { width: 1, height: 18, backgroundColor: "#ffffff40", marginHorizontal: 4 },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: "#0b0f22b0",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ffd9a860",
  },
  chipText: { color: "#ffe3bf", fontSize: 11.5, fontWeight: "600" },
  again: {
    position: "absolute",
    right: 22,
    bottom: 40,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0b0f2290",
  },
  againText: { color: "#ffe3bf", fontSize: 20 },
});
