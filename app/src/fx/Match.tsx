import type { Basis } from "../scene/view";
import React from "react";
import { Atlas, BlurMask, Circle, Group, Path, RadialGradient, Rect, Shader, Skia, useColorBuffer, vec } from "react-native-skia";
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import { BASE_BASIS, NONE, SAMPLING, baseToFloor, proj, put, screenToPumpkinWorld, useSpriteBuffers } from "./pfx_atlas";
import { useGpuImage } from "../perf/gpu";

export const MATCH_REST = { x: 352, y: 800 };
export const MATCH_LEN = 74;

const ROT = -0.6; // thân diêm nghiêng (rad)
// que diêm nằm trên thềm (m): đầu và đuôi que ở chỗ nằm yên, chiếu từ ảnh gốc xuống mặt sàn
const REST_HEAD = baseToFloor(MATCH_REST.x, MATCH_REST.y, 0.002);
const REST_TAIL = baseToFloor(MATCH_REST.x - Math.sin(ROT) * MATCH_LEN, MATCH_REST.y + Math.cos(ROT) * MATCH_LEN, 0.002);
const SHEET = require("../../assets/fx/pfx_match.png");
// pfx_match.png, 4 px/pt, nướng trong Blender:
//   que diêm 48×348 (x −6..6, y −8..79 pt quanh tâm đầu diêm): gỗ bạch dương có thớ, thân vuông vát cạnh xoay
//   nhẹ để thấy mặt sáng/mặt tối + cạnh bắt sáng, đầu diêm thuốc đỏ sần | đầu diêm đang cháy (than đen,
//   vết nứt đỏ rực, thân sém) 48×80 | cụm khói mềm 32 | lấp lánh 32
const PX = 0.25; // pt mỗi px sheet
const STICK_SPRITES = [Skia.XYWHRect(0, 0, 48, 348), Skia.XYWHRect(48, 0, 48, 80)];
const STICK_XF = [Skia.RSXform(PX, 0, -6, -8), Skia.RSXform(PX, 0, -6, -8)];
// chấm lấp lánh trên hạt thuốc đầu diêm (phía trên-trái, nơi bắt đèn hiên)
const GLINT_SPRITES = [Skia.XYWHRect(96, 32, 32, 32)];
const GLINT_XF = [Skia.RSXform(0.13, 0, -1.9 - 16 * 0.13, -3.2 - 16 * 0.13)];
const SPR_SMOKE = [96, 0, 32, 32];
const SMOKE_N = 40;
const SMOKE_EMIT = 0.9; // s khói còn nhả ra sau khi tắt
const SMOKE_LIFE = 2.6;

// bóng que diêm nằm trên thềm (đầu ở gốc, thân chạy xuống như sprite)
const SHADOW = (() => {
  const b = Skia.PathBuilder.Make();
  b.addRRect(Skia.RRectXY(Skia.XYWHRect(-2.3, 0, 4.6, 79), 1.2, 1.2));
  b.addOval(Skia.XYWHRect(-4, -6.6, 8, 13.6));
  return b.build();
})();

/**
 * Ngọn lửa diêm (vẽ cộng sáng, toạ độ pt quanh tâm đầu diêm, y xuống):
 * dáng giọt nước (tròn ở đáy, nhọn ở đỉnh), đáy xanh lam mờ ôm đầu diêm, thân vàng, lõi trắng nóng,
 * đỉnh ngả cam; mép gợn cuộn lên theo noise, chiều cao chập chờn; đỉnh lửa bị kéo ngược hướng que diêm đang
 * di chuyển (`lean`) và dài ra / co lại theo vận tốc dọc (`stretch`). Kèm quầng sáng mềm quanh thân lửa.
 */
