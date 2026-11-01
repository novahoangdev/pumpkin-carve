#!/usr/bin/env python3
"""Blow-out wiring for PumpkinScene.tsx + pumpkin.ts (agent BLOW).

Usage:  python3 notes/blow/patch.py app/src/scene/PumpkinScene.tsx app/src/shaders/pumpkin.ts
Each edit is anchored on an exact string; the script stops with the anchor that did not match (nothing is written
for that file then). Idempotent: a file that already contains the BLOW marker is skipped.
"""
import sys

MARK = "useBlowOut"


def apply(path, edits):
    s = open(path).read()
    if MARK in s or "uniform float ember" in s:
        print(f"skip {path} (already patched)")
        return
    for old, new in edits:
        if s.count(old) != 1:
            sys.exit(f"{path}: anchor not found exactly once:\n{old}")
        s = s.replace(old, new)
    open(path, "w").write(s)
    print(f"patched {path} ({len(edits)} edits)")


SCENE = [
    # 1. imports
    ("  withTiming,\n} from \"react-native-reanimated\";",
     "  withTiming,\n  Easing,\n} from \"react-native-reanimated\";"),
    ("import { Gust } from \"../fx/Gust\";",
     "import { Gust } from \"../fx/Gust\";\nimport { Smoke } from \"../fx/Smoke\";\nimport { BLOW_DEMO, blowFlicker, blowLean, useBlowOut } from \"../fx/blowOut\";"),
    # 2. hook (after the match shared values: onOut brings the match back to the porch)
    ("  const matchFade = useSharedValue(0);\n",
     """  const matchFade = useSharedValue(0);

  // ── blowing out the candle (mic or demo script, fx/blowOut.ts): once the candle is out the match reappears on the porch, tap it to relight ──
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
"""),
    # 3. lightUp: allowed again after a blow-out; bats only the first time
    ("    if (litAt.value >= 0) return;\n",
     "    if (litAt.value >= 0 && blow.outAt.value < 0) return;\n    blow.relit();\n"),
    ("    if (!DEMO) batsAt.set(time.value + 4.2);",
     "    if (!DEMO && batsAt.value < 0) batsAt.set(time.value + 4.2);"),
    # 4. strikeMatch: tap the match after a blow-out → it strikes itself, arcs into the mouth, relights
    ("  // own timing: the callback is re-registered on every component render",
     """  /** Candle has been blown out: tap the match → it strikes itself, lifts, lowers into the pumpkin's mouth and relights. */
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

  // own timing: the callback is re-registered on every component render"""),
    # 5. demo: virtual finger taps the match to relight (BLOW_DEMO.relight)
    ("    if (DEMO && litAt.value >= 0 && batsAt.value < 0 && t >= SCRIPT.bats) batsAt.set(t);",
     """    if (DEMO && litAt.value >= 0 && batsAt.value < 0 && t >= SCRIPT.bats) batsAt.set(t);
    // demo: blow out (BLOW_DEMO), then the virtual finger taps the match to relight
    if (DEMO && BLOW_DEMO.relight !== null && blow.outAt.value >= 0) {
      const u = t - BLOW_DEMO.relight;
      if (u > -0.3 && u < 0) finger.set({ x: MATCH_REST.x, y: MATCH_REST.y + 20, a: (u + 0.3) / 0.3 });
      else if (u >= 0 && relitDemo.value === 0) {
        relitDemo.set(1);
        finger.set({ x: MATCH_REST.x, y: MATCH_REST.y + 20, a: 1 });
        strikeMatch();
      }
    }"""),
    # 6. gestures: drag or tap the match again once the candle is out
    ("      if (litAt.value < 0 && Math.hypot(x - mx.value, y - (my.value + 20)) < 46) {",
     "      if ((litAt.value < 0 || blow.outAt.value >= 0) && Math.hypot(x - mx.value, y - (my.value + 20)) < 46) {"),
    ("      const [x, y] = toDesign(e.x, e.y);\n      const o = jump.off.value;\n",
     "      const [x, y] = toDesign(e.x, e.y);\n      if (blow.outAt.value >= 0 && Math.hypot(x - mx.value, y - (my.value + 20)) < 46) {\n        strikeMatch();\n        return;\n      }\n      const o = jump.off.value;\n"),
    # 7. reset
    ("    grav0.set(null);\n", "    grav0.set(null);\n    blow.relit();\n    relitDemo.set(0);\n"),
    # 8. flicker / lean / new shader uniforms
    ("    return candle.value * (0.9 + n + jerk);",
     "    return candle.value * (0.9 + n + jerk) * blowFlicker(t, blow.gust.value);"),
    ("    lean: -tilt.value[0] * 0.9 + Math.sin(time.value * 1.7) * 0.08 - jump.rot.value * 2,",
     "    lean: -tilt.value[0] * 0.9 + Math.sin(time.value * 1.7) * 0.08 - jump.rot.value * 2 + blowLean(time.value, blow.gust.value),\n    gust: blow.gust.value,\n    ember: blow.ember.value,"),
    # 9. smoke wisp (scene space, before rain)
    ("              <Gust layer=\"scene\" time={time} basis={basis} />",
     "              <Gust layer=\"scene\" time={time} basis={basis} />\n              <Smoke outAt={blow.outAt} time={time} basis={basis} holes={bursts} porch={porch} storm={storm} />"),
]

