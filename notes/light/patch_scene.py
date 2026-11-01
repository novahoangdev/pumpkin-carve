#!/usr/bin/env python3
"""LIGHT → main agent: wire candle floor light (candleLight.ts), wall face (faceShadow.ts) and lightning through the
holes (lightningThrough.ts) into PumpkinScene.tsx. Usage: python3 notes/light/patch_scene.py app/src/scene/PumpkinScene.tsx
Anchored string replaces; fails loudly if an anchor moved."""
import sys
p = sys.argv[1]
s = open(p).read()
if "faceShadowUniforms" in s:
    print("already patched"); sys.exit(0)
def rep(a, b):
    global s
    assert s.count(a) == 1, ("anchor not found / not unique", a)
    s = s.replace(a, b)
rep('import { candleLight } from "../shaders/candleLight";\n',
    'import { candleFloorUniforms, candleLight } from "../shaders/candleLight";\n'
    'import { faceShadow, faceShadowUniforms } from "../shaders/faceShadow";\n'
    'import { lightningMap, lightningMapUniforms, lightningThrough, lightningUniforms } from "../shaders/lightningThrough";\n')
# sharper candle map (patch is thin from the low camera); baked once per mask change
rep('const LIGHT_K = 1;', 'const LIGHT_K = 2;')
rep('  const ready = !!(', '''  // lightning through the carved face: patch on the boards, baked once per mask change (lightningThrough.ts)
  const [ltMap, setLtMap] = useState<SkImage | null>(null);
  useEffect(() => {
    if (!depthB) return;
    let live = true;
    drawAsImage(
      <Fill>
        <Shader source={lightningMap} uniforms={lightningMapUniforms(1, depthB.width())}>
          <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
          <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
          <ImageShader image={depthB} tx="clamp" ty="clamp" />
        </Shader>
      </Fill>,
      { width: Math.round(VIEW.w), height: Math.round(VIEW.h) },
    ).then((img) => live && setLtMap(toGpu(img)));
    return () => {
      live = false;
    };
  }, [carve.images.blur, carve.images.mask, depthB]);
  const ready = !!(''')
rep('depthB && depthP && lightMap\n', 'depthB && depthP && lightMap && ltMap\n')
rep('    lk: lightMap ? lightMap.width() / VIEW.w : LIGHT_K,\n',
    '    lk: lightMap ? lightMap.width() / VIEW.w : LIGHT_K,\n    ...candleFloorUniforms(time.value, PUMPKIN_FOOT),\n')
rep('  const pU = useDerivedValue(() => ({', '''  // giant face on the wall (faceShadow.ts) and lightning through the holes (lightningThrough.ts)
  const fsU = useDerivedValue(() => {
    const v = depthU.value;
    const lean = -tilt.value[0] * 0.9 + Math.sin(time.value * 1.7) * 0.08 - jump.rot.value * 2;
    return {
      ...v,
      ...faceShadowUniforms(time.value, lean, flick.value, v.jW),
      bgK: bgLit ? bgLit.width() / VIEW.w : 1,
      pSize: panoLit ? [panoLit.width(), panoLit.height()] : [1, 1],
      candle: jump.hidden.value ? 0 : flick.value,
      gain: 1,
      hidden: jump.hidden.value ? 1 : 0,
    };
  });
  const ltU = useDerivedValue(() => ({
    ...depthU.value,
    ...lightningUniforms(storm.value * (holeN.value > 0 ? 1 : 0), flick.value, jump.hidden.value, ltMap ? ltMap.width() / VIEW.w : 1),
  }));
  const pU = useDerivedValue(() => ({''')
rep('              <JumpTrail trail={jump.trail} time={time} />', '''              <Fill blendMode="plus">
                <Shader source={faceShadow} uniforms={fsU}>
                  <ImageShader image={bgLit} tx="clamp" ty="clamp" />
                  <ImageShader image={panoLit} tx="clamp" ty="clamp" />
                  <ImageShader image={depthB} tx="clamp" ty="clamp" />
                  <ImageShader image={depthP} tx="clamp" ty="clamp" />
                  <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
                </Shader>
              </Fill>
              <JumpTrail trail={jump.trail} time={time} />''')
rep('              <ImpactDust impacts={jump.impacts} time={time} basis={basis} />', '''              <Fill blendMode="plus">
                <Shader source={lightningThrough} uniforms={ltU}>
                  <ImageShader image={ltMap} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.mask} tx="decal" ty="decal" />
                  <ImageShader image={carve.images.blur} tx="decal" ty="decal" />
                  <ImageShader image={depthB} tx="clamp" ty="clamp" />
                  <ImageShader image={depthP} tx="clamp" ty="clamp" />
                </Shader>
              </Fill>
              <ImpactDust impacts={jump.impacts} time={time} basis={basis} />''')
open(p, "w").write(s)
print("patched", p)
