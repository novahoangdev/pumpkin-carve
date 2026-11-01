# Dựng toàn bộ cảnh bằng code: quả bí ngô (vỏ ngoài + thành trong + cuống + hạt), nến tealight, thềm gỗ, tường nhà,
# khung cửa, đèn hiên, lan can, phông trời có trăng, camera dọc 1320×2868 (iPhone 17 Pro Max, 440×956 pt @3x). Lưu blender/pumpkin.blend.
#
# Chạy: Blender -b --factory-startup -P blender/scripts/build_scene.py
# Đơn vị mét. Quả bí đặt ở gốc toạ độ, đáy chạm mặt thềm z = 0; camera nhìn theo hướng +y.
import bpy, bmesh, glob, math, os, random
from mathutils import Vector, Matrix, noise

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TEX = os.path.join(ROOT, "blender", "textures")
BLEND = os.environ.get("PC_BLEND", os.path.join(ROOT, "blender", "pumpkin.blend"))
rad = math.radians
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# ── kích thước chính ──
R = 0.17          # bán kính ngang quả bí
HZ = 0.74         # tỉ lệ dẹt theo chiều cao
LOBES = 10        # số múi (một múi nằm chính giữa mặt trước)
SHELL = 0.10      # thành trong = vỏ ngoài thu nhỏ 10 % (vỏ dày ~1,5 cm)
CAM_LOC = Vector((0.03, -0.95, 0.36))
CAM_LENS = 55


def hexc(h, a=1.0):
    h = h.lstrip("#")
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (a,)


def coll(name):
    c = bpy.data.collections.new(name)
    sc.collection.children.link(c)
    return c


C_PUMP, C_INNER, C_ENV, C_LIGHT = coll("pumpkin"), coll("inner"), coll("env"), coll("lights")


def obj(name, data, c):
    ob = bpy.data.objects.new(name, data)
    c.objects.link(ob)
    return ob


def img(name):
    p = os.path.join(TEX, name)
    return bpy.data.images.load(p, check_existing=True) if os.path.exists(p) else None


# ── vật liệu ──
class MB:
    """Helper dựng node vật liệu gọn."""

    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.m.use_nodes = True
        self.nt = self.m.node_tree
        self.n = self.nt.nodes
        self.bsdf = next(n for n in self.n if n.type == "BSDF_PRINCIPLED")
        self.out = next(n for n in self.n if n.type == "OUTPUT_MATERIAL")

    def node(self, t, **kw):
        nd = self.n.new(t)
        for k, v in kw.items():
            if k in nd.inputs:
                nd.inputs[k].default_value = v
            else:
                setattr(nd, k, v)
        return nd

    def link(self, a, b):
        self.nt.links.new(a, b)

    def set(self, **kw):
        for k, v in kw.items():
            self.bsdf.inputs[k.replace("_", " ")].default_value = v
        return self

    def mix(self, fac, a, b):
        mx = self.node("ShaderNodeMix", data_type="RGBA")
        sa = [s for s in mx.inputs if s.name == "A" and s.type == "RGBA"][0]
        sb = [s for s in mx.inputs if s.name == "B" and s.type == "RGBA"][0]
        for s, v in ((sa, a), (sb, b)):
            if isinstance(v, tuple):
                s.default_value = v
            else:
                self.link(v, s)
        if isinstance(fac, float):
            mx.inputs["Factor"].default_value = fac
        else:
            self.link(fac, mx.inputs["Factor"])
        return [o for o in mx.outputs if o.type == "RGBA"][0]

    def ramp(self, fac, stops):
        cr = self.node("ShaderNodeValToRGB")
        el = cr.color_ramp.elements
        el[0].position, el[0].color = stops[0][0], hexc(stops[0][1])
        el[1].position, el[1].color = stops[-1][0], hexc(stops[-1][1])
        for p, c in stops[1:-1]:
            e = el.new(p)
            e.color = hexc(c)
        self.link(fac, cr.inputs["Fac"])
        return cr.outputs["Color"]

    def noise(self, scale, detail=4.0, vec=None, rough=0.5):
        nz = self.node("ShaderNodeTexNoise", Scale=scale, Detail=detail, Roughness=rough)
        if vec is not None:
            self.link(vec, nz.inputs["Vector"])
        return nz

    def bump(self, height, strength, dist=0.002):
        b = self.node("ShaderNodeBump", Strength=strength, Distance=dist)
        self.link(height, b.inputs["Height"])
        self.link(b.outputs["Normal"], self.bsdf.inputs["Normal"])
        return b

    def tex(self, image, vec=None, proj="FLAT"):
        t = self.node("ShaderNodeTexImage")
        t.image = image
        t.projection = proj
        if proj == "BOX":
            t.projection_blend = 0.3
        if vec is not None:
            self.link(vec, t.inputs["Vector"])
        return t


