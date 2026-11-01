import { useCallback, useEffect, useRef, useState } from "react";
import {
  Easing,
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type DerivedValue,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { fireHaptic } from "./haptics";
import { ms } from "../scene/clock";

/**
 * Blow out the candle by blowing into the microphone.
 *
 * Mic: `expo-audio` `useAudioStream` (raw PCM, 16 kHz mono). Each 32 ms block gives
 *   - level (dBFS) and the share of energy below ~300 Hz (one-pole low-pass): air hitting the mic capsule is a
 *     loud, low-frequency rumble; speech is mid-band, fricatives ("sss", "fff" from afar) are high-band;
 *   - steadiness: a blow is a continuous noise, speech is chopped into 4–6 syllables / s (> ~9 dB swings in 250 ms).
 *   `gust` (0..1, drives the flame) and `force` (0..1, only a real blow) come out of that. `force` above
 *   BLOW_FORCE for BLOW_HOLD s → the candle goes out.
 * The mic only runs while the candle burns (permission is asked MIC_DELAY_MS after the candle is first lit).
 *
 * `expo-audio` is optional: the require is wrapped in try/catch (Metro treats it as an optional dependency), so
 * without the package or without a native rebuild everything here is a silent no-op — no mic, no blow-out
 * (except in demo mode, which never needs the mic).
 *
 * Demo (simulator / clip): a scripted breath (`BLOW_DEMO`) replaces the mic.
 */

// ───────────────────────── optional native module ─────────────────────────

type StreamBuffer = { data: ArrayBuffer; sampleRate: number; channels: number };
type MicStream = { start(): Promise<void>; stop(): void };
type AudioLike = {
  useAudioStream(o: { sampleRate?: number; channels?: number; encoding?: "float32"; onBuffer?: (b: StreamBuffer) => void }): {
    stream: MicStream;
  };
  requestRecordingPermissionsAsync(): Promise<{ granted: boolean }>;
};
let audio: AudioLike | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require("expo-audio") as Partial<AudioLike> | undefined;
  if (m && typeof m.useAudioStream === "function" && typeof m.requestRecordingPermissionsAsync === "function") audio = m as AudioLike;
} catch {
  audio = null; // package missing, or JS present but the native module is not built in yet
}
/** true when expo-audio (JS + native) is available. */
export const MIC_AVAILABLE = audio !== null;

const noStream = () => null;
// chosen once at module load → hook order never changes
const useMicStream: (o: { onBuffer: (b: StreamBuffer) => void }) => { stream: MicStream } | null = audio
  ? (o) => audio!.useAudioStream({ sampleRate: 16000, channels: 1, encoding: "float32", onBuffer: o.onBuffer })
  : noStream;

// ───────────────────────── tuning ─────────────────────────

/** `force` over this for BLOW_HOLD seconds puts the candle out. */
export const BLOW_FORCE = 0.55;
export const BLOW_HOLD = 0.3;
/** The mic (and the permission alert, first time) starts this long after the candle is lit (ms). */
export const MIC_DELAY_MS = 2500;
/** Porch light flickers back on this long after the candle goes out (ms); < 0 keeps it off. */
export const PORCH_BACK_MS = 1700;
const LP_HZ = 300;
const WIN = 5; // blocks in the steadiness window (~160 ms)
/** EXPO_PUBLIC_BLOW_DEBUG=1: log mic features to Metro 4× / s (tuning thresholds on a device). */
const DEBUG = process.env.EXPO_PUBLIC_BLOW_DEBUG === "1";
/** EXPO_PUBLIC_BLOW_MIC=1: use the real mic even in demo mode (test the detector on a device / the Mac mic in the simulator). */
const FORCE_MIC = process.env.EXPO_PUBLIC_BLOW_MIC === "1";

/**
 * Scripted breath for demo mode (app seconds). `puff`: a soft breath — the flame bends and gutters, light through
 * the carving trembles, candle survives. `blow`: a strong one — out after BLOW_HOLD.
 * `relight`: the virtual finger taps the match to relight (PumpkinScene demo block), null = clip ends dark.
 */
