import { Skia } from "react-native-skia";
import { CAM, CROP, FLAME_W, MASK, PUMPKIN, SHELL } from "../scene/layout";
import { DEPTH_SKSL, VIEW_SKSL } from "./viewSksl";

/**
 * Giant jack-o'-lantern face on the house wall, door and porch ceiling once the candle is lit.
 *
 * Projection: for each world point P (from the depth reprojection), cast the segment flame → P, find where it leaves
 * the pumpkin shell (outer ellipsoid, then inner ellipsoid one shell thickness in), and read the carve mask there.
 * The carved face is on the camera side, so P behind the pumpkin is lit through the MIRROR of the front mask across
 * the pumpkin's mid plane (as if the face were cut straight through) — the wall shows the same face the viewer
 * sees, not mirrored, about 8–10× larger. Points in front are left to candleLight (true front projection).
 * Penumbra grows with distance (hole → wall) / (flame → hole) like a real ~1 cm flame: crisp mask near, blurred far.
 * The flame position sways / jitters per frame (`faceFlame`) so the face on the wall dances, ×(dWall/dHole).
 * Cost per pixel: two ellipsoid intersections + up to 4 mask taps, only for P behind the pumpkin while lit.
 */

// uniforms/functions shared by the overlay below and (proposed) background.ts: needs VIEW_SKSL first
export const FACE_SHADOW_SKSL = `
uniform shader fsMask;     // crisp carve mask (px mask)
uniform shader fsBlur;     // blurred carve mask (9 px)
uniform float3 fsFlame;    // light centre of the flame this frame (m, pumpkin jump already added)
uniform float3 fsAxis;     // horizontal axis camera → pumpkin (front/back split)
uniform float3 fsCrop;     // crop x, y, side (pt)
uniform float  fsK;        // mask px per pt
uniform float  fsShell;    // shell thickness (m)
uniform float3 fsJW;       // pumpkin jump offset (m)

float fsTap(float3 e, float soft) {
  float3 a = fsAxis;
  float3 m = e - 2.0 * dot(e - pc, a) * a;                 // mirror back half → carved front half
  float2 uv = (toBase(m - cam0).xy - fsCrop.xy) * fsK;
  float c = smoothstep(0.25, 0.75, fsMask.eval(uv).r);
  return soft < 0.02 ? c : mix(c, min(fsBlur.eval(uv).r * 1.6, 1.0), soft);
}
// light from the flame reaching P through the (mirrored) carved face, 0..1
float faceWall(float3 Pw) {
  float3 P = Pw - fsJW;                                    // pumpkin rest frame
  if (dot(P - pc, fsAxis) < 0.1) return 0.0;               // only behind the pumpkin
  float3 q = P - fsFlame;
  float3 h = ellHit(fsFlame, q, pr);                       // y = where the ray leaves the back of the shell
  if (h.z < 0.5) return 0.0;
  float3 E = fsFlame + q * h.y;
  float lq = length(q);
  float dHole = max(lq * h.y, 0.05);
  float soft = clamp((lq - dHole) / dHole * 0.11, 0.0, 1.0);
  float v = fsTap(E, soft);
  if (v < 0.004) return 0.0;
  // shell thickness: inner exit point must also be in a hole (thick rind narrows oblique beams)
  float3 ri = pr * (1.0 - fsShell / pr.x);
  float3 h2 = ellHit(fsFlame, q, ri);
  if (h2.z < 0.5) return v;
  float3 E2 = fsFlame + q * h2.y;
  float3 nn = normalize((E2 - pc) / (ri * ri));
  return v * fsTap(E2 + nn * fsShell, soft);
}
`;

/**
 * Standalone overlay (blendMode "plus", drawn right after the background Fill and before the pumpkin so the pumpkin
 * hides what is behind it). Albedo comes from the porch-lit plate (wall siding / door texture), dimmed by distance.
 */
