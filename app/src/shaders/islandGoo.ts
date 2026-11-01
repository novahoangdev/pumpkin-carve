import { Skia } from "react-native-skia";

/**
 * Dynamic Island as liquid: one SDF in screen pt = stadium (the pill) smooth-min'd with
 *  - blob A   (x, y, r, k)       — the drop that reaches down to catch the pumpkin / the bulge pushed out at the spit
 *  - capsule 1 (x, y0, y1, r)    — goo strand hanging from the pill (k = uK.x)
 *  - capsule 2 (x, y0, y1, r)    — tail of the detached ink drop (k = uK.y)
 *  - blob B   (x, y, r, k)       — the drop stuck on top of the falling pumpkin
 * Fill is jet black with an anti-aliased edge (AA width fixed in pt: SkSL runtime effects have no fwidth), an orange
 * rim that hugs the inside edge and an outer halo, both driven by uGlow = (rim, halo, hot core, time).
 * Draw it on a Rect covering GOO_RECT; everything outside the shape is transparent.
 */
export const ISLAND_GOO_SKSL = `
uniform float4 uPill;   // cx, cy, half w, half h
uniform float4 uA;
uniform float4 uB;
uniform float4 uC1;
uniform float4 uC2;
uniform float2 uK;
uniform float4 uGlow;

float smin(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float stadium(float2 p, float2 c, float2 hs) {
  float r = min(hs.x, hs.y);
  float2 q = abs(p - c) - hs + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float vcapsule(float2 p, float4 c) {
  if (c.w <= 0.0) return 1e4;
  float y = clamp(p.y, min(c.y, c.z), max(c.y, c.z));
  return length(p - float2(c.x, y)) - c.w;
}

half4 main(float2 p) {
  float d = stadium(p, uPill.xy, uPill.zw);
  if (uA.z > 0.0) d = smin(d, length(p - uA.xy) - uA.z, uA.w);
  d = smin(d, vcapsule(p, uC1), uK.x);
  float dl = vcapsule(p, uC2);
  if (uB.z > 0.0) dl = smin(dl, length(p - uB.xy) - uB.z, uB.w);
  d = smin(d, dl, uK.y);

  float body = clamp(0.5 - d / 0.7, 0.0, 1.0);      // ~2 px AA at 3x
  float inside = max(-d, 0.0);
  float outside = max(d, 0.0);

  // orange rim inside the edge + a hot thin line right at the edge
  float rim = uGlow.x * (0.75 * exp(-inside / 4.5) + 0.6 * exp(-inside / 1.2));
  float core = uGlow.z * exp(-inside / 9.0) * 0.35;
  half3 col = half3(1.0, 0.42, 0.06) * rim + half3(1.0, 0.62, 0.22) * core;
  col = min(col, half3(1.0));

  // outer halo, fading with distance; slight flicker
  float halo = uGlow.y * exp(-outside / 7.0) * (1.0 - body);
  half3 hc = half3(1.0, 0.45, 0.08);
  float ha = halo * 0.85;
  return half4(col * body + hc * ha, body + ha * (1.0 - body));
}
`;

export const islandGooEffect = Skia.RuntimeEffect.Make(ISLAND_GOO_SKSL)!;

/** Region the goo can occupy (pt, screen): wide enough for the open pill + halo, tall enough for the drip. */
export const GOO_MARGIN = { side: 40, below: 150 };
