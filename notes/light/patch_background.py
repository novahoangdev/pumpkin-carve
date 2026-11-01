#!/usr/bin/env python3
"""LIGHT → PERF: background.ts uses candleLight.ts snippets (floor candle light + analytic pumpkin shadows).
Usage: python3 notes/light/patch_background.py app/src/shaders/background.ts   (anchored string replaces, idempotent check)"""
import sys
p = sys.argv[1]
s = open(p).read()
if "candleShade(" in s:
    print("already patched"); sys.exit(0)
def rep(a, b):
    global s
    assert s.count(a) == 1, ("anchor not found / not unique", a)
    s = s.replace(a, b)
rep('import { DEPTH_SKSL, VIEW_SKSL } from "./viewSksl";',
    'import { DEPTH_SKSL, VIEW_SKSL } from "./viewSksl";\nimport { CANDLE_FLOOR_SKSL, PUMPKIN_SHADOW_SKSL } from "./candleLight";')
rep('uniform float  lk;\n', 'uniform float  lk;\n${PUMPKIN_SHADOW_SKSL}\n${CANDLE_FLOOR_SKSL}\n')
rep('  float3 P = eye + dn * w;\n', '  float3 P = floorSnap(eye + dn * w, dn);\n')
# analytic soft shadows + contact AO instead of the hard-edged shadow_lit/dark plates (children stay declared, unused)
rep('    if (needDark) dark = mix(dark, bgDark.eval(p).rgb * mix(1.0, shadowDark.eval(sp * shK).r, k), wb);\n'
    '    if (needLit) lit = mix(lit, bgLit.eval(p).rgb * mix(1.0, shadowLit.eval(sp * shK).r, k), wb);\n',
    '    if (needDark) dark = mix(dark, bgDark.eval(p).rgb, wb);\n'
    '    if (needLit) lit = mix(lit, bgLit.eval(p).rgb, wb);\n')
# after plate + panorama are blended (the panorama has no pumpkin shadow either): analytic soft shadows everywhere
rep('  half3 col = mix(dark, lit, porch);\n',
    '  float2 shd = pumpkinShade(P);\n  dark *= half(shd.y);\n  lit *= half(shd.x);\n  half3 col = mix(dark, lit, porch);\n')
rep('      L = lightMap.eval(lb * lk).r * 6.0 * wb', '      L = candleL(lb) * wb')
rep('    col += g * candle * (0.05 + L) * half3(1.0, 0.84, 0.66);', '    col += candleShade(P, dn, g, L, candle);')
open(p, "w").write(s)
print("patched", p)
