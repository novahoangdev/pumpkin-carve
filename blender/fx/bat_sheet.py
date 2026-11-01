# Bakes the bat sprite sheet for app/src/fx/Bats.tsx (headless Blender, no MCP):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python blender/fx/bat_sheet.py -- [--cell 128] [--samples 24]
# Output: app/assets/fx/pfx_bat.png  (+ blender/fx/bat.blend for inspection)
#
# The bat follows the exact wing geometry of Bats.tsx (LEAD / TIP3 / TRAIL, units "k = 1": half-span 0.15), body Y = head,
# X = right, Z = back. Wings flap via shape keys (dihedral angle ang + outer fold at the wrist, same formula as the app) → Cycles
# gets real wing motion blur within one frame (shutter = 1/12 of a flap cycle, like a 60 fps camera, 10 Hz flap, 180°).
#
# Sheet layout (CELL px cells, ORTHO orthographic camera in k=1 units, cell centre = bat body origin):
#   columns 0..7 : flap phase  phase = i / 8 · 2π
#   row r = az · 3 + el  (az 0..7: azimuth 45°/step, 0 = viewed from behind the tail; el 0..2: −50°, 0°, +50° (viewed from below/level/above))
#   left half  (x < 8·CELL): pass A = cold moon backlight + weak fill (normal blending)
#   right half (x ≥ 8·CELL): pass B = candlelight from below–behind (rim + translucent red-orange wing membrane), additive, app tints by
#                           distance to the candle
# Each cell's "up" = the bat body Z projected perpendicular to the view direction (to_track_quat('-Z', 'Y')) — the app rebuilds exactly that vector.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default

CELL = arg("--cell", 128)
SAMPLES = arg("--samples", 24)
ORTHO = 0.36
PHASES, AZ, EL = 8, 8, 3
ELS = [-50.0, 0.0, 50.0]
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "app", "assets", "fx", "pfx_bat.png")
TMP = os.path.join(ROOT, "blender", "fx", "_tmp_bat")
os.makedirs(TMP, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# ── wing geometry (same as Bats.tsx) ──
LEAD = [(0.012, 0.012), (0.055, 0.03), (0.088, 0.026)]
TIP3 = (0.15, 0.0)
TRAIL = [((0.112, -0.004), (0.13, -0.034)), ((0.1, -0.012), (0.088, -0.05)), ((0.058, -0.016), (0.02, -0.036))]
WRIST = LEAD[2]

def outline():
    pts = list(LEAD) + [TIP3]
    prev = TIP3
    for c, e in TRAIL:
        for j in range(1, 7):
            t = j / 6
            x = (1 - t) ** 2 * prev[0] + 2 * (1 - t) * t * c[0] + t * t * e[0]
            y = (1 - t) ** 2 * prev[1] + 2 * (1 - t) * t * c[1] + t * t * e[1]
            pts.append((x, y))
        prev = e
    # along the body to the shoulder
    pts.append((0.014, -0.01))
    return pts

def wing_deform(s, c, h, side, ang, fold):
    """(s span, c chord, h normal offset) → world, same formula as wingPt in Bats.tsx."""
    ss = s if s <= WRIST[0] else WRIST[0] + (s - WRIST[0]) * fold
    # membrane sags slightly (dips down) between the fingers
    camber = -0.006 * math.sin(math.pi * min(1.0, s / 0.15)) * min(1.0, max(0.0, (0.03 - c) / 0.05))
    hh = h + camber
    x = (math.cos(ang) * ss - math.sin(ang) * hh) * side
    z = math.sin(ang) * ss + math.cos(ang) * hh
    return Vector((x, c, z))

def phase_params(p):
    ang = 0.15 + 0.95 * math.sin(p)
    fold = 1 - 0.38 * max(0.0, math.cos(p))
    return ang, fold

# ── materials ──
def mat_membrane():
    m = bpy.data.materials.new("membrane")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    pb = nt.nodes.new("ShaderNodeBsdfPrincipled")
    pb.inputs["Base Color"].default_value = (0.045, 0.03, 0.028, 1)
    pb.inputs["Roughness"].default_value = 0.62
    if "Specular IOR Level" in pb.inputs:
        pb.inputs["Specular IOR Level"].default_value = 0.25
    # wing membrane skin texture: noise stretched along the span
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 180.0
    tex.inputs["Detail"].default_value = 6.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], pb.inputs["Normal"])
    tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
    tr.inputs["Color"].default_value = (0.85, 0.22, 0.08, 1)  # blood under thin skin: backlit it goes red-orange
    # blood vessels: vein-like noise darkens where vessels are
    vein = nt.nodes.new("ShaderNodeTexVoronoi")
    vein.feature = "DISTANCE_TO_EDGE"
    vein.inputs["Scale"].default_value = 60.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.25, 0.04, 0.02, 1)
    ramp.color_ramp.elements[1].position = 0.06
    ramp.color_ramp.elements[1].color = (0.85, 0.22, 0.08, 1)
    nt.links.new(vein.outputs["Distance"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], tr.inputs["Color"])
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.42
    nt.links.new(pb.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    m.use_backface_culling = False
    MEM_NODES.update(ramp=ramp, mix=mix)
    return m

MEM_NODES = {}
def membrane_pass(pas):
    """A: moonlight through the membrane only gives a very dark reddish-brown glow (the bat stays a black silhouette against the sky); B: candlelight through the membrane goes red-orange."""
    r = MEM_NODES["ramp"].color_ramp.elements
    if pas == "A":
        r[0].color = (0.05, 0.012, 0.008, 1)
        r[1].color = (0.16, 0.05, 0.03, 1)
        MEM_NODES["mix"].inputs["Fac"].default_value = 0.3
    else:
        r[0].color = (0.25, 0.04, 0.02, 1)
        r[1].color = (0.85, 0.22, 0.08, 1)
        MEM_NODES["mix"].inputs["Fac"].default_value = 0.42

def mat_fur():
    m = bpy.data.materials.new("fur")
    m.use_nodes = True
    nt = m.node_tree
    pb = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    pb.inputs["Base Color"].default_value = (0.05, 0.038, 0.032, 1)
    pb.inputs["Roughness"].default_value = 0.85
    for name, v in (("Sheen Weight", 1.0), ("Sheen Roughness", 0.35)):
        if name in pb.inputs:
            pb.inputs[name].default_value = v
    if "Sheen Tint" in pb.inputs:
        try:
            pb.inputs["Sheen Tint"].default_value = (0.9, 0.85, 0.8, 1)
        except TypeError:
            pb.inputs["Sheen Tint"].default_value = 0.5
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 900.0
    tex.inputs["Detail"].default_value = 2.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.8
    bump.inputs["Distance"].default_value = 0.001
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], pb.inputs["Normal"])
    return m

