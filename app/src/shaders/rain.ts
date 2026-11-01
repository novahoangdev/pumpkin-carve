import { Skia } from "react-native-skia";
import { DEPTH_SKSL, VIEW_SKSL } from "./viewSksl";
import { BOLT_N } from "../fx/storm";
import { FLAME_W } from "../scene/layout";

const f3 = (v: number[]) => `float3(${v.map((x) => x.toFixed(5)).join(", ")})`;
// light sources reflected on the wet floor: lit windows found from bg_dark_pano.jpg + bg_depth_pano.png (position m, size m, colour·intensity)
const WATER = [
  { p: [2.6, 1.6, 1.32], s: 0.42, c: [0.5, 0.36, 0.16] },     // our house's window (right of the door)
  { p: [0.95, 1.58, 1.55], s: 0.25, c: [0.38, 0.24, 0.09] },   // front door glass pane
  { p: [-22.6, 12.6, 1.18], s: 0.6, c: [0.9, 0.84, 0.62] },  // house to the left across the yard
  { p: [-22.6, 12.6, 3.5], s: 0.55, c: [0.85, 0.8, 0.6] },
  { p: [-15.3, 17.3, 1.15], s: 0.55, c: [0.9, 0.84, 0.62] },
  { p: [-14.6, 18.4, 3.45], s: 0.5, c: [0.85, 0.8, 0.6] },
];
const lobeLine = (w: (typeof WATER)[number]) =>
  `    env += half3(${w.c.map((x) => x.toFixed(2)).join(", ")}) * lobe(F, r, ${f3(w.p)}, ${w.s.toFixed(2)}, rough);`;
// the 2 near sources (window, door glass) are always computed; the distant neighbour's window only shows clearly on puddles / yard: skipped on merely damp wood to save cost
const WATER_NEAR = WATER.slice(0, 2).map(lobeLine).join("\n");
const WATER_FAR = WATER.slice(2).map(lobeLine).join("\n");
const MOON_DIR = [-0.45, 1.0, 0.55].map((x) => x / Math.hypot(-0.45, 1.0, 0.55)); // build_scene.py MOON_DIR


