import { Skia } from "react-native-skia";
import { DEPTH_SKSL, VIEW_SKSL } from "./viewSksl";
import { CANDLE_FLOOR_SKSL, PUMPKIN_SHADOW_SKSL } from "./candleLight";
import { MOON_SKSL } from "./moon";

// Background: blends the lit / dark images by porch light, adds candlelight leaking through the carved holes, lightning flash.
// Depth-based reprojection: ray from the eye (possibly offset a few cm) → surface point P → direction from the base camera → base image (sharp) or
// the panorama outside the frame. The pumpkin shadow is a separate multiply layer: when the pumpkin jumps the shadow fades and spreads.
// Physically correct candlelight: bgGlow = UNOCCLUDED illumination from inside the pumpkin (Blender, pumpkin hidden); lightMap = the part leaking through the carved
// holes (candleLight.ts, precomputed on the base image when the mask changes). Right under the pumpkin's belly stays dark because the rind blocks the rays.
export const background = Skia.RuntimeEffect.Make(`
uniform shader bgLit;
uniform shader bgDark;
uniform shader bgGlow;
uniform shader panoLit;
uniform shader panoDark;
uniform shader panoGlow;
uniform shader shadowLit;  // pumpkin shadow multiplier (1 = no shadow), base image
uniform shader shadowDark;
uniform shader lightMap;   // candlelight through the carved holes on the base image (R = L/6), px = pt · lk
${VIEW_SKSL}
${DEPTH_SKSL}
uniform float  bgK;        // base background image px per pt
uniform float  shK;        // shadow image px per pt
uniform float2 pSize;      // colour panorama image px
uniform float  porch;      // porch light 0..1
uniform float  candle;     // candle 0..1.3 (flicker already applied)
uniform float  storm;      // lightning flash 0..1
uniform float  jumpH;      // current pumpkin jump height (pt)
uniform float  lk;
uniform float3 fOff;       // light source offset following the flame (flameFollow), m
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
  // base image weight: 1 inside the frame, fading to 0 at the edge (12 pt)
  float wb = bb.z * smoothstep(0.0, 12.0, min(min(b.x, view.x - b.x), min(b.y, view.y - b.y)));
  half3 lit = half3(0.0);
  half3 dark = half3(0.0);
  half3 g = half3(0.0);
  // perf: only sample images that actually contribute (porch light off → skip the "lit" set; fully lit, no lightning → skip the "dark" set)
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
    // pumpkin shadow: fades and spreads with height while jumping
    float lift = clamp(jumpH / 220.0, 0.0, 1.0);
    float2 sp = jFoot + (b - jFoot) / (1.0 + lift * 0.6);
    float k = 1.0 - lift * 0.85;
    if (needDark) dark = mix(dark, bgDark.eval(p).rgb, wb);
    if (needLit) lit = mix(lit, bgLit.eval(p).rgb, wb);
    if (candle > 0.001) g = mix(g, bgGlow.eval(p).rgb, wb);
  }
  // moon: round sprite at infinity along a world direction, covering the stretched original moon (moon.ts)
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
  // lightning: the whole scene flashes with cold sky light (uses the moon-only layer as the sky light direction)
  col += dark * storm * half3(2.2, 2.4, 3.0);
  col += stormLight(P, dark);

  if (candle > 0.001) {
    float L = 0.0;
    if (wb > 0.001) {
      // pumpkin jump: shift the map with the pumpkin, fading as it rises
      // flame leans toward the finger → the smile patch slides the opposite way, more the farther from the pumpkin
      float3 Pl = P + fOff * clamp(length((P - pc).xy) / 0.13 - 1.0, 0.0, 8.0);
      float2 lb = toBase(Pl - jW - cam0).xy;
      L = candleL(lb) * wb * (1.0 - clamp(jumpH / 90.0, 0.0, 1.0));
    }
    // thin translucent rind + fog scattering: a very faint warmth around the pumpkin
    col += candleShade(P, dn, g, L, candle);
  }
  return half4(col, 1.0);
}`)!;
