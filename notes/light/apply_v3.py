#!/usr/bin/env python3
"""LIGHT v3 (POLISH-1815 §1–2), run from the project root:  python3 notes/light/apply_v3.py
1) notes/light/candleLight.v3.ts → app/src/shaders/candleLight.ts (same bake interface as v2: no PumpkinScene change)
   - wall face removed (physically impossible), faint shapeless warmth on wall / door instead
   - floor face: sharper source (triangle eyes, teeth), amber tone-map, wood grain kept
   - lightning: sharp pumpkin shadow folded into pumpkinShade + new low flash light (stormLight)
2) background.ts (PERF): one line — the flash also adds stormLight(P, dark)"""
import shutil
P = "app/src/shaders/background.ts"
s = open(P).read()
a = "  col += dark * storm * half3(2.2, 2.4, 3.0);\n"
if "stormLight(" not in s:
    assert s.count(a) == 1, "anchor moved: " + a
    s = s.replace(a, a + "  col += stormLight(P, dark);\n")
    open(P, "w").write(s)
shutil.copy("notes/light/candleLight.v3.ts", "app/src/shaders/candleLight.ts")
print("LIGHT v3 applied")
