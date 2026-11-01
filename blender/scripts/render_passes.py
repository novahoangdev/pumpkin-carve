# Render các lớp 2.5D cho app từ cùng một góc máy, rồi xuất app/assets/scene/*:
#   bg_lit.jpg, bg_dark.jpg     cảnh không có bí (bí KHÔNG đổ bóng, để bí nhảy được): đèn hiên bật / chỉ còn trăng
#   bg_glow.jpg                 riêng phần ánh sáng của ngọn nến lên thềm và tường: một nguồn điểm 3 W ở tâm lòng bí
#                               (layout "glowSrc"), vỏ/lòng bí ẩn → chỉ suy giảm hình học + bóng vật khác; view
#                               "Standard", exposure 0 (giá trị sRGB của bức xạ tuyến tính); app nhân với tầm nhìn qua lỗ khắc
#   bg_depth.png, bg_depth_pano.png   độ sâu cho parallax: PNG xám 8-bit, cùng cỡ với bg_lit.jpg / bg_lit_pano.jpg, khớp
#                               từng pixel. Giá trị = khoảng cách THEO TIA (m) từ vị trí camera tới mặt đầu tiên:
#                               v = 255·clamp(ln(d/0.25)/ln(200/0.25), 0, 1), trời = 255 (layout "depth": min, max).
#                               Hình học thấy được y như bg_lit/bg_dark (bí ẩn). 1 sample, filter ≈ 0 → không trộn độ sâu ở mép
#   shadow_lit.png, shadow_dark.png   bóng của quả bí tách riêng: hệ số nhân 1 kênh (8-bit xám, 1 = không bóng),
#                               = (nền có bóng bí) / (nền không bóng bí), khung gốc 1320×2868, không crop
#   bg_lit_pano.jpg, bg_dark_pano.jpg, bg_glow_pano.jpg   nền toàn cảnh để app "nhìn quanh": equirect từ CAM_LOC,
#                               hệ level (fwd = hướng ngang của camera gốc, up = z), lon ∈ [-80, 80] (dương = phải),
#                               lat ∈ [-62, 58] (dương = lên); u = (lon+80)/160·W, v = (58−lat)/120·H; 3200×2400 @100 %
#   skin_lit.png, skin_dark.png vỏ ngoài + cuống (RGBA, khung vuông quanh quả bí)
#   interior_lit/unlit.png      lòng bí khi nửa trước ẩn khỏi camera: nến sáng / nến tắt
#   data.png                    R,G: normal theo không gian camera (0..1), B: vùng khắc được
#   flesh.jpg                   thớ thịt bí cho thành vết cắt
#   layout.json                 khung crop, toạ độ nến/miệng/đèn hiên, thông số camera (đơn vị pt màn hình 440×956, iPhone 17 Pro Max)
#
# Chạy: Blender -b blender/pumpkin.blend -P blender/scripts/render_passes.py -- [--pct 100] [--samples 128] [--only bg_lit,...]
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "app", "assets", "scene")
TMP = os.path.join(ROOT, "render", "passes")
PCT = int(arg("--pct", "100"))
SAMPLES = int(arg("--samples", "128"))
ONLY = arg("--only", "")
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