def mat_bone():
    m = bpy.data.materials.new("bone")
    m.use_nodes = True
    pb = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    pb.inputs["Base Color"].default_value = (0.03, 0.022, 0.02, 1)
    pb.inputs["Roughness"].default_value = 0.5
    return m

M_MEM, M_FUR, M_BONE = mat_membrane(), mat_fur(), mat_bone()

# ── wing: membrane + bones in one mesh, each vertex remembers (s, c, h, side) to deform by phase ──
def build_wings():
    bm = bmesh.new()
    meta = []  # (s, c, h, side) in vertex order
    mat_of_face = []

    def add_vert(s, c, h, side):
        v = bm.verts.new(wing_deform(s, c, h, side, 0.15, 1.0))
        meta.append((s, c, h, side))
        return v

    for side in (-1, 1):
        # membrane: triangulate the outline polygon then subdivide (so the wrist fold is smooth)
        tmp = bmesh.new()
        tv = [tmp.verts.new((p[0], p[1], 0)) for p in outline()]
        tmp.faces.new(tv)
        bmesh.ops.triangulate(tmp, faces=tmp.faces[:])
        bmesh.ops.subdivide_edges(tmp, edges=tmp.edges[:], cuts=3, use_grid_fill=True)
        bmesh.ops.triangulate(tmp, faces=tmp.faces[:])
        tmp.verts.index_update()
        vm = {}
        for v in tmp.verts:
            vm[v.index] = add_vert(v.co.x, v.co.y, 0.0, side)
        for f in tmp.faces:
            vs = [vm[v.index] for v in f.verts]
            if side < 0:
                vs = vs[::-1]
            try:
                bm.faces.new(vs)
                mat_of_face.append(0)
            except ValueError:
                pass
        tmp.free()
        # bones: thin tubes (6 sides) along shoulder→elbow→wrist, wrist→fingertips, small thumb
        chains = [
            [LEAD[0], LEAD[1], WRIST],
            [WRIST, TIP3],
            [WRIST, TRAIL[0][1]],
            [WRIST, TRAIL[1][1]],
            [WRIST, (0.096, 0.036)],
        ]
        radius = [0.0026, 0.0011, 0.0011, 0.0011, 0.0013]
        for chain, r0 in zip(chains, radius):
            for a, b in zip(chain[:-1], chain[1:]):
                n = max(3, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 0.006))
                rings = []
                for j in range(n + 1):
                    t = j / n
                    s = a[0] + (b[0] - a[0]) * t
                    c = a[1] + (b[1] - a[1]) * t
                    dx, dy = b[0] - a[0], b[1] - a[1]
                    L = math.hypot(dx, dy)
                    nx, ny = -dy / L, dx / L  # normal within the wing plane
                    r = r0 * (1 - 0.45 * t)
                    ring = []
                    for q in range(6):
                        th = q / 6 * math.tau
                        ring.append(add_vert(s + nx * r * math.cos(th), c + ny * r * math.cos(th), r * math.sin(th), side))
                    rings.append(ring)
                for r1, r2 in zip(rings[:-1], rings[1:]):
                    for q in range(6):
                        vs = [r1[q], r1[(q + 1) % 6], r2[(q + 1) % 6], r2[q]]
                        if side < 0:
                            vs = vs[::-1]
                        bm.faces.new(vs)
                        mat_of_face.append(1)
    me = bpy.data.meshes.new("wings")
    bm.to_mesh(me)
    bm.free()
    for i, p in enumerate(me.polygons):
        p.material_index = mat_of_face[i]
        p.use_smooth = True
    ob = bpy.data.objects.new("wings", me)
    sc.collection.objects.link(ob)
    ob.data.materials.append(M_MEM)
    ob.data.materials.append(M_BONE)
    return ob, meta

