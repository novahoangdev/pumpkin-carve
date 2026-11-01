# Tiếng động + nhạc nền cho clip demo (đèn bí ngô), tổng hợp hoàn toàn bằng numpy (không dùng tài nguyên có bản quyền).
# Mẫu số 0 của file wav = đồng hồ app t = 0 (useFrameCallback trong PumpkinScene.tsx). Mọi mốc đọc từ code app:
# app/src/demo/script.ts (DEMO), fx/Bats.tsx, fx/Particles.tsx, fx/jump.ts, scene/view.ts — port + mô phỏng lại ở đây.
# Giọng: "ma quái mà ấm cúng" — đêm hiên nhà, dao cưa bí, que diêm, nến bùng, đàn dơi ùa ra; không kinh dị.
#
#   nền cả clip: mưa giông (rì rào + giọt + mái hiên + giọt nặng từ mép mái), gió rất nhẹ, cú kêu xa một lần, tiếng ù
#       khẽ của đèn hiên (tắt cùng công tắc); sấm theo STRIKES trong fx/storm.ts, trễ dist/343 s sau tia chớp
#   (v3) intro: camera zoom từ xa vào quả bí → whoosh/riser điện ảnh, đáp nhẹ đúng lúc dừng
#   khắc: mỗi nét có tiếng dao cắm vào, hạt "cưa" theo đúng nhịp haptic (mỗi 18 pt ngón tay đi trên màn hình), nét xong
#       thì mảnh vỏ "bụp" lún vào trong, rơi "thịch" trong lòng bí, vụn + hạt bí văng ra lộp độp trên sàn gỗ (tính đúng
#       thời điểm chạm sàn theo vật lý trong fx/Particles.tsx)
#   (v3) nhìn quanh: gió lia theo tốc độ xoay camera, pan theo hướng yaw; cú kêu lúc ngước nhìn trăng
#   (v3) chạm bí: nhún "boing" + gõ rỗng lúc bật, "thịch" ván hiên + lá khô lạo xạo lúc đáp; combo bay vào Dynamic
#       Island: vút lên (cao độ trượt lên), "bloop" bị hút, lấp lánh khi pill nở, rung, "phụt" nhả ra, huýt rơi, THỊCH
#       nặng + nảy — mô phỏng đúng máy trạng thái trong fx/jump.ts
#   que diêm: quẹt + bùng lưu huỳnh + xèo xèo khi cháy, lia theo cung (pan theo toạ độ x)
#   tắt đèn: công tắc "tách", 0.39 s gần như im lặng, nến bùng "phừng" + trầm nở ra, rồi lửa nến lách tách tới hết
#   nghiêng máy: không khí thở, một âm gió/khí mỏng dâng lên
#   dơi: port quỹ đạo 3D của fx/Bats.tsx (mét, cùng hash): mỗi con là tiếng vỗ cánh da 9–12 Hz, to/nhỏ theo khoảng
#       cách tới camera, pan theo góc phương vị; con bay sượt ống kính có gió lướt + lệch cao độ kiểu Doppler; vài tiếng
#       chít chít nhỏ, rồi tan
#   nhạc: hộp nhạc/celesta Rê thứ 96 BPM, nhỏ lúc khắc, im khi tắt đèn, nở ra (pad ấm) đúng nhịp nến bùng, kết Rê trưởng
#
# Chạy (từ thư mục pumpkin-carve):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python blender/scripts/synth_audio.py [-- --out PATH]
# File ra: --out PATH, hoặc biến môi trường SYNTH_OUT; mặc định render/audio/mix_<phiên bản>.wav, riêng v2 là mix.wav.
# Phiên bản: SYNTH_VERSION=v2|v3|..., mặc định tự nhận (script.ts có DEMO.taps → v3). Lưu ý: mốc luôn đọc từ code
# hiện tại, nên SYNTH_VERSION chỉ đổi tên file, không dựng lại được timeline cũ.
# SYNTH_DEBUG=1: in mức RMS từng stem theo cửa sổ 0.5 s.
import json, math, os, re, sys, wave
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
LAYOUT = json.load(open(os.path.join(ROOT, "app", "assets", "scene", "layout.json")))
SCRIPT_TS = open(os.path.join(ROOT, "app", "src", "demo", "script.ts")).read()

CENTER = LAYOUT["center"]
FLAME = LAYOUT["flame"]
MOUTH = LAYOUT["mouth"]
CROP = LAYOUT["crop"]
VIEW_W, VIEW_H = LAYOUT["view"]
CAM = LAYOUT["cam"]
PUMPKIN = LAYOUT["pumpkin"]


def num(key, default):
    m = re.search(rf"\b{key}:\s*(-?[\d.]+)", SCRIPT_TS)
    return float(m.group(1)) if m else default


# ───────────────────────── kịch bản demo (port từ app/src/demo/script.ts) ─────────────────────────
def mirror(s):
    return [[-x, y] for x, y in s][::-1]


def grin(w, top, bot, teeth, bot_tooth=True):
    pts, n = [], 22
    y_top = lambda x: top + (1 - (x / w) ** 2) * 9 - (x / w) ** 2 * 6
    for i in range(n + 1):
        x = -w + 2 * w * i / n
        y = y_top(x) + sum(9 for tx in teeth if abs(x - tx) < 7)
        pts.append([x, y])
    for i in range(n, -1, -1):
        x = -w + 2 * w * i / n
        y = bot - (x / w) ** 2 * (bot - top - 2)
        if bot_tooth and abs(x) < 7:
            y -= 9
        pts.append([x, y])
    return pts


# K: stencil thiết kế cho khung 402 pt, nhân theo bề ngang khung thật (script.ts: K = VIEW.w / 402; bản cũ không có K)
K = VIEW_W / 402 if re.search(r"export const K\s*=\s*VIEW\.w\s*/\s*402", SCRIPT_TS) else 1.0


def densify(shape, step=4):
    """giống densify() trong script.ts: bước ~4 pt, khép kín về điểm đầu (Math.round của JS = làm tròn .5 lên)"""
    out, pts = [], shape + [shape[0]]
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        n = max(1, int(math.floor(math.hypot(bx - ax, by - ay) / step + 0.5)))
        for k in range(n):
            out.append((CENTER[0] + (ax + (bx - ax) * k / n) * K, CENTER[1] + (ay + (by - ay) * k / n) * K))
    out.append((CENTER[0] + pts[0][0] * K, CENTER[1] + pts[0][1] * K))
    return out


LEFT_EYE = [[-56, -14], [-19, -14], [-34, -47]]
STENCILS = {
    "classic": [LEFT_EYE, mirror(LEFT_EYE), [[-9, 8], [9, 8], [0, -8]], grin(60, 16, 50, [-21, 21])],
    "spooky": [
        [[-58, -36], [-18, -20], [-26, -6], [-52, -10]],
        [[58, -36], [52, -10], [26, -6], [18, -20]],
        [[-8, 6], [8, 6], [0, -10]],
        grin(64, 16, 54, [-34, -12, 12, 34], False),
    ],
    "cat": [
        [[-50, -22], [-36, -40], [-20, -22], [-36, -12]],
        [[50, -22], [36, -12], [20, -22], [36, -40]],
        [[-7, 2], [7, 2], [0, 10]],
        [[-36, 22], [-18, 30], [0, 22], [18, 30], [36, 22], [18, 40], [0, 32], [-18, 40]],
    ],
}
# DEMO_FACE = STENCILS[EXPO_PUBLIC_STENCIL ?? "classic"] (v3) hoặc STENCILS.classic[i] trực tiếp (v2)
FACE = STENCILS.get(os.environ.get("EXPO_PUBLIC_STENCIL", "classic"), STENCILS["classic"])
STROKES = [
    {"at": float(a), "pts": densify(STENCILS[k][int(i)] if k else FACE[int(i)]), "speed": float(s) * (K if kk else 1.0)}
    for a, k, i, kk, s in re.findall(
        r"at:\s*([\d.]+),\s*pts:\s*densify\((?:STENCILS\.(\w+)|DEMO_FACE)\[(\d+)\]\),\s*speed:\s*(K\s*\*\s*)?([\d.]+)",
        SCRIPT_TS)
]
assert STROKES, "không đọc được DEMO.strokes trong script.ts"
MATCH_AT = num("matchAt", 8.4)
MATCH_DUR = num("matchDur", 1.1)
BATS_AT_SCRIPT = num("bats", 14.6)
_m = re.search(r"intro:\s*\{\s*delay:\s*([\d.]+),\s*dur:\s*([\d.]+),\s*from:\s*\{\s*yaw:\s*(-?[\d.]+),\s*pitch:\s*(-?[\d.]+),"
               r"\s*zoom:\s*([\d.]+)", SCRIPT_TS)
INTRO = dict(zip(("delay", "dur", "yaw", "pitch", "zoom"), map(float, _m.groups()))) if _m else None
_m = re.search(r"look:\s*\[(.*?)\]", SCRIPT_TS, re.S)
LOOK = [tuple(map(float, k)) for k in re.findall(r"t:\s*([\d.]+),\s*yaw:\s*(-?[\d.]+),\s*pitch:\s*(-?[\d.]+)", _m.group(1))] if _m else []
_m = re.search(r"taps:\s*\[([^\]]*)\]", SCRIPT_TS)
TAPS = [float(x) for x in re.findall(r"[\d.]+", _m.group(1))] if _m else []

VERSION = os.environ.get("SYNTH_VERSION") or ("v3" if TAPS else "v2")
_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = (_argv[_argv.index("--out") + 1] if "--out" in _argv else None) or os.environ.get("SYNTH_OUT") or \
    os.path.join(ROOT, "render", "audio", "mix_final.wav")
OUT = os.path.abspath(OUT)

SR = 48000
DUR = float(os.environ.get("SYNTH_DUR", 0)) or max(19.0, round(BATS_AT_SCRIPT + 9.7, 1))  # dơi 5.8 s + end card 3.6 s + đuôi; SYNTH_DUR=<s> để đổi
N = int(SR * DUR)
FPS = 60                     # simulator ghi ở 60 Hz: nhịp haptic, commit nét, vật lý nhảy tính theo frame
rng = np.random.default_rng(31)
t_all = np.arange(N) / SR


# ───────────────────────── camera xem (port scene/view.ts + phần camera trong PumpkinScene) ─────────────────────────
X0, Y0, Z0 = (np.array(r, float) for r in CAM["rot"])
F0 = CAM["f"]
CX, CY = VIEW_W / 2, VIEW_H / 2


def _rot(v, k, a):
    c, s = math.cos(a), math.sin(a)
    return v * c + np.cross(k, v) * s + k * np.dot(k, v) * (1 - c)


def view_basis(yaw, pitch, zoom):
    up = np.array([0.0, 0.0, 1.0])
    x1, y1, z1 = _rot(X0, up, -yaw), _rot(Y0, up, -yaw), _rot(Z0, up, -yaw)
    return x1, _rot(y1, x1, pitch), _rot(z1, x1, pitch), F0 * zoom


def base_to_screen(b, x, y):
    bx, by, bz, f = b
    sx, sy = (x - CX) / F0, -(y - CY) / F0
    d = X0 * sx + Y0 * sy - Z0
    cz = min(float(np.dot(bz, d)), -1e-4)
    return CX + f * float(np.dot(bx, d)) / -cz, CY - f * float(np.dot(by, d)) / -cz


def _project_base(p):
    d = np.array(p) - np.array(CAM["pos"])
    cz = float(np.dot(Z0, d))
    return CX + F0 * float(np.dot(X0, d)) / -cz, CY - F0 * float(np.dot(Y0, d)) / -cz


PUMPKIN_FOOT = _project_base([PUMPKIN["c"][0], PUMPKIN["c"][1] - PUMPKIN["r"][1] * 0.35, 0])
PUMPKIN_W = CROP[2] * 0.94


def ease_io3(u):
    x = min(max(u, 0.0), 1.0)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def demo_look(t):
    """port demoLook(): yaw/pitch nội suy smoothstep giữa các mốc"""
    if not LOOK or t <= LOOK[0][0] or t >= LOOK[-1][0]:
        return 0.0, 0.0
    for a, b in zip(LOOK, LOOK[1:]):
        if t < b[0]:
            u = (t - a[0]) / (b[0] - a[0])
            e = u * u * (3 - 2 * u)
            return a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e
    return 0.0, 0.0


def demo_tilt(t, lit_at):
    """port demoTilt()"""
    idle = (math.sin(t * 0.9) * 0.18, math.sin(t * 0.6 + 1) * 0.08)
    if lit_at < 0:
        return idle
    u = t - lit_at - 1.2
    if u < 0:
        return idle
    if u > 3.6:
        return idle[0] * min(1, (u - 3.6) / 2), idle[1]
    e = lambda x: 0.5 - 0.5 * math.cos(math.pi * min(max(x, 0), 1))
    x = -e(u / 1.1) if u < 1.1 else (-1 + 2 * e((u - 1.1) / 1.6) if u < 2.7 else 1 - e((u - 2.7) / 0.9))
    return x * 0.95, math.sin(u * 1.7) * 0.35


def view_at(t, lit_at=-1.0):
    """camera xem tại t: intro + nhìn quanh + nghiêng (DEMO). v2 không có intro/look → gần như đứng yên."""
    iu = 1 - ease_io3((t - INTRO["delay"]) / INTRO["dur"]) if INTRO else 0.0
    dy, dp = demo_look(t)
    tx, ty = demo_tilt(t, lit_at)
    yaw = (INTRO["yaw"] * iu if INTRO else 0) + dy + tx * 0.07
    pitch = (INTRO["pitch"] * iu if INTRO else 0) + dp - ty * 0.05
    zoom = 1 + ((INTRO["zoom"] - 1) * iu if INTRO else 0)
    return view_basis(yaw, pitch, zoom)


def path_len(p):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(p, p[1:]))


def simulate():
    """Chạy lại vòng frame-callback của PumpkinScene ở 60 fps: ngón tay ảo (toạ độ màn hình qua camera xem), nhịp haptic
    'select' (mỗi >18 pt), frame commit nét. Trả về: [(stroke, t_bắt_đầu, t_commit, [(t_tick, x, y)], [(t, x, y)])]"""
    out, idx, finger, saw = [], 0, None, 0.0
    ticks, path = [], []
    screen_ticks = "baseToScreen(b, s.pts[(n - 1)" in open(os.path.join(ROOT, "app", "src", "scene", "PumpkinScene.tsx")).read()
    for f in range(int(30 * FPS)):
        t = f / FPS
        if idx >= len(STROKES):
            break
        s = STROKES[idx]
        p, total = s["pts"], len(s["pts"])
        u = (t - s["at"]) / (path_len(p) / s["speed"])
        b = view_at(t) if screen_ticks else None
        scr = (lambda q: base_to_screen(b, *q)) if screen_ticks else (lambda q: q)
        if -0.25 <= u < 0:
            finger = scr(p[0])
        elif u >= 0:
            n = min(total, max(2, int(math.floor(u * total))))
            fx = scr(p[n - 1])
            saw += math.hypot(fx[0] - finger[0], fx[1] - finger[1])
            if saw > 18:
                saw = 0.0
                ticks.append((t, fx[0], fx[1]))
            path.append((t, fx[0], fx[1]))
            finger = fx
            if u >= 1:
                out.append((s, s["at"], t, ticks, path))
                ticks, path = [], []
                idx += 1
    return out


CARVE = simulate()
# frame đầu tiên có u = (t − matchAt)/matchDur ≥ 1 (cùng phép tính dấu phẩy động như JS) → lightUp()
LIT_AT = next(f / FPS for f in range(int(40 * FPS)) if (f / FPS - MATCH_AT) / MATCH_DUR >= 1)
CANDLE_AT = LIT_AT + 0.39                                             # withDelay(390) → nến bùng
TILT0, TILT1 = LIT_AT + 1.2, LIT_AT + 1.2 + 3.6
BATS_AT = next(f / FPS for f in range(int(40 * FPS)) if f / FPS >= max(BATS_AT_SCRIPT, LIT_AT))
MATCH_REST = (352.0, 800.0)
MATCH_TGT = (FLAME[0] + 6, FLAME[1] + 16)


def pan_x(x, k=1.0):
    return float(np.clip((x - VIEW_W / 2) / (VIEW_W / 2) * k, -1, 1))