sc = bpy.context.scene
r = sc.render
r.resolution_percentage = PCT
W, H = r.resolution_x, r.resolution_y            # 1320×2868 = 440×956 pt @3x (iPhone 17 Pro Max)
VIEW_PT = (440, 956)
PT = W / VIEW_PT[0]                                   # px (100 %) trên mỗi pt
cam = sc.camera
O = bpy.data.objects
L = {n: O[n] for n in ("moon", "moon_fill", "porch", "porch_key", "candle", "candle_glow")}
SKIN = [O["skin_front"], O["skin_back"], O["stem"]]
INNER = [o for o in bpy.data.collections["inner"].objects]
ENV = [o for o in bpy.data.collections["env"].objects]
CAM_ONLY = {o for o in ENV if o.get("pc_cam_only")}      # trần, mái…: chỉ camera thấy, không bao giờ đổ bóng
glass = bpy.data.materials["lantern_glass"].node_tree.nodes["emit"]
_skym = bpy.data.materials.get("sky")
skyem = _skym.node_tree.nodes.get("emit") if _skym else None    # phông trời phẳng cũ (bản mở rộng đã bỏ, dùng world)
world_bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND" and n.name != "sky_bg")
sky_bg = sc.world.node_tree.nodes.get("sky_bg")          # trời toàn cảnh (chỉ camera thấy), cùng cường độ với phông phẳng
# đèn phụ của phần cảnh mở rộng (vd. ánh cửa sổ) và vật liệu tự phát sáng của cảnh (node "emit_env"):
# bật khi có ánh sáng môi trường, tắt ở pass ánh nến / data
LIGHTS_X = [o for o in bpy.data.collections["lights"].objects if o.name not in L]
ENV_EMIT = [(n, n.inputs["Strength"].default_value) for m in bpy.data.materials if m.use_nodes and m.node_tree
            for n in m.node_tree.nodes if n.name == "emit_env"]
VIEW0, EXPO0 = sc.view_settings.view_transform, sc.view_settings.exposure


def to_px(p):
    """Toạ độ thế giới → pixel 100 % (gốc trên trái)."""
    v = world_to_camera_view(sc, cam, Vector(p))
    return v.x * W, (1 - v.y) * H


# ── khung crop vuông quanh quả bí (pixel 100 %) ──
pts = []
for ob in SKIN:
    m = ob.matrix_world
    pts += [to_px(m @ v.co) for v in list(ob.data.vertices)[::7]]
xs, ys = [p[0] for p in pts], [p[1] for p in pts]
S = int(max(max(xs) - min(xs), max(ys) - min(ys)) * 1.06) // 8 * 8
CX0 = int((min(xs) + max(xs)) / 2 - S / 2)
CY0 = int((min(ys) + max(ys)) / 2 - S / 2)


def state(lights=(), lantern=0.0, world=0.35, sky=1.0, cam_vis=(), hidden=(), shadow_off=(), transparent=False,
          crop=False, view=None, band_y0=None):
    """band_y0: chỉ render dải từ hàng px band_y0 (100 %) xuống đáy khung, ảnh vẫn đủ cỡ (ngoài dải = đen)."""
    for n, ob in L.items():
        ob.hide_render = n not in lights
    for ob in LIGHTS_X:
        ob.hide_render = world <= 0
    for n, s0 in ENV_EMIT:
        n.inputs["Strength"].default_value = s0 if world > 0 else 0.0
    glass.inputs["Strength"].default_value = lantern
    if skyem:
        skyem.inputs["Strength"].default_value = sky
    if sky_bg:
        sky_bg.inputs["Strength"].default_value = sky
    world_bg.inputs["Strength"].default_value = world
    for ob in SKIN + INNER + ENV:
        ob.hide_render = ob in hidden
        ob.visible_camera = ob in cam_vis
        ob.visible_shadow = ob not in shadow_off and ob not in CAM_ONLY
    if "sky" in O:
        O["sky"].visible_shadow = False
    r.film_transparent = transparent
    r.use_border = crop or band_y0 is not None
    r.use_crop_to_border = crop
    if crop:
        r.border_min_x, r.border_max_x = CX0 / W, (CX0 + S) / W
        r.border_max_y, r.border_min_y = 1 - CY0 / H, 1 - (CY0 + S) / H
    elif band_y0 is not None:
        r.border_min_x, r.border_max_x = 0.0, 1.0
        r.border_max_y, r.border_min_y = 1 - band_y0 / H, 0.0
    sc.view_settings.view_transform = view or VIEW0
    sc.view_settings.exposure = EXPO0 if view is None else 0.0


DEPTH_MIN, DEPTH_MAX = 0.25, 200.0


