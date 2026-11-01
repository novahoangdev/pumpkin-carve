// Shared SkSL: view camera (rotate + zoom + eye offset of a few cm) → world ray → base camera image coordinates, the pumpkin
// as an analytic ellipsoid (depth for parallax), and the inverse transform while the pumpkin jumps. See src/scene/view.ts.
export const VIEW_SKSL = `
uniform float2 view;       // design frame 402×874 (pt)
uniform float3 vX;         // view camera axes (world): right
uniform float3 vY;         //                              up
uniform float3 vZ;         //                              opposite the view direction
uniform float  vf;         // view camera focal length (pt)
uniform float3 eye;        // view camera eye position (m)
uniform float3 cam0;       // base camera position (m)
uniform float3 camX;       // base camera axes (Blender)
uniform float3 camY;
uniform float3 camZ;
uniform float  focal;      // base camera focal length (pt)
uniform float3 pc;         // pumpkin centre (m)
uniform float3 pr;         // pumpkin ellipsoid radii (m)
uniform float2 jFoot;      // pumpkin bottom on the base image (pt)
uniform float2 jMid;       // pumpkin centre on the base image (pt)
uniform float2 jOff;       // jump offset (base image pt)
uniform float3 jW;         // jump offset in world space (m) at the pumpkin's depth
uniform float2 jSq;        // squash/stretch around the bottom
uniform float  jRot;       // rotation around the centre (rad)
uniform float  jScale;     // shrink around the centre

float3 viewRay(float2 xy) {
  float2 s = (xy - 0.5 * view) / vf;
  return vX * s.x + vY * (-s.y) - vZ;
}
// direction from the base camera → base camera image (pt); z = 0 if behind the base camera
float3 toBase(float3 d) {
  float cz = dot(camZ, d);
  if (cz > -1e-4) return float3(-1e4, -1e4, 0.0);
  return float3(0.5 * view + float2(dot(camX, d), -dot(camY, d)) * focal / (-cz), 1.0);
}
// the squash/rotate/shrink part of the jump (the translation is already handled in 3D via jW)
float2 invJumpLocal(float2 p) {
  p = jFoot + (p - jFoot) / jSq;
  float2 q = p - jMid;
  float c = cos(-jRot); float s = sin(-jRot);
  q = float2(q.x * c - q.y * s, q.x * s + q.y * c) / max(jScale, 1e-3);
  return jMid + q;
}
// displayed base image point → corresponding point on the resting pumpkin
float2 invJump(float2 p) { return invJumpLocal(p - jOff); }

// ray o + d·t hits the ellipsoid with radii r around pc: x = near t, y = far t, z = 1 on hit
// (miss: x = y = point closest to the centre in the ellipsoid metric, continuous at the rim)
float3 ellHit(float3 o, float3 d, float3 r) {
  float3 a = d / r; float3 q = (o - pc) / r;
  float A = dot(a, a); float B = 2.0 * dot(a, q); float C = dot(q, q) - 1.0;
  float disc = B * B - 4.0 * A * C;
  if (disc <= 0.0) { float t = -B / (2.0 * A); return float3(t, t, 0.0); }
  float sq = sqrt(disc);
  return float3((-B - sq) / (2.0 * A), (-B + sq) / (2.0 * A), 1.0);
}
// world point → view camera screen point (pt)
float2 projView(float3 P) {
  float3 d = P - eye;
  return 0.5 * view + float2(dot(d, vX), -dot(d, vY)) * vf / max(-dot(d, vZ), 1e-4);
}
// the pumpkin flies as a rigid body: rotate / shrink / squash around the pumpkin centre & bottom ON SCREEN before casting the ray, so the
// ellipsoid silhouette and the rind image rotate together (previously only the rind image rotated → the pumpkin warped like a sack when flipped). At rest: unchanged.
float2 jumpScreen(float2 sxy) {
  float2 c = projView(pc + jW);
  float2 f = projView(pc + jW - float3(0.0, 0.0, pr.z));
  float2 p = f + (sxy - f) / jSq;
  float2 q = p - c;
  float cr = cos(-jRot); float sr = sin(-jRot);
  q = float2(q.x * cr - q.y * sr, q.x * sr + q.y * cr) / max(jScale, 1e-3);
  return c + q;
}
// screen point → point on the resting pumpkin surface (m), in a frame with the jump translation removed
// LIGHT 00:25: flying pumpkin = rigid 2D block. Previously rays were cast from an "offset eye" eye − jW: pumpkin flying high → its bottom shows, but the
// Blender rind image is cut flat by the floor at the bottom (transparent) → an invisible band of body + a detached rind ring when rotating / flipping. Now the
// screen point is moved back to the resting pumpkin (after undoing rotate / squash / shrink) and the ray is cast from the real eye: the flying pumpkin looks exactly
// like at rest (full stem, soft rim), only translating / rotating / scaling as one block. jW lies on the camera plane at the pumpkin's depth so the 2D
// offset has the right size. At rest (jW = 0, jRot = 0, jSq = 1): nothing changes.
float2 restScreen(float2 sxy) { return jumpScreen(sxy) - (projView(pc + jW) - projView(pc)); }
float3 pumpkinRay(float2 sxy) { return normalize(viewRay(restScreen(sxy))); }
float3 pumpkinHitW(float2 sxy) {
  float3 d = pumpkinRay(sxy);
  return eye + d * ellHit(eye, d, pr).x;
}
// world point (resting pumpkin frame) → base image coordinates of the resting pumpkin (pt)
float2 pumpkinXY(float3 h) { return toBase(h - cam0).xy; }
`;