SHADER = [
    ("uniform float  hidden;     // 1: the pumpkin is inside the Dynamic Island",
     "uniform float  hidden;     // 1: the pumpkin is inside the Dynamic Island\n"
     "uniform float  gust;       // 0..1 being blown on (fx/blowOut.ts): flame shrinks, strong ripple\n"
     "uniform float  ember;      // 0..1 red ember on the wick after blowing out (flame shrinks to the wick)"),
    ("  float y = -q.y + 7.0;                           // 0 = flame base (at the wick), positive upward",
     "  // candle out: flame shrinks to the wick with candle; red ember at the wick tip\n"
     "  float shrink = ember > 0.0 ? 0.12 + 0.88 * clamp(candle, 0.0, 1.0) : 1.0;\n"
     "  float re = length(float2(q.x, (q.y - 5.2) * 0.75));\n"
     "  float emb = ember * (exp(-re * re / 1.6) * 1.6 + exp(-re / 4.5) * 0.45);\n"
     "  q = float2(q.x, q.y - 7.0) / shrink + float2(0.0, 7.0);\n"
     "  float y = -q.y + 7.0;                           // 0 = flame base (at the wick), positive upward"),
    ("  float wob = (noise(float2(y * 0.22 - time * 8.0, time * 2.7)) - 0.5) * 1.6 * clamp(y / 16.0, 0.0, 1.0);",
     "  float wob = (noise(float2(y * 0.22 - time * (8.0 + 10.0 * gust), time * 2.7)) - 0.5) * 1.6 * (1.0 + 2.4 * gust) * clamp(y / 16.0, 0.0, 1.0);"),
    ("  float h = 21.0 * (0.85 + 0.15 * candle);       // flame height",
     "  float h = 21.0 * (0.85 + 0.15 * candle) * (1.0 - 0.12 * gust); // flame height (blown on: a bit shorter)"),
    ("  float a = clamp(body * 1.3, 0.0, 1.0) * clamp(candle, 0.0, 1.0);",
     "  // blown on: light flickers strongly (candle) but the flame body stays solid, only whipped sideways\n"
     "  float a = clamp(body * 1.3, 0.0, 1.0) * clamp(candle + 0.7 * gust, 0.0, 1.0);"),
    ("  return half4(c * a + half3(0.25, 0.35, 1.0) * blue * (1.0 - a) + half3(1.0, 0.55, 0.2) * halo, a);",
     "  half3 ec = half3(1.0, 0.3, 0.06) * emb + half3(1.0, 0.75, 0.4) * smoothstep(0.9, 1.6, emb) * 0.5;\n"
     "  return half4(c * a + half3(0.25, 0.35, 1.0) * blue * (1.0 - a) + half3(1.0, 0.55, 0.2) * halo + ec, max(a, clamp(emb, 0.0, 1.0) * 0.8));"),
    ("  half3 inside = mix(dim, hot, clamp(candle, 0.0, 1.0));",
     "  half3 inside = mix(dim, hot, clamp(candle, 0.0, 1.0));\n"
     "  inside += (il.rgb * 0.8 + half3(0.05, 0.012, 0.0)) * half3(1.0, 0.3, 0.1) * ember * 0.55 * E; // red ember casts a faint glow on the inner wall"),
]

if __name__ == "__main__":
    scene, shader = sys.argv[1], sys.argv[2]
    apply(scene, SCENE)
    apply(shader, SHADER)
