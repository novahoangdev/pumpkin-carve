# Clip demo đăng X (4:3, kiểu "phone mockup"): iPhone 3D khung titan phát bản quay màn hình app.
# Camera "đạo diễn" theo nhịp app: bay vào, dí sát mặt bí lúc khắc (punch-zoom mỗi lần lỗ bật ra), lia theo que
# diêm, tối sầm rồi punch-in + rung + loé sáng lúc nến bùng, máy nghiêng 3D khớp parallax trong app, lùi nhanh
# khi dơi 3D bay ra khỏi màn hình lao qua camera, end card chữ bật vào.
# FX: đom đóm/bụi mờ có độ sâu trường ảnh, bloom, vignette, light leak, motion blur, chữ nền (CARVE → LIGHT → BOO)
# bật từng chữ cái. Nền gradient đổi màu theo đoạn (tím đêm → tối → cam lúc nến bùng → tím lúc dơi).
# Bản quay phát đúng 1.0x, khớp frame theo mốc nến bùng; không cross-dissolve.
#
# Mọi mốc thời gian / chuyển động camera nằm trong một "beat sheet" JSON cho từng bản quay
# (blender/scripts/beats/v2.json, v3.json…): đổi bản quay = đổi beat sheet, không sửa code.
#
# Chạy: Blender -b --factory-startup -P blender/scripts/promo.py -- --beats blender/scripts/beats/v2.json \
#         --screen render/promo/v2/screen.mp4 --film-start 2.36 --out render/promo/frames [--pct 100] [--stills 2,9,19] \
#         [--app-start 1.1] [--app-end 18.4] [--card 3.6] [--label v2]      (3 tham số cuối ghi đè beat sheet)
#   --film-start: giây trong screen.mp4 ứng với t=0 của app (lấy từ lúc nến bùng: burst − beats.burst)
import bpy, bmesh, json, math, os, random, sys
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
BEATS_PATH = os.path.abspath(arg("--beats", os.path.join(os.path.dirname(os.path.abspath(__file__)), "beats", "v2.json")))
BEATS = json.load(open(BEATS_PATH))
# khung màn app (pt) của bản quay: beat sheet ghi "view" (bản quay cũ trên 17 Pro: [402, 874]); mặc định = layout.json
# hiện tại (17 Pro Max: [440, 956]). Mọi toạ độ "at" trong beat sheet tính theo khung này.
_LAYOUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "app", "assets", "scene", "layout.json")
VIEW = BEATS.get("view") or (json.load(open(_LAYOUT)).get("view") if os.path.exists(_LAYOUT) else None) or [440, 956]
SCREEN = os.path.abspath(arg("--screen", "render/promo/screen.mp4"))
FILM0 = float(arg("--film-start", "2.36"))     # giây trong bản quay lúc app t=0
OUT = os.path.abspath(arg("--out", "render/promo/frames"))
PCT = int(arg("--pct", "100"))
LABEL = arg("--label", "")                     # nhãn nhỏ góc dưới trái (vd "v2"), để so sánh các bản
FPS = 60                                        # mọi mốc trong script tính theo khung 60 fps "thiết kế"
OFPS = int(arg("--fps", os.environ.get("PROMO_FPS", "60")))   # fps xuất ra (120: bản quay timescale 0.5 đã nén về 120 fps CFR)
MF = OFPS / FPS                                 # khung thiết kế → khung xuất (key/key_sock nhân hệ số này)
APP0 = float(arg("--app-start", BEATS["app_start"]))   # giây app ở frame đầu clip (bỏ màn đen lúc mở app)
APP_END = float(arg("--app-end", BEATS["app_end"]))     # giây app lúc vào end card (để đuôi tiếng dơi phát hết)
CARD = float(arg("--card", BEATS.get("card", 3.6)))     # độ dài end card
DUR = APP_END - APP0 + CARD
FR = lambda sec: round(sec * FPS)              # giây clip → frame
A = lambda t: FR(t - APP0)                     # giây app → frame clip
rad = math.radians
rng = random.Random(BEATS.get("seed", 31))

T_BLACK, T_BURST, T_BATS = BEATS["blackout"], BEATS["burst"], BEATS["bats_at"]   # tắt đèn hiên, nến bùng (mốc đồng bộ), dơi
C_CARD = APP_END - APP0                        # giây clip bắt đầu end card
F_CARD = FR(C_CARD)
NF = FR(DUR)


def TT(v):
    """Mốc trong beat sheet → frame clip: số = giây app; "start"; "card" / "card+0.9"; "end"."""
    if isinstance(v, (int, float)):
        return A(v)
    if v == "start":
        return 0
    if v == "end":
        return NF
    if v.startswith("card"):
        return F_CARD + FR(float(v[4:] or 0))
    raise ValueError(f"mốc lạ: {v}")


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1440, PCT
sc.render.fps = OFPS
sc.frame_start, sc.frame_end = 0, round(DUR * OFPS) - 1
sc.view_settings.view_transform = "Standard"
sc.eevee.taa_render_samples = 16
sc.eevee.use_fast_gi = False
sc.render.film_transparent = False
sc.render.use_motion_blur = True               # EEVEE: motion blur theo vector vận tốc, gần như miễn phí
sc.render.motion_blur_shutter = 0.5
sc.eevee.motion_blur_steps = 1