def mat_pumpkin():
    mb = MB("pumpkin_skin")
    attr = mb.node("ShaderNodeAttribute", attribute_name="groove")
    tc = mb.node("ShaderNodeTexCoord")
    mott = mb.noise(9.0, 6.0, tc.outputs["Object"], 0.6)
    streak_v = mb.node("ShaderNodeMapping")
    streak_v.inputs["Scale"].default_value = (40.0, 40.0, 3.0)
    mb.link(tc.outputs["Object"], streak_v.inputs["Vector"])
    streak = mb.noise(1.0, 3.0, streak_v.outputs[0])
    # màu: múi #f07a1a → rãnh #b34a0c, lốm đốm + vệt dọc
    g = mb.node("ShaderNodeMath", operation="ADD")
    mb.link(attr.outputs["Fac"], g.inputs[0])
    sm = mb.node("ShaderNodeMath", operation="MULTIPLY_ADD", use_clamp=True)
    mb.link(streak.outputs["Fac"], sm.inputs[0]); sm.inputs[1].default_value = 0.35; sm.inputs[2].default_value = -0.17
    mb.link(sm.outputs[0], g.inputs[1])
    base = mb.ramp(g.outputs[0], [(0.0, "#ff9a2e"), (0.4, "#f37d1c"), (0.8, "#cf5a10"), (1.0, "#9c400a")])
    skin = img("skin_tile.jpg")
    if skin:   # texture vẽ tay: chỉ lấy biến thiên sáng tối, giữ màu chủ đạo ở ramp
        t = mb.tex(skin, tc.outputs["Object"], "BOX")
        mp = mb.node("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (3.0, 3.0, 3.0)
        mb.link(tc.outputs["Object"], mp.inputs["Vector"]); mb.link(mp.outputs[0], t.inputs["Vector"])
        ov = mb.node("ShaderNodeMix", data_type="RGBA", blend_type="OVERLAY")
        ov.inputs["Factor"].default_value = 0.8
        mb.link(base, [s for s in ov.inputs if s.name == "A" and s.type == "RGBA"][0])
        mb.link(t.outputs["Color"], [s for s in ov.inputs if s.name == "B" and s.type == "RGBA"][0])
        base = [o for o in ov.outputs if o.type == "RGBA"][0]
    dark = mb.mix(mott.outputs["Fac"], hexc("#b35512"), hexc("#ffffff"))
    mul = mb.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    mul.inputs["Factor"].default_value = 0.35
    mb.link(base, [s for s in mul.inputs if s.name == "A" and s.type == "RGBA"][0])
    mb.link(dark, [s for s in mul.inputs if s.name == "B" and s.type == "RGBA"][0])
    col = [o for o in mul.outputs if o.type == "RGBA"][0]
    mb.link(col, mb.bsdf.inputs["Base Color"])
    rough = mb.ramp(mott.outputs["Fac"], [(0.3, "#9a9a9a"), (0.7, "#c4c4c4")])
    mb.link(rough, mb.bsdf.inputs["Roughness"])
    mb.set(Subsurface_Weight=0.12, Subsurface_Scale=0.01, Specular_IOR_Level=0.3)
    mb.bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.45, 0.15)
    # vỏ sần + trầy nhẹ
    pores = mb.noise(220.0, 2.0, tc.outputs["Object"])
    scr_m = mb.node("ShaderNodeMapping"); scr_m.inputs["Scale"].default_value = (1.0, 1.0, 26.0)
    mb.link(tc.outputs["Object"], scr_m.inputs["Vector"])
    scratch = mb.noise(14.0, 8.0, scr_m.outputs[0], 0.7)
    h = mb.node("ShaderNodeMath", operation="ADD")
    mb.link(pores.outputs["Fac"], h.inputs[0]); mb.link(scratch.outputs["Fac"], h.inputs[1])
    mb.bump(h.outputs[0], 0.08)
    return mb.m


