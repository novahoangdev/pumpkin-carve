import { useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import { FLAME_W } from "../scene/layout";
import { worldToScreen, type Basis } from "../scene/view";

/**
 * The lit candle follows the finger, as if the pumpkin were watching it.
 *
 * When a finger touches / drags near the lit pumpkin, the flame leans toward it and the light beams through the carved
 * face swing toward it. A spring with inertia (slight overshoot) drives everything; a fast-moving finger is "wind": the
 * flame stretches, flickers harder and is dragged along the stroke. On release the flame slowly sways back upright.
 *
 * Output (one shared value, updated every frame on the UI thread):
 *   lean    add to the pumpkin shader's `lean` (+ = tip to the right on screen), ±2.8 max
 *   stretch flame height × (1 … 1.45)
 *   gust    wind 0..1: flame wobble × (1 + 2.2·gust), candle flicker × (1 + 1.6·gust)
 *   off     world offset (m) of the LIGHT SOURCE for the beams / floor pattern, AWAY from the finger, so the beams through
 *           the holes swing TOWARD the finger (|off| ≤ 3.2 cm, stays inside the pumpkin)
 *   tip     world offset (m) TOWARD the finger of the hot point that lights the inside of the pumpkin (the leaning flame
 *           tip): the inner wall on the finger's side glows brighter, as if the pumpkin looked that way
 *
 * Wiring (see notes/cat.md): pumpkin.ts gets `fStretch`, `fGust`; atmos.ts + background.ts get `fOff`; PumpkinScene feeds
 * `finger` (demo: the virtual finger, app: a `touch` shared value from the gestures).
 */
export type FlameFollow = { lean: number; stretch: number; gust: number; off: number[]; tip: number[] };
export const FLAME_REST: FlameFollow = { lean: 0, stretch: 1, gust: 0, off: [0, 0, 0], tip: [0, 0, 0] };

export type Finger = { x: number; y: number; a: number };
type Args = {
  time: SharedValue<number>;
  basis: SharedValue<Basis>;
  /** Finger on screen (design pt) + presence a 0..1. */
  finger: SharedValue<Finger>;
  /** Candle 0..1.3 (follow only once lit). */
  candle: SharedValue<number>;
  /** Pumpkin offset while jumping (pt), optional. */
  jumpOff?: SharedValue<{ x: number; y: number }>;
  /** Pumpkin width on screen (pt): reach of the effect scales with it. */
  width: SharedValue<{ x: number; y: number; w: number }>;
};

const MAX_LEAN = 2.8;
const MAX_OFF = 0.032;
const MAX_TIP = 0.035;
const clamp = (v: number, a: number, b: number) => {
  "worklet";
  return Math.max(a, Math.min(b, v));
};
const sstep = (a: number, b: number, x: number) => {
  "worklet";
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

export function useFlameFollow({ time, basis, finger, candle, jumpOff, width }: Args) {
  const out = useSharedValue<FlameFollow>(FLAME_REST);
  // spring state: lean, its velocity, beam offset (screen-dir units), velocity, wind, previous finger, previous time
  const s = useSharedValue({ L: 0, vL: 0, ox: 0, oy: 0, vx: 0, vy: 0, gust: 0, px: 0, py: 0, pa: 0, t: -1, sv: 0 });

  useFrameCallback(() => {
    "worklet";
    const t = time.value;
    const st = s.value;
    const dt = st.t < 0 ? 1 / 60 : clamp(t - st.t, 1 / 2000, 1 / 20);
    const lit = clamp((candle.value - 0.25) / 0.5, 0, 1);
    const f = finger.value;
    const b = basis.value;
    const [fx0, fy0] = worldToScreen(b, FLAME_W);
    const jo = jumpOff ? jumpOff.value : null;
    const fx = fx0 + (jo ? jo.x : 0), fy = fy0 + (jo ? jo.y : 0);
    const W = Math.max(width.value.w, 40);

    // finger relative to the flame, in pumpkin widths
    const dx = (f.x - fx) / W, dy = (f.y - fy) / W;
    const dist = Math.hypot(dx, dy) + 1e-4;
    const a = f.a * lit;
    const near = a * sstep(1.7, 0.35, dist); // reach: ~1.7 pumpkin widths
    // finger speed (widths / s), only while it stays down
    let vx = 0, vy = 0;
    if (st.pa > 0.5 && f.a > 0.5) {
      vx = (f.x - st.px) / W / dt;
      vy = (f.y - st.py) / W / dt;
    }
    const sv = st.sv + (Math.hypot(vx, vy) - st.sv) * Math.min(1, dt * 18); // smoothed speed
    const wind = a * sstep(2.4, 0.4, dist) * sstep(0.6, 3.2, sv);

    // targets: lean toward the finger (+ a push along the stroke), beam source away from it
    const ux = dx / dist, uy = dy / dist;
    const svx = sv > 1e-3 ? vx / Math.max(Math.hypot(vx, vy), 1e-3) : 0;
    const tL = clamp(ux * 2.5 * near + svx * wind * 0.9, -MAX_LEAN, MAX_LEAN);
    const tox = -ux * near, toy = -uy * near;

    // springs: snappy with a little overshoot while touching, slow sway back after release
    const holding = a > 0.3;
    const k = holding ? 75 : 13;
    const z = holding ? 0.5 : 0.32;
    const c = 2 * z * Math.sqrt(k);
    const vL = st.vL + (k * (tL - st.L) - c * st.vL) * dt;
    const L = st.L + vL * dt;
    const ko = holding ? 40 : 10, co = 2 * 0.7 * Math.sqrt(ko);
    const vox = st.vx + (ko * (tox - st.ox) - co * st.vx) * dt;
    const voy = st.vy + (ko * (toy - st.oy) - co * st.vy) * dt;
    const ox = st.ox + vox * dt, oy = st.oy + voy * dt;
    // wind: fast attack, slow decay
    const gust = st.gust + (wind - st.gust) * Math.min(1, dt * (wind > st.gust ? 14 : 1.6));

    s.set({ L, vL, ox, oy, vx: vox, vy: voy, gust, px: f.x, py: f.y, pa: f.a, t, sv });
    // screen direction → world offset in the view plane (screen y is down)
    const m = MAX_OFF * lit;
    const off = [0, 1, 2].map((i) => (b.x[i] * ox - b.y[i] * oy) * m);
    const mt = -(MAX_TIP / MAX_OFF);
    const tip = [off[0] * mt, off[1] * mt, off[2] * mt];
    out.set({
      lean: clamp(L, -MAX_LEAN * 1.2, MAX_LEAN * 1.2) * lit,
      stretch: 1 + (0.32 * gust + 0.14 * near * clamp(-uy, 0, 1)) * lit,
      gust: gust * lit,
      off,
      tip,
    });
  });
  return out;
}

/**
 * Demo: the virtual finger plays with the flame for FF_DEMO.dur seconds (u = t − start):
 *   0–0.3   finger appears right of the flame, a bit above → flame leans right, beams swing right
 *   0.3–1.1 slow arc over the top to the left → flame and beams follow (the pumpkin "watches" it)
 *   1.1–1.4 quick swipe back to the right → gust: flame stretches, flickers, is dragged along
 *   1.4–1.8 hold, then lift → flame sways back upright on its own
 * Positions are relative to the flame on screen, in pumpkin widths, so they follow the camera / rest frame.
 * Returns null outside the segment.
 */
export const FF_DEMO = { at: 20.55, dur: 1.85 };
export const flameDemoFinger = (u: number, fx: number, fy: number, W: number): Finger | null => {
  "worklet";
  if (u < 0 || u > FF_DEMO.dur) return null;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));
  let px: number, py: number;
  if (u < 0.3) {
    px = 0.58; py = -0.12;
  } else if (u < 1.1) {
    const e = ease((u - 0.3) / 0.8);
    const ang = Math.PI * (0.06 + 0.88 * e); // arc over the top: right → left
    px = 0.58 * Math.cos(ang); py = -0.12 - 0.3 * Math.sin(ang);
  } else if (u < 1.4) {
    const e = ease((u - 1.1) / 0.3);
    px = -0.55 + 1.3 * e; py = -0.13 + 0.08 * Math.sin(Math.PI * e);
  } else {
    px = 0.75; py = -0.13;
  }
  const a = u < 0.25 ? u / 0.25 : u > FF_DEMO.dur - 0.25 ? (FF_DEMO.dur - u) / 0.25 : 1;
  return { x: fx + px * W, y: fy + py * W, a };
};