// Scene depth (bg_depth*.png, log) to reproject the background when the eye moves, occlude rain correctly, and find each pixel's world point.
// Declares 2 child shaders: keep the ImageShader order right when including.
export const DEPTH_SKSL = `
uniform shader depthB;     // base image depth, px = pt · dK
uniform shader depthP;     // panorama depth
uniform float  dK;
uniform float2 dpSize;     // panorama depth image px
uniform float2 dRange;     // min (m), ln(max/min)
uniform float3 pFwd;       // panorama axes
uniform float3 pRight;
uniform float4 pRange;     // lon0, lon1, lat0, lat1 (rad)

float decodeD(float v) { return dRange.x * exp(v * dRange.y); }
// direction (from the base camera) → panorama coordinates 0..1
float2 panoUV(float3 n) {
  float lon = atan(dot(n, pRight), dot(n, pFwd));
  float lat = asin(clamp(n.z, -1.0, 1.0));
  return float2((lon - pRange.x) / (pRange.y - pRange.x), (pRange.w - lat) / (pRange.w - pRange.z));
}
// distance (m) from the base camera to the surface along unit direction n
float depthDir(float3 n) {
  float3 bb = toBase(n);
  float2 b = bb.xy;
  if (bb.z > 0.5 && min(min(b.x, view.x - b.x), min(b.y, view.y - b.y)) > 1.0) return decodeD(depthB.eval(b * dK).r);
  return decodeD(depthP.eval(panoUV(n) * dpSize).r);
}
// view ray from the eye (unit dn) → direction from the base camera to the same surface; w = distance from the eye (m)
float3 reproject(float3 dn, out float w) {
  float t = depthDir(dn);
  float3 off = eye - cam0;
  if (dot(off, off) < 1e-8) { w = t; return dn; }
  float3 dir = dn;
  for (int i = 0; i < 3; i++) {
    float3 p = off + dn * t;          // point on the view ray (relative to the base camera)
    dir = normalize(p);
    float3 s = dir * depthDir(dir);   // surface along that direction
    t = max(dot(s - off, dn), 0.05);
  }
  w = t;
  return normalize(off + dn * t);
}
`;
