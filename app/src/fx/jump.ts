import { useAnimatedReaction, useSharedValue, type SharedValue } from "react-native-reanimated";
import type { Transforms3d } from "react-native-skia";
import { scheduleOnRN } from "react-native-worklets";
import { fireHaptic, type HapticKind } from "./haptics";
import { VIEW } from "../scene/layout";

/**
 * Chạm quả bí → bí nhảy; chạm liên tục → tung hứng cao dần rồi bay vào Dynamic Island,
 * nằm trong "Live Activity" một lúc, bị nhả ra rơi về chỗ cũ.
 *
 * Mọi giá trị là pt MÀN HÌNH (gốc trên-trái). Mọi chuyển động chạy theo đồng hồ cảnh `time`
 * (useAnimatedReaction), trạng thái nằm trong shared value, không dùng setTimeout.
 */

export type Impact = { t: number; x: number; y: number; strength: number };
export type JumpPhase = "rest" | "air" | "toIsland" | "island" | "drop";

// ── hình học Dynamic Island (pt màn hình, căn giữa theo bề ngang khung thật: 17 Pro Max 440 pt → x = 157). ──
// Đo trên bản quay sim 17 Pro Max (1320×2868 px): x 157,3 · y 14,0 · w 125,3 · h 36,7.
const ISLAND_W = 125.3;
export const ISLAND = { x: (VIEW.w - ISLAND_W) / 2, y: 14, w: ISLAND_W, h: 36.7 };
export const ISLAND_CX = ISLAND.x + ISLAND.w / 2;
export const ISLAND_CY = ISLAND.y + ISLAND.h / 2;
/**
 * Kích thước pill khi nở ra như Live Activity (giữ mép trên, nở xuống dưới). Hẹp hơn khoảng giữa giờ và icon
 * status bar (iOS không cho app ẩn chúng), cao để nội dung nằm ở dải dưới camera.
 */
export const ISLAND_OPEN = { w: 176, h: 92 };
/** Tâm dải nội dung dưới camera (bí mini bên trái, BOO! bên phải). */
export const ISLAND_CONTENT_Y = ISLAND.y + ISLAND.h + (ISLAND_OPEN.h - ISLAND.h) / 2 - 2;

/** Mốc thời gian (giây, tính từ islandT = lúc bí bật lên bay vào đảo). */
export const ISLAND_TIMING = {
  fly: 0.58, // bay từ thềm vào tâm đảo
  hold: 1.6, // nằm trong pill (tính từ lúc tới nơi, gồm cả lúc nở)
  shake: 0.38, // pill rung lắc trước khi nhả
  squeeze: 0.13, // pill co thắt lại rồi "phun" bí ra
  tail: 0.7, // pill hồi về dáng cũ, tắt glow
};
export const ISLAND_ARRIVE = ISLAND_TIMING.fly;
export const ISLAND_SHAKE_AT = ISLAND_ARRIVE + ISLAND_TIMING.hold;
export const ISLAND_SPIT_AT = ISLAND_SHAKE_AT + ISLAND_TIMING.shake + ISLAND_TIMING.squeeze;
export const ISLAND_END = ISLAND_SPIT_AT + ISLAND_TIMING.tail;

/** Bề ngang thân bí (pt) khi đã thu nhỏ để chui vừa đảo; bí mini trong IslandPill vẽ đúng cỡ này. */
export const MINI_BODY = 30;
/** Chiều cao thân bí / bề ngang (không tính cuống). Tâm bí = đáy − w·ASPECT/2. */
export const PUMPKIN_ASPECT = 0.74;