def render_depth(name):
    """Z pass của trạng thái hiện tại: 1 sample, pixel filter ≈ 0 (mẫu ở tâm pixel) → EXR multilayer tạm."""
    path = os.path.join(TMP, f"{name}.exr")
    if ONLY and name not in ONLY.split(","):
        return path
    vl = bpy.context.view_layer
    keep = (r.filter_size, vl.use_pass_z, sc.cycles.samples, sc.cycles.use_denoising)
    vl.use_pass_z = True
    r.filter_size = 0.01
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False
    if hasattr(r.image_settings, "media_type"):          # Blender ≥ 5.0: multilayer là một media type của OPEN_EXR
        r.image_settings.media_type = "MULTI_LAYER_IMAGE"      # → file_format tự thành OPEN_EXR_MULTILAYER
    else:
        r.image_settings.file_format = "OPEN_EXR_MULTILAYER"
    r.image_settings.color_depth = "32"
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    if hasattr(r.image_settings, "media_type"):
        r.image_settings.media_type = "IMAGE"
    r.filter_size, vl.use_pass_z, sc.cycles.samples, sc.cycles.use_denoising = keep
    print("── render", name)
    return path


def read_z(path):
    """Kênh Depth.Z của EXR multilayer (hàng 0 = trên cùng)."""
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    try:
        si = 0
        while inp.seek_subimage(si, 0):
            names = list(inp.spec().channelnames)
            for ci, cn in enumerate(names):
                if cn.endswith("Depth.Z") or cn == "Z":
                    return np.asarray(inp.read_image(si, 0, ci, ci + 1, "float"), np.float64)[..., 0]
            si += 1
    finally:
        inp.close()
    raise RuntimeError(f"không thấy Depth.Z trong {path}")


def save_depth(z, pano, out):
    """Z pass → khoảng cách theo tia → PNG xám log. Phối cảnh: Z là phẳng (dọc trục nhìn) → d = z·|tia|/|tia·fwd|;
    equirect của Cycles: Z đã là khoảng cách theo tia."""
    h, w = z.shape
    sky = ~np.isfinite(z) | (z > 1e6)
    if pano:
        d = z
    else:
        fpx = cam.data.lens / cam.data.sensor_width * w            # sensor_fit HORIZONTAL, shift = 0
        x = (np.arange(w) + 0.5 - w / 2) / fpx
        y = (np.arange(h) + 0.5 - h / 2) / fpx
        d = z * np.sqrt(1.0 + x[None, :] ** 2 + y[:, None] ** 2)
    v = np.clip(np.log(np.maximum(d, 1e-6) / DEPTH_MIN) / math.log(DEPTH_MAX / DEPTH_MIN), 0, 1)
    v[sky] = 1.0
    save_gray_png(v, out)
    print("DEPTH", os.path.basename(out), f"{w}×{h}", "sky px", int(sky.sum()), "d range",
          round(float(d[~sky].min()), 3) if (~sky).any() else None, round(float(d[~sky].max()), 2) if (~sky).any() else None)


def render(name, fmt="PNG", samples=SAMPLES, denoise=True):
    if ONLY and name not in ONLY.split(","):
        return os.path.join(TMP, f"{name}.{'jpg' if fmt == 'JPEG' else 'png'}")
    sc.cycles.samples = samples
    sc.cycles.use_denoising = denoise
    depth = "16" if fmt == "PNG16" else "8"
    fmt = "PNG" if fmt == "PNG16" else fmt
    r.image_settings.file_format = fmt
    if fmt == "JPEG":
        r.image_settings.quality = 88
        r.image_settings.color_mode = "RGB"
    else:
        r.image_settings.color_mode = "RGBA" if r.film_transparent else "RGB"
        r.image_settings.color_depth = depth
    path = os.path.join(TMP, f"{name}.{'jpg' if fmt == 'JPEG' else 'png'}")
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    print("── render", name)
    return path


