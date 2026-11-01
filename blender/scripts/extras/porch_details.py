# Chi tiết hiên nhà cho clip v2: lá thu rụng trên sàn hiên + bậc dưới, đèn lồng cổ (carriage lantern) thay hộp đèn
# vuông, vài quả bí/bầu nhỏ cạnh cửa, thảm chùi chân xơ dừa, mạng nhện mảnh ở góc cột, dây leo khô quấn cột góc.
# Chạy cuối build_scene.py (trước khi lưu), dùng chung globals của nó: sc, C_ENV, MB, hexc, img, box, LANTERN, PC, R...
# Mọi object mới nằm trong collection `env` để render_passes.py coi là nền. RNG riêng, không đụng `random` chung.
#
# PC_PORCH=leaves,lantern,gourds,mat,web,vines   chỉ dựng vài phần (mặc định: tất cả)
import math as _m
import random as _random_mod
import bmesh as _bmesh
import bpy as _bpy
from mathutils import Vector as _V, Matrix as _Mx
from bpy_extras.object_utils import world_to_camera_view as _w2c

_rng = _random_mod.Random(1031)
_PARTS = set((os.environ.get("PC_PORCH") or "leaves,lantern,gourds,mat,web,vines").split(","))
_NEW = {}                                   # phần → danh sách object, để kiểm tra đè khung crop của quả bí


def _reg(part, ob):
    _NEW.setdefault(part, []).append(ob)
    return ob


def _mesh_obj(name, bm, mat, smooth=False, c=None):
    me = _bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    if mat is not None:
        me.materials.append(mat)
    return obj(name, me, c or C_ENV)


def _rgba_in(nd, name="A"):
    return [s for s in nd.inputs if s.name == name and s.type == "RGBA"][0]


def _rgba_out(nd):
    return [o for o in nd.outputs if o.type == "RGBA"][0]


# ───────────────────────── vật liệu ─────────────────────────
def _mat_leaf(name, dry=False):
    """Lá từ atlas 4×2 (alpha thật), nhân với màu riêng từng lá (attribute 'tint' theo góc mặt)."""
    mb = MB(name)
    atlas = img("leaves_atlas.png")
    tint = mb.node("ShaderNodeAttribute", attribute_name="tint")
    if atlas:
        t = mb.tex(atlas)
        t.interpolation = "Cubic"
        mul = mb.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        mul.inputs["Factor"].default_value = 1.0
        mb.link(t.outputs["Color"], _rgba_in(mul, "A"))
        mb.link(tint.outputs["Color"], _rgba_in(mul, "B"))
        mb.link(_rgba_out(mul), mb.bsdf.inputs["Base Color"])
        mb.link(t.outputs["Alpha"], mb.bsdf.inputs["Alpha"])
        bw = mb.node("ShaderNodeRGBToBW")
        mb.link(t.outputs["Color"], bw.inputs[0])
        mb.bump(bw.outputs[0], 0.25)                  # gân lá nổi nhẹ
    else:                                              # thiếu texture: lá phẳng màu cam đất
        mb.link(tint.outputs["Color"], mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.62 if not dry else 0.75, Specular_IOR_Level=0.35)
    return mb.m


def _mat_gourd(name, light, mid, groove, rough=0.45, top=None, speck=0.25):
    """Vỏ bí/bầu nhỏ: màu theo rãnh múi (attribute 'groove'), lốm đốm, sần nhẹ. top: màu đầu cuống (bầu hai màu)."""
    mb = MB(name)
    attr = mb.node("ShaderNodeAttribute", attribute_name="groove")
    tc = mb.node("ShaderNodeTexCoord")
    mott = mb.noise(14.0, 5.0, tc.outputs["Object"], 0.6)
    col = mb.ramp(attr.outputs["Fac"], [(0.0, light), (0.45, mid), (1.0, groove)])
    if top:
        sep = mb.node("ShaderNodeSeparateXYZ")
        mb.link(tc.outputs["Generated"], sep.inputs[0])
        g = mb.ramp(sep.outputs["Z"], [(0.45, "#ffffff"), (0.62, "#000000")])
        bw = mb.node("ShaderNodeRGBToBW")
        mb.link(g, bw.inputs[0])
        col = mb.mix(bw.outputs[0], col, hexc(top))
    dark = mb.mix(mott.outputs["Fac"], hexc("#8a7a66"), hexc("#ffffff"))
    mul = mb.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    mul.inputs["Factor"].default_value = speck
    mb.link(col, _rgba_in(mul, "A"))
    mb.link(dark, _rgba_in(mul, "B"))
    mb.link(_rgba_out(mul), mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=rough, Specular_IOR_Level=0.35, Subsurface_Weight=0.08, Subsurface_Scale=0.005)
    pores = mb.noise(260.0, 2.0, tc.outputs["Object"])
    mb.bump(pores.outputs["Fac"], 0.06)
    return mb.m


def _mat_iron():
    """Sắt đen cũ của đèn lồng: kim loại hơi ánh đồng, độ nhám loang."""
    mb = MB("lantern_iron")
    tc = mb.node("ShaderNodeTexCoord")
    nz = mb.noise(60.0, 4.0, tc.outputs["Object"], 0.6)
    col = mb.ramp(nz.outputs["Fac"], [(0.35, "#120f0d"), (0.7, "#2a2018")])
    mb.link(col, mb.bsdf.inputs["Base Color"])
    rough = mb.ramp(nz.outputs["Fac"], [(0.3, "#5a5a5a"), (0.75, "#8c8c8c")])
    mb.link(rough, mb.bsdf.inputs["Roughness"])
    mb.set(Metallic=0.85)
    mb.bump(nz.outputs["Fac"], 0.15)
    return mb.m


