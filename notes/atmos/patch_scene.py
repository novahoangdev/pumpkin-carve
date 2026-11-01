#!/usr/bin/env python3
"""ATMOS → PumpkinScene.tsx (feedback 16:30 items 1 + 2). Patches by anchor string, errors out if an anchor is missing.
  python3 notes/atmos/patch_scene.py app/src/scene/PumpkinScene.tsx [out]
1. Fog uses real depth: import atmosDepth, aU takes depthU (with dK, dpSize, dRange, pFwd, pRight, pRange), add 2 children
   depthB, depthP after skinLit.
2. Rain draws srcOver instead of plus: rain.ts returns alpha > 0 on the wet floor so wet wood darkens (alpha = 0 elsewhere → same as plus).
"""
import sys

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else src
s = open(src).read()


def rep(a, b, count=1):
    global s
    n = s.count(a)
    if n < 1:
        sys.exit(f"anchor not found: {a!r}")
    s = s.replace(a, b, count)


rep('import { atmos } from "../shaders/atmos";', 'import { atmosDepth } from "../shaders/atmos";')
# aU: switch viewU → depthU (only inside aU)
i = s.index("const aU = useDerivedValue(")
j = s.index("...viewU.value,", i)
s = s[:j] + "...depthU.value," + s[j + len("...viewU.value,"):]
rep(
    """<Shader source={atmos} uniforms={aU}>
                  <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
                  <ImageShader image={skinLit} tx="decal" ty="decal" />""",
    """<Shader source={atmosDepth} uniforms={aU}>
                  <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
                  <ImageShader image={skinLit} tx="decal" ty="decal" />
                  <ImageShader image={depthB} tx="clamp" ty="clamp" />
                  <ImageShader image={depthP} tx="clamp" ty="clamp" />""",
)
rep(
    """<Fill blendMode="plus">
                <Shader source={rain} uniforms={rainU}>""",
    """<Fill>
                <Shader source={rain} uniforms={rainU}>""",
)
open(out, "w").write(s)
print("ok →", out)
