import { CAM } from "../scene/layout";

// Moon as a screen-space sprite at infinity (MOON agent, FEEDBACK-2300 #1).
// The moon in bg/pano was painted on a flat sky card, so re-projecting it when the camera looks up / around stretches it
// into a tilted ellipse. Instead: project the moon's WORLD direction through the view basis (rotation only — it is at
// infinity, eye shift does not matter), and draw a ROUND sprite there whose texture is the original moon disc + halo +
// nearby clouds, read from the base frame (where it is round). The sprite covers the warped original (blend ring
// 1.2–1.45 R), so no separate "erase" pass is needed; it only replaces pixels whose depth is sky (roof, posts, trees stay
// in front). No new uniforms: uses view/vX/vY/vZ/vf from VIEW_SKSL.

// Moon disc measured in bg_dark.jpg (round there): centre and radius in design pt (bgK = 3 px/pt).
const MOON_PT = [63.33, 106.67];
const MOON_R_PT = 44;

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const nrm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return a.map((x) => x / l);
};
// base-frame pt → world direction (inverse of toBase in viewSksl)
const VW = [440, 956];
const sx = (MOON_PT[0] - 0.5 * VW[0]) / CAM.f;
const sy = (MOON_PT[1] - 0.5 * VW[1]) / CAM.f;
const [cX, cY, cZ] = CAM.rot;
const MOON_V = nrm([0, 1, 2].map((i) => cX[i] * sx - cY[i] * sy - cZ[i]));
// angular size such that the sprite matches the original disc at rest (tangential magnification 1/cos)
const TANR = (MOON_R_PT / CAM.f) / Math.hypot(sx, sy, 1);
// world "up" on the moon's tangent plane, so the moon's features keep their orientation when the camera rolls
const UP_T = nrm(sub([0, 0, 1], MOON_V.map((x) => x * MOON_V[2])));

const f3 = (v: number[]) => `float3(${v.map((x) => x.toFixed(6)).join(", ")})`;

/** Needs VIEW_SKSL before it. moonSprite(xy, w) → (base-frame pt to sample, alpha); w = distance along the ray (m). */
export const MOON_SKSL = `
const float3 MOON_V  = ${f3(MOON_V)};
const float3 MOON_UP = ${f3(UP_T)};
const float2 MOON_PT = float2(${MOON_PT[0].toFixed(3)}, ${MOON_PT[1].toFixed(3)});
const float  MOON_RP = ${MOON_R_PT.toFixed(3)};
const float  MOON_T  = ${TANR.toFixed(6)};

float3 moonSprite(float2 xy, float w) {
  float z = -dot(MOON_V, vZ);
  if (z < 0.05 || w < 60.0) return float3(0.0);
  float2 sc = 0.5 * view + float2(dot(MOON_V, vX), -dot(MOON_V, vY)) * (vf / z);
  float rs = MOON_T * vf / z;                        // round sprite radius on screen (pt)
  float2 p = xy - sc;
  float r = length(p) / rs;
  if (r > 1.45) return float3(0.0);
  // screen direction of the moon's world-up (roll of the view camera)
  float3 c2 = MOON_V + MOON_UP * 0.05;
  float z2 = -dot(c2, vZ);
  float2 su = normalize(float2(dot(c2, vX), -dot(c2, vY)) * (vf / z2) + 0.5 * view - sc);
  float2 sr = float2(-su.y, su.x);
  float2 o = float2(dot(p, sr), -dot(p, su)) * (MOON_RP / rs);
  o *= min(1.0, 61.0 / max(length(o), 1e-3));        // stay inside the base image (moon is 63 pt from its left edge)
  float a = (1.0 - smoothstep(1.2, 1.45, r)) * smoothstep(60.0, 140.0, w);
  return float3(MOON_PT + o, a);
}
`;
