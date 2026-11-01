#!/usr/bin/env python3
"""LIGHT v2 (one shot, run from the project root): wall face moves into the candle bake (lightMap.g, same area-light
sampling as the floor, crisp mask), so the faceShadow overlay pass goes away.
  python3 notes/light/apply_v2.py
1) copies notes/light/candleLight.v2.ts → app/src/shaders/candleLight.ts (bake gets a 3rd child: crisp mask)
2) PumpkinScene.tsx: adds that child + dependency, removes the faceShadow <Fill> (fsU left unused → also removed)"""
import re, shutil, sys
P = "app/src/scene/PumpkinScene.tsx"
s = open(P).read()
def rep(a, b):
    global s
    assert s.count(a) == 1, ("anchor not found / not unique", a)
    s = s.replace(a, b)
if "carve.images.mask} tx=\"decal\" ty=\"decal\" />\n        </Shader>\n      </Fill>,\n      { width: W, height: H }" not in s:
    rep('''          <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
          <ImageShader image={depthB} tx="clamp" ty="clamp" />
        </Shader>
      </Fill>,
      { width: W, height: H },''', '''          <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
          <ImageShader image={depthB} tx="clamp" ty="clamp" />
          <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
        </Shader>
      </Fill>,
      { width: W, height: H },''')
    rep('  }, [carve.images.blur, depthB]);', '  }, [carve.images.blur, carve.images.mask, depthB]);')
if "<Shader source={faceShadow}" in s:
    rep('''              <Fill blendMode="plus">
                <Shader source={faceShadow} uniforms={fsU}>
                  <ImageShader image={bgLit} tx="clamp" ty="clamp" />
                  <ImageShader image={panoLit} tx="clamp" ty="clamp" />
                  <ImageShader image={depthB} tx="clamp" ty="clamp" />
                  <ImageShader image={depthP} tx="clamp" ty="clamp" />
                  <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
                </Shader>
              </Fill>
''', '')
    s = re.sub(r"  const fsU = useDerivedValue\(\(\) => \{.*?\n  \}\);\n", "", s, count=1, flags=re.S)
    rep('import { faceShadow, faceShadowUniforms } from "../shaders/faceShadow";\n', '')
    s = s.replace("// giant face on the wall (faceShadow.ts) and lightning through the holes (lightningThrough.ts)", "// lightning through the holes (lightningThrough.ts); the wall face is lightMap.g (candleLight.ts)")
open(P, "w").write(s)
shutil.copy("notes/light/candleLight.v2.ts", "app/src/shaders/candleLight.ts")
print("LIGHT v2 applied")