/** Thông số nhảy, chỉnh cảm giác ở đây. */
export const JUMP = {
  gravity: 2400, // pt/s²
  heights: [30, 60, 100, 160], // độ cao đỉnh theo số lần chạm liên tiếp
  spins: [0, 0, 1, 2], // số vòng lộn theo cấp (0 = chỉ lắc nhẹ)
  islandTaps: 5, // chạm liên tiếp thứ N thì bay vào đảo
  islandHeight: 220, // hoặc đỉnh dự kiến vượt mức này
  comboWindow: 0.6, // s sau lần chạm đất vẫn tính là liên tiếp
  crouch: 0.07, // nhún lấy đà (lần đầu)
  crouchCombo: 0.04, // nhún khi đang tung hứng
  crouchSquash: -0.14, // sy ≈ 0.86 lúc nhún
  launchPop: 2, // vận tốc bật của lò xo co giãn lúc rời đất (cộng với giãn theo vận tốc → sy ≈ 1.12)
  kickPop: 3.2, // chạm giữa không trung: giật giãn nhẹ
  minKick: 26, // chạm giữa không: tối thiểu bay thêm chừng này pt
  squashK: 0.3, // xung nén khi chạm đất = squashK·√v
  restitution: 0.34,
  dropRestitution: 0.36,
  bounceMin: 70, // pt/s, dưới mức này thì thôi nảy
  impactMin: 110, // pt/s, dưới mức này không tính impact
  drift: 9, // pt mỗi lần chạm (đẩy ra phía ngược chỗ chạm), nhân theo cấp
  maxDrift: 34,
  dropV0: 220, // vận tốc ban đầu lúc bị đảo nhả ra (pt/s, hướng xuống)
  shakePx: 7, // biên độ rung màn hình ứng với strength 1
};

// lò xo co giãn (q) và lò xo nghiêng (rot) khi ở trên đất
const K_Q = 900;
const C_Q = 13;
const K_R = 240;
const C_R = 9.5;
const DX_RELAX = 7;
const TAU = Math.PI * 2;

const M_REST: number = 0;
const M_CROUCH: number = 1;
const M_AIR: number = 2;
const M_GROUND: number = 3;
const M_TO: number = 4;
const M_ISLAND: number = 5;
const M_FALL: number = 6;

type St = {
  m: number;
  last: number;
  h: number; // độ cao đáy bí so với lúc nghỉ (pt, dương = lên)
  vy: number; // dương = lên
  dx: number;
  vx: number;
  goal: number; // đích trôi ngang hiện tại
  rot: number;
  w: number;
  q: number; // co giãn: sy = 1 + q
  qv: number;
  combo: number;
  land: number; // lần chạm đất gần nhất
  bounces: number; // số lần chạm đất từ lần bật gần nhất
  crouchEnd: number;
  target: number; // độ cao đỉnh đang nhắm
  level: number;
  pendingIsland: boolean;
  dir: number; // +1 = trôi sang phải / xoay chiều kim đồng hồ
  dropped: boolean; // đang nảy/lắc sau khi bị đảo nhả ra
  // chặng bay vào đảo
  it: number;
  ax: number;
  ay: number;
  arot: number;
  sMini: number;
  spinTo: number; // góc đích (bội 2π) khi tới đảo
  hap: number; // cờ haptic của chuỗi đảo
};

const INIT: St = {
  m: M_REST,
  last: 0,
  h: 0,
  vy: 0,
  dx: 0,
  vx: 0,
  goal: 0,
  rot: 0,
  w: 0,
  q: 0,
  qv: 0,
  combo: 0,
  land: -10,
  bounces: 0,
  crouchEnd: 0,
  target: 0,
  level: 0,
  pendingIsland: false,
  dir: 1,
  dropped: false,
  it: -1,
  ax: 0,
  ay: 0,
  arot: 0,
  sMini: 0.2,
  spinTo: 0,
  hap: 0,
};

const haptic = (k: HapticKind) => {
  "worklet";
  scheduleOnRN(fireHaptic, k);
};

const clamp = (v: number, a: number, b: number) => {
  "worklet";
  return v < a ? a : v > b ? b : v;
};