export const BLOW_DEMO = {
  puff: [30.0, 30.75, 0.42] as const, // start, end, strength
  blow: [31.25, 31.95, 1.0] as const,
  relight: 34.4 as number | null,
};

const sstep = (a: number, b: number, x: number) => {
  "worklet";
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Demo breath strength at app time t (0..1): quick attack, wavering sustain, soft release. */
export const demoBreath = (t: number) => {
  "worklet";
  const seg = (s: readonly [number, number, number]) => {
    const [a, b, k] = s;
    if (t < a || t > b + 0.25) return 0;
    const env = sstep(a, a + 0.09, t) * (1 - sstep(b, b + 0.25, t));
    const waver = 0.88 + 0.08 * Math.sin(t * 37) + 0.05 * Math.sin(t * 61 + 1.3);
    return k * env * waver;
  };
  return Math.max(seg(BLOW_DEMO.puff), seg(BLOW_DEMO.blow));
};

// ───────────────────────── look helpers (worklets, used by PumpkinScene uniforms) ─────────────────────────

/** Multiplier on the candle flicker while being blown on: dips + fast guttering (light through the holes trembles). */
export const blowFlicker = (t: number, g: number) => {
  "worklet";
  if (g <= 0.001) return 1;
  const n = Math.sin(t * 29.0) * 0.5 + Math.sin(t * 47.3 + 0.7) * 0.3 + Math.sin(t * 83.1 + 2.1) * 0.2;
  return Math.max(0.15, 1 - g * (0.32 + 0.22 * n));
};

/** Extra lean of the flame while being blown on (sign of shader `lean`: + = top to the right). */
export const blowLean = (t: number, g: number) => {
  "worklet";
  if (g <= 0.001) return 0;
  const sway = 0.55 + 0.3 * Math.sin(t * 3.1) + 0.25 * Math.sin(t * 13.7 + 0.4) + 0.18 * Math.sin(t * 31.0);
  return g * 2.8 * sway;
};

/** Glowing ember on the wick after the flame dies (0..1). */
export const emberAt = (t: number, outAt: number) => {
  "worklet";
  if (outAt < 0) return 0;
  const u = t - outAt;
  if (u < 0 || u > 5) return 0;
  const glow = sstep(0, 0.2, u) * Math.exp(-u / 1.5);
  const pulse = 0.85 + 0.1 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 17.9 + 1.1);
  return glow * pulse;
};

// ───────────────────────── mic analysis (JS thread) ─────────────────────────

type Meter = {
  lp: number;
  pos: number;
  sAll: number;
  sLow: number;
  hb: Float32Array; // high band (x − low-pass) of the current block, for the voicing test
  win: number[];
  floor: number;
  voice: number;
  dbg: number;
};
export const newMeter = (): Meter => ({ lp: 0, pos: 0, sAll: 0, sLow: 0, hb: new Float32Array(4096), win: [], floor: -60, voice: 0, dbg: 0 });
const smoothJS = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Voicing 0..1: peak normalised autocorrelation of the high band over pitch lags (80–400 Hz).
 * Voiced speech (vowels) is periodic → high; air noise (a blow, "shhh") is not → low.
 */
const voicing = (h: Float32Array, n: number, sr: number) => {
  let e = 0;
  for (let i = 0; i < n; i++) e += h[i] * h[i];
  if (e < 1e-9) return 0;
  const l0 = Math.round(sr / 400), l1 = Math.min(n >> 1, Math.round(sr / 80));
  const step = Math.max(1, Math.round(sr / 8000));
  let best = 0;
  for (let L = l0; L <= l1; L += step) {
    let c = 0;
    for (let i = 0; i + L < n; i += step) c += h[i] * h[i + L];
    const r = (c * step) / (e * ((n - L) / n));
    if (r > best) best = r;
  }
  return Math.min(1, best);
};