// Rain, water and lightning bolts, drawn after the pumpkin. Returns premultiplied colour + alpha: alpha > 0 only on the wet floor (wet wood darkens), so it needs
// srcOver blending (with plus the darkening would be lost, everything else is the same).
//   3D rain: cylinder layers around the eye (0.55 → 15 m), drops are vertical streaks anchored in world coordinates falling at 7.5 m/s, motion-blurred by a
//     1/60 s shutter; near drops are large and soft (out of focus); occluded by depth + the pumpkin, no rain under the roof.
//   water (analytic floor plane, checked against the depth image so it does not cover posts / railing):
//     the wet area hugs the porch's outer edge (wind blows rain in), uneven puddles stretch along the board grain; the yard is fully wet.
//     wet wood darkens (alpha) + Fresnel reflection (Schlick, water F0 = 0.02): sky, moon, porch light, windows of our house and the
//     neighbour's (positions from the Blender panorama), the lit pumpkin, lightning; reflections stretch vertically like a real wet surface, blocked by the roof.
//     rain ripples: spreading rings on a world grid, ripple normals distort the reflection; splashes live 0.12 s.
//     drips from the top rail and the roof edge: each drop hangs, grows, falls with acceleration (velocity blur), and on hitting the floor
//     spawns a ripple right there. Everything is a function of time, no CPU particles.
//   lightning: jagged bolts only in the sky region (very far depth), white core + halo, brightness follows the flash timing.
export const rain = Skia.RuntimeEffect.Make(`
${VIEW_SKSL}
${DEPTH_SKSL}
uniform float  time;
uniform float  porch;
uniform float  candle;
uniform float  storm;
uniform float4 roof;       // xmin, xmax, ymin, ymax (m) porch roof
uniform float  eave;       // roof edge height (m)
uniform float  hidden;
uniform float3 bolt[${BOLT_N}];   // [0], [1]: bounding box (az, el); then the points (az, el, brightness of the segment to the next point)
uniform float  boltA;      // bolt brightness
const float3 LAMP   = float3(-0.08, 1.42, 1.32);   // porch light (build_scene.py)
const float3 FLAMEP = ${f3(FLAME_W)};
const float3 MOON   = ${f3(MOON_DIR)};

float hash(float2 p) { float3 p3 = fract(float3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
const float FRONT = -0.62;   // front porch edge
const float BACK  = 1.55;    // back railing (opens onto the yard when x < WALLX)
const float WALLX = -0.30;
const float LEFT  = -2.62;   // left porch edge
const float YARD  = -0.43;   // yard surface
const float RAILZ = 0.84;    // underside of the top rail (hanging drops)
const float RAILY = 1.485;   // just in front of the railing (camera side)
const float3 MOONV = float3(-0.227, 0.867, 0.443);   // moon disc on the panorama (radius ~0.06 rad)

bool sheltered(float3 w) {
  return w.x > roof.x - 0.05 && w.x < roof.y + 0.05 && w.y > roof.z - 0.05 && w.y < roof.w + 0.05 && w.z < eave + 0.2;
}
// lighting on a raindrop at w, viewed along dn. Drops refract / reflect strongly forward: looking back toward
// a light (moon, bolt, lamp) makes drops sparkle much more (Schlick-style scattering phase).
float fwd(float c, float k) { float q = 1.0 - k * c; return (1.0 - k * k) / (q * q); }
half3 lightAt(float3 w, float3 dn) {
  half3 c = half3(0.13, 0.16, 0.22) + half3(0.08, 0.1, 0.14) * fwd(dot(dn, MOON), 0.6);   // night sky + backlit moon
  float3 vl = LAMP - w;                                                                  // porch light beside the door
  float dl2 = dot(vl, vl);
  c += half3(1.0, 0.7, 0.38) * porch * 0.6 / (1.0 + dl2 * 0.8) * fwd(dot(dn, vl * inversesqrt(dl2)), 0.5);
  float3 vc = FLAMEP - w;
  float dc2 = dot(vc, vc);
  c += half3(1.0, 0.55, 0.2) * candle * 0.2 / (1.0 + dc2 * 6.0) * fwd(dot(dn, vc * inversesqrt(dc2)), 0.5);
  if (storm > 0.001) {
    float2 bq = bolt[6].xy;                                                              // direction to the current bolt
    float3 bd = float3(sin(bq.x) * cos(bq.y), cos(bq.x) * cos(bq.y), sin(bq.y));
    c += half3(0.85, 0.9, 1.0) * storm * (1.4 + 0.6 * fwd(dot(dn, bd), 0.6));
  }
  return c;
}
// rain streak in a grid cell (u horizontal, v vertical, m), px = pt per metre at that distance
float streaks(float2 uv, float cw, float ch, float px, float blur, float seed) {
  float col = floor(uv.x / cw);
  float vv = uv.y + time * 7.5 + hash(float2(col, seed)) * ch;
  float row = floor(vv / ch);
  float2 cell = float2(col, row + seed * 13.0);
  if (hash(cell + 0.37) > 0.55) return 0.0;
  float xc = (0.15 + 0.7 * hash(cell)) * cw;
  float dx = abs(uv.x - col * cw - xc) * px;                     // pt
  float L = 0.2 + 0.1 * hash(cell + 2.1);                         // motion blur streak (m)
  float y0 = hash(cell + 5.3) * (ch - L);
  float y = vv - row * ch - y0;
  if (y < 0.0 || y > L) return 0.0;
  float hw = max(0.42, 0.0012 * px) + blur;
  float along = smoothstep(0.0, L * 0.35, y) * smoothstep(L, L * 0.6, y);
  return smoothstep(hw, 0.0, dx) * along * min(1.0, 0.55 / hw);
}

// drips along an edge (coordinate along the edge a, height z): each cw column has its own period; a hanging drop grows then free-falls
// from top to bot, drawn as a small bead blurred vertically by velocity (1/60 s shutter). px = pt per metre at that distance.
float dripAt(float a, float z, float top, float bot, float cw, float seed, float px) {
  float c = floor(a / cw);
  float2 id = float2(c, seed);
  if (hash(id + 0.7) > 0.7) return 0.0;
  float xc = (0.25 + 0.5 * hash(id + 1.9)) * cw;
  float dx = abs(a - c * cw - xc) * px;
  float H = top - bot;
  float tfall = sqrt(2.0 * H / 9.8);
  float T = tfall + 0.35 + 1.1 * hash(id + 3.1);
  float u = fract(time / T + hash(id + 5.3)) * T;                 // seconds into the period; falls at the end of the period
  float tau = u - (T - tfall);
  float r = 0.0024 * px;                                          // drop radius (pt)
  if (tau < 0.0) {                                                // hanging under the edge, growing
    float g = smoothstep(0.0, T - tfall, u);
    float dz = (top - 0.003 * g - z) * px;
    return smoothstep(max(r * g, 0.45) + 0.45, 0.0, length(float2(dx, dz))) * 0.7 * g;
  }
  float zc = top - 4.9 * tau * tau;
  float L = 9.8 * tau / 60.0 * px;                                // blur streak (pt)
  float dz = (z - zc) * px;
  float along = clamp(dz, 0.0, L);
  float d = length(float2(dx, dz - along));
  float hw = max(r, 0.55);
  return smoothstep(hw + 0.5, 0.0, d) * min(1.0, 2.0 / (1.0 + L * 0.15)) * step(zc, top);
}
// floor wetness at F: the porch is wet along its outer edge (rain blown in), uneven puddles stretched along the board grain (along y)
float wetAt(float3 F, bool onP) {
  float2 n2 = F.xy * float2(6.5, 1.6);
  float n = noise(n2) * 0.65 + noise(n2 * 2.7 + 3.1) * 0.35;
  if (!onP) return 0.75 + 0.25 * n;
  // edges with more roof overhang get less blown-in rain: back railing (roof ends right at the edge) ~0.5 m, left edge ~0.3 m, front edge ~0.22 m
  float de = min((F.y - FRONT) * 2.3, (F.x - LEFT) * 1.7);
  if (F.x < WALLX) de = min(de, BACK - F.y);
  float edge = smoothstep(0.5, 0.03, de + (n - 0.5) * 0.3);
  // under the roof it is still patchily damp (blown rain, water off shoes): wood slightly glossy and dark, no standing puddles so no ripples
  float damp = 0.26 * smoothstep(0.3, 0.75, noise(F.xy * float2(1.1, 0.4) + 7.0)) * (0.6 + 0.4 * n);
  return max(edge * smoothstep(0.25, 0.6, n * 0.7 + edge * 0.5), damp);
}
// ripples: summed water surface gradient at F from raindrops on a 0.16 m grid and drips from the railing.
// z: splash brightness. One drop per cell, its own period, the ring spreads then fades.
float3 ripples(float2 q, float rate, float dripRow) {
  float3 g = float3(0.0);
  float2 id = floor(q / 0.16);
  float2 f = q - (id + 0.5) * 0.16;
  if (hash(id + 0.31) < rate) {
    float T = 0.8 + 0.9 * hash(id + 7.7);
    float ph = fract(time / T + hash(id + 2.2)) * T;               // seconds since the drop hit
    float2 cc = (float2(hash(id + 1.3), hash(id + 4.1)) - 0.5) * 0.04;
    float2 dv = f - cc;
    float d = length(dv) + 1e-4;
    float R = 0.004 + ph * 0.11;
    float A = (1.0 - smoothstep(0.0, 0.65, ph));
    float x = (d - R) / 0.009;
    float sl = A * A * x * exp(-x * x) * 1.6;                       // ripple profile slope
    g.xy += dv / d * sl;
    g.z += exp(-d * d / 0.00004) * (1.0 - smoothstep(0.0, 0.12, ph)) + exp(-pow((d - ph * 0.35) / 0.004, 2.0)) * step(ph, 0.12) * 0.6;
  }
  // railing drips hitting the porch: a strip right in front of the railing base, same columns / periods as dripAt (cw 0.11, seed 17)
  if (dripRow > 0.5) {
    float cw = 0.11;
    float c = floor(q.x / cw);
    float2 id2 = float2(c, 17.0);
    if (hash(id2 + 0.7) <= 0.7) {
      float tfall = sqrt(2.0 * RAILZ / 9.8);
      float T = tfall + 0.35 + 1.1 * hash(id2 + 3.1);
      float age = fract(time / T + hash(id2 + 5.3)) * T;          // hits the floor exactly when the period wraps
      float2 dv = float2(q.x - c * cw - (0.25 + 0.5 * hash(id2 + 1.9)) * cw, q.y - (RAILY - 0.01));
      float d = length(dv) + 1e-4;
      float R = 0.003 + age * 0.12;
      float A = 1.0 - smoothstep(0.0, 0.6, age);
      float x = (d - R) / 0.01;
      g.xy += dv / d * A * A * x * exp(-x * x) * 1.8;
      g.z += exp(-pow((d - age * 0.4) / 0.005, 2.0)) * step(age, 0.12) * 0.8;
    }
  }
  return g;
}
// light reflected along r from point F (distant lights: direction; near lights: position); rough = roughness (rad)
half3 lobe(float3 F, float3 r, float3 Lp, float size, float rough) {
  float3 v = Lp - F;
  float dist = length(v);
  v /= dist;
  float sa = size / dist;
  float2 rh = normalize(r.xy), vh = normalize(v.xy);
  float eh = length(rh - vh) * length(r.xy);                       // horizontal offset (rad, approx.)
  float ev = r.z - v.z;                                            // vertical offset
  float kh = sa + rough, kv = sa + rough * 3.5;                    // wet surfaces stretch reflections vertically
  return half3(exp(-(eh * eh) / (kh * kh) - (ev * ev) / (kv * kv)) * (sa / kh) * min(1.0, (sa + 0.01) / kv * 1.5));
}
half4 water(float3 F, float3 dn, float wet, bool onP, float px) {
  float puddle = smoothstep(0.45, 0.85, wet);
  float dripRow = (onP && F.x < WALLX && F.y > BACK - 0.25) ? 1.0 : 0.0;
  bool pool = puddle > 0.01 || !onP;
  float3 g = pool ? ripples(F.xy, onP ? 0.75 * puddle : 0.8, dripRow) * puddle : float3(0.0);
  // damp wood microsurface (no puddle yet) is rougher
  float3 nrm = normalize(float3(-g.xy * 0.9, 1.0));
  float3 r = reflect(dn, nrm);
  float cosv = max(dot(-dn, nrm), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
  float rough = mix(0.08, 0.012, puddle);                         // damp wood: soft gloss; puddle: mirror
  // roof cover: sky / moon reflections are blocked by the roof when the point is under it
  float open = 1.0;
  if (r.z > 0.0) {
    float t = (eave - F.z) / r.z;
    float2 qq = F.xy + r.xy * t;
    open = (qq.x > roof.x && qq.x < roof.y && qq.y > roof.z && qq.y < roof.w) ? 0.06 : 1.0;
  }
  half3 env = mix(half3(0.07, 0.09, 0.16), half3(0.025, 0.03, 0.06), smoothstep(0.02, 0.6, r.z)) * open;
  env += half3(0.85, 0.88, 0.95) * lobe(F, r, F + MOONV * 100.0, 6.0, rough) * open * 2.2;
  env += half3(0.75, 0.8, 1.0) * storm * open * 1.4;
  env += half3(1.0, 0.74, 0.42) * porch * lobe(F, r, LAMP, 0.07, rough) * 7.0;
  {
${WATER_NEAR}
  }
  if (pool) {
${WATER_FAR}
  }
  if (candle > 0.01 && hidden < 0.5) {
    float3 hb = ellHit(F - jW, r, pr);                             // pumpkin reflection: warm glowing mouth / eyes
    if (hb.z > 0.5 && hb.x > 0.0) {
      float3 e = F - jW + r * hb.x - pc;
      float face = smoothstep(0.3, 0.8, dot(normalize(e.xy), normalize(cam0.xy - pc.xy))) * smoothstep(-0.07, 0.0, e.z);
      env += half3(1.0, 0.55, 0.18) * candle * face * 1.3 + half3(0.12, 0.04, 0.01) * candle;
    }
  }
  // ripples catch a little light (visible even when the reflection is dark) + splashes
  half3 amb = half3(0.16, 0.19, 0.27) + half3(1.0, 0.7, 0.4) * porch * 0.25 + half3(1.0, 0.55, 0.2) * candle * 0.15 + half3(0.8, 0.85, 1.0) * storm;
  half3 col = env * fres * wet + amb * (length(g.xy) * 0.55 + g.z * 1.6) * puddle;
  float fade = onP ? 1.0 : smoothstep(30.0, 8.0, length(F - eye));
  return half4(col * fade, wet * (onP ? 0.38 : 0.22) * fade);
}

half4 main(float2 xy) {
  float3 d = viewRay(xy);
  float3 dn = normalize(d);
  float ptPer = vf * length(d);                                   // screen pt per metre at 1 m distance
  float D = depthDir(dn);
  float3 ph = ellHit(eye - jW, dn, pr);
  if (hidden < 0.5 && ph.z > 0.5 && ph.x > 0.0) D = min(D, ph.x);
  float hz = length(dn.xy);
  half3 acc = half3(0.0);
  if (hz > 0.05) {
    float az = atan(dn.x, dn.y);
    for (int i = 0; i < 8; i++) {
      float R = 0.55 * pow(1.62, float(i));                       // 0.55 … 15 m
      float t = R / hz;
      if (t > D) break;
      float3 w = eye + dn * t;
      if (sheltered(w) || w.z < -0.4 || w.z > 6.0) continue;
      float px = ptPer / t;
      float blur = max(0.0, 1.1 - t) * 3.2;                       // drops right at the lens: heavy blur
      float2 uv = float2(az * R + w.z * 0.06, w.z);               // slightly slanted wind
      float s = streaks(uv, 0.07, 1.25, px, blur, float(i));
      acc += lightAt(w, dn) * s * (0.5 + 0.5 * smoothstep(12.0, 3.0, t));
    }
    // drips from the left roof edge (x = roof.x) onto the yard and from the top rail onto the porch
    for (int k = 0; k < 2; k++) {
      float den = k == 0 ? dn.x : dn.y;
      float pl = k == 0 ? roof.x - 0.04 : RAILY;
      float o = k == 0 ? eye.x : eye.y;
      if (abs(den) < 1e-3) continue;
      float t = (pl - o) / den;
      if (t < 0.3 || t > D + 0.02) continue;
      float3 w = eye + dn * t;
      float a = k == 0 ? w.y : w.x;                                // coordinate along the edge
      bool inEdge = k == 0 ? (w.y > roof.z && w.y < roof.w) : (w.x > LEFT + 0.1 && w.x < WALLX - 0.05);
      float top = k == 0 ? eave : RAILZ;
      float bot = k == 0 ? YARD : 0.0;
      if (!inEdge || w.z > top + 0.01 || w.z < bot) continue;
      acc += dripAt(a, w.z, top, bot, k == 0 ? 0.13 : 0.11, float(k) * 17.0, ptPer / t) * lightAt(w, dn) * 2.4;   // drops act like tiny lenses: sparkle
    }
  }
  // water on the porch floor / yard: only in wet areas
  float wa = 0.0;
  if (dn.z < -0.01) {
    float tf = -eye.z / dn.z;
    float3 F = eye + dn * tf;
    bool porchF = F.x > LEFT && F.x < 5.35 && F.y > FRONT && F.y < BACK;
    if (!porchF) { tf = (YARD - eye.z) / dn.z; F = eye + dn * tf; }
    if (abs(D - tf) < 0.05 + 0.04 * tf && tf < 30.0) {          // floor is visible (not covered by posts, railing, pumpkin)
      float wet = wetAt(F, porchF);
      if (wet > 0.02) {
        half4 wr = water(F, dn, wet, porchF, ptPer / tf);
        acc += wr.rgb;
        wa = wr.a;
      }
    }
  }
  // lightning bolt in the sky: thin white core (branches thinner and dimmer), blue-violet halo in the rain / clouds around the channel
  if (boltA > 0.001 && D > 60.0) {
    float az = atan(dn.x, dn.y);
    float el = asin(clamp(dn.z, -1.0, 1.0));
    float2 q = float2(az, el);
    float pad = 0.4;
    if (q.x > bolt[0].x - pad && q.x < bolt[1].x + pad && q.y > bolt[0].y - pad && q.y < bolt[1].y + pad) {
      float core = 0.0;
      float glow = 0.0;
      float dm = 1e3;
      for (int i = 2; i < ${BOLT_N - 1}; i++) {
        float w = bolt[i].z;
        if (w <= 0.0) continue;
        float2 a = bolt[i].xy; float2 b = bolt[i + 1].xy;
        float2 ab = b - a;
        float h = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
        float2 e = (q - a - ab * h) * float2(cos(el), 1.0);
        float dpt = length(e) * vf;
        core = max(core, w * smoothstep(0.35 + 1.1 * w, 0.15, dpt));
        glow = max(glow, w * exp(-dpt / (3.0 + 5.0 * w)));
        if (w > 0.9) dm = min(dm, dpt);
      }
      acc += boltA * (half3(1.0, 0.98, 1.0) * core * 3.2 + half3(0.62, 0.66, 1.0) * glow * 1.1
                      + half3(0.5, 0.56, 0.95) * (exp(-dm / 45.0) * 0.3 + exp(-dm / 160.0) * 0.18));
    }
  }
  return half4(acc, wa);
}`)!;