const flameFx = Skia.RuntimeEffect.Make(`
uniform float t;
uniform float k;        // cường độ 0..1 (burn × chập chờn)
uniform float lean;     // đỉnh lửa lệch ngang, theo tỉ lệ chiều cao (+ = sang phải)
uniform float stretch;  // > 1: dài + mảnh, < 1: lùn + bè

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}

half4 main(float2 p) {
  if (k < 0.01) return half4(0);
  float H = 22.0 * (0.35 + 0.65 * k) * stretch;      // chiều cao thân lửa (pt)
  float R = 4.2 * (0.5 + 0.5 * k) / sqrt(stretch);    // độ bè
  float y0 = 3.5;                                     // đáy lửa ôm phía dưới đầu diêm
  float u = (y0 - p.y) / H;                           // 0 đáy → 1 đỉnh
  float uu = clamp(u, 0.0, 1.0);
  // thân lửa uốn theo độ nghiêng (đỉnh lệch nhiều, đáy bám đầu diêm) + gợn cuộn lên
  float n1 = noise(float2(p.x * 0.30, p.y * 0.20 + t * 7.0));
  float n2 = noise(float2(p.x * 0.70 + 5.0, p.y * 0.45 + t * 13.0));
  float cx = lean * H * uu * uu + (n1 - 0.5) * 2.6 * uu * uu + (n2 - 0.5) * 0.9 * uu;
  float x = p.x - cx;
  float hf = 0.86 + 0.28 * noise(float2(t * 5.0, 1.7));  // đỉnh lửa phập phồng
  float v = u / hf;
  // dáng giọt nước
  float w = R * 2.6 * sqrt(max(v, 0.0)) * pow(max(1.0 - v, 0.0), 0.9);
  float e = abs(x) / max(w, 0.001);
  float inside = step(0.0, v) * step(v, 1.0);
  float body = inside * smoothstep(1.0, 0.45, e) * smoothstep(1.0, 0.72, v);
  // vùng phát sáng vàng bắt đầu cao hơn đáy một chút; đáy là lửa xanh mờ
  float yellow = body * smoothstep(0.05, 0.24, v);
  float core = body * smoothstep(0.62, 0.0, e) * smoothstep(0.1, 0.26, v) * smoothstep(0.78, 0.36, v);
  float blue = inside * smoothstep(1.2, 0.55, e) * smoothstep(0.34, 0.08, v) * smoothstep(0.0, 0.06, v);
  float3 bodyC = mix(float3(1.0, 0.80, 0.40), float3(1.0, 0.46, 0.12), smoothstep(0.3, 0.95, v));
  float3 rgb = yellow * bodyC + core * float3(1.0, 0.97, 0.88) * 0.95 + blue * float3(0.20, 0.36, 1.0) * 0.6;
  // quầng sáng mềm quanh thân lửa
  float dx = x / (R * 2.6);
  float dy = (p.y - (y0 - H * 0.42)) / (H * 0.9);
  rgb += exp(-(dx * dx + dy * dy) * 2.2) * float3(1.0, 0.58, 0.22) * 0.22;
  rgb *= k;
  float a = clamp(max(rgb.r, max(rgb.g, rgb.b)), 0.0, 1.0);
  return half4(min(rgb, float3(a)), a);
}
`)!;

