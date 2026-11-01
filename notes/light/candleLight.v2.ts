import { Skia } from "react-native-skia";
import { CAM, FLAME_W, PUMPKIN } from "../scene/layout";

/**
 * Candle light leaking through the carved holes onto the porch, plus the pumpkin's own shadows.
 *
 * 1. `candleLight` — baked ONCE per mask change on the plate image (pt · lk): R = floor L / 6 (contract unchanged),
 *    G = giant face on the wall / door behind the pumpkin (0..1). Children: maskBlur, depthB, mask (crisp). Per pixel:
 *    - surface point P from depth; on the porch boards P is the exact plane hit (the 8-bit log depth steps ~2 cm at
 *      this range — that was the 3–4 stacked horizontal bands of the old map).
 *    - ONE light source of real size: the hot spot on the inner lid above the flame (disc r 1.8 cm, see LID_C), 48
 *      sunflower points rotated per pixel. Each point: segment P → point must pass the outer shell in a hole AND the inner shell in a hole
 *      (thick rind trims oblique beams). → a single face image, crisp next to the pumpkin, penumbra growing linearly with
 *      distance (old map: 3 fixed rings + 2 points = 4–5 offset copies of the mouth).
 *    - a soft bounce from the lit inner walls = the widely blurred mask along the centre ray (no copies, just a glow).
 *    - pixels whose centre ray misses every hole by more than the blur radius exit after one tap.
 *    - wall face: same disc-source sampling (32 points, r 6 mm) from a projection centre 22 cm in front of the flame,
 *      through the MIRROR of the carved front onto the back half (see faceShadow.ts for why) → ~5× face between the
 *      pumpkin and the lantern, penumbra ∝ distance. Replaces the per-frame faceShadow overlay pass.
 * 2. `CANDLE_FLOOR_SKSL` — per frame in background.ts (candleShade also adds the wall face from G, flame sway ×4): flicker-warped lookup (tiny shift / scale around the pumpkin foot,
 *    same rhythm as the flame), shading = the Blender glow plate (wood albedo, dark gaps, 1/d²) × L, plus a warm
 *    wet-wood specular streak (GGX-ish, Fresnel at grazing angles), plus a warm halo at the pumpkin's foot.
 * 3. `PUMPKIN_SHADOW_SKSL` — analytic shadows of the pumpkin ellipsoid replacing the hard-edged shadow_lit/dark plates:
 *    contact AO (very dark, narrow), ambient occlusion, and soft shadows from the porch lantern (sphere light) and the
 *    moon behind clouds (cone light) whose penumbra widens with distance from the pumpkin.
 */

const f = (v: number) => v.toFixed(5);
const v3 = (a: number[]) => `float3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;
// Blender scene (build_scene.py): porch lantern light and moon direction
const LANTERN_W = [-0.08, 1.42, 1.335];
const MOON = (() => {
  const d = [-0.45, 1.0, 0.55];
  const l = Math.hypot(d[0], d[1], d[2]);
  return d.map((x) => x / l);
})();
// light centre of the flame (a bit above the wick), for the wet-floor glint
const FLAME_C = [FLAME_W[0], FLAME_W[1], FLAME_W[2] + 0.009];
/**
 * The light that draws the face on the boards. The flame sits at the height of the bottom of the mouth, so its own
 * rays clear only a sliver of the mouth; what really paints the face is the hot inner lid above it. Even from the lid
 * the eye beams land ~0.5 m out (below the bottom edge of the frame) and the thick rind eats the nose. So the
 * projection centre is a disc a little above the lid (LID_C, r = LID_R): steeper beams → eyes, nose and mouth all land
 * on the boards in front, as one face, penumbra ∝ distance from the hole. 48 samples, rotated per pixel.
 */
const LID_R = 0.02;
const LID_C = [FLAME_W[0], FLAME_W[1] + 0.03, PUMPKIN.c[2] + PUMPKIN.r[2] + 0.05];
/** Wall face (lightMap.g): see faceShadow.ts. Centre pushed 22 cm toward the camera → ~5× face between pumpkin and lantern. */
const AXIS = (() => {
  const x = PUMPKIN.c[0] - CAM.pos[0], y = PUMPKIN.c[1] - CAM.pos[1];
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l, 0];
})();
const WALL_C = [FLAME_W[0] - AXIS[0] * 0.22, FLAME_W[1] - AXIS[1] * 0.22, FLAME_W[2] - 0.03];
const WALL_R = 0.006;

export const candleLight = Skia.RuntimeEffect.Make(`
uniform shader maskBlur;   // blurred carve mask (mask px)
uniform shader depthB;     // plate depth (log), px = pt · dK
uniform shader mask;       // crisp carve mask (px mask): keeps teeth / corners that the 9 px blur erases
uniform float  lk;         // map px per pt
uniform float2 view;
uniform float3 cam0;
uniform float3 camX;
uniform float3 camY;
uniform float3 camZ;
uniform float  focal;
uniform float3 pc;
uniform float3 pr;
uniform float3 flameW;
uniform float  shell;
uniform float3 crop;
uniform float  maskK;
uniform float  dK;
uniform float2 dRange;