wings, META = build_wings()

# shape keys: one key per 1/16 cycle step, keyed linearly per frame → Cycles can interpolate for motion blur
CYCLE = 16
wings.shape_key_add(name="Basis", from_mix=False)
keys = []
for j in range(CYCLE + 1):
    ang, fold = phase_params(j / CYCLE * math.tau)
    k = wings.shape_key_add(name=f"p{j}", from_mix=False)
    for i, (s, c, h, side) in enumerate(META):
        k.data[i].co = wing_deform(s, c, h, side, ang, fold)
    keys.append(k)
for j, k in enumerate(keys):
    for f, v in ((j - 1, 0.0), (j, 1.0), (j + 1, 0.0)):
        k.value = v
        k.keyframe_insert("value", frame=f)
for fc in wings.data.shape_keys.animation_data.action.fcurves if hasattr(wings.data.shape_keys.animation_data.action, "fcurves") else []:
    for kp in fc.keyframe_points:
        kp.interpolation = "LINEAR"
try:
    # Blender 5: actions have layers/strips/channelbags
    act = wings.data.shape_keys.animation_data.action
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for cb in strip.channelbags:
                for fc in cb.fcurves:
                    for kp in fc.keyframe_points:
                        kp.interpolation = "LINEAR"
except Exception as e:  # noqa
    print("interp:", e)

# ── body: furry ellipsoid + head + ears + snout + tail membrane ──
def ellipsoid(name, loc, scale, mat, segs=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2, radius=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(mat)
    return ob

ellipsoid("torso", (0, 0.005, 0.002), (0.0135, 0.03, 0.012), M_FUR)
ellipsoid("belly", (0, -0.022, 0.0), (0.0095, 0.02, 0.009), M_FUR)
ellipsoid("head", (0, 0.04, 0.006), (0.0105, 0.011, 0.0095), M_FUR)
ellipsoid("snout", (0, 0.052, 0.003), (0.0045, 0.006, 0.004), M_BONE, 12)
for side in (-1, 1):
    # ears: pointed tips tilted slightly back
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.0048, radius2=0.0004, depth=0.017,
                                    location=(side * 0.0055, 0.037, 0.019))
    ear = bpy.context.object
    ear.rotation_euler = (math.radians(-22), math.radians(side * 18), 0)
    ear.scale = (1.0, 0.45, 1.0)
    bpy.ops.object.shade_smooth()
    ear.data.materials.append(M_MEM)
    # eyes: small dots that catch the light
    ellipsoid(f"eye{side}", (side * 0.0058, 0.0485, 0.0085), (0.0016, 0.0016, 0.0016), M_BONE, 10)
    # hind legs poke out of the tail membrane edge
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.0011, depth=0.02, location=(side * 0.012, -0.044, -0.001))
    leg = bpy.context.object
    leg.rotation_euler = (math.radians(90), 0, math.radians(side * 25))
    leg.data.materials.append(M_BONE)