def hexc(h):
    h = h.lstrip("#")
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def mat_emit(name, color, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes
    n.clear()
    e = n.new("ShaderNodeEmission"); e.inputs["Color"].default_value = hexc(color); e.inputs["Strength"].default_value = strength
    o = n.new("ShaderNodeOutputMaterial")
    m.node_tree.links.new(e.outputs[0], o.inputs[0])
    return m, e


def link(ob):
    sc.collection.objects.link(ob)
    return ob


def fcurves(idb):
    # Blender 5.x: Action dạng layer/slot, không còn action.fcurves → lấy qua channelbag của slot
    ad = idb.animation_data
    if ad is None or ad.action is None:
        return []
    if hasattr(ad.action, "fcurves"):
        return ad.action.fcurves
    from bpy_extras.anim_utils import action_get_channelbag_for_slot
    cb = action_get_channelbag_for_slot(ad.action, ad.action_slot)
    return cb.fcurves if cb else []


def key(idb, path, f, value):
    setattr(idb, path, value)
    idb.keyframe_insert(path, frame=f * MF)


def key_sock(sock, f, value):
    sock.default_value = value
    sock.keyframe_insert("default_value", frame=f * MF)


def sock_in(node, name, typ):
    return [s for s in node.inputs if s.name == name and s.type == typ][0]


def sock_out(node, typ):
    return [s for s in node.outputs if s.type == typ][0]


def flicker(idb, path, strength, scale=2.5, index=-1):
    # chập chờn: F-curve Noise (xác định, không phụ thuộc thứ tự render frame)
    for fc in fcurves(idb):
        if fc.data_path.endswith(path) and (index < 0 or fc.array_index == index):
            m = fc.modifiers.new("NOISE"); m.strength, m.scale, m.phase = strength, scale, rng.uniform(0, 50)


# ── nền: mặt phẳng phát sáng, gradient dọc 2 màu + quầng sáng sau máy, đổi màu theo đoạn ──
# palette: đêm #141a33, sương #3b4a6b, bí #f07a1a / #b34a0c, lửa #ffd27a → #ff9a2e
# (mốc, màu trên, màu dưới, màu quầng, độ mạnh quầng, số frame chuyển tính từ mốc) — xem beat sheet "sections"
SECTIONS = [(TT(t), *rest) for t, *rest in BEATS["sections"]]
bg_me = bpy.data.meshes.new("bg")
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1)
bm.to_mesh(bg_me); bm.free()
bg = link(bpy.data.objects.new("bg", bg_me))
bg.scale = (20, 15, 1)
bg.rotation_euler = (rad(90), 0, 0)
bg.location = (0, 7, 0)
bgm = bpy.data.materials.new("bg"); bgm.use_nodes = True
N, Lk = bgm.node_tree.nodes, bgm.node_tree.links
N.clear()
tc = N.new("ShaderNodeTexCoord"); sep = N.new("ShaderNodeSeparateXYZ"); Lk.new(tc.outputs["Generated"], sep.inputs[0])
top = N.new("ShaderNodeRGB"); bot = N.new("ShaderNodeRGB"); halo = N.new("ShaderNodeRGB")
mix = N.new("ShaderNodeMix"); mix.data_type = "RGBA"
Lk.new(sep.outputs["Y"], mix.inputs["Factor"])
Lk.new(bot.outputs[0], sock_in(mix, "A", "RGBA")); Lk.new(top.outputs[0], sock_in(mix, "B", "RGBA"))
grad = N.new("ShaderNodeTexGradient"); grad.gradient_type = "SPHERICAL"   # quầng sáng tròn sau máy
mp = N.new("ShaderNodeMapping"); mp.inputs["Location"].default_value = (0.5, 0.5, 0); mp.inputs["Scale"].default_value = (1.6, 2.1, 1)
sub = N.new("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"; sub.inputs[1].default_value = (0.5, 0.5, 0)
Lk.new(tc.outputs["Generated"], sub.inputs[0]); Lk.new(sub.outputs[0], mp.inputs[0]); Lk.new(mp.outputs[0], grad.inputs[0])
glow = N.new("ShaderNodeMath"); glow.operation = "MULTIPLY"
Lk.new(grad.outputs["Fac"], glow.inputs[0])
add = N.new("ShaderNodeMix"); add.data_type = "RGBA"; add.blend_type = "ADD"
Lk.new(glow.outputs[0], add.inputs["Factor"])
Lk.new(sock_out(mix, "RGBA"), sock_in(add, "A", "RGBA")); Lk.new(halo.outputs[0], sock_in(add, "B", "RGBA"))
em = N.new("ShaderNodeEmission"); Lk.new(sock_out(add, "RGBA"), em.inputs["Color"])
out = N.new("ShaderNodeOutputMaterial"); Lk.new(em.outputs[0], out.inputs[0])
bg_me.materials.append(bgm)


def key_bg(f, sec, gs=None):
    _, ct, cb, ch, g, _ = sec
    for sock, v in ((top.outputs[0], hexc(ct)), (bot.outputs[0], hexc(cb)), (halo.outputs[0], hexc(ch)), (glow.inputs[1], g if gs is None else gs)):
        key_sock(sock, f, v)


for i, s in enumerate(SECTIONS):
    if i:
        key_bg(s[0] - 1, SECTIONS[i - 1])      # màu cũ giữ tới frame ngay trước mốc (không đổi màu sớm hơn app)
    key_bg(s[0] + s[5], s)
# nến bùng: quầng sáng loé mạnh rồi lắng xuống (ánh lửa "tràn" ra nền)
fb = A(T_BURST)
key_sock(glow.inputs[1], fb, 1.1); key_sock(glow.inputs[1], fb + 8, 0.75); key_sock(glow.inputs[1], fb + 40, 0.42)

# ── world: phản chiếu lên khung titan; tối theo lúc tắt đèn ──
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
wbg = w.node_tree.nodes["Background"]
wbg.inputs["Color"].default_value = hexc("#B9B4C4")
for f, s in ((0, 0.6), (A(T_BLACK) - 1, 0.6), (A(T_BLACK) + 6, 0.12), (fb - 1, 0.12), (fb, 0.7), (fb + 30, 0.55)):
    key_sock(wbg.inputs["Strength"], f, s)


# ── iPhone (giống Goku) ──
def rounded_rect(bm, w, h, r, z, segs=14):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(segs + 1):
            a = rad(a0 + 90 * k / segs)
            pts.append(bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z)))
    return bm.faces.new(pts)


