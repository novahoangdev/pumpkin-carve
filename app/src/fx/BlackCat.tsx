import React from "react";
import { Group, ImageShader, Rect, Shader, Skia } from "react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { worldToScreen, type Basis } from "../scene/view";
import { CAM, FLAME_W } from "../scene/layout";
import { currentStrike } from "./storm";
import { useGpuImage } from "../perf/gpu";

/**
 * Easter egg: a black cat sitting on the porch railing.
 *
 * Normally almost invisible: a near-black shape against the night sky, only two yellow-green eye glints that blink and come
 * and go. A lightning flash lights up the sky behind it, so the cat pops out as a crisp silhouette with a cold rim light
 * (backlit by the bolt and the moon), its tail swishing. By the next strike it has moved along the rail and turned its head
 * to stare at the lit pumpkin, or it is gone.
 *
 * 3D: the cat is a camera-facing billboard anchored at a WORLD point on the top rail (build_scene.py: rail_top at
 * y = 1.52, top face z = 0.885, x −2.5…−0.3), projected with the view basis every frame, so yaw / pitch / zoom / eye shift
 * (tilt orbit) all give the right parallax. Size follows depth. Lighting is computed per pixel from the silhouette alpha:
 * rim = edge facing the light (sample the alpha one step toward the light's screen direction), for the moon (MOON_DIR of
 * build_scene.py), the current bolt (STRIKES az/el), the porch lantern (1/d²) and the candle (warm, 1/d²). Distance haze.
 * The fog canvas (atmos) is drawn above this one, so ground fog covers it by depth like the rest of the scene.
 *
 * Sprite: assets/fx/cat/cat_atlas.png (Codex silhouettes → make_atlas.py), grayscale, column = frame, rows = body / tail /
 * eye mask (grayscale so the channel order of the iOS texture does not matter).
 * The tail is bent in the shader (twirl around the tail root, angle grows along the tail) → continuous swish, no frames.
 *
 * Perf: one small rect (~cat bounding box) per frame, ~10 texture taps per pixel; nothing drawn while the cat is absent.
 */

const ATLAS = require("../../assets/fx/cat/cat_atlas.png");

/** Sprite frames (normalised to the 1024 px source cell): anchor = middle of the paws on the sitting line. */
type Frame = { ax: number; ay: number; h: number; root: [number, number]; tail: number; hang: boolean };
const FRAMES: Frame[] = [
  // A: body facing left, head turned to the viewer (both eyes), tail raised in a question mark
  { ax: 505 / 1024, ay: 858 / 1024, h: 692 / 1024, root: [722 / 1024, 800 / 1024], tail: 0.55, hang: false },
  // B: profile facing right, head lowered, staring down-right (at the pumpkin); tail hanging over the rail
  { ax: 472 / 1024, ay: 712 / 1024, h: 668 / 1024, root: [325 / 1024, 712 / 1024], tail: 0.3, hang: true },
  // C: full profile facing left (gazing out at the yard), tail raised
  { ax: 503 / 1024, ay: 862 / 1024, h: 691 / 1024, root: [700 / 1024, 815 / 1024], tail: 0.5, hang: false },
];
const CAT_H = 0.31; // sitting height ears → paws (m)

// rail top (m), build_scene.py
const RAIL_Y = 1.52;
const RAIL_Z = 0.885;
/** Far end of the rail: visible when looking left (demo look-around −0.66 rad, first strike 9.95). */
export const CAT_FAR = [-1.72, RAIL_Y, RAIL_Z];
/** Near the corner post: visible in the rest frame (upper left), second strike 22.35. */
export const CAT_NEAR = [-0.66, RAIL_Y, RAIL_Z];
const LAMP = [-0.08, 1.42, 1.32];
const MOON = (() => {
  const v = [-0.45, 1.0, 0.55];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / l);
})();

const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
const FOLLOW_BG = true;

