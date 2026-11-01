import { Skia } from "react-native-skia";
import { CAM, CROP, DEPTH, MASK, PUMPKIN, SHELL, VIEW } from "../scene/layout";
import { DEPTH_SKSL, VIEW_SKSL } from "./viewSksl";

/**
 * Lightning shining THROUGH the carved face: on every strike a cold blue-white light from the sky behind the pumpkin
 * pours out of the eyes, nose and mouth toward the viewer — the holes flare white, short beams streak out of them in
 * the rain, and a face-shaped patch of light slaps onto the porch boards in front, all following the strike's
 * flash curve (`storm` = flashCurve). Only once something is carved; stronger before the candle is lit.
 * v4 (review 18:45): the holes no longer flare flat white — the flash only lights the interior detail with a cold
 * tint (≤ ~0.55); the beam march (pixel-column streaks under the mouth) is gone; the floor patch is looked up on the
 * exact floor plane (the reprojected P carried the 8-bit depth steps → jagged edge at the foot).
 * v5 (feedback 23:00): no floor patch at all — outside the amber candle face the boards stay plain wood, flash or not.
 *
 * The light is a directional source from behind-above (LDIR, toward the light). The floor patch is a true
 * projection: floor point P → ray P + LDIR·t → front shell (outer hole) → inner shell (thick rind clips oblique
 * rays). That part is baked ONCE per mask change on the plate image (`lightningMap`, like candleLight's lightMap);
 * per frame only one map tap. Beams are a short march in plate space toward LDIR's vanishing point over the
 * blurred mask (12 taps, only near the pumpkin, only while flashing).
 */

/** Toward the light: behind the pumpkin (+y), a bit left (where the strikes are), ~32° up: the patch lands just in front and is long enough to read from the low camera. */
export const LDIR = (() => {
  const az = -0.2, el = 0.55;
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
})();

// ── baked once per mask change: R = light through the holes landing on the plate pixel (0..1) ──
export const lightningMap = Skia.RuntimeEffect.Make(`
uniform shader maskBlur;   // blurred carve mask (px mask)
uniform shader mask;       // crisp carve mask
uniform shader depthB;     // plate depth (log), px = pt · dK
uniform float  lk;         // map px per pt
uniform float2 view;
uniform float3 cam0;
uniform float3 camX;
uniform float3 camY;
uniform float3 camZ;
uniform float  focal;
uniform float3 pc;
uniform float3 pr;
uniform float  shell;
uniform float3 crop;
uniform float  maskK;
uniform float  dK;
uniform float2 dRange;
uniform float3 ldir;

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
float holeAt(float3 e, float soft) {
  float2 uv = (toBase(e - cam0) - crop.xy) * maskK;
  return mix(smoothstep(0.2, 0.8, mask.eval(uv).r), min(maskBlur.eval(uv).r * 1.5, 1.0), soft);
}

half4 main(float2 xy) {
  // v5 (feedback 23:00): the cold face patch on the boards is gone (it sat offset from the amber candle face and its
  // faint grey ghost lingered through the flash tail). Kept as a no-op so PumpkinScene's bake / child stay valid.
  if (lk > 0.0) return half4(0.0, 0.0, 0.0, 1.0);
  float2 b = xy / lk;
  float2 s = (b - 0.5 * view) / focal;
  float3 dir = normalize(camX * s.x - camY * s.y - camZ);
  float D = dRange.x * exp(depthB.eval(b * dK).r * dRange.y);
  float3 p = cam0 + dir * D;
  // porch boards: exact plane hit (8-bit log depth steps ~2 cm at this range → the patch would come out striped)
  if (p.z < 0.04 && dir.z < -1e-3) {
    float tf = -cam0.z / dir.z;
    if (abs(tf - D) < 0.08 * D) p = cam0 + dir * tf;
  }
  // only surfaces in front of / beside the pumpkin, within reach
  if (length(p - pc) > 1.6 || p.z > pc.z + 0.05) return half4(0.0, 0.0, 0.0, 1.0);
  float3 h = ellHit(p, ldir, pr);
  if (h.z < 0.5 || h.x < 0.0) return half4(0.0, 0.0, 0.0, 1.0);
  float3 e1 = p + ldir * h.x;
  if (dot(e1 - pc, cam0 - pc) < 0.0) return half4(0.0, 0.0, 0.0, 1.0);   // only the carved front
  float soft = clamp(0.3 + h.x * 2.5, 0.0, 1.0);                         // farther from the hole → softer
  float a = holeAt(e1, soft);
  if (a < 0.01) return half4(0.0, 0.0, 0.0, 1.0);
  float3 ri = pr * (1.0 - shell / pr.x);
  float3 h2 = ellHit(p, ldir, ri);
  if (h2.z > 0.5) {
    float3 e2 = p + ldir * h2.x;
    float3 nn = normalize((e2 - pc) / (ri * ri));
    a *= mix(1.0, holeAt(e2 + nn * shell, soft), 0.7);                    // thick rind trims, never shreds
  }
  return half4(half3(a), 1.0);
}`)!;

