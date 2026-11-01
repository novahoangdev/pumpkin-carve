# Step 3 (after patch_scene.py): main canvas at 1/MAIN_DOWN density (2x instead of 3x on a 3x phone); gestures on a
# full-size transparent view above the canvases so their coordinates stay in screen pt.
import sys
src,dst=sys.argv[1],sys.argv[2]
s=open(src).read()
def rep(a,b):
    global s
    assert a in s, ("missing", a[:90]); s=s.replace(a,b,1)
rep('const ATMOS_DOWN = 3;\n','const ATMOS_DOWN = 3;\n/** Canvas chính (nền, bí, mưa…) vẽ ở mật độ 1/MAIN_DOWN: 1.5 = 2x trên máy 3x (GPU làm ít hơn 2,25 lần). 1 = như cũ. */\nconst MAIN_DOWN = 1.5;\n')
rep('  // canvas sương mật độ thấp','''  const fitTransformMain = useDerivedValue(() => {
    const t = fitTransform.value as { translateX?: number; translateY?: number; scale?: number }[];
    return [{ translateX: t[0].translateX! / MAIN_DOWN }, { translateY: t[1].translateY! / MAIN_DOWN }, { scale: t[2].scale! / MAIN_DOWN }];
  });
  // canvas sương mật độ thấp''')
rep('''      <GestureDetector gesture={gesture}>
        <Canvas style={StyleSheet.absoluteFill}>
          {ready && (
            <Group transform={fitTransform}>''','''      {size.w > 0 && (
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 0, top: 0, width: size.w / MAIN_DOWN, height: size.h / MAIN_DOWN, transformOrigin: "0 0", transform: [{ scale: MAIN_DOWN }] }}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          {ready && (
            <Group transform={fitTransformMain}>''')
rep('''        </Canvas>
      </GestureDetector>
      {/* sương''','''        </Canvas>
      </View>
      )}
      {/* sương''')
rep('''      <Animated.View style={[StyleSheet.absoluteFill, uiStyle]}''','''      {/* nhận gesture trên toàn màn hình (pt màn hình), nằm trên các canvas, dưới UI */}
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>
      <Animated.View style={[StyleSheet.absoluteFill, uiStyle]}''')
open(dst,'w').write(s)