const float3 FC = ${v3(LID_C)};     // centre of the lid hot spot (disc source)
const float  FRAD = ${f(LID_R)};
const float3 WAX = ${v3(AXIS)};     // horizontal axis camera → pumpkin (front / back split)
const float3 WC = ${v3(WALL_C)};    // projection centre for the wall face
const float  WRAD = ${f(WALL_R)};

float2 toBase(float3 d) {
  float cz = min(dot(camZ, d), -1e-4);
  return 0.5 * view + float2(dot(camX, d), -dot(camY, d)) * focal / (-cz);
}
float3 ellHit(float3 o, float3 d, float3 r) {
  float3 a = d / r; float3 q = (o - pc) / r;
  float A = dot(a, a); float B = 2.0 * dot(a, q); float C = dot(q, q) - 1.0;
  float disc = B * B - 4.0 * A * C;
  if (disc <= 0.0) return float3(0.0, 0.0, 0.0);
  float sq = sqrt(disc);
  return float3((-B - sq) / (2.0 * A), (-B + sq) / (2.0 * A), 1.0);
}
float blurAt(float3 e) { return maskBlur.eval((toBase(e - cam0) - crop.xy) * maskK).r; }
// crisp hole edge; the source size does the softening (penumbra ∝ distance)
float holeAt(float3 e) { return smoothstep(0.3, 0.7, mask.eval((toBase(e - cam0) - crop.xy) * maskK).r); }
float through(float3 p, float3 s) {
  float3 q = s - p;
  float3 h = ellHit(p, q, pr);
  if (h.z < 0.5 || h.x < 0.0 || h.x > 1.0) return 0.0;
  float3 e1 = p + q * h.x;
  if (dot(e1 - pc, cam0 - pc) < 0.0) return 0.0;      // only the carved front
  float a = holeAt(e1);
  if (a < 0.01) return 0.0;
  float3 ri = pr * (1.0 - shell / pr.x);              // inner wall = outer shell shrunk about the centre
  float3 h2 = ellHit(p, q, ri);
  if (h2.z < 0.5) return a;
  float3 e2 = p + q * h2.x;
  float3 nn = normalize((e2 - pc) / (ri * ri));
  return a * mix(1.0, holeAt(e2 + nn * shell), 0.65);   // rind trims steep beams, never wipes a feature out
}
float hash(float2 p) { return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453); }

// floor / front surfaces: disc source on the lid seen through the carved front (see LID_C)
float floorL(float3 p, float rot) {
  if (dot(p - pc, cam0 - pc) < -0.05 || length(p - pc) > 3.0) return 0.0;
  // centre ray: wide blurred mask at the outer shell → bounce glow, and the early-out for pixels far from any beam
  float3 q0 = FC - p;
  float3 h0 = ellHit(p, q0, pr);
  if (h0.z < 0.5 || h0.x < 0.0 || h0.x > 1.0) return 0.0;
  float3 e0 = p + q0 * h0.x;
  if (dot(e0 - pc, cam0 - pc) < 0.0) return 0.0;
  float glow = blurAt(e0);
  if (glow < 0.002) return 0.0;
  // sunflower points rotated per pixel (no fixed rings → no stacked copies)
  float vis = 0.0;
  for (int i = 0; i < 48; i++) {
    float fi = float(i) + 0.5;
    float r = FRAD * sqrt(fi / 48.0);
    float ph = fi * 2.3999632 + rot;
    vis += through(p, FC + float3(r * cos(ph), r * sin(ph), 0.0));
  }
  vis /= 48.0;
  return 0.55 * vis + 0.2 * min(glow * 1.4, 1.0) * (0.4 + 0.6 * vis);
}