# ───────────────────────── 1. lá rụng ─────────────────────────
_LEAF_TINTS = [  # nhân lên màu gốc của atlas: phần lớn giữ nguyên, vài lá ngả nâu, ít lá khô sẫm
    ((1.0, 1.0, 1.0), 40), ((1.0, 0.86, 0.78), 20), ((0.92, 0.72, 0.6), 18), ((0.75, 0.6, 0.5), 10),
    ((0.42, 0.32, 0.26), 12),
]


def _pick_tint(dark_bias=0.0):
    if _rng.random() < dark_bias:
        return _LEAF_TINTS[-1][0]
    tot = sum(w for _, w in _LEAF_TINTS)
    x = _rng.uniform(0, tot)
    for c, w in _LEAF_TINTS:
        x -= w
        if x <= 0:
            return c
    return _LEAF_TINTS[0][0]


def _add_leaf(bm, tint_l, loc, size, yaw, cell, tilt=(0.0, 0.0), curl=None, rest_z=None, n=5, mat_fn=None):
    """Một lá: lưới (n+1)², UV vào ô `cell` của atlas, cong dọc gân + mép vểnh, xoay rồi đặt nằm trên mặt z = rest_z.
    rest_z = None: giữ nguyên toạ độ z của loc (lá treo trên dây leo, mat_fn quyết định hướng)."""
    col, row = cell % 4, cell // 4
    u0, v0 = col / 4, 1.0 - (row + 1) / 2
    c1, c2, c3 = curl or (_rng.uniform(-0.10, 0.2), _rng.uniform(0.0, 0.16), _rng.uniform(-0.06, 0.06))
    ph = _rng.uniform(0, 6.3)
    rot = _Mx.Rotation(yaw, 3, "Z") @ _Mx.Rotation(tilt[0], 3, "X") @ _Mx.Rotation(tilt[1], 3, "Y")
    pts = []
    for j in range(n + 1):
        for i in range(n + 1):
            u, v = i / n, j / n
            a, b = 2 * u - 1, 2 * v - 1
            z = size * (c1 * a * a + c2 * b * b * (1 if b > 0 else 0.4) + c3 * a * b + 0.018 * _m.sin(3 * a + ph))
            p = _V(((u - 0.5) * size, (v - 0.5) * size, z))
            p = mat_fn(p) if mat_fn else rot @ p
            pts.append((p, (u0 + u * 0.25, v0 + v * 0.5)))
    if rest_z is not None:
        lift = rest_z + 0.0012 + _rng.uniform(0, 0.003) - min(p.z for p, _ in pts)
        off = _V((loc.x, loc.y, lift))
    else:
        off = loc
    vs = [bm.verts.new(p + off) for p, _ in pts]
    uvl = bm.loops.layers.uv.verify()
    tl = bm.loops.layers.float_color.get("tint") or bm.loops.layers.float_color.new("tint")
    for j in range(n):
        for i in range(n):
            ids = (j * (n + 1) + i, j * (n + 1) + i + 1, (j + 1) * (n + 1) + i + 1, (j + 1) * (n + 1) + i)
            f = bm.faces.new([vs[k] for k in ids])
            for lp, k in zip(f.loops, ids):
                lp[uvl].uv = pts[k][1]
                lp[tl] = (*tint_l, 1.0)
    return vs


def _floor_z(x, y):
    """Mặt đỡ lá: sàn hiên z = 0, thảm chùi chân dày 1,2 cm, bậc dưới z = -0,19."""
    if y < FRONT_EDGE:
        return -0.19
    if _MAT_X0 < x < _MAT_X1 and _MAT_Y0 < y < _MAT_Y1:
        return 0.012
    return 0.0


_GOURD_SPOTS = []                           # (x, y, r): lá tránh chỗ đặt bí nhỏ


def _leaf_ok(x, y, s):
    if _m.hypot(x - PC.x, y - PC.y) < R + 0.045 + s * 0.45:        # không chui vào/đè chân quả bí chính
        return False
    if -0.6 < y < -0.15 and abs(x) < 0.25 and _rng.random() > 0.04:   # vùng app chiếu bóng mặt khắc: gần như để trống
        return False
    if y > WALL_Y - 0.02 - s * 0.45:                                 # không cắm vào tường / lan can
        return False
    if WALL_X0 - 0.07 - s * 0.4 < x < WALL_X0 + 0.07 + s * 0.4 and y > RAIL_Y - 0.07 - s * 0.4:   # cột góc
        return False
    if DX0 - 0.16 < x < DX1 + 0.16 and y > WALL_Y - 0.11 - s * 0.4:                          # ngạch cửa
        return False
    if not (-1.35 < x < 2.5 and FRONT_EDGE - 0.3 < y):
        return False
    if FRONT_EDGE - 0.02 < y < FRONT_EDGE + 0.01 + s * 0.4:       # mép sàn: lá không treo lơ lửng
        return False
    for gx, gy, gr in _GOURD_SPOTS:
        if _m.hypot(x - gx, y - gy) < gr + s * 0.35:
            return False
    return True