const hash = (n: number) => {
  "worklet";
  const s = Math.sin(n * 78.233 + 12.9898) * 43758.5453;
  return s - Math.floor(s);
};
const sstep = (a: number, b: number, x: number) => {
  "worklet";
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * Demo timeline (app seconds, demo/script.ts):
 *   0–16    pose A at the far rail. Eyes glint while the camera looks left (≈9.3–10.6); strike 1 at 9.95 reveals it.
 *   16–19.8 gone (porch light on, nobody would see it walk).
 *   19.8–   pose B near the corner post, in the rest frame: arrives in the dark after the porch light goes off (19.72),
 *           eyes catch the candle from ≈20.5, strike 2 at 22.35 reveals it staring at the pumpkin; when the bats burst out
 *           (24.9) the eyes snap shut and it is gone.
 * Interactive: each strike re-rolls: pose A far / pose B near / pose C far / absent.
 */
const catPlan = (t: number) => {
  "worklet";
  if (DEMO) {
    if (t < 16) return { pose: 0, pos: 0, on: 1, eyes: sstep(8.9, 9.4, t) * (1 - sstep(11.0, 11.6, t)) + 0.35 * (1 - sstep(8.0, 8.6, t)), seed: 1 };
    if (t < 19.8) return { pose: 0, pos: 0, on: 0, eyes: 0, seed: 1 };
    const eyes = sstep(20.4, 21.0, t) * (1 - sstep(24.85, 24.95, t));
    return { pose: 1, pos: 1, on: t < 24.95 ? 1 : 0, eyes, seed: 2 };
  }
  // interactive: state changes only while dark (just before each strike's flash), seeded by strike index
  let at = 6, idx = 0;
  for (let i = 0; i < 400; i++) {
    if (t < at - 0.05) break;
    idx = i + 1;
    at += 15 + hash(i) * 13; // same schedule as storm.ts currentStrike
  }
  const r = Math.floor(hash(idx * 3.7 + 1.3) * 4);
  if (r === 3 && idx > 0) return { pose: 0, pos: 0, on: 0, eyes: 0, seed: idx };
  const pose = idx === 0 ? 0 : r === 1 ? 1 : r === 2 ? 2 : 0;
  // eyes come and go: look at the camera for a few seconds, look away for a few
  const ph = (t * 0.23 + hash(idx) * 7) % 1;
  return { pose, pos: pose === 1 ? 1 : 0, on: 1, eyes: sstep(0.0, 0.08, ph) * (1 - sstep(0.55, 0.63, ph)), seed: idx };
};

/** Eye blink: 1 open, 0 shut; a blink every 2.5–5 s, sometimes double. */
const blink = (t: number) => {
  "worklet";
  const k = Math.floor(t / 3.1);
  const u = t - k * 3.1 - hash(k) * 1.8;
  const b1 = Math.abs(u - 0.09) < 0.07 ? 1 : 0;
  const b2 = hash(k + 9) > 0.6 && Math.abs(u - 0.33) < 0.06 ? 1 : 0;
  return 1 - Math.max(b1, b2);
};

const source = Skia.RuntimeEffect.Make(`
uniform shader atlas;     // grayscale: column = frame, row 0 body, 1 tail, 2 eye
uniform float  cellPx;    // atlas cell side (px)
uniform float  frame;     // cell index
uniform float2 org;       // cell top-left on screen (pt)
uniform float  size;      // cell side on screen (pt)
uniform float2 root;      // tail root (cell uv)
uniform float  tailLen;   // tail length (cell uv), bend grows up to it
uniform float  swish;     // tail bend (rad, at the tip)
uniform float  vis;       // body opacity (0 = gone)
uniform float  eyes;      // eye glint 0..1
uniform float  flash;     // lightning 0..1
uniform float2 dMoon;     // screen direction toward the moon
uniform float2 dBolt;     // screen direction toward the bolt
uniform float2 dLamp;     // screen direction toward the porch lantern
uniform float2 dFlame;    // screen direction toward the candle
uniform float3 lights;    // lantern intensity (porch / d²), candle intensity (candle / d²), haze
uniform float  rimW;      // rim width (cell uv)

float tex(float2 uv, int ch) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return atlas.eval(float2((frame + uv.x) * cellPx, (float(ch) + uv.y) * cellPx)).g;
}
// tail bent by a twirl around its root: rotation grows smoothly along the tail
float tailA(float2 uv) {
  float2 d = uv - root;
  float r = length(d);
  float a = -swish * smoothstep(0.0, tailLen, r) * (0.35 + 0.65 * smoothstep(0.0, tailLen, r));
  float c = cos(a), s = sin(a);
  return tex(root + float2(c * d.x - s * d.y, s * d.x + c * d.y), 1);
}
float alphaAt(float2 uv) { return max(tex(uv, 0), tailA(uv)); }
// edge facing direction dir: alpha here minus alpha one/two steps toward the light
float rim(float2 uv, float a, float2 dir, float w) {
  float o1 = alphaAt(uv + dir * w);
  float o2 = alphaAt(uv + dir * w * 2.5);
  return a * (1.0 - 0.6 * o1 - 0.4 * o2);
}

half4 main(float2 xy) {
  float2 uv = (xy - org) / size;
  float a = alphaAt(uv);
  // eye glint: core + soft halo (glow spreads outside the body)
  float e = tex(uv, 2);
  float g = 0.0;
  float hr = 0.022;
  for (int i = 0; i < 6; i++) {
    float an = float(i) * 1.0472;
    g += tex(uv + float2(cos(an), sin(an)) * hr, 2);
  }
  g /= 6.0;
  half3 eyeC = half3(0.78, 1.0, 0.28) * (e * 1.6 + g * 0.9) * eyes;
  if (a < 0.003) return half4(eyeC * 0.6, 0.0);

  float w = rimW;
  float rMoon = rim(uv, a, dMoon, w);
  float rBolt = flash > 0.01 ? rim(uv, a, dBolt, w * 1.4) : 0.0;
  float rWarm = lights.x + lights.y > 0.01 ? rim(uv, a, normalize(dLamp * lights.x + dFlame * lights.y + 1e-4), w) : 0.0;

  // fur: almost black, a touch of blue from the sky; rims add light at the silhouette edges
  half3 c = half3(0.010, 0.011, 0.018);
  c += half3(0.36, 0.44, 0.62) * rMoon * (0.22 + 0.5 * flash);
  c += half3(0.85, 0.9, 1.0) * rBolt * flash * 1.6;
  c += half3(1.0, 0.62, 0.3) * rWarm * min(lights.x + lights.y, 1.2) * 0.7;
  // distance haze (the fog canvas on top adds the ground fog)
  c = mix(c, half3(0.07, 0.08, 0.12), lights.z);
  // nearly invisible in the dark; lightning makes it a solid silhouette
  float op = a * vis * (0.16 + 0.84 * smoothstep(0.0, 0.22, flash));
  return half4(c * op + eyeC, op);
}`)!;

type Props = {
  time: SharedValue<number>;
  basis: SharedValue<Basis>;
  /** Lightning flash 0..1 (PumpkinScene `storm`). */
  storm: SharedValue<number>;
  /** Porch light 0..1. */
  porch: SharedValue<number>;
  /** Candle incl. flicker (PumpkinScene `flick`). */
  candle: SharedValue<number>;
};

export function BlackCat({ time, basis, storm, porch, candle }: Props) {
  const atlas = useGpuImage(ATLAS);
  const cellPx = atlas ? atlas.height() / 3 : 384;

  const u = useDerivedValue(() => {
    const t = time.value;
    const p = catPlan(t);
    const f = FRAMES[p.pose];
    const P = p.pos === 1 ? CAT_NEAR : CAT_FAR;
    // Anchor where the BACKGROUND draws the rail: measured on the sim, the reprojected rail follows the view rotation but
    // not the eye shift (rest frame oy −8 cm → true projection is 16 pt higher, look-left ~30 pt). Projecting from the base
    // camera position matches it, so the cat sits on the drawn rail. Set FOLLOW_BG = false if the background gets exact parallax.
    const b0 = basis.value;
    const b = FOLLOW_BG ? { x: b0.x, y: b0.y, z: b0.z, f: b0.f, e: CAM.pos } : b0;
    const [sx, sy, z] = worldToScreen(b, P);
    const k = b.f / Math.max(z, 0.05); // pt / m
    const cellM = (CAT_H / f.h); // m per cell side
    const size = cellM * k;
    // screen directions toward the lights (perspective-correct: project a point 1 m away from the cat)
    const dirTo = (q: number[], out: number) => {
      const s = worldToScreen(b, [P[0] + q[0], P[1] + q[1], P[2] + q[2]]);
      const dx = s[0] - sx, dy = s[1] - sy, l = Math.hypot(dx, dy) || 1;
      return out === 0 ? dx / l : dy / l;
    };
    const st = currentStrike(t, DEMO);
    const bd = st ? [Math.sin(st.az) * Math.cos(st.el), Math.cos(st.az) * Math.cos(st.el), Math.sin(st.el)] : MOON;
    const L = [LAMP[0] - P[0], LAMP[1] - P[1], LAMP[2] - P[2]];
    const Fl = [FLAME_W[0] - P[0], FLAME_W[1] - P[1], FLAME_W[2] - P[2]];
    const dl2 = L[0] * L[0] + L[1] * L[1] + L[2] * L[2];
    const df2 = Fl[0] * Fl[0] + Fl[1] * Fl[1] + Fl[2] * Fl[2];
    // tail: slow swish + an occasional flick (the hanging tail sways like a pendulum)
    const flick = Math.max(0, Math.sin(t * 0.9 + p.seed)) ** 6;
    const swish = f.hang
      ? 0.2 * Math.sin(t * 1.5) + 0.08 * Math.sin(t * 3.3 + 1) + 0.25 * flick * Math.sin(t * 9)
      : 0.24 * Math.sin(t * 2.0 + 0.5) + 0.1 * Math.sin(t * 3.7) + 0.3 * flick * Math.sin(t * 8);
    const vis = p.on;
    return {
      cellPx,
      frame: p.pose,
      org: [sx - f.ax * size, sy - f.ay * size],
      size,
      root: f.root,
      tailLen: f.tail,
      swish,
      vis,
      eyes: vis * p.eyes * blink(t) * (0.55 + 0.25 * Math.min(candle.value, 1.2) + 0.3 * storm.value),
      flash: vis * storm.value,
      dMoon: [dirTo(MOON, 0), dirTo(MOON, 1)],
      dBolt: [dirTo(bd, 0), dirTo(bd, 1)],
      dLamp: [dirTo(L, 0), dirTo(L, 1)],
      dFlame: [dirTo(Fl, 0), dirTo(Fl, 1)],
      lights: [(porch.value * 0.18) / Math.max(dl2, 0.2), (Math.min(candle.value, 1.3) * 0.5) / Math.max(df2, 0.2), 1 - Math.exp(-z / 25)],
      rimW: 1.1 / Math.max(size, 1),
    };
  });
  // bounding rect: cell + margin for the tail swing; empty while the cat is away
  const rx = useDerivedValue(() => u.value.org[0] - u.value.size * 0.1);
  const ry = useDerivedValue(() => u.value.org[1] - u.value.size * 0.1);
  const rw = useDerivedValue(() => (u.value.vis > 0 || u.value.eyes > 0 ? u.value.size * 1.2 : 0));

  if (!atlas) return null;
  return (
    <Group>
      <Rect x={rx} y={ry} width={rw} height={rw}>
        <Shader source={source} uniforms={u}>
          <ImageShader image={atlas} tx="decal" ty="decal" />
        </Shader>
      </Rect>
    </Group>
  );
}

