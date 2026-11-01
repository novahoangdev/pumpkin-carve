#!/usr/bin/env python3
"""LIGHT v4 (lightning review 18:45), run from the project root:  python3 notes/light/apply_v4.py
1) notes/light/lightningThrough.v4.ts → app/src/shaders/lightningThrough.ts (overlay gets a 6th child: inLit, + imgS)
2) notes/light/candleLight.v4.ts → app/src/shaders/candleLight.ts (stronger lightning light → clearer pumpkin shadow)
3) PumpkinScene.tsx: adds <ImageShader image={inLit}> to the lightning overlay and imgS to its uniforms"""
import shutil
P = "app/src/scene/PumpkinScene.tsx"
s = open(P).read()
def rep(a, b):
    global s
    assert s.count(a) == 1, ("anchor not found / not unique", a)
    s = s.replace(a, b)
if "imgS: inLit ? inLit.width() : 1" not in s:
    rep('''ltMap ? ltMap.width() / VIEW.w : 1),
  }));''', '''ltMap ? ltMap.width() / VIEW.w : 1),
    imgS: inLit ? inLit.width() : 1,
  }));''')
    rep('''                <Shader source={lightningThrough} uniforms={ltU}>
                  <ImageShader image={ltMap} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
                  <ImageShader image={depthB} tx="clamp" ty="clamp" />
                  <ImageShader image={depthP} tx="clamp" ty="clamp" />
''', '''                <Shader source={lightningThrough} uniforms={ltU}>
                  <ImageShader image={ltMap} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
                  <ImageShader image={depthB} tx="clamp" ty="clamp" />
                  <ImageShader image={depthP} tx="clamp" ty="clamp" />
                  <ImageShader image={inLit} tx="clamp" ty="clamp" />
''')
open(P, "w").write(s)
shutil.copy("notes/light/lightningThrough.v4.ts", "app/src/shaders/lightningThrough.ts")
shutil.copy("notes/light/candleLight.v4.ts", "app/src/shaders/candleLight.ts")
print("LIGHT v4 applied")
