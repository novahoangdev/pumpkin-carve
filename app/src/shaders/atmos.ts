import { Skia } from "react-native-skia";
import { DEPTH_SKSL, VIEW_SKSL } from "./viewSksl";
import { FLAME_W, PUMPKIN, ROOF, SHELL } from "../scene/layout";
import { STRIKES } from "../fx/storm";

// Không khí phủ lên toàn cảnh (vẽ sau quả bí, srcOver với màu premultiplied). Mọi thứ nằm trong KHÔNG GIAN 3D của cảnh,
// dùng chung camera xem (viewRay, eye) với nền và quả bí nên xoay / nghiêng / zoom đều đúng phối cảnh và parallax:
//   sương: khối thể tích bám sát mặt đất (mật độ giảm theo độ cao, nhiễu trôi theo gió trong toạ độ thế giới), ray-march
//     từ mắt tới bề mặt cảnh (thềm z = 0, sân z = −0,43, tường sau, quả bí). Mỗi mẫu được chiếu sáng thật:
//       trăng (hướng MOON, bị mái che dưới hiên), đèn hiên (điểm, 1/d²), nến (điểm trong lòng bí, CHỈ lọt qua lỗ khắc:
//       đoạn mẫu → lửa phải cắt vỏ ở lỗ, cả mặt ngoài lẫn mặt trong vì vỏ dày chặn tia xiên), ánh hắt từ vũng sáng trên
//       thềm, sét (hướng tia sét, quả bí đổ bóng vào sương). Tán xạ Henyey–Greenstein: sương sáng hơn khi nhìn về phía
//       nguồn sáng (tia sáng qua mắt bí rực khi nhìn thẳng vào mặt, mờ khi nhìn ngang).
//     → tia sáng (god rays) là phần sương nằm trong chùm sáng qua lỗ khắc, tự đúng hình, đúng chỗ, đúng parallax.
//   khói nến: sợi khói 3D bốc từ khe nắp quanh cuống (khí nóng thoát lên trên), thẳng lúc đầu rồi xoắn, nghiêng theo gió;
//     bị quả bí / cảnh che theo độ sâu, được ánh nến rọi từ dưới, trăng và sét chiếu theo hướng.
//   quầng đèn hiên, loé nến (quầng ống kính, theo góc tới nguồn sáng), vignette, hạt film.
const f3 = (v: number[]) => `float3(${v.map((x) => x.toFixed(5)).join(", ")})`;
const dirOf = (az: number, el: number) => [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
// hướng tới cú sét đang đánh: demo theo STRIKES (cùng đồng hồ `time` với storm.ts), tương tác: hướng trung bình (trời bên trái)
const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
const BOLT_FN = `float3 boltDir() {
${DEMO ? STRIKES.map((k) => `  if (time >= ${k.t.toFixed(3)} && time < ${(k.t + 1.2).toFixed(3)}) return ${f3(dirOf(k.az, k.el))};`).join("\n") : ""}
  return ${f3(dirOf(-0.6, 0.55))};
}`;
const MOON_DIR = [-0.45, 1.0, 0.55].map((x) => x / Math.hypot(-0.45, 1.0, 0.55)); // build_scene.py MOON_DIR
const LID = [PUMPKIN.c[0], PUMPKIN.c[1] + PUMPKIN.r[1] * 0.05, PUMPKIN.c[2] + PUMPKIN.r[2] * 0.85];
const SMOKE_SRC = [PUMPKIN.c[0], PUMPKIN.c[1] + 0.012, PUMPKIN.c[2] + PUMPKIN.r[2] - 0.006];

// depth = true: điểm cuối tia lấy từ ảnh độ sâu thật (bg_depth / bg_depth_pano, cần 2 child depthB, depthP và uniform
// của DEPTH_SKSL); false: mặt cảnh giải tích (thềm, sân, tường sau), không cần thêm gì.
const build = (depth: boolean) => `
uniform shader mask;       // lỗ khắc (px mask)
uniform shader skin;       // vỏ bí (alpha = hình quả bí, px ảnh crop)
uniform float  imgS;
uniform float3 crop;
uniform float  maskS;
uniform float  time;
uniform float  porch;
uniform float  candle;     // đã gồm chập chờn
uniform float  flash;      // loé lúc nến bùng (0..1)
uniform float  storm;      // loé sét (0..1)
uniform float  hidden;     // quả bí trong Dynamic Island
uniform float3 fOff;       // nguồn chùm sáng lệch theo lửa (flameFollow), m
${VIEW_SKSL}
${depth ? DEPTH_SKSL : ""}

// hình học cảnh (m), khớp build_scene.py
const float3 FLAME = ${f3(FLAME_W)};
const float3 LIDP  = ${f3(LID)};                       // mặt trong nắp, được lửa rọi
const float3 SMOKE = ${f3(SMOKE_SRC)};                 // khe nắp quanh cuống
const float3 LAMP  = float3(-0.08, 1.42, 1.32);        // đèn hiên
const float3 MOON  = ${f3(MOON_DIR)};
const float4 ROOF  = float4(${ROOF.slice(0, 4).map((x) => x.toFixed(3)).join(", ")});
const float  EAVE  = ${ROOF[4].toFixed(3)};
const float  SHELL = ${SHELL.toFixed(4)};
const float  FRONT = -0.62;   // mép thềm
const float  BACK  = 1.55;    // tường sau / lan can
const float  WALLX = -0.30;   // tường nhà từ x này sang phải; bên trái là lan can mở ra sân
const float  YARD  = -0.43;   // mặt sân
const float  TFAR  = 35.0;    // tích sương tối đa tới đây (m)
const float  FHY   = 0.4;     // bề dày lớp sương ngoài sân (m)
const float  SIGY  = 0.7;
const float  RB    = 0.5;    // bán kính vùng tính chùm sáng nến (m)     // trên cao này sương gần như bằng 0

float hash(float2 p) { float3 p3 = fract(float3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
${BOLT_FN}
// Henyey–Greenstein (không chuẩn hoá, = 1 khi g = 0); c = cos góc giữa hướng nhìn và hướng tới nguồn sáng
// (xấp xỉ Schlick, rẻ hơn pow)
float hg(float c, float g) { float k = 1.55 * g - 0.55 * g * g * g; float q = 1.0 - k * c; return (1.0 - k * k) / (q * q); }
bool onPorch(float3 p) { return p.x > -2.62 && p.x < 5.35 && p.y > FRONT && p.y < BACK; }
// 1 = dưới mái hiên (trăng / sét không rọi thẳng), mềm ở mép mái
float shelter(float3 p) {
  float m = min(min(p.x - ROOF.x, ROOF.y - p.x), min(p.y - ROOF.z, ROOF.w - p.y));
  return smoothstep(-0.25, 0.35, m) * step(p.z, EAVE);
}

// điểm màn hình → toạ độ crop của quả bí đứng yên (âm/ >1: ngoài)
float2 cropUV(float2 sxy) {
  if (hidden > 0.5) return float2(-1.0);
  float3 bb = toBase(pumpkinHitW(sxy) - cam0);
  if (bb.z < 0.5) return float2(-1.0);
  return (bb.xy - crop.xy) / crop.z;
}
float pumpkinA(float2 xy) {
  float2 uv = cropUV(xy);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return skin.eval(uv * imgS).a;
}
// điểm trên vỏ (hệ bí đứng yên) → lỗ khắc
float holeW(float3 e) {
  float2 uv = (toBase(e - cam0).xy - crop.xy) / crop.z;      // bỏ phần nén/xoay khi nhảy (nến chỉ sáng lúc bí đứng yên)
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return mask.eval(uv * maskS).r;
}
// phần ánh sáng từ nguồn sp (trong lòng bí) tới được điểm p (hệ bí đứng yên): phải ra qua lỗ khắc ở mặt trước,
// lọt cả mặt ngoài lẫn mặt trong của vỏ (tia càng xiên càng bị thành vết cắt chặn)
float through(float3 p, float3 sp) {
  float3 q = sp - p;
  float3 h = ellHit(p, q, pr);
  if (h.z < 0.5 || h.x < 0.0 || h.x > 1.0) return 0.0;
  float3 e1 = p + q * h.x;
  if (dot(e1 - pc, normalize(cam0 - pc)) < 0.02) return 0.0;   // chỉ mặt trước được khắc
  float a = holeW(e1);
  if (a < 0.01) return 0.0;
  float3 qn = normalize(q);
  float3 nn = normalize((e1 - pc) / (pr * pr));
  float len = SHELL / max(dot(qn, -nn), 0.25);                   // quãng đi qua bề dày vỏ
  return a * holeW(e1 + qn * len);
}
// mặt cảnh gần nhất theo tia (thềm, sân, tường sau), tối đa 9 m
float sceneT(float3 o, float3 d) {
  float t = 9.0;
  if (d.z < -1e-4) {
    float tf = -o.z / d.z;
    if (onPorch(o + d * tf)) t = min(t, tf);
    else t = min(t, (YARD - o.z) / d.z);
  }
  if (d.y > 1e-4) {
    float tw = (BACK - o.y) / d.y;
    float3 p = o + d * tw;
    if (p.x > WALLX && p.z < 3.4) t = min(t, tw);
  }
  return t;
}
// sương mù sát đất: mật độ σ = SIG·n·exp(−h/FH) + HAZE·exp(−h/1,5 m) (h = độ cao trên mặt thềm / sân, n = nhiễu trôi theo gió).
// Phần exp tích phân giải tích dọc tia (không nhiễu hạt, rẻ); n lấy tại 2 điểm tứ phân vị khối sương trên tia.
const float FH   = 0.24;
const float SIG  = 0.6;     // dưới mái: mưa / gió ít đưa sương vào
const float HAZE = 0.02;
float noiseFog(float3 p, float far) {
  float2 w = p.xy * 2.1 + float2(-time * 0.2, time * 0.05) + float2(p.z * 2.5, -p.z * 1.5);
  float n = noise(w);
  if (far < 0.5) n = n * 0.62 + noise(p.xy * 5.3 + float2(time * 0.3, -time * 0.1) - p.z * 4.0) * 0.38;   // chi tiết chỉ ở gần
  n = mix(n, 0.5, far * 0.6);                                    // xa: nhiễu nhỏ hơn mắt thấy → lấy trung bình
  return smoothstep(0.22, 0.85, n);
}
// ∫ exp(−(z − g)/H) dt trên [a, b]
float tauExpH(float3 o, float3 d, float a, float b, float g, float H) {
  if (b <= a) return 0.0;
  float e0 = exp(-max(o.z + d.z * a - g, 0.0) / H);
  float e1 = exp(-max(o.z + d.z * b - g, 0.0) / H);
  return abs(d.z) > 1e-3 ? max(H * (e0 - e1) / d.z, 0.0) : (b - a) * e0;
}
// ∫ exp(−(z − g)/FH) dt trên [a, b]
float tauExp(float3 o, float3 d, float a, float b, float g) {
  if (b <= a) return 0.0;
  float e0 = exp(-max(o.z + d.z * a - g, 0.0) / FH);
  float e1 = exp(-max(o.z + d.z * b - g, 0.0) / FH);
  return abs(d.z) > 1e-3 ? max(FH * (e0 - e1) / d.z, 0.0) : (b - a) * e0;
}
// đoạn tia trong thềm (x, y trong chữ nhật thềm): [tin, tout]; ngoài thềm là bậc trước / sân
float2 porchSpan(float3 o, float3 d, float a, float b) {
  float2 inv = 1.0 / float2(abs(d.x) > 1e-5 ? d.x : 1e-5, abs(d.y) > 1e-5 ? d.y : 1e-5);
  float2 t1 = (float2(-2.62, FRONT) - o.xy) * inv;
  float2 t2 = (float2(5.35, BACK) - o.xy) * inv;
  return float2(max(max(min(t1.x, t2.x), min(t1.y, t2.y)), a), min(min(max(t1.x, t2.x), max(t1.y, t2.y)), b));
}
// ∫ exp(−h/FH) dt trên [a, b] với mặt đất theo vùng (bậc trước −0,2; thềm 0; sân YARD, sương sân mỏng hơn)
float tauNear(float3 o, float3 d, float a, float b, float2 ps) {
  if (ps.y <= ps.x) return tauExp(o, d, a, min(b, 0.4), -0.2);
  return tauExp(o, d, a, min(ps.x, b), -0.2) + tauExp(o, d, ps.x, min(ps.y, b), 0.0);
}
// điểm mà khối sương (phần exp, mặt đất z = 0) trên [a, b] tích luỹ được tỉ lệ q
float tQuant(float3 d, float a, float b, float q) {
  float L = b - a;
  float k = d.z / FH;
  if (abs(k * L) < 1e-3) return a + q * L;
  return a - log(1.0 - q * (1.0 - exp(-k * L))) / k;
}
// ánh sáng tới một điểm s (thế giới) nhìn theo hướng dn; sr = cùng điểm trong hệ bí đứng yên
half3 lightAt(float3 s, float3 sr, float3 dn) {
  float sh = shelter(s);
  // sương không sáng hơn mặt đất được trăng rọi: trời + trăng ~0,2–0,38, tán xạ thuận nhẹ khi nhìn về phía trăng
  half3 L = half3(0.08, 0.1, 0.15) * (1.0 - 0.3 * sh);                                  // trời đêm (lọt vào dưới mái từ hai phía mở)
  float cm = max(dot(dn, MOON), 0.0);
  L += half3(0.15, 0.18, 0.26) * (1.0 - 0.85 * sh) * (0.75 + 0.5 * cm * cm * cm * cm);  // trăng
  if (porch > 0.01) {
    float3 v = LAMP - s; float d2 = dot(v, v);
    L += half3(1.0, 0.72, 0.42) * porch * 0.32 / (d2 + 0.03) * hg(dot(dn, v * inversesqrt(d2)), 0.35) * 0.55;
  }
  if (candle > 0.01) {
    float3 v = FLAME - sr; float d2 = dot(v, v);
    {
      // (chùm sáng qua lỗ khắc tính riêng trong beams(), dày mẫu quanh quả bí)
      // vũng sáng mặt cười trên thềm hắt ngược lên lớp sương sát sàn; vỏ mỏng hắt ấm rất nhẹ quanh quả bí
      float2 pq = sr.xy - float2(0.0, -0.42);
      L += half3(1.0, 0.6, 0.3) * candle * (2.2 * exp(-max(s.z, 0.0) / 0.15) * exp(-pq.x * pq.x / 0.08 - pq.y * pq.y / 0.035)
                                            + 0.03 / (d2 + 0.04));             // quanh bí ấm lên khi đã thắp
    }
  }
  if (storm > 0.01) {
    float3 BOLT = boltDir();
    float3 hb = ellHit(sr, BOLT, pr);
    float vis = (hb.z > 0.5 && hb.y > 0.0) ? 0.0 : 1.0;                               // quả bí đổ bóng vào sương
    L += half3(0.75, 0.82, 1.0) * storm * (0.15 + 0.45 * vis * (1.0 - 0.6 * sh) * hg(dot(dn, BOLT), 0.35) * 0.5);
  }
  return L;
}

// sợi khói nến: đường tâm theo độ cao h (m) trên khe nắp, thẳng rồi xoắn dần, nghiêng theo gió (+x)
float3 smokeC(float h) {
  float a = 0.002 + 0.05 * h + 0.16 * h * h;                     // lúc đầu thẳng (chảy tầng), lên cao xoắn mạnh dần
  float x = 0.08 * h + 0.4 * h * h + a * sin(h * 8.0 - time * 2.1) + a * 0.45 * sin(h * 19.0 - time * 3.4 + 1.0);
  float y = -0.03 * h + a * 0.9 * cos(h * 6.5 - time * 1.8);
  return SMOKE + float3(x, y, h);
}
// tia o + d·t cắt sợi khói (tấm cong quanh trục khói, quay mặt về mắt): rgb premultiplied, a; tS = độ sâu
half4 smoke(float3 o, float3 d, float tEnd, out float tS) {
  tS = 1e4;
  float3 nrm = float3(o.xy - (SMOKE.xy + jW.xy), 0.0);
  nrm = normalize(nrm);
  float den = dot(d, nrm);
  if (den > -1e-3) return half4(0.0);
  float3 c = SMOKE + jW;
  float3 W = o;
  float t = 0.0;
  float3 tg = float3(-nrm.y, nrm.x, 0.0);
  t = dot(c - o, nrm) / den;
  W = o + d * t;
  float h0 = W.z - c.z;
  float u0 = dot(W - c, tg);
  if (h0 < -0.02 || h0 > 0.95 || u0 < -0.12 || u0 > 0.12 + 0.3 * h0) return half4(0.0);   // xa sợi khói: bỏ qua
  for (int k = 0; k < 2; k++) {
    c = smokeC(W.z - SMOKE.z - jW.z) + jW;
    t = dot(c - o, nrm) / den;
    W = o + d * t;
  }
  c = smokeC(W.z - SMOKE.z - jW.z) + jW;
  float h = W.z - SMOKE.z - jW.z;
  if (h < 0.0 || h > 0.9 || t < 0.0 || t > tEnd) return half4(0.0);
  float u = dot(W - c, tg);
  float r = 0.006 + 0.035 * h + 0.06 * h * h;
  float core = exp(-u * u / (r * r));
  float n = noise(float2(u / r * 1.3 + 3.0, h * 8.0 - time * 1.4));
  float n2 = noise(float2(u / r * 0.6 - 5.0, h * 3.5 - time * 0.7));        // đứt đoạn thành từng dải mảnh
  float dens = core * smoothstep(0.0, 0.03, h) * exp(-h / 0.4) * (0.25 + 1.0 * n) * mix(1.0, smoothstep(0.3, 0.7, n2), smoothstep(0.08, 0.3, h))
             * min(1.0, 0.012 / r + 0.3);
  float al = clamp(dens * 0.32 * smoothstep(0.05, 0.6, candle), 0.0, 0.4);
  if (al < 0.002) return half4(0.0);
  tS = t;
  float3 wr = W - jW;
  float sh = shelter(W);
  half3 L = half3(0.2, 0.23, 0.32) + half3(0.3, 0.36, 0.5) * (1.0 - 0.8 * sh) * hg(dot(d, MOON), 0.5) * 0.4;
  float3 v = SMOKE - wr; float d2 = dot(v, v);
  L += half3(1.0, 0.62, 0.3) * candle * 0.006 / (d2 + 0.01);                            // khe nắp + mắt bí rọi từ dưới
  L += half3(1.0, 0.72, 0.42) * porch * 0.3 / (dot(LAMP - W, LAMP - W) + 0.03);
  if (storm > 0.01) L += half3(0.8, 0.86, 1.0) * storm * (0.4 + 1.6 * (1.0 - 0.6 * sh) * hg(dot(d, boltDir()), 0.4) * 0.5);
  return half4(L * half3(0.82, 0.84, 0.88) * al, al);
}

half4 main(float2 xy) {
  float3 dn = normalize(viewRay(xy));
  float3 o = eye;
  // điểm cuối: mặt cảnh; quả bí theo hình thật (alpha vỏ) với độ sâu từ ellipsoid
${depth ? "  float tEnd;\n  reproject(dn, tEnd);                                           // khoảng cách thật từ mắt tới mặt cảnh" : "  float tEnd = sceneT(o, dn);"}
  float3 ph = ellHit(o - jW, dn, pr);
  float pa = pumpkinA(xy);
  if (hidden < 0.5) tEnd = mix(tEnd, min(tEnd, max(ph.x, 0.0)), pa);

  float tS;
  half4 sm = candle > 0.01 && hidden < 0.5 ? smoke(o, dn, tEnd, tS) : half4(0.0);
  bool sd = sm.a <= 0.0;

  // chùm sáng nến qua lỗ khắc: đoạn tia trong quả cầu RB quanh ngọn lửa, phía trước quả bí, 6 mẫu (chùm hẹp cần mẫu dày)
  half3 bm = half3(0.0);
  float tBm = 1e4;
  bool bd = true;
  if (candle > 0.01 && hidden < 0.5) {
    float3 oc = o - (FLAME + jW);
    float b = dot(oc, dn);
    float disc = b * b - (dot(oc, oc) - RB * RB);
    if (disc > 0.0) {
      float sq = sqrt(disc);
      float t0 = max(-b - sq, 0.06), t1 = min(-b + sq, tEnd);
      // chùm sáng chỉ thoát ra ở mặt trước (phía camera gốc): cắt đoạn tia ở mặt phẳng qua tâm bí
      float3 nf = normalize(float3(cam0.xy - pc.xy, 0.0));
      float dz = dot(dn, nf);
      if (dz < -1e-4) t1 = min(t1, dot(pc + jW - o, nf) / dz);
      if (t1 > t0) {
        float jb = hash(floor(xy * 3.0) + 41.0);
        float dt = (t1 - t0) / 6.0;
        for (int k = 0; k < 6; k++) {
          float3 s = o + dn * (t0 + (float(k) + jb) * dt);
          float3 sr = s - jW;
          // ngọn lửa có kích thước thật (~2 × 3,5 cm): lấy mẫu rải trong ngọn lửa → mép chùm sáng mềm như nến thật
          float3 fj = FLAME + fOff + (float3(hash(xy + float(k) * 7.1), hash(xy - float(k) * 3.3), hash(xy.yx + float(k))) - 0.5)
                              * float3(0.02, 0.02, 0.035);
          float3 v = fj - sr; float d2 = dot(v, v);
          float vis = through(sr, fj);
          if (vis > 0.0)
            bm += half3(1.0, 0.58, 0.24) * ((SIG * noiseFog(s, 0.0) * exp(-max(s.z, 0.0) / FH) + HAZE) * dt * vis * smoothstep(RB * RB, RB * RB * 0.4, d2) * 0.18 / (d2 + 0.004)
                  * hg(dot(dn, v * inversesqrt(d2)), 0.4) * 0.5);
        }
        bm *= candle;
        tBm = t0;
        bd = false;
      }
    }
  }

  // sương: tích phân giải tích dọc tia, 2 đoạn: gần (bậc + thềm, dưới mái) và xa (sân ngoài, trăng rọi thẳng)
  float tA = 0.45;                                              // không có sương dính sát ống kính (mắt có thể thấp ~0,28 m)
  float tB = tEnd;
  tB = min(tB, TFAR);                                            // xa hơn: sương đã đặc, không cần tính tiếp
  half3 col = half3(0.0);
  float T = 1.0;
  if (tB > tA) {
    float2 ps = porchSpan(o, dn, tA, tB);
    float tM = ps.y > ps.x ? ps.y : min(tB, 0.4);                // hết đoạn gần
    float qa = tQuant(dn, tA, tM, 0.35), qb = tQuant(dn, tA, tM, 0.75);
    float nn = 0.5 * (noiseFog(o + dn * qa, smoothstep(2.0, 6.0, qa)) + noiseFog(o + dn * qb, smoothstep(2.0, 6.0, qb)));
    float tau1 = SIG * nn * tauNear(o, dn, tA, tM, ps) + HAZE * tauExpH(o, dn, tA, tM, 0.0, 1.5);
    float a1 = 1.0 - exp(-tau1);
    float3 p1 = o + dn * tQuant(dn, tA, tM, 0.5);
    col = a1 * lightAt(p1, p1 - jW, dn);
    T = 1.0 - a1;
    if (tB > tM + 0.05) {
      float qc = tQuant(dn, tM, tB, 0.5);
      float3 p2 = o + dn * qc;
      // sương ngoài sân: lớp dày hơn (FHY), đỉnh lớp nhấp nhô theo nhiễu neo thế giới nên không có mép phẳng.
      // Tia gần nằm ngang đi qua lớp sát đất rất dài: 1 mẫu nhiễu/điểm ảnh nhảy xa theo hàng → vệt ngang như mặt hồ.
      // Lấy trung bình 2 điểm tứ phân vị + đốm lớn (~3 m) để sân tối lộ ra giữa các dải sương, và bão hoà mềm độ dày.
      float qd = tQuant(dn, tM, tB, 0.25), qe = tQuant(dn, tM, tB, 0.75);
      float ny = 0.5 * (noiseFog(o + dn * qd, 1.0) + noiseFog(o + dn * qe, 1.0));
      float pa = smoothstep(0.3, 0.75, noise(p2.xy * 0.33 + float2(-time * 0.03, time * 0.012)));
      float tau2 = SIGY * (0.15 + 1.1 * ny) * (0.3 + 0.9 * pa) * tauExpH(o, dn, tM, tB, YARD, FHY * (0.65 + 0.7 * ny)) + HAZE * tauExpH(o, dn, tM, tB, YARD, 1.5);
      tau2 = 1.3 * (1.0 - exp(-tau2 / 1.3));                    // tối đa ~73 %: sân và nhà hàng xóm luôn còn thấy mờ mờ
      float a2 = 1.0 - exp(-tau2);
      col += T * a2 * lightAt(p2, p2 - jW, dn) * 0.8;            // xa: ít tán xạ bội, không sáng hơn mặt sân được trăng rọi
      T *= 1.0 - a2;
    }
    // khói và chùm sáng nến nằm trong sương gần: bị phần sương phía trước che
    if (!bd) col += exp(-(SIG * nn * tauNear(o, dn, tA, max(tBm, tA), ps) + HAZE * max(tBm - tA, 0.0))) * bm;
    if (!sd) col += exp(-(SIG * nn * tauNear(o, dn, tA, max(tS, tA), ps) + HAZE * max(tS - tA, 0.0))) * sm.rgb;
  } else {
    col = bm + sm.rgb;
  }
  T *= 1.0 - sm.a;

  // quầng ống kính: đèn hiên, loé nến (theo góc giữa tia nhìn và hướng tới nguồn, cỡ cố định theo góc)
  half3 add = half3(0.0);
  float3 vl = normalize(LAMP - o);
  float dl = acos(clamp(dot(dn, vl), -1.0, 1.0)) * focal;
  add += half3(1.0, 0.78, 0.5) * porch * exp(-dl / 30.0) * 0.35;
  float3 vfl = normalize(FLAME + jW - o);
  float dfl = acos(clamp(dot(dn, vfl), -1.0, 1.0)) * focal;
  add += half3(1.0, 0.7, 0.4) * flash * 0.12 * exp(-dfl / 160.0) * (1.0 - hidden);

  // vignette + hạt film: tối hoá bằng alpha đen
  float2 c = (xy / view - 0.5) * float2(1.0, 0.8);
  float vig = smoothstep(0.25, 0.75, length(c)) * 0.55;
  float grain = (hash(xy + fract(time * 1.7) * 113.0) - 0.5) * 0.02;    // lớp này vẽ ở 1/3 mật độ (ATMOS_DOWN) nên hạt to gấp 3: giảm biên độ

  float a = clamp(1.0 - T, 0.0, 0.92);
  float aTot = a + vig * (1.0 - a);
  half3 outc = col * (1.0 - vig) + add + grain;
  return half4(outc, aTot);
}`;

export const atmos = Skia.RuntimeEffect.Make(build(false))!;
/** Bản dùng độ sâu thật: cần thêm child depthB, depthP (sau mask, skin) và uniform của depthU. */
export const atmosDepth = Skia.RuntimeEffect.Make(build(true))!;
