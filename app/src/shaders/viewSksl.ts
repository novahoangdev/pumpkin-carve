// Đoạn SkSL dùng chung: camera xem (xoay + zoom + mắt dịch vài cm) → tia thế giới → toạ độ ảnh camera gốc, quả bí
// là ellipsoid giải tích (độ sâu cho parallax), và phép biến đổi ngược khi quả bí nhảy. Xem src/scene/view.ts.
export const VIEW_SKSL = `
uniform float2 view;       // khung thiết kế 402×874 (pt)
uniform float3 vX;         // trục camera xem (thế giới): phải
uniform float3 vY;         //                              lên
uniform float3 vZ;         //                              ngược hướng nhìn
uniform float  vf;         // tiêu cự camera xem (pt)
uniform float3 eye;        // vị trí mắt camera xem (m)
uniform float3 cam0;       // vị trí camera gốc (m)
uniform float3 camX;       // trục camera gốc (Blender)
uniform float3 camY;
uniform float3 camZ;
uniform float  focal;      // tiêu cự camera gốc (pt)
uniform float3 pc;         // tâm quả bí (m)
uniform float3 pr;         // bán kính ellipsoid quả bí (m)
uniform float2 jFoot;      // đáy quả bí trên ảnh gốc (pt)
uniform float2 jMid;       // tâm quả bí trên ảnh gốc (pt)
uniform float2 jOff;       // dịch khi nhảy (pt ảnh gốc)
uniform float3 jW;         // dịch khi nhảy quy ra thế giới (m) ở độ sâu quả bí
uniform float2 jSq;        // nén/giãn quanh đáy
uniform float  jRot;       // xoay quanh tâm (rad)
uniform float  jScale;     // thu nhỏ quanh tâm

float3 viewRay(float2 xy) {
  float2 s = (xy - 0.5 * view) / vf;
  return vX * s.x + vY * (-s.y) - vZ;
}
// hướng từ camera gốc → ảnh camera gốc (pt); z = 0 nếu ở sau camera gốc
float3 toBase(float3 d) {
  float cz = dot(camZ, d);
  if (cz > -1e-4) return float3(-1e4, -1e4, 0.0);
  return float3(0.5 * view + float2(dot(camX, d), -dot(camY, d)) * focal / (-cz), 1.0);
}
// phần nén/xoay/thu nhỏ của cú nhảy (phần dịch đã tính trong không gian 3D qua jW)
float2 invJumpLocal(float2 p) {
  p = jFoot + (p - jFoot) / jSq;
  float2 q = p - jMid;
  float c = cos(-jRot); float s = sin(-jRot);
  q = float2(q.x * c - q.y * s, q.x * s + q.y * c) / max(jScale, 1e-3);
  return jMid + q;
}
// điểm ảnh gốc đang hiển thị → điểm tương ứng trên quả bí lúc đứng yên
float2 invJump(float2 p) { return invJumpLocal(p - jOff); }

// tia o + d·t chạm ellipsoid bán kính r quanh pc: x = t gần, y = t xa, z = 1 nếu chạm
// (trượt: x = y = điểm gần tâm nhất theo metric ellipsoid, liên tục ở viền)
float3 ellHit(float3 o, float3 d, float3 r) {
  float3 a = d / r; float3 q = (o - pc) / r;
  float A = dot(a, a); float B = 2.0 * dot(a, q); float C = dot(q, q) - 1.0;
  float disc = B * B - 4.0 * A * C;
  if (disc <= 0.0) { float t = -B / (2.0 * A); return float3(t, t, 0.0); }
  float sq = sqrt(disc);
  return float3((-B - sq) / (2.0 * A), (-B + sq) / (2.0 * A), 1.0);
}
// điểm thế giới → điểm màn hình (pt) của camera xem
float2 projView(float3 P) {
  float3 d = P - eye;
  return 0.5 * view + float2(dot(d, vX), -dot(d, vY)) * vf / max(-dot(d, vZ), 1e-4);
}
// bí bay như vật rắn: xoay / thu nhỏ / nén quanh tâm & đáy quả bí TRÊN MÀN HÌNH trước khi bắn tia, để hình bóng
// ellipsoid và ảnh vỏ xoay cùng nhau (trước đây chỉ ảnh vỏ xoay → bí méo như bao khi lộn ngược). Đứng yên: không đổi.
float2 jumpScreen(float2 sxy) {
  float2 c = projView(pc + jW);
  float2 f = projView(pc + jW - float3(0.0, 0.0, pr.z));
  float2 p = f + (sxy - f) / jSq;
  float2 q = p - c;
  float cr = cos(-jRot); float sr = sin(-jRot);
  q = float2(q.x * cr - q.y * sr, q.x * sr + q.y * cr) / max(jScale, 1e-3);
  return c + q;
}
// điểm màn hình → điểm trên mặt quả bí đứng yên (m), hệ quy chiếu đã bỏ phần dịch khi nhảy
// LIGHT 00:25: bí bay = khối cứng 2D. Trước đây tia bắn từ "mắt lệch" eye − jW: bí bay cao → nhìn thấy đáy quả bí, mà ảnh
// vỏ Blender bị sàn cắt phẳng ở đáy (trong suốt) → một dải thân tàng hình + vành vỏ rời quanh bí khi xoay / lộn. Giờ dời
// điểm màn hình về chỗ bí đứng yên (sau khi bỏ xoay / nén / thu nhỏ) và bắn tia từ mắt thật: bí bay trông y như lúc đứng
// yên (đủ cuống, viền mềm), chỉ dịch / xoay / co giãn như một khối. jW nằm trên mặt phẳng camera ở độ sâu quả bí nên dịch
// 2D đúng cỡ. Đứng yên (jW = 0, jRot = 0, jSq = 1): không đổi gì.
float2 restScreen(float2 sxy) { return jumpScreen(sxy) - (projView(pc + jW) - projView(pc)); }
float3 pumpkinRay(float2 sxy) { return normalize(viewRay(restScreen(sxy))); }
float3 pumpkinHitW(float2 sxy) {
  float3 d = pumpkinRay(sxy);
  return eye + d * ellHit(eye, d, pr).x;
}
// điểm thế giới (hệ bí đứng yên) → toạ độ ảnh gốc của quả bí đứng yên (pt)
float2 pumpkinXY(float3 h) { return toBase(h - cam0).xy; }
`;