PW, PH, PR, THICK = 1.0, 2.13, 0.16, 0.09
SW = PW - 0.06
SH = SW * VIEW[1] / VIEW[0]
SCR_Y = -THICK / 2 - 0.006                     # mặt màn hình (trục y local của máy, âm = hướng về camera)
phone = link(bpy.data.objects.new("PHONE", None))
me = bpy.data.meshes.new("body"); bm = bmesh.new()
f0 = rounded_rect(bm, PW, PH, PR, -THICK / 2)
ext = bmesh.ops.extrude_face_region(bm, geom=[f0])
bmesh.ops.translate(bm, vec=(0, 0, THICK), verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free()
body = link(bpy.data.objects.new("body", me))
bev = body.modifiers.new("bevel", "BEVEL"); bev.width, bev.segments, bev.limit_method = 0.025, 5, "ANGLE"
me.shade_smooth() if hasattr(me, "shade_smooth") else None
ti = bpy.data.materials.new("titanium"); ti.use_nodes = True
bsdf = next(n for n in ti.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = hexc("#8F8A83"); bsdf.inputs["Metallic"].default_value = 1.0; bsdf.inputs["Roughness"].default_value = 0.32
me.materials.append(ti)
body.parent = phone
body.rotation_euler = (rad(90), 0, 0)
for name, wdt, hgt, r, yoff, kind in (("glass", PW - 0.012, PH - 0.012, PR - 0.006, -THICK / 2 - 0.004, "black"),
                                      ("screen", SW, SH, PR - 0.035, SCR_Y, "screen")):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    rounded_rect(bm, wdt, hgt, r, 0)
    uv = bm.loops.layers.uv.new()
    for face in bm.faces:
        for l in face.loops:
            l[uv].uv = (l.vert.co.x / wdt + 0.5, l.vert.co.y / hgt + 0.5)
    bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.parent = phone
    ob.rotation_euler = (rad(90), 0, 0)
    ob.location = (0, yoff, 0)
    if kind == "black":
        me.materials.append(mat_emit("glass", "#050505")[0])
    else:
        sm = bpy.data.materials.new("screen"); sm.use_nodes = True
        n = sm.node_tree.nodes; n.clear()
        tex = n.new("ShaderNodeTexImage")
        img = bpy.data.images.load(SCREEN); img.source = "MOVIE"
        tex.image = img
        iu = tex.image_user
        iu.frame_duration = 100000
        # frame clip f hiện frame (f − frame_start) của bản quay → frame clip 0 = giây FILM0 + APP0 của bản quay
        iu.frame_start = -round((FILM0 + APP0) * OFPS)      # bản quay phải cùng fps xuất (OFPS, CFR)
        iu.use_auto_refresh = True
        iu.use_cyclic = False
        e = n.new("ShaderNodeEmission"); e.inputs["Strength"].default_value = 1.0
        o = n.new("ShaderNodeOutputMaterial")
        sm.node_tree.links.new(tex.outputs["Color"], e.inputs["Color"]); sm.node_tree.links.new(e.outputs[0], o.inputs[0])
        me.materials.append(sm)
me = bpy.data.meshes.new("island"); bm = bmesh.new()
rounded_rect(bm, 0.3, 0.085, 0.0425, 0)
bm.to_mesh(me); bm.free()
isl = link(bpy.data.objects.new("island", me))
isl.parent = phone; isl.rotation_euler = (rad(90), 0, 0); isl.location = (0, -THICK / 2 - 0.008, SH / 2 - 0.075)
me.materials.append(mat_emit("island", "#000000")[0])
for i, (x, z, hh) in enumerate(((PW / 2 + 0.006, 0.45, 0.22), (-PW / 2 - 0.006, 0.55, 0.12), (-PW / 2 - 0.006, 0.3, 0.16), (-PW / 2 - 0.006, 0.08, 0.16))):
    me = bpy.data.meshes.new(f"btn{i}"); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1); bmesh.ops.scale(bm, vec=(0.02, 0.04, hh), verts=bm.verts)
    bm.to_mesh(me); bm.free()
    b = link(bpy.data.objects.new(f"btn{i}", me)); b.parent = phone; b.location = (x, 0, z); me.materials.append(ti)


def scr_local(x, y):
    """Điểm trên màn app (pt, khung VIEW) → toạ độ local của máy."""
    return Vector(((x / VIEW[0] - 0.5) * SW, SCR_Y, (0.5 - y / VIEW[1]) * SH))


def scr_world(x, y, rot=(0, 0, 0), loc=(0, 0, 0)):
    return Euler(tuple(rad(a) for a in rot)).to_matrix() @ scr_local(x, y) + Vector(loc)


# ── đèn ──
key_l = bpy.data.lights.new("key", "AREA"); key_l.size = 6
kl = link(bpy.data.objects.new("key", key_l)); kl.location = (-4, -5, 5); kl.rotation_euler = (rad(50), 0, rad(-40))
for f, en in ((0, 900), (A(T_BLACK) - 1, 900), (A(T_BLACK) + 6, 120), (fb - 1, 120), (fb, 650)):
    key(key_l, "energy", f, en)
# đèn viền ấm phía sau-phải: bật khi nến cháy, cho khung titan ánh cam
rim_d = bpy.data.lights.new("rim", "AREA"); rim_d.size, rim_d.color = 4, (1.0, 0.62, 0.3)
rim = link(bpy.data.objects.new("rim", rim_d)); rim.location = (4.5, -1.5, 1.5); rim.rotation_euler = (rad(90), 0, rad(70))
for f, en in ((0, 0), (fb - 1, 0), (fb + 4, 900), (A(T_BATS), 900), (A(T_BATS) + 20, 350)):
    key(rim_d, "energy", f, en)
# ánh nến "tràn" ra từ màn hình: đèn điểm gắn vào máy, trước mặt bí, bật ở frame nến bùng rồi chập chờn
glow_d = bpy.data.lights.new("screen_glow", "POINT"); glow_d.color = (1.0, 0.6, 0.25); glow_d.shadow_soft_size = 0.3
gl_ob = link(bpy.data.objects.new("screen_glow", glow_d)); gl_ob.parent = phone
gl_ob.location = scr_local(201, 600) + Vector((0, -0.45, 0))
for f, en in ((0, 0), (fb - 1, 0), (fb, 260), (fb + 10, 120), (fb + 40, 70)):
    key(glow_d, "energy", f, en)
flicker(glow_d, "energy", 18, 3.0)


# ── chữ ──
def text(name, body, font, size, color, loc, strength=1.0, align="CENTER", extrude=0.0, parent=None):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.size, cu.align_x, cu.align_y, cu.extrude = body, size, align, "CENTER", extrude
    cu.font = bpy.data.fonts.load(font)
    ob = link(bpy.data.objects.new(name, cu))
    ob.rotation_euler = (rad(90), 0, 0)
    ob.location = loc
    ob.parent = parent
    cu.materials.append(mat_emit(name + "_m", color, strength)[0])
    return ob


IMPACT = "/System/Library/Fonts/Supplemental/Impact.ttf"
BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
ARIAL = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"   # có dấu "·"
DIN = "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf"


def big_word(word, f0, f1, color, strength, size=2.5):
    """Chữ nền lớn sau máy: từng chữ cái bật lên lệch nhịp, cả cụm trượt + phóng nhẹ suốt đoạn, cắt thẳng khi hết."""
    rig = link(bpy.data.objects.new("rig_" + word, None))
    letters = [text(f"big_{word}_{i}", ch, IMPACT, size, color, (0, 0, 0), strength, parent=rig) for i, ch in enumerate(word)]
    bpy.context.view_layer.update()
    gap = 0.06 * size
    widths = [ob.dimensions.x for ob in letters]
    x = -(sum(widths) + gap * (len(word) - 1)) / 2
    for i, (ob, wd) in enumerate(zip(letters, widths)):
        lx = x + wd / 2; x += wd + gap
        fi = f0 + 3 * i
        for f, vis in ((0, False), (fi, True), (f1, False)):
            key(ob, "hide_render", f, not vis)
        for f, s, dz in ((fi, 0.2, -0.9), (fi + 9, 1.12, 0.08), (fi + 18, 1.0, 0.0)):   # bật lên có overshoot
            key(ob, "scale", f, (s, s, s)); key(ob, "location", f, (lx, 0, dz))
    for f, x_, s in ((f0, 0.9, 0.94), (f1, -0.9, 1.06)):
        key(rig, "location", f, (x_, 4.2, 0.15)); key(rig, "scale", f, (s, s, s))
    return rig


for w_, t0, t1, col, st, size in BEATS["words"]:
    big_word(w_, TT(t0), TT(t1), col, st, size)

# end card: chữ bên trái bật vào lần lượt (scale có overshoot), máy dạt sang phải
EX = -1.2
end = [text("logo1", "Happy", BLACK, 0.56, "#f07a1a", (EX, 0, 1.05), 1.15),
       text("logo2", "Halloween!", BLACK, 0.46, "#ffb04a", (EX, 0, 0.45), 1.1),
       text("credit", "Expo · React Native · Skia · Reanimated · Blender", ARIAL, 0.095, "#e9dcff", (EX, 0, -0.12), 0.9),
       text("by", "by Hoa Hoang · @novahoangdev", ARIAL, 0.11, "#ffd27a", (EX, 0, -0.42), 1.0),
       text("love", "From @vgangstudio with love", ARIAL, 0.1, "#ffe6c4", (EX, 0, -0.7), 1.0)]
for i, ob in enumerate(end):
    f_in = F_CARD + FR(0.35) + 7 * i
    key(ob, "hide_render", 0, True); key(ob, "hide_render", f_in, False)
    z = ob.location.z
    for f, s, dz in ((f_in, 0.3, -0.25), (f_in + 10, 1.1, 0.02), (f_in + 20, 1.0, 0.0)):
        key(ob, "scale", f, (s, s, s)); key(ob, "location", f, (EX, 0, z + dz))


# ── dơi 3D: thân + hai cánh vỗ, tối màu, viền cam (fresnel) ──
def bat_material():
    m = bpy.data.materials.new("bat"); m.use_nodes = True
    nt = m.node_tree; b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = hexc("#120a14"); b.inputs["Roughness"].default_value = 0.6
    b.inputs["Emission Color"].default_value = hexc("#ff9a2e")
    b.inputs["Specular IOR Level"].default_value = 0.15
    lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.2
    pw = nt.nodes.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = 4.0
    k = nt.nodes.new("ShaderNodeMath"); k.operation = "MULTIPLY"; k.inputs[1].default_value = 2.5
    nt.links.new(lw.outputs["Facing"], pw.inputs[0]); nt.links.new(pw.outputs[0], k.inputs[0])
    nt.links.new(k.outputs[0], b.inputs["Emission Strength"])
    return m


BAT_M = bat_material()
WING = [(0.03, 0.05), (0.16, 0.12), (0.33, 0.11), (0.5, 0.17), (0.43, 0.03), (0.37, -0.07), (0.28, -0.02),
        (0.2, -0.1), (0.12, -0.04), (0.03, -0.09)]
wing_me = {}
for side in (1, -1):
    me = bpy.data.meshes.new(f"wing{side}"); bm = bmesh.new()
    vs = [bm.verts.new((side * x, y, 0)) for x, y in WING]
    bm.faces.new(vs if side > 0 else list(reversed(vs)))
    bm.to_mesh(me); bm.free(); me.materials.append(BAT_M); wing_me[side] = me
me = bpy.data.meshes.new("batbody"); bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1)
bmesh.ops.scale(bm, vec=(0.045, 0.11, 0.04), verts=bm.verts)
for sx in (1, -1):                              # tai
    v = [bm.verts.new((sx * 0.012, 0.09, 0.02)), bm.verts.new((sx * 0.04, 0.1, 0.02)), bm.verts.new((sx * 0.03, 0.16, 0.03))]
    bm.faces.new(v)
