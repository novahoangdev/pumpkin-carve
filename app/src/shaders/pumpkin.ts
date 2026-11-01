import { Skia } from "react-native-skia";
import { VIEW_SKSL } from "./viewSksl";

// Quả bí, vẽ phủ cả màn hình. Hình học 3D thật (ellipsoid + độ dày vỏ), nên khi mắt dịch / nghiêng máy:
//   H = điểm tia nhìn chạm mặt ngoài; vỏ, normal, mask lấy tại hình chiếu của H lên ảnh camera gốc
//   thành vết cắt: đi tiếp theo tia vào trong vỏ, đổi điểm đó về mặt ngoài theo pháp tuyến → mask (lỗ cắt vuông góc vỏ)
//   lòng bí: tia đi xuyên tới mặt trong phía sau (ellipsoid nhỏ hơn một độ dày vỏ) → chiếu về ảnh lòng bí
//   ngọn lửa: billboard đặt đúng vị trí 3D giữa lòng bí (lệch ít hơn thành sau khi nghiêng → thấy nó ở giữa)
//   !outer → vỏ: trộn sáng/tối theo đèn hiên, ửng cam quanh lỗ khi nến sáng (vỏ mỏng trong mờ)
export const pumpkin = Skia.RuntimeEffect.Make(`
uniform shader skinLit;
uniform shader skinDark;
uniform shader inLit;
uniform shader inUnlit;
uniform shader data;       // R,G: normal camera (0..1, y lên), B: vùng khắc được
uniform shader flesh;      // thớ thịt bí (lặp)
uniform shader mask;       // lỗ khắc (px mask)
uniform shader maskBlur;
uniform float3 crop;       // x, y, cạnh (pt)
uniform float  imgS;       // cạnh ảnh crop (px)
uniform float  maskS;      // cạnh mask (px)
uniform float  porch;
uniform float  storm;      // loé sét 0..1
uniform float  candle;     // 0..1.3, đã gồm chập chờn
uniform float  time;
uniform float3 flameW;     // tâm lửa (m)
uniform float  shell;      // độ dày vỏ (m)
uniform float  lean;       // độ nghiêng ngọn lửa
uniform float  fStretch;   // lửa dài ra × (flameFollow)
uniform float  fGust;      // gió do ngón tay lướt nhanh: chập chờn mạnh (flameFollow)
uniform float3 fTip;       // đỉnh lửa lệch về phía ngón tay (m): ánh trong lòng bí đi theo
uniform float  hidden;     // 1: quả bí đang ở trong Dynamic Island
uniform float  gust;       // 0..1 đang bị thổi (fx/blowOut.ts): lửa lùn lại, gợn mạnh
uniform float  ember;      // 0..1 tàn đỏ ở bấc sau khi thổi tắt (lửa co về bấc)
${VIEW_SKSL}

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
float m(float2 uv) { return smoothstep(0.3, 0.7, mask.eval(uv * maskS).r); }

// ngọn lửa nến thật: giọt nước thon (rộng ~1/4 chiều cao), chân xanh mờ sát bấc, lõi trắng vàng, thân vàng, viền cam
// mờ dần lên đỉnh; q tính theo pt quanh tâm lửa (cỡ như nhìn từ camera gốc)
half4 flameCol(float2 q) {
  // tắt nến: lửa co về bấc theo candle; tàn đỏ ở đầu bấc
  float shrink = ember > 0.0 ? 0.12 + 0.88 * clamp(candle, 0.0, 1.0) : 1.0;
  float re = length(float2(q.x, (q.y - 5.2) * 0.75));
  float emb = ember * (exp(-re * re / 1.6) * 1.6 + exp(-re / 4.5) * 0.45);
  q = float2(q.x, q.y - 7.0) / shrink + float2(0.0, 7.0);
  float y = -q.y + 7.0;                           // 0 = chân lửa (sát bấc), lên trên dương
  // nghiêng (ngược chiều máy / về phía ngón tay): cong nhiều hơn ở ngọn như bị luồng khí đẩy
  q.x -= lean * max(y, 0.0) * 0.16 * (0.55 + 0.45 * clamp(y / (21.0 * fStretch), 0.0, 1.3));
  float wob = (noise(float2(y * 0.22 - time * (8.0 + 10.0 * gust) * (1.0 + fGust), time * 2.7)) - 0.5) * 1.6 * (1.0 + 2.4 * gust + 2.2 * fGust) * clamp(y / 16.0, 0.0, 1.0);
  q.x -= wob;
  float h = 21.0 * (0.85 + 0.15 * candle) * (1.0 - 0.12 * gust) * fStretch; // chiều cao lửa (bị thổi: lùn lại chút)
  float t = clamp(y / h, 0.0, 1.0);
  float w = (7.2 * sqrt(t) * pow(1.0 - t, 1.25) + 0.25) / sqrt(fStretch);
  float d = abs(q.x) / max(w, 0.01);
  float inY = smoothstep(-0.8, 1.2, y) * smoothstep(h + 0.5, h - 4.0, y);
  float body = smoothstep(1.0, 0.45, d) * inY;
  float core = smoothstep(0.6, 0.0, d) * smoothstep(1.0, 3.5, y) * smoothstep(h * 0.6, h * 0.2, y);
  half3 c = mix(half3(1.0, 0.36, 0.06), half3(1.0, 0.78, 0.36), smoothstep(0.05, 0.75, body));
  c = mix(c, half3(1.0, 0.97, 0.88), core);
  // bị thổi: ánh sáng chập chờn mạnh (candle) nhưng thân lửa vẫn đặc, chỉ bị quật nghiêng
  float a = clamp(body * 1.3, 0.0, 1.0) * clamp(candle + 0.7 * gust, 0.0, 1.0);
  // chân xanh: vùng cháy đủ ô-xy ngay trên bấc
  float blue = smoothstep(1.0, 0.2, d) * smoothstep(-0.5, 0.8, y) * smoothstep(3.5, 1.0, y) * 0.55 * clamp(candle, 0.0, 1.0);
  // quầng sáng quanh lửa (tán xạ trong không khí nóng + ống kính)
  float r = length(q * float2(1.0, 0.65) - float2(0.0, -6.0));
  float halo = (exp(-r / 7.0) * 0.45 + exp(-r / 22.0) * 0.18) * candle;
  half3 ec = half3(1.0, 0.3, 0.06) * emb + half3(1.0, 0.75, 0.4) * smoothstep(0.9, 1.6, emb) * 0.5;
  return half4(c * a + half3(0.25, 0.35, 1.0) * blue * (1.0 - a) + half3(1.0, 0.55, 0.2) * halo + ec, max(a, clamp(emb, 0.0, 1.0) * 0.8));
}

// điểm thế giới (hệ bí đứng yên) → uv crop
float2 cropOf(float3 h) { return (pumpkinXY(h) - crop.xy) / crop.z; }

half4 main(float2 sxy) {
  if (hidden > 0.5) return half4(0.0);
  float3 H = pumpkinHitW(sxy);
  float3 bb = toBase(H - cam0);
  if (bb.z < 0.5) return half4(0.0);
  float2 xy = bb.xy;                                // toạ độ trên ảnh gốc của quả bí đứng yên (xoay đã tính trong pumpkinHitW)
  float2 uv = (xy - crop.xy) / crop.z;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return half4(0.0);
  // perf: đèn hiên tắt hẳn → không đọc vỏ sáng; sáng hẳn và không sét → không đọc vỏ tối
  half4 lit = porch > 0.001 ? skinLit.eval(uv * imgS) : half4(0.0);
  half4 dark = porch < 0.999 || storm > 0.001 ? skinDark.eval(uv * imgS) : lit;
  if (porch <= 0.001) lit = dark;
  half4 skin = mix(dark, lit, porch);
  skin.rgb += dark.rgb * storm * half3(2.0, 2.2, 2.8);
  half4 dt = data.eval(uv * imgS);
  float2 n = float2(dt.r * 2.0 - 1.0, 1.0 - dt.g * 2.0);   // y màn hình hướng xuống
  float carv = dt.b;

  float outer = m(uv) * carv;
  float glowM = maskBlur.eval(uv * maskS).r;
  if (outer < 0.002) {
    // vỏ: viền AO tối sát mép lỗ, ửng cam (vỏ trong mờ) khi nến sáng
    float near = clamp(glowM * 1.6, 0.0, 1.0);
    half3 c = skin.rgb * (1.0 - 0.35 * near * skin.a);
    float lum = dot(skin.rgb, half3(0.3, 0.59, 0.11));
    c += half3(1.0, 0.45, 0.08) * near * candle * 0.8 * skin.a * (1.0 - lum);
    // ánh nến xuyên vỏ: cả quả ửng cam ấm, mạnh hơn ở giữa mặt trước (vỏ đối diện nến)
    float front = clamp(1.0 - length(n) * 0.9, 0.0, 1.0);
    c += skin.rgb * half3(1.0, 0.55, 0.22) * clamp(candle, 0.0, 1.3) * (0.7 + 0.8 * front + 1.2 * near);
    return half4(c, skin.a);
  }

  // pháp tuyến thế giới tại H (normal render, z hướng về camera gốc)
  float nz = sqrt(max(1.0 - dot(n, n), 0.0));
  float3 N = normalize(camX * n.x - camY * n.y + camZ * nz);
  float3 dv = normalize(H - eye);             // hướng nhìn
  float cosI = max(-dot(dv, N), 0.25);
  // điểm ở độ sâu s (0..1 bề dày vỏ) dọc tia, đổi về mặt ngoài theo pháp tuyến → mask
  float3 inW = dv * (shell / cosI) + N * shell;      // dịch mask khi tới mặt trong
  float2 o = cropOf(H + inW) - uv;
  float depth = 1.0;
  for (int i = 1; i <= 6; i++) {
    float s = float(i) / 6.0;
    if (m(uv + o * s) < 0.5) { depth = s - 1.0 / 12.0; break; }
  }
  float inner = m(uv + o);

  // lòng bí: tia đi tiếp tới mặt trong phía sau
  float3 ri = pr * (1.0 - shell / pr.x);           // thành trong = vỏ ngoài thu nhỏ quanh tâm
  float3 hb = ellHit(H, dv, ri);
  float3 B = H + dv * hb.y;
  float2 iu = cropOf(B);
  half4 il = inLit.eval(iu * imgS);
  half4 iun = inUnlit.eval(iu * imgS);
  // rọi trong lòng bí theo 1/d² từ ngọn lửa + ánh dội giữa các thành (lòng bí như một quả cầu phát sáng)
  float dB = length(B - flameW - fTip);
  float E = 0.32 + 1.5 * pow(0.085 / max(dB, 0.04), 2.0);
  // chưa thắp: ánh đèn hiên lọt qua lỗ, thấy lờ mờ thành trong (không đen kịt như giấy cắt)
  half3 dim = iun.rgb * 2.2 + il.rgb * half3(0.1, 0.075, 0.06) * (0.35 + 0.65 * porch);
  // đã thắp: thịt bí cam vàng; nén highlight theo độ sáng (giữ sắc cam, không bệt vàng)
  // thớ xơ / gân thịt bí ở thành trong (ảnh lòng bí khá đều màu): nhân thêm vân thớ theo toạ độ trên thành sau
  half fib = dot(flesh.eval(iu * 700.0 + float2(0.0, iu.y * 300.0)).rgb, half3(0.33));
  half3 hot = il.rgb * half3(1.0, 0.66, 0.36) * E * (0.75 + 0.3 * candle) * (0.65 + 0.7 * fib);
  hot = hot / (1.0 + dot(hot, half3(0.3, 0.59, 0.11)) * 0.45) * 1.25;
  half3 inside = mix(dim, hot, clamp(candle, 0.0, 1.0));
  inside += (il.rgb * 0.8 + half3(0.05, 0.012, 0.0)) * half3(1.0, 0.3, 0.1) * ember * 0.55 * E; // tàn đỏ hắt nhẹ lên thành trong
  // ngọn lửa: điểm gần tâm lửa nhất trên tia nhìn, quy ra pt (cỡ lửa như nhìn từ camera gốc)
  float3 e = eye;
  float3 wv = e + dv * dot(flameW - e, dv) - flameW;
  float ptPerM = focal / length(flameW - cam0);
  half4 fl = flameCol(float2(dot(wv, vX), -dot(wv, vY)) * ptPerM);
  // lửa ở giữa lòng bí: chỉ thấy khi thành sau nằm sau lửa (luôn đúng) và tia không bị thành vết cắt chặn
  inside = inside * (1.0 - fl.a) + fl.rgb;

  // thành vết cắt: thớ thịt bí, toạ độ theo hướng lỗ để thớ chạy dọc thành
  half3 f = flesh.eval(xy * 3.0 + float2(0.0, depth * 9.0)).rgb;
  half3 wallDark = f * mix(half3(0.16, 0.13, 0.15), half3(0.62, 0.5, 0.38), porch) * (1.0 - 0.45 * depth);
  // phía thành quay về nến sáng hơn; rim cam nóng ở mép trong
  half3 wallLit = f * half3(1.15, 0.78, 0.42) * (0.45 + 0.9 * depth) + half3(1.0, 0.5, 0.12) * smoothstep(0.6, 1.0, depth) * 0.5;
  half3 wall = mix(wallDark, wallLit, clamp(candle, 0.0, 1.0));

  half3 hole = mix(wall, inside, inner);
  // khi chưa đục xong mép lỗ vẫn mềm: trộn với vỏ theo outer
  half3 c = mix(skin.rgb, hole, outer);
  return half4(c, max(skin.a, outer));
}`)!;