const smooth = (u: number) => {
  "worklet";
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Góc về bội số 2π gần nhất (để luôn tiếp đất thẳng đứng). */
const nearestTurn = (a: number) => {
  "worklet";
  return Math.round(a / TAU) * TAU;
};

/**
 * Góc đích để lộn `turns` vòng theo chiều sd và tiếp đất thẳng đứng. Vòng đang lộn dở (>~70°)
 * được tính là một vòng, để không bao giờ phải quay ngược chiều giữa không trung.
 */
const spinTarget = (rot: number, turns: number, sd: number) => {
  "worklet";
  const base = sd > 0 ? Math.ceil(rot / TAU) * TAU : Math.floor(rot / TAU) * TAU;
  return Math.abs(base - rot) >= 1.2 ? base + (turns - 1) * TAU * sd : base + turns * TAU * sd;
};

/** Thời gian còn lại tới khi chạm đất, từ độ cao h với vận tốc vy (dương = lên). */
const timeToLand = (h: number, vy: number, g: number) => {
  "worklet";
  return (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * h))) / g;
};

/** Lực rung màn hình từ các cú tiếp đất gần đây (pt màn hình). */
export const impactShake = (list: Impact[], t: number) => {
  "worklet";
  let x = 0;
  let y = 0;
  for (let i = 0; i < list.length; i++) {
    const age = t - list[i].t;
    if (age < 0 || age > 0.5) continue;
    const s = list[i].strength;
    const amp = JUMP.shakePx * s * s * Math.exp(-age * 9);
    x += Math.sin(age * 67 + i) * amp;
    y += Math.cos(age * 59 + i * 2) * amp * 1.3;
  }
  return { x, y };
};

export type PumpkinJump = ReturnType<typeof usePumpkinJump>;