// wall / door / ceiling behind the pumpkin: the same kind of disc source (WC, r = WRAD, in the plane facing the wall),
// projected through the MIRROR of the carved front onto the back half (faceShadow.ts explains why)
float mirHole(float3 e) { return holeAt(e - 2.0 * dot(e - pc, WAX) * WAX); }
float wallThrough(float3 p, float3 s) {
  float3 q = p - s;
  float3 h = ellHit(s, q, pr);
  if (h.z < 0.5) return 0.0;
  float a = mirHole(s + q * h.y);                        // where the beam leaves the back of the shell
  if (a < 0.01) return 0.0;
  float3 ri = pr * (1.0 - shell / pr.x);
  float3 h2 = ellHit(s, q, ri);
  if (h2.z < 0.5) return a;
  float3 e2 = s + q * h2.y;
  float3 nn = normalize((e2 - pc) / (ri * ri));
  return a * mix(1.0, mirHole(e2 + nn * shell), 0.65);
}
float wallL(float3 p, float rot) {
  if (dot(p - pc, WAX) < 0.1 || length(p - pc) > 4.0) return 0.0;
  float3 q0 = p - WC;
  float3 h0 = ellHit(WC, q0, pr);
  if (h0.z < 0.5) return 0.0;
  float3 e0 = WC + q0 * h0.y;
  if (blurAt(e0 - 2.0 * dot(e0 - pc, WAX) * WAX) < 0.002) return 0.0;
  float3 ux = normalize(cross(WAX, float3(0.0, 0.0, 1.0)));
  float vis = 0.0;
  for (int i = 0; i < 32; i++) {
    float fi = float(i) + 0.5;
    float r = WRAD * sqrt(fi / 32.0);
    float ph = fi * 2.3999632 + rot;
    vis += wallThrough(p, WC + ux * (r * cos(ph)) + float3(0.0, 0.0, r * sin(ph)));
  }
  return vis / 32.0;
}

half4 main(float2 xy) {
  float2 b = xy / lk;
  float2 s = (b - 0.5 * view) / focal;
  float3 dir = normalize(camX * s.x - camY * s.y - camZ);
  float D = dRange.x * exp(depthB.eval(b * dK).r * dRange.y);
  float3 p = cam0 + dir * D;
  // porch boards: exact plane hit instead of the quantised depth
  if (p.z < 0.05 && dir.z < -1e-3) {
    float tf = -cam0.z / dir.z;
    if (abs(tf - D) < 0.1 * D) p = cam0 + dir * tf;
  }
  float rot = hash(xy) * 6.2831853;
  // R = floor L / 6 (contract unchanged), G = wall face 0..1
  return half4(half(floorL(p, rot)), half(wallL(p, rot)), 0.0, 1.0);
}`)!;

/**
 * Per-frame candle shading on the porch (include in background.ts after VIEW_SKSL; needs `lightMap`, `lk`).
 * candleL(lb): lightMap lookup with the flame's flicker (shift + scale around the pumpkin foot, same rhythm as
 * pumpkin.ts' flame); candleShade(...): diffuse × glow plate (wood), wet specular, foot halo.
 */
export const CANDLE_FLOOR_SKSL = `
uniform float3 clFlick;    // x, y shift (pt, plate), scale (relative)
uniform float2 clFoot;     // pumpkin foot on the plate (pt)
uniform float  clWet;      // wet-floor gloss 0..1