export const faceShadow = Skia.RuntimeEffect.Make(`
uniform shader bgLit;
uniform shader panoLit;
${VIEW_SKSL}
${DEPTH_SKSL}
${FACE_SHADOW_SKSL}
uniform float  bgK;
uniform float2 pSize;
uniform float  candle;     // 0..1.3 incl. flicker
uniform float  gain;       // 1 = default look
uniform float  hidden;

half4 main(float2 xy) {
  if (candle < 0.01 || hidden > 0.5) return half4(0.0);
  float3 dn = normalize(viewRay(xy));
  // cheap reject: first depth guess from the eye (eye is only a few cm off the plate camera)
  float t0 = depthDir(dn);
  float3 P0 = eye + dn * t0;
  if (dot(P0 - pc, fsAxis) < 0.0 || P0.z > 3.2) return half4(0.0);
  // one refinement step of reproject() is enough here (the light is soft): 2 depth taps instead of 4
  float3 off = eye - cam0;
  float3 dir = normalize(off + dn * t0);
  float w = max(dot(dir * depthDir(dir) - off, dn), 0.05);
  float3 P = eye + dn * w;
  float L = faceWall(P);
  if (L < 0.004) return half4(0.0);
  dir = normalize(off + dn * w);
  float3 bb = toBase(dir);
  float2 b = bb.xy;
  float wb = bb.z * smoothstep(0.0, 12.0, min(min(b.x, view.x - b.x), min(b.y, view.y - b.y)));
  half3 alb = wb > 0.001 ? bgLit.eval(b * bgK).rgb : half3(0.0);
  if (wb < 0.999) alb = mix(panoLit.eval(panoUV(dir) * pSize).rgb, alb, wb);
  // albedo from the lantern-lit plate is uneven (hot spot under the lantern): compress it, keep the texture
  half la = dot(alb, half3(0.3, 0.59, 0.11));
  alb = alb / (0.06 + la) * (0.06 + 0.35 * la / (0.25 + la));
  // dark siding still has to show the face: lift toward a warm mid wood tone, keep the plank texture
  alb = mix(alb, half3(0.2, 0.16, 0.13) * (0.6 + 2.0 * la), 0.5);
  // 1/d² from the flame, soft-clamped so the wall right behind is not blown out
  float3 q = P - fsJW - fsFlame;
  float fall = 1.0 / (0.6 + dot(q, q));
  half3 warm = half3(1.0, 0.55, 0.2);
  half3 c = alb * warm * (L * fall * candle * gain * 36.0);
  // hot core of the beam goes toward candle yellow (reads as light, not paint)
  c += warm * half3(1.0, 0.85, 0.6) * max(dot(c, half3(0.33)) - 0.25, 0.0) * 0.6;
  return half4(c, 0.0);
}`)!;

const AX = (() => {
  const x = PUMPKIN.c[0] - CAM.pos[0], y = PUMPKIN.c[1] - CAM.pos[1];
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l, 0];
})();
const X0 = CAM.rot[0];
/**
 * Projection centre for the wall face, relative to the real flame: pushed toward the camera (m) and dropped (m).
 * With the real flame (0, 0) the face is ~10× (mouth wider than the whole frame, eyes off screen); pushed 0.22 m
 * it is ~5× and lands between the pumpkin and the lantern — reads as a face in the clip.
 */
export const FS_PUSH = 0.22;
export const FS_DROP = 0.03;

/**
 * Light centre of the flame this frame (m): sways with `lean` (same value the pumpkin shader bends the flame with)
 * plus fast jitter, rises a little when the candle flares. ×(wall / hole distance) on the wall ≈ ×9.
 */
export const faceFlame = (t: number, lean: number, candle: number, jW: number[]) => {
  "worklet";
  const wob = Math.sin(t * 13.1) * 0.5 + Math.sin(t * 29.3 + 1.7) * 0.3 + Math.sin(t * 6.7 + 0.4) * 0.4;
  const side = lean * 0.006 + wob * 0.002;
  const up = (candle - 1) * 0.006 + Math.sin(t * 17.9 + 2.1) * 0.0015 - FS_DROP;
  return [
    FLAME_W[0] + X0[0] * side - AX[0] * FS_PUSH + jW[0],
    FLAME_W[1] + X0[1] * side - AX[1] * FS_PUSH + jW[1],
    FLAME_W[2] + up + jW[2],
  ];
};

/** Uniforms for FACE_SHADOW_SKSL (spread into the host shader's uniforms). */
export const faceShadowUniforms = (t: number, lean: number, candle: number, jW: number[]) => {
  "worklet";
  return {
    fsFlame: faceFlame(t, lean, candle, [0, 0, 0]), // rest frame: P is shifted by fsJW in the shader
    fsAxis: AX,
    fsCrop: [CROP.x, CROP.y, CROP.s],
    fsK: MASK / CROP.s,
    fsShell: SHELL,
    fsJW: jW,
  };
};

