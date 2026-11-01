import { Skia } from "react-native-skia";
import { VIEW_SKSL } from "./viewSksl";

// The pumpkin, drawn over the full screen. Real 3D geometry (ellipsoid + rind thickness), so when the eye moves / the phone tilts:
//   H = where the view ray hits the outer surface; rind, normal, mask are sampled at H projected onto the base camera image
//   cut wall: continue along the ray into the rind, map that point back to the outer surface along the normal → mask (cuts are perpendicular to the rind)
//   interior: the ray goes through to the back inner surface (ellipsoid shrunk by one rind thickness) → projected onto the interior image
//   flame: billboard placed at its true 3D position in the middle of the pumpkin (shifts less than the back wall when tilting → reads as in the middle)
//   !outer → rind: lit/dark blend by porch light, orange glow around holes when the candle is lit (thin translucent rind)
export const pumpkin = Skia.RuntimeEffect.Make(`
uniform shader skinLit;
uniform shader skinDark;
uniform shader inLit;
uniform shader inUnlit;
uniform shader data;       // R,G: camera normal (0..1, y up), B: carvable area
uniform shader flesh;      // pumpkin flesh grain (tiled)
uniform shader mask;       // carved holes (mask px)
uniform shader maskBlur;
uniform float3 crop;       // x, y, side (pt)
uniform float  imgS;       // crop image side (px)
uniform float  maskS;      // mask side (px)
uniform float  porch;
uniform float  storm;      // lightning flash 0..1
uniform float  candle;     // 0..1.3, flicker included
uniform float  time;
uniform float3 flameW;     // flame centre (m)
uniform float  shell;      // rind thickness (m)
uniform float  lean;       // flame lean
uniform float  fStretch;   // flame stretch × (flameFollow)
uniform float  fGust;      // gust from a fast finger swipe: strong flicker (flameFollow)
uniform float3 fTip;       // flame tip offset toward the finger (m): the interior light follows
uniform float  hidden;     // 1: the pumpkin is inside the Dynamic Island
uniform float  gust;       // 0..1 being blown on (fx/blowOut.ts): flame shrinks, strong ripple
uniform float  ember;      // 0..1 red ember on the wick after blowing out (flame shrinks to the wick)
${VIEW_SKSL}

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
float m(float2 uv) { return smoothstep(0.3, 0.7, mask.eval(uv * maskS).r); }

// realistic candle flame: slender teardrop (width ~1/4 of height), faint blue base at the wick, white-yellow core, yellow body, orange rim
// fading toward the tip; q in pt around the flame centre (sized as seen from the base camera)
half4 flameCol(float2 q) {
  // candle out: flame shrinks to the wick with candle; red ember at the wick tip
  float shrink = ember > 0.0 ? 0.12 + 0.88 * clamp(candle, 0.0, 1.0) : 1.0;
  float re = length(float2(q.x, (q.y - 5.2) * 0.75));
  float emb = ember * (exp(-re * re / 1.6) * 1.6 + exp(-re / 4.5) * 0.45);
  q = float2(q.x, q.y - 7.0) / shrink + float2(0.0, 7.0);
  float y = -q.y + 7.0;                           // 0 = flame base (at the wick), positive upward
  // lean (against the phone / toward the finger): bends more at the tip as if pushed by an air current
  q.x -= lean * max(y, 0.0) * 0.16 * (0.55 + 0.45 * clamp(y / (21.0 * fStretch), 0.0, 1.3));
  float wob = (noise(float2(y * 0.22 - time * (8.0 + 10.0 * gust) * (1.0 + fGust), time * 2.7)) - 0.5) * 1.6 * (1.0 + 2.4 * gust + 2.2 * fGust) * clamp(y / 16.0, 0.0, 1.0);
  q.x -= wob;
  float h = 21.0 * (0.85 + 0.15 * candle) * (1.0 - 0.12 * gust) * fStretch; // flame height (blown on: a bit shorter)
  float t = clamp(y / h, 0.0, 1.0);
  float w = (7.2 * sqrt(t) * pow(1.0 - t, 1.25) + 0.25) / sqrt(fStretch);
  float d = abs(q.x) / max(w, 0.01);
  float inY = smoothstep(-0.8, 1.2, y) * smoothstep(h + 0.5, h - 4.0, y);
  float body = smoothstep(1.0, 0.45, d) * inY;
  float core = smoothstep(0.6, 0.0, d) * smoothstep(1.0, 3.5, y) * smoothstep(h * 0.6, h * 0.2, y);
  half3 c = mix(half3(1.0, 0.36, 0.06), half3(1.0, 0.78, 0.36), smoothstep(0.05, 0.75, body));
  c = mix(c, half3(1.0, 0.97, 0.88), core);
  // blown on: light flickers strongly (candle) but the flame body stays solid, only whipped sideways
  float a = clamp(body * 1.3, 0.0, 1.0) * clamp(candle + 0.7 * gust, 0.0, 1.0);
  // blue base: the fully oxygenated burn zone right above the wick
  float blue = smoothstep(1.0, 0.2, d) * smoothstep(-0.5, 0.8, y) * smoothstep(3.5, 1.0, y) * 0.55 * clamp(candle, 0.0, 1.0);
  // halo around the flame (scattering in hot air + lens)
  float r = length(q * float2(1.0, 0.65) - float2(0.0, -6.0));
  float halo = (exp(-r / 7.0) * 0.45 + exp(-r / 22.0) * 0.18) * candle;
  half3 ec = half3(1.0, 0.3, 0.06) * emb + half3(1.0, 0.75, 0.4) * smoothstep(0.9, 1.6, emb) * 0.5;
  return half4(c * a + half3(0.25, 0.35, 1.0) * blue * (1.0 - a) + half3(1.0, 0.55, 0.2) * halo + ec, max(a, clamp(emb, 0.0, 1.0) * 0.8));
}

// world point (resting pumpkin frame) → crop uv
float2 cropOf(float3 h) { return (pumpkinXY(h) - crop.xy) / crop.z; }

half4 main(float2 sxy) {
  if (hidden > 0.5) return half4(0.0);
  float3 H = pumpkinHitW(sxy);
  float3 bb = toBase(H - cam0);
  if (bb.z < 0.5) return half4(0.0);
  float2 xy = bb.xy;                                // coordinates on the base image of the resting pumpkin (rotation already handled in pumpkinHitW)
  float2 uv = (xy - crop.xy) / crop.z;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return half4(0.0);
  // perf: porch light fully off → skip the lit rind; fully on with no lightning → skip the dark rind
  half4 lit = porch > 0.001 ? skinLit.eval(uv * imgS) : half4(0.0);
  half4 dark = porch < 0.999 || storm > 0.001 ? skinDark.eval(uv * imgS) : lit;
  if (porch <= 0.001) lit = dark;
  half4 skin = mix(dark, lit, porch);
  skin.rgb += dark.rgb * storm * half3(2.0, 2.2, 2.8);
  half4 dt = data.eval(uv * imgS);
  float2 n = float2(dt.r * 2.0 - 1.0, 1.0 - dt.g * 2.0);   // screen y points down
  float carv = dt.b;

  float outer = m(uv) * carv;
  float glowM = maskBlur.eval(uv * maskS).r;
  if (outer < 0.002) {
    // rind: dark AO rim at the hole edge, orange glow (translucent rind) when the candle is lit
    float near = clamp(glowM * 1.6, 0.0, 1.0);
    half3 c = skin.rgb * (1.0 - 0.35 * near * skin.a);
    float lum = dot(skin.rgb, half3(0.3, 0.59, 0.11));
    c += half3(1.0, 0.45, 0.08) * near * candle * 0.8 * skin.a * (1.0 - lum);
    // candlelight through the rind: the whole pumpkin glows warm orange, stronger in the middle of the front (rind facing the candle)
    float front = clamp(1.0 - length(n) * 0.9, 0.0, 1.0);
    c += skin.rgb * half3(1.0, 0.55, 0.22) * clamp(candle, 0.0, 1.3) * (0.7 + 0.8 * front + 1.2 * near);
    return half4(c, skin.a);
  }

  // world normal at H (rendered normal, z toward the base camera)
  float nz = sqrt(max(1.0 - dot(n, n), 0.0));
  float3 N = normalize(camX * n.x - camY * n.y + camZ * nz);
  float3 dv = normalize(H - eye);             // view direction
  float cosI = max(-dot(dv, N), 0.25);
  // point at depth s (0..1 of rind thickness) along the ray, mapped back to the outer surface along the normal → mask
  float3 inW = dv * (shell / cosI) + N * shell;      // mask offset at the inner surface
  float2 o = cropOf(H + inW) - uv;
  float depth = 1.0;
  for (int i = 1; i <= 6; i++) {
    float s = float(i) / 6.0;
    if (m(uv + o * s) < 0.5) { depth = s - 1.0 / 12.0; break; }
  }
  float inner = m(uv + o);

  // interior: the ray continues to the back inner surface
  float3 ri = pr * (1.0 - shell / pr.x);           // inner wall = outer rind shrunk around the centre
  float3 hb = ellHit(H, dv, ri);
  float3 B = H + dv * hb.y;
  float2 iu = cropOf(B);
  half4 il = inLit.eval(iu * imgS);
  half4 iun = inUnlit.eval(iu * imgS);
  // interior lighting by 1/d² from the flame + bounce between the walls (the interior acts like a glowing sphere)
  float dB = length(B - flameW - fTip);
  float E = 0.32 + 1.5 * pow(0.085 / max(dB, 0.04), 2.0);
  // unlit: porch light leaks through the holes, the inner wall is dimly visible (not pitch black like cut paper)
  half3 dim = iun.rgb * 2.2 + il.rgb * half3(0.1, 0.075, 0.06) * (0.35 + 0.65 * porch);
  // lit: orange-yellow flesh; compress highlights by brightness (keep the orange hue, no flat yellow)
  // fibre / vein grain on the inner wall (the interior image is fairly uniform): multiply in grain by back-wall coordinates
  half fib = dot(flesh.eval(iu * 700.0 + float2(0.0, iu.y * 300.0)).rgb, half3(0.33));
  half3 hot = il.rgb * half3(1.0, 0.66, 0.36) * E * (0.75 + 0.3 * candle) * (0.65 + 0.7 * fib);
  hot = hot / (1.0 + dot(hot, half3(0.3, 0.59, 0.11)) * 0.45) * 1.25;
  half3 inside = mix(dim, hot, clamp(candle, 0.0, 1.0));
  inside += (il.rgb * 0.8 + half3(0.05, 0.012, 0.0)) * half3(1.0, 0.3, 0.1) * ember * 0.55 * E; // red ember casts a faint glow on the inner wall
  // flame: point on the view ray closest to the flame centre, in pt (flame sized as seen from the base camera)
  float3 e = eye;
  float3 wv = e + dv * dot(flameW - e, dv) - flameW;
  float ptPerM = focal / length(flameW - cam0);
  half4 fl = flameCol(float2(dot(wv, vX), -dot(wv, vY)) * ptPerM);
  // flame in the middle of the interior: visible only when the back wall is behind it (always true) and the ray is not blocked by a cut wall
  inside = inside * (1.0 - fl.a) + fl.rgb;

  // cut wall: pumpkin flesh grain, coordinates follow the hole direction so the grain runs along the wall
  half3 f = flesh.eval(xy * 3.0 + float2(0.0, depth * 9.0)).rgb;
  half3 wallDark = f * mix(half3(0.16, 0.13, 0.15), half3(0.62, 0.5, 0.38), porch) * (1.0 - 0.45 * depth);
  // wall side facing the candle is brighter; hot orange rim at the inner edge
  half3 wallLit = f * half3(1.15, 0.78, 0.42) * (0.45 + 0.9 * depth) + half3(1.0, 0.5, 0.12) * smoothstep(0.6, 1.0, depth) * 0.5;
  half3 wall = mix(wallDark, wallLit, clamp(candle, 0.0, 1.0));

  half3 hole = mix(wall, inside, inner);
  // while not fully cut through the hole edge stays soft: blend with the rind by outer
  half3 c = mix(skin.rgb, hole, outer);
  return half4(c, max(skin.a, outer));
}`)!;