// porch boards: exact plane hit (the reprojected P carries the 8-bit depth steps)
float3 floorSnap(float3 P, float3 dn) {
  if (P.z < 0.05 && dn.z < -1e-3) {
    float tf = -eye.z / dn.z;
    float3 F = eye + dn * tf;
    if (length(F - P) < 0.1 * length(P - eye)) return F;
  }
  return P;
}
float candleL(float2 lb) {
  float2 q = clFoot + (lb - clFoot) / (1.0 + clFlick.z) + clFlick.xy;
  return lightMap.eval(q * lk).r * 6.0;
}
// giant face on the wall (lightMap.g): the flame sways ×4 on the wall
float candleWall(float2 lb) {
  float2 q = clFoot + (lb - clFoot) / (1.0 + clFlick.z * 2.0) + clFlick.xy * 4.0;
  return lightMap.eval(q * lk).g;
}
half3 candleShade(float3 P, float3 dn, half3 g, float L, float cdl) {
  half3 warm = half3(1.0, 0.84, 0.66);
  // the glow plate was rendered with the pumpkin hidden: put back its occlusion (dark contact at the foot)
  float ao = pumpkinAO(P);
  half3 c = g * cdl * (0.05 + L) * warm * ao;
  // translucent rind: a thin warm ring on the boards just outside the foot (not under it)
  float3 pf = P - (pc + jW);
  float rf = length(pf.xy / pr.xy);
  c += g * cdl * half3(1.0, 0.6, 0.28) * 0.9 * exp(-(rf - 1.12) * (rf - 1.12) * 40.0) * step(P.z, 0.03) * ao;
  // wall / door: warm face, texture and hue from the glow plate (too dark there to use as is), 1/d² from the flame
  float3 wb3 = toBase(P - jW - cam0);
  float W = wb3.z > 0.5 ? candleWall(wb3.xy) : 0.0;
  if (W > 0.004) {
    half lg = dot(g, half3(0.3, 0.59, 0.11));
    half3 alb = g / (lg + 0.012) * (0.1 + 0.6 * lg / (lg + 0.03));
    float3 qf = P - jW - ${v3(FLAME_C)};
    c += alb * half3(1.0, 0.58, 0.24) * (W * cdl * 24.0 / (0.6 + dot(qf, qf)));
  }
  // wet wood: the beams glint toward the viewer at grazing angles (light comes from behind the patch)
  if (P.z < 0.02 && L > 0.01) {
    float3 lv = normalize(${v3(FLAME_C)} + jW - P);
    float3 vv = -dn;
    float3 hv = normalize(lv + vv);
    float nh = max(hv.z, 0.0);
    float a2 = 0.09;                                        // roughness² of wet worn boards
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float ggx = a2 / (3.14159 * dd * dd);
    float fr = 0.04 + 0.96 * pow(1.0 - max(vv.z, 0.0), 5.0);
    half lum = dot(g, half3(0.3, 0.59, 0.11));
    float grain = clamp(lum * 9.0, 0.25, 1.4);              // gaps / dark grain hold less sheen
    c += half3(1.0, 0.7, 0.4) * (ggx * fr * L * cdl * clWet * grain * 0.05);
  }
  return c;
}
`;

/**
 * Analytic pumpkin shadows (include after VIEW_SKSL). pumpkinShade(P) = (lit multiplier, dark multiplier):
 * lantern = sphere light r 9 cm, moon = cone ~4.5° (behind thin clouds), contact AO + ambient occlusion for both.
 */
export const PUMPKIN_SHADOW_SKSL = `
const float3 LANTERN_W = ${v3(LANTERN_W)};
const float3 MOON_D = ${v3(MOON)};

// visibility of a light of angular radius beta seen from P past the pumpkin ellipsoid (centre cc), soft cone test
float occl(float3 P, float3 l, float beta, float3 cc) {
  float3 c = (cc - P) / pr;                                 // unit-sphere space
  float3 ls = normalize(l / pr);
  float dc = length(c);
  float alpha = asin(clamp(1.0 / dc, 0.0, 1.0));            // occluder angular radius
  float th = acos(clamp(dot(ls, c / dc), -1.0, 1.0));       // light ↔ occluder centre
  return smoothstep(alpha - beta, alpha + beta, th);
}
// ambient occlusion of the pumpkin over the boards (sphere AO in ellipsoid space) × a tight, very dark contact term
float pumpkinAO(float3 P) {
  float3 c = (pc + jW - P) / pr;
  float dc = length(c);
  float cosu = clamp(c.z / dc, 0.0, 1.0);
  float ao = 1.0 - 0.6 * cosu / (dc * dc);
  float gap = max(dc - 1.0, 0.0);
  float lift = max(jW.z, 0.0);
  float contact = 1.0 - 0.85 * exp(-gap * 10.0) * step(P.z, 0.03) * exp(-lift * 25.0);
  return ao * contact;
}
float2 pumpkinShade(float3 P) {
  float3 cc = pc + jW;
  float base = pumpkinAO(P);
  float3 lv = LANTERN_W - P;
  float dl = length(lv);
  float lan = occl(P, lv, atan(0.09 / dl) * 1.0, cc);
  float moon = occl(P, MOON_D, 0.08, cc);
  // the plates keep fill / bounce light inside the shadows: umbra ~0.4, never black
  return float2(base * mix(1.0, lan, 0.6), base * mix(1.0, moon, 0.55));
}
`;

/** Per-frame uniforms for CANDLE_FLOOR_SKSL: flicker in the flame's rhythm (pumpkin.ts / faceShadow.faceFlame). */
export const candleFloorUniforms = (t: number, foot: readonly number[] | number[]) => {
  "worklet";
  const wob = Math.sin(t * 13.1) * 0.5 + Math.sin(t * 29.3 + 1.7) * 0.3 + Math.sin(t * 6.7 + 0.4) * 0.4;
  return {
    clFlick: [wob * 0.9, Math.sin(t * 17.9 + 2.1) * 0.5, Math.sin(t * 9.7 + 0.8) * 0.012 + wob * 0.006],
    clFoot: [foot[0], foot[1]],
    clWet: 0.8,
  };
};