// Độ sâu cảnh (bg_depth*.png, log) để dựng lại nền khi mắt dịch, che mưa đúng chỗ, và tìm điểm thế giới của mỗi pixel.
// Khai báo 2 child shader: đặt đúng thứ tự ImageShader khi include.
export const DEPTH_SKSL = `
uniform shader depthB;     // độ sâu ảnh gốc, px = pt · dK
uniform shader depthP;     // độ sâu panorama
uniform float  dK;
uniform float2 dpSize;     // px ảnh độ sâu panorama
uniform float2 dRange;     // min (m), ln(max/min)
uniform float3 pFwd;       // hệ trục panorama
uniform float3 pRight;
uniform float4 pRange;     // lon0, lon1, lat0, lat1 (rad)

float decodeD(float v) { return dRange.x * exp(v * dRange.y); }
// hướng (từ camera gốc) → toạ độ panorama 0..1
float2 panoUV(float3 n) {
  float lon = atan(dot(n, pRight), dot(n, pFwd));
  float lat = asin(clamp(n.z, -1.0, 1.0));
  return float2((lon - pRange.x) / (pRange.y - pRange.x), (pRange.w - lat) / (pRange.w - pRange.z));
}
// khoảng cách (m) từ camera gốc tới bề mặt theo hướng n (đơn vị)
float depthDir(float3 n) {
  float3 bb = toBase(n);
  float2 b = bb.xy;
  if (bb.z > 0.5 && min(min(b.x, view.x - b.x), min(b.y, view.y - b.y)) > 1.0) return decodeD(depthB.eval(b * dK).r);
  return decodeD(depthP.eval(panoUV(n) * dpSize).r);
}
// tia nhìn từ mắt (đơn vị dn) → hướng từ camera gốc tới cùng bề mặt; w = khoảng cách từ mắt (m)
float3 reproject(float3 dn, out float w) {
  float t = depthDir(dn);
  float3 off = eye - cam0;
  if (dot(off, off) < 1e-8) { w = t; return dn; }
  float3 dir = dn;
  for (int i = 0; i < 3; i++) {
    float3 p = off + dn * t;          // điểm trên tia nhìn (so với camera gốc)
    dir = normalize(p);
    float3 s = dir * depthDir(dir);   // bề mặt theo hướng đó
    t = max(dot(s - off, dn), 0.05);
  }
  w = t;
  return normalize(off + dn * t);
}
`;