ALL = SKIN + INNER + ENV
FRONT = [O["skin_front"], O["wall_front"], O["stem"]]
LIT = ("moon", "moon_fill", "porch", "porch_key")
DARK = ("moon", "moon_fill")

# camera toàn cảnh cho các pass *_pano: cùng vị trí camera gốc, hướng level (fwd = phần ngang hướng nhìn, up = z)
PANO_W, PANO_H = 3200, 2400
PANO_LON, PANO_LAT = (-80.0, 80.0), (-62.0, 58.0)
_f = cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))
PANO_FWD = Vector((_f.x, _f.y, 0)).normalized()
PANO_RIGHT = PANO_FWD.cross(Vector((0, 0, 1))).normalized()
_pd = bpy.data.cameras.new("cam_pano")
_pd.type = "PANO"
_pd.panorama_type = "EQUIRECTANGULAR"         # Cycles: tâm ảnh = −Z của camera, lon dương sang phải, lat dương lên
_pd.longitude_min, _pd.longitude_max = (math.radians(a) for a in PANO_LON)
_pd.latitude_min, _pd.latitude_max = (math.radians(a) for a in PANO_LAT)
_pd.clip_start, _pd.clip_end = cam.data.clip_start, cam.data.clip_end
CAM_PANO = bpy.data.objects.new("cam_pano", _pd)
sc.collection.objects.link(CAM_PANO)
CAM_PANO.location = cam.matrix_world.translation
CAM_PANO.rotation_euler = PANO_FWD.to_track_quat("-Z", "Y").to_euler()


def use_pano(on):
    sc.camera = CAM_PANO if on else cam
    r.resolution_x, r.resolution_y = (PANO_W, PANO_H) if on else (W, H)


NOPUMP = SKIN + INNER                         # nền: bí + lòng bí không hiện, không đổ bóng
# 1. nền (PNG 16-bit tạm để chia lấy bóng bí, rồi đổi sang JPG)
state(LIT, lantern=6.0, cam_vis=ENV, shadow_off=NOPUMP)
render("bg_lit", "PNG16")
state(DARK, lantern=0.025, cam_vis=ENV, shadow_off=NOPUMP)
render("bg_dark", "PNG16")
# độ sâu: đúng trạng thái hình học của bg_lit/bg_dark (bí không hiện với camera)
state(LIT, lantern=6.0, cam_vis=ENV, shadow_off=NOPUMP)
render_depth("bg_depth")
# 1b. bóng quả bí: render lại dải quanh/trước quả bí (bóng đèn hiên kéo tới đáy khung), lần này bí đổ bóng
BAND_Y0 = max(0, int(CY0 - 0.3 * S))
state(LIT, lantern=6.0, cam_vis=ENV, band_y0=BAND_Y0)
render("bg_lit_sh", "PNG16")
state(DARK, lantern=0.025, cam_vis=ENV, band_y0=BAND_Y0)
render("bg_dark_sh", "PNG16")
# ánh nến: chỉ một nguồn sáng ở tâm bí, bí không chặn sáng; xuất tuyến tính để app nhân thẳng
raw_view = "Standard"
for v in ("Raw", "Standard"):
    try:
        sc.view_settings.view_transform = v
        raw_view = v
        break
    except TypeError:
        pass
state(("candle_glow",), lantern=0.0, world=0.0, sky=0.0, cam_vis=ENV, hidden=SKIN + INNER, view="Standard")
render("bg_glow", "JPEG", samples=64)
# 1c. nền toàn cảnh, cùng ba trạng thái ánh sáng
use_pano(True)
state(LIT, lantern=6.0, cam_vis=ENV, shadow_off=NOPUMP)
render("bg_lit_pano", "JPEG")
state(DARK, lantern=0.025, cam_vis=ENV, shadow_off=NOPUMP)
render("bg_dark_pano", "JPEG")
state(LIT, lantern=6.0, cam_vis=ENV, shadow_off=NOPUMP)
render_depth("bg_depth_pano")
state(("candle_glow",), lantern=0.0, world=0.0, sky=0.0, cam_vis=ENV, hidden=SKIN + INNER, view="Standard")
render("bg_glow_pano", "JPEG", samples=64)
use_pano(False)

