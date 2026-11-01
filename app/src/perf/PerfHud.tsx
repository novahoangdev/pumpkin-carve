import React, { useEffect, useMemo } from "react";
import { DevSettings } from "react-native";
import { Group, Path, Rect, Skia, Text, matchFont, type SkPath } from "react-native-skia";
import { useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

/** EXPO_PUBLIC_PERF=1: FPS / frame-time overlay + a `[perf]` log line every 0.5 s in the Metro console. */
export const PERF = process.env.EXPO_PUBLIC_PERF === "1";

const N = 120; // frames kept in the graph
const GW = 150;
const GH = 40;
const EMPTY = Skia.PathBuilder.Make().build();

type Ui = { t: number; fps: number; max: number; drops: number };
type Js = { fps: number; max: number };

// JS-thread frame pacing (requestAnimationFrame): long tasks / GC / React re-renders show up here
const js = { n: 0, max: 0, last: 0 };
let jsOut: Js = { fps: 0, max: 0 };
let lastJsReport = 0;
const report = (u: Ui) => {
  const now = performance.now();
  const dt = (now - lastJsReport) / 1000;
  lastJsReport = now;
  if (dt > 0 && dt < 5) jsOut = { fps: Math.round(js.n / dt), max: Math.round(js.max) };
  js.n = 0;
  js.max = 0;
  console.log(`[perf] t=${u.t.toFixed(1)} ui=${u.fps} uiMax=${u.max} drop=${u.drops} js=${jsOut.fps} jsMax=${jsOut.max}`);
};

/**
 * Overlay drawn in screen pt (put it inside the Canvas, outside any scaled group).
 * UI fps = Reanimated frame callback rate (the thread Skia draws on); drop = frames that took > 1.5× the
 * best interval seen; js = requestAnimationFrame rate on the JS thread.
 */
export function PerfHud({ time, x = 10, y = 118 }: { time: SharedValue<number>; x?: number; y?: number }) {
  const font = useMemo(() => matchFont({ fontFamily: "Menlo", fontSize: 10 }), []);
  const ring = useSharedValue<number[]>(new Array(N).fill(0));
  const head = useSharedValue(0);
  const acc = useSharedValue({ n: 0, sum: 0, max: 0, drops: 0, best: 1000, t0: -1 });
  const label = useSharedValue("…");
  const graph = useSharedValue<SkPath>(EMPTY);
  const jsLabel = useSharedValue("");

  useEffect(() => {
    let raf = 0;
    js.last = performance.now();
    const loop = () => {
      const now = performance.now();
      const d = now - js.last;
      js.last = now;
      js.n++;
      if (d > js.max) js.max = d;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const iv = setInterval(() => jsLabel.set(`js ${jsOut.fps} fps  max ${jsOut.max} ms`), 500);
    // remote reload for measurement runs: bump the number served at EXPO_PUBLIC_PERF_RELOAD (e.g. http://localhost:8096/reload.txt)
    const url = process.env.EXPO_PUBLIC_PERF_RELOAD;
    let seen: string | null = null;
    const poll = url
      ? setInterval(() => {
          fetch(url, { cache: "no-store" })
            .then((r) => r.text())
            .then((v) => {
              if (seen !== null && v !== seen) DevSettings.reload();
              seen = v;
            })
            .catch(() => {});
        }, 700)
      : undefined;
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      if (poll) clearInterval(poll);
    };
  }, [jsLabel]);

  useFrameCallback(({ timestamp, timeSincePreviousFrame }) => {
    "worklet";
    const dt = timeSincePreviousFrame ?? 0;
    if (!(dt > 0)) return;
    const r = ring.value;
    r[head.value] = dt;
    head.value = (head.value + 1) % N;
    const a = acc.value;
    if (a.t0 < 0) a.t0 = timestamp;
    a.n++;
    a.sum += dt;
    if (dt > a.max) a.max = dt;
    if (dt < a.best) a.best = dt;
    if (dt > a.best * 1.5) a.drops++;
    if (timestamp - a.t0 >= 500) {
      const fps = Math.round((a.n * 1000) / (timestamp - a.t0));
      const u: Ui = { t: time.value, fps, max: Math.round(a.max), drops: a.drops };
      label.set(`ui ${fps} fps  max ${u.max} ms  drop ${a.drops}`);
      // graph: one bar per frame, 0..50 ms, guide lines at 8.3 / 16.7 / 33 ms
      const b = Skia.PathBuilder.Make();
      for (let i = 0; i < N; i++) {
        const v = Math.min(50, r[(head.value + i) % N]);
        const h = (v / 50) * GH;
        b.addRect({ x: (i * GW) / N, y: GH - h, width: GW / N - 0.3, height: h });
      }
      graph.set(b.build());
      scheduleOnRN(report, u);
      acc.value = { n: 0, sum: 0, max: 0, drops: 0, best: a.best, t0: timestamp };
    }
  });

  const lines = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    for (const ms of [8.33, 16.67, 33.3]) {
      const yy = GH - (ms / 50) * GH;
      b.moveTo(0, yy);
      b.lineTo(GW, yy);
    }
    return b.build();
  });

  // EXPO_PUBLIC_PERF_HUD=0: keep measuring/logging but draw nothing (to rule out the overlay's own cost)
  if (process.env.EXPO_PUBLIC_PERF_HUD === "0") return null;
  return (
    <Group transform={[{ translateX: x }, { translateY: y }]}>
      <Rect x={-4} y={-4} width={GW + 8} height={GH + 34} color="#000000a0" />
      <Path path={graph} color="#58e07a" />
      <Path path={lines} style="stroke" strokeWidth={0.5} color="#ffffff80" />
      <Text x={0} y={GH + 12} text={label} font={font} color="#ffffff" />
      <Text x={0} y={GH + 25} text={jsLabel} font={font} color="#ffd27a" />
    </Group>
  );
}