export function usePumpkinJump(opts: {
  time: SharedValue<number>;
  anchor: SharedValue<{ x: number; y: number; w: number }>;
}) {
  const { time, anchor } = opts;
  const st = useSharedValue<St>(INIT);

  const off = useSharedValue({ x: 0, y: 0 });
  const sx = useSharedValue(1);
  const sy = useSharedValue(1);
  const rot = useSharedValue(0);
  const scale = useSharedValue(1);
  const hidden = useSharedValue(false);
  const airborne = useSharedValue(false);
  const height = useSharedValue(0);
  const impacts = useSharedValue<Impact[]>([]);
  const islandT = useSharedValue(-1);
  const phase = useSharedValue<JumpPhase>("rest");
  /** Rung màn hình (pt) từ các cú tiếp đất, app cộng vào transform của cả cảnh nếu muốn. */
  const shake = useSharedValue({ x: 0, y: 0 });
  /** Vệt bay khi vào/ra đảo: [x, y, r, t, ...] tâm bí theo pt màn hình. */
  const trail = useSharedValue<number[]>([]);

  const setPhase = (p: JumpPhase) => {
    "worklet";
    if (phase.get() !== p) phase.set(p);
  };
  const setHidden = (v: boolean) => {
    "worklet";
    if (hidden.get() !== v) hidden.set(v);
  };
  const setAirborne = (v: boolean) => {
    "worklet";
    if (airborne.get() !== v) airborne.set(v);
  };

  /** Bắt đầu bay vào đảo từ vị trí hiện tại. */
  const startIsland = (s: St, t: number) => {
    "worklet";
    const A = anchor.get();
    const ph = A.w * PUMPKIN_ASPECT;
    s.m = M_TO;
    s.it = t;
    s.ax = A.x + s.dx;
    s.ay = A.y - s.h - ph / 2;
    s.arot = s.rot;
    s.sMini = clamp(MINI_BODY / Math.max(1, A.w), 0.02, 1);
    s.spinTo = spinTarget(s.rot, 2, Math.abs(s.w) > 2 ? Math.sign(s.w) : s.dir);
    s.combo = 0;
    s.pendingIsland = false;
    s.hap = 0;
    islandT.set(t);
    trail.set([]);
    haptic("medium");
  };

  /** Rời đất sau khi nhún. */
  const launch = (s: St, t: number) => {
    "worklet";
    if (s.pendingIsland) {
      startIsland(s, t);
      return;
    }
    const g = JUMP.gravity;
    s.vy = Math.sqrt(2 * g * s.target);
    s.h = 0;
    const T = (2 * s.vy) / g;
    const turns = JUMP.spins[Math.min(s.level, JUMP.spins.length - 1)];
    if (turns > 0) s.w = (spinTarget(s.rot, turns, s.dir) - s.rot) / T;
    else s.w = s.dir * (0.6 + s.level * 0.8) + (Math.random() - 0.5) * 0.8;
    s.vx = (s.goal - s.dx) / T;
    s.qv = JUMP.launchPop;
    s.bounces = 0;
    s.m = M_AIR;
    haptic("light");
  };

  /** Chạm đất (h ≤ 0, đang rơi). */
  const touchDown = (s: St, t: number) => {
    "worklet";
    const g = JUMP.gravity;
    const A = anchor.get();
    const vi = Math.max(0, -s.vy);
    const fall = (vi * vi) / (2 * g);
    const first = s.bounces === 0;
    const strength = s.dropped && first ? 1 : Math.min(1.2, Math.sqrt(fall / 400));
    s.h = 0;
    s.rot -= nearestTurn(s.rot);
    s.land = t;
    if (vi > JUMP.impactMin) {
      impacts.set([...impacts.get().slice(-7), { t, x: A.x + s.dx, y: A.y, strength }]);
      haptic(strength >= 0.6 ? "heavy" : first ? "medium" : "light");
    }
    s.qv -= JUMP.squashK * Math.sqrt(vi);
    s.bounces++;
    const vb = vi * (s.dropped ? JUMP.dropRestitution : JUMP.restitution);
    if (vb > JUMP.bounceMin) {
      s.vy = vb;
      const T = (2 * vb) / g;
      s.goal *= 0.35;
      s.vx = (s.goal - s.dx) / T;
      // nảy: nghiêng nhẹ một bên rồi tiếp đất lại gần thẳng (không lộn tiếp)
      const tilt = (Math.random() - 0.5) * 0.2 * strength;
      s.w = (tilt - s.rot) / T;
      s.m = M_AIR;
    } else {
      // nằm lại trên đất: giữ chút đà xoay + cú lắc ngẫu nhiên để lắc lư rồi đứng yên
      s.w = s.w * 0.3 + (Math.random() - 0.5) * strength * 7;
      s.vy = 0;
      s.vx = 0;
      s.goal = 0;
      s.m = M_GROUND;
    }
  };

  /** Lò xo co giãn + nghiêng + trôi ngang, một bước nhỏ. */
  const springs = (s: St, h: number, grounded: boolean) => {
    "worklet";
    s.qv += (-K_Q * s.q - C_Q * s.qv) * h;
    s.q = clamp(s.q + s.qv * h, -0.38, 0.3);
    if (grounded) {
      s.w += (-K_R * s.rot - C_R * s.w) * h;
      s.dx += -s.dx * (1 - Math.exp(-DX_RELAX * h));
    }
    s.rot += s.w * h;
  };

  const step = (t: number) => {
    "worklet";
    const prev = st.get();
    // rung màn hình (chạy cả khi đang nghỉ, vì cú tiếp đất cuối vừa xảy ra)
    const imp = impacts.get();
    if (imp.length > 0 && t - imp[imp.length - 1].t < 0.6) shake.set(impactShake(imp, t));
    else if (shake.get().x !== 0 || shake.get().y !== 0) shake.set({ x: 0, y: 0 });

    if (prev.m === M_REST) {
      // đang nghỉ: không cấp phát gì, chỉ dọn islandT khi chuỗi đảo đã xong hẳn
      if (islandT.get() >= 0 && t - prev.it > ISLAND_END) islandT.set(-1);
      return;
    }
    const s: St = { ...prev };
    let dt = t - s.last;
    s.last = t;
    if (!(dt > 0)) return;
    if (dt > 0.05) dt = 1 / 60; // app vừa bị treo: đừng nhảy cóc

    const A = anchor.get();
    const ph = A.w * PUMPKIN_ASPECT;
    const g = JUMP.gravity;
    let stretch = 0;
    let scl = 1;
    let ox = 0;
    let oy = 0;
    let hgt = 0;

    if (s.m === M_CROUCH || s.m === M_AIR || s.m === M_GROUND) {
      const n = Math.max(1, Math.ceil(dt * 240));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const tt = t - dt + (i + 1) * h;
        if (s.m === M_CROUCH) {
          // nhún: ép nhanh về sy ≈ 0.86
          s.q += (JUMP.crouchSquash - s.q) * (1 - Math.exp(-45 * h));
          s.qv = 0;
          s.w += (-K_R * s.rot - C_R * s.w) * h;
          s.rot += s.w * h;
          if (tt >= s.crouchEnd) launch(s, tt);
          if (s.m === M_TO) break;
        } else if (s.m === M_AIR) {
          s.vy -= g * h;
          s.h += s.vy * h;
          s.dx += s.vx * h;
          springs(s, h, false);
          if (s.h <= 0 && s.vy < 0) touchDown(s, tt);
        } else {
          springs(s, h, true);
        }
      }
      if (s.m === M_GROUND) {
        const calm =
          Math.abs(s.q) < 0.006 && Math.abs(s.qv) < 0.15 && Math.abs(s.rot) < 0.008 && Math.abs(s.w) < 0.12 && Math.abs(s.dx) < 0.4;
        if (calm) {
          s.m = M_REST;
          s.q = 0;
          s.qv = 0;
          s.rot = 0;
          s.w = 0;
          s.dx = 0;
          s.dropped = false;
        }
      }
      if (s.m === M_AIR) stretch = Math.min(0.16, Math.abs(s.vy) * 0.00017);
      ox = s.dx;
      oy = -s.h;
      hgt = s.h;
    }

    if (s.m === M_TO) {
      // cung bay: Bezier bậc 2, lao nhanh – lơ lửng giữa chừng – bị hút vào đảo
      const u = clamp((t - s.it) / ISLAND_TIMING.fly, 0, 1);
      const e = u + 0.15 * Math.sin(TAU * u);
      const side = Math.abs(s.ax - ISLAND_CX) > 8 ? Math.sign(s.ax - ISLAND_CX) : s.dir;
      const p1x = s.ax + side * 85;
      const p1y = ISLAND_CY + (s.ay - ISLAND_CY) * 0.3;
      const a = (1 - e) * (1 - e);
      const b = 2 * (1 - e) * e;
      const c = e * e;
      const cx = a * s.ax + b * p1x + c * ISLAND_CX;
      const cy = a * s.ay + b * p1y + c * ISLAND_CY;
      const eS = smooth(u);
      scl = 1 + (s.sMini - 1) * Math.pow(eS, 0.8);
      s.rot = s.arot + (s.spinTo - s.arot) * eS;
      s.q = 0;
      s.qv = 0;
      stretch = 0.24 * Math.sin(Math.PI * u);
      ox = cx - A.x;
      oy = cy - (A.y - ph / 2);
      hgt = Math.max(0, -oy);
      const tr = trail.get();
      trail.set([...(tr.length >= 56 ? tr.slice(4) : tr), cx, cy, (ph * scl) / 2, t]);
      if (u >= 1) {
        s.m = M_ISLAND;
        s.rot = 0;
        haptic("heavy");
      }
    } else if (s.m === M_ISLAND) {
      const tau = t - s.it;
      scl = s.sMini;
      ox = ISLAND_CX - A.x;
      oy = ISLAND_CY - (A.y - ph / 2);
      hgt = Math.max(0, -oy);
      if (s.hap === 0 && tau >= ISLAND_ARRIVE + 0.14) {
        s.hap = 1;
        haptic("success");
      }
      if (s.hap === 1 && tau >= ISLAND_SHAKE_AT) {
        s.hap = 2;
        haptic("light");
      }
      if (tau >= ISLAND_SPIT_AT) {
        s.m = M_FALL;
        s.hap = 3;
        s.dropped = true;
        trail.set([]);
        haptic("medium");
      }
    }

    if (s.m === M_FALL) {
      // rơi tự do từ tâm đảo về chỗ nghỉ (chỗ nghỉ đi theo anchor nếu camera đang lia)
      const tf = Math.max(0, t - (s.it + ISLAND_SPIT_AT));
      const restCy = A.y - ph / 2;
      const H = Math.max(1, restCy - ISLAND_CY);
      const v0 = JUMP.dropV0;
      const T = (-v0 + Math.sqrt(v0 * v0 + 2 * g * H)) / g;
      const f = clamp(tf / T, 0, 1);
      const cy = ISLAND_CY + v0 * tf + 0.5 * g * tf * tf;
      const cx = ISLAND_CX + (A.x - ISLAND_CX) * smooth(f);
      const v = v0 + g * tf;
      scl = s.sMini + (1 - s.sMini) * smooth(f / 0.85);
      s.rot = s.dir * TAU * Math.pow(1 - f, 2);
      stretch = Math.min(0.22, v * 0.00013);
      ox = cx - A.x;
      oy = Math.min(0, cy - restCy);
      hgt = Math.max(0, -oy);
      const tr = trail.get();
      if (f < 0.7) trail.set([...(tr.length >= 40 ? tr.slice(4) : tr), cx, cy, (ph * scl) / 2, t]);
      if (cy >= restCy) {
        // chạm đất → chuyển sang vật lý nảy bình thường
        s.m = M_AIR;
        s.h = 0;
        s.dx = 0;
        s.goal = 0;
        s.vy = -v;
        s.rot = 0;
        s.w = s.dir * 2;
        s.bounces = 0;
        touchDown(s, t);
        ox = 0;
        oy = 0;
        hgt = 0;
        scl = 1;
        stretch = 0;
      }
    }

    // ── xuất ra shared value ──
    // bí là vật rắn: co giãn tối đa ±5 % (FEEDBACK 23:23: stretch 0.16–0.24 làm bí dài như bao / củ cà rốt)
    const syv = Math.min(1.05, Math.max(0.95, (1 + s.q) * (1 + stretch * 0.25)));
    sy.set(syv);
    sx.set(1 / Math.sqrt(Math.max(0.2, syv)));
    off.set({ x: ox, y: oy });
    rot.set(s.rot);
    scale.set(scl);
    height.set(hgt);
    setHidden(s.m === M_ISLAND);
    setAirborne(s.m !== M_REST);
    if (s.m === M_REST) {
      setPhase("rest");
      if (islandT.get() >= 0 && t - s.it > ISLAND_END) islandT.set(-1);
    } else if (s.m === M_TO) setPhase("toIsland");
    else if (s.m === M_ISLAND) setPhase("island");
    else if (s.m === M_FALL || s.dropped) setPhase("drop");
    else setPhase("air");
    if (s.m !== M_TO && s.m !== M_FALL && trail.get().length > 0 && t - trail.get()[trail.get().length - 1] > 0.4) trail.set([]);
    st.set(s);
  };

  useAnimatedReaction(
    () => time.get(),
    (t) => step(t),
  );

  /** Chạm vào bí (worklet, gọi trên UI thread, vd. trong onEnd của Gesture.Tap). x, y: pt màn hình. */
  const tap = (x: number, _y: number) => {
    "worklet";
    const s: St = { ...st.get() };
    if (s.m === M_TO || s.m === M_ISLAND || s.m === M_FALL || s.dropped) return;
    const t = time.get();
    const A = anchor.get();
    const chain = s.m === M_AIR || s.m === M_CROUCH || t - s.land < JUMP.comboWindow;
    s.combo = chain ? s.combo + 1 : 1;
    s.level = Math.min(s.combo - 1, JUMP.heights.length - 1);
    s.target = JUMP.heights[s.level] * (s.combo > JUMP.heights.length ? 1.15 : 1);
    // chạm bên trái → bí bị đẩy sang phải (và xoay theo chiều đó)
    s.dir = x < A.x + s.dx ? 1 : -1;
    const lv = 1 + s.level * 0.6;
    s.goal = clamp(s.goal + s.dir * JUMP.drift * lv, -JUMP.maxDrift, JUMP.maxDrift);
    if (s.m === M_REST) s.last = t; // đồng hồ bước mô phỏng không chạy lúc nghỉ

    const g = JUMP.gravity;
    const apex = s.m === M_AIR ? s.h + (Math.max(0, s.vy) * Math.max(0, s.vy)) / (2 * g) : 0;
    const toIsland = s.combo >= JUMP.islandTaps || s.target > JUMP.islandHeight || apex > JUMP.islandHeight;

    if (s.m === M_AIR) {
      if (toIsland) {
        startIsland(s, t);
      } else {
        // tung hứng: đá thêm năng lượng, bay cao hơn, lộn nhiều hơn
        const need = Math.max(s.target - s.h, JUMP.minKick);
        const vNeed = Math.sqrt(2 * g * need);
        if (s.vy < vNeed) s.vy = vNeed;
        const T = timeToLand(s.h, s.vy, g);
        s.vx = (s.goal - s.dx) / T;
        const turns = JUMP.spins[Math.min(s.level, JUMP.spins.length - 1)];
        // đang lộn thì giữ chiều đang lộn
        const sd = Math.abs(s.w) > 2 ? Math.sign(s.w) : s.dir;
        if (turns > 0) s.w = (spinTarget(s.rot, turns, sd) - s.rot) / T;
        else s.w += s.dir * (0.8 + 0.6 * s.level);
        s.qv += JUMP.kickPop;
        s.bounces = 0;
        haptic("light");
      }
    } else if (s.m === M_CROUCH) {
      // đang nhún thì chỉ nâng mục tiêu
      if (toIsland) s.pendingIsland = true;
    } else {
      s.m = M_CROUCH;
      s.crouchEnd = t + (s.combo === 1 ? JUMP.crouch : JUMP.crouchCombo);
      s.pendingIsland = toIsland;
      s.vy = 0;
      s.h = 0;
      if (phase.get() === "rest") setPhase("air");
      setAirborne(true);
    }
    st.set(s);
  };

  return { tap, off, sx, sy, rot, scale, hidden, airborne, height, impacts, islandT, phase, shake, trail };
}

/**
 * Transform Skia cho quả bí, đúng thứ tự pivot:
 *   translate(off) → [quanh tâm] rotate(rot)·scale(scale) → [quanh đáy giữa] scale(sx, sy).
 * `bottom`, `center`: đáy giữa và tâm bí lúc nghỉ trong hệ toạ độ đang vẽ;
 * `k`: số pt màn hình ứng với 1 đơn vị hệ đó (vd. fit.k nếu vẽ trong khung thiết kế đã scale).
 */
export const jumpTransform = (
  j: { off: { x: number; y: number }; sx: number; sy: number; rot: number; scale: number },
  bottom: { x: number; y: number },
  center: { x: number; y: number },
  k = 1,
): Transforms3d => {
  "worklet";
  return [
    { translateX: j.off.x / k + center.x },
    { translateY: j.off.y / k + center.y },
    { rotate: j.rot },
    { scale: j.scale },
    { translateX: bottom.x - center.x },
    { translateY: bottom.y - center.y },
    { scaleX: j.sx },
    { scaleY: j.sy },
    { translateX: -bottom.x },
    { translateY: -bottom.y },
  ];
};