# 2. vỏ ngoài
state(LIT, lantern=6.0, cam_vis=SKIN, hidden=INNER, transparent=True, crop=True)
render("skin_lit")
state(DARK, lantern=0.025, cam_vis=SKIN, hidden=INNER, transparent=True, crop=True)
render("skin_dark")

# 3. lòng bí: nửa trước (vỏ + thành trong + cuống) ẩn khỏi camera nhưng vẫn chặn sáng
inside = [o for o in ALL if o not in ENV and o not in FRONT and o is not O["skin_back"]]
state(("candle",), lantern=0.0, world=0.0, sky=0.0, cam_vis=inside, transparent=True, crop=True)
render("interior_lit")
state(LIT, lantern=6.0, cam_vis=inside, transparent=True, crop=True)
render("interior_unlit")

# 4. dữ liệu: normal theo không gian camera + mặt nạ cuống, vật liệu phát sáng ghi đè
def emit_override(name, kind):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    if kind == "normal":
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        vt = nt.nodes.new("ShaderNodeVectorTransform")
        vt.vector_type, vt.convert_from, vt.convert_to = "NORMAL", "WORLD", "CAMERA"
        nt.links.new(geo.outputs["Normal"], vt.inputs[0])
        ma = nt.nodes.new("ShaderNodeVectorMath")
        ma.operation = "MULTIPLY_ADD"
        ma.inputs[1].default_value = (0.5, 0.5, 0.5)
        ma.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(vt.outputs[0], ma.inputs[0])
        nt.links.new(ma.outputs[0], em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = kind
    return m


def with_materials(mats, fn):
    keep = {ob: [s.material for s in ob.material_slots] for ob in mats}
    for ob, m in mats.items():
        for s in ob.material_slots:
            s.material = m
    try:
        return fn()
    finally:
        for ob, ms in keep.items():
            for s, m in zip(ob.material_slots, ms):
                s.material = m


r.filter_size = 0.6
for v in ("Raw", "Standard"):
    try:
        sc.view_settings.view_transform = v
        raw_view = v
        break
    except TypeError:
        pass
state((), world=0.0, sky=0.0, cam_vis=SKIN, hidden=INNER, transparent=True, crop=True, view=raw_view)
mn = emit_override("ov_normal", "normal")
normal_path = with_materials({O["skin_front"]: mn, O["skin_back"]: mn, O["stem"]: mn}, lambda: render("normal", samples=16, denoise=False))
black, white = emit_override("ov_black", (0, 0, 0, 1)), emit_override("ov_white", (1, 1, 1, 1))
stem_path = with_materials({O["skin_front"]: black, O["skin_back"]: black, O["stem"]: white}, lambda: render("stemid", samples=8, denoise=False))
r.filter_size = 1.5


# ── hậu kỳ bằng numpy ──
def load(path):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[::-1]          # hàng 0 = trên cùng


def load_srgb(path):
    """Như load() nhưng luôn trả giá trị đã mã hoá sRGB như trong file (PNG 16-bit được Blender đọc thành tuyến tính)."""
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    fl = im.is_float
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    a = a.reshape(h, w, 4)[::-1, :, :3]
    if fl:
        a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.clip(a, 0, None), 1 / 2.4) - 0.055)
    return a


def png_to_jpg(src, dst, q=88):
    """PNG 16-bit → JPG: lấy giá trị sRGB như trong file, ghi qua ảnh 8-bit mới (ảnh load từ PNG giữ định dạng PNG khi save)."""
    a = load_srgb(src)
    h, w = a.shape[:2]
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(a, 0, 1)
    im = bpy.data.images.new("tmp_jpg", w, h, alpha=False)
    im.pixels.foreach_set(rgba[::-1].ravel())
    im.filepath_raw = dst
    im.file_format = "JPEG"
    im.save(quality=q)
    bpy.data.images.remove(im)


