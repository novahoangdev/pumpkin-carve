# Check the panorama background with numpy, exactly as the app will use it (relying only on layout.json):
#   1. reproject bg_lit_pano.jpg back into the original camera frame (cam.pos, cam.rot = world → camera, looking down −Z, f in pt,
#      principal point = frame centre, screen y pointing down) and compare with bg_lit.jpg: mean error + offset (px) found by a
#      shift search; comparison image render/v3/pano_check.png (original | reprojected from pano | diff ×4);
#   2. "look around" previews: yaw −60/0/+60 × pitch +40/0/−45 at 1× and 0.55× focal length → render/v3/look_*.png
#      (areas outside the pano's range painted dark red).
# Run: Blender -b --factory-startup -P blender/scripts/check_pano.py
import bpy, json, math, os
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SCENE = os.path.join(ROOT, "app", "assets", "scene")
OUT = os.path.join(ROOT, "render", "v3")
os.makedirs(OUT, exist_ok=True)
lay = json.load(open(os.path.join(SCENE, "layout.json")))
VW, VH = lay["view"]
CAM = lay["cam"]
PANO = lay["pano"]


def load(path):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[::-1, :, :3].copy()


def save(a, path):
    h, w = a.shape[:2]
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(a, 0, 1)
    im = bpy.data.images.new("chk", w, h, alpha=False)
    im.pixels.foreach_set(rgba[::-1].ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def bilerp(a, x, y):
    h, w = a.shape[:2]
    x = np.clip(x - 0.5, 0, w - 1.001)
    y = np.clip(y - 0.5, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    return (a[y0, x0] * (1 - fx) + a[y0, x0 + 1] * fx) * (1 - fy) + (a[y0 + 1, x0] * (1 - fx) + a[y0 + 1, x0 + 1] * fx) * fy


F, RT, UP = (np.array(PANO[k], np.float64) for k in ("fwd", "right", "up"))
LON0, LON1 = PANO["lon"]
LAT0, LAT1 = PANO["lat"]


def sample_pano(pano, d):
    """World direction (…×3) → colour in the pano per the contract; also returns an in-range flag."""
    d = d / np.linalg.norm(d, axis=-1, keepdims=True)
    lon = np.degrees(np.arctan2(d @ RT, d @ F))
    lat = np.degrees(np.arcsin(np.clip(d @ UP, -1, 1)))
    Hp, Wp = pano.shape[:2]
    u = (lon - LON0) / (LON1 - LON0) * Wp
    v = (LAT1 - lat) / (LAT1 - LAT0) * Hp
    ok = (lon >= LON0) & (lon <= LON1) & (lat >= LAT0) & (lat <= LAT1)
    return bilerp(pano, u, v), ok


def blur(a, k):
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.pad(a, [(k + 1, k) if i == ax else (0, 0) for i in range(a.ndim)], mode="edge"), axis=ax)
            a = (np.take(c, range(2 * k + 1, c.shape[ax]), axis=ax) - np.take(c, range(0, c.shape[ax] - 2 * k - 1), axis=ax)) / (2 * k + 1)
    return a


# ── 1. reproject back into the original frame ──
base = load(os.path.join(SCENE, "bg_lit.jpg"))
pano = load(os.path.join(SCENE, "bg_lit_pano.jpg"))
h, w = base.shape[:2]
s = w / VW                                     # px per pt
xs = ((np.arange(w) + 0.5) / s)[None, :]
ys = ((np.arange(h) + 0.5) / s)[:, None]
f = CAM["f"]
dc = np.stack(np.broadcast_arrays((xs - VW / 2) / f, -(ys - VH / 2) / f, -np.ones_like(xs + ys)), -1)
Rm = np.array(CAM["rot"])                       # rows = camera axes in world space
dw = dc @ Rm                                    # = Rᵀ · d_cam
rep, ok = sample_pano(pano, dw)
k = 1                                           # pano is sparser than the original frame (~20 vs ~32 px/degree): lightly blur the original
bb = blur(base, k)
err = np.abs(rep - bb).mean(-1)
mae = err[ok].mean() * 255
# offset search: shift the reprojection ±4 px, find the minimum (parabolic interpolation)
gy = lambda a: a.mean(-1)
c0 = gy(bb)[40:-40, 40:-40]
best = {}
for dy in range(-4, 5):
    for dx in range(-4, 5):
        sh = np.roll(np.roll(gy(rep), dy, 0), dx, 1)[40:-40, 40:-40]
        best[(dx, dy)] = np.abs(sh - c0).mean()
(bx, by), emin = min(best.items(), key=lambda kv: kv[1])


def para(m, p, c):
    den = m - 2 * c + p
    return 0.0 if abs(den) < 1e-12 else 0.5 * (m - p) / den


sx = bx + (para(best.get((bx - 1, by), emin), best.get((bx + 1, by), emin), emin) if abs(bx) < 4 else 0)
sy = by + (para(best.get((bx, by - 1), emin), best.get((bx, by + 1), emin), emin) if abs(by) < 4 else 0)
print(f"PANO_CHECK mae {mae:.2f}/255  (unblurred: {np.abs(rep - base).mean(-1)[ok].mean() * 255:.2f})  "
      f"best offset dx {sx:+.2f} dy {sy:+.2f} px @{w}×{h} (= {sx / s:+.2f}, {sy / s:+.2f} pt)  "
      f"mae there {emin * 255:.2f}  outside pano range: {int((~ok).sum())} px")
sheet = np.concatenate([base, rep, np.clip(np.abs(rep - bb) * 4, 0, 1)], 1)
save(sheet[::2, ::2], os.path.join(OUT, "pano_check.png"))


# ── 1b. depth: decode a few known points + compare bg_depth (original frame) with bg_depth_pano along the same view directions ──
DEP = lay.get("depth")
if DEP and os.path.exists(os.path.join(SCENE, "bg_depth.png")) and os.path.exists(os.path.join(SCENE, "bg_depth_pano.png")):
    dmin, dmax = DEP["min"], DEP["max"]
    dec = lambda v: dmin * np.exp(v * math.log(dmax / dmin))          # v ∈ 0..1 (255 = sky)
    db = load(os.path.join(SCENE, "bg_depth.png"))[..., 0]
    dp = load(os.path.join(SCENE, "bg_depth_pano.png"))[..., 0]
    hb, wb = db.shape
    sb = wb / VW
    pos = np.array(CAM["pos"])

    def to_px(P):
        pc = Rm @ (np.array(P) - pos)
        return (VW / 2 + f * pc[0] / -pc[2]) * sb, (VH / 2 - f * pc[1] / -pc[2]) * sb

    # probe points (m, world): floor under the pumpkin centre, mid-porch floor, door face, top of the back railing, wall face next to the lamp
    C0 = lay["pumpkin"]["c"]
    probes = {"floor_under_pumpkin": (C0[0], C0[1], 0.0), "floor_mid": (0.25, 0.8, 0.0), "door": (0.6, 1.51, 1.2),
              "rail_top": (-0.6, 1.52, 0.885), "wall": (0.2, 1.55, 1.0)}
    for k, P in probes.items():
        x, y = to_px(P)
        if not (0 <= x < wb and 0 <= y < hb):
            continue
        v = db[int(y), int(x)]
        print(f"DEPTH_PROBE {k:20s} px ({x:6.1f},{y:6.1f})  decoded {dec(v):6.3f} m  geometric {np.linalg.norm(np.array(P) - pos):6.3f} m")
    # original frame → pano: same ray direction, depth along the ray must match (except at object edges, where sampling is off by half a pixel)
    xs_ = ((np.arange(wb) + 0.5) / sb)[None, :]
    ys_ = ((np.arange(hb) + 0.5) / sb)[:, None]
    dcb = np.stack(np.broadcast_arrays((xs_ - VW / 2) / f, -(ys_ - VH / 2) / f, -np.ones_like(xs_ + ys_)), -1)
    dwb = dcb @ Rm
    dwb /= np.linalg.norm(dwb, axis=-1, keepdims=True)
    lon = np.degrees(np.arctan2(dwb @ RT, dwb @ F))
    lat = np.degrees(np.arcsin(np.clip(dwb @ UP, -1, 1)))
    Hp, Wp = dp.shape
    u = np.clip(((lon - LON0) / (LON1 - LON0) * Wp).astype(int), 0, Wp - 1)
    v = np.clip(((LAT1 - lat) / (LAT1 - LAT0) * Hp).astype(int), 0, Hp - 1)
    vp = dp[v, u]
    code = np.abs(db - vp) * 255
    sky = (db > 0.999) & (vp > 0.999)
    geo = (db < 0.999) & (vp < 0.999)
    # skip object edges (depth changes fast within a 2 px neighbourhood) when computing the "surface" error
    gx = np.maximum(np.abs(np.diff(db, axis=1, prepend=db[:, :1])), np.abs(np.diff(db, axis=0, prepend=db[:1])))
    flat = geo & (blur(gx[..., None], 2)[..., 0] * 255 < 1.0)
    print(f"PANO_DEPTH original frame vs pano: sky match {sky.sum() / max(1, ((db > 0.999) | (vp > 0.999)).sum()) * 100:.1f}%  "
      f"surfaces (edges skipped): median |Δ| {np.median(code[flat]):.2f} codes, p95 {np.percentile(code[flat], 95):.2f} codes, "
      f"≤1 code {np.mean(code[flat] <= 1.0) * 100:.1f}%  (1 code = {math.log(dmax / dmin) / 255 * 100:.2f}% of distance)  "
      f"all geometry px ≤2 codes {np.mean(code[geo] <= 2.0) * 100:.1f}%")


# ── 2. look-around previews ──
def view(pano, yaw, pitch, zoom, tw=VW, th=VH):
    cy, sy_, cp, sp = math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
    hf = F * cy + RT * sy_
    fw = hf * cp + UP * sp
    rt = RT * cy - F * sy_
    up = np.cross(rt, fw)
    ff = f * zoom * tw / VW
    x = ((np.arange(tw) + 0.5) - tw / 2)[None, :] / ff
    y = ((np.arange(th) + 0.5) - th / 2)[:, None] / ff
    d = fw[None, None, :] + x[..., None] * rt[None, None, :] - y[..., None] * up[None, None, :]
    col, ok = sample_pano(pano, d)
    return np.where(ok[..., None], col, np.array((0.35, 0.0, 0.05)))


tiles = {}
for name, pth in (("lit", "bg_lit_pano.jpg"), ("dark", "bg_dark_pano.jpg")):
    pn = pano if name == "lit" else load(os.path.join(SCENE, pth))
    for zoom in (1.0, 0.55):
        rows = []
        for pitch in (40, 0, -45):
            rows.append(np.concatenate([np.pad(view(pn, yaw, pitch, zoom, 300, 652), ((4, 4), (4, 4), (0, 0)))
                                        for yaw in (-60, 0, 60)], 1))
        out = os.path.join(OUT, f"look_{name}_f{int(zoom * 100):03d}.png")
        save(np.concatenate(rows, 0), out)
        print("LOOK", out)