# tail membrane (uropatagium) between the legs and the tail
bm = bmesh.new()
pts = [(-0.02, -0.036), (-0.016, -0.058), (0.0, -0.074), (0.016, -0.058), (0.02, -0.036), (0.0, -0.03)]
vs = [bm.verts.new((x, y, -0.001 - 0.004 * (1 - abs(x) / 0.02))) for x, y in pts]
bm.faces.new(vs)
me = bpy.data.meshes.new("tailmem")
bm.to_mesh(me)
bm.free()
tail = bpy.data.objects.new("tailmem", me)
sc.collection.objects.link(tail)
tail.data.materials.append(M_MEM)

# ── render ──
sc.render.engine = "CYCLES"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.device = "CPU"
# CPU: the GPU is busy rendering the main agent's scene; 128 px cells so CPU is fast enough
sc.cycles.use_auto_tile = False
sc.render.film_transparent = True
sc.render.resolution_x = CELL
sc.render.resolution_y = CELL
sc.render.resolution_percentage = 100
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = min(1.0, CYCLE / 12)  # frame (phase) → 1/12 cycle
try:
    sc.render.motion_blur_position = "CENTER"
except Exception:
    pass
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.render.film_transparent = True
sc.world = bpy.data.worlds.new("w")
sc.world.use_nodes = True
bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Strength"].default_value = 0.0

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = ORTHO
cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam

def sun(name, color, energy):
    d = bpy.data.lights.new(name, "SUN")
    d.color = color
    d.energy = energy
    d.angle = math.radians(8)
    o = bpy.data.objects.new(name, d)
    sc.collection.objects.link(o)
    return o

moon = sun("moon", (0.72, 0.8, 1.0), 3.2)    # moon behind–above–left of the bat (relative to the viewer) → cold rim
fill = sun("fill", (0.42, 0.45, 0.6), 0.35)  # night-sky light from the viewer's side: just enough to read the form
candle = sun("candle", (1.0, 1.0, 1.0), 9.0) # pass B: candlelight from below–behind → rim + translucent wing membrane

def aim(o, F):
    o.rotation_euler = F.normalized().to_track_quat("Z", "Y").to_euler()

def cell_dir(az, el):
    a, e = math.radians(az * 45.0), math.radians(ELS[el])
    return Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))

def render_to(path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)

paths = {}
for az in range(AZ):
    for el in range(EL):
        d = cell_dir(az, el)
        cam.location = d * 2.0
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        q = cam.rotation_euler.to_quaternion()
        fwd = q @ Vector((0, 0, -1))
        up = q @ Vector((0, 1, 0))
        right = q @ Vector((1, 0, 0))
        aim(moon, fwd * 0.75 + up * 0.55 - right * 0.4)
        aim(fill, -fwd + up * 0.35 + right * 0.2)
        aim(candle, fwd * 0.55 - up * 0.85)
        for ph in range(PHASES):
            sc.frame_set(ph * CYCLE // PHASES)
            for pas in ("A", "B"):
                membrane_pass(pas)
                moon.hide_render = pas == "B"
                fill.hide_render = pas == "B"
                candle.hide_render = pas == "A"
                p = os.path.join(TMP, f"{pas}_{az}_{el}_{ph}.png")
                render_to(p)
                paths[(pas, az, el, ph)] = p
        print(f"az {az} el {el} done", flush=True)

# ── assemble the sheet ──
W, H = PHASES * CELL * 2, AZ * EL * CELL
sheet = bpy.data.images.new("pfx_bat", W, H, alpha=True)
import array
buf = array.array("f", [0.0]) * (W * H * 4)
for (pas, az, el, ph), p in paths.items():
    im = bpy.data.images.load(p)
    px = array.array("f", [0.0]) * (CELL * CELL * 4)
    im.pixels.foreach_get(px)
    col = ph + (PHASES if pas == "B" else 0)
    row = az * EL + el
    x0 = col * CELL
    y0 = H - (row + 1) * CELL  # Blender pixels count from the bottom up
    for y in range(CELL):
        src = y * CELL * 4
        dst = ((y0 + y) * W + x0) * 4
        buf[dst:dst + CELL * 4] = px[src:src + CELL * 4]
    bpy.data.images.remove(im)
sheet.pixels.foreach_set(buf)
sheet.filepath_raw = OUT
sheet.file_format = "PNG"
sheet.save()
print("→", OUT)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "fx", "bat.blend"))
