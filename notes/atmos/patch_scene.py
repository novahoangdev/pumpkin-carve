#!/usr/bin/env python3
"""ATMOS → PumpkinScene.tsx (feedback 16:30 mục 1 + 2). Vá theo chuỗi neo, báo lỗi nếu không thấy neo.
  python3 notes/atmos/patch_scene.py app/src/scene/PumpkinScene.tsx [out]
1. Sương dùng độ sâu thật: import atmosDepth, aU lấy depthU (có dK, dpSize, dRange, pFwd, pRight, pRange), thêm 2 child
   depthB, depthP sau skinLit.
2. Mưa vẽ srcOver thay cho plus: rain.ts trả alpha > 0 ở sàn ướt để gỗ ướt tối đi (alpha = 0 ở chỗ khác → y như plus).
"""
import sys

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else src
s = open(src).read()


def rep(a, b, count=1):
    global s
    n = s.count(a)
    if n < 1:
        sys.exit(f"không thấy neo: {a!r}")
    s = s.replace(a, b, count)


rep('import { atmos } from "../shaders/atmos";', 'import { atmosDepth } from "../shaders/atmos";')
# aU: đổi viewU → depthU (chỉ trong aU)
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