def mat_flesh():
    mb = MB("pumpkin_flesh")
    tc = mb.node("ShaderNodeTexCoord")
    mp = mb.node("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (30.0, 30.0, 5.0)
    mb.link(tc.outputs["Object"], mp.inputs["Vector"])
    fib = mb.noise(1.0, 8.0, mp.outputs[0], 0.65)
    col = mb.ramp(fib.outputs["Fac"], [(0.25, "#d98a2e"), (0.55, "#f2b45a"), (0.8, "#f8cf7a")])
    mb.link(col, mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.42, Subsurface_Weight=0.35, Subsurface_Scale=0.02)
    mb.bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.6, 0.2)
    mb.bump(fib.outputs["Fac"], 0.35)
    return mb.m


def mat_simple(name, color, rough=0.5, **kw):
    mb = MB(name).set(Base_Color=hexc(color), Roughness=rough)
    for k, v in kw.items():
        mb.bsdf.inputs[k.replace("_", " ")].default_value = v
    return mb.m


def mat_stem():
    mb = MB("stem")
    tc = mb.node("ShaderNodeTexCoord")
    mp = mb.node("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (90.0, 90.0, 4.0)
    mb.link(tc.outputs["Object"], mp.inputs["Vector"])
    fib = mb.noise(1.0, 6.0, mp.outputs[0])
    col = mb.ramp(fib.outputs["Fac"], [(0.2, "#3d3a1c"), (0.5, "#5b5a2e"), (0.8, "#8a8250")])
    mb.link(col, mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.8)
    mb.bump(fib.outputs["Fac"], 0.5)
    return mb.m


def mat_wood(name, tint="#6b5440", scale=1.0, tex_name="wood_tile.jpg", tile=0.9):
    mb = MB(name)
    tc = mb.node("ShaderNodeTexCoord")
    info = mb.node("ShaderNodeObjectInfo")
    t = img(tex_name)
    if t:
        mp = mb.node("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (1 / tile,) * 3
        mb.link(tc.outputs["Object"], mp.inputs["Vector"])
        off = mb.node("ShaderNodeVectorMath", operation="ADD")
        mb.link(mp.outputs[0], off.inputs[0]); mb.link(info.outputs["Random"], off.inputs[1])
        tx = mb.tex(t, off.outputs[0], "BOX")
        base = tx.outputs["Color"]
    else:
        mp = mb.node("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (2.0 * scale, 40.0 * scale, 40.0 * scale)
        mb.link(tc.outputs["Object"], mp.inputs["Vector"])
        grain = mb.noise(3.0, 8.0, mp.outputs[0], 0.7)
        base = mb.ramp(grain.outputs["Fac"], [(0.3, "#3a2e24"), (0.55, tint), (0.8, "#8a7660")])
    # mỗi tấm ván một sắc độ hơi khác
    var = mb.ramp(info.outputs["Random"], [(0.0, "#c9c0b8"), (1.0, "#ffffff")])
    mul = mb.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    mul.inputs["Factor"].default_value = 1.0
    mb.link(base, [s for s in mul.inputs if s.name == "A" and s.type == "RGBA"][0])
    mb.link(var, [s for s in mul.inputs if s.name == "B" and s.type == "RGBA"][0])
    tintm = mb.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    tintm.inputs["Factor"].default_value = 1.0
    mb.link([o for o in mul.outputs if o.type == "RGBA"][0], [s for s in tintm.inputs if s.name == "A" and s.type == "RGBA"][0])
    [s for s in tintm.inputs if s.name == "B" and s.type == "RGBA"][0].default_value = hexc(tint) if t else (1, 1, 1, 1)
    out = [o for o in tintm.outputs if o.type == "RGBA"][0]
    mb.link(out, mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.78)
    bw = mb.node("RGBToBW" if False else "ShaderNodeRGBToBW")
    mb.link(out, bw.inputs[0])
    mb.bump(bw.outputs[0], 0.25)
    return mb.m


def mat_emit(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes
    n.clear()
    e = n.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = hexc(color)
    e.inputs["Strength"].default_value = strength
    e.name = "emit"
    o = n.new("ShaderNodeOutputMaterial")
    m.node_tree.links.new(e.outputs[0], o.inputs[0])
    return m


M_SKIN, M_FLESH, M_STEM = mat_pumpkin(), mat_flesh(), mat_stem()
M_SEED = mat_simple("seed", "#efe3c0", 0.45, Subsurface_Weight=0.2)
M_STRING = mat_simple("string", "#e8a443", 0.5, Subsurface_Weight=0.3)
M_WAX = mat_simple("wax", "#f4ede0", 0.35, Subsurface_Weight=0.5)
M_TIN = mat_simple("tin", "#c9c9c9", 0.25, Metallic=1.0)
M_WICK = mat_simple("wick", "#1a1410", 0.9)
M_FLOOR = mat_wood("porch_floor", "#c8b8a8", tile=0.75)
M_STEP = mat_wood("porch_step", "#a89888", tile=0.75)
M_SIDING = mat_wood("siding", "#d0d6e0", tex_name="siding_tile.jpg", tile=0.9)
M_TRIM = mat_simple("trim", "#bdb6a6", 0.6)
M_DOOR = mat_wood("door", "#4a2c1c", tex_name="__none__")
M_IRON = mat_simple("iron", "#141414", 0.45, Metallic=0.8)
M_GLASS = mat_emit("lantern_glass", "#ffcf87", 6.0)
M_DIRT = mat_simple("yard", "#0b0e16", 0.95)


# ── quả bí ──
def pumpkin_shape(theta, phi):
    """Toạ độ điểm trên mặt quả bí theo góc cực theta (0 = đỉnh) và góc phương vị phi."""
    st, ct = math.sin(theta), math.cos(theta)
    groove = (1.0 - abs(math.sin(LOBES * phi / 2))) ** 2.6
    r = R * (1.0 - 0.075 * groove * st ** 0.6 - 0.012 * math.cos(LOBES * phi) * st)
    # lệch nhẹ cho tự nhiên
    d = Vector((st * math.cos(phi), st * math.sin(phi), ct))
    r *= 1.0 + 0.025 * noise.noise(d * 2.3 + Vector((3.1, 1.7, 0.4)))
    x, y = r * st * math.cos(phi), r * st * math.sin(phi)
    z = R * HZ * ct
    z -= R * 0.20 * math.exp(-(theta / 0.42) ** 2)            # lõm ở đỉnh quanh cuống
    z += R * 0.10 * math.exp(-((math.pi - theta) / 0.45) ** 2)  # lõm nhẹ ở đáy
    return Vector((x, y, z)), groove * st


def build_pumpkin_mesh(name, scale, flip):
    SEG, RING = 200, 100
    bm = bmesh.new()
    gl = bm.verts.layers.float.new("groove")
    rows = []
    for j in range(1, RING):
        th = math.pi * j / RING
        row = []
        for i in range(SEG):
            ph = 2 * math.pi * i / SEG
            p, g = pumpkin_shape(th, ph)
            v = bm.verts.new(p * scale)
            v[gl] = g
            row.append(v)
        rows.append(row)
    top, _ = pumpkin_shape(0.0, 0.0)
    bot, _ = pumpkin_shape(math.pi, 0.0)
    vt, vb = bm.verts.new(top * scale), bm.verts.new(bot * scale)
    for j in range(len(rows) - 1):
        for i in range(SEG):
            a, b = rows[j][i], rows[j][(i + 1) % SEG]
            c, d = rows[j + 1][(i + 1) % SEG], rows[j + 1][i]
            bm.faces.new((a, d, c, b))
    for i in range(SEG):
        bm.faces.new((vt, rows[0][i], rows[0][(i + 1) % SEG]))
        bm.faces.new((vb, rows[-1][(i + 1) % SEG], rows[-1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if flip:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    # chuyển lớp float của bmesh thành attribute "groove" cho shader
    for p in me.polygons:
        p.use_smooth = True
    return me


Z0 = -pumpkin_shape(math.pi, 0.0)[0].z    # nhấc lên để đáy chạm z = 0
PC = Vector((0.0, 0.0, Z0))                # tâm quả bí


def split_front_back(me, name, c, mat):
    """Tách mesh thành nửa trước (về phía camera) và nửa sau để pass lòng bí ẩn được nửa trước."""
    to_cam = (CAM_LOC - PC).normalized()
    parts = {}
    for side in ("front", "back"):
        bm = bmesh.new()
        bm.from_mesh(me)
        kill = [f for f in bm.faces if ((f.calc_center_median() + Vector((0, 0, Z0)) - PC).dot(to_cam) > 0.0) == (side == "back")]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        m2 = bpy.data.meshes.new(f"{name}_{side}")
        bm.to_mesh(m2)
        bm.free()
        m2.materials.append(mat)
        ob = obj(f"{name}_{side}", m2, c)
        ob.location = (0, 0, Z0)
        parts[side] = ob
    return parts


outer = build_pumpkin_mesh("outer", 1.0, False)
inner = build_pumpkin_mesh("inner", 1.0 - SHELL, True)
SKIN = split_front_back(outer, "skin", C_PUMP, M_SKIN)
WALL = split_front_back(inner, "wall", C_INNER, M_FLESH)


# cuống: ống xoắn có gờ, gốc loe, cong về một bên
def build_stem():
    bm = bmesh.new()
    N, K = 24, 28
    top_z = pumpkin_shape(0.0, 0.0)[0].z + Z0
    rings = []
    for k in range(K + 1):
        t = k / K
        a_ = t * 1.9                                   # cong dần sang phải rồi gập xuống như cuống khô
        c = Vector((0.045 * (1 - math.cos(a_)) + 0.004 * math.sin(t * 9), -0.012 * t, top_z - 0.012 + 0.05 * math.sin(a_)))
        rr = 0.014 * (1.0 + 1.3 * math.exp(-t * 8.0)) * (1.0 - 0.35 * t)
        # mặt cắt vuông góc với hướng cuống
        tan = Vector((0.045 * math.sin(a_), -0.012 / 1.9, 0.05 * math.cos(a_))).normalized()
        u = tan.cross(Vector((0, 1, 0))).normalized()
        v = tan.cross(u)
        ring = []
        for i in range(N):
            a = 2 * math.pi * i / N
            ridge = 1.0 + 0.16 * math.cos(6 * a + t * 2.5)
            ring.append(bm.verts.new(c + (u * math.cos(a) + v * math.sin(a)) * rr * ridge))
        rings.append(ring)
    for k in range(K):
        for i in range(N):
            bm.faces.new((rings[k][i], rings[k][(i + 1) % N], rings[k + 1][(i + 1) % N], rings[k + 1][i]))
    cap = bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("stem")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(M_STEM)
    return obj("stem", me, C_PUMP)


STEM = build_stem()


# lòng bí: hạt bám đáy và thành sau, vài sợi xơ, nến tealight ở giữa đáy
def inner_point(theta, phi, inset=0.0):
    p, _ = pumpkin_shape(theta, phi)
    return p * (1.0 - SHELL - inset) + Vector((0, 0, Z0))


def build_seeds():
    bm = bmesh.new()
    to_cam = (CAM_LOC - PC).normalized()
    n = 0
    while n < 70:
        th = random.uniform(1.6, 2.9) if n < 45 else random.uniform(0.7, 1.6)
        ph = random.uniform(0, 2 * math.pi)
        p = inner_point(th, ph, 0.004)
        if (p - PC).dot(to_cam) > -0.02:     # chỉ nửa sau (nhìn thấy qua lỗ khắc)
            continue
        nrm = (PC - p).normalized()
        g = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1.0)
        vs = g["verts"]
        bmesh.ops.scale(bm, vec=(0.0075, 0.0045, 0.0018), verts=vs)
        rot = Matrix.Rotation(random.uniform(0, 6.3), 4, "Z")
        align = nrm.to_track_quat("Z", "Y").to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=align @ rot, verts=vs)
        bmesh.ops.translate(bm, vec=p, verts=vs)
        n += 1
    me = bpy.data.meshes.new("seeds")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(M_SEED)
    return obj("seeds", me, C_INNER)


def build_strings():
    to_cam = (CAM_LOC - PC).normalized()
    for s in range(9):
        ph = random.uniform(0, 2 * math.pi)
        a = inner_point(random.uniform(0.5, 1.2), ph)
        b = inner_point(random.uniform(1.9, 2.6), ph + random.uniform(-0.6, 0.6))
        if (a - PC).dot(to_cam) > -0.03 or (b - PC).dot(to_cam) > -0.03:
            continue
        cu = bpy.data.curves.new(f"string{s}", "CURVE")
        cu.dimensions, cu.bevel_depth, cu.bevel_resolution = "3D", 0.0012, 2
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(1)
        mid = (a + b) / 2 + (PC - (a + b) / 2) * 0.35
        for bp, p in zip(sp.bezier_points, (a, b)):
            bp.co = p
            bp.handle_left = bp.handle_right = p + (mid - p) * 0.7
        cu.materials.append(M_STRING)
        obj(f"string{s}", cu, C_INNER)


build_seeds()
build_strings()

FLOOR_IN = inner_point(math.pi - 0.05, 0.0).z           # đáy trong lòng bí
CANDLE = Vector((0.0, 0.015, FLOOR_IN + 0.004))


def build_candle():
    r, h = 0.019, 0.016
    for name, rr, hh, z, m in (("tin", r, h, 0, M_TIN), ("wax", r * 0.93, 0.004, h - 0.004, M_WAX)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=rr, depth=hh, location=CANDLE + Vector((0, 0, z + hh / 2)))
        ob = bpy.context.active_object
        ob.name = "candle_" + name
        ob.data.materials.append(m)
        for c in ob.users_collection:
            c.objects.unlink(ob)
        C_INNER.objects.link(ob)
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.0012, depth=0.008, location=CANDLE + Vector((0.0005, 0, h + 0.003)))
    w = bpy.context.active_object
    w.name = "candle_wick"
    w.rotation_euler = (0, rad(10), 0)
    w.data.materials.append(M_WICK)
    for c in w.users_collection:
        c.objects.unlink(w)
    C_INNER.objects.link(w)
    return CANDLE + Vector((0, 0, h + 0.006))


WICK_TOP = build_candle()
FLAME = WICK_TOP + Vector((0, 0, 0.014))     # tâm ngọn lửa (app vẽ lửa procedural ở điểm này)


# ── thềm, tường, cửa, lan can, sân ──
def box(name, size, loc, mat, c=C_ENV, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    for cc in ob.users_collection:
        cc.objects.unlink(ob)
    c.objects.link(ob)
    bev = ob.modifiers.new("bevel", "BEVEL")
    bev.width, bev.segments = min(0.004, min(size) * 0.3), 2
    return ob


FRONT_EDGE, WALL_Y = -0.62, 1.55
# sàn hiên: một tấm phẳng, ván gỗ nằm trong texture (ván chạy ngang theo trục x)
box("floor", (4.0, WALL_Y - FRONT_EDGE, 0.035), (0.6, (WALL_Y + FRONT_EDGE) / 2, -0.0175), M_FLOOR)
box("joist", (4.2, 0.03, 0.2), (0.6, FRONT_EDGE + 0.01, -0.13), M_STEP)
# bậc thứ hai
box("step2", (4.0, 0.32, 0.04), (0.6, FRONT_EDGE - 0.15, -0.21), M_STEP)
box("step2_riser", (4.0, 0.02, 0.2), (0.6, FRONT_EDGE - 0.31, -0.32), M_STEP)
# sân đất phía dưới và phía trái
box("yard", (60, 60, 0.1), (0, 20, -0.48), M_DIRT)

# tường nhà bên phải: ván gỗ ốp ngang, từ x = -0.30 trở sang phải
WALL_X0 = -0.30
box("wall", (3.4, 0.05, 3.4), (WALL_X0 + 1.7, WALL_Y + 0.025, 1.7), M_SIDING)
box("corner_post", (0.11, 0.11, 3.4), (WALL_X0, WALL_Y - 0.03, 1.7), M_TRIM)
# cửa ra vào: khung trắng ngà, cánh gỗ tối có ô panel
DX0, DX1, DZ = 0.42, 1.30, 2.05
box("door", (DX1 - DX0, 0.04, DZ), ((DX0 + DX1) / 2, WALL_Y - 0.01, DZ / 2), M_DOOR)
for side in (DX0 - 0.05, DX1 + 0.05):
    box(f"trim{side:.2f}", (0.1, 0.05, DZ + 0.1), (side, WALL_Y - 0.03, DZ / 2), M_TRIM)
box("trim_top", (DX1 - DX0 + 0.2, 0.05, 0.12), ((DX0 + DX1) / 2, WALL_Y - 0.03, DZ + 0.06), M_TRIM)
box("threshold", (DX1 - DX0 + 0.2, 0.08, 0.03), ((DX0 + DX1) / 2, WALL_Y - 0.06, 0.015), M_TRIM)
for (u0, u1, v0, v1) in ((0.12, 0.45, 0.08, 0.42), (0.55, 0.88, 0.08, 0.42), (0.12, 0.45, 0.52, 0.9), (0.55, 0.88, 0.52, 0.9)):
    w_, h_ = (u1 - u0) * (DX1 - DX0), (v1 - v0) * DZ
    box(f"panel{u0}{v0}", (w_, 0.015, h_), (DX0 + (u0 + u1) / 2 * (DX1 - DX0), WALL_Y - 0.035, (v0 + v1) / 2 * DZ), M_DOOR)
box("knob", (0.035, 0.04, 0.035), (DX0 + 0.08, WALL_Y - 0.06, 0.98), M_TIN)
box("doormat", (0.7, 0.42, 0.012), ((DX0 + DX1) / 2, WALL_Y - 0.3, 0.006), mat_simple("mat", "#3f2a1a", 0.95))

# lan can bên trái (nối từ cột góc ra), sau lan can là sân mở ra bầu trời
RAIL_Y = WALL_Y - 0.03
box("rail_top", (2.2, 0.07, 0.05), (WALL_X0 - 1.1, RAIL_Y, 0.86), M_TRIM)
box("rail_bot", (2.2, 0.05, 0.04), (WALL_X0 - 1.1, RAIL_Y, 0.08), M_TRIM)
x = WALL_X0 - 0.12
while x > WALL_X0 - 2.2:
    box(f"baluster{x:.2f}", (0.035, 0.035, 0.76), (x, RAIL_Y, 0.47), M_TRIM)
    x -= 0.12
box("porch_post_far", (0.1, 0.1, 3.0), (WALL_X0 - 2.2, RAIL_Y, 1.5), M_TRIM)

# đèn hiên: hộp đèn lồng kim loại treo trên tường, kính phát sáng
LANTERN = Vector((WALL_X0 + 0.22, WALL_Y - 0.12, 1.32))
box("lantern_arm", (0.03, 0.12, 0.03), LANTERN + Vector((0, 0.07, 0.16)), M_IRON)
box("lantern_back", (0.1, 0.02, 0.22), LANTERN + Vector((0, 0.11, 0.03)), M_IRON)
box("lantern_cap", (0.15, 0.15, 0.03), LANTERN + Vector((0, 0, 0.13)), M_IRON)
box("lantern_base", (0.13, 0.13, 0.025), LANTERN + Vector((0, 0, -0.1)), M_IRON)
box("lantern_glass", (0.105, 0.105, 0.2), LANTERN + Vector((0, 0, 0.015)), M_GLASS)
for sx in (-1, 1):
    for sy in (-1, 1):
        box(f"lantern_bar{sx}{sy}", (0.012, 0.012, 0.22), LANTERN + Vector((sx * 0.057, sy * 0.057, 0.015)), M_IRON)

# phông trời: mặt phẳng lớn ở xa, ảnh vẽ tay (trăng, mây, hàng cây) chiếu đúng khung camera
SKY_D = 30.0
sky_img = img("sky.jpg")
skym = bpy.data.materials.new("sky")
skym.use_nodes = True
N = skym.node_tree.nodes
N.clear()
em = N.new("ShaderNodeEmission")
em.name = "emit"
if sky_img:
    t = N.new("ShaderNodeTexImage")
    t.image = sky_img
    t.extension = "EXTEND"
    skym.node_tree.links.new(t.outputs["Color"], em.inputs["Color"])
else:
    em.inputs["Color"].default_value = hexc("#1c2444")
em.inputs["Strength"].default_value = 1.0
o = N.new("ShaderNodeOutputMaterial")
skym.node_tree.links.new(em.outputs[0], o.inputs[0])

# ── camera ──
cam_d = bpy.data.cameras.new("cam")
cam_d.lens = CAM_LENS
cam_d.sensor_fit = "HORIZONTAL"
cam_d.sensor_width = 36
cam = obj("cam", cam_d, sc.collection)
cam.location = CAM_LOC
# nhìn vào điểm hơi cao hơn tâm bí để quả bí nằm ở 1/3 dưới khung
aim = PC + Vector((0, 0, 0.22))
cam.rotation_euler = (aim - CAM_LOC).to_track_quat("-Z", "Y").to_euler()
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y = 1320, 2868      # iPhone 17 Pro Max: 440×956 pt @3x

# phông trời đặt vuông góc trục nhìn, phủ kín khung (ảnh dọc 2:3 hay 9:16 đều được, cắt theo chiều ngang)
bpy.context.view_layer.update()
fwd = cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))
fwd_h = Vector((fwd.x, fwd.y, 0)).normalized()
# khung nhìn ở khoảng cách SKY_D: rộng 2·fw, cao 2·fh (m). Ảnh trời rộng 13 m (trăng ≈ 1/5 bề ngang khung),
# mép trên trùng mép trên khung, mép trái lệch ra ngoài khung 1 m → trăng nằm ở góc trên trái, hàng cây khuất sau lan can
fw = SKY_D * 18 / CAM_LENS
fh = fw * sc.render.resolution_y / sc.render.resolution_x
aspect = (sky_img.size[1] / sky_img.size[0]) if sky_img and sky_img.size[0] else 1.6
sw = 13.0
sh = sw * aspect
right = fwd_h.cross(Vector((0, 0, 1))).normalized()
up = right.cross(fwd).normalized()
top_c = CAM_LOC + fwd * SKY_D + up * fh          # điểm giữa mép trên khung
me = bpy.data.meshes.new("sky")
x0 = -fw - 1.0
corners = [(x0, -sh), (x0 + sw, -sh), (x0 + sw, 0.5), (x0, 0.5)]
me.from_pydata([tuple(top_c + right * cx + up * cy) for cx, cy in corners], [], [(0, 1, 2, 3)])
uvl = me.uv_layers.new()
for li, uv in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
    uvl.data[li].uv = uv
me.materials.append(skym)
sky = obj("sky", me, C_ENV)
sky.visible_shadow = False
sky.visible_diffuse = False
sky.visible_glossy = False

# ── đèn ──
def light(name, kind, energy, color, loc, **kw):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = hexc(color)[:3]
    for k_, v in kw.items():
        setattr(ld, k_, v)
    ob = obj(name, ld, C_LIGHT)
    ob.location = loc
    return ob


MOON_DIR = Vector((-0.45, 1.0, 0.55)).normalized()      # trăng phía sau bên trái, trên cao
moon = light("moon", "SUN", 0.7, "#c9d8ff", (0, 0, 5), angle=rad(1.5))
moon.rotation_euler = (-MOON_DIR).to_track_quat("-Z", "Y").to_euler()
fill = light("moon_fill", "AREA", 4.0, "#7d8fc4", (0.4, -1.6, 1.4), size=2.5)
fill.rotation_euler = (PC - fill.location).to_track_quat("-Z", "Y").to_euler()
porch = light("porch", "POINT", 45.0, "#ffbe74", LANTERN + Vector((0, -0.01, 0.015)), shadow_soft_size=0.05)
porch_key = light("porch_key", "AREA", 6.0, "#ffb866", (-0.55, -0.35, 0.9), size=0.4)
porch_key.rotation_euler = (PC + Vector((0, 0, 0.05)) - porch_key.location).to_track_quat("-Z", "Y").to_euler()
candle = light("candle", "POINT", 1.2, "#ff9a3c", FLAME, shadow_soft_size=0.006)
# ánh nến lên cảnh (pass bg_glow): nguồn điểm ở tâm lòng bí, vỏ/lòng bí ẩn hẳn → chỉ còn suy giảm hình học + bóng của
# vật khác; app tự nhân với tầm nhìn xuyên lỗ khắc (giải tích)
GLOW_SRC = PC + Vector((0, 0.0, 0.02))
glow = light("candle_glow", "POINT", 3.0, "#ff9a3c", GLOW_SRC, shadow_soft_size=0.05)

# world: ánh trời đêm rất nhẹ
w = bpy.data.worlds.new("night")
sc.world = w
w.use_nodes = True
bgn = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bgn.inputs["Color"].default_value = hexc("#141a33")
bgn.inputs["Strength"].default_value = 0.35

# ── render ──
try:
    sc.render.engine = "CYCLES"
except TypeError as e:
    print("engine", e)
prefs = bpy.context.preferences.addons["cycles"].preferences
for dt in ("METAL", "NONE"):
    try:
        prefs.compute_device_type = dt
        break
    except TypeError:
        pass
prefs.get_devices()
for d in prefs.devices:
    d.use = True
sc.cycles.device = "GPU" if prefs.compute_device_type != "NONE" else "CPU"
sc.cycles.samples = 64
sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
sc.view_settings.look = "None"
sc.view_settings.exposure = 0.6

# meta cho render_passes.py / layout.json
sc["pc_flame"] = list(FLAME)
sc["pc_center"] = list(PC)
sc["pc_radius"] = [R, R, R * HZ]
sc["pc_lantern"] = list(LANTERN)
sc["pc_glow_src"] = list(GLOW_SRC)
sc["pc_shell"] = SHELL * R        # độ dày vỏ (m) ở xích đạo: thành trong = vỏ ngoài thu nhỏ (1 − SHELL) quanh tâm bí

# chi tiết bổ sung (lá rụng, đèn lồng cổ, bí nhỏ, thảm, mạng nhện, dây leo…): mỗi file trong extras/ chạy ở đây,
# dùng chung globals của script này, chỉ thêm object vào `env` / `lights`.
# PC_EXTRAS=0 để tắt hết, PC_EXTRAS=porch_details.py:x.py để chỉ chạy vài file.
_extras = os.environ.get("PC_EXTRAS", "")
_xdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extras")
if _extras != "0":
    for _fn in ([os.path.join(_xdir, f) for f in _extras.split(":")] if _extras else sorted(glob.glob(os.path.join(_xdir, "*.py")))):
        print("EXTRAS", _fn)
        exec(compile(open(_fn).read(), _fn, "exec"), globals())

os.makedirs(os.path.dirname(BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print("SAVED", BLEND)