/** Feed one PCM buffer; calls `out(gust, force)` once per finished ~32 ms block. Exported for the offline test (notes/blow/). */
export const analyse = (m: Meter, b: StreamBuffer, out: (gust: number, force: number) => void) => {
  const x = new Float32Array(b.data);
  const ch = Math.max(1, b.channels);
  const sr = b.sampleRate || 16000;
  const N = Math.min(m.hb.length, Math.round(sr * 0.032));
  const a = 1 - Math.exp((-2 * Math.PI * LP_HZ) / sr);
  for (let i = 0; i < x.length; i += ch) {
    const v = x[i];
    m.lp += a * (v - m.lp);
    m.sAll += v * v;
    m.sLow += m.lp * m.lp;
    m.hb[m.pos] = v - m.lp;
    if (++m.pos < N) continue;
    const rms = Math.sqrt(m.sAll / N);
    const db = 20 * Math.log10(rms + 1e-7);
    const low = Math.sqrt(m.sLow / N) / (rms + 1e-7); // share of amplitude below LP_HZ (0..1)
    const vc = voicing(m.hb, N, sr);
    m.pos = 0;
    m.sAll = 0;
    m.sLow = 0;
    // speech keeps the detector suppressed between syllables too (~250 ms memory)
    m.voice = Math.max(vc, m.voice * 0.88);
    // room noise floor: falls fast, rises slowly
    m.floor = db < m.floor ? m.floor + (db - m.floor) * 0.3 : m.floor + (db - m.floor) * 0.004;
    m.win.push(db);
    if (m.win.length > WIN) m.win.shift();
    let lo = 200, hi = -200;
    for (const d of m.win) {
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    const steady = 1 - smoothJS(5, 11, hi - lo);
    const above = smoothJS(10, 22, db - m.floor);
    const unvoiced = 1 - smoothJS(0.42, 0.62, m.voice);
    // gust: any breath toward the phone bends the flame; force: only a loud, low, steady, unvoiced blow counts
    const gust = smoothJS(-46, -24, db) * smoothJS(0.22, 0.5, low) * above * (0.25 + 0.75 * unvoiced);
    const force = smoothJS(-33, -19, db) * smoothJS(0.38, 0.62, low) * (0.35 + 0.65 * steady) * above * unvoiced;
    out(gust, force);
    if (DEBUG && ++m.dbg % 8 === 0)
      console.log(
        `[blow] db ${db.toFixed(1)} floor ${m.floor.toFixed(1)} low ${low.toFixed(2)} voice ${m.voice.toFixed(2)} range ${(hi - lo).toFixed(1)} gust ${gust.toFixed(2)} force ${force.toFixed(2)}`,
      );
  }
};

// ───────────────────────── hook ─────────────────────────

export type BlowOut = {
  /** 0..1 how hard the flame is being blown on right now (smoothed). */
  gust: SharedValue<number>;
  /** app time the candle went out, -1 while burning / never lit. */
  outAt: SharedValue<number>;
  /** 0..1 ember glow on the wick (shader uniform). */
  ember: DerivedValue<number>;
  /** Call from lightUp (UI thread) when the candle is lit again. */
  relit: () => void;
  /** true if the mic is available (or demo). */
  enabled: boolean;
};

/**
 * Wire-up: `const blow = useBlowOut({ time, candle, porch, litAt, demo: DEMO, onOut })`.
 * Writes `candle` (→ 0) and `porch` (flickers back on) itself when the candle is blown out; `onOut` (worklet,
 * UI thread) is for scene-side resets such as bringing the match back.
 */
export function useBlowOut({
  time,
  candle,
  porch,
  litAt,
  demo,
  onOut,
}: {
  time: SharedValue<number>;
  candle: SharedValue<number>;
  porch: SharedValue<number>;
  litAt: SharedValue<number>;
  demo: boolean;
  onOut?: () => void;
}): BlowOut {
  const raw = useSharedValue(0); // gust from mic (JS) — UI thread smooths it
  const rawForce = useSharedValue(0);
  const gust = useSharedValue(0);
  const outAt = useSharedValue(-1);
  const hold = useSharedValue(0);
  const last = useSharedValue(-1);
  const scripted = demo && !FORCE_MIC;
  const enabled = scripted || MIC_AVAILABLE;

  // ── mic: run only while the candle burns ──
  const meter = useRef<Meter>(newMeter());
  const onBuffer = useCallback(
    (b: StreamBuffer) =>
      analyse(meter.current, b, (g, f) => {
        raw.set(g);
        rawForce.set(f);
      }),
    [raw, rawForce],
  );
  const mic = useMicStream({ onBuffer });
  const [listen, setListen] = useState(false);
  useAnimatedReaction(
    () => litAt.value >= 0 && outAt.value < 0,
    (on, prev) => {
      if (on !== prev && !scripted && MIC_AVAILABLE) scheduleOnRN(setListen, on);
    },
  );
  useEffect(() => {
    if (!listen || !mic || !audio) return;
    let live = true;
    let started = false;
    (async () => {
      try {
        // let the flare-up play first: the permission alert must not cover the "wow" moment
        await new Promise((r) => setTimeout(r, MIC_DELAY_MS));
        if (!live) return;
        const p = await audio!.requestRecordingPermissionsAsync();
        if (!live || !p.granted) return;
        meter.current = newMeter();
        await mic.stream.start();
        started = true;
        if (!live) mic.stream.stop();
      } catch (e) {
        if (DEBUG) console.log("[blow] mic failed", e);
      }
    })();
    return () => {
      live = false;
      raw.set(0);
      rawForce.set(0);
      if (started) {
        try {
          mic.stream.stop();
        } catch {}
      }
    };
  }, [listen, mic, raw, rawForce]);

  const extinguish = (t: number) => {
    "worklet";
    outAt.set(t);
    hold.set(0);
    // flame shrinks to nothing (shader also shrinks its height with `ember`)
    candle.set(withTiming(0, { duration: ms(240), easing: Easing.in(Easing.quad) }));
    if (PORCH_BACK_MS >= 0)
      porch.set(
        withDelay(
          ms(PORCH_BACK_MS),
          withSequence(
            withTiming(0.55, { duration: ms(40) }),
            withTiming(0.05, { duration: ms(90) }),
            withTiming(0.8, { duration: ms(50) }),
            withTiming(0.25, { duration: ms(120) }),
            withTiming(1, { duration: ms(260) }),
          ),
        ),
      );
    scheduleOnRN(fireHaptic, "medium");
    if (onOut) onOut();
  };

  useFrameCallback(() => {
    "worklet";
    const t = time.value;
    const dt = last.value < 0 ? 0 : Math.min(0.05, Math.max(0, t - last.value));
    last.set(t);
    const burning = litAt.value >= 0 && outAt.value < 0 && t - litAt.value > 1.0; // not while it is still flaring up
    let g = 0, f = 0;
    if (burning) {
      if (scripted) {
        g = demoBreath(t);
        f = g;
      } else {
        g = raw.value;
        f = rawForce.value;
      }
    }
    // fast attack, slower release (flame keeps swaying a moment after the breath)
    const cur = gust.value;
    const k = g > cur ? Math.min(1, dt * 18) : Math.min(1, dt * 5);
    const ng = cur + (g - cur) * k;
    if (Math.abs(ng - cur) > 1e-4 || (ng === 0 && cur !== 0)) gust.set(ng < 0.002 ? 0 : ng);
    if (!burning) {
      if (hold.value !== 0) hold.set(0);
      return;
    }
    const h = f > BLOW_FORCE ? hold.value + dt : Math.max(0, hold.value - dt);
    hold.set(h);
    if (h >= BLOW_HOLD) extinguish(t);
  });

  const ember = useDerivedValue(() => emberAt(time.value, outAt.value));

  const relit = () => {
    "worklet";
    outAt.set(-1);
    hold.set(0);
  };

  return { gust, outAt, ember, relit, enabled };
}