/** Uniforms for the bake (drawAsImage W×H = VIEW·lk). */
export const lightningMapUniforms = (lk: number, depthW: number) => ({
  lk,
  view: [VIEW.w, VIEW.h],
  cam0: CAM.pos,
  camX: CAM.rot[0],
  camY: CAM.rot[1],
  camZ: CAM.rot[2],
  focal: CAM.f,
  pc: PUMPKIN.c,
  pr: PUMPKIN.r,
  shell: SHELL,
  crop: [CROP.x, CROP.y, CROP.s],
  maskK: MASK / CROP.s,
  dK: depthW / VIEW.w,
  dRange: [DEPTH.min, Math.log(DEPTH.max / DEPTH.min)],
  ldir: LDIR,
});

// vanishing point of LDIR on the plate (pt): beams on screen run away from it
const VP = (() => {
  const z = CAM.rot[2], x = CAM.rot[0], y = CAM.rot[1];
  const dz = LDIR[0] * z[0] + LDIR[1] * z[1] + LDIR[2] * z[2];
  const cz = Math.min(dz, -1e-3);
  return [
    VIEW.w / 2 + ((LDIR[0] * x[0] + LDIR[1] * x[1] + LDIR[2] * x[2]) * CAM.f) / -cz,
    VIEW.h / 2 - ((LDIR[0] * y[0] + LDIR[1] * y[1] + LDIR[2] * y[2]) * CAM.f) / -cz,
  ];
})();

// ── per frame overlay (blendMode "plus", after the pumpkin, before the rain) ──
export const lightningThrough = Skia.RuntimeEffect.Make(`
uniform shader ltMap;      // baked patch (R), px = pt · ltK
uniform shader mask;       // crisp carve mask (px mask)
uniform shader maskBlur;
${VIEW_SKSL}
${DEPTH_SKSL}
uniform shader inLit;      // interior plate (crop px): flesh / fibre detail the flash picks out
uniform float  imgS;       // interior plate side (px)
uniform float  ltK;
uniform float3 crop;
uniform float  maskS;
uniform float  flash;      // flashCurve × strength (0..1+)
uniform float  candle;     // 0..1.3
uniform float  hidden;
uniform float2 vp;         // (unused since v4: no beams)

float2 cropUV(float2 b) { return (b - crop.xy) / crop.z * maskS; }

half4 main(float2 xy) {
  if (flash < 0.004 || hidden > 0.5) return half4(0.0);
  float g = flash * (1.0 - 0.45 * clamp(candle, 0.0, 1.0));
  half3 cold = half3(0.55, 0.7, 1.0);
  float3 dn = normalize(viewRay(xy));
  float3 e = eye - jW;
  float3 hp = ellHit(e, dn, pr);
  float2 b0 = invJump(toBase(dn).xy);
  float2 cu = (b0 - crop.xy) / crop.z;                      // 0..1 over the pumpkin crop
  if (cu.x < -0.25 || cu.x > 1.25 || cu.y < 0.1 || cu.y > 1.7) return half4(0.0);
  half3 col = half3(0.0);
  if (hp.z > 0.5 && hp.x > 0.0) {
    // through the holes: the flash outside (left) only grazes the inner walls — a cold light ON the interior detail
    // (luminance of the interior plate at the back wall the eye sees), never a flat white fill; capped ~0.55
    float3 H = e + dn * hp.x;
    if (dot(H - pc, cam0 - pc) > 0.0) {
      float m = smoothstep(0.3, 0.7, mask.eval(cropUV(pumpkinXY(H))).r);
      if (m > 0.004) {
        float3 ri = pr * (1.0 - ${SHELL.toFixed(4)} / pr.x);
        float3 hb = ellHit(H, dn, ri);
        float3 B = H + dn * hb.y;
        float2 iu = (pumpkinXY(B) - crop.xy) / crop.z;
        half3 il = inLit.eval(iu * imgS).rgb;
        half lum = dot(il, half3(0.3, 0.59, 0.11));
        // light comes from the left: the right-hand inner wall (seen through the hole) catches more of it
        float side = 0.65 + 0.35 * clamp((B.x - pc.x) / pr.x + 0.3, 0.0, 1.0);
        half ln = lum / (lum + 0.18);
        half3 c = cold * (ln * ln * 1.25 + 0.08) * side * m * g * 1.15;
        col += min(c, half3(0.6));
      }
    }
  }
  return half4(col, 0.0);
}`)!;

/** Uniforms for the overlay besides the shared view/depth block (`depthU` in PumpkinScene). */
export const lightningUniforms = (flash: number, candle: number, hidden: boolean, ltK: number) => {
  "worklet";
  return {
    ltK,
    crop: [CROP.x, CROP.y, CROP.s],
    maskS: MASK,
    flash,
    candle,
    hidden: hidden ? 1 : 0,
    vp: VP,
  };
};
