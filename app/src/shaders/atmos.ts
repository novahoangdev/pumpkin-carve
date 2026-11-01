import { Skia } from "react-native-skia";
import { DEPTH_SKSL, VIEW_SKSL } from "./viewSksl";
import { FLAME_W, PUMPKIN, ROOF, SHELL } from "../scene/layout";
import { STRIKES } from "../fx/storm";

// Atmosphere over the whole scene (drawn after the pumpkin, srcOver with premultiplied colour). Everything lives in the scene's 3D SPACE,
// sharing the view camera (viewRay, eye) with the background and pumpkin, so rotate / tilt / zoom all keep correct perspective and parallax:
//   fog: a volume hugging the ground (density falls with height, noise drifting with the wind in world coordinates), ray-marched
//     from the eye to the scene surface (porch z = 0, yard z = −0.43, back wall, pumpkin). Each sample is properly lit by:
//       the moon (direction MOON, blocked by the roof under the porch), the porch light (point, 1/d²), the candle (point inside the pumpkin, ONLY through the carved holes:
//       the sample → flame segment must cross the rind at a hole, on both the outer and inner surface since the thick rind blocks oblique rays), bounce from the light pool on
//       the porch, lightning (bolt direction, the pumpkin casts a shadow into the fog). Henyey–Greenstein scattering: fog is brighter when looking toward
//       the light source (shafts through the pumpkin's eyes blaze when looking straight at the face, dim when seen side-on).
//     → light shafts (god rays) are just the fog inside the beams through the carved holes, so shape, position and parallax come out right by themselves.
//   candle smoke: a 3D smoke wisp rising from the lid gap around the stem (hot air escaping upward), straight at first then curling, leaning with the wind;
//     occluded by the pumpkin / scene by depth, lit from below by the candle, and directionally by the moon and lightning.
//   porch-light halo, candle flare (lens halo, by angle to the light source), vignette, film grain.
const f3 = (v: number[]) => `float3(${v.map((x) => x.toFixed(5)).join(", ")})`;
const dirOf = (az: number, el: number) => [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
// direction to the current lightning strike: demo follows STRIKES (same `time` clock as storm.ts), interactive: average direction (sky to the left)
const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
const BOLT_FN = `float3 boltDir() {
${DEMO ? STRIKES.map((k) => `  if (time >= ${k.t.toFixed(3)} && time < ${(k.t + 1.2).toFixed(3)}) return ${f3(dirOf(k.az, k.el))};`).join("\n") : ""}
  return ${f3(dirOf(-0.6, 0.55))};
}`;
const MOON_DIR = [-0.45, 1.0, 0.55].map((x) => x / Math.hypot(-0.45, 1.0, 0.55)); // build_scene.py MOON_DIR
const LID = [PUMPKIN.c[0], PUMPKIN.c[1] + PUMPKIN.r[1] * 0.05, PUMPKIN.c[2] + PUMPKIN.r[2] * 0.85];
const SMOKE_SRC = [PUMPKIN.c[0], PUMPKIN.c[1] + 0.012, PUMPKIN.c[2] + PUMPKIN.r[2] - 0.006];

// depth = true: ray end point comes from the real depth image (bg_depth / bg_depth_pano, needs 2 children depthB, depthP and the uniforms
// of DEPTH_SKSL); false: analytic scene surfaces (porch, yard, back wall), nothing extra needed.
const build = (depth: boolean) => `
uniform shader mask;       // carved holes (mask px)
uniform shader skin;       // pumpkin rind (alpha = pumpkin shape, crop image px)
uniform float  imgS;
uniform float3 crop;
uniform float  maskS;
uniform float  time;
uniform float  porch;
uniform float  candle;     // flicker included
uniform float  flash;      // flash when the candle flares (0..1)
uniform float  storm;      // lightning flash (0..1)
uniform float  hidden;     // pumpkin inside the Dynamic Island
uniform float3 fOff;       // beam source offset following the flame (flameFollow), m
${VIEW_SKSL}
${depth ? DEPTH_SKSL : ""}

// scene geometry (m), matches build_scene.py
const float3 FLAME = ${f3(FLAME_W)};
const float3 LIDP  = ${f3(LID)};                       // underside of the lid, lit by the flame
const float3 SMOKE = ${f3(SMOKE_SRC)};                 // lid gap around the stem
const float3 LAMP  = float3(-0.08, 1.42, 1.32);        // porch light
const float3 MOON  = ${f3(MOON_DIR)};
const float4 ROOF  = float4(${ROOF.slice(0, 4).map((x) => x.toFixed(3)).join(", ")});
const float  EAVE  = ${ROOF[4].toFixed(3)};
const float  SHELL = ${SHELL.toFixed(4)};
const float  FRONT = -0.62;   // porch edge
const float  BACK  = 1.55;    // back wall / railing
const float  WALLX = -0.30;   // house wall from this x to the right; to the left the railing opens onto the yard
const float  YARD  = -0.43;   // yard surface
const float  TFAR  = 35.0;    // integrate fog at most up to here (m)
const float  FHY   = 0.4;     // yard fog layer thickness (m)
const float  SIGY  = 0.7;
const float  RB    = 0.5;    // radius of the candle beam region (m)     // above this height fog is almost 0

float hash(float2 p) { float3 p3 = fract(float3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
${BOLT_FN}
// Henyey–Greenstein (unnormalised, = 1 when g = 0); c = cos of the angle between the view direction and the direction to the light
// (Schlick approximation, cheaper than pow)
float hg(float c, float g) { float k = 1.55 * g - 0.55 * g * g * g; float q = 1.0 - k * c; return (1.0 - k * k) / (q * q); }
bool onPorch(float3 p) { return p.x > -2.62 && p.x < 5.35 && p.y > FRONT && p.y < BACK; }
// 1 = under the porch roof (no direct moon / lightning), soft at the roof edge
float shelter(float3 p) {
  float m = min(min(p.x - ROOF.x, ROOF.y - p.x), min(p.y - ROOF.z, ROOF.w - p.y));
  return smoothstep(-0.25, 0.35, m) * step(p.z, EAVE);
}

// screen point → crop coordinates of the resting pumpkin (negative / >1: outside)
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
// point on the rind (resting pumpkin frame) → carved hole
float holeW(float3 e) {
  float2 uv = (toBase(e - cam0).xy - crop.xy) / crop.z;      // drop the jump squash/rotation (the candle only shines while the pumpkin is at rest)
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return mask.eval(uv * maskS).r;
}
// fraction of light from source sp (inside the pumpkin) reaching point p (resting pumpkin frame): it must exit through a carved hole on the front,
// passing both the outer and inner rind surfaces (the more oblique the ray, the more the cut wall blocks it)
float through(float3 p, float3 sp) {
  float3 q = sp - p;
  float3 h = ellHit(p, q, pr);
  if (h.z < 0.5 || h.x < 0.0 || h.x > 1.0) return 0.0;
  float3 e1 = p + q * h.x;
  if (dot(e1 - pc, normalize(cam0 - pc)) < 0.02) return 0.0;   // only the front is carved
  float a = holeW(e1);
  if (a < 0.01) return 0.0;
  float3 qn = normalize(q);
  float3 nn = normalize((e1 - pc) / (pr * pr));
  float len = SHELL / max(dot(qn, -nn), 0.25);                   // path length through the rind thickness
  return a * holeW(e1 + qn * len);
}
// nearest scene surface along the ray (porch, yard, back wall), at most 9 m
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
// ground fog: density σ = SIG·n·exp(−h/FH) + HAZE·exp(−h/1.5 m) (h = height above the porch / yard, n = wind-drifted noise).
// The exp part is integrated analytically along the ray (no grain noise, cheap); n is sampled at the 2 quartile points of the fog mass on the ray.
const float FH   = 0.24;
const float SIG  = 0.6;     // under the roof: rain / wind carry little fog in
const float HAZE = 0.02;
float noiseFog(float3 p, float far) {
  float2 w = p.xy * 2.1 + float2(-time * 0.2, time * 0.05) + float2(p.z * 2.5, -p.z * 1.5);
  float n = noise(w);
  if (far < 0.5) n = n * 0.62 + noise(p.xy * 5.3 + float2(time * 0.3, -time * 0.1) - p.z * 4.0) * 0.38;   // detail only up close
  n = mix(n, 0.5, far * 0.6);                                    // far: noise finer than visible → use the average
  return smoothstep(0.22, 0.85, n);
}
// ∫ exp(−(z − g)/H) dt over [a, b]
float tauExpH(float3 o, float3 d, float a, float b, float g, float H) {
  if (b <= a) return 0.0;
  float e0 = exp(-max(o.z + d.z * a - g, 0.0) / H);
  float e1 = exp(-max(o.z + d.z * b - g, 0.0) / H);
  return abs(d.z) > 1e-3 ? max(H * (e0 - e1) / d.z, 0.0) : (b - a) * e0;
}
// ∫ exp(−(z − g)/FH) dt over [a, b]
float tauExp(float3 o, float3 d, float a, float b, float g) {
  if (b <= a) return 0.0;
  float e0 = exp(-max(o.z + d.z * a - g, 0.0) / FH);
  float e1 = exp(-max(o.z + d.z * b - g, 0.0) / FH);
  return abs(d.z) > 1e-3 ? max(FH * (e0 - e1) / d.z, 0.0) : (b - a) * e0;
}
// ray segment over the porch (x, y inside the porch rectangle): [tin, tout]; outside the porch is the front step / yard
float2 porchSpan(float3 o, float3 d, float a, float b) {
  float2 inv = 1.0 / float2(abs(d.x) > 1e-5 ? d.x : 1e-5, abs(d.y) > 1e-5 ? d.y : 1e-5);
  float2 t1 = (float2(-2.62, FRONT) - o.xy) * inv;
  float2 t2 = (float2(5.35, BACK) - o.xy) * inv;
  return float2(max(max(min(t1.x, t2.x), min(t1.y, t2.y)), a), min(min(max(t1.x, t2.x), max(t1.y, t2.y)), b));
}
// ∫ exp(−h/FH) dt over [a, b] with per-region ground height (front step −0.2; porch 0; yard YARD, thinner yard fog)
float tauNear(float3 o, float3 d, float a, float b, float2 ps) {
  if (ps.y <= ps.x) return tauExp(o, d, a, min(b, 0.4), -0.2);
  return tauExp(o, d, a, min(ps.x, b), -0.2) + tauExp(o, d, ps.x, min(ps.y, b), 0.0);
}
// point where the fog mass (exp part, ground z = 0) over [a, b] has accumulated fraction q
float tQuant(float3 d, float a, float b, float q) {
  float L = b - a;
  float k = d.z / FH;
  if (abs(k * L) < 1e-3) return a + q * L;
  return a - log(1.0 - q * (1.0 - exp(-k * L))) / k;
}
// light arriving at point s (world) viewed along dn; sr = the same point in the resting pumpkin frame
half3 lightAt(float3 s, float3 sr, float3 dn) {
  float sh = shelter(s);
  // fog is no brighter than moonlit ground: sky + moon ~0.2–0.38, slight forward scattering when looking toward the moon
  half3 L = half3(0.08, 0.1, 0.15) * (1.0 - 0.3 * sh);                                  // night sky (reaching under the roof from the two open sides)
  float cm = max(dot(dn, MOON), 0.0);
  L += half3(0.15, 0.18, 0.26) * (1.0 - 0.85 * sh) * (0.75 + 0.5 * cm * cm * cm * cm);  // moon
  if (porch > 0.01) {
    float3 v = LAMP - s; float d2 = dot(v, v);
    L += half3(1.0, 0.72, 0.42) * porch * 0.32 / (d2 + 0.03) * hg(dot(dn, v * inversesqrt(d2)), 0.35) * 0.55;
  }
  if (candle > 0.01) {
    float3 v = FLAME - sr; float d2 = dot(v, v);
    {
      // (beams through the carved holes are computed separately in beams(), dense samples around the pumpkin)
      // the smile light pool on the porch bounces up into the low fog; the thin rind adds a very faint warmth around the pumpkin
      float2 pq = sr.xy - float2(0.0, -0.42);
      L += half3(1.0, 0.6, 0.3) * candle * (2.2 * exp(-max(s.z, 0.0) / 0.15) * exp(-pq.x * pq.x / 0.08 - pq.y * pq.y / 0.035)
                                            + 0.03 / (d2 + 0.04));             // warmer around the pumpkin once lit
    }
  }
  if (storm > 0.01) {
    float3 BOLT = boltDir();
    float3 hb = ellHit(sr, BOLT, pr);
    float vis = (hb.z > 0.5 && hb.y > 0.0) ? 0.0 : 1.0;                               // the pumpkin casts a shadow into the fog
    L += half3(0.75, 0.82, 1.0) * storm * (0.15 + 0.45 * vis * (1.0 - 0.6 * sh) * hg(dot(dn, BOLT), 0.35) * 0.5);
  }
  return L;
}

// candle smoke wisp: centre line by height h (m) above the lid gap, straight then gradually curling, leaning with the wind (+x)
float3 smokeC(float h) {
  float a = 0.002 + 0.05 * h + 0.16 * h * h;                     // straight at first (laminar), curling more strongly higher up
  float x = 0.08 * h + 0.4 * h * h + a * sin(h * 8.0 - time * 2.1) + a * 0.45 * sin(h * 19.0 - time * 3.4 + 1.0);
  float y = -0.03 * h + a * 0.9 * cos(h * 6.5 - time * 1.8);
  return SMOKE + float3(x, y, h);
}
// ray o + d·t intersects the smoke wisp (curved sheet around the smoke axis, facing the eye): premultiplied rgb, a; tS = depth
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
  if (h0 < -0.02 || h0 > 0.95 || u0 < -0.12 || u0 > 0.12 + 0.3 * h0) return half4(0.0);   // far from the wisp: skip
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
  float n2 = noise(float2(u / r * 0.6 - 5.0, h * 3.5 - time * 0.7));        // break up into thin strands
  float dens = core * smoothstep(0.0, 0.03, h) * exp(-h / 0.4) * (0.25 + 1.0 * n) * mix(1.0, smoothstep(0.3, 0.7, n2), smoothstep(0.08, 0.3, h))
             * min(1.0, 0.012 / r + 0.3);
  float al = clamp(dens * 0.32 * smoothstep(0.05, 0.6, candle), 0.0, 0.4);
  if (al < 0.002) return half4(0.0);
  tS = t;
  float3 wr = W - jW;
  float sh = shelter(W);
  half3 L = half3(0.2, 0.23, 0.32) + half3(0.3, 0.36, 0.5) * (1.0 - 0.8 * sh) * hg(dot(d, MOON), 0.5) * 0.4;
  float3 v = SMOKE - wr; float d2 = dot(v, v);
  L += half3(1.0, 0.62, 0.3) * candle * 0.006 / (d2 + 0.01);                            // lid gap + pumpkin eyes light it from below
  L += half3(1.0, 0.72, 0.42) * porch * 0.3 / (dot(LAMP - W, LAMP - W) + 0.03);
  if (storm > 0.01) L += half3(0.8, 0.86, 1.0) * storm * (0.4 + 1.6 * (1.0 - 0.6 * sh) * hg(dot(d, boltDir()), 0.4) * 0.5);
  return half4(L * half3(0.82, 0.84, 0.88) * al, al);
}

half4 main(float2 xy) {
  float3 dn = normalize(viewRay(xy));
  float3 o = eye;
  // end point: scene surface; pumpkin by its real shape (rind alpha) with depth from the ellipsoid
${depth ? "  float tEnd;\n  reproject(dn, tEnd);                                           // true distance from the eye to the scene surface" : "  float tEnd = sceneT(o, dn);"}
  float3 ph = ellHit(o - jW, dn, pr);
  float pa = pumpkinA(xy);
  if (hidden < 0.5) tEnd = mix(tEnd, min(tEnd, max(ph.x, 0.0)), pa);

  float tS;
  half4 sm = candle > 0.01 && hidden < 0.5 ? smoke(o, dn, tEnd, tS) : half4(0.0);
  bool sd = sm.a <= 0.0;

  // candle beams through the carved holes: ray segment inside the RB sphere around the flame, in front of the pumpkin, 6 samples (narrow beams need dense samples)
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
      // beams only exit through the front (base camera side): clip the ray segment at the plane through the pumpkin centre
      float3 nf = normalize(float3(cam0.xy - pc.xy, 0.0));
      float dz = dot(dn, nf);
      if (dz < -1e-4) t1 = min(t1, dot(pc + jW - o, nf) / dz);
      if (t1 > t0) {
        float jb = hash(floor(xy * 3.0) + 41.0);
        float dt = (t1 - t0) / 6.0;
        for (int k = 0; k < 6; k++) {
          float3 s = o + dn * (t0 + (float(k) + jb) * dt);
          float3 sr = s - jW;
          // the flame has a real size (~2 × 3.5 cm): samples spread across the flame → soft beam edges like a real candle
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

  // fog: analytic integral along the ray, 2 segments: near (step + porch, under the roof) and far (yard, direct moonlight)
  float tA = 0.45;                                              // no fog stuck to the lens (the eye can be as low as ~0.28 m)
  float tB = tEnd;
  tB = min(tB, TFAR);                                            // beyond this the fog is already opaque, no need to continue
  half3 col = half3(0.0);
  float T = 1.0;
  if (tB > tA) {
    float2 ps = porchSpan(o, dn, tA, tB);
    float tM = ps.y > ps.x ? ps.y : min(tB, 0.4);                // end of the near segment
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
      // yard fog: a thicker layer (FHY), its top undulating with world-anchored noise so there is no flat edge.
      // Near-horizontal rays travel very far through the ground layer: 1 noise sample per pixel jumps far between rows → horizontal streaks like a lake surface.
      // Average 2 quartile points + large blobs (~3 m) so the dark yard shows between fog bands, and soft-saturate the thickness.
      float qd = tQuant(dn, tM, tB, 0.25), qe = tQuant(dn, tM, tB, 0.75);
      float ny = 0.5 * (noiseFog(o + dn * qd, 1.0) + noiseFog(o + dn * qe, 1.0));
      float pa = smoothstep(0.3, 0.75, noise(p2.xy * 0.33 + float2(-time * 0.03, time * 0.012)));
      float tau2 = SIGY * (0.15 + 1.1 * ny) * (0.3 + 0.9 * pa) * tauExpH(o, dn, tM, tB, YARD, FHY * (0.65 + 0.7 * ny)) + HAZE * tauExpH(o, dn, tM, tB, YARD, 1.5);
      tau2 = 1.3 * (1.0 - exp(-tau2 / 1.3));                    // at most ~73 %: the yard and neighbouring houses always stay faintly visible
      float a2 = 1.0 - exp(-tau2);
      col += T * a2 * lightAt(p2, p2 - jW, dn) * 0.8;            // far: little multiple scattering, no brighter than the moonlit yard
      T *= 1.0 - a2;
    }
    // smoke and candle beams sit inside the near fog: occluded by the fog in front of them
    if (!bd) col += exp(-(SIG * nn * tauNear(o, dn, tA, max(tBm, tA), ps) + HAZE * max(tBm - tA, 0.0))) * bm;
    if (!sd) col += exp(-(SIG * nn * tauNear(o, dn, tA, max(tS, tA), ps) + HAZE * max(tS - tA, 0.0))) * sm.rgb;
  } else {
    col = bm + sm.rgb;
  }
  T *= 1.0 - sm.a;

  // lens halo: porch light, candle flare (by angle between the view ray and the direction to the source, fixed angular size)
  half3 add = half3(0.0);
  float3 vl = normalize(LAMP - o);
  float dl = acos(clamp(dot(dn, vl), -1.0, 1.0)) * focal;
  add += half3(1.0, 0.78, 0.5) * porch * exp(-dl / 30.0) * 0.35;
  float3 vfl = normalize(FLAME + jW - o);
  float dfl = acos(clamp(dot(dn, vfl), -1.0, 1.0)) * focal;
  add += half3(1.0, 0.7, 0.4) * flash * 0.12 * exp(-dfl / 160.0) * (1.0 - hidden);

  // vignette + film grain: darken with black alpha
  float2 c = (xy / view - 0.5) * float2(1.0, 0.8);
  float vig = smoothstep(0.25, 0.75, length(c)) * 0.55;
  float grain = (hash(xy + fract(time * 1.7) * 113.0) - 0.5) * 0.02;    // this layer is drawn at 1/3 density (ATMOS_DOWN) so the grain is 3x larger: reduce the amplitude

  float a = clamp(1.0 - T, 0.0, 0.92);
  float aTot = a + vig * (1.0 - a);
  half3 outc = col * (1.0 - vig) + add + grain;
  return half4(outc, aTot);
}`;

export const atmos = Skia.RuntimeEffect.Make(build(false))!;
/** Variant using real depth: needs extra children depthB, depthP (after mask, skin) and the depthU uniforms. */
export const atmosDepth = Skia.RuntimeEffect.Make(build(true))!;