def _leaves():
    bm = _bmesh.new()
    # (trọng số, hàm sinh x, y, kích thước, độ thiên về lá sẫm)
    regions = [
        (30, lambda: (_rng.uniform(-0.85, -0.36), WALL_Y - 0.05 - abs(_rng.gauss(0, 0.2))), 0.25),   # góc lan can trái
        (10, lambda: (_rng.uniform(-0.3, 0.3), WALL_Y - 0.06 - abs(_rng.gauss(0, 0.1))), 0.2),      # chân tường sau bí
        (24, lambda: (_rng.uniform(0.3, 1.0), WALL_Y - 0.12 - abs(_rng.gauss(0, 0.25))), 0.15),     # góc cửa, cạnh thảm
        (18, lambda: (-_rng.uniform(0.2, 0.5), _rng.uniform(-0.12, 1.1)), 0.1),                    # sàn bên trái bí
        (18, lambda: (_rng.uniform(0.2, 0.55), _rng.uniform(-0.12, 1.1)), 0.1),                    # sàn bên phải bí
        (9, lambda: (lambda a, r: (PC.x + r * _m.cos(a), PC.y + r * _m.sin(a)))(
            _rng.uniform(rad(-25), rad(205)), _rng.uniform(0.22, 0.3)), 0.1),                      # sát chân bí (sau/hai bên)
        (4, lambda: (_rng.choice((-1, 1)) * _rng.uniform(0.2, 0.32), _rng.uniform(-0.5, -0.15)), 0.3),  # tiền cảnh: chỉ ở mép khung
        (8, lambda: (_rng.uniform(-0.6, 0.7), _rng.uniform(FRONT_EDGE - 0.28, FRONT_EDGE - 0.04)), 0.3),  # bậc dưới
    ]
    tot = sum(w for w, _, _ in regions)
    placed = 0
    tries = 0
    while placed < 175 and tries < 6000:
        tries += 1
        x_ = _rng.uniform(0, tot)
        for w, fn, db in regions:
            x_ -= w
            if x_ <= 0:
                break
        x, y = fn()
        s = _rng.uniform(0.065, 0.11)
        if not _leaf_ok(x, y, s):
            continue
        cell = _rng.randrange(8)
        tint = _pick_tint(db)
        tilt = (_rng.uniform(-0.12, 0.12), _rng.uniform(-0.12, 0.12))
        _add_leaf(bm, tint, _V((x, y, 0)), s, _rng.uniform(0, 6.3), cell, tilt, rest_z=_floor_z(x, y))
        placed += 1
    ob = _mesh_obj("porch_leaves", bm, _mat_leaf("leaf"), smooth=True)
    print("PORCH leaves", placed)
    return _reg("leaves", ob)


# ───────────────────────── 2. đèn lồng cổ ─────────────────────────
def _lathe(bm, prof, sides, rot0=0.0, center=_V()):
    """Khối tròn xoay (hoặc lăng trụ n cạnh) theo profile [(z, r)], đóng hai đầu. r = 0 ở đầu mút → chụm thành đỉnh."""
    rings = []
    for z, r in prof:
        if r <= 1e-6:
            rings.append([bm.verts.new(center + _V((0, 0, z)))])
        else:
            rings.append([bm.verts.new(center + _V((r * _m.cos(rot0 + 2 * _m.pi * i / sides),
                                                    r * _m.sin(rot0 + 2 * _m.pi * i / sides), z)))
                          for i in range(sides)])
    for a, b in zip(rings, rings[1:]):
        for i in range(sides):
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                bm.faces.new((a[0], b[(i + 1) % sides], b[i]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[(i + 1) % sides], b[0]))
            else:
                bm.faces.new((a[i], a[(i + 1) % sides], b[(i + 1) % sides], b[i]))
    for ring, rev in ((rings[0], True), (rings[-1], False)):
        if len(ring) > 2:
            bm.faces.new(ring[::-1] if rev else ring)
    return rings


def _rod(bm, p0, p1, r, sides=6):
    d = p1 - p0
    q = d.normalized().to_track_quat("Z", "Y").to_matrix()
    rings = []
    for p in (p0, p1):
        rings.append([bm.verts.new(p + q @ _V((r * _m.cos(2 * _m.pi * i / sides), r * _m.sin(2 * _m.pi * i / sides), 0)))
                      for i in range(sides)])
    a, b = rings
    for i in range(sides):
        bm.faces.new((a[i], a[(i + 1) % sides], b[(i + 1) % sides], b[i]))
    bm.faces.new(a[::-1])
    bm.faces.new(b)


def _torus(bm, center, R_, r_, axis_rot, seg=20, ring=8):
    verts = []
    for i in range(seg):
        a = 2 * _m.pi * i / seg
        row = []
        for j in range(ring):
            b = 2 * _m.pi * j / ring
            p = _V(((R_ + r_ * _m.cos(b)) * _m.cos(a), (R_ + r_ * _m.cos(b)) * _m.sin(a), r_ * _m.sin(b)))
            row.append(bm.verts.new(center + axis_rot @ p))
        verts.append(row)
    for i in range(seg):
        for j in range(ring):
            bm.faces.new((verts[i][j], verts[(i + 1) % seg][j], verts[(i + 1) % seg][(j + 1) % ring], verts[i][(j + 1) % ring]))


