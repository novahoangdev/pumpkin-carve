import re,sys
src,dst=sys.argv[1],sys.argv[2]
s=open(src).read()
def rep(a,b,cnt=1):
    global s
    assert a in s, ("missing", a[:80])
    s=s.replace(a,b,cnt)
# 1) GPU images
s=re.sub(r'= useImage\(sceneAssets\.', '= useGpuImage(sceneAssets.', s)
rep('import { useCarveMask } from "../carve/useCarveMask";','import { useCarveMask } from "../carve/useCarveMask";\nimport { toGpu, useGpuImage } from "../perf/gpu";')
rep('.then((img) => live && setLightMap(img));','.then((img) => live && setLightMap(toGpu(img)));')
rep('  useImage,\n','')
# 2) atmos on a low-density canvas
m=re.search(r'const LIGHT_K = [^\n]*\n', s)
s=s[:m.end()]+'/** Sương (atmos.ts) vẽ ở canvas riêng, mật độ điểm ảnh 1/ATMOS_DOWN rồi phóng lại: rẻ hơn ATMOS_DOWN² lần, sương vốn mềm. */\nconst ATMOS_DOWN = 3;\n'+s[m.end():]
rep('  const [fitState, setFitState] = useState<Fit>({ k: 1, ox: 0, oy: 0 });','  const [fitState, setFitState] = useState<Fit>({ k: 1, ox: 0, oy: 0 });\n  const [size, setSize] = useState({ w: 0, h: 0 });')
rep('    fit.set(f);\n    setFitState(f);','    fit.set(f);\n    setFitState(f);\n    setSize({ w: width, h: height });')
rep('  // lớp vẽ đè gắn với quả bí','''  // canvas sương mật độ thấp: cùng transform, chia cho ATMOS_DOWN
  const fitTransformLow = useDerivedValue(() => {
    const t = fitTransform.value as { translateX?: number; translateY?: number; scale?: number }[];
    return [{ translateX: t[0].translateX! / ATMOS_DOWN }, { translateY: t[1].translateY! / ATMOS_DOWN }, { scale: t[2].scale! / ATMOS_DOWN }];
  });
  // lớp vẽ đè gắn với quả bí''')
a=s.index('              <Fill>\n                <Shader source={atmos}')
e=s.index('          {ready && <IslandPill')
block=s[a:e]
k=block.index('\n              <', block.index('</Fill>'))+1
atm=block[:k]; rest=block[k:]
rest_inner=rest[:rest.rindex('            </Group>')]
s=s[:a]+'''            </Group>
          )}
        </Canvas>
      </GestureDetector>
      {/* sương: canvas 1/ATMOS_DOWN mật độ, phóng lại bằng transform của view */}
      {ready && size.w > 0 && (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, top: 0, width: size.w / ATMOS_DOWN, height: size.h / ATMOS_DOWN, transformOrigin: "0 0", transform: [{ scale: ATMOS_DOWN }] }}
        >
          <Canvas style={StyleSheet.absoluteFill}>
            <Group transform={fitTransformLow}>
'''+atm+'''            </Group>
          </Canvas>
        </View>
      )}
      {/* lớp trên sương: dơi, màn đen, ngón tay ảo, Dynamic Island */}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {ready && (
          <Group transform={fitTransform}>
'''+rest_inner+'''          </Group>
        )}
'''+s[e:]
rep('''          {ready && <IslandPill islandT={jump.islandT} time={time} skin={skinLit} lit={candle} />}
        </Canvas>
      </GestureDetector>''','''          {ready && <IslandPill islandT={jump.islandT} time={time} skin={skinLit} lit={candle} />}
      </Canvas>''')
open(dst,'w').write(s)