bm.to_mesh(me); bm.free(); me.materials.append(BAT_M); BODY_ME = me


def make_bat(name, f0, f1, path, size, rot, period=10):
    """path: [(frame, Vector)] ; dơi xuất hiện ở f0 (scale từ 0), vỗ cánh tới f1 rồi ẩn."""
    bat = link(bpy.data.objects.new(name, None))
    bdy = link(bpy.data.objects.new(name + "_b", BODY_ME)); bdy.parent = bat
    wings = []
    for side in (1, -1):
        wg = link(bpy.data.objects.new(f"{name}_w{side}", wing_me[side])); wg.parent = bat; wings.append((side, wg))
    for ob in [bdy] + [w_ for _, w_ in wings]:
        key(ob, "hide_render", 0, True); key(ob, "hide_render", f0, False); key(ob, "hide_render", f1, True)
    for f, p in path:
        key(bat, "location", f, p)
    s0, s1 = size
    key(bat, "scale", f0, (0.01, 0.01, 0.01)); key(bat, "scale", f0 + 6, (s0, s0, s0)); key(bat, "scale", f1, (s1, s1, s1))
    r0, r1 = rot
    key(bat, "rotation_euler", f0, tuple(rad(a) for a in r0)); key(bat, "rotation_euler", f1, tuple(rad(a) for a in r1))
    ph = rng.randint(0, period)
    for k, f in enumerate(range(f0 - ph, f1 + period, period // 2)):
        up = k % 2 == 0
        for side, wg in wings:
            key(wg, "rotation_euler", f, (0, rad(-side * (48 if up else -28)), 0))
    return bat


# vài con dơi nhỏ bay lững lờ sau end card
for i in range(3):
    f0 = F_CARD + FR(0.2 + 0.7 * i); f1 = FR(DUR) + 30
    y = rng.uniform(2.0, 3.5); z = rng.uniform(-0.4, 1.6)
    make_bat(f"cardbat{i}", f0, f1, [(f0, Vector((4.5, y, z))), (f1, Vector((-4.5, y, z + rng.uniform(0.3, 1.0))))],
             (0.3, 0.3), ((-20, 0, 80), (-20, 0, 80)), period=14)

# ── đom đóm / bụi bay lơ lửng sau máy (mờ theo độ sâu trường ảnh) ──
mote_m, mote_e = mat_emit("mote", "#9fb2e0", 2.0)
for f, c, s in ((0, "#9fb2e0", 2.0), (A(T_BLACK) - 1, "#9fb2e0", 2.0), (A(T_BLACK) + 6, "#9fb2e0", 0.4), (fb - 1, "#9fb2e0", 0.4),
                (fb, "#ffc070", 9.0), (fb + 30, "#ffb05a", 5.0), (A(T_BATS) + 20, "#ffb05a", 4.0)):
    key_sock(mote_e.inputs["Color"], f, hexc(c)); key_sock(mote_e.inputs["Strength"], f, s)
mote_me = bpy.data.meshes.new("mote"); bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1)
bm.to_mesh(mote_me); bm.free(); mote_me.materials.append(mote_m)
for i in range(80):
    ob = link(bpy.data.objects.new(f"mote{i}", mote_me))
    r = rng.uniform(0.01, 0.028); ob.scale = (r, r, r)
    x, y, z0 = rng.uniform(-5, 5), rng.uniform(0.7, 5.5), rng.uniform(-7.5, 2.5)
    rise = rng.uniform(0.12, 0.32) * DUR
    key(ob, "location", 0, (x, y, z0)); key(ob, "location", NF, (x + rng.uniform(-0.6, 0.6), y, z0 + rise))
    for fc in fcurves(ob):
        for k in fc.keyframe_points:
            k.interpolation = "LINEAR"
        if fc.array_index in (0, 2):
            m = fc.modifiers.new("NOISE"); m.scale, m.strength, m.phase = rng.uniform(60, 140), rng.uniform(0.08, 0.25), rng.uniform(0, 100)

# ── camera rig: focus (điểm nhìn, xoay = orbit) → shake → camera ở (0, −d, 0) ──
focus = link(bpy.data.objects.new("focus", None))
shake = link(bpy.data.objects.new("shake", None)); shake.parent = focus
cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 50; cam_d.sensor_fit = "VERTICAL"; cam_d.sensor_height = 24
cam_d.clip_start = 0.05
cam_d.dof.use_dof = True; cam_d.dof.focus_object = focus; cam_d.dof.aperture_fstop = 2.2
cam = link(bpy.data.objects.new("cam", cam_d)); sc.camera = cam
cam.parent = shake
cam.rotation_euler = (rad(90), 0, 0)
if LABEL:                                      # gắn vào camera nên đứng yên một góc màn hình
    lb = text("label", LABEL, DIN, 0.032, "#FFFFFF", (0, 0, 0), 0.75, align="LEFT")
    lb.parent = cam
    lb.location, lb.rotation_euler = (-0.6, -0.43, -2.0), (0, 0, 0)

def kphone(f, rot=(0, 0, 0), loc=(0, 0, 0)):
    key(phone, "rotation_euler", f, tuple(rad(a) for a in rot)); key(phone, "location", f, tuple(loc))


def phone_at(f):
    """Tư thế máy (độ, vị trí) ở frame f — đọc từ F-curve đã key."""
    rot, loc = [0.0] * 3, [0.0] * 3
    for fc in fcurves(phone):
        if fc.data_path == "rotation_euler":
            rot[fc.array_index] = math.degrees(fc.evaluate(f))
        elif fc.data_path == "location":
            loc[fc.array_index] = fc.evaluate(f)
    return rot, loc


def kcam(f, at, d, orbit=(0, 0)):
    """at: [x, y] điểm trên màn app (pt) hoặc {"world": [x,y,z]}; d: khoảng cách camera; orbit: [ngẩng, xoay] độ."""
    p = Vector(at["world"]) if isinstance(at, dict) else scr_world(*at, *phone_at(f))
    key(focus, "location", f, p); key(focus, "rotation_euler", f, (rad(orbit[0]), 0, rad(orbit[1])))
    key(cam, "location", f, (0, -d, 0))


def punch(f, amt=1.07, back=30):
    """punch-zoom: phóng nhanh bằng tiêu cự rồi nhả ra chậm (ease-out)."""
    key(cam_d, "lens", f - 1, 50); key(cam_d, "lens", f + 4, 50 * amt); key(cam_d, "lens", f + 4 + back, 50)


def kshake(f0, n, amp):
    for i in range(n):
        a = amp * (1 - i / n)
        key(shake, "rotation_euler", f0 + 2 * i, (rad(rng.uniform(-a, a)), rad(rng.uniform(-a, a) * 0.5), rad(rng.uniform(-a, a))))
    key(shake, "rotation_euler", f0 + 2 * n, (0, 0, 0))


def demo_tilt(t, lit_at):
    """Bản Python của demoTilt (app/src/demo/script.ts): (x, y) trong −1..1."""
    idle = (math.sin(t * 0.9) * 0.18, math.sin(t * 0.6 + 1) * 0.08)
    u = t - lit_at - 1.2
    if u < 0:
        return idle
    if u > 3.6:
        return (idle[0] * min(1, (u - 3.6) / 2), idle[1])
    e = lambda x: 0.5 - 0.5 * math.cos(math.pi * min(max(x, 0), 1))
    x = -e(u / 1.1) if u < 1.1 else (-1 + 2 * e((u - 1.1) / 1.6) if u < 2.7 else 1 - e((u - 2.7) / 0.9))
    return (x * 0.95, math.sin(u * 1.7) * 0.35)


def ease_all(idbs):
    # mọi chuyển động camera/máy dùng Bezier tự động (ease in/out, giữ yên giữa các nhịp)
    for idb in idbs:
        for fc in fcurves(idb):
            for k in fc.keyframe_points:
                k.interpolation = "BEZIER"; k.handle_left_type = k.handle_right_type = "AUTO_CLAMPED"
            fc.update()


CENTER = [201, 437]                            # tâm màn hình (pt)
key(shake, "rotation_euler", 0, (0, 0, 0)); key(cam_d, "lens", 0, 50)
# máy: key theo beat sheet + đoạn nghiêng khớp demoTilt
for k_ in BEATS["phone"]:
    kphone(TT(k_["t"]), k_.get("rot", (0, 0, 0)), k_.get("loc", (0, 0, 0)))
TL_ = BEATS.get("tilt")
if TL_:
    # parallax trong app: tilt.x > 0 → cảnh trôi sang trái → mép trái máy hướng về camera (rz > 0);
    # tilt.y > 0 → cảnh trôi lên → mép trên hướng về camera (rx > 0). App làm mượt tilt → trễ "lag" giây.
    t = TL_["from"]
    while t <= TL_["to"] + 1e-6:
        tx, ty = demo_tilt(t - TL_.get("lag", 0.1), TL_["lit_at"])
        w_ = min(1.0, (t - TL_["from"]) / TL_.get("ramp", 0.4))
        kphone(A(t), (TL_["rx"] * ty * w_, 0, TL_["rz"] * tx * w_))
        t = round(t + TL_.get("step", 0.15), 3)
ease_all([phone])
# camera: key theo beat sheet (điểm nhìn tính theo tư thế máy ở đúng frame đó)
for k_ in BEATS["camera"]:
    kcam(TT(k_["t"]), k_.get("at", CENTER), k_["d"], k_.get("orbit", (0, 0)))
if TL_:
    t = TL_["from"]
    while t <= TL_["to"] + 1e-6:
        tx, ty = demo_tilt(t - TL_.get("lag", 0.1), TL_["lit_at"])
        kcam(A(t), TL_.get("at", CENTER), TL_["d"] - TL_.get("d_tilt", 0) * abs(tx), (TL_.get("pitch", 0) * ty, TL_.get("yaw", 0) * tx))
        t = round(t + TL_.get("step", 0.15), 3)
for t_, amt, back in BEATS.get("punches", []):
    punch(TT(t_), amt, back)
for t_, n, amp in BEATS.get("shakes", []):
    kshake(TT(t_), n, amp)
# độ mờ hậu cảnh: cận cảnh mờ mạnh, toàn cảnh/end card nét hơn để đọc chữ
for t_, fs in BEATS.get("fstops", []):
    key(cam_d.dof, "aperture_fstop", TT(t_), fs)

# dơi lao ra khỏi màn hình về phía camera rồi bay qua (khoảnh khắc "hero")
BT = BEATS["bats"]
f_b = A(BT["t"])
BAT_SRC = scr_world(*BT.get("src", (201, 560)), *phone_at(f_b))
NB = BT.get("count", 16)
for i in range(NB):
    f0 = f_b + round(i * BT.get("spread", 1.5) * FPS / NB) + rng.randint(-3, 3)
    dur = FR(rng.uniform(0.95, 1.35))
    side = -1 if i % 2 else 1
    start = BAT_SRC + Vector((rng.uniform(-0.12, 0.12), -0.05, rng.uniform(-0.08, 0.1)))
    cam_y = -abs(BT.get("cam_d", 8.0))
    endp = Vector((side * rng.uniform(0.45, 1.7), cam_y - 2.5, rng.uniform(-0.7, 1.4)))   # sượt sát camera
    mid = start.lerp(endp, 0.45) + Vector((side * rng.uniform(0.1, 0.6), 0, rng.uniform(0.3, 0.9)))
    make_bat(f"bat{i}", f0, f0 + dur, [(f0, start), (f0 + dur * 0.45, mid), (f0 + dur, endp)],
             (0.24, rng.uniform(0.7, 1.0)), ((-70 + rng.uniform(-10, 10), side * rng.uniform(5, 25), side * rng.uniform(-30, -5)),
                                              (-55 + rng.uniform(-10, 10), side * rng.uniform(15, 35), side * rng.uniform(-40, -10))))

# ── compositor: bloom, chromatic aberration lúc nổ, vignette, light leak, loé sáng ──
tree = bpy.data.node_groups.new("promo_comp", "CompositorNodeTree")
tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
sc.compositing_node_group = tree
T, TL = tree.nodes, tree.links
rl = T.new("CompositorNodeRLayers"); rl.scene = sc
gl = T.new("CompositorNodeGlare")
gl.inputs["Type"].default_value = "Bloom"
gl.inputs["Threshold"].default_value = 0.8
gl.inputs["Size"].default_value = 0.7
TL.new(rl.outputs["Image"], gl.inputs["Image"])
for f, s in ((0, 0.25), (fb - 1, 0.25), (fb, 0.9), (fb + 24, 0.4)):
    key_sock(gl.inputs["Strength"], f, s)
ld = T.new("CompositorNodeLensdist")
TL.new(gl.outputs["Image"], ld.inputs["Image"])
for f, s in ((0, 0.0), (fb - 1, 0.0), (fb + 2, 0.05), (fb + 22, 0.004)):
    key_sock(ld.inputs["Dispersion"], f, s)
# vignette: ellipse (trong 1.0, ngoài 0.66) làm mờ rồi nhân vào ảnh
vg = T.new("CompositorNodeEllipseMask")
vg.inputs["Mask"].default_value = 0.66; vg.inputs["Value"].default_value = 0.34
vg.inputs["Size"].default_value = (1.05, 1.0)
try:
    vg.inputs["Operation"].default_value = "Add"
except TypeError as ex:
    print("ellipse op", ex)
vb = T.new("CompositorNodeBlur"); vb.inputs["Size"].default_value = (260 * PCT / 100, 260 * PCT / 100)
TL.new(vg.outputs[0], vb.inputs["Image"])
mul = T.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1.0
TL.new(ld.outputs["Image"], sock_in(mul, "A", "RGBA")); TL.new(vb.outputs["Image"], sock_in(mul, "B", "RGBA"))
# light leak: vệt sáng ấm mềm trôi chậm ở góc trên
lk = T.new("CompositorNodeEllipseMask")
lk.inputs["Mask"].default_value = 0.0; lk.inputs["Value"].default_value = 1.0
lk.inputs["Size"].default_value = (0.55, 0.45); lk.inputs["Rotation"].default_value = rad(-30)
try:
    lk.inputs["Operation"].default_value = "Add"
except TypeError:
    pass
for f, p in ((0, (-0.05, 1.05)), (NF, (0.3, 1.08))):
    key_sock(lk.inputs["Position"], f, p)
lb_ = T.new("CompositorNodeBlur"); lb_.inputs["Size"].default_value = (300 * PCT / 100, 300 * PCT / 100)
TL.new(lk.outputs[0], lb_.inputs["Image"])
lc = T.new("ShaderNodeMix"); lc.data_type = "RGBA"; lc.blend_type = "MULTIPLY"; lc.inputs["Factor"].default_value = 1.0
sock_in(lc, "A", "RGBA").default_value = hexc("#ff9a5a")
TL.new(lb_.outputs["Image"], sock_in(lc, "B", "RGBA"))
scr = T.new("ShaderNodeMix"); scr.data_type = "RGBA"; scr.blend_type = "SCREEN"
TL.new(sock_out(mul, "RGBA"), sock_in(scr, "A", "RGBA")); TL.new(sock_out(lc, "RGBA"), sock_in(scr, "B", "RGBA"))
for f, s in ((0, 0.07), (A(T_BLACK) - 1, 0.07), (A(T_BLACK) + 6, 0.0), (fb - 1, 0.0), (fb + 4, 0.3), (fb + 60, 0.16),
             (A(T_BATS), 0.16), (A(T_BATS) + 30, 0.08)):
    key_sock(scr.inputs["Factor"], f, s)
# loé sáng ấm lúc nến bùng
fl = T.new("ShaderNodeMix"); fl.data_type = "RGBA"; fl.blend_type = "ADD"
sock_in(fl, "B", "RGBA").default_value = hexc("#ffb060")
TL.new(sock_out(scr, "RGBA"), sock_in(fl, "A", "RGBA"))
for f, s in ((0, 0.0), (fb - 1, 0.0), (fb + 1, 0.28), (fb + 6, 0.1), (fb + 20, 0.0)):
    key_sock(fl.inputs["Factor"], f, s)
go = T.new("NodeGroupOutput")
TL.new(sock_out(fl, "RGBA"), go.inputs[0])

ease_all([focus, cam, shake, cam_d])

# ── dựng nhanh (notes/perf.md "Dựng promo nhanh"), bật bằng PROMO_FAST=1 ──
#   bóng tắt: cảnh gần như toàn Emission (nền, màn hình, chữ, kính); bóng chỉ rơi trên khung titan / nút / dơi và EEVEE
#     render bóng ảo mỗi mẫu TAA (đoạn dơi: 2,1 → 1,3 s/khung). So bật/tắt: PSNR 68 dB, SSIM 0,99998.
#   TAA 16 → 8: PSNR 69–70 dB so với 16 ở đoạn dơi lao sát ống kính và đoạn cận cảnh khắc (DOF f/2). Thấp hơn 8 không nhanh thêm.
if os.environ.get("PROMO_FAST") == "1":
    for l_ in bpy.data.lights:
        l_.use_shadow = False
    sc.eevee.taa_render_samples = int(os.environ.get("PROMO_TAA", "8"))
# --range a,b: chỉ dựng khung a..b (gồm b) → nhiều tiến trình song song, mỗi tiến trình một đoạn liền (tools/promo_par.sh)
RANGE = arg("--range", "")
if RANGE:
    a_, b_ = (int(x) for x in RANGE.split(","))
    sc.frame_start, sc.frame_end = max(0, a_), min(sc.frame_end, b_)
# --video out.mp4: ghi thẳng H.264 lossless thay vì PNG (bỏ ~0,25 s nén PNG mỗi khung; 0,8 MB/khung thay vì 3 MB)
VIDEO = arg("--video", "")
os.makedirs(OUT, exist_ok=True)
sc.render.image_settings.file_format = "PNG"
print(f"PROMO beats {os.path.basename(BEATS_PATH)} | timings: dur {DUR:.2f}s ({sc.frame_end + 1} frames), app t0 {APP0}, burst @ {fb / FPS:.2f}s, "
      f"bats @ {A(T_BATS) / FPS:.2f}s, end card @ {C_CARD:.2f}s")
STILLS = arg("--stills", "")
if STILLS:                                     # duyệt nhanh vài khoảnh khắc (giây trong clip promo)
    for sec in (float(x) for x in STILLS.split(",")):
        sc.frame_set(round(sec * OFPS))
        sc.render.filepath = os.path.join(OUT, f"still_{sec:06.3f}.png")
        bpy.ops.render.render(write_still=True)
    sys.exit(0)
sc.render.filepath = os.path.join(OUT, "####")
if VIDEO:
    if hasattr(sc.render.image_settings, "media_type"):   # Blender 5: chọn "video" trước rồi mới có FFMPEG
        sc.render.image_settings.media_type = "VIDEO"
    sc.render.image_settings.file_format = "FFMPEG"
    sc.render.ffmpeg.format = "MPEG4"
    sc.render.ffmpeg.codec = "H264"
    sc.render.ffmpeg.constant_rate_factor = "LOSSLESS"
    sc.render.ffmpeg.ffmpeg_preset = "REALTIME"
    sc.render.ffmpeg.gopsize = OFPS
    sc.render.use_file_extension = False
    sc.render.filepath = os.path.abspath(VIDEO)
print("PROMO frames", sc.frame_start, sc.frame_end)
bpy.ops.render.render(animation=True)
print("PROMO DONE", OUT)