def _curve(name, pts, bevel, mat, radii=None, c=None, res=12):
    """Ống cong mượt (NURBS) qua các điểm, bán kính từng điểm để vuốt nhọn."""
    cu = _bpy.data.curves.new(name, "CURVE")
    cu.dimensions, cu.bevel_depth, cu.bevel_resolution = "3D", bevel, 3
    cu.use_fill_caps = True
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for k, p in enumerate(pts):
        sp.points[k].co = (*p, 1.0)
        sp.points[k].radius = radii[k] if radii else 1.0
    sp.use_endpoint_u = True
    sp.order_u = min(4, len(pts))
    sp.resolution_u = res
    cu.materials.append(mat)
    return obj(name, cu, c or C_ENV)


def _lantern():
    # bỏ hộp đèn vuông của build_scene (giữ vật liệu lantern_glass: render_passes.py điều khiển node "emit" của nó)
    for ob in [o for o in C_ENV.objects if o.name.startswith("lantern_")]:
        _bpy.data.objects.remove(ob, do_unlink=True)
    L = _V(sc["pc_lantern"])
    iron = _mat_iron()
    zb, zt, rb, rt = -0.085, 0.115, 0.056, 0.07         # kính: lăng trụ 6 cạnh loe dần lên trên, một mặt quay ra camera
    # kính phát sáng: điểm nóng giữa ô kính (như có ngọn đèn sau kính), mép ngả cam; trung bình ≈ màu cũ #ffcf87
    nt = M_GLASS.node_tree
    em = nt.nodes["emit"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    sx = nt.nodes.new("ShaderNodeMath"); sx.operation = "DIVIDE"; sx.inputs[1].default_value = 0.075
    sz = nt.nodes.new("ShaderNodeMath"); sz.operation = "DIVIDE"; sz.inputs[1].default_value = 0.12
    nt.links.new(sep.outputs["X"], sx.inputs[0]); nt.links.new(sep.outputs["Z"], sz.inputs[0])
    cmb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(sx.outputs[0], cmb.inputs["X"]); nt.links.new(sz.outputs[0], cmb.inputs["Z"])
    ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    nt.links.new(cmb.outputs[0], ln.inputs[0])
    cr = nt.nodes.new("ShaderNodeValToRGB")
    el = cr.color_ramp.elements
    el[0].position, el[0].color = 0.0, hexc("#fff2d2")
    el[1].position, el[1].color = 1.05, hexc("#e8913a")
    e = el.new(0.45); e.color = hexc("#ffd08a")
    nt.links.new(ln.outputs["Value"], cr.inputs["Fac"])
    # kính "seeded glass": lốm đốm rất nhẹ
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 90.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"
    mx.inputs["Factor"].default_value = 0.12
    nt.links.new(cr.outputs["Color"], _rgba_in(mx, "A")); nt.links.new(nz.outputs["Color"], _rgba_in(mx, "B"))
    nt.links.new(_rgba_out(mx), em.inputs["Color"])

    bm = _bmesh.new()
    _lathe(bm, [(zb, rb), (zt, rt)], 6)
    glass = _mesh_obj("lantern_glass", bm, M_GLASS)
    glass.location = L
    _reg("lantern", glass)

    bm = _bmesh.new()
    # 6 thanh dọc ở các cạnh kính
    for i in range(6):
        a = 2 * _m.pi * i / 6
        d = _V((_m.cos(a), _m.sin(a), 0))
        _rod(bm, d * (rb + 0.002) + _V((0, 0, zb - 0.004)), d * (rt + 0.002) + _V((0, 0, zt + 0.004)), 0.0042)
    # đai dưới, chậu đáy thuôn, quả nhọn treo dưới
    _lathe(bm, [(zb - 0.016, rb + 0.008), (zb + 0.007, rb + 0.006)], 6)
    _lathe(bm, [(zb - 0.016, rb + 0.004), (zb - 0.032, rb * 0.72), (zb - 0.05, rb * 0.34), (zb - 0.058, 0.012)], 6)
    # đai trên, mái chóp 6 mặt hơi lõm có vành hắt, cổ ống khói, nắp
    _lathe(bm, [(zt - 0.008, rt + 0.005), (zt + 0.009, rt + 0.007)], 6)
    _lathe(bm, [(zt + 0.008, rt + 0.026), (zt + 0.017, rt + 0.028), (zt + 0.024, rt + 0.012), (zt + 0.042, rt * 0.6),
                (zt + 0.06, rt * 0.34), (zt + 0.072, 0.022), (zt + 0.084, 0.02), (zt + 0.086, 0.029),
                (zt + 0.094, 0.029), (zt + 0.1, 0.017), (zt + 0.104, 0.0)], 6)
    frame = _mesh_obj("lantern_frame", bm, iron)
    frame.location = L
    _reg("lantern", frame)
    bev = frame.modifiers.new("bevel", "BEVEL")
    bev.width, bev.segments, bev.limit_method = 0.0012, 1, "ANGLE"

    bm = _bmesh.new()
    # núm trên đỉnh + vòng treo, quả nhọn dưới đáy (tròn, mượt)
    _lathe(bm, [(zt + 0.1, 0.005), (zt + 0.106, 0.011), (zt + 0.117, 0.0115), (zt + 0.124, 0.005), (zt + 0.142, 0.0)], 16)
    _lathe(bm, [(zb - 0.056, 0.008), (zb - 0.063, 0.0125), (zb - 0.072, 0.012), (zb - 0.08, 0.006), (zb - 0.097, 0.0)], 16)
    _torus(bm, _V((0, 0, zt + 0.152)), 0.009, 0.0026, _Mx.Rotation(_m.pi / 2, 3, "X"))
    fin = _mesh_obj("lantern_finials", bm, iron, smooth=True)
    fin.location = L
    _reg("lantern", fin)

    # tay treo cổ ngỗng: đế ốp tường bầu dục bên phải đèn, cong lên rồi vươn ra móc vào vòng treo
    bx = L.x + 0.13
    bm = _bmesh.new()
    _lathe(bm, [(-0.006, 0.0), (-0.006, 0.9), (0.0, 1.0), (0.006, 0.9), (0.006, 0.0)], 28)
    for v in bm.verts:                                 # đĩa tròn → bầu dục đứng, mặt phẳng song song tường
        v.co = _V((v.co.x * 0.034, v.co.z, v.co.y * 0.1))
    plate = _mesh_obj("lantern_plate", bm, iron, smooth=True)
    plate.location = (bx, WALL_Y - 0.007, L.z + 0.08)
    _reg("lantern", plate)
    z_hook = L.z + zt + 0.158
    arm = [(bx, WALL_Y - 0.012, L.z + 0.02), (bx + 0.012, WALL_Y - 0.03, L.z + 0.17), (bx - 0.005, WALL_Y - 0.06, L.z + 0.3),
           (bx - 0.06, L.y + 0.04, L.z + 0.345), (L.x + 0.012, L.y + 0.005, L.z + 0.33), (L.x, L.y, z_hook + 0.03),
           (L.x, L.y, z_hook)]
    _reg("lantern", _curve("lantern_arm", arm, 0.0055, iron, [1.2, 1.1, 1.0, 0.95, 0.9, 0.8, 0.75]))
    # hoa văn xoắn ốc dưới tay treo (song song mặt tường để camera thấy rõ)
    cx, cz = bx - 0.045, L.z + 0.2
    sp = []
    for k in range(26):
        t = k / 25
        a = _m.pi * 0.15 + t * 2.6 * _m.pi
        rr = 0.034 * (1 - 0.78 * t)
        sp.append((cx + rr * _m.cos(a), WALL_Y - 0.035 - 0.012 * t, cz + rr * _m.sin(a)))
    sp.insert(0, (bx + 0.006, WALL_Y - 0.03, L.z + 0.17))
    _reg("lantern", _curve("lantern_scroll", sp, 0.0035, iron, [1.0] * 6 + [0.9] * 10 + [0.7] * 11))
    # xoắn nhỏ ở đỉnh tay treo
    sp2 = []
    for k in range(18):
        t = k / 17
        a = -_m.pi * 0.4 + t * 2.2 * _m.pi
        rr = 0.02 * (1 - 0.75 * t)
        sp2.append((bx + 0.012 + rr * _m.cos(a), WALL_Y - 0.05, L.z + 0.31 + 0.02 + rr * _m.sin(a)))
    _reg("lantern", _curve("lantern_curl", sp2, 0.003, iron, [1.0] * 6 + [0.7] * 12))
    print("PORCH lantern at", tuple(round(c, 3) for c in L))


# ───────────────────────── 3. bí / bầu nhỏ cạnh cửa ─────────────────────────
def _gourd_mesh(name, r, hz, lobes, depth, pear=0.0, seg=72, ring=40):
    bm = _bmesh.new()
    gl = bm.verts.layers.float.new("groove")
    rows = []

    def shape(th, ph):
        st, ct = _m.sin(th), _m.cos(th)
        groove = (1.0 - abs(_m.sin(lobes * ph / 2))) ** 2.4 if lobes else 0.0
        rr = r * (1.0 - depth * groove * st ** 0.6)
        d = _V((st * _m.cos(ph), st * _m.sin(ph), ct))
        rr *= 1.0 + 0.03 * noise.noise(d * 2.0 + _V((r * 40, 1.3, 0.2)))
        z = r * hz * ct
        if pear:                                       # bầu hồ lô: đáy phình, cổ thon dài lên trên
            up = max(0.0, ct)
            rr *= 1.0 - pear * 0.55 * up ** 0.9
            z = r * hz * ct * (1.0 + pear * 1.3 * up)
        else:
            z -= r * 0.22 * _m.exp(-(th / 0.45) ** 2)
            z += r * 0.08 * _m.exp(-((_m.pi - th) / 0.5) ** 2)
        return _V((rr * st * _m.cos(ph), rr * st * _m.sin(ph), z)), groove * st

    for j in range(1, ring):
        th = _m.pi * j / ring
        row = []
        for i in range(seg):
            p, g = shape(th, 2 * _m.pi * i / seg)
            v = bm.verts.new(p)
            v[gl] = g
            row.append(v)
        rows.append(row)
    vt = bm.verts.new(shape(0.0, 0.0)[0])
    vb = bm.verts.new(shape(_m.pi, 0.0)[0])
    for j in range(len(rows) - 1):
        for i in range(seg):
            bm.faces.new((rows[j][i], rows[j + 1][i], rows[j + 1][(i + 1) % seg], rows[j][(i + 1) % seg]))
    for i in range(seg):
        bm.faces.new((vt, rows[0][(i + 1) % seg], rows[0][i]))
        bm.faces.new((vb, rows[-1][i], rows[-1][(i + 1) % seg]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    top_z = shape(0.0, 0.0)[0].z
    bot_z = min(v.co.z for v in bm.verts)
    return bm, top_z, bot_z


def _gourd(name, x, y, r, hz, lobes, depth, mat, yaw=0.0, tilt=0.0, pear=0.0, stem_len=0.03, stem_r=0.006):
    bm, top_z, bot_z = _gourd_mesh(name, r, hz, lobes, depth, pear)
    ob = _mesh_obj(name, bm, mat, smooth=True)
    ob.location = (x, y, -bot_z * _m.cos(tilt) + 0.0005)
    ob.rotation_euler = (tilt, 0, yaw)
    _reg("gourds", ob)
    # cuống cong ngắn, gốc loe
    bm = _bmesh.new()
    N, K = 10, 10
    rings = []
    for k in range(K + 1):
        t = k / K
        c = _V((stem_len * 0.35 * t * t, 0, top_z - 0.004 + stem_len * t))
        rr = stem_r * (1.0 + 1.0 * _m.exp(-t * 7)) * (1 - 0.3 * t)
        rings.append([bm.verts.new(c + _V((rr * (1 + 0.15 * _m.cos(5 * a)) * _m.cos(a), rr * (1 + 0.15 * _m.cos(5 * a)) * _m.sin(a), 0)))
                      for a in [2 * _m.pi * i / N for i in range(N)]])
    for k in range(K):
        for i in range(N):
            bm.faces.new((rings[k][i], rings[k][(i + 1) % N], rings[k + 1][(i + 1) % N], rings[k + 1][i]))
    bm.faces.new(rings[-1])
    st = _mesh_obj(name + "_stem", bm, M_STEM, smooth=True)
    st.parent = ob
    _reg("gourds", st)
    _GOURD_SPOTS.append((x, y, r * 1.05))
    return ob


def _gourds():
    white = _mat_gourd("gourd_white", "#f1ead8", "#e2d6b8", "#a89a78", rough=0.5)
    orange = _mat_gourd("gourd_orange", "#f58a2a", "#e06a16", "#8f3a0a", rough=0.42)
    pear = _mat_gourd("gourd_pear", "#e6c24a", "#d4a838", "#5e7a2c", rough=0.35, top="#4e6a26", speck=0.2)
    # cụm ở góc cửa, bên phải khung crop quả bí chính
    _gourd("gourd_white", 0.51, 1.37, 0.068, 0.66, 10, 0.07, white, yaw=0.4, stem_len=0.028)
    _gourd("gourd_orange", 0.61, 1.25, 0.05, 0.6, 12, 0.08, orange, yaw=1.3, tilt=0.06, stem_len=0.022, stem_r=0.005)
    _gourd("gourd_pear", 0.67, 1.43, 0.038, 0.95, 8, 0.02, pear, yaw=2.2, tilt=0.12, pear=0.8, stem_len=0.018, stem_r=0.004)


# ───────────────────────── 4. thảm chùi chân xơ dừa ─────────────────────────
_MAT_X0, _MAT_X1, _MAT_Y0, _MAT_Y1 = 0.0, 0.0, 0.0, 0.0


def _doormat():
    global _MAT_X0, _MAT_X1, _MAT_Y0, _MAT_Y1
    dm = _bpy.data.objects.get("doormat")
    if not dm:
        return
    # box() của build_scene đã áp cả vị trí vào mesh (gốc object = 0) → dịch tương đối: sang phải 14 cm, chừa chỗ
    # cho cụm bí nhỏ (trước đây gán location.x = tâm cửa nên thảm lệch hẳn sang phải cửa ~1 m)
    dm.location.x = 0.14
    mb = MB("doormat_coir")
    t = img("doormat_tile.jpg")
    tc = mb.node("ShaderNodeTexCoord")
    if t:
        mp = mb.node("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (2.6, 2.6, 2.6)
        mb.link(tc.outputs["Object"], mp.inputs["Vector"])
        tx = mb.tex(t, mp.outputs[0], "BOX")
        base = tx.outputs["Color"]
    else:
        nz = mb.noise(120.0, 6.0, tc.outputs["Object"], 0.7)
        base = mb.ramp(nz.outputs["Fac"], [(0.3, "#5a3a1c"), (0.7, "#a87a44")])
    # viền thảm sẫm hơn (theo toạ độ Generated của box)
    sep = mb.node("ShaderNodeSeparateXYZ")
    mb.link(tc.outputs["Generated"], sep.inputs[0])
    edge = mb.node("ShaderNodeMath", operation="MINIMUM")
    ex = mb.node("ShaderNodeMath", operation="PINGPONG"); ex.inputs[1].default_value = 0.5
    ey = mb.node("ShaderNodeMath", operation="PINGPONG"); ey.inputs[1].default_value = 0.5
    mb.link(sep.outputs["X"], ex.inputs[0]); mb.link(sep.outputs["Y"], ey.inputs[0])
    mb.link(ex.outputs[0], edge.inputs[0]); mb.link(ey.outputs[0], edge.inputs[1])
    border = mb.ramp(edge.outputs[0], [(0.04, "#4a3220"), (0.07, "#ffffff")])
    mul = mb.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    mul.inputs["Factor"].default_value = 1.0
    mb.link(base, _rgba_in(mul, "A")); mb.link(border, _rgba_in(mul, "B"))
    dim = mb.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    dim.inputs["Factor"].default_value = 1.0
    mb.link(_rgba_out(mul), _rgba_in(dim, "A")); _rgba_in(dim, "B").default_value = hexc("#9c8670")   # bớt rực cho hợp đêm
    mb.link(_rgba_out(dim), mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.95)
    bw = mb.node("ShaderNodeRGBToBW")
    mb.link(base, bw.inputs[0])
    mb.bump(bw.outputs[0], 0.6, 0.004)
    dm.data.materials.clear()
    dm.data.materials.append(mb.m)
    xs_ = [v.co.x + dm.location.x for v in dm.data.vertices]
    ys_ = [v.co.y + dm.location.y for v in dm.data.vertices]
    _MAT_X0, _MAT_X1, _MAT_Y0, _MAT_Y1 = min(xs_), max(xs_), min(ys_), max(ys_)
    _reg("mat", dm)


# ───────────────────────── 5. mạng nhện góc cột – tường ─────────────────────────
def _cobweb():
    m = MB("cobweb").set(Base_Color=hexc("#c9ced8"), Roughness=0.3, Alpha=0.32, Specular_IOR_Level=0.6)
    cx, cy = WALL_X0 + 0.055, WALL_Y                   # góc trong: mặt phải cột góc gặp mặt tường
    hub = _V((cx + 0.05, cy - 0.035, 1.87))
    anchors = [  # bám trên mặt tường (y = WALL_Y) và mặt bên cột (x = cx), một sợi kéo lên khỏi khung hình
        _V((cx + 0.03, cy - 0.06, 2.16)), _V((cx + 0.17, cy - 0.001, 2.07)), _V((cx + 0.21, cy - 0.001, 1.92)),
        _V((cx + 0.16, cy - 0.001, 1.77)), _V((cx + 0.07, cy - 0.001, 1.69)), _V((cx + 0.001, cy - 0.01, 1.72)),
        _V((cx + 0.001, cy - 0.07, 1.8)), _V((cx + 0.001, cy - 0.08, 1.95)), _V((cx + 0.001, cy - 0.06, 2.08)),
    ]
    cu = _bpy.data.curves.new("cobweb", "CURVE")
    cu.dimensions, cu.bevel_depth, cu.bevel_resolution = "3D", 0.00045, 1

    def strand(pts):
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for k, p in enumerate(pts):
            sp.points[k].co = (*p, 1.0)

    for a in anchors:                                  # sợi toả: võng nhẹ
        a += _V((_rng.uniform(-0.015, 0.015), 0, _rng.uniform(-0.02, 0.02)))
        mid = (hub + a) / 2 + _V((0, 0, -0.006))
        strand([hub, mid, a])
    rings, t = [], 0.14
    while t < 0.86:                                    # khoảng cách vòng không đều, thưa dần ra ngoài
        rings.append(t)
        t += _rng.uniform(0.07, 0.13)
    for t in rings:                                    # vòng xoắn: mỗi đoạn giữa hai sợi toả võng xuống, hay bị đứt
        for i in range(len(anchors)):
            if _rng.random() < 0.3 * t + 0.08:
                continue
            a, b = anchors[i], anchors[(i + 1) % len(anchors)]
            ta, tb = t * _rng.uniform(0.96, 1.04), t * _rng.uniform(0.96, 1.04)
            pa, pb = hub + (a - hub) * ta, hub + (b - hub) * tb
            mid = (pa + pb) / 2 + _V((0, 0, -0.004 * t - 0.002)) + (hub - (pa + pb) / 2) * 0.06
            strand([pa, mid, pb])
    for _ in range(3):                                 # vài sợi đứt rủ xuống
        a = anchors[_rng.randrange(2, 7)]
        p0 = hub + (a - hub) * _rng.uniform(0.4, 0.9)
        strand([p0, p0 + _V((_rng.uniform(-0.01, 0.01), 0, -_rng.uniform(0.03, 0.07)))])
    cu.materials.append(m.m)
    ob = obj("cobweb", cu, C_ENV)
    ob.visible_shadow = False
    return _reg("web", ob)


# ───────────────────────── 6. dây leo khô quấn lan can + cột góc ─────────────────────────
def _vines():
    vm = MB("vine")
    tc = vm.node("ShaderNodeTexCoord")
    nz = vm.noise(80.0, 4.0, tc.outputs["Object"])
    vm.link(vm.ramp(nz.outputs["Fac"], [(0.3, "#241a12"), (0.7, "#4a3626")]), vm.bsdf.inputs["Base Color"])
    vm.set(Roughness=0.85)
    vm.bump(nz.outputs["Fac"], 0.4)
    yf = RAIL_Y - 0.062                                # ngay trước mặt cột góc (mặt trước y ≈ 1.465)
    paths = []
    # thân chính: bò dọc mặt trước tay vịn (z 0,835–0,885) từ ngoài khung bên trái, tới cột thì quấn lên
    main = []
    for k in range(9):
        x = -0.95 + k * 0.07
        main.append(_V((x, RAIL_Y - 0.039 - 0.003 * _m.cos(k * 2.1), 0.862 + 0.017 * _m.sin(k * 2.1))))
    for k in range(26):
        z = 0.93 + k * 0.05
        main.append(_V((WALL_X0 - 0.005 + 0.038 * _m.sin(z * 7.5), yf - 0.004 * _m.cos(z * 7.5), z)))
    paths.append((main, 1.0))
    # sợi phụ quấn bện quanh thân chính trên cột (lệch pha), mảnh hơn
    twin = [_V((WALL_X0 - 0.01 + 0.03 * _m.sin(z * 7.5 + 2.4), yf - 0.006, z)) for z in [0.95 + k * 0.05 for k in range(19)]]
    paths.append((twin, 0.6))
    # nhánh rủ xuống từ tay vịn dọc cột
    down = [_V((WALL_X0 - 0.03, yf, 0.9))]
    for k in range(1, 9):
        z = 0.9 - k * 0.055
        down.append(_V((WALL_X0 - 0.02 + 0.026 * _m.sin(z * 11), yf - 0.002, z)))
    paths.append((down, 0.65))
    # nhánh rủ qua mép tay vịn bên trái
    for x0, n in ((-0.62, 6), (-0.8, 4)):
        d = [_V((x0, RAIL_Y - 0.04, 0.87)), _V((x0 - 0.005, RAIL_Y - 0.045, 0.85))]
        for k in range(1, n):
            d.append(_V((x0 + 0.015 * _m.sin(k * 1.9), RAIL_Y - 0.05, 0.875 - k * 0.05)))
        paths.append((d, 0.55))
    # nhánh vươn sang tường về phía đèn
    br = [_V((WALL_X0 + 0.02, yf, 1.52))]
    for k in range(1, 8):
        t = k / 7
        br.append(_V((WALL_X0 + 0.02 + 0.11 * t, WALL_Y - 0.008 - 0.06 * (1 - t) ** 2, 1.52 + 0.08 * _m.sin(t * 3.0) - 0.05 * t)))
    paths.append((br, 0.6))
    leaf_bm = _bmesh.new()
    for i, (pts, w) in enumerate(paths):
        n = len(pts)
        radii = [w * (1.0 - 0.75 * k / (n - 1)) for k in range(n)]
        _reg("vines", _curve(f"vine{i}", [tuple(p) for p in pts], 0.0042, vm.m, radii, res=6))
        # lá khô mọc dọc dây, rủ xuống, mặt lá hướng chung về phía camera
        for k in range(1, n):
            if _rng.random() > 0.75:
                continue
            p = pts[k].lerp(pts[k - 1], _rng.random())
            s = _rng.uniform(0.045, 0.07) * (0.75 + 0.25 * w)
            side = _rng.choice((-1, 1))
            yaw = side * _rng.uniform(0.3, 0.9)
            rot = (_Mx.Rotation(_rng.uniform(-0.4, 0.4), 3, "Z") @ _Mx.Rotation(-rad(_rng.uniform(60, 95)), 3, "X")
                   @ _Mx.Rotation(yaw + _m.pi, 3, "Z"))
            base = p + _V((side * 0.006, -0.012, 0))
            # gốc lá ở cuống dây: dời lưới để mép dưới ảnh (cuống lá trong atlas) nằm ở điểm bám
            _add_leaf(leaf_bm, _pick_tint(0.35), base, s, 0.0, _rng.randrange(8),
                      mat_fn=lambda q, rot=rot, s=s: rot @ (q + _V((0, s * 0.5, 0))))
    _reg("vines", _mesh_obj("vine_leaves", leaf_bm, _mat_leaf("vine_leaf", dry=True), smooth=True))


# ───────────────────────── kiểm tra: không đè khung crop của quả bí ─────────────────────────
def _check_crop():
    _bpy.context.view_layer.update()
    W, H = sc.render.resolution_x, sc.render.resolution_y
    camo = sc.camera

    def px(p):
        v = _w2c(sc, camo, p)
        return v.x * W, (1 - v.y) * H

    pts = []
    for n in ("skin_front", "skin_back", "stem"):
        o = _bpy.data.objects[n]
        pts += [px(o.matrix_world @ v.co) for v in list(o.data.vertices)[::7]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    S = int(max(max(xs) - min(xs), max(ys) - min(ys)) * 1.06) // 8 * 8
    x0, y0 = (min(xs) + max(xs)) / 2 - S / 2, (min(ys) + max(ys)) / 2 - S / 2
    dg = _bpy.context.evaluated_depsgraph_get()
    for part, obs in _NEW.items():
        if part == "leaves":                            # lá nằm sàn: được phép quanh chân bí (đã chừa khoảng cách)
            continue
        for o in obs:
            me = o.evaluated_get(dg).to_mesh()
            hit = [px(o.matrix_world @ v.co) for v in me.vertices]
            o.evaluated_get(dg).to_mesh_clear()
            vis = [(x, y) for x, y in hit if 0 <= x <= W and 0 <= y <= H]
            inside = [(x, y) for x, y in vis if x0 <= x <= x0 + S and y0 <= y <= y0 + S]
            if inside:
                print(f"PORCH_WARN {o.name} đè khung crop quả bí ({len(inside)}/{len(vis)} đỉnh)")
            elif vis:
                print(f"PORCH ok {o.name} px x {min(x for x, _ in vis):.0f}..{max(x for x, _ in vis):.0f}"
                      f" y {min(y for _, y in vis):.0f}..{max(y for _, y in vis):.0f}")
    print(f"PORCH crop px x {x0:.0f}..{x0 + S:.0f} y {y0:.0f}..{y0 + S:.0f}")


if "mat" in _PARTS:
    _doormat()
if "gourds" in _PARTS:
    _gourds()
if "leaves" in _PARTS:
    _leaves()
if "lantern" in _PARTS:
    _lantern()
if "web" in _PARTS:
    _cobweb()
if "vines" in _PARTS:
    _vines()
_check_crop()
