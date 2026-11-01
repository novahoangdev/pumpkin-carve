import { Skia } from "react-native-skia";
import { DEPTH_SKSL, VIEW_SKSL } from "./viewSksl";
import { CANDLE_FLOOR_SKSL, PUMPKIN_SHADOW_SKSL } from "./candleLight";
import { MOON_SKSL } from "./moon";

// Nền: trộn ảnh sáng / tối theo đèn hiên, cộng ánh nến lọt qua lỗ khắc, loé sét.
// Dựng lại theo độ sâu: tia từ mắt (có thể đã dịch vài cm) → điểm bề mặt P → hướng từ camera gốc → ảnh gốc (nét) hoặc
// panorama ngoài khung. Bóng quả bí là lớp nhân riêng: bí nhảy thì bóng nhạt và loang ra.
// Ánh nến đúng vật lý: bgGlow = rọi sáng KHÔNG bị che từ lòng bí (Blender, ẩn quả bí); lightMap = phần lọt qua lỗ
// khắc (candleLight.ts, tính sẵn trên ảnh gốc khi mask đổi). Sát dưới bụng bí luôn tối vì tia bị vỏ chặn.
export const background = Skia.RuntimeEffect.Make(`
uniform shader bgLit;
uniform shader bgDark;
uniform shader bgGlow;
uniform shader panoLit;
uniform shader panoDark;
uniform shader panoGlow;
uniform shader shadowLit;  // nhân bóng quả bí (1 = không bóng), ảnh gốc
uniform shader shadowDark;
uniform shader lightMap;   // ánh nến lọt qua lỗ khắc trên ảnh gốc (R = L/6), px = pt · lk
${VIEW_SKSL}
${DEPTH_SKSL}
uniform float  bgK;        // px ảnh nền gốc trên mỗi pt
uniform float  shK;        // px ảnh bóng trên mỗi pt
uniform float2 pSize;      // px ảnh panorama màu
uniform float  porch;      // đèn hiên 0..1
uniform float  candle;     // nến 0..1.3 (đã nhân chập chờn)
uniform float  storm;      // loé sét 0..1
uniform float  jumpH;      // độ cao bí đang nhảy (pt)
uniform float  lk;
uniform float3 fOff;       // nguồn sáng lệch theo lửa (flameFollow), m
${PUMPKIN_SHADOW_SKSL}
${CANDLE_FLOOR_SKSL}
${MOON_SKSL}

half4 main(float2 xy) {
  float3 dn = normalize(viewRay(xy));
  float w;
  float3 dir = reproject(dn, w);
  float3 P = floorSnap(eye + dn * w, dn);
  float3 bb = toBase(dir);
  float2 b = bb.xy;
  // trọng số ảnh gốc: 1 trong khung, mờ dần về 0 ở mép (12 pt)
  float wb = bb.z * smoothstep(0.0, 12.0, min(min(b.x, view.x - b.x), min(b.y, view.y - b.y)));
  half3 lit = half3(0.0);
  half3 dark = half3(0.0);
  half3 g = half3(0.0);
  // perf: chỉ đọc ảnh nào thật sự góp vào màu (đèn hiên tắt → bỏ bộ "lit"; sáng hẳn, không sét → bỏ bộ "dark")
  bool needLit = porch > 0.001;
  bool needDark = porch < 0.999 || storm > 0.001;
  if (wb < 0.999) {
    float2 pu = panoUV(dir) * pSize;
    if (needDark) dark = panoDark.eval(pu).rgb;
    if (needLit) lit = panoLit.eval(pu).rgb;
    if (candle > 0.001) g = panoGlow.eval(pu).rgb;
  }
  if (wb > 0.001) {
    float2 p = b * bgK;
    // bóng quả bí: nhạt và loang theo độ cao khi nhảy
    float lift = clamp(jumpH / 220.0, 0.0, 1.0);
    float2 sp = jFoot + (b - jFoot) / (1.0 + lift * 0.6);
    float k = 1.0 - lift * 0.85;
    if (needDark) dark = mix(dark, bgDark.eval(p).rgb, wb);
    if (needLit) lit = mix(lit, bgLit.eval(p).rgb, wb);
    if (candle > 0.001) g = mix(g, bgGlow.eval(p).rgb, wb);
  }
  // trăng: sprite tròn ở vô cực theo hướng thế giới, phủ lên trăng gốc bị kéo méo (moon.ts)
  float3 mo = moonSprite(xy, w);
  if (mo.z > 0.001) {
    float2 mp = mo.xy * bgK;
    if (needDark) dark = mix(dark, bgDark.eval(mp).rgb, mo.z);
    if (needLit) lit = mix(lit, bgLit.eval(mp).rgb, mo.z);
  }
  float2 shd = pumpkinShade(P);
  dark *= half(shd.y);
  lit *= half(shd.x);
  half3 col = mix(dark, lit, porch);
  // sét: cả cảnh loé ánh trời lạnh (dùng lớp chỉ có trăng làm hướng sáng từ trời)
  col += dark * storm * half3(2.2, 2.4, 3.0);
  col += stormLight(P, dark);

  if (candle > 0.001) {
    float L = 0.0;
    if (wb > 0.001) {
      // bí nhảy: dời bản đồ theo quả bí, nhạt dần khi lên cao
      // lửa nghiêng về phía ngón tay → vệt mặt cười trượt ngược lại, càng xa bí càng nhiều
      float3 Pl = P + fOff * clamp(length((P - pc).xy) / 0.13 - 1.0, 0.0, 8.0);
      float2 lb = toBase(Pl - jW - cam0).xy;
      L = candleL(lb) * wb * (1.0 - clamp(jumpH / 90.0, 0.0, 1.0));
    }
    // vỏ bí mỏng trong mờ + sương tán xạ: một chút ấm rất nhẹ quanh quả bí
    col += candleShade(P, dn, g, L, candle);
  }
  return half4(col, 1.0);
}`)!;