const hash = (n: number) => {
  "worklet";
  const s = Math.sin(n * 41.3 + 7.9) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Que diêm: (x, y) là đầu diêm. Cầm lên thì đầu diêm bùng lửa (`burn` 0..1), thân nghiêng 35°.
 * Thả vào miệng bí thì thắp nến; que diêm mờ đi (`fade`).
 *
 * Que diêm gỗ thật (sprite Blender) + bóng mềm khi nằm trên thềm; lúc cháy đầu diêm thành than có vết nứt
 * đỏ rực. Lửa vẽ bằng shader (xem `flameFx`), luôn hướng lên trên, nghiêng ngược hướng di chuyển với độ trễ
 * kiểu lò xo; quầng sáng ấm cộng lên thân diêm và xung quanh. Lửa tắt thì một sợi khói mảnh cuộn lên từ chỗ tắt.
 */
export function Match({
  x,
  y,
  burn,
  fade,
  time,
  basis,
}: {
  x: SharedValue<number>;
  y: SharedValue<number>;
  burn: SharedValue<number>;
  fade: SharedValue<number>;
  time: SharedValue<number>;
  basis?: SharedValue<Basis>;
}) {
  const sheet = useGpuImage(SHEET, { mipmapped: true });

  // ── vận tốc que diêm → lửa nghiêng (lò xo) + dãn; chốt thời điểm/vị trí lửa tắt cho sợi khói ──
  const motion = useSharedValue({ t: -1, x: 0, y: 0, vx: 0, vy: 0 });
  const lean = useSharedValue(0);
  const leanV = useSharedValue(0);
  const stretch = useSharedValue(1);
  const burning = useSharedValue(false);
  const smoke = useSharedValue({ t: -1, x: 0, y: 0, z: 0 }); // nơi lửa tắt (m, trên mặt quả bí)
  useAnimatedReaction(
    () => time.value,
    (t) => {
      const m = motion.value;
      const X = x.value;
      const Y = y.value;
      const dt = t - m.t;
      if (m.t < 0 || dt <= 0 || dt > 0.1) {
        motion.set({ t, x: X, y: Y, vx: 0, vy: 0 });
      } else {
        const k = Math.min(1, dt * 16);
        const vx = m.vx + ((X - m.x) / dt - m.vx) * k;
        const vy = m.vy + ((Y - m.y) / dt - m.vy) * k;
        motion.set({ t, x: X, y: Y, vx, vy });
        const target = Math.max(-1.1, Math.min(1.1, -vx * 0.0022));
        const lv = leanV.value + ((target - lean.value) * 170 - leanV.value * 13) * dt;
        leanV.set(lv);
        lean.set(lean.value + lv * dt);
        const st = 1 + Math.max(-0.3, Math.min(0.5, vy * 0.0011 + Math.hypot(vx, vy) * 0.00035));
        stretch.set(stretch.value + (st - stretch.value) * Math.min(1, dt * 10));
      }
      const b = burn.value;
      if (b > 0.6) burning.set(true);
      else if (b < 0.35 && burning.value) {
        burning.set(false);
        // lửa tắt trong miệng bí: neo điểm đó vào không gian cảnh (nhích ra trước mặt vỏ 1 cm) để khói đứng đúng chỗ khi camera nghiêng
        const bb = basis ? basis.value : BASE_BASIS;
        const w = screenToPumpkinWorld(bb, X, Y);
        smoke.set({ t, x: w[0], y: w[1] - 0.01, z: w[2] });
      }
    },
  );

  // que diêm nằm trên thềm thuộc không gian cảnh: nhìn quanh / nghiêng / zoom thì nó nằm yên trên ván sàn (đúng vị trí, góc, cỡ);
  // cầm lên thì theo ngón tay (độ lệch so với chỗ nằm), xa chỗ nằm thì về cỡ/góc của màn hình.
  const place = useDerivedValue(() => {
    const b = basis ? basis.value : BASE_BASIS;
    const H = [0, 0, 0, 0];
    const T = [0, 0, 0, 0];
    proj(b, REST_HEAD[0], REST_HEAD[1], REST_HEAD[2], H);
    proj(b, REST_TAIL[0], REST_TAIL[1], REST_TAIL[2], T);
    const dx = x.value - MATCH_REST.x, dy = y.value - MATCH_REST.y;
    const u = Math.min(1, Math.hypot(dx, dy) / 60);
    const rot = Math.atan2(T[1] - H[1], T[0] - H[0]) - Math.PI / 2;
    const sc = Math.hypot(T[0] - H[0], T[1] - H[1]) / MATCH_LEN;
    const visible = H[2] > 0.05 && T[2] > 0.05;
    return {
      x: H[0] + dx,
      y: H[1] + dy,
      rot: rot + (ROT - rot) * u,
      s: visible ? sc + (1 - sc) * u : 1,
      hide: visible || u >= 1 ? 1 : 0,
    };
  });
  const stickT = useDerivedValue(() => {
    const p = place.value;
    return [{ translateX: p.x }, { translateY: p.y }, { rotate: p.rot }, { scale: p.s }];
  });
  const flameT = useDerivedValue(() => [{ translateX: place.value.x }, { translateY: place.value.y }]);
  const opacity = useDerivedValue(() => (1 - fade.value) * place.value.hide);
  const flick = useDerivedValue(() => {
    const t = time.value;
    return burn.value * (0.9 + 0.07 * Math.sin(t * 31) + 0.05 * Math.sin(t * 17.3) + 0.04 * Math.sin(t * 53.1));
  });
  // bóng que diêm: chỉ khi đang nằm ở chỗ cũ trên thềm (nhấc lên thì tan)
  const shadowT = useDerivedValue(() => {
    const p = place.value;
    return [{ translateX: p.x + 2.2 * p.s }, { translateY: p.y + 2.8 * p.s }, { rotate: p.rot }, { scale: p.s }];
  });
  const shadowA = useDerivedValue(() => {
    const d = Math.hypot(x.value - MATCH_REST.x, y.value - MATCH_REST.y);
    return 0.45 * Math.max(0, 1 - d / 16) * (1 - fade.value);
  });

  // màu nhân cho que diêm: [que nguyên vẹn, lớp than phủ đầu diêm theo burn]
  const stickC = useColorBuffer(2, (v, i) => {
    "worklet";
    v[0] = 1;
    v[1] = 1;
    v[2] = 1;
    v[3] = i === 0 ? 1 : Math.min(1, burn.value * 1.2);
  });
  const glintC = useColorBuffer(1, (v) => {
    "worklet";
    const s = 0.5 + 0.5 * Math.sin(time.value * 2.3);
    v[0] = 1;
    v[1] = 0.93;
    v[2] = 0.86;
    v[3] = Math.pow(s, 10) * 0.85 * (1 - burn.value);
  });

  const flameU = useDerivedValue(() => ({ t: time.value, k: flick.value, lean: lean.value, stretch: stretch.value }));
  const glowNear = useDerivedValue(() => 22 * Math.max(0.01, flick.value));
  const glowFar = useDerivedValue(() => 0.2 * flick.value);

  // ── sợi khói: nhả trong SMOKE_EMIT giây từ chỗ lửa tắt, bay lên chậm dần, cuộn xoắn rộng dần rồi tan ──
  const smokeD = useDerivedValue(() => {
    const S = smoke.value;
    if (S.t < 0) return NONE;
    const st = time.value - S.t;
    if (st < 0 || st > SMOKE_EMIT + SMOKE_LIFE) return NONE;
    const b = basis ? basis.value : BASE_BASIS;
    const P = [0, 0, 0, 0];
    const out: number[] = [];
    const ph = hash(S.t) * 6.28;
    const drift = hash(S.t + 1.7) < 0.5 ? -1 : 1;
    const M = 1 / 780; // m mỗi pt ở độ sâu quả bí (giữ nhịp/cỡ của bản trước)
    for (let j = 0; j < SMOKE_N; j++) {
      const te = (j / SMOKE_N) * SMOKE_EMIT;
      const a = st - te;
      if (a <= 0 || a > SMOKE_LIFE) continue;
      const amt = Math.pow(1 - te / SMOKE_EMIT, 1.3);
      const zz = S.z + (4 + 16 * a + 6 * a * a) * M;
      const xx = S.x + (Math.sin(te * 6 + a * 2.4 + ph) * (0.6 + 4.5 * a) + a * a * 2.5 * drift) * M;
      const yy = S.y + Math.cos(te * 5 + a * 1.9 + ph) * (0.3 + 2.5 * a) * M;
      proj(b, xx, yy, zz, P);
      if (P[2] < 0.05) continue;
      const d = (1.6 + 6.5 * a) * M * P[3];
      const al = 0.2 * amt * Math.pow(1 - a / SMOKE_LIFE, 1.6) * Math.min(1, a / 0.1);
      if (al < 0.004) continue;
      put(out, P[0], P[1], 16, 16, d / 32, a * 0.8 + j, SPR_SMOKE[0], SPR_SMOKE[1], SPR_SMOKE[2], SPR_SMOKE[3], 0.84, 0.85, 0.9, al);
    }
    return out.length ? out : NONE;
  });
  const smokeB = useSpriteBuffers(smokeD, SMOKE_N);

  return (
    <Group>
      <Group transform={shadowT} opacity={shadowA}>
        <Path path={SHADOW} color="#0b0705">
          <BlurMask blur={1.8} style="normal" />
        </Path>
      </Group>
      <Group transform={stickT} opacity={opacity}>
        <Atlas image={sheet} sprites={STICK_SPRITES} transforms={STICK_XF} colors={stickC} colorBlendMode="modulate" sampling={SAMPLING} />
        <Atlas image={sheet} sprites={GLINT_SPRITES} transforms={GLINT_XF} colors={glintC} colorBlendMode="modulate" blendMode="plus" sampling={SAMPLING} />
      </Group>
      <Group transform={flameT}>
        {/* quầng ấm rộng hắt ra xung quanh */}
        <Circle cx={0} cy={-8} r={70} blendMode="plus" opacity={glowFar}>
          <RadialGradient c={vec(0, -8)} r={70} colors={["#ff9a3c", "#ff8a2a55", "#ff7a1a00"]} />
        </Circle>
        {/* quầng gần: hắt sáng lên đầu và thân diêm */}
        <Circle cx={0} cy={-5} r={glowNear} blendMode="plus">
          <RadialGradient c={vec(0, -5)} r={glowNear} colors={["#ffb86a80", "#ffa04c4a", "#ff8a3020", "#ff6a1a08", "#ff6a0000"]} />
        </Circle>
        <Rect x={-36} y={-44} width={72} height={56} blendMode="plus">
          <Shader source={flameFx} uniforms={flameU} />
        </Rect>
      </Group>
      <Atlas image={sheet} sprites={smokeB.sprites} transforms={smokeB.transforms} colors={smokeB.colors} colorBlendMode="modulate" sampling={SAMPLING} />
    </Group>
  );
}