def save_gray_png(a, path):
    """PNG xám 8-bit một kênh (ghi tay bằng zlib: Blender chỉ lưu RGB/RGBA)."""
    import struct, zlib
    h, w = a.shape
    px = (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
    raw = np.concatenate([np.zeros((h, 1), np.uint8), px], 1).tobytes()     # mỗi hàng: filter 0 + dữ liệu

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def save(arr, path, alpha=False):
    h, w = arr.shape[:2]
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :arr.shape[2]] = arr
    im = bpy.data.images.new("tmp", w, h, alpha=alpha)
    im.pixels.foreach_set(rgba[::-1].ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def blur(a, rad_px):
    """Box blur 3 lần ≈ gauss (theo trục, có pad)."""
    for _ in range(3):
        for ax in (0, 1):
            k = max(1, int(rad_px))
            c = np.cumsum(np.pad(a, [(k + 1, k) if i == ax else (0, 0) for i in range(a.ndim)], mode="edge"), axis=ax)
            hi = np.take(c, range(2 * k + 1, c.shape[ax]), axis=ax)
            lo = np.take(c, range(0, c.shape[ax] - 2 * k - 1), axis=ax)
            a = (hi - lo) / (2 * k + 1)
    return a


nm = load(normal_path)
st = load(stem_path)
alpha = nm[..., 3]
n = nm[..., :3] * 2 - 1
nz = -n[..., 2]                           # không gian camera của Cycles: +x phải, +y lên, +z hướng vào cảnh
stem = blur((st[..., 0] > 0.2).astype(np.float32), 6 * PCT / 100) > 0.02
carv = ((nz > 0.45) & (alpha > 0.99) & ~stem).astype(np.float32)
s = max(1.0, 3.0 * PCT / 100)
carv = np.clip((blur(carv, s) - 0.5) * 2.5 + 0.5, 0, 1)
data = np.stack([n[..., 0] * 0.5 + 0.5, n[..., 1] * 0.5 + 0.5, carv], -1) * (alpha[..., None] > 0.5)
save(data, os.path.join(OUT, "data.png"))

for name in ("skin_lit", "skin_dark", "interior_lit", "interior_unlit"):
    os.replace(os.path.join(TMP, name + ".png"), os.path.join(OUT, name + ".png")) if os.path.exists(os.path.join(TMP, name + ".png")) else None
# bóng quả bí = (nền có bóng) / (nền không bóng), theo độ sáng (luma) của giá trị trong ảnh
for st in ("lit", "dark"):
    p0, p1 = os.path.join(TMP, f"bg_{st}.png"), os.path.join(TMP, f"bg_{st}_sh.png")
    if not (os.path.exists(p0) and os.path.exists(p1)):
        continue
    a0, a1 = load_srgb(p0), load_srgb(p1)
    luma = lambda a: a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
    y0_, y1_ = blur(luma(a0), max(1.0, PCT / 100)), blur(luma(a1), max(1.0, PCT / 100))
    ratio = np.clip((y1_ + 0.004) / (y0_ + 0.004), 0, 1)
    dev = np.clip((1 - ratio - 0.012) / 0.988, 0, 1)            # bỏ nhiễu rất nhỏ quanh 1
    band = int(BAND_Y0 * PCT / 100)
    dev[:band + int(24 * PCT / 100)] = 0                          # ngoài dải đã render (và mép dải) = không bóng
    save_gray_png(1 - dev, os.path.join(OUT, f"shadow_{st}.png"))
    print("SHADOW", st, "min", round(float(ratio.min()), 3), "px<0.98:", int((dev > 0.02).sum()))
for name in ("bg_lit", "bg_dark"):
    p = os.path.join(TMP, name + ".png")
    if os.path.exists(p):
        png_to_jpg(p, os.path.join(OUT, name + ".jpg"))
for name in ("bg_glow", "bg_lit_pano", "bg_dark_pano", "bg_glow_pano"):
    p = os.path.join(TMP, name + ".jpg")
    if os.path.exists(p):
        os.replace(p, os.path.join(OUT, name + ".jpg"))
for name, pano in (("bg_depth", False), ("bg_depth_pano", True)):
    p = os.path.join(TMP, name + ".exr")
    if os.path.exists(p):
        save_depth(read_z(p), pano, os.path.join(OUT, name + ".png"))
flesh = os.path.join(ROOT, "blender", "textures", "flesh_tile.jpg")
if os.path.exists(flesh):
    im = bpy.data.images.load(flesh)
    im.scale(512, 512)
    im.filepath_raw = os.path.join(OUT, "flesh.jpg")
    im.file_format = "JPEG"
    im.save()

# ── layout.json (pt) ──
pt = lambda p: [round(c / PT, 2) for c in to_px(p)]
mw = cam.matrix_world
R3 = mw.to_3x3().transposed()                     # thế giới → camera
f_pt = cam.data.lens / cam.data.sensor_width * W / PT
C = Vector(sc["pc_center"])
rad_ = sc["pc_radius"]
layout = {
    "view": list(VIEW_PT),
    "crop": [round(CX0 / PT, 3), round(CY0 / PT, 3), round(S / PT, 3)],
    "flame": pt(sc["pc_flame"]),
    "mouth": pt(C + Vector((0, -rad_[0] * 0.9, -0.03))),
    "center": pt(C),
    "lantern": pt(sc["pc_lantern"]),
    "pumpkin": {"c": list(C), "r": list(rad_)},
    "cam": {"pos": list(mw.translation), "rot": [list(R3[i]) for i in range(3)], "f": round(f_pt, 3)},
    "floor": {"z": 0.0, "front": -0.62},
    # độ sâu bg_depth*.png: v/255 = ln(d/min)/ln(max/min), d = khoảng cách theo tia từ cam.pos (m), 255 = trời
    "depth": {"min": DEPTH_MIN, "max": DEPTH_MAX},
    # ánh nến (m, thế giới): nguồn của bg_glow (tâm lòng bí), tâm ngọn lửa thật, độ dày vỏ ở xích đạo
    "glowSrc": [round(c, 5) for c in sc.get("pc_glow_src", list(C))],
    "flameW": [round(c, 5) for c in sc["pc_flame"]],
    "shell": round(float(sc.get("pc_shell", 0.017)), 5),
    "pano": {"fwd": [round(c, 6) + 0.0 for c in PANO_FWD], "right": [round(c, 6) + 0.0 for c in PANO_RIGHT], "up": [0, 0, 1],
             "lon": list(PANO_LON), "lat": list(PANO_LAT)},
}
if "pc_roof" in sc:
    # mái hiên che mưa: [xmin, xmax, ymin, ymax, zEave] (m) — hình chiếu bằng của mái (tới mép diềm), zEave = mép trên
    # diềm mái; trong hộp này và dưới zEave không có mưa (ymax = mặt tường nhà / mép sau mái)
    layout["roof"] = [round(float(c), 4) for c in sc["pc_roof"]]
if "pc_floor_edge" in sc:
    fe = [float(c) for c in sc["pc_floor_edge"]]
    # mép sàn hiên (z = 0): trước y = yFront, trái x = xLeft, phải x = xRight; mép sau y = yBack chỉ hở ra sân khi
    # x < xBackOpenMax (lan can sau), phần còn lại là tường nhà
    layout["floorEdge"] = {"z": 0.0, "yFront": fe[0], "xLeft": fe[1], "xRight": fe[2], "yBack": fe[3], "xBackOpenMax": fe[4]}
json.dump(layout, open(os.path.join(OUT, "layout.json"), "w"), indent=1)
print("LAYOUT", json.dumps(layout["crop"]), layout["flame"])