# ───────────────────────── DSP cơ bản (cùng cách với goku-vs-frieza) ─────────────────────────
def band(x, lo, hi, order=4):
    """Lọc dải bằng FFT, sườn mềm (order 4 ≈ 24 dB/oct)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = 1 / (1 + (lo / np.maximum(f, 1)) ** order) / (1 + (f / hi) ** order)
    return np.fft.irfft(X * m, len(x))


def ns(sec):
    """giây → số mẫu (làm tròn, để mọi mảng cùng độ dài khớp nhau)"""
    return int(round(sec * SR))


def env(n, a, d, shape=4.0):
    t = np.arange(n) / SR
    return np.minimum(t / max(a, 1e-4), 1) * np.exp(-np.maximum(t - a, 0) * shape / max(d, 1e-4))


def fades(x, a=0.003, r=0.006):
    """fade ngắn hai đầu → không có tiếng tách ở biên đoạn"""
    n = len(x)
    ia, ir = max(1, int(a * SR)), max(1, int(r * SR))
    e = np.ones(n)
    e[:ia] = np.linspace(0, 1, ia)[: n]
    e[-ir:] *= np.linspace(1, 0, ir)[-n:]
    return x * e


def damped(f, sec, decay, f_end=None):
    """sin tắt dần (có thể trượt cao độ) — thân gỗ, vỏ bí rỗng, âm trầm"""
    n = ns(sec)
    t = np.arange(n) / SR
    fr = f if f_end is None else f * (f_end / f) ** (t / sec)
    return np.sin(2 * np.pi * np.cumsum(np.full(n, 1.0) * fr) / SR) * np.exp(-t * decay)


_bank = {}


def nb(lo, hi, sec):
    """lát nhiễu đã lọc dải (RMS 1) cắt ngẫu nhiên từ một kho dài 6 s — nhanh hơn lọc từng hạt"""
    key = (lo, hi)
    if key not in _bank:
        x = band(rng.standard_normal(6 * SR), lo, hi)
        _bank[key] = x / x.std()
    x = _bank[key]
    n = ns(sec)
    if n > len(x) // 2:                      # lớp nền dài: lọc riêng một đoạn mới (không lặp kho)
        y = band(rng.standard_normal(n), lo, hi)
        return y / y.std()
    i = rng.integers(0, len(x) - n - 1)
    return x[i:i + n].copy()


def smooth_noise(sec, rate, lo=0.0):
    """đường cong ngẫu nhiên mượt (≈ rate Hz), 0..1 — gió, chập chờn lửa"""
    n = ns(sec)
    k = max(2, int(sec * rate) + 3)
    v = rng.random(k)
    y = np.interp(np.linspace(0, k - 2, n), np.arange(k), v)
    m = max(1, int(SR / rate / 2))
    y = np.convolve(y, np.ones(m) / m, "same")
    return lo + (1 - lo) * (y - y.min()) / (np.ptp(y) + 1e-9)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def ramp(points):
    """đường tự động hoá âm lượng theo (giây, giá trị), nội suy tuyến tính trên cả clip"""
    ts, vs = zip(*sorted(points, key=lambda p: p[0]))
    return np.interp(t_all, ts, vs)


class Bus:
    def __init__(self):
        self.L = np.zeros(N)
        self.R = np.zeros(N)

    def put(self, sig, at, gain=1.0, pan=0.0):
        i = int(round(at * SR))
        if i >= N or i + len(sig) <= 0:
            return
        s = sig * gain
        if i < 0:
            s, i = s[-i:], 0
        s = s[: N - i]
        pan = np.clip(pan, -1, 1)
        self.L[i:i + len(s)] += s * np.sqrt((1 - pan) / 2) * 1.414
        self.R[i:i + len(s)] += s * np.sqrt((1 + pan) / 2) * 1.414

    def put_moving(self, sig, at, gain, pans):
        """pan thay đổi theo mẫu (mảng cùng độ dài sig)"""
        i = int(round(at * SR))
        if i >= N:
            return
        s, p = sig * gain, np.clip(pans, -1, 1)
        s, p = s[: N - i], p[: N - i]
        self.L[i:i + len(s)] += s * np.sqrt((1 - p) / 2) * 1.414
        self.R[i:i + len(s)] += s * np.sqrt((1 + p) / 2) * 1.414

    def stereo(self):
        return np.stack([self.L, self.R], 1)


def reverb(x, sec=1.4, damp=5000, seed=1):
    """vang: tích chập nhiễu suy giảm mũ, hai kênh khác nhau → rộng"""
    r = np.random.default_rng(seed)
    n = ns(sec)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = r.standard_normal(n) * np.exp(-t * 6.9 / sec)
        ir = band(ir, 150, damp)
        ir[: int(0.015 * SR)] *= np.linspace(0, 1, int(0.015 * SR))
        ir /= np.sqrt((ir ** 2).sum())
        L = len(x) + n
        out[:, ch] = np.fft.irfft(np.fft.rfft(x[:, ch], L) * np.fft.rfft(ir, L), L)[: len(x)]
    return out


def norm_peak(st, peak):
    return st * (peak / max(np.abs(st).max(), 1e-9))


# ═════════════════════════ 1. KHẮC: dao bếp cưa qua thịt bí chắc, ướt — chỉ kêu khi ngón tay đang đi trên nét ═════════════════════════
# Mọi thứ bám đúng đường đi của ngón tay ảo (mô phỏng frame ở trên): to/sáng khi đi nhanh, gần như lặng khi bẻ góc.
# Dải năng lượng chủ yếu 150 Hz–3 kHz: không xì, không tiếng kim loại rít, không lấp lánh trên ~5 kHz.
# rng riêng để phần khắc không làm lệch chuỗi ngẫu nhiên của các phần khác.
krng = np.random.default_rng(4242)


def knoise(n, lo, hi):
    x = band(krng.standard_normal(n), lo, hi)
    return x / (x.std() + 1e-12)


def grains(rate, lo, hi, dur_ms, dec_ms, cap=3.0):
    """chuỗi hạt ngắn (xơ bí đứt, bọt ướt): xung Poisson theo tốc độ rate(t) (mảng, hạt/s), chập với vài nhân nhiễu
    dải hẹp tắt nhanh; biên độ phân bố mũ, chặn trên để không hạt nào nhô hẳn ra"""
    n = len(rate)
    out = np.zeros(n)
    for _ in range(4):
        imp = np.zeros(n)
        k = krng.random(n) < rate / 4 / SR
        imp[k] = np.minimum(krng.exponential(1.0, k.sum()), cap)
        m = ns(dur_ms / 1000)
        ker = knoise(m, lo, hi) * np.exp(-np.arange(m) / (dec_ms / 1000 * SR))
        L = n + m
        out += np.fft.irfft(np.fft.rfft(imp, L) * np.fft.rfft(ker, L), L)[:n]
    return out


def cut_sound(path, t_start, t_end, ref_speed):
    """tiếng cắt một nét: path = [(t, x, y)] vị trí ngón tay theo frame. Trả về (tín hiệu mono, mảng pan)."""
    sec = t_end - t_start
    n = ns(sec)
    tt = np.arange(n) / SR
    P = np.array([(t_start, path[0][1], path[0][2])] + list(path))
    # tốc độ ngón tay (pt/s) + hệ số bẻ góc (góc rẽ giữa hai đoạn liên tiếp → dao xoay tại chỗ, gần như không cắt)
    d = np.diff(P[:, 1:], axis=0)
    v = np.hypot(d[:, 0], d[:, 1]) / np.maximum(np.diff(P[:, 0]), 1e-3)
    ang = np.zeros(len(d))
    for j in range(1, len(d) - 1):
        a, b = d[j - 1] + d[j], d[j] + d[j + 1]                       # hướng trung bình 2 frame trước / sau
        na, nb_ = np.hypot(*a), np.hypot(*b)
        if na > 1e-6 and nb_ > 1e-6:
            ang[j] = math.acos(float(np.clip(np.dot(a, b) / (na * nb_), -1, 1)))
    corner = np.clip(1 - ang / (0.45 * math.pi), 0.06, 1)
    corner = np.convolve(corner, np.ones(5) / 5, "same")             # góc ảnh hưởng ±2 frame
    sp = np.clip(v * corner / ref_speed, 0, 1.3)
    tf = P[1:, 0] - t_start
    s = np.interp(tt, tf, sp)
    s = np.convolve(s, np.ones(ns(0.04)) / ns(0.04), "same")         # mượt 40 ms
    level = s ** 0.9
    # nhịp cưa tới–lui 5–7 Hz (nhanh hơn khi kéo nhanh), có lệch nhịp nhẹ như tay người
    f_saw = (5.0 + 2.0 * np.clip(s, 0, 1)) * (1 + 0.08 * (smooth_noise(sec, 1.5) - 0.5))
    ph = 2 * np.pi * np.cumsum(f_saw / 2) / SR                       # một chu kỳ = một lượt tới + một lượt lui
    half = np.abs(np.sin(ph))
    saw = half ** 1.3
    push = np.sin(ph) > 0                                            # lượt đẩy dao: chắc, sáng hơn chút
    # (a) thân: tiếng 'sạt' đục của lưỡi dao trong thịt bí (dải thấp-trung + formant khoang ướt)
    body = knoise(n, 150, 850) * 0.8 + knoise(n, 450, 1400) * (0.35 + 0.25 * push) * np.clip(s, 0, 1)
    body *= (0.18 + 0.82 * saw) * level
    # (b) giòn: xơ bí đứt li ti dày theo tốc độ dao + nhịp cưa
    crunch = grains(260 * level * (0.25 + 0.75 * saw), 450, 2400, 9, 1.6) * 0.55
    # (c) bọt ướt: 'tách' mềm, thưa
    wet = grains(9 * level, 500, 1500, 18, 4.0, 2.0) * 0.9
    # (d) xơ dài bị xé: thỉnh thoảng một chuỗi xung dày 40–70 ms
    tear = np.zeros(n)
    tq = krng.exponential(0.5)
    while tq < sec - 0.08:
        k = ns(tq)
        if level[k] > 0.25:
            m = ns(krng.uniform(0.04, 0.07))
            rate = np.full(m, krng.uniform(140, 260))
            tear[k:k + m] += grains(rate, 600, 2200, 5, 0.9) * np.sin(np.pi * np.arange(m) / m) * 0.7 * level[k]
        tq += krng.exponential(0.5)
    # (e) nhóp: mỗi lượt cưa bắt đầu có một tiếng 'nhóp' trầm (dao ép thịt ướt), trượt xuống 240→170 Hz
    squelch = np.zeros(n)
    starts = np.where(np.diff(np.floor(ph / np.pi)) > 0)[0]
    for k in starts:
        m = ns(0.07)
        if k + m < n and level[k] > 0.1:
            t_ = np.arange(m) / SR
            f = (230 + 30 * krng.random()) * (0.72 ** (t_ / 0.07))
            squelch[k:k + m] += np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t_ / 0.018) * np.minimum(t_ / 0.003, 1) \
                * 0.45 * level[k]
    x = body + crunch + wet + tear + squelch
    x = band(x, 140, 3000)                                           # giữ 150 Hz–3 kHz, cắt hẳn dải xì
    x = fades(x, 0.025, 0.03)
    pans = np.interp(tt, tf, [pan_x(p[1], 1.4) for p in P[1:]])
    return x, pans, float(np.mean(level))


def hole_pop(size):
    """mảnh vỏ bị đẩy vào lòng bí: 'thóc' rỗng mềm + 'chụt' hút ướt, ngắn (~0.2 s)"""
    sec = 0.25
    n = ns(sec)
    t_ = np.arange(n) / SR
    f0 = 210 - 50 * size
    x = damped(f0, sec, 26, f0 * 0.8) * 0.9 + damped(f0 * 2.05, sec, 45) * 0.2   # khoang bí rỗng
    suck = np.sin(2 * np.pi * np.cumsum(620 * (0.38 ** np.clip(t_ / 0.06, 0, 1))) / SR) * env(n, 0.004, 0.05, 4)
    x += suck * 0.35 + knoise(n, 200, 1200) * env(n, 0.002, 0.025, 4) * 0.35
    return fades(band(x * np.minimum(t_ / 0.0015, 1), 100, 2500), 0.0015, 0.04)


def tap(seed):
    """một vụn/hạt bí chạm sàn gỗ hiên: tách gỗ có thân (600–1000 Hz), hạt bí nhẹ + cao hơn"""
    sec = 0.06
    n = ns(sec)
    f = (650 + 350 * rng.random()) * (1.5 if seed else 1.0)
    x = damped(f, sec, 90) * 0.6 + damped(f * 2.3, sec, 160) * 0.2
    x += nb(1200, 4500, sec) * env(n, 0.0005, 0.006, 5) * 0.7
    x += nb(150, 600, sec) * env(n, 0.001, 0.02, 5) * (0.0 if seed else 0.5)  # vụn thịt: hơi ướt, có 'bẹp'
    return fades(x * np.minimum(np.arange(n) / (0.0004 * SR), 1), 0.0004, 0.01)


def particle_landings(cx, cy, rx, ry, t_burst):
    """port fx/Particles.tsx: 26 hạt/lần, thời điểm chạm thềm lần 1 + lần nảy (vy = -0.32·v_chạm)"""
    G, floor0 = 900.0, CENTER[1] + CROP[2] * 0.33
    out = []
    for i in range(26):
        r1, r2, r3, r4 = rng.random(4)
        delay = r4 * 0.08
        ang = r1 * 2 * math.pi
        sx, sy = cx + math.cos(ang) * rx, cy + math.sin(ang) * ry
        sp = 60 + r2 * 150
        vx = math.cos(ang) * sp * 0.8 + (sx - CENTER[0]) * 0.9
        vy = math.sin(ang) * sp * 0.4 - 120 - r3 * 120
        floor = floor0 + r3 * 40
        tc = (-vy + math.sqrt(max(vy * vy + 2 * G * (floor - sy), 0))) / G
        if tc > 1.5:                       # LIFE = 1.5: hạt đã mờ hết trước khi chạm
            continue
        v_imp = vy + G * tc
        x_land = sx + vx * tc
        size = 2.0 + r2 * 3.4
        out.append((t_burst + delay + tc, x_land, size, i % 4 == 0, 1.0))
        tb = 2 * 0.32 * v_imp / G           # nảy lên rồi chạm lại
        if delay + tc + tb < 1.5:
            out.append((t_burst + delay + tc + tb, x_land + vx * 0.5 * tb, size, i % 4 == 0, 0.3))
    return out


carve_cut = Bus()                                                    # tiếng cắt (mức tuyệt đối đặt sau khi chuẩn đỉnh)
carve_pop = Bus()
carve_patter = Bus()
CUT_WIN = []
EVENTS = []
for k, (s, t_start, t_commit, ticks, path) in enumerate(CARVE):
    xs = [p[0] for p in s["pts"]]
    ys = [p[1] for p in s["pts"]]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    rx, ry = (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2
    size = min(1.0, (rx * ry) / (60 * 20 * K * K))     # miệng = 1, mắt ~0.5, mũi ~0.1
    L = path_len(s["pts"])
    EVENTS.append(f"stroke{k}: len {L:.1f} pt @ {s['speed']:.1f} pt/s = {L / s['speed']:.3f} s; finger {t_start - 0.25:.3f}, "
                  f"cut {t_start:.3f}–{t_commit:.3f}, pop {t_commit + 0.12:.3f}")
    x, pans, lv = cut_sound(path, t_start, t_commit, K * 200)
    carve_cut.put_moving(x * (0.85 + 0.15 * min(1, s["speed"] / (K * 200))), t_start, 1.0, pans)
    CUT_WIN.append((t_start, t_commit))
    # nét xong: mảnh vỏ lún vào cùng lúc vụn bắn (burst t = commit + 0.12), vụn + hạt bí lộp độp trên thềm
    p = pan_x(cx, 1.4)
    carve_pop.put(hole_pop(size), t_commit + 0.12, 0.7 + 0.3 * size, p)
    for t_land, x_, sz, seed, g in particle_landings(cx, cy, rx, ry, t_commit + 0.12):
        carve_patter.put(tap(seed), t_land, g * (0.5 + 0.5 * sz / 5.4) * rng.uniform(0.6, 1.2), pan_x(x_, 1.3))


# ═════════════════════════ 2. QUE DIÊM ═════════════════════════
match = Bus()


def match_xy(t):
    u = (t - MATCH_AT) / MATCH_DUR
    e = 1 if u >= 1 else 0.5 - 0.5 * math.cos(math.pi * max(u, 0))
    return MATCH_REST[0] + (MATCH_TGT[0] - MATCH_REST[0]) * e, \
        MATCH_REST[1] + (MATCH_TGT[1] - MATCH_REST[1]) * e - math.sin(math.pi * e) * 70


# quẹt: nhám giấy ráp, sần (điều biên ngẫu nhiên), 0.11 s ngay trước lúc đầu diêm bắt lửa
sec = 0.11
n = ns(sec)
scr = nb(1200, 6500, sec) * (0.4 + 0.6 * smooth_noise(sec, 180)) * np.clip(np.arange(n) / (0.015 * SR), 0, 1)
scr *= np.clip((n - np.arange(n)) / (0.02 * SR), 0, 1)
match.put(fades(scr), MATCH_AT - 0.07, 0.6, pan_x(MATCH_REST[0]))
# bùng lưu huỳnh: 'phựt-xèèè' — tấn công nhanh, lùi về mức cháy; thêm lụp bụp nhỏ trong 0.3 s đầu
sec = LIT_AT + 0.12 - (MATCH_AT - 0.02)                             # cháy tới lúc thả diêm vào miệng
n = ns(sec)
tt = np.arange(n) / SR
flare_env = np.minimum(tt / 0.018, 1) * (0.18 + 0.82 * np.exp(-tt / 0.16))
flare_env *= np.clip((sec - tt) / 0.22, 0, 1)                      # tắt nhanh quanh 9.5 s → khoảng tối gần như im
flare = nb(500, 5200, sec) * 0.7 + nb(90, 450, sec) * 0.5 * np.exp(-tt / 0.08)
flare = flare * flare_env * (0.85 + 0.15 * smooth_noise(sec, 25))
for _ in range(60):                                                # lách tách khi cháy (dày lúc bùng)
    tc = rng.exponential(0.25)
    if tc > 1.1:
        continue
    k = int(tc * SR)
    m = int(0.003 * SR)
    flare[k:k + m] += nb(1500, 5000, 0.003) * np.exp(-np.arange(m) / (0.0007 * SR)) * rng.uniform(0.2, 0.8) * (0.4 + np.exp(-tc / 0.2))
pans = np.array([pan_x(match_xy(MATCH_AT - 0.02 + x)[0]) for x in tt[::480]])
match.put_moving(fades(flare, 0.001, 0.02), MATCH_AT - 0.02, 0.55, np.interp(tt, tt[::480], pans))
# lửa lia theo cung: gió lửa 'phù' theo vận tốc (vận tốc ∝ sin(πu))
sec = MATCH_DUR
n = ns(sec)
tt = np.arange(n) / SR
vel = np.sin(np.pi * tt / sec) ** 2
sw = band(nb(150, 1400, sec), 150, 1400) * vel
match.put_moving(fades(sw, 0.02, 0.05), MATCH_AT, 0.18, np.array([pan_x(match_xy(MATCH_AT + x)[0]) for x in tt]))
EVENTS.append(f"match: finger {MATCH_AT - 0.3:.3f}, strike {MATCH_AT - 0.07:.3f}, ignite {MATCH_AT:.3f}, drag {MATCH_AT:.3f}–{MATCH_AT + MATCH_DUR:.3f}")


# ═════════════════════════ 3. TẮT ĐÈN HIÊN → NẾN BÙNG → LỬA NẾN ═════════════════════════
fire = Bus()
# công tắc: hai tiếng tách cơ khí cách 7 ms + thân 'cộp' trầm, hơi xa (đèn hiên phía trên)
sec = 0.2
n = ns(sec)
clk = np.zeros(n)
for d, g in ((0.0, 1.0), (0.007, 0.55)):
    k = int(d * SR)
    m = int(0.012 * SR)
    clk[k:k + m] += nb(1400, 5000, 0.012) * np.exp(-np.arange(m) / (0.0012 * SR)) * g
clk += damped(130, sec, 30, 95) * 0.45 + damped(2300, sec, 140) * 0.15
fire.put(fades(clk * np.minimum(np.arange(n) / (0.0003 * SR), 1)), LIT_AT, 0.4, pan_x(LAYOUT["lantern"][0]))
# hít vào rất khẽ (ngược) trong bóng tối, dẫn vào tiếng bùng
sec = 0.22
n = ns(sec)
fire.put(nb(250, 1800, sec) * (np.arange(n) / n) ** 3 * 0.25, CANDLE_AT - sec, 1.0, 0.0)
# 'PHỪNG': khối khí bùng (lọc thấp, mở sáng rồi đóng) + trầm nở 70→42 Hz + ngọn lửa xoè
sec = 1.8
n = ns(sec)
tt = np.arange(n) / SR
body = nb(60, 700, sec) * np.minimum(tt / 0.035, 1) * np.exp(-tt / 0.28)
air = nb(400, 3200, sec) * np.minimum(tt / 0.06, 1) * np.exp(-tt / 0.35) * 0.45
sub = damped(72, sec, 2.3, 40) * np.minimum(tt / 0.03, 1) * 0.9
whoomp = body * 0.9 + air + sub
fire.put(fades(whoomp, 0.001, 0.2), CANDLE_AT, 1.0, pan_x(FLAME[0]))
EVENTS.append(f"porch off {LIT_AT:.3f}, blackout {LIT_AT:.3f}–{CANDLE_AT:.3f}, candle burst {CANDLE_AT:.3f}")

# lửa nến liên tục: 'phù phù' trầm chập chờn + lách tách bấc/sáp, pan nhẹ theo độ nghiêng máy
candle = Bus()
c0 = CANDLE_AT + 0.05
sec = DUR - c0
n = ns(sec)
tt = np.arange(n) / SR


tilt = np.array([demo_tilt(c0 + x, LIT_AT)[0] for x in tt[::240]])
tilt = np.interp(tt, tt[::240], tilt)
tilt_v = np.abs(np.gradient(tilt) * SR)                              # tốc độ nghiêng → lửa bị lắc, phập phồng hơn
tilt_v = np.convolve(tilt_v, np.ones(4800) / 4800, "same")
flick = smooth_noise(sec, 6, 0.35) * (0.8 + 0.2 * smooth_noise(sec, 1.3))
roar = nb(110, 800, sec) * 0.6 + nb(500, 2200, sec) * 0.18
roar *= flick * (1 + 0.6 * np.clip(tilt_v, 0, 1)) * np.minimum(tt / 0.4, 1)
cr = np.zeros(n)
tc = rng.exponential(1 / 6.5)
while tc < sec - 0.05:
    k = int(tc * SR)
    big = rng.random() < 0.12                                        # thỉnh thoảng sáp 'lộp' to hơn
    m = int((0.006 if big else 0.003) * SR)
    g = rng.uniform(0.6, 1.0) if big else rng.uniform(0.15, 0.5)
    cr[k:k + m] += nb(900 if big else 1600, 4500, m / SR) * np.exp(-np.arange(m) / ((0.0015 if big else 0.0007) * SR)) * g
    tc += rng.exponential(1 / 6.5)
cbed = roar * 0.5 + cr * 0.9
candle.put_moving(fades(cbed, 0.01, 0.1), c0, 1.0, pan_x(FLAME[0]) + tilt * 0.35)


# ═════════════════════════ 4. NGHIÊNG MÁY: không khí thở, âm khí dâng ═════════════════════════
air_bus = Bus()
sec = TILT1 - TILT0 + 0.6
n = ns(sec)
tt = np.arange(n) / SR
# dải nhiễu có tâm trượt 450 → 1600 Hz (cộng 3 dải chồng mờ dần), bao dâng chậm rồi lặng xuống trước dơi
u = tt / sec
lo = nb(300, 900, sec) * (1 - u)
mid = nb(600, 1800, sec) * np.sin(np.pi * u)
hi = nb(1200, 3400, sec) * u * 0.6
airy = (lo + mid + hi) * np.sin(np.pi * np.clip(tt / sec, 0, 1)) ** 1.6 * (0.7 + 0.3 * smooth_noise(sec, 0.8))
tl = np.interp(tt, np.arange(0, sec, 0.01), [demo_tilt(TILT0 + x, LIT_AT)[0] for x in np.arange(0, sec, 0.01)])
air_bus.put_moving(fades(airy, 0.3, 0.3), TILT0, 1.0, tl * 0.7)
EVENTS.append(f"tilt {TILT0:.3f}–{TILT1:.3f}")


# ═════════════════════════ 5. ĐÀN DƠI XẾP CHỮ (fx/Bats.tsx: 390 con → "HAPPY HALLOWEEN / @novahoangdev") ═════════════════════════
# Không port quỹ đạo từng con nữa (390 con): tổng hợp theo PHA, mốc đọc từ BAT_TIMES trong Bats.tsx (tính từ lúc dơi ra):
#   ùa ra 0 → emergeEnd (dày dần, dòng chạy trái → phải) · rẽ về chữ ~0.45 → formed (thưa dần, xoáy nhẹ) ·
#   GIỮ CHỮ formed → holdEnd (rì rào trầm, chậm, nhỏ — khoảnh khắc tiêu đề, chừa chỗ) · tan ra holdEnd → +0.2 ·
#   lao qua ống kính ~holdEnd+0.4 → gone−0.2 (loạt 'vút' sát tai, rộng stereo, to nhất ~holdEnd+0.8) · hết ở gone.
# Mức ở đây là dBFS tuyệt đối (trộn sau khi chuẩn đỉnh, như mưa/sấm/khắc). rng riêng.
BATS_TS = open(os.path.join(ROOT, "app", "src", "fx", "Bats.tsx")).read()
BAT_COUNT = int(re.search(r"BAT_COUNT\s*=\s*(\d+)", BATS_TS).group(1))
BAT_DURATION = float(re.search(r"BAT_DURATION\s*=\s*([\d.]+)", BATS_TS).group(1))
_m = re.search(r"BAT_TIMES\s*=\s*\{([^}]*)\}", BATS_TS)
# mặc định = bảng trong notes/fx.md §9 nếu không đọc được BAT_TIMES
BT = dict(emergeEnd=1.25, formed=3.0, holdEnd=4.2, gone=BAT_DURATION)
if _m:
    BT.update({k: float(v) for k, v in re.findall(r"(\w+):\s*([\d.]+)", _m.group(1))})
bat_end = BATS_AT + BT["gone"]
brng = np.random.default_rng(2024)
dbv = lambda x: 10 ** (x / 20)


def bnoise(n, lo, hi):
    x = band(brng.standard_normal(n), lo, hi)
    return x / (x.std() + 1e-12)


def swarm(sec, voices, fq_lo, fq_hi, lo, hi, bright_hi=None, bright=None, sharp=6):
    """bầy cánh: nhiều 'giọng' vỗ cánh độc lập (mỗi giọng một tần số 6–12 Hz, pha ngẫu nhiên, xung ở nhịp hạ cánh) trên
    nhiễu dải; hai kênh độc lập → rộng. bright (mảng 0..1) trộn thêm dải cao khi dơi ở gần."""
    n = ns(sec)
    t_ = np.arange(n) / SR
    out = np.zeros((n, 2))
    for c in range(2):
        car = bnoise(n, lo, hi)
        car_hi = bnoise(n, 1200, bright_hi) if bright_hi else None
        am = np.zeros(n)
        for _ in range(voices):
            fq = brng.uniform(fq_lo, fq_hi) * (1 + 0.03 * (smooth_noise(sec, 0.7) - 0.5))
            ph = 2 * np.pi * np.cumsum(fq) / SR + brng.uniform(0, 2 * np.pi)
            am += ((1 + np.cos(ph - np.pi)) / 2) ** sharp * brng.uniform(0.4, 1.0)
        am = am / math.sqrt(voices)
        x = car * (0.25 + am)
        if car_hi is not None:
            x = x + car_hi * (0.25 + am) * 0.6 * bright
        out[:, c] = x
    return out


def warp(x, rate):
    """đọc tín hiệu với tốc độ thay đổi (rate > 1 → cao hơn): giả Doppler"""
    idx = np.cumsum(rate)
    idx -= idx[0]
    return np.interp(idx, np.arange(len(x)), x)


def pan_st(x, pans):
    p = np.clip(pans, -1, 1)
    return np.stack([x * np.sqrt((1 - p) / 2) * 1.414, x * np.sqrt((1 + p) / 2) * 1.414], 1) if x.ndim == 1 else \
        np.stack([x[:, 0] * np.sqrt(1 - p), x[:, 1] * np.sqrt(1 + p)], 1)


def rms_win(x, a, b):
    i, j = ns(a), ns(b)
    return float(np.sqrt((x[i:j] ** 2).mean()))


bats_abs = np.zeros((N, 2))


def add_b(sig, at):
    i0 = ns(at)
    m = min(len(sig), N - i0)
    if m > 0:
        bats_abs[i0:i0 + m] += sig[:m]


E, F, H = BT["emergeEnd"], BT["formed"], BT["holdEnd"]
G_ = BT["gone"]
R0, R1 = H + 0.4, G_ - 0.2                                           # lao qua ống kính
R_PK = H + 0.8                                                       # to nhất (notes: ~29.9 = 24.9 + 5.0)
# (1) BAY TỚI TỪ NGOÀI SÂN / TRỜI (Bats.tsx mới: không con nào chui ra từ quả bí). Bầy xuất phát ở sân tối bên trái-phía
#     trước (x −4.6…−0.6 m, y 3.6–6.4 m) hoặc trời xa: lúc đầu xa → nhỏ, tối (mất dải cao), lệch trái; lao vào qua hiên về
#     phía camera (Bézier 1.15–1.45 s, điểm lượn ở u = ½, thứ tự đến trễ 0–0.55 s) → to + sáng dần, pan về giữa, đỉnh
#     ~0.8–1.3 s (vài con sượt ống kính); rồi vút lên vào chữ (camera ngước lên trời) → thưa, nhỏ dần tới lúc thành chữ
sec = F + 0.4
n = ns(sec)
t_ = np.arange(n) / SR
PK_A = 1.05                                                          # bầy gần camera nhất (giữa Bézier + trễ trung bình)
prox = np.clip(t_ / PK_A, 0, 1) ** 1.7                               # 0 = xa ngoài sân, 1 = sát hiên
dens = np.where(t_ < PK_A, 0.12 + 0.88 * prox, np.exp(-(t_ - PK_A) / ((F - PK_A) / 1.7)))
bright = np.clip(np.where(t_ < PK_A, prox, 1 - (t_ - PK_A) / (F - PK_A)), 0.05, 1)
near = swarm(sec, 36, 9, 12, 250, 2400, 4500, bright)
far = swarm(sec, 30, 8, 11, 150, 900)                                # xa: chỉ còn rì rào trầm
a = near * (dens * (0.3 + 0.7 * prox))[:, None] + far * (dens * (1 - prox) * 1.3)[:, None]
a *= np.minimum(t_ / 0.6, 1)[:, None] ** 1.5 * np.clip((sec - t_) / 0.4, 0, 1)[:, None]
pan_a = np.interp(t_, [0, PK_A, PK_A + 0.6, sec], [-0.8, -0.05, -0.25, -0.15])   # sân bên trái → giữa → lên trời (trái)
a = pan_st(a, pan_a * 0.8)
k_pk = ns(PK_A)
a *= dbv(-22) / np.sqrt((a[max(0, k_pk - ns(0.25)):k_pk + ns(0.25)] ** 2).mean())
add_b(a, BATS_AT)
# (2) giữ chữ: rì rào trầm của rất nhiều cánh vỗ chậm, rộng, nhỏ; nở nhẹ lúc tan ra
sec = H - F + 1.0
n = ns(sec)
t_ = np.arange(n) / SR
h = swarm(sec, 48, 5.5, 8, 150, 1300, sharp=4)
he = np.clip(t_ / 0.5, 0, 1) * (1 + 1.5 * np.exp(-((t_ - (H - F + 0.3 + 0.1)) / 0.15) ** 2)) * np.clip((sec - t_) / 0.4, 0, 1)
h *= he[:, None]
h *= dbv(-34) / np.sqrt((h[ns(0.5):ns(H - F + 0.2)] ** 2).mean())
add_b(h, BATS_AT + F - 0.3)
# (3) lao qua ống kính: nền cánh ào lên rồi tắt + loạt 'vút' sát tai (Doppler giả, pan ra hẳn một bên)
sec = G_ - H + 0.3
n = ns(sec)
t_ = np.arange(n) / SR
rush_env = np.exp(-((t_ - (R_PK - H)) / 0.45) ** 2) * np.clip((G_ - H - t_) / 0.25, 0, 1)
r = swarm(sec, 40, 10, 12.5, 250, 2600, 4800, np.clip(rush_env * 1.2, 0, 1)) * rush_env[:, None]
r *= dbv(-21) / np.sqrt((r[ns(R_PK - H - 0.25):ns(R_PK - H + 0.25)] ** 2).mean())
add_b(r, BATS_AT + H)
passes = []
n_fly = 14
times = np.sort(R0 + (R1 - R0) * brng.beta(2.4, 2.4, n_fly))
# + 5 con sượt ống kính lúc bầy lao vào hiên (skim: u ≈ ½ của Bézier 1.0–1.2 s, cộng thứ tự đến 0–0.55 s), nhỏ hơn đợt tan
SKIMS = np.sort(0.5 + 0.55 * brng.beta(2, 2, 5) + 0.55 * brng.random(5) * 0.3)
times = np.concatenate([SKIMS, times])
for j, tp in enumerate(times):
    side = -1 if j % 2 == 0 else 1
    if brng.random() < 0.25:
        side = -side
    d0 = brng.uniform(0.1, 0.3)                                      # khoảng cách sượt qua ống kính (m)
    v = brng.uniform(2.2, 3.2)                                       # m/s
    sec = 0.9
    n = ns(sec)
    tau = np.arange(n) / SR - 0.55                                    # 0 = lúc ngang ống kính
    dist = np.sqrt(d0 ** 2 + (v * tau) ** 2)
    vr = v * v * tau / dist
    gain = np.minimum(1.6, 0.25 / dist)
    rate = np.clip(4.0 / (4.0 + vr), 0.7, 1.4)
    m = int(n * 1.5) + 10
    fq = brng.uniform(10, 12.5)
    ph = 2 * np.pi * fq * (tau + 0.55) + brng.uniform(0, 6.28)
    pulse = ((1 + np.cos(ph - np.pi)) / 2) ** 6
    prox = np.clip(gain / 1.2, 0, 1)
    flut = (warp(bnoise(m, 250, 2200), rate) * (0.6 + 0.2 * (1 - prox)) + warp(bnoise(m, 1500, 4800), rate) * 0.45 * prox) \
        * (0.12 + pulse)
    air = warp(bnoise(m, 140, 900), rate) * np.clip(gain ** 2 / 1.6, 0, 1) * 1.1
    sig = fades((flut + air) * gain * np.clip((0.35 - tau) / 0.25, 0, 1), 0.02, 0.02)
    pans = side * np.clip(0.25 + 0.75 * np.clip((tau + 0.15) / 0.2, 0, 1), 0, 1)   # tiến vào từ giữa → vụt ra hẳn một bên
    g = 0.55 + 0.45 * math.exp(-((tp - R_PK) / 0.35) ** 2) if tp > R0 - 0.1 else 0.45   # đậm nhất quanh R_PK
    add_b(pan_st(sig, pans) * g * dbv(-21) / 1.6, BATS_AT + tp - 0.55)
    passes.append((BATS_AT + tp, d0, "L" if side < 0 else "R"))
# (4) vài tiếng chít: nhỏ, cao, đôi (FM trượt xuống) — 2 lúc ùa ra, 4 lúc lao qua
for tq, gq in [(0.75, -33), (1.1, -30)] + [(float(x), -25) for x in brng.uniform(R0, R1 - 0.1, 4)]:
    for rep in range(2):
        sec_q = 0.035
        nq = ns(sec_q)
        tq_ = np.arange(nq) / SR
        f0 = brng.uniform(3600, 5000)
        ch = np.sin(2 * np.pi * np.cumsum(f0 * (0.72 ** (tq_ / sec_q)) * (1 + 0.04 * np.sin(2 * np.pi * 60 * tq_))) / SR)
        ch *= np.sin(np.pi * tq_ / sec_q) ** 2 * dbv(gq)
        add_b(pan_st(ch, np.full(nq, brng.uniform(-0.7, 0.7))), BATS_AT + tq + rep * 0.06)
# (5) bỏ: bản mới không còn đám lửa/khí bùng ra từ quả bí (FEEDBACK-2300 #5)
bats_abs = np.stack([band(bats_abs[:, c], 60, 9000) for c in range(2)], 1)
# hai bus cũ giữ cho phần trộn (giờ rỗng; dơi trộn ở mức tuyệt đối)
bats, squeak_bus, bat_puff = Bus(), Bus(), Bus()
EVENTS.append(f"bats {BATS_AT:.3f} ({BAT_COUNT} bats, BAT_TIMES {BT}): arrive from yard/sky (closest {BATS_AT + PK_A:.2f}), emerge {BATS_AT:.2f}–{BATS_AT + E:.2f}, "
              f"steer → {BATS_AT + F:.2f}, HOLD {BATS_AT + F:.2f}–{BATS_AT + H:.2f}, break {BATS_AT + H:.2f}–{BATS_AT + H + 0.2:.2f}, "
              f"rush {BATS_AT + R0:.2f}–{BATS_AT + R1:.2f} (peak {BATS_AT + R_PK:.2f}), gone {bat_end:.2f}; flybys "
              + ", ".join(f"{t:.2f}{s}" for t, _, s in passes))


# ═════════════════════════ 6. ĐÊM: gió, dế, cú, ù đèn hiên ═════════════════════════
amb = Bus()
# gió: nhiễu nâu-ish dải thấp (hai kênh lệch) + một chút rít dải trung, phồng xẹp chậm; thổi mạnh hơn lúc nghiêng
gust = smooth_noise(DUR, 0.25, 0.3) * (1 + 0.6 * np.exp(-((t_all - (TILT0 + TILT1) / 2) / 1.6) ** 2))
for ch, pan in ((0, -0.7), (1, 0.7)):
    wnd = band(rng.standard_normal(N), 60, 520) + band(rng.standard_normal(N), 500, 1300) * 0.18 * smooth_noise(DUR, 0.4)
    amb.put(wnd / wnd.std() * gust, 0.0, 1.0, pan)
wind_st = amb.stereo()

crick = Bus()
for f0, pan, period in ((4300, -0.55, 0.95), (4700, 0.6, 1.25), (3900, 0.15, 1.6)):
    t = rng.uniform(0.1, 0.6)
    while t < DUR:
        if rng.random() < 0.8:                                       # lác đác: thỉnh thoảng bỏ nhịp
            pulses = rng.integers(2, 5)
            for p in range(pulses):
                sec = 0.018
                n = ns(sec)
                tt = np.arange(n) / SR
                c = np.sin(2 * np.pi * f0 * tt) * np.sin(np.pi * tt / sec) ** 2 * (1 + 0.3 * np.sin(2 * np.pi * 900 * tt))
                crick.put(c, t + p * 0.032, rng.uniform(0.6, 1.0), pan)
        t += period * rng.uniform(0.8, 1.25)
cricket_st = crick.stereo()

owl = Bus()
# cú kêu xa một lần: v2 lúc ~1.0 s; có cảnh nhìn quanh thì đúng lúc dừng lại ngước nhìn trăng (yaw âm, pitch cao nhất)
moon = [a[0] for a, b in zip(LOOK, LOOK[1:]) if a[1:] == b[1:] and a[1] < 0]
OWL_AT = moon[0] + 0.1 if moon else 1.0
for at, sec, f0, g in ((0.0, 0.32, 360, 0.8), (0.48, 0.22, 380, 0.6), (0.74, 0.62, 350, 1.0)):
    at += OWL_AT
    n = ns(sec)
    tt = np.arange(n) / SR
    u = tt / sec
    f = f0 * (1 + 0.05 * np.sin(np.pi * u) - 0.04 * u)               # 'hú-u': hơi lên rồi trĩu xuống
    ph = 2 * np.pi * np.cumsum(f) / SR
    v = np.sin(ph) + 0.12 * np.sin(2 * ph)
    v = v * (1 + 0.35 * band(rng.standard_normal(n), 2, 30) / 3)    # hơi thở rung
    v += band(rng.standard_normal(n), f0 * 0.8, f0 * 1.6) * 0.15
    e = np.minimum(u / 0.18, 1) * np.clip((1 - u) / 0.45, 0, 1) ** 1.3
    owl.put(fades(v * e), at, g, -0.55)
owl_st = owl.stereo()
owl_st = np.stack([band(owl_st[:, c], 200, 1400) for c in range(2)], 1)  # xa: mất dải cao

hum = Bus()                                                          # bóng đèn hiên ù rất khẽ, tắt cùng công tắc
hx = sum(np.sin(2 * np.pi * f * t_all + rng.random() * 6) * g for f, g in ((120, 1.0), (240, 0.5), (360, 0.25), (480, 0.12)))
hx *= np.clip((LIT_AT + 0.04 - t_all) / 0.04, 0, 1) * np.clip(t_all / 0.5, 0, 1)
hum.put(hx, 0.0, 1.0, pan_x(LAYOUT["lantern"][0]))


# ═════════════════════════ 6b. (v3) INTRO ZOOM · NHÌN QUANH · BÍ NHẢY VÀO DYNAMIC ISLAND ═════════════════════════
intro_bus = Bus()
if INTRO:
    # camera lao từ xa vào (ease in-out bậc 3): gió lướt theo tốc độ zoom, riser sáng dần, đáp "uỳnh" mềm khi dừng
    d0, dur = INTRO["delay"], INTRO["dur"]
    sec = dur + 0.9
    n = ns(sec)
    tt = np.arange(n) / SR
    u = np.clip(tt / dur, 0, 1)
    speed = np.where(u < 0.5, 12 * u ** 2, 12 * (1 - u) ** 2) / 3          # đạo hàm ease, chuẩn về 0..1
    after = np.clip(1 - (tt - dur) / 0.35, 0, 1)                           # đuôi sau khi đáp
    whoosh = (nb(180, 900, sec) * (1 - u) + nb(450, 2200, sec) * np.sin(np.pi * u) + nb(1200, 4800, sec) * u * 0.45)
    whoosh *= (0.15 + 0.85 * speed) * np.minimum(tt / 0.25, 1) * np.where(tt < dur, 1.0, after)
    riser = nb(1800, 6500, sec) * u ** 3.2 * 0.4 * np.clip((dur + 0.03 - tt) / 0.03, 0, 1)
    sub = np.sin(2 * np.pi * np.cumsum(36 + 22 * u) / SR) * u ** 2 * 0.5 * np.where(tt < dur, 1.0, after ** 2)
    pans = np.interp(tt, [0, dur], [INTRO["yaw"] * 2, 0])                 # bắt đầu lệch theo yaw −0.3 → về giữa
    intro_bus.put_moving(fades(whoosh + riser + sub, 0.05, 0.1), d0, 1.0, pans)
    sec = 1.0
    n = ns(sec)
    land = damped(68, sec, 4.5, 45) * 0.7 + nb(60, 500, sec) * env(n, 0.004, 0.25, 4) * 0.55
    land += nb(700, 3000, sec) * env(n, 0.002, 0.08, 4) * 0.12
    intro_bus.put(fades(land, 0.001, 0.2), d0 + dur, 0.75, 0.0)
    EVENTS.append(f"intro zoom {d0:.3f}–{d0 + dur:.3f} (speed peak {d0 + dur / 2:.3f}), landing {d0 + dur:.3f}")

look_bus = Bus()
if LOOK:
    # nhìn quanh: gió lia mạnh theo tốc độ xoay (yaw/pitch), pan đi theo hướng nhìn
    l0, l1 = LOOK[0][0] - 0.05, LOOK[-1][0] + 0.35
    sec = l1 - l0
    n = ns(sec)
    tt = np.arange(n) / SR
    grid = np.arange(0, sec, 0.01)
    yp = np.array([demo_look(l0 + x) for x in grid])
    vel = np.hypot(np.gradient(yp[:, 0], 0.01), np.gradient(yp[:, 1], 0.01))
    vyaw = np.gradient(yp[:, 0], 0.01)
    sp = np.interp(tt, grid, vel / max(vel.max(), 1e-6))
    pan = np.interp(tt, grid, np.clip(yp[:, 0] / 0.66 * 0.6 + 0.35 * np.sign(vyaw) * vel / max(vel.max(), 1e-6), -1, 1))
    sp_s = np.convolve(sp, np.ones(ns(0.08)) / ns(0.08), "same")
    wl = (nb(220, 1100, sec) * 0.8 + nb(700, 2600, sec) * 0.5 * sp_s) * sp_s ** 1.3
    look_bus.put_moving(fades(wl, 0.05, 0.1), l0, 1.0, pan)
    moves = [(a[0], b[0], b[1] - a[1]) for a, b in zip(LOOK, LOOK[1:]) if (a[1], a[2]) != (b[1], b[2])]
    EVENTS.append("look: " + ", ".join(f"{a:.2f}→{b:.2f} ({'right' if d > 0 else 'left'})" for a, b, d in moves))


# ── port fx/jump.ts: hằng số đọc thẳng từ file, máy trạng thái chạy lại theo frame 60 fps ──
JUMP_TS = os.path.join(ROOT, "app", "src", "fx", "jump.ts")
JEV = []                                                             # (loại, t, dữ liệu)
JTRACK = []                                                          # (t, x màn hình, y màn hình) tâm bí khi bay vào/ra đảo
if TAPS and os.path.exists(JUMP_TS):
    JS = open(JUMP_TS).read()

    def _obj(name):
        txt = re.search(rf"export const {name}\s*=\s*\{{(.*?)\}};", JS, re.S).group(1)
        return {k: (json.loads(v) if v.startswith("[") else float(v))
                for k, v in re.findall(r"(\w+):\s*(\[[^\]]*\]|-?[\d.]+)", txt)}

    def _c(name):
        return float(re.search(rf"const {name}\s*=\s*(-?[\d.]+)", JS).group(1))

    J, IT, ISL = _obj("JUMP"), _obj("ISLAND_TIMING"), _obj("ISLAND")
    K_Q, C_Q, K_R, C_R, DX_RELAX = (_c(k) for k in ("K_Q", "C_Q", "K_R", "C_R", "DX_RELAX"))
    MINI_BODY, ASPECT = _c("MINI_BODY"), _c("PUMPKIN_ASPECT")
    if "x" not in ISL:                                               # ISLAND.x = (VIEW.w − ISLAND_W) / 2
        ISL["w"] = ISL.get("w", _c("ISLAND_W"))
        ISL["x"] = (VIEW_W - ISL["w"]) / 2
    ISL_CX, ISL_CY = ISL["x"] + ISL["w"] / 2, ISL["y"] + ISL["h"] / 2
    ARRIVE = IT["fly"]
    SHAKE_AT = ARRIVE + IT["hold"]
    SPIT_AT = SHAKE_AT + IT["shake"] + IT["squeeze"]
    TAU = 2 * math.pi
    G = J["gravity"]
    REST, CROUCH, AIR, GROUND, TO, ISLAND, FALL = range(7)
    clampf = lambda v, a, b: a if v < a else b if v > b else v
    smooth = lambda u: (lambda x: x * x * (3 - 2 * x))(clampf(u, 0, 1))
    nearest_turn = lambda a: math.floor(a / TAU + 0.5) * TAU
    S = dict(m=REST, last=0.0, h=0.0, vy=0.0, dx=0.0, vx=0.0, goal=0.0, rot=0.0, w=0.0, q=0.0, qv=0.0, combo=0,
             land=-10.0, bounces=0, crouchEnd=0.0, target=0.0, level=0, pending=False, dir=1, dropped=False,
             it=-1.0, ax=0.0, ay=0.0, arot=0.0, sMini=0.2, hap=0)

    def anchor(t):
        b = view_at(t)
        sx, sy = base_to_screen(b, *PUMPKIN_FOOT)
        ax, ay = base_to_screen(b, PUMPKIN_FOOT[0] + 10, PUMPKIN_FOOT[1])
        return sx, sy, PUMPKIN_W * math.hypot(ax - sx, ay - sy) / 10

    def start_island(s, t, A):
        ph = A[2] * ASPECT
        s.update(m=TO, it=t, ax=A[0] + s["dx"], ay=A[1] - s["h"] - ph / 2, arot=s["rot"],
                 sMini=clampf(MINI_BODY / max(1, A[2]), 0.02, 1), combo=0, pending=False, hap=0)
        s["qv"] += J["launchPop"]
        JEV.append(("island", t, dict(x=s["ax"], y=s["ay"])))

    def launch(s, t, A):
        if s["pending"]:
            start_island(s, t, A)
            return
        s["vy"] = math.sqrt(2 * G * s["target"])
        s["h"] = 0.0
        T = 2 * s["vy"] / G
        turns = J["spins"][min(s["level"], len(J["spins"]) - 1)]
        s["w"] = (nearest_turn(s["rot"]) + turns * TAU * s["dir"] - s["rot"]) / T if turns > 0 else \
            s["dir"] * (0.7 + s["level"] * 1.1) + (rng.random() - 0.5) * 0.9
        s.update(vx=(s["goal"] - s["dx"]) / T, qv=J["launchPop"], bounces=0, m=AIR)
        JEV.append(("launch", t, dict(level=s["level"], height=s["target"], x=A[0] + s["dx"])))

    def touch_down(s, t, A):
        vi = max(0.0, -s["vy"])
        first = s["bounces"] == 0
        strength = 1.0 if s["dropped"] and first else min(1.2, math.sqrt(vi * vi / (2 * G) / 400))
        s["h"] = 0.0
        s["rot"] -= nearest_turn(s["rot"])
        s["land"] = t
        JEV.append(("land", t, dict(vi=vi, strength=strength, impact=vi > J["impactMin"], big=s["dropped"] and first,
                                    x=A[0] + s["dx"])))
        s["qv"] -= J["squashK"] * math.sqrt(vi)
        s["w"] = s["w"] * 0.3 + (rng.random() - 0.5) * strength * 7
        s["bounces"] += 1
        vb = vi * (J["dropRestitution"] if s["dropped"] else J["restitution"])
        if vb > J["bounceMin"]:
            s["vy"] = vb
            s["goal"] *= 0.35
            s.update(vx=(s["goal"] - s["dx"]) / (2 * vb / G), m=AIR)
        else:
            s.update(vy=0.0, vx=0.0, goal=0.0, m=GROUND)

    def springs(s, h, grounded):
        s["qv"] += (-K_Q * s["q"] - C_Q * s["qv"]) * h
        s["q"] = clampf(s["q"] + s["qv"] * h, -0.38, 0.3)
        if grounded:
            s["w"] += (-K_R * s["rot"] - C_R * s["w"]) * h
            s["dx"] += -s["dx"] * (1 - math.exp(-DX_RELAX * h))
        s["rot"] += s["w"] * h

    def step(s, t, A):
        if s["m"] == REST:
            s["last"] = t
            return 0.0
        dt = t - s["last"]
        s["last"] = t
        if not dt > 0:
            return s["dx"]
        if dt > 0.05:
            dt = 1 / 60
        ph = A[2] * ASPECT
        ox = 0.0
        if s["m"] in (CROUCH, AIR, GROUND):
            n = max(1, math.ceil(dt * 240))
            h = dt / n
            for i in range(n):
                tt = t - dt + (i + 1) * h
                if s["m"] == CROUCH:
                    s["q"] += (J["crouchSquash"] - s["q"]) * (1 - math.exp(-45 * h))
                    s["qv"] = 0.0
                    s["w"] += (-K_R * s["rot"] - C_R * s["w"]) * h
                    s["rot"] += s["w"] * h
                    if tt >= s["crouchEnd"]:
                        launch(s, tt, A)
                    if s["m"] == TO:
                        break
                elif s["m"] == AIR:
                    s["vy"] -= G * h
                    s["h"] += s["vy"] * h
                    s["dx"] += s["vx"] * h
                    springs(s, h, False)
                    if s["h"] <= 0 and s["vy"] < 0:
                        touch_down(s, tt, A)
                else:
                    springs(s, h, True)
            if s["m"] == GROUND and abs(s["q"]) < 0.003 and abs(s["qv"]) < 0.08 and abs(s["rot"]) < 0.003 \
                    and abs(s["w"]) < 0.05 and abs(s["dx"]) < 0.25:
                s.update(m=REST, q=0.0, qv=0.0, rot=0.0, w=0.0, dx=0.0, dropped=False)
                JEV.append(("rest", t, {}))
            ox = s["dx"]
        if s["m"] == TO:
            u = clampf((t - s["it"]) / IT["fly"], 0, 1)
            e = u + 0.15 * math.sin(TAU * u)
            side = math.copysign(1, s["ax"] - ISL_CX) if abs(s["ax"] - ISL_CX) > 8 else s["dir"]
            p1x, p1y = s["ax"] + side * 85, ISL_CY + (s["ay"] - ISL_CY) * 0.3
            a, b, c = (1 - e) ** 2, 2 * (1 - e) * e, e * e
            cx, cy = a * s["ax"] + b * p1x + c * ISL_CX, a * s["ay"] + b * p1y + c * ISL_CY
            JTRACK.append((t, cx, cy))
            ox = cx - A[0]
            if u >= 1:
                s.update(m=ISLAND, rot=0.0)
                JEV.append(("arrive", t, {}))
        elif s["m"] == ISLAND:
            tau = t - s["it"]
            ox = ISL_CX - A[0]
            if s["hap"] == 0 and tau >= ARRIVE + 0.14:
                s["hap"] = 1
                JEV.append(("success", t, {}))
            if s["hap"] == 1 and tau >= SHAKE_AT:
                s["hap"] = 2
                JEV.append(("shake", t, {}))
            if tau >= SPIT_AT:
                s.update(m=FALL, hap=3, dropped=True)
                JEV.append(("spit", t, {}))
        if s["m"] == FALL:
            tf = max(0.0, t - (s["it"] + SPIT_AT))
            rest_cy = A[1] - ph / 2
            H = max(1.0, rest_cy - ISL_CY)
            v0 = J["dropV0"]
            T = (-v0 + math.sqrt(v0 * v0 + 2 * G * H)) / G
            cy = ISL_CY + v0 * tf + 0.5 * G * tf * tf
            cx = ISL_CX + (A[0] - ISL_CX) * smooth(tf / T)
            JTRACK.append((t, cx, min(cy, rest_cy)))
            ox = cx - A[0]
            if cy >= rest_cy:
                s.update(m=AIR, h=0.0, dx=0.0, goal=0.0, vy=-(v0 + G * tf), rot=0.0, w=s["dir"] * 2.0, bounces=0)
                touch_down(s, t, A)
                ox = 0.0
        return ox

    def tap(s, x, t, A):
        if s["m"] in (TO, ISLAND, FALL) or s["dropped"]:
            JEV.append(("tap_ignored", t, {}))
            return
        chain = s["m"] in (AIR, CROUCH) or t - s["land"] < J["comboWindow"]
        s["combo"] = s["combo"] + 1 if chain else 1
        hs = J["heights"]
        s["level"] = min(s["combo"] - 1, len(hs) - 1)
        s["target"] = hs[s["level"]] * (1.15 if s["combo"] > len(hs) else 1)
        s["dir"] = 1 if x < A[0] + s["dx"] else -1
        s["goal"] = clampf(s["goal"] + s["dir"] * J["drift"] * (1 + s["level"] * 0.6), -J["maxDrift"], J["maxDrift"])
        if s["last"] == 0:
            s["last"] = t
        apex = s["h"] + max(0, s["vy"]) ** 2 / (2 * G) if s["m"] == AIR else 0
        to_island = s["combo"] >= J["islandTaps"] or s["target"] > J["islandHeight"] or apex > J["islandHeight"]
        JEV.append(("tap", t, dict(combo=s["combo"], mode=s["m"], to_island=to_island)))
        if s["m"] == AIR:
            if to_island:
                start_island(s, t, A)
            else:
                need = max(s["target"] - s["h"], J["minKick"])
                s["vy"] = max(s["vy"], math.sqrt(2 * G * need))
                T = (s["vy"] + math.sqrt(max(0, s["vy"] ** 2 + 2 * G * s["h"]))) / G
                s["vx"] = (s["goal"] - s["dx"]) / T
                turns = J["spins"][min(s["level"], len(J["spins"]) - 1)]
                if turns > 0:
                    s["w"] = (nearest_turn(s["rot"]) + turns * TAU * s["dir"] - s["rot"]) / T
                else:
                    s["w"] += s["dir"] * (1.2 + s["level"])
                s["qv"] += J["kickPop"]
                s["bounces"] = 0
                JEV.append(("kick", t, dict(level=s["level"], x=A[0] + s["dx"])))
        elif s["m"] == CROUCH:
            if to_island:
                s["pending"] = True
        else:
            s.update(m=CROUCH, crouchEnd=t + (J["crouch"] if s["combo"] == 1 else J["crouchCombo"]), pending=to_island,
                     vy=0.0, h=0.0)

    # vòng frame: callback (đặt anchor, ngón tay chạm) rồi reaction step(t) cùng frame
    ti, off_x = 0, 0.0
    for f in range(int((TAPS[0] - 0.1) * FPS), int(DUR * FPS)):
        t = f / FPS
        if ti >= len(TAPS) and S["m"] == REST:                       # đã nghỉ hẳn sau lần chạm cuối
            break
        A = anchor(t)
        if ti < len(TAPS) and t >= TAPS[ti]:
            tap(S, A[0] + off_x + (18 if ti % 2 else -14), t, A)
            ti += 1
        off_x = step(S, t, A)
    JUMP_OK = True
else:
    JUMP_OK = False
    if TAPS:
        print("WARN: thiếu app/src/fx/jump.ts — bỏ qua tiếng bí nhảy")

jump_bus = Bus()


def j_at(kind):
    return [(t, d) for k, t, d in JEV if k == kind]


def knock(f=210.0):
    """gõ vào vỏ bí rỗng: 'tọc' gỗ có khoang ngân"""
    sec = 0.3
    n = ns(sec)
    x = damped(f, sec, 14, f * 0.9) * 0.8 + damped(f * 2.6, sec, 32) * 0.25
    x += nb(600, 3000, sec) * env(n, 0.0005, 0.012, 5) * 0.5
    return fades(x * np.minimum(np.arange(n) / (0.0005 * SR), 1), 0.0005, 0.02)


def boing(level, sec=0.42):
    """lò xo co giãn: cao độ vút nhẹ lên rồi rung lắc tắt dần — dễ thương, ấm (lọc dưới 2.5 kHz)"""
    n = ns(sec)
    t = np.arange(n) / SR
    f0 = 150 * 1.22 ** level
    f = f0 * (0.78 + 0.42 * (1 - np.exp(-t * 16))) * (1 + 0.13 * np.sin(2 * np.pi * 11 * t) * np.exp(-t * 4))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.1 * np.sin(3 * ph)) * env(n, 0.004, sec * 0.8, 4)
    return fades(band(x, 80, 2500), 0.002, 0.03)


def porch_thud(strength, big=False):
    """bí đáp xuống ván hiên: 'thịch' ván gỗ + thân bí, cú lớn thêm trầm 'uỳnh'"""
    sec = 1.0 if big else 0.55
    n = ns(sec)
    x = damped(80, sec, 9, 58) + damped(165, sec, 16) * 0.45 + damped(230, sec, 22, 200) * 0.3
    x += nb(60, 900, sec) * env(n, 0.002, 0.08, 4) * 0.7 + nb(300, 1500, sec) * env(n, 0.003, 0.15, 4) * 0.22
    if big:
        x += damped(48, sec, 4, 38) * 0.9 + nb(40, 300, sec) * env(n, 0.003, 0.3, 4) * 0.6
    return fades(x * np.minimum(np.arange(n) / (0.0006 * SR), 1), 0.0006, 0.1)


def leaves(strength):
    """lá khô quanh chân bí lạo xạo: các hạt nhiễu khô 1.5–6 kHz, dày lúc đầu rồi thưa"""
    sec = 0.5
    n = ns(sec)
    x = np.zeros(n)
    for _ in range(int(8 + 34 * min(strength, 1.2))):
        k = int(min(rng.exponential(0.09), 0.45) * SR)
        m = ns(rng.uniform(0.004, 0.012))
        if k + m < n:
            x[k:k + m] += nb(1500, 6000, m / SR) * np.exp(-np.arange(m) / (0.3 * m)) * rng.uniform(0.3, 1.0)
    return fades(x, 0.0005, 0.05)


def bell(f, sec=0.5, decay=7.0):
    n = ns(sec)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * decay) + 0.25 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t * decay * 2.5)
    return fades(x * np.minimum(t / 0.002, 1), 0.0, 0.03)


if JUMP_OK:
    for t, d in j_at("launch"):
        p = pan_x(d["x"], 1.2)
        jump_bus.put(knock(215 + 25 * d["level"]), t - 0.03, 0.45, p)          # ngón tay chạm/ép vỏ lúc nhún
        jump_bus.put(boing(d["level"]), t, 0.32 + 0.06 * d["level"], p)
        sec = 0.18
        jump_bus.put(nb(70, 420, sec) * env(ns(sec), 0.004, 0.08, 4), t, 0.35, p)  # 'phụp' rời đất
    for t, d in j_at("kick"):
        p = pan_x(d["x"], 1.2)
        jump_bus.put(knock(265 + 20 * d["level"]), t, 0.35, p)
        jump_bus.put(boing(d["level"] + 1, 0.3), t, 0.24, p)
    for t, d in j_at("land"):
        p = pan_x(d["x"], 1.2)
        s = d["strength"]
        if d["big"]:
            jump_bus.put(porch_thud(1.2, True), t, 1.0, p)
            jump_bus.put(leaves(1.2), t + 0.005, 0.5, p)
        else:
            jump_bus.put(porch_thud(s), t, 0.18 + 0.75 * s, p)
            jump_bus.put(leaves(s), t + 0.004, 0.12 + 0.35 * s, p)
    isl = j_at("island")
    if isl:
        it = isl[0][0]
        x0 = isl[0][1]["x"]
        # vút lên: gió + còi trượt lên, nhanh – lơ lửng giữa chừng – bị hút (theo e = u + 0.15·sin 2πu)
        sec = ARRIVE
        n = ns(sec)
        tt = np.arange(n) / SR
        u = tt / sec
        de = np.clip(1 + 0.3 * np.pi * np.cos(2 * np.pi * u), 0.1, None) / (1 + 0.3 * np.pi)
        wh = (nb(300, 1400, sec) * (1 - u) + nb(900, 4000, sec) * u) * (0.35 + 0.65 * de) * np.minimum(tt / 0.04, 1)
        slide = np.sin(2 * np.pi * np.cumsum(260 * 5 ** (u ** 1.1) * (1 + 0.012 * np.sin(2 * np.pi * 6 * tt))) / SR)
        slide *= np.sin(np.pi * np.clip(u * 1.05, 0, 1)) ** 0.7 * 0.35
        pans = np.interp(tt, [x - it for x, _, _ in JTRACK if it <= x <= it + ARRIVE] or [0],
                         [pan_x(cx, 1.2) for x, cx, _ in JTRACK if it <= x <= it + ARRIVE] or [0])
        jump_bus.put(boing(4, 0.35), it, 0.3, pan_x(x0, 1.2))
        jump_bus.put_moving(fades(wh * 0.6 + slide, 0.005, 0.03), it, 0.6, pans)
        arrive = j_at("arrive")[0][0]
        # 'bloop' bị hút vào đảo: sin trượt 260→900 Hz rất nhanh + bọt 'póc'
        sec = 0.22
        n = ns(sec)
        tt = np.arange(n) / SR
        bl = np.sin(2 * np.pi * np.cumsum(260 * 3.5 ** np.clip(tt / 0.07, 0, 1)) / SR) * env(n, 0.003, 0.14, 4)
        bl += damped(1250, sec, 45) * 0.3 + nb(400, 2500, sec) * env(n, 0.0005, 0.01, 5) * 0.3
        jump_bus.put(fades(bl, 0.0005, 0.03), arrive, 0.55, 0.0)
        # lấp lánh khi pill nở (Live Activity): hạt chuông ngũ cung Rê thứ cao + một lớp ngân run nhẹ
        shake_t = j_at("shake")[0][0]
        hold = shake_t - arrive
        tc = arrive + 0.05
        notes = [1174.7, 1396.9, 1568.0, 1760.0, 2093.0, 2349.3]
        while tc < shake_t + 0.1:
            jump_bus.put(bell(float(rng.choice(notes)), 0.6, rng.uniform(5, 9)), tc, rng.uniform(0.07, 0.15), rng.uniform(-0.35, 0.35))
            tc += rng.exponential(1 / 14)
        sec = hold + 0.5
        n = ns(sec)
        tt = np.arange(n) / SR
        sh = sum(np.sin(2 * np.pi * f * tt + rng.random() * 6) for f in (1174.7, 1760.0, 2349.3)) / 3
        sh *= (1 + 0.35 * np.sin(2 * np.pi * 6.5 * tt)) * np.clip(tt / 0.3, 0, 1) * np.clip((sec - tt) / 0.5, 0, 1)
        jump_bus.put(fades(sh, 0.01, 0.05), arrive, 0.09, 0.0)
        for t, _ in j_at("success"):                                    # 'ting' xác nhận khi pill nở xong
            jump_bus.put(bell(1760.0, 0.9, 4.5) + bell(2349.3, 0.9, 5) * 0.6, t, 0.12, 0.1)
        # rung lắc trước khi nhả: 'bừbừ' như thạch rung + nén lại kêu chít lên
        sec = IT["shake"] + IT["squeeze"]
        n = ns(sec)
        tt = np.arange(n) / SR
        wob = np.sin(2 * np.pi * np.cumsum(170 + 60 * tt / sec) / SR) * (0.55 + 0.45 * np.sin(2 * np.pi * 15 * tt))
        wob = band(wob, 90, 1500) * np.minimum(tt / 0.04, 1)
        sq = np.sin(2 * np.pi * np.cumsum(480 * 2.3 ** np.clip((tt - IT["shake"]) / IT["squeeze"], 0, 1)) / SR)
        sq *= np.clip((tt - IT["shake"]) / 0.02, 0, 1) * 0.5
        jump_bus.put(fades(wob * 0.5 + sq, 0.005, 0.01), shake_t, 0.3, 0.0)
        # 'phụt' nhả ra + còi huýt rơi tới lúc chạm đất
        spit = j_at("spit")[0][0]
        sec = 0.25
        n = ns(sec)
        tt = np.arange(n) / SR
        pt = np.sin(2 * np.pi * np.cumsum(750 * (0.32 ** np.clip(tt / 0.12, 0, 1))) / SR) * env(n, 0.002, 0.12, 4)
        pt += nb(300, 2600, sec) * env(n, 0.001, 0.05, 5) * 0.6
        jump_bus.put(fades(pt, 0.0005, 0.03), spit, 0.6, 0.0)
        big = [t for t, d in j_at("land") if d["big"]][0]
        sec = big - spit
        n = ns(sec)
        tt = np.arange(n) / SR
        u = tt / sec
        wf = np.sin(2 * np.pi * np.cumsum(1700 * (0.27 ** u) * (1 + 0.01 * np.sin(2 * np.pi * 5 * tt))) / SR)
        wf *= np.clip(tt / 0.04, 0, 1) * (0.6 + 0.4 * u) * np.clip((sec - tt) / 0.015, 0, 1)
        trk = [(x - spit, pan_x(cx, 1.2)) for x, cx, _ in JTRACK if x >= spit]
        pans = np.interp(tt, [a for a, _ in trk] or [0], [b for _, b in trk] or [0])
        jump_bus.put_moving(wf + nb(500, 2500, sec) * u ** 2 * 0.25, spit, 0.3, pans)
    taps_ign = [t for t, _ in j_at("tap_ignored")]
    EVENTS.append("taps: " + ", ".join(f"{t:.3f}(combo {d['combo']}{', →island' if d['to_island'] else ''})" for t, d in j_at("tap")) +
                  (f"; ignored {', '.join(f'{t:.2f}' for t in taps_ign)}" if taps_ign else ""))
    EVENTS.append("launches: " + ", ".join(f"{t:.3f}(h{d['height']:.0f})" for t, d in j_at("launch")) +
                  "; kicks: " + ", ".join(f"{t:.3f}" for t, _ in j_at("kick")))
    EVENTS.append("landings: " + ", ".join(f"{t:.3f}(v{d['vi']:.0f}, s{d['strength']:.2f}{', BIG' if d['big'] else ''})"
                                         for t, d in j_at("land")))
    EVENTS.append("island: " + ", ".join(f"{k} {t:.3f}" for k, t, _ in JEV if k in ("island", "arrive", "success", "shake", "spit", "rest")))
# hết tiếng nhảy (lần chạm đất cuối), không lấn sang que diêm — dùng cho tự động hoá âm lượng nhạc
JUMP_END = min(max([t for k, t, _ in JEV if k == "land"] or [0.0]), MATCH_AT - 0.8)


# ═════════════════════════ 7. NHẠC: hook celesta ma quái-vui trên groove lo-fi/trap Halloween, Rê thứ 100 BPM ═════════════════════════
# Tự tổng hợp hoàn toàn (không mẫu). Lưới nhịp neo vào nến bùng: nhịp 1 của ô 0 = CANDLE_AT (DROP). 100 BPM → ô 2.4 s →
# dơi (DEMO.bats − nến ≈ 4.8 s) rơi đúng nhịp 1 ô 2, end card (≈ dơi + 6.0 s) rơi đúng phách 3 ô 4 (END_AT).
# Vòng 4 ô: Dm – B♭ – Gm – A7 (i–VI–iv–V). Hook: 'Rê–Fa–La, Son♯-La' (nốt luyến Son♯ = ma quái mà vui), lặp 2 lần mỗi vòng.
#   ô −8 (sau tia sét): hook hộp nhạc một mình, lọc tối như đài cũ · −7 (khắc): + kick mềm + bass ấm · −6…−2: + snap 2&4,
#   hi-hat swing, pad lo-fi, lọc mở dần · −1 (que diêm, A7): bỏ kick, snap dồn 8 → 16, riser → CẮT GỌN đúng tiếng công
#   tắc (LIT_AT) · 0.39 s nín thở (chỉ một hơi ngược rất nhỏ) · DROP ô 0 = nến bùng: boom 808 + kick + clap + crash + pad,
#   hook đầy (bè quãng tám dưới), 808 lượn, hat trap có roll · ô 2–3 (dơi): thêm bè chuông quãng tám trên · ô 4: fill 2
#   phách → END_AT: hit kết Rê trưởng (808 + celesta rải + pad) ngân ~2.5 s rồi tắt gọn.
mrng = np.random.default_rng(1313)
db = lambda x: 10 ** (x / 20)
BPM = 100.0
BEAT = 60 / BPM
BAR = 4 * BEAT
DROP = CANDLE_AT
SWING = 0.05 * BEAT
FIRST_BAR = -int(math.floor((DROP - 0.3) / BAR))
END_AT = DROP + 4 * BAR + 2 * BEAT


def at_(bar, beat):
    return DROP + bar * BAR + beat * BEAT + (SWING if abs(beat % 1 - 0.5) < 1e-6 else 0.0)


def mnoise(n, lo, hi):
    x = band(mrng.standard_normal(n), lo, hi)
    return x / (x.std() + 1e-12)


def tine(midi, sec=1.8, vel=1.0, bright=1.0):
    """hộp nhạc/celesta: cơ bản + hài 2, 3 tắt nhanh + partial lệch (răng lược kim loại); 2 bè lệch ±3 cent → ấm"""
    n = ns(sec)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for d in (-0.0017, 0.0017):
        f = hz(midi) * (1 + d)
        x += np.sin(2 * np.pi * f * t) * np.exp(-t * 2.4)
        x += 0.25 * bright * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 6)
        x += 0.08 * bright * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 10)
        x += 0.05 * bright * np.sin(2 * np.pi * 5.43 * f * t) * np.exp(-t * 24)
    return fades(x * 0.5 * np.minimum(t / 0.0015, 1) * vel, 0.0, 0.05)


def kick(sec=0.45, f0=150, f1=50, dec=8.0, click=0.12, drive=1.6):
    n = ns(sec)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.03)
    x = np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * dec) * drive) / np.tanh(drive)
    x += mnoise(n, 1200, 5000) * np.exp(-t / 0.0025) * click
    return fades(x, 0.0005, 0.02)


def b808(midi, sec, glide_to=None, drive=2.4, dec=1.1):
    """808 ấm: sin có 'đấm' cao độ đầu nốt, bão hoà mềm (thêm hài để loa điện thoại vẫn nghe thấy), lượn cuối nốt"""
    n = ns(sec)
    t = np.arange(n) / SR
    f = np.full(n, hz(midi)) * (1 + 0.5 * np.exp(-t / 0.015))
    if glide_to is not None:
        u = np.clip((t - sec * 0.55) / (sec * 0.35), 0, 1)
        f *= (hz(glide_to) / hz(midi)) ** (u * u * (3 - 2 * u))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * dec / sec) * np.minimum(t / 0.004, 1)
    x = np.tanh(x * drive) / np.tanh(drive)
    return fades(band(x, 25, 1800), 0.0, 0.06)


def clap(sec=0.4, tail=0.085):
    n = ns(sec)
    x = np.zeros(n)
    for k, dt in enumerate((0, 0.009, 0.017, 0.025)):
        i = ns(dt)
        tt = np.arange(n - i) / SR
        x[i:] += mnoise(n - i, 900, 6500) * np.exp(-tt / (0.004 if k < 3 else tail)) * (0.7 if k < 3 else 1.0)
    return fades(band(x, 700, 7000), 0.0003, 0.03)


def snap(vel=1.0):
    n = ns(0.12)
    t = np.arange(n) / SR
    x = mnoise(n, 1600, 6500) * np.exp(-t / 0.011) + np.sin(2 * np.pi * 1850 * t) * np.exp(-t / 0.008) * 0.5
    return fades(x * vel, 0.0002, 0.02)


def hat(vel=1.0, dec=0.022):
    n = ns(dec * 6)
    t = np.arange(n) / SR
    return fades(mnoise(n, 5200, 8800) * np.exp(-t / dec) * vel, 0.0002, 0.01)


def mpad(midis, sec, att=0.25, rel=0.8):
    n = ns(sec)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for m in midis:
        for d in (-0.004, 0.0, 0.005):
            ph = 2 * np.pi * hz(m) * (1 + d) * t + mrng.random() * 6
            x += np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.06 * np.sin(3 * ph)
    e = np.minimum(t / att, 1) * np.clip((sec - t) / rel, 0, 1)
    return band(x * e / (len(midis) * 3), 80, 3500)


HOOK = {
    0: [(0, 74), (0.5, 77), (1, 81), (1.75, 80), (2, 81), (3, 77), (3.5, 76)],             # Dm   Rê Fa La Son♯ La . Fa Mi
    1: [(0, 74), (0.5, 77), (1, 82), (1.75, 81), (2, 79), (3, 77), (3.5, 74)],             # B♭   Rê Fa Si♭ La Son . Fa Rê
    2: [(0, 74), (0.5, 77), (1, 81), (1.75, 80), (2, 81), (3, 84), (3.5, 82)],             # Gm   Rê Fa La Son♯ La . Đô Si♭
    3: [(0, 81), (0.5, 79), (1, 77), (1.5, 76), (2, 73), (2.5, 76), (3, 79), (3.5, 76)],   # A7   La Son Fa Mi Đô♯ Mi Son Mi
}
ROOTS = [50, 46, 43, 45]
CHORD = {0: [50, 57, 62, 65], 1: [46, 53, 62, 65], 2: [43, 55, 62, 70], 3: [45, 52, 61, 67]}
hook, hook_hi, drums, bass_b, pad_b, mfx = Bus(), Bus(), Bus(), Bus(), Bus(), Bus()
kicks = []


def hit_kick(t, g=1.0, **kw):
    drums.put(kick(**kw), t, g, 0.0)
    kicks.append(t)


for bar in range(FIRST_BAR, 4):
    q = bar % 4
    pre = bar < 0
    root = ROOTS[q]
    for beat, m in HOOK[q]:
        t = at_(bar, beat)
        if pre and t >= LIT_AT - 0.02:
            continue
        v = (0.6 if pre else 1.0) * (1.0 if beat % 1 == 0 else 0.82)
        hook.put(tine(m, 1.6 if pre else 1.9, v), t, 1.0, 0.1 * ((m % 7) - 3) / 3)
        if not pre:
            hook.put(tine(m - 12, 1.9, v * 0.5, 0.6), t + 0.003, 1.0, 0.0)
            if bar >= 2:
                hook_hi.put(tine(m + 12, 1.1, v * 0.32, 0.5), t + 0.006, 1.0, 0.4 if beat % 1 else -0.4)
    if pre and bar < -1:
        if bar >= FIRST_BAR + 1:                                     # kick mềm lo-fi + bass ấm
            for beat, g in ((0, 1.0), (2.5, 0.8)) + (((1.75, 0.45),) if bar >= -5 else ()):
                hit_kick(at_(bar, beat), 0.55 * g, f0=120, f1=52, dec=10, click=0.05, drive=1.2)
            for beat, mm, ln in ((0, root - 12, 1.6), (2.5, root - 12, 0.8), (3.5, root - 5, 0.4)):
                bass_b.put(b808(mm, ln * BEAT + 0.1, drive=1.4, dec=2.2), at_(bar, beat), 0.32, 0.0)
        if bar >= FIRST_BAR + 2:                                     # snap 2&4 + hat swing + pad lo-fi
            for beat in (1, 3):
                drums.put(snap(), at_(bar, beat), 0.32, 0.05)
            for k in range(8):
                drums.put(hat(0.6 if k % 2 == 0 else 0.35), at_(bar, k / 2), 0.16, 0.3 if k % 2 else -0.3)
            pad_b.put(mpad(CHORD[q], BAR + 0.4, 0.5, 0.6), at_(bar, 0), 0.10, 0.0)
    elif bar == -1:                                                  # que diêm: dồn nén, cắt gọn ở công tắc
        hit_kick(at_(bar, 0), 0.55, f0=120, f1=52, dec=10, click=0.05, drive=1.2)
        bass_b.put(b808(root - 12, LIT_AT - at_(bar, 0), drive=1.4, dec=0.8), at_(bar, 0), 0.32, 0.0)
        for k in range(14):
            bt = k * 0.25 if k >= 8 else k * 0.5 * (8 / 8)
            bt = k * 0.5 if k < 4 else 2 + (k - 4) * 0.25
            t = at_(bar, bt)
            if t < LIT_AT - 0.03:
                drums.put(snap(), t, 0.18 + 0.2 * k / 13, 0.05)
        for k in range(16):
            t = at_(bar, k / 4)
            if t < LIT_AT - 0.03:
                drums.put(hat(0.3 + 0.5 * k / 15), t, 0.15, 0.3 if k % 2 else -0.3)
        sec = LIT_AT - at_(bar, 0)
        n = ns(sec)
        u = np.arange(n) / n
        riser = (mnoise(n, 400, 1500) * (1 - u) + mnoise(n, 1200, 4000) * u + mnoise(n, 3000, 7000) * u ** 2 * 0.5) * u ** 2.2
        riser += np.sin(2 * np.pi * np.cumsum(220 * 4 ** u) / SR) * u ** 2 * 0.25
        mfx.put(riser, at_(bar, 0), 0.10, 0.0)
    else:                                                            # DROP: trap-lite
        for beat in (0, 1.75, 2.5):
            hit_kick(at_(bar, beat), 1.0)
        for beat, ln in ((0, 1.6), (1.75, 0.6), (2.5, 1.45)):
            glide = (ROOTS[(q + 1) % 4] - 12) if (q == 3 and beat == 2.5) else None
            bass_b.put(b808(root - 12, ln * BEAT + 0.05, glide_to=glide), at_(bar, beat), 0.6, 0.0)
        for beat in (1, 3):
            drums.put(clap(), at_(bar, beat), 0.42, 0.0)
        steps = [k / 2 for k in range(8)]
        if q in (0, 2):
            steps += [2.25, 2.75]
        if q in (1, 3):
            steps = [s_ for s_ in steps if s_ < 3.5] + [3.5 + k / 6 for k in range(3)]
        for k, bt in enumerate(sorted(steps)):
            drums.put(hat(0.75 if bt % 1 == 0 else 0.5), at_(bar, bt) if bt % 0.5 == 0 else DROP + bar * BAR + bt * BEAT,
                      0.22, 0.3 if k % 2 else -0.3)
        pad_b.put(mpad(CHORD[q], BAR + 0.5, 0.06 if bar == 0 else 0.3, 0.5), at_(bar, 0), 0.22, 0.0)
        if bar in (0, 2):                                            # crash nhỏ (dải ≤ 8.5 kHz, không chói)
            n = ns(1.6)
            tt = np.arange(n) / SR
            mfx.put(mnoise(n, 2500, 8500) * np.exp(-tt / 0.45) * np.minimum(tt / 0.002, 1), at_(bar, 0), 0.07, 0.0)
# boom 808 + 'hơi ngược' rất nhỏ trong 0.39 s tối đen
bass_b.put(b808(26, 1.6, drive=3.0, dec=1.6), DROP, 0.5, 0.0)
sec = DROP - LIT_AT - 0.03
rev = sum(tine(m, sec, 0.6) for m in (62, 65, 69))[::-1] * np.linspace(0, 1, ns(sec)) ** 2
mfx.put(rev, DROP - sec - 0.005, 0.25, 0.0)
# ô 4: fill 2 phách (hook kết câu + roll hat + 808 giữ) → hit kết Rê trưởng ở END_AT
for beat, m in ((0, 74), (0.5, 77), (1, 81), (1.5, 80)):
    hook.put(tine(m, 1.2, 0.9), at_(4, beat), 1.0, 0.0)
    hook.put(tine(m - 12, 1.2, 0.45, 0.6), at_(4, beat) + 0.003, 1.0, 0.0)
hit_kick(at_(4, 0), 1.0)
bass_b.put(b808(38, 2 * BEAT), at_(4, 0), 0.6, 0.0)
drums.put(clap(), at_(4, 1), 0.42, 0.0)
for k in range(6):
    drums.put(hat(0.4 + 0.1 * k), DROP + 4 * BAR + (1 + k / 6) * BEAT, 0.22, 0.3 if k % 2 else -0.3)
hit_kick(END_AT, 1.0)
drums.put(clap(0.6, 0.15), END_AT, 0.45, 0.0)
bass_b.put(b808(38, 2.2, drive=2.0, dec=2.6), END_AT, 0.6, 0.0)
for j, m in enumerate((62, 66, 69, 74, 78, 81)):
    hook.put(tine(m, 2.6, 0.95 - 0.08 * j), END_AT + j * 0.055, 1.0, -0.35 + 0.14 * j)
pad_b.put(mpad([50, 57, 62, 66], 2.8, 0.05, 1.6), END_AT, 0.22, 0.0)
n = ns(2.2)
tt = np.arange(n) / SR
mfx.put(mnoise(n, 2500, 8500) * np.exp(-tt / 0.5) * np.minimum(tt / 0.002, 1), END_AT, 0.07, 0.0)

# hook trước drop: lọc tối (đài cũ) ô đầu, mở dần; ô −1 mở hết theo riser; drop: sáng hẳn
h = hook.stereo()
h_dark = np.stack([band(h[:, c], 150, 1700) for c in range(2)], 1)
h_full = np.stack([band(h[:, c], 90, 8000) for c in range(2)], 1)
op = ramp([(0, 0), (at_(FIRST_BAR + 1, 0), 0), (at_(-5, 0), 0.65), (at_(-1, 0), 0.65), (LIT_AT, 1.0), (DUR, 1.0)])[:, None]
h = h_dark * (1 - op) * 1.25 + h_full * op
# kick bơm pad + vang (sidechain kiểu trap) sau drop
pump = np.ones(N)
for tk in kicks:
    if tk >= DROP - 0.01:
        i = ns(tk)
        m = min(ns(0.4), N - i)
        pump[i:i + m] *= 1 - 0.5 * np.exp(-np.arange(m) / (0.11 * SR))
pads = pad_b.stereo() * pump[:, None]
wet_src = h * 0.8 + hook_hi.stereo() + pads * 0.5 + drums.stereo() * 0.25
music_abs = h + hook_hi.stereo() + pads + drums.stereo() + bass_b.stereo() + mfx.stereo()
music_abs = music_abs + reverb(wet_src, 2.2, 6000, 11) * 0.42 * pump[:, None]
# nín thở: cắt gọn mọi thứ (kể cả đuôi vang) đúng tiếng công tắc, trừ hơi ngược; sau END_AT tắt gọn trong ~3 s
gate = ramp([(0, 1), (LIT_AT - 0.012, 1), (LIT_AT + 0.004, 0), (DROP - 0.002, 0), (DROP, 1), (DUR, 1)])
rev_part = np.zeros((N, 2))
i0, i1 = ns(LIT_AT), ns(DROP)
rev_part[i0:i1] = mfx.stereo()[i0:i1]
music_abs = music_abs * gate[:, None] + rev_part
music_abs *= np.clip((END_AT + 3.2 - t_all) / 1.0, 0, 1)[:, None]
music_abs = np.stack([band(music_abs[:, c], 28, 9500) for c in range(2)], 1)
_w = (ns(DROP + 0.3), ns(DROP + 2 * BAR))
MUSIC_DROP_DB = -15.5                                                # mức nhạc lúc drop (dBFS RMS, trước master)
music_abs *= db(MUSIC_DROP_DB) / float(np.sqrt((music_abs[_w[0]:_w[1]] ** 2).mean()))
EVENTS.append(f"music: {BPM:.0f} BPM, bar {BAR:.2f}s, first bar {FIRST_BAR} @ {at_(FIRST_BAR, 0):.3f}, cut {LIT_AT:.3f}, "
              f"DROP {DROP:.3f}, bats bar 2 @ {at_(2, 0):.3f} (bats {BATS_AT:.3f}), END hit {END_AT:.3f}")


# ═════════════════════════ 8. TRỘN ═════════════════════════
def rms(st):
    return float(np.sqrt((st ** 2).mean()))


# chuẩn hoá từng stem rồi đặt mức tương đối (đỉnh cho tiếng động, RMS cho lớp nền)
stems = {
    "carve": 0 * t_all[:, None],                                     # khắc: trộn sau, theo mức tuyệt đối (mục 8b)
    "match": norm_peak(match.stereo(), 0.6),
    "fire": norm_peak(fire.stereo(), 1.0),                           # tiếng phừng là đỉnh lớn nhất clip
    "candle": None,
    "air": norm_peak(air_bus.stereo(), 0.1),
    "bats": 0 * t_all[:, None],                                      # dơi: trộn sau theo mức tuyệt đối (mục 5)
    "squeak": 0 * t_all[:, None],
    "intro": norm_peak(intro_bus.stereo(), 0.28) if INTRO else 0 * t_all[:, None],
    "look": norm_peak(look_bus.stereo(), 0.16) if LOOK else 0 * t_all[:, None],
    "jump": norm_peak(jump_bus.stereo(), 0.8) if JUMP_OK else 0 * t_all[:, None],
    "music": None,
}
cs = candle.stereo()
cs_roar = cs[int((CANDLE_AT + 1.5) * SR):]
stems["candle"] = cs * (0.024 / rms(cs_roar))                        # lửa nến: lớp nền nhẹ dưới nhạc
wind = wind_st * (0.016 / rms(wind_st))
crickets = norm_peak(cricket_st, 0.05) * 0.0                         # giông: dế không kêu dưới mưa to → bỏ (giữ code cho v2)
owl_n = norm_peak(owl_st, 0.035)
hum_n = hum.stereo() * (0.0025 / max(rms(hum.stereo()[: int(9 * SR)]), 1e-9))
# nền đêm hạ còn ~30% trong 0.39 s tối đen, nở lại theo nến; thấp hơn chút dưới đàn dơi
amb_auto = ramp([(0, 1), (LIT_AT, 1), (LIT_AT + 0.08, 0.3), (CANDLE_AT, 0.3), (CANDLE_AT + 0.6, 1.0),
                 (BATS_AT, 1.0), (BATS_AT + 0.4, 0.7), (BATS_AT + 3.2, 1.0), (DUR, 1.0)])
ambience = (wind + crickets + hum_n) * amb_auto[:, None] + owl_n
music_n = 0 * t_all[:, None]                                         # nhạc: trộn ở mức tuyệt đối (mục 10)
# lửa nến hạ chút dưới dơi
stems["candle"] *= ramp([(0, 1), (BATS_AT, 1), (BATS_AT + 0.5, 0.6), (BATS_AT + 3.4, 0.9), (DUR, 0.9)])[:, None]

fx = sum(v for k, v in stems.items() if v is not None)
fx = fx + reverb(fx, 1.2, 5000, 2) * 0.16                            # hiên nhà ngoài trời: vang ngắn, nhẹ
owl_wet = reverb(owl_n, 2.2, 3000, 3) * 0.5
mix = fx + music_n + ambience + owl_wet

# bỏ DC + rền dưới 25 Hz, mềm dải > 11 kHz (không chói)
mix = np.stack([band(mix[:, c], 25, 11000) for c in range(2)], 1)
# kết: mờ dần 1.5 s cuối; vào: 20 ms
fade = np.minimum(np.minimum(t_all / 0.02, 1), np.clip((DUR - t_all) / 1.5, 0, 1) ** 1.5)
mix *= fade[:, None]
# giới hạn mềm phần trên 0.7 (chỉ đỉnh phừng/dơi chạm), rồi chuẩn đỉnh −1 dBFS
th = 0.7
a = np.abs(mix)
over = a > th
mix[over] = np.sign(mix[over]) * (th + (1 - th) * np.tanh((a[over] - th) / (1 - th)))
gain_master = 10 ** (-1 / 20) / np.abs(mix).max()
mix *= gain_master

# ═════════════════════════ 9. GIÔNG: mưa cả clip + sấm theo STRIKES (fx/storm.ts) ═════════════════════════
# Trộn SAU khi đã chuẩn đỉnh phần còn lại (mọi thứ khác giữ nguyên mức), nên mức mưa/sấm ở đây là dBFS tuyệt đối.
# Dùng rng riêng để không làm lệch chuỗi ngẫu nhiên của các phần trên.
STORM_TS = os.path.join(ROOT, "app", "src", "fx", "storm.ts")
STRIKES = []
if os.path.exists(STORM_TS):
    _m = re.search(r"STRIKES\s*=\s*\[(.*?)\];", open(STORM_TS).read(), re.S)
    if _m:
        STRIKES = [dict(t=float(t), az=float(az), el=float(el), dist=float(d)) for t, az, el, d in re.findall(
            r"t:\s*([\d.]+),\s*az:\s*(-?[\d.]+),\s*el:\s*(-?[\d.]+),\s*dist:\s*([\d.]+)", _m.group(1))]
srng = np.random.default_rng(1031)
db = lambda x: 10 ** (x / 20)


def snoise(n, lo, hi):
    x = band(srng.standard_normal(n), lo, hi)
    return x / (x.std() + 1e-12)


def ticks(n, rate, f_lo, f_hi, dec, amp_shape=1.6):
    """chuỗi tiếng giọt rơi: xung Poisson (biên độ phân bố mũ, vài giọt to) chập với vài nhân cộng hưởng tắt nhanh"""
    out = np.zeros(n)
    for f in np.geomspace(f_lo, f_hi, 5):
        imp = np.zeros(n)
        k = srng.random(n) < rate / 5 / SR
        imp[k] = np.minimum(srng.exponential(1.0, k.sum()) ** amp_shape, 3.0) * srng.choice([-1, 1], k.sum())
        m = ns(dec * 6)
        tk = np.arange(m) / SR
        ker = np.sin(2 * np.pi * f * srng.uniform(0.9, 1.1) * tk) * np.exp(-tk / dec) * np.minimum(tk / 0.0002, 1)
        L = n + m
        out += np.fft.irfft(np.fft.rfft(imp, L) * np.fft.rfft(ker, L), L)[:n]
    return out


# ── mưa (làm lại, bản cuối): chỉ là KHÔNG KHÍ phía sau — êm, ấm, không xì trắng. ──
#   rì rào: nhiễu nghiêng về trầm-trung (pink-ish), cắt dưới 120 Hz, lọc thông thấp ~5.5 kHz (dốc), hai kênh tương quan
#     một phần (rộng nhưng cộng mono vẫn ổn); hạt mưa li ti = hạt nhiễu bao Hann 8–18 ms (tròn, không 'tách'), dải 300–2.5 kHz,
#     rất dày và nhỏ nên hoà vào rì rào chứ không lách tách
#   giọt trên mái hiên / ván gỗ: 'pộp' tròn mềm (sin tắt dần 180–650 Hz, tấn công cosin 3–5 ms, hơi trượt cao độ xuống),
#     thưa, khoảng cách Poisson (không đều), cao độ/mức/pan ngẫu nhiên từng giọt
#   mức nền ≈ −30 dBFS RMS; còn lùi thêm dưới nhạc và các tiếng chính (ducking ở phần trộn cuối, mục 10)
def rain_grains(n, rate, lo, hi, d_lo, d_hi):
    out = np.zeros(n)
    k = np.flatnonzero(srng.random(n) < rate / SR)
    for i0 in k:
        m = ns(srng.uniform(d_lo, d_hi))
        if i0 + m >= n:
            continue
        out[i0:i0 + m] += np.hanning(m) * srng.standard_normal(m) * srng.lognormal(0, 0.5)
    return band(out, lo, hi)


def soft_drop(f0, dec):
    m = ns(dec * 7)
    tk = np.arange(m) / SR
    att = ns(srng.uniform(0.003, 0.005))
    e = np.exp(-tk / dec)
    e[:att] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(att) / att)
    f = f0 * (1 - 0.12 * (1 - np.exp(-tk / 0.02)))                      # trĩu xuống chút: 'pộp' mềm
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.25 * np.sin(2 * np.pi * np.cumsum(f * 2.3) / SR) * np.exp(-tk / (dec * 0.4))
    return x * e


RAIN_LO, RAIN_HI = 120, 5500
inten = 0.88 + 0.24 * smooth_noise(DUR, 0.12)                         # mưa dày/thưa rất chậm
shared = snoise(N, RAIN_LO, RAIN_HI)
f_ = np.fft.rfftfreq(N, 1 / SR)
tilt = 1 / np.sqrt(np.maximum(f_, 120) / 120) ** 0.9                  # nghiêng ~ −2.7 dB/oct: ấm, không sáng
rain = np.zeros((N, 2))
for c in range(2):
    wash = np.fft.irfft(np.fft.rfft(0.6 * shared + 0.8 * snoise(N, RAIN_LO, RAIN_HI)) * tilt, N)
    wash /= wash.std()
    patter = rain_grains(N, 900, 300, 2500, 0.008, 0.018)
    patter /= patter.std() + 1e-12
    rain[:, c] = (wash * 0.8 + patter * 0.22) * inten
# giọt trên mái hiên / ván gỗ: thưa (≈ 5/s tổng), tròn, mềm, ngẫu nhiên
t = srng.exponential(1 / 5.0)
n_drops = 0
while t < DUR - 0.4:
    big = srng.random() < 0.18                                       # giọt nặng từ mép mái: trầm hơn, to hơn chút
    d = soft_drop(srng.uniform(180, 320) if big else srng.uniform(330, 650), srng.uniform(0.035, 0.06) if big else srng.uniform(0.015, 0.03))
    g = srng.lognormal(0, 0.35) * (1.6 if big else 0.8)
    pan = srng.uniform(-0.8, 0.8)
    i0 = ns(t)
    m = min(len(d), N - i0)
    rain[i0:i0 + m, 0] += d[:m] * g * math.sqrt((1 - pan) / 2) * 1.414 * 0.35
    rain[i0:i0 + m, 1] += d[:m] * g * math.sqrt((1 + pan) / 2) * 1.414 * 0.35
    n_drops += 1
    t += srng.exponential(1 / 5.0) + 0.03
rain = np.stack([band(rain[:, c], RAIN_LO, RAIN_HI, order=8) for c in range(2)], 1)   # dốc 48 dB/oct ngoài 120 Hz–5.5 kHz
RAIN_RMS_DB = -30.0
rain *= db(RAIN_RMS_DB) / rms(rain)
_c = db(-20)                                                         # không giọt nào nhô lên như tiếng động
rain = _c * np.tanh(rain / _c)
rain_auto = ramp([(0, 1), (LIT_AT, 1), (LIT_AT + 0.08, db(-4)), (CANDLE_AT, db(-4)), (CANDLE_AT + 0.4, 1), (DUR, 1)])
rain *= rain_auto[:, None]                                           # (duck theo nhạc + tiếng chính: mục 10)
EVENTS.append(f"rain: {n_drops} soft drops, band {RAIN_LO}–{RAIN_HI} Hz")


# ── sấm: (gần) tiếng xé/rắc sắc rồi ầm ì cuộn dài; (xa) mềm, mất dải cao, cuộn lâu hơn ──
def thunder(dist):
    near = dist < 900
    sec = (7.0 if near else 9.0)
    n = ns(sec)
    t = np.arange(n) / SR
    hi_cut = 9000 * math.exp(-dist / 900)                             # không khí nuốt dải cao theo khoảng cách
    out = np.zeros((n, 2))
    # cuộn: các đợt phồng lên bất thường (tâm/độ rộng ngẫu nhiên), tắt dần
    bumps = np.zeros(n)
    tc = 0.15 if near else 0.5
    while tc < sec * 0.8:
        w = srng.uniform(0.25, 0.9) * (1 if near else 1.4)
        bumps += srng.uniform(0.35, 1.0) * np.exp(-tc / (2.2 if near else 3.2)) * np.exp(-((t - tc) / w) ** 2)
        tc += srng.uniform(0.35, 1.1)
    onset = np.minimum(t / (0.06 if near else 0.45), 1)
    roll = (0.25 * np.exp(-t / (2.5 if near else 3.5)) + bumps) * onset * np.clip((sec - t) / 1.2, 0, 1)
    for c in range(2):
        tex = 0.55 + 0.45 * smooth_noise(sec, 7)                     # lục cục khi cuộn
        sub = snoise(n, 28, 80)
        low = snoise(n, 60, 240)
        mid = snoise(n, 200, min(900, hi_cut))
        out[:, c] = (sub * 1.0 + low * 0.7 + mid * 0.22 * (1 if near else 0.5)) * roll * tex
    rumble = out / np.abs(out).max()
    crack = np.zeros((n, 2))
    if near:
        # xé trời: chuỗi xung dày dần rồi thưa trong ~0.4 s, nổ băng rộng ngay đầu, + 'đùng' thân
        tk = 0.0
        while tk < 0.45:
            m = ns(0.012)
            k = ns(tk)
            g = srng.uniform(0.3, 1.0) * (0.4 + 0.6 * math.exp(-tk / 0.18))
            for c in range(2):
                imp = band(srng.standard_normal(m), 900, hi_cut) * np.exp(-np.arange(m) / (0.0015 * SR))
                crack[k:k + m, c] += imp * g * srng.uniform(0.6, 1.0)
            tk += srng.exponential(0.012 + 0.03 * tk)
        m = ns(0.6)
        e0 = env(m, 0.001, 0.12, 4)
        for c in range(2):
            crack[:m, c] += snoise(m, 150, hi_cut) * e0 * 0.6 + snoise(m, 40, 160) * env(m, 0.004, 0.3, 4) * 0.8
        crack /= np.abs(crack).max()
    return rumble, crack



# ── (v3b) INTRO mở màn 0–3 s: hằng số đọc từ `export const INTRO` trong script.ts ──
#   sấm xa ì ầm dưới mưa → sét GẦN ở flash[0] (rắc xé + rắc nhỏ ở flash[2] + ầm ì 3–4 s, tắt ≥12 dB trước 3.0 s)
#   → cẩu máy xuống: gió lướt đỉnh ở giữa chặng (tốc độ smooth3 lớn nhất), quét L→R → đèn hiên chập chờn 'tạch-rè'
#   → gió giật + lá phong khô lăn lạo xạo trên ván → bí lắc nhẹ, ván gỗ kêu 'kẹt' khẽ khi camera dừng
irng = np.random.default_rng(909)
intro_abs = np.zeros((N, 2))
INTRO2 = None
_m = re.search(r"export const INTRO\s*=\s*\{(.*?)\n\};", SCRIPT_TS, re.S)
if _m:
    _txt = _m.group(1)
    _arr = lambda k: [float(x) for x in re.findall(r"-?[\d.]+", re.search(rf"\b{k}:\s*(\[.*?\]),?\s*(?://.*)?\n", _txt).group(1))]
    _num = lambda k: float(re.search(rf"\b{k}:\s*(-?[\d.]+)", _txt).group(1))
    INTRO2 = dict(flash=_arr("flash"), crane=_arr("crane"), zoomMid=float(re.search(r"zoomMid:\s*\{\s*t:\s*([\d.]+)", _txt).group(1)),
                  flicker=_arr("flicker"), gust=_num("gust"), settle=_num("settle"))


def add_abs(sig, at, gain=1.0, pan=0.0):
    """cộng tín hiệu (mono hoặc stereo) vào intro_abs theo dBFS tuyệt đối; cho phép bắt đầu trước 0 (bị cắt)"""
    if sig.ndim == 1:
        sig = np.stack([sig * math.sqrt(1 - pan), sig * math.sqrt(1 + pan)], 1)
    i0 = ns(at)
    if i0 < 0:
        sig, i0 = sig[-i0:], 0
    m = min(len(sig), N - i0)
    if m > 0:
        intro_abs[i0:i0 + m] += sig[:m] * gain


def inoise(n, lo, hi):
    x = band(irng.standard_normal(n), lo, hi)
    return x / (x.std() + 1e-12)


if INTRO2:
    I2 = INTRO2
    f0_, f2_ = I2["flash"][0], I2["flash"][2]
    # 1) sấm xa đang cuộn từ trước khi clip bắt đầu: rất trầm, mất dải cao, nhỏ dưới mưa
    sec = 2.6
    n = ns(sec)
    t_ = np.arange(n) / SR
    roll = np.zeros((n, 2))
    sw = sum(irng.uniform(0.5, 1) * np.exp(-((t_ - c) / irng.uniform(0.25, 0.5)) ** 2) for c in (0.5, 1.0, 1.4))
    for c in range(2):
        roll[:, c] = (inoise(n, 28, 90) + inoise(n, 70, 260) * 0.5) * (0.35 + sw) * (0.6 + 0.4 * smooth_noise(sec, 5))
    roll *= np.clip((sec - t_) / 1.0, 0, 1)[:, None]
    roll = np.stack([band(roll[:, c], 25, 300) for c in range(2)], 1)
    add_abs(roll / np.abs(roll).max(), -0.8, db(-24))
    # 2) sét GẦN (không trễ): rắc xé sắc + 'đùng' thân, rắc nhỏ thứ hai, rồi ầm ì cuộn 3–4 s tắt nhanh
    def close_crack(n_sec, hi):
        m_all = ns(n_sec)
        cr = np.zeros((m_all, 2))
        tk = 0.0
        while tk < n_sec * 0.8:
            m = ns(0.01)
            k = ns(tk)
            g = irng.uniform(0.3, 1.0) * (0.35 + 0.65 * math.exp(-tk / (n_sec * 0.35)))
            for c in range(2):
                cr[k:k + m, c] += band(irng.standard_normal(m), 700, hi) * np.exp(-np.arange(m) / (0.0012 * SR)) * g
            tk += irng.exponential(0.008 + 0.05 * tk)
        m = ns(min(0.6, n_sec))
        for c in range(2):
            cr[:m, c] += inoise(m, 150, hi) * env(m, 0.0008, 0.1, 4) * 0.7 + inoise(m, 35, 160) * env(m, 0.003, 0.25, 4) * 0.9
        return cr / np.abs(cr).max()

    add_abs(close_crack(0.5, 6000), f0_, db(-7.5), -0.15)
    add_abs(close_crack(0.3, 5000), f2_, db(-14), -0.15)
    sec = 4.0
    n = ns(sec)
    t_ = np.arange(n) / SR
    bumps = np.zeros(n)
    tc = 0.08
    while tc < 2.6:
        bumps += irng.uniform(0.4, 1.0) * np.exp(-tc / 0.8) * np.exp(-((t_ - tc) / irng.uniform(0.15, 0.45)) ** 2)
        tc += irng.uniform(0.2, 0.5)
    shape = (0.3 * np.exp(-t_ / 0.9) + bumps) * np.minimum(t_ / 0.04, 1) * np.exp(-np.maximum(t_ - 1.2, 0) / 0.7)
    rum = np.zeros((n, 2))
    for c in range(2):
        rum[:, c] = (inoise(n, 28, 85) + inoise(n, 60, 240) * 0.7 + inoise(n, 200, 1000) * 0.18) * shape \
            * (0.55 + 0.45 * smooth_noise(sec, 7))
    rum = rum + reverb(rum, 2.5, 2500, 8) * 0.3
    rum *= np.clip((sec - t_) / 0.6, 0, 1)[:, None]
    add_abs(rum / np.abs(rum).max(), f0_ + 0.03, db(-13), -0.15)
    # 3) cẩu máy: gió lướt theo tốc độ camera (đạo hàm smooth3 trên chặng crane), quét L→R
    c0, c1 = I2["crane"]
    sec = c1 - c0 + 0.3
    n = ns(sec)
    t_ = np.arange(n) / SR
    u = np.clip(t_ / (c1 - c0), 0, 1)
    v = np.where(u < 0.5, 12 * u ** 2, 12 * (1 - u) ** 2) / 3                  # 0..1, đỉnh giữa chặng
    air = (inoise(n, 220, 900) * (1 - 0.5 * v) + inoise(n, 600, 2600) * v * 0.8 + inoise(n, 1500, 4500) * v ** 2 * 0.25)
    air *= v ** 1.2 * (0.85 + 0.15 * smooth_noise(sec, 3))
    air = fades(air, 0.05, 0.1)
    pan_sw = np.interp(u, [0, 1], [-0.55, 0.55])
    k_pk = int(np.argmax(v))
    w2 = ns(0.25)
    air *= db(-23) / np.sqrt((air[max(0, k_pk - w2):k_pk + w2] ** 2).mean())   # cửa sổ 0.5 s quanh đỉnh ≈ −23 dBFS RMS
    add_abs(np.stack([air * np.sqrt((1 - pan_sw) / 2) * 1.414, air * np.sqrt((1 + pan_sw) / 2) * 1.414], 1), c0)
    # 4) đèn hiên chập chờn: 'tạch' rơ-le + rè điện 120 Hz ngắn mỗi lần tắt; 'tích' nhỏ hơn khi sáng lại
    lamp_pan = 0.3
    fl = I2["flicker"]
    for a_, b_ in zip(fl[0::2], fl[1::2]):
        sec = b_ - a_ + 0.02
        n = ns(sec)
        t_ = np.arange(n) / SR
        buzz = np.sign(np.sin(2 * np.pi * 120 * t_)) * 0.5 + np.sin(2 * np.pi * 240 * t_) * 0.4
        buzz = band(buzz, 100, 3000) * np.exp(-t_ / 0.03) * 0.5
        snap = np.zeros(n)
        m = ns(0.004)
        snap[:m] = inoise(m, 1200, 4500) * np.exp(-np.arange(m) / (0.0007 * SR))
        x = fades(snap + buzz, 0.0002, 0.01)
        add_abs(x / np.abs(x).max(), a_, db(-24), lamp_pan)
        m = ns(0.01)
        tick = fades(inoise(m, 1500, 4000) * np.exp(-np.arange(m) / (0.0006 * SR)), 0.0002, 0.003)
        add_abs(tick / np.abs(tick).max(), b_, db(-32), lamp_pan)
    # 5) gió giật + lá phong khô lăn lạo xạo trên ván hiên (0.8 s), lá lăn từ trái qua phải
    g0 = I2["gust"]
    sec = 1.0
    n = ns(sec)
    t_ = np.arange(n) / SR
    ge = np.sin(np.pi * np.clip(t_ / 0.8, 0, 1)) ** 1.5
    gust = (inoise(n, 150, 900) + inoise(n, 700, 2000) * 0.4) * ge * (0.8 + 0.2 * smooth_noise(sec, 4))
    leaves_ = np.zeros((n, 2))
    tk = 0.05
    while tk < 0.8:
        k = ns(tk)
        p = -0.6 + 1.2 * tk / 0.8 + irng.uniform(-0.2, 0.2)                     # lá trôi theo gió
        for j in range(irng.integers(3, 8)):                                    # một cú lăn = vài cái 'sột' liền
            m = ns(irng.uniform(0.004, 0.01))
            kk = k + ns(j * irng.uniform(0.014, 0.03))
            if kk + m >= n:
                break
            gr = inoise(m, 1400, 6000) * np.exp(-np.arange(m) / (0.35 * m)) * irng.uniform(0.3, 1.0) * ge[kk]
            leaves_[kk:kk + m, 0] += gr * math.sqrt((1 - p) / 2)
            leaves_[kk:kk + m, 1] += gr * math.sqrt((1 + p) / 2)
        tk += irng.exponential(0.05)
    gst = np.stack([gust, gust], 1) * 0.7 + leaves_ / np.abs(leaves_).max() * 1.4
    gst = np.stack([band(gst[:, c], 120, 6500) for c in range(2)], 1)
    k_pk = int(np.argmax(ge))
    gst *= db(-26) / np.sqrt((gst[max(0, k_pk - w2):k_pk + w2] ** 2).mean())
    add_abs(fades(gst[:, 0], 0.02, 0.05)[:, None] * [1, 0] + fades(gst[:, 1], 0.02, 0.05)[:, None] * [0, 1], g0 - 0.1)
    # 6) camera dừng, bí khẽ lắc: tiếng 'kẹt' gỗ nhỏ (dính–trượt ~70 Hz qua cộng hưởng ván)
    st_ = I2["settle"] + 0.1
    sec = 0.28
    n = ns(sec)
    t_ = np.arange(n) / SR
    f = 70 * (1 + 0.25 * np.sin(np.pi * t_ / sec)) * (1 + 0.06 * (smooth_noise(sec, 40) - 0.5))
    pulses = (np.mod(np.cumsum(f) / SR, 1) < 0.08).astype(float)
    creak = band(pulses, 300, 2200) + band(pulses, 800, 1000) * 0.5
    creak *= np.sin(np.pi * t_ / sec) ** 1.2
    add_abs(fades(creak / np.abs(creak).max(), 0.01, 0.02), st_, db(-28), 0.05)
    intro_abs = np.stack([band(intro_abs[:, c], 25, 8000) for c in range(2)], 1)
    EVENTS.append(f"intro: far roll 0–1.8 (−24 pk), CLOSE strike {f0_:.2f} (crack −6 pk) + {f2_:.2f} (−12 pk), rumble to ~"
                  f"{f0_ + 3.5:.1f}; crane whoosh {c0:.2f}–{c1:.2f} peak {c0 + (c1 - c0) / 2:.2f}; flicker {fl[0]:.2f}, {fl[2]:.2f}; "
                  f"gust {g0:.2f}–{g0 + 0.8:.2f}; creak {st_:.2f}")


storm = np.zeros((N, 2))
THUNDER = []
for s in STRIKES:
    arr = s["t"] + s["dist"] / 343.0
    if arr >= DUR:
        continue
    rumble, crack = thunder(s["dist"])
    near = s["dist"] < 900
    # pan: phương vị cú sét so với hướng camera đang nhìn lúc tiếng tới (sấm vốn lan toả → pan nhẹ)
    bx, by, bz, _ = view_at(arr, LIT_AT if arr >= LIT_AT else -1.0)
    az_cam = math.atan2(-bz[0], -bz[1])
    pan = float(np.clip(0.45 * math.sin(s["az"] - az_cam), -0.5, 0.5))
    pk_crack, pk_roll = (db(-10), db(-10)) if near else (0.0, db(-16))   # ấm: thân ầm ì trội hơn tiếng xé
    sig = rumble * pk_roll + crack * pk_crack
    sig = sig + reverb(sig, 3.0, 2500 if near else 1200, 5) * 0.35  # vọng giữa trời / nhà cửa
    sig[:, 0] *= math.sqrt(1 - pan)
    sig[:, 1] *= math.sqrt(1 + pan)
    i0 = ns(arr)
    m = min(len(sig), N - i0)
    storm[i0:i0 + m] += sig[:m]
    THUNDER.append((s, arr, pan))
storm = np.stack([band(storm[:, c], 28, 6500) for c in range(2)], 1)   # sấm sâu, ấm: bỏ dải chói

# ── khắc (mức tuyệt đối): tiếng cắt ≈ −24 dBFS RMS trong lúc dao đi, 'thóc' lỗ ~−14 dBFS đỉnh, vụn lộp độp rất nhỏ ──
cut = carve_cut.stereo()
cut_mask = np.zeros(N, bool)
for a_, b_ in CUT_WIN:
    cut_mask[ns(a_):ns(b_)] = True
cut *= db(-24) / np.sqrt((cut[cut_mask] ** 2).mean())
carve_abs = cut + norm_peak(carve_pop.stereo(), db(-14)) + norm_peak(carve_patter.stereo(), db(-26))
carve_abs = carve_abs + reverb(carve_abs, 0.8, 3500, 6) * 0.12        # vang ngắn của hiên
# ═════════════════════════ 10. DUCK + DE-ESS (trộn cuối) ═════════════════════════
# nhạc lùi dưới các tiếng chính (sét, sấm, khắc, que diêm, nến bùng, dơi sượt); mưa lùi dưới nhạc + tiếng chính.
# Bộ dò bao: RMS khối 5 ms → một cực tấn công/nhả; độ lùi tăng tuyến tính trong 12 dB trên ngưỡng tới 'depth'.
def key_env(x, att=0.004, rel=0.25):
    m = np.abs(x).max(1) if x.ndim == 2 else np.abs(x)
    B = ns(0.005)
    nb_ = len(m) // B
    blk = np.sqrt((m[:nb_ * B].reshape(nb_, B) ** 2).mean(1))
    ka, kr = 1 - math.exp(-0.005 / att), 1 - math.exp(-0.005 / rel)
    out = np.empty(nb_)
    y = 0.0
    for i, v in enumerate(blk):
        y += (v - y) * (ka if v > y else kr)
        out[i] = y
    return np.interp(np.arange(len(m)), np.arange(nb_) * B + B / 2, out)


def duck_db(x, thr, depth, rng_db=12.0, att=0.004, rel=0.25):
    e = 20 * np.log10(key_env(x, att, rel) + 1e-9)
    return depth * np.clip((e - thr) / rng_db, 0, 1)


def deess(st, lo=4500, hi=9500, thr_db=-40.0, ratio=3.0):
    """de-esser băng tách (FFT pha 0 nên trừ ra cộng vào không lệch pha): chỉ nén dải 4.5–9.5 kHz khi nó vọt lên"""
    out = st.copy()
    for c in range(2):
        hb = band(st[:, c], lo, hi)
        e = 20 * np.log10(key_env(hb, 0.002, 0.06) + 1e-9)
        red = np.maximum(e - thr_db, 0) * (1 - 1 / ratio)
        out[:, c] = st[:, c] - hb + hb * 10 ** (-red / 20)
    return out


# tiếng khắc/cưa: thông thấp 9 kHz + de-ess
carve_abs = deess(np.stack([band(carve_abs[:, c], 40, 9000, order=6) for c in range(2)], 1))
match_k, fire_k = stems["match"] * gain_master, stems["fire"] * gain_master
jump_k = stems["jump"] * gain_master
keys_music = np.max([
    duck_db(intro_abs, -34, 8.0, rel=0.35),                          # sét mở màn + cẩu máy
    duck_db(storm, -36, 6.0, rel=0.45),                              # sấm
    duck_db(carve_abs, -36, 4.0, rel=0.2),                           # khắc
    duck_db(match_k, -34, 5.0, rel=0.25),                            # que diêm
    duck_db(fire_k, -28, 3.0, rel=0.15),                             # công tắc + nến bùng (nhẹ, để drop vẫn đấm)
    duck_db(bats_abs, -30, 3.0, rel=0.25),                           # dơi sượt ống kính
    duck_db(jump_k, -30, 3.0, rel=0.2),                              # bí nhảy / đảo
], axis=0)
music_abs *= db(-keys_music)[:, None]
rain_duck = np.maximum(duck_db(music_abs, -34, 5.0, 14, 0.05, 0.6), np.minimum(keys_music * 1.2, 7.0))
rain *= db(-rain_duck)[:, None]
EVENTS.append(f"duck: music max −{keys_music.max():.1f} dB (mean −{keys_music.mean():.1f}), rain max −{rain_duck.max():.1f} dB "
              f"(drop −{rain_duck[ns(DROP + 0.5):ns(DROP + 4)].mean():.1f})")
_sd = os.environ.get("SYNTH_STEMS")
if _sd:
    os.makedirs(_sd, exist_ok=True)
    np.save(os.path.join(_sd, "rain_new.npy"), rain.astype(np.float32))
    np.save(os.path.join(_sd, "music.npy"), music_abs.astype(np.float32))

mix = mix + (rain + storm + carve_abs + intro_abs + bats_abs + music_abs) * fade[:, None]
# giới hạn đỉnh nhìn trước 5 ms (không méo): giữ ≤ −1 dBFS
CEIL = db(-1)
peak_abs = np.abs(mix).max(1)
g = np.minimum(1, CEIL / np.maximum(peak_abs, 1e-9))
w = ns(0.005)
gpad = np.concatenate([np.ones(w), g, np.ones(w)])
gmin = np.lib.stride_tricks.sliding_window_view(gpad, 2 * w + 1).min(1)
gs = np.convolve(np.concatenate([np.ones(w), gmin, np.ones(w)]), np.ones(2 * w + 1) / (2 * w + 1), "valid")
mix *= np.minimum(gs, gmin)[:, None]
mix *= min(1.0, CEIL / np.abs(mix).max())
for s, arr, pan in THUNDER:
    i0 = ns(arr)
    seg = storm[i0:i0 + ns(9)] * np.minimum(gs, gmin)[i0:i0 + ns(9), None]
    wr = [rms(seg[k:k + SR // 2]) for k in range(0, len(seg) - SR // 2, SR // 4)]
    loud = [k for k, v in enumerate(wr) if v > db(-40)]
    EVENTS.append(f"thunder: flash {s['t']:.2f}, dist {s['dist']:.0f} m → arrives {arr:.3f}, pan {pan:+.2f}; thunder alone: "
                  f"peak {20 * np.log10(np.abs(seg).max()):.1f} dBFS (first 0.5 s {20 * np.log10(np.abs(seg[:SR // 2]).max()):.1f}), "
                  f"max 0.5 s RMS {20 * np.log10(max(wr)):.1f} dBFS, above −40 dBFS RMS for ~{(loud[-1] + 2) * 0.25 if loud else 0:.1f} s")
_g = np.minimum(gs, gmin)[:, None]
_c = carve_abs * _g
_spec = np.abs(np.fft.rfft(_c[cut_mask][:, 0]))
_f = np.fft.rfftfreq(cut_mask.sum(), 1 / SR)
EVENTS.append(f"carve: cutting RMS {20 * np.log10(np.sqrt((_c[cut_mask] ** 2).mean())):.1f} dBFS, pops peak "
              f"{20 * np.log10(np.abs(_c[~cut_mask]).max()):.1f} dBFS; energy 150 Hz–3 kHz "
              f"{100 * (_spec[(_f > 150) & (_f < 3000)] ** 2).sum() / (_spec ** 2).sum():.0f}%, above 5 kHz "
              f"{10 * np.log10((_spec[_f > 5000] ** 2).sum() / (_spec ** 2).sum()):.0f} dB")
EVENTS.append(f"rain: RMS {20 * np.log10(rms(rain)):.1f} dBFS (target {RAIN_RMS_DB}), peak {20 * np.log10(np.abs(rain).max()):.1f}; limiter min gain "
              f"{20 * np.log10(gs.min() + 1e-9):.1f} dB")

if os.environ.get("SYNTH_DEBUG"):                                    # in mức RMS (dBFS) từng stem theo cửa sổ 0.5 s
    dbg = dict(stems, music=music_abs / gain_master, amb=ambience + owl_n)
    dbg.update(rain=rain / gain_master, storm=storm / gain_master, carve=carve_abs / gain_master, intro2=intro_abs / gain_master, bats=bats_abs / gain_master)
    print("t     " + " ".join(f"{k:>7}" for k in dbg))
    for i in range(0, N, SR // 2):
        row = [20 * np.log10(np.sqrt((v[i:i + SR // 2] ** 2).mean()) * gain_master + 1e-9) for v in dbg.values()]
        print(f"{i / SR:5.1f} " + " ".join(f"{r:7.1f}" for r in row))

# ═════════════════════════ 11. MASTER cho X: −14 LUFS tích hợp, true peak ≤ −1 dBTP, 48 kHz stereo 24-bit ═════════════════════════
# (a) đo loudness bản trộn (ffmpeg loudnorm lượt 1) → (b) đưa gain về đích + limiter nhìn trước đỉnh oversample ×4 (trần
# −1.6 dBTP) để lượt 2 chạy được chế độ TUYẾN TÍNH (không nén động) → (c) loudnorm 2 lượt (linear=true) → (d) đo lại
# (ebur128 peak=true) + ảnh phổ. Bản trộn thô giữ ở <out>_premaster.wav.
import shutil, subprocess
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
LUFS, TP = -14.0, -1.0


def write_wav24(path, x):
    a = np.round(np.clip(x, -1, 1) * 8388607).astype("<i4")
    with wave.open(path, "wb") as w_:
        w_.setnchannels(2)
        w_.setsampwidth(3)
        w_.setframerate(SR)
        w_.writeframes(a.view(np.uint8).reshape(-1, 4)[:, :3].tobytes())


def os_peaks(x, k=4):
    """đỉnh từng mẫu sau oversample ×k (FFT) — ước lượng true peak"""
    p = np.zeros(len(x))
    for c in range(2):
        y = np.fft.irfft(np.fft.rfft(x[:, c]), k * len(x)) * k
        p = np.maximum(p, np.abs(y).reshape(-1, k).max(1))
    return p


def limiter(x, ceil_db, look=0.002, rel=0.08):
    g = np.minimum(1, db(ceil_db) / np.maximum(os_peaks(x), 1e-9))
    w = ns(look)
    gm = np.lib.stride_tricks.sliding_window_view(np.concatenate([np.ones(w), g, np.ones(w)]), 2 * w + 1).min(1)
    h = w // 2
    box = np.convolve(np.concatenate([np.ones(h), gm, np.ones(h)]), np.ones(2 * h + 1) / (2 * h + 1), "valid")
    B = 48
    nb_ = len(gm) // B
    blk = gm[:nb_ * B].reshape(nb_, B).min(1)
    kr = 1 - math.exp(-B / SR / rel)
    y, out = 1.0, np.empty(nb_)
    for i, v in enumerate(blk):
        y = min(v, y + (1 - y) * kr)
        out[i] = y
    rc = np.interp(np.arange(len(gm)), np.arange(nb_) * B, out)
    gg = np.minimum(box, rc)
    return x * gg[:, None], 20 * np.log10(gg.min())


def loudnorm_measure(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af",
                        f"loudnorm=I={LUFS}:TP={TP}:LRA=20:print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    return json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])


os.makedirs(os.path.dirname(OUT), exist_ok=True)
PRE = OUT[:-4] + "_premaster.wav"
write_wav24(PRE, mix)
m1 = loudnorm_measure(PRE)
x = mix * db(LUFS - float(m1["input_i"]))
x, gr = limiter(x, TP - 0.6)
write_wav24(PRE, x)
m2 = loudnorm_measure(PRE)
subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", PRE, "-af",
                f"loudnorm=I={LUFS}:TP={TP}:LRA=20:measured_I={m2['input_i']}:measured_TP={m2['input_tp']}:"
                f"measured_LRA={m2['input_lra']}:measured_thresh={m2['input_thresh']}:offset={m2['target_offset']}:linear=true:"
                f"print_format=summary", "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s24le", OUT], check=True)
r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", OUT, "-af", "ebur128=peak=true", "-f", "null", "-"],
                   capture_output=True, text=True).stderr
summ = r[r.rindex("Summary:"):]
I_ = float(re.search(r"I:\s*(-?[\d.]+) LUFS", summ).group(1))
TP_ = float(re.search(r"Peak:\s*(-?[\d.]+) dBFS", summ).group(1))
LRA_ = float(re.search(r"LRA:\s*(-?[\d.]+) LU", summ).group(1))
SPEC = os.path.join(os.path.dirname(OUT), "spectrum_final.png")
subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", OUT, "-lavfi",
                "showspectrumpic=s=1600x700:mode=separate:legend=1:fscale=log:scale=log:stop=16000", SPEC], check=True)
for e in EVENTS:
    print("  ", e)
print(f"MASTER pass1 I {m1['input_i']} LUFS TP {m1['input_tp']} → pre-gain {LUFS - float(m1['input_i']):+.1f} dB, limiter max GR "
      f"{-gr:.1f} dB → pass2 in {m2['input_i']} LUFS / TP {m2['input_tp']} (offset {m2['target_offset']})")
print("AUDIO", OUT, f"{DUR:.1f}s 48k stereo 24-bit | I {I_:.1f} LUFS, true peak {TP_:.1f} dBTP, LRA {LRA_:.1f} LU | premaster {PRE} | "
      f"spectrum {SPEC}")
