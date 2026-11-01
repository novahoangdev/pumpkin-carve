# Extends the scene so the app can "look around" from CAM_LOC (camera rotating in place: yaw ±75°, pitch −55°..+50°, zoom out to 0.55×
# focal length): beadboard porch ceiling painted "haint blue" + beams, hip-style porch roof with fascia, gutter,
# downspout, porch posts; house wall extended to the right (warm-lit window with curtains, second floor, main roof); left railing + corner post
# + steps down to the yard; grass/dirt yard, stepping-stone path, picket fence, bare trees, a few distant houses with lit windows; full
# night-sky panorama (world, camera-only).
# Runs at the end of build_scene.py (after porch_details.py), sharing globals: sc, C_ENV, C_LIGHT, MB, hexc, img, box, obj,
# light, M_TRIM, M_STEP, M_SIDING, FRONT_EDGE, WALL_Y, WALL_X0, RAIL_Y, DX0, DX1, CAM_LOC, the sky backdrop parameters…
#
# Principles that keep the base frame (bg_lit/bg_dark…) almost unchanged:
#   - ceiling, roof, beams, fascia, gutter are real geometry: they block the sky (shadow/AO under the roof), bounce porch light, show up in reflections
#     on the wet floor (PC_ROOF_CAM_ONLY=1: old behaviour, camera-only, render_passes.py detects it via the "pc_cam_only" property);
#   - sky: drop the flat `sky` backdrop, replace it with ONE panoramic sky image on the world, changing only what the camera sees
#     (Light Path ▸ Is Camera Ray), ambient light stays #141a33 as before; the moon keeps its old direction (top left);
#   - trees, distant houses, fence sit outside the "window" seen through the railing in the base frame (checked by projecting verts, prints WIDE_WARN).
# The scene's self-emissive materials (windows) name their node "emit_env": render_passes.py turns them off in the candlelight pass.
#
# PC_WIDE=porch,house,left,yard,fence,trees,town,sky,door,rain,relight   build only some parts (default: all)
import json as _json
import math as _m
import random as _random_mod
import bmesh as _bmesh
import bpy as _bpy
import numpy as _np
from mathutils import Vector as _V, Matrix as _Mx
from bpy_extras.object_utils import world_to_camera_view as _w2c

_wrng = _random_mod.Random(2026)
_WPARTS = set((os.environ.get("PC_WIDE") or "porch,house,left,yard,fence,trees,town,sky,door,rain,relight").split(","))
_WNEW = []                                   # new objects, to check whether any leak into the base frame

# ── main dimensions of the extension ──
PX0, PX1 = -2.62, 5.35        # left / right edge of the porch floor (old floor: -1.4..2.6)
CEIL_Z = 2.60                 # underside of the porch ceiling
BEAM_Z = 2.36                 # bottom of the edge beam (on the posts)
EAVE_Y = -0.92                # front fascia (right above the camera, y = -0.95)
EAVE_X0, EAVE_X1 = -2.95, 5.68
EAVE_Z = 2.80                 # top edge of the porch fascia
POST_Y = FRONT_EDGE + 0.07    # front row of posts
YARD_Z = -0.43                # yard surface
HOUSE_X1 = 16.0               # house wall extends to here
WALL_TOP = 5.6                # top of the second-floor wall (main roof starts)


_ROOF_CAM_ONLY = os.environ.get("PC_ROOF_CAM_ONLY") == "1"


def _cam_only(ob):
    """(PC_ROOF_CAM_ONLY=1) Camera-only: no shadows, doesn't block/reflect diffuse or glossy rays."""
    if not _ROOF_CAM_ONLY:
        return ob
    ob.visible_shadow = False
    ob.visible_diffuse = False
    ob.visible_glossy = False
    ob.visible_transmission = False
    ob.visible_volume_scatter = False
    ob["pc_cam_only"] = 1
    return ob


def _wreg(ob, check=True):
    if check:
        _WNEW.append(ob)
    return ob


def _bx(name, x0, x1, y0, y1, z0, z1, mat, cam_only=False, check=True):
    """Box from bounding coordinates (uses build_scene's box(): light bevel)."""
    ob = box(name, (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), mat)
    if cam_only:
        _cam_only(ob)
    return _wreg(ob, check)


def _bm_box(bm, x0, x1, y0, y1, z0, z1):
    g = _bmesh.ops.create_cube(bm, size=1.0)
    vs = g["verts"]
    _bmesh.ops.scale(bm, vec=(x1 - x0, y1 - y0, z1 - z0), verts=vs)
    _bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=vs)
    return vs


def _bm_obj(name, bm, mat, smooth=False, cam_only=False, check=True):
    me = _bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    if mat is not None:
        me.materials.append(mat)
    ob = obj(name, me, C_ENV)
    if cam_only:
        _cam_only(ob)
    return _wreg(ob, check)


def _stretch(name, axis, lo, hi):
    """Stretch an existing mesh (floor, wall…) along one axis without moving the object origin → object-space textures stay put."""
    ob = _bpy.data.objects.get(name)
    if not ob:
        return
    i = "xyz".index(axis)
    loc = ob.location[i]
    cs = [v.co[i] for v in ob.data.vertices]
    mid = (min(cs) + max(cs)) / 2
    old_lo, old_hi = min(cs), max(cs)
    for v in ob.data.vertices:
        c = v.co[i]
        if c < mid and lo is not None:      # low-side verts: move the whole cluster (keeping the bevel) to the new bound
            v.co[i] = c - old_lo + (lo - loc)
        elif c >= mid and hi is not None:
            v.co[i] = c - old_hi + (hi - loc)
    ob.data.update()


# ───────────────────────── node helper ─────────────────────────
def _nm(nt, op, a, b=None, c=None, clamp=False):
    """Math node: a, b, c are sockets or numbers."""
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for k, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[k].default_value = v
        else:
            nt.links.new(v, n.inputs[k])
    return n.outputs[0]


def _nvm(nt, op, a, b=None, out="Vector"):
    n = nt.nodes.new("ShaderNodeVectorMath")
    n.operation = op
    for k, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (tuple, list, _V)):
            n.inputs[k].default_value = tuple(v)
        else:
            nt.links.new(v, n.inputs[k])
    return n.outputs[out]


def _nmix(nt, fac, a, b):
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    sa = [s for s in mx.inputs if s.name == "A" and s.type == "RGBA"][0]
    sb = [s for s in mx.inputs if s.name == "B" and s.type == "RGBA"][0]
    for s, v in ((sa, a), (sb, b)):
        if isinstance(v, tuple):
            s.default_value = v
        else:
            nt.links.new(v, s)
    if isinstance(fac, (int, float)):
        mx.inputs["Factor"].default_value = fac
    else:
        nt.links.new(fac, mx.inputs["Factor"])
    return [o for o in mx.outputs if o.type == "RGBA"][0]


def _nramp(nt, fac, stops):
    cr = nt.nodes.new("ShaderNodeValToRGB")
    el = cr.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], hexc(stops[0][1])
    el[1].position, el[1].color = stops[-1][0], hexc(stops[-1][1])
    for p, c in stops[1:-1]:
        e = el.new(p)
        e.color = hexc(c)
    nt.links.new(fac, cr.inputs["Fac"])
    return cr.outputs["Color"]


def _emit_mat(name, color_socket_fn, strength):
    """Self-emissive scene material; the emission node is named "emit_env" (render_passes turns it off in the candlelight pass)."""
    m = _bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.name = "emit_env"
    em.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    col = color_socket_fn(nt)
    if isinstance(col, tuple):
        em.inputs["Color"].default_value = col
    else:
        nt.links.new(col, em.inputs["Color"])
    return m


# ───────────────────────── materials ─────────────────────────
def _mat_beadboard():
    """Beadboard ceiling painted haint blue: thin groove every 9 cm (boards run along y), slightly patchy paint."""
    mb = MB("ceiling_beadboard")
    nt = mb.nt
    tc = mb.node("ShaderNodeTexCoord")
    sep = mb.node("ShaderNodeSeparateXYZ")
    mb.link(tc.outputs["Object"], sep.inputs[0])
    f = _nm(nt, "FRACT", _nm(nt, "DIVIDE", sep.outputs["X"], 0.089))
    # g = 0 in the groove between boards, reaches 1 at 2.7 mm from the groove
    edge = _nm(nt, "SUBTRACT", 0.5, _nm(nt, "ABSOLUTE", _nm(nt, "SUBTRACT", f, 0.5)))
    g = _nm(nt, "DIVIDE", edge, 0.03, clamp=True)
    nz = mb.noise(6.0, 4.0, tc.outputs["Object"])
    paint = _nramp(nt, nz.outputs["Fac"], [(0.3, "#7f989a"), (0.7, "#98b2b2")])
    col = _nmix(nt, g, hexc("#3c4a4c"), paint)
    mb.link(col, mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.55)
    mb.bump(g, 0.35, 0.003)
    return mb.m


def _mat_paint(name, color, rough=0.6, dirt=0.25, scale=3.0):
    """Old painted wood: paint colour slightly patchy via noise (beams, fascia, posts, fence)."""
    mb = MB(name)
    tc = mb.node("ShaderNodeTexCoord")
    nz = mb.noise(scale, 6.0, tc.outputs["Object"], 0.6)
    dark = mb.mix(nz.outputs["Fac"], hexc("#6e685c"), hexc("#ffffff"))
    mul = mb.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    mul.inputs["Factor"].default_value = dirt
    [s for s in mul.inputs if s.name == "A" and s.type == "RGBA"][0].default_value = hexc(color)
    mb.link(dark, [s for s in mul.inputs if s.name == "B" and s.type == "RGBA"][0])
    mb.link([o for o in mul.outputs if o.type == "RGBA"][0], mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=rough)
    fine = mb.noise(120.0, 3.0, tc.outputs["Object"])
    mb.bump(fine.outputs["Fac"], 0.12)
    return mb.m


def _mat_shingle():
    """Dark grey asphalt shingles: rows along z, per-shingle colour variation."""
    mb = MB("roof_shingle")
    tc = mb.node("ShaderNodeTexCoord")
    nt = mb.nt
    sep = mb.node("ShaderNodeSeparateXYZ")
    mb.link(tc.outputs["Object"], sep.inputs[0])
    row = _nm(nt, "FRACT", _nm(nt, "DIVIDE", _nm(nt, "ADD", sep.outputs["Z"], sep.outputs["Y"]), 0.14))
    edge = _nm(nt, "GREATER_THAN", row, 0.9)
    vor = mb.node("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 9.0
    mb.link(tc.outputs["Object"], vor.inputs["Vector"])
    base = _nramp(nt, vor.outputs["Distance"], [(0.0, "#22232b"), (1.0, "#33343c")])
    col = _nmix(nt, edge, base, hexc("#111116"))
    mb.link(col, mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.9)
    mb.bump(row, 0.2, 0.004)
    return mb.m


def _mat_metal(name, color, rough=0.35):
    return mat_simple(name, color, rough, Metallic=0.7)


def _mat_ground():
    """Yard: faded grass mixed with dirt, large patches from low-frequency noise, bumps from high-frequency noise. Kept as dark as the old ground."""
    mb = MB("yard_ground")
    nt = mb.nt
    tc = mb.node("ShaderNodeTexCoord")
    big = mb.noise(0.35, 4.0, tc.outputs["Object"], 0.55)
    mid = mb.noise(3.0, 6.0, tc.outputs["Object"], 0.6)
    grass = _nramp(nt, mid.outputs["Fac"], [(0.3, "#1b2316"), (0.7, "#2c3522")])
    dirt = _nramp(nt, mid.outputs["Fac"], [(0.3, "#221b14"), (0.7, "#3a2e22")])
    m = _nramp(nt, big.outputs["Fac"], [(0.48, "#000000"), (0.58, "#ffffff")])
    bw = mb.node("ShaderNodeRGBToBW")
    mb.link(m, bw.inputs[0])
    col = _nmix(nt, bw.outputs[0], grass, dirt)
    # scattered dry leaves
    leaf = mb.noise(40.0, 2.0, tc.outputs["Object"])
    lm = _nm(nt, "GREATER_THAN", leaf.outputs["Fac"], 0.66)
    col = _nmix(nt, _nm(nt, "MULTIPLY", lm, 0.55), col, hexc("#4a2a16"))
    mb.link(col, mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.95, Specular_IOR_Level=0.12)      # less glare when grazing the far yard
    blade = mb.noise(260.0, 2.0, tc.outputs["Object"])
    mb.bump(blade.outputs["Fac"], 0.5, 0.01)
    return mb.m


def _mat_lattice():
    """Lattice panel covering the under-porch: diagonal slats both ways, dark gaps."""
    mb = MB("porch_lattice")
    nt = mb.nt
    tc = mb.node("ShaderNodeTexCoord")
    sep = mb.node("ShaderNodeSeparateXYZ")
    mb.link(tc.outputs["Object"], sep.inputs[0])
    h = _nm(nt, "ADD", sep.outputs["X"], sep.outputs["Y"])        # side faces run along x or y: add both
    s1 = _nm(nt, "FRACT", _nm(nt, "DIVIDE", _nm(nt, "ADD", h, sep.outputs["Z"]), 0.075))
    s2 = _nm(nt, "FRACT", _nm(nt, "DIVIDE", _nm(nt, "SUBTRACT", h, sep.outputs["Z"]), 0.075))
    slat = _nm(nt, "MAXIMUM", _nm(nt, "LESS_THAN", s1, 0.32), _nm(nt, "LESS_THAN", s2, 0.32))
    col = _nmix(nt, slat, hexc("#06070a"), hexc("#7c766a"))
    mb.link(col, mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.85)
    mb.bump(slat, 0.4, 0.004)
    return mb.m


def _mat_bark():
    mb = MB("bark")
    tc = mb.node("ShaderNodeTexCoord")
    nz = mb.noise(30.0, 5.0, tc.outputs["Object"], 0.6)
    mb.link(mb.ramp(nz.outputs["Fac"], [(0.3, "#17130f"), (0.7, "#2f2821")]), mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.9)
    mb.bump(nz.outputs["Fac"], 0.4)
    return mb.m


def _see_through(m):
    """Window glass with a real light behind it: camera and reflection rays see the room image (emit_env), while diffuse / shadow rays
    pass through → the room light shines onto the porch through the frame + muntins."""
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = nt.nodes["emit_env"]
    lp = nt.nodes.new("ShaderNodeLightPath")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(_nm(nt, "MAXIMUM", lp.outputs["Is Camera Ray"], lp.outputs["Is Glossy Ray"]), mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    return m


def _mat_window_glow(name="window_glow", strength=1.0):
    """House window: dim warm yellow room light, two voile curtain panels tied back at the sides + a valance on top (procedural)."""
    def build(nt):
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])
        u, v = sep.outputs["X"], sep.outputs["Z"]
        # curtain panel width by height: gathered at v ≈ 0.45
        t = _nm(nt, "DIVIDE", _nm(nt, "SUBTRACT", v, 0.45), 0.13)
        pinch = _nm(nt, "EXPONENT", _nm(nt, "MULTIPLY", _nm(nt, "MULTIPLY", t, t), -1.0))
        cw = _nm(nt, "MULTIPLY_ADD", pinch, -0.13, 0.31)
        left = _nm(nt, "LESS_THAN", u, cw)
        right = _nm(nt, "GREATER_THAN", u, _nm(nt, "SUBTRACT", 1.0, cw))
        top = _nm(nt, "GREATER_THAN", v, 0.87)
        mask = _nm(nt, "MINIMUM", _nm(nt, "ADD", _nm(nt, "ADD", left, right), top), 1.0)
        # curtain folds: waves along u, slightly offset by noise
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 4.0
        nt.links.new(tc.outputs["Generated"], nz.inputs["Vector"])
        ph = _nm(nt, "MULTIPLY_ADD", u, 75.0, _nm(nt, "MULTIPLY", nz.outputs["Fac"], 4.0))
        fold = _nm(nt, "MULTIPLY_ADD", _nm(nt, "SINE", ph), 0.3, 0.7)
        curtain = _nramp(nt, fold, [(0.4, "#5a2c12"), (1.0, "#c8773a")])
        # inside the room: bright spot (table lamp) lower left, darkening towards the edges
        cmb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(_nm(nt, "MULTIPLY", _nm(nt, "SUBTRACT", u, 0.38), 1.3), cmb.inputs["X"])
        nt.links.new(_nm(nt, "SUBTRACT", v, 0.3), cmb.inputs["Z"])
        d = _nvm(nt, "LENGTH", cmb.outputs[0], out="Value")
        room = _nramp(nt, d, [(0.0, "#ffd08a"), (0.35, "#e0893c"), (0.9, "#5a2a12")])
        return _nmix(nt, mask, room, curtain)
    return _emit_mat(name, build, strength)


def _mat_clear_glass():
    """Clear glass: almost transparent to all rays, light Fresnel reflection (shows the voile curtain + real room behind)."""
    m = _bpy.data.materials.new("window_clear")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tr.inputs["Color"].default_value = (0.92, 0.94, 0.93, 1)
    gl = nt.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.03
    fr = nt.nodes.new("ShaderNodeFresnel")
    fr.inputs["IOR"].default_value = 1.52
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mx = nt.nodes.new("ShaderNodeMixShader")
    # only the front face reflects (back face of a thin pane: Fresnel with inverted IOR → total reflection, black glass)
    nt.links.new(_nm(nt, "MULTIPLY", fr.outputs[0], _nm(nt, "SUBTRACT", 1.0, geo.outputs["Backfacing"])), mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(gl.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    return m


def _mat_window_dark():
    """Unlit window glass: blue-black, faint reflection."""
    return mat_simple("window_dark", "#06080e", 0.08, Specular_IOR_Level=0.6)


# ───────────────────────── 1. porch: floor, posts, beams, ceiling, roof, gutter ─────────────────────────
def _porch():
    # floor, rim joist, front step extended to both sides (keeping the object origin → wood grain on the old part unchanged)
    for n in ("floor", "joist", "step2", "step2_riser"):
        _stretch(n, "x", PX0, PX1)
    paint = _mat_paint("porch_paint", "#bdb6a6", 0.6, 0.3)
    beam_paint = _mat_paint("beam_paint", "#b4ad9c", 0.65, 0.35)
    # front-row porch posts: left, middle (outside the base frame, level with the camera), right; base + cap
    posts = [(-2.5, POST_Y), (2.6, POST_Y), (PX1 - 0.12, POST_Y), (PX1 - 0.12, RAIL_Y)]
    for i, (x, y) in enumerate(posts):
        _bx(f"post_{i}", x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0.0, BEAM_Z, paint)
        _bx(f"post_{i}_base", x - 0.085, x + 0.085, y - 0.085, y + 0.085, 0.0, 0.16, paint)
        _bx(f"post_{i}_cap", x - 0.085, x + 0.085, y - 0.085, y + 0.085, BEAM_Z - 0.06, BEAM_Z, paint)
    # edge beams on the posts (front, left, right, back on the railing side), cross beams under the ceiling
    _bx("beam_front", PX0 + 0.04, PX1 - 0.04, POST_Y - 0.07, POST_Y + 0.07, BEAM_Z, CEIL_Z, beam_paint, True)
    _bx("beam_left", -2.57, -2.43, FRONT_EDGE, RAIL_Y + 0.06, BEAM_Z, CEIL_Z, beam_paint, True)
    _bx("beam_right", PX1 - 0.19, PX1 - 0.05, FRONT_EDGE, WALL_Y, BEAM_Z, CEIL_Z, beam_paint, True)
    _bx("beam_back", -2.5, WALL_X0, RAIL_Y - 0.06, RAIL_Y + 0.06, BEAM_Z, CEIL_Z, beam_paint, True)
    for i, x in enumerate((WALL_X0, 2.6)):
        _bx(f"beam_cross{i}", x - 0.06, x + 0.06, POST_Y, WALL_Y, CEIL_Z - 0.16, CEIL_Z, beam_paint, True)
    # crown moulding at the ceiling–wall corner
    _bx("crown", WALL_X0, PX1 - 0.19, WALL_Y - 0.05, WALL_Y, CEIL_Z - 0.07, CEIL_Z, paint, True)
    # beadboard ceiling
    bm = _bmesh.new()
    _bm_box(bm, PX0, PX1, FRONT_EDGE - 0.02, WALL_Y, CEIL_Z, CEIL_Z + 0.02)
    _bm_obj("ceiling", bm, _mat_beadboard(), cam_only=True)
    # soffit (underside of the overhang) slightly above the ceiling, reaching the fascia
    bm = _bmesh.new()
    _bm_box(bm, EAVE_X0, EAVE_X1, EAVE_Y, WALL_Y, CEIL_Z + 0.03, CEIL_Z + 0.05)
    _bm_obj("soffit", bm, beam_paint, cam_only=True)
    # fascia on three sides
    fz0, fz1 = CEIL_Z - 0.02, EAVE_Z
    _bx("fascia_front", EAVE_X0, EAVE_X1, EAVE_Y - 0.025, EAVE_Y, fz0, fz1, paint, True)
    _bx("fascia_left", EAVE_X0 - 0.025, EAVE_X0, EAVE_Y - 0.025, WALL_Y, fz0, fz1, paint, True)
    _bx("fascia_right", EAVE_X1, EAVE_X1 + 0.025, EAVE_Y - 0.025, WALL_Y, fz0, fz1, paint, True)
    # hip-style porch roof against the wall: front slope + two triangular end slopes
    rise = 0.27
    zt = EAVE_Z + (WALL_Y - EAVE_Y) * rise
    xl, xr = EAVE_X0 + (WALL_Y - EAVE_Y), EAVE_X1 - (WALL_Y - EAVE_Y)
    bm = _bmesh.new()
    A, B = bm.verts.new((EAVE_X0, EAVE_Y, EAVE_Z)), bm.verts.new((EAVE_X1, EAVE_Y, EAVE_Z))
    C, D = bm.verts.new((EAVE_X1, WALL_Y, EAVE_Z)), bm.verts.new((EAVE_X0, WALL_Y, EAVE_Z))
    E, F = bm.verts.new((xl, WALL_Y, zt)), bm.verts.new((xr, WALL_Y, zt))
    for f in ((A, B, F, E), (D, A, E), (B, C, F)):
        bm.faces.new(f)
    _bm_obj("porch_roof", bm, _mat_shingle(), cam_only=True)
    # half-round gutter outside the fascia + downspout at the back right corner (against the wall)
    gut = _mat_metal("gutter", "#3a3632", 0.4)
    _gutter("gutter_front", _V((EAVE_X0 - 0.09, EAVE_Y - 0.09, EAVE_Z - 0.02)), _V((EAVE_X1 + 0.09, EAVE_Y - 0.09, EAVE_Z - 0.02)), gut)
    _gutter("gutter_left", _V((EAVE_X0 - 0.09, WALL_Y - 0.02, EAVE_Z - 0.02)), _V((EAVE_X0 - 0.09, EAVE_Y - 0.09, EAVE_Z - 0.02)), gut)
    _gutter("gutter_right", _V((EAVE_X1 + 0.09, EAVE_Y - 0.09, EAVE_Z - 0.02)), _V((EAVE_X1 + 0.09, WALL_Y - 0.02, EAVE_Z - 0.02)), gut)
    for nm_, x in (("downspout_right", EAVE_X1 + 0.09),):                 # right corner, against the house wall
        bm = _bmesh.new()
        y = WALL_Y - 0.12
        _bm_box(bm, x - 0.035, x + 0.035, y - 0.028, y + 0.028, YARD_Z + 0.12, EAVE_Z - 0.08)
        _bm_box(bm, x - 0.035, x + 0.035, y - 0.03, y + 0.03, EAVE_Z - 0.12, EAVE_Z - 0.02)
        _bm_box(bm, x - 0.035, x + 0.035, y - 0.24, y + 0.028, YARD_Z + 0.04, YARD_Z + 0.12)      # elbow draining into the yard
        _bm_obj(nm_, bm, gut)
    # lattice panels covering the under-porch at both ends
    lat = _mat_lattice()
    _bx("skirt_left_a", PX0 - 0.02, PX0, 0.42, WALL_Y, YARD_Z, -0.04, lat)
    _bx("skirt_right", PX1, PX1 + 0.02, FRONT_EDGE, WALL_Y, YARD_Z, -0.04, lat)
    _bx("skirt_trim_right", PX1, PX1 + 0.03, FRONT_EDGE, WALL_Y, -0.08, -0.035, paint)
    # right-end railing (from the front post to the post by the wall)
    _railing("rail_right", _V((PX1 - 0.12, POST_Y + 0.08, 0)), _V((PX1 - 0.12, RAIL_Y - 0.08, 0)), paint)
    # extra dry leaves on the new floor area
    _more_leaves()
    print("WIDE porch")


def _gutter(name, a, b, mat):
    """Half-round gutter with a rolled lip: U profile swept along a→b, both ends capped."""
    d = (b - a)
    L = d.length
    t = d.normalized()
    side = t.cross(_V((0, 0, 1))).normalized()
    up = _V((0, 0, 1))
    r = 0.065
    prof = []
    for k in range(13):                                # half circle open upwards
        ang = _m.pi + _m.pi * k / 12
        prof.append((r * _m.cos(ang), r * _m.sin(ang) + r * 0.0))
    prof = [(-r - 0.008, 0.012)] + prof + [(r + 0.008, 0.012)]
    bm = _bmesh.new()
    rings = []
    for s in (0.0, L):
        rings.append([bm.verts.new(a + t * s + side * px + up * pz) for px, pz in prof])
    n = len(prof)
    for i in range(n - 1):
        bm.faces.new((rings[0][i], rings[0][i + 1], rings[1][i + 1], rings[1][i]))
    for ring in rings:                                 # end caps
        bm.faces.new(ring)
    ob = _bm_obj(name, bm, mat, smooth=True, cam_only=True)
    sol = ob.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = 0.004
    return ob


def _railing(name, a, b, mat, top=0.86, bot=0.08, spacing=0.12):
    """Straight railing a→b (z of a, b ignored): handrail, bottom rail, square balusters."""
    d = b - a
    d.z = 0
    L = d.length
    t = d.normalized()
    bm = _bmesh.new()
    ax = 0 if abs(t.x) > abs(t.y) else 1

    def seg(c0, c1, w, z0, z1):
        lo = [min(c0[i], c1[i]) for i in range(2)]
        hi = [max(c0[i], c1[i]) for i in range(2)]
        for i in range(2):
            if i != ax:
                lo[i] -= w / 2
                hi[i] += w / 2
        _bm_box(bm, lo[0], hi[0], lo[1], hi[1], z0, z1)

    seg(a, b, 0.07, top - 0.025, top + 0.025)
    seg(a, b, 0.05, bot - 0.02, bot + 0.02)
    k = spacing / 2
    while k < L - spacing / 3:
        p = a + t * k
        _bm_box(bm, p.x - 0.0175, p.x + 0.0175, p.y - 0.0175, p.y + 0.0175, bot + 0.02, top - 0.025)
        k += spacing
    return _bm_obj(name, bm, mat)


def _more_leaves():
    """Scatter extra dry leaves (using porch_details' _add_leaf + 'leaf' material if present) on the new floor and left steps."""
    if "_add_leaf" not in globals() or not _bpy.data.materials.get("leaf"):
        return
    bm = _bmesh.new()
    n = 0
    tries = 0
    while n < 70 and tries < 2000:
        tries += 1
        if _wrng.random() < 0.45:
            x, y = _wrng.uniform(PX0 + 0.1, -1.45), _wrng.uniform(FRONT_EDGE + 0.05, RAIL_Y - 0.08)
        else:
            x, y = _wrng.uniform(2.65, PX1 - 0.2), _wrng.uniform(FRONT_EDGE + 0.05, WALL_Y - 0.08)
        if (y > WALL_Y - 0.6 and 2.0 < x < 3.2 and _wrng.random() < 0.5):
            continue
        s = _wrng.uniform(0.065, 0.11)
        tint = _pick_tint(0.2) if "_pick_tint" in globals() else (1, 1, 1)
        _add_leaf(bm, tint, _V((x, y, 0)), s, _wrng.uniform(0, 6.3), _wrng.randrange(8),
                  (_wrng.uniform(-0.1, 0.1), _wrng.uniform(-0.1, 0.1)), rest_z=0.0)
        n += 1
    _bm_obj("porch_leaves_wide", bm, _bpy.data.materials["leaf"], smooth=True)


# ───────────────────────── 2. house: extended wall, windows, second floor, main roof ─────────────────────────
def _window(name, x0, x1, z0, z1, mat, rail=True):
    """Window on the wall y = WALL_Y: casing, sill, glass (material mat), muntins."""
    paint = _bpy.data.materials.get("porch_paint") or M_TRIM
    y = WALL_Y
    _bx(f"{name}_glass", x0, x1, y - 0.012, y - 0.002, z0, z1, mat)
    cw = 0.09
    _bx(f"{name}_casing_l", x0 - cw, x0, y - 0.03, y, z0 - 0.02, z1 + 0.02, paint)
    _bx(f"{name}_casing_r", x1, x1 + cw, y - 0.03, y, z0 - 0.02, z1 + 0.02, paint)
    _bx(f"{name}_head", x0 - cw - 0.03, x1 + cw + 0.03, y - 0.045, y, z1, z1 + 0.11, paint)
    _bx(f"{name}_sill", x0 - cw - 0.04, x1 + cw + 0.04, y - 0.075, y, z0 - 0.045, z0 - 0.01, paint)
    if rail:
        bm = _bmesh.new()
        zm = (z0 + z1) / 2
        _bm_box(bm, x0, x1, y - 0.03, y - 0.005, zm - 0.022, zm + 0.022)               # middle rail (sash window)
        for z in ((z0 + zm) / 2, (zm + z1) / 2):
            _bm_box(bm, x0, x1, y - 0.024, y - 0.008, z - 0.011, z + 0.011)
        xm = (x0 + x1) / 2
        _bm_box(bm, xm - 0.011, xm + 0.011, y - 0.024, y - 0.008, z0, z1)
        for xx in (x0 + 0.02, x1 - 0.02):
            _bm_box(bm, xx - 0.02, xx + 0.02, y - 0.03, y - 0.005, z0, z1)
        _bm_obj(f"{name}_sash", bm, paint)


WINDOW_LAMP_W = 260.0


def _cut_wall(name, x0, x1, z0, z1):
    """Cut a rectangular hole through the house wall (boolean applied directly to the mesh)."""
    wall = _bpy.data.objects["wall"]
    cut = _bpy.data.meshes.new(name + "_cut")
    bm = _bmesh.new()
    _bm_box(bm, x0, x1, WALL_Y - 0.05, WALL_Y + 0.2, z0, z1)
    for v in bm.verts:                                # wall local coordinates
        v.co = wall.matrix_world.inverted() @ v.co
    bm.to_mesh(cut)
    bm.free()
    cutter = _bpy.data.objects.new(name + "_cut", cut)
    sc.collection.objects.link(cutter)
    cutter.matrix_world = wall.matrix_world.copy()
    mod = wall.modifiers.new(name + "_cut", "BOOLEAN")
    mod.operation, mod.object, mod.solver = "DIFFERENCE", cutter, "EXACT"
    with _bpy.context.temp_override(object=wall, active_object=wall, selected_objects=[wall]):
        _bpy.ops.object.modifier_move_to_index(modifier=name + "_cut", index=0)
        _bpy.ops.object.modifier_apply(modifier=name + "_cut")
    _bpy.data.objects.remove(cutter, do_unlink=True)


def _voile(name, x0, x1, z0, z1, y=WALL_Y + 0.055, n=None):
    """Voile curtain with vertical wave folds right behind the glass (sheer_voile material from _window_light)."""
    bm = _bmesh.new()
    nx_ = n or max(8, int((x1 - x0) * 110))
    grid = [[bm.verts.new((x0 + (x1 - x0) * i / nx_, y + 0.012 * _m.sin(i * 0.9) + 0.006 * _m.sin(i * 0.37 + 1.0),
                           z0 + (z1 - z0) * j / 2)) for j in range(3)] for i in range(nx_ + 1)]
    for i in range(nx_):
        for j in range(2):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    return _bm_obj(name, bm, _bpy.data.materials["sheer_voile"], smooth=True, check=False)


def _window_light(name, x0, x1, z0, z1):
    """Real light in the room behind the porch window: cut a wall hole matching the glass, thin curtains at the sides + valance (just for shadows),
    warm ceiling light in the room → a window-shaped light patch with muntin/frame shadows on the porch floor, faint bounce onto the wall/railing.
    render_passes turns it on in every pass with ambient light (lit + dark), off in the candlelight pass."""
    _cut_wall(name, x0 + 0.002, x1 - 0.002, z0 + 0.002, z1 - 0.002)
    # heavy curtains at the sides (gathered at mid-height) + valance: coarse turmeric-coloured weave, little light through
    cm = MB("curtain_cloth")
    tl = cm.node("ShaderNodeBsdfTranslucent")
    tl.inputs["Color"].default_value = hexc("#b0602a")
    df = cm.node("ShaderNodeBsdfDiffuse")
    df.inputs["Color"].default_value = hexc("#8a4a22")
    tp = cm.node("ShaderNodeBsdfTransparent")
    tp.inputs["Color"].default_value = hexc("#ffcf9a")
    mx = cm.node("ShaderNodeMixShader")
    mx.inputs[0].default_value = 0.5
    cm.link(tl.outputs[0], mx.inputs[1])
    cm.link(df.outputs[0], mx.inputs[2])
    mx2 = cm.node("ShaderNodeMixShader")
    mx2.inputs[0].default_value = 0.12
    cm.link(mx.outputs[0], mx2.inputs[1])
    cm.link(tp.outputs[0], mx2.inputs[2])
    cm.link(mx2.outputs[0], cm.out.inputs["Surface"])
    W_ = x1 - x0
    bm = _bmesh.new()
    yc = WALL_Y + 0.09
    nz_ = 24
    for side in (0, 1):
        prev = None
        for k in range(nz_ + 1):
            z = z0 + (z1 - z0) * k / nz_
            v = (z - z0) / (z1 - z0)
            cw = (0.31 - 0.13 * _m.exp(-((v - 0.45) / 0.13) ** 2)) * W_
            xa, xb = (x0 - 0.05, x0 + cw) if side == 0 else (x1 - cw, x1 + 0.05)
            row = (bm.verts.new((xa, yc, z)), bm.verts.new((xb, yc, z)))
            if prev:
                bm.faces.new((prev[0], prev[1], row[1], row[0]))
            prev = row
    _bm_box(bm, x0 - 0.05, x1 + 0.05, yc - 0.002, yc + 0.002, z0 + 0.87 * (z1 - z0), z1 + 0.05)
    cur = _bm_obj(name + "_curtains", bm, cm.m, check=False)
    # vertical folds for the heavy curtains
    for v in cur.data.vertices:
        v.co.y += 0.025 * _m.sin(v.co.x * 55.0)
    cur.data.update()
    # voile curtain covering the whole opening, against the glass: vertical wave folds, warm light through (room light from behind)
    vm = MB("sheer_voile")
    tl = vm.node("ShaderNodeBsdfTranslucent")
    tl.inputs["Color"].default_value = hexc("#f2d2a4")
    df = vm.node("ShaderNodeBsdfDiffuse")
    df.inputs["Color"].default_value = hexc("#e8d4b8")
    tp = vm.node("ShaderNodeBsdfTransparent")
    tp.inputs["Color"].default_value = hexc("#ffe2b8")
    mx = vm.node("ShaderNodeMixShader")
    mx.inputs[0].default_value = 0.3
    vm.link(tl.outputs[0], mx.inputs[1])
    vm.link(df.outputs[0], mx.inputs[2])
    mx2 = vm.node("ShaderNodeMixShader")
    mx2.inputs[0].default_value = 0.4
    vm.link(mx.outputs[0], mx2.inputs[1])
    vm.link(tp.outputs[0], mx2.inputs[2])
    vm.link(mx2.outputs[0], vm.out.inputs["Surface"])
    _voile(name + "_voile", x0 - 0.04, x1 + 0.04, z0 - 0.02, z1 + 0.02, n=120)
    # inner room (inward-facing box): warm beige walls, wood floor, ceiling; + a table lamp shade for depth behind the curtain
    rx0, rx1, ry1, rz1 = DX0 - 0.3, x1 + 1.0, WALL_Y + 3.2, 2.7          # room extends left to behind the front door
    wall_m = mat_simple("room_wall", "#c9a77e", 0.9)
    floor_m = mat_simple("room_floor", "#5a3a22", 0.6)
    bm = _bmesh.new()
    P = lambda x, y, z: bm.verts.new((x, y, z))
    yb = WALL_Y + 0.05
    for quad in (((rx0, yb, 0), (rx0, ry1, 0), (rx1, ry1, 0), (rx1, yb, 0)),
                 ((rx0, yb, rz1), (rx1, yb, rz1), (rx1, ry1, rz1), (rx0, ry1, rz1)),
                 ((rx0, ry1, 0), (rx0, ry1, rz1), (rx1, ry1, rz1), (rx1, ry1, 0)),
                 ((rx0, yb, 0), (rx0, yb, rz1), (rx0, ry1, rz1), (rx0, ry1, 0)),
                 ((rx1, yb, 0), (rx1, ry1, 0), (rx1, ry1, rz1), (rx1, yb, rz1))):
        bm.faces.new([P(*c) for c in quad])
    _bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _bmesh.ops.reverse_faces(bm, faces=bm.faces)                 # normals face inwards
    room = _bm_obj(name + "_room", bm, wall_m, check=False)
    room.data.materials.append(floor_m)
    for f in room.data.polygons:
        if f.center.z < 0.01:
            f.material_index = 1
    sh_ = MB("lamp_shade")
    tl = sh_.node("ShaderNodeBsdfTranslucent")
    tl.inputs["Color"].default_value = hexc("#ffd8a0")
    df = sh_.node("ShaderNodeBsdfDiffuse")
    df.inputs["Color"].default_value = hexc("#f0d8a8")
    mx = sh_.node("ShaderNodeMixShader")
    mx.inputs[0].default_value = 0.6
    sh_.link(df.outputs[0], mx.inputs[1])
    sh_.link(tl.outputs[0], mx.inputs[2])
    sh_.link(mx.outputs[0], sh_.out.inputs["Surface"])
    shade_m = sh_.m
    _lathe_obj(name + "_lampshade", [(0.0, 0.17), (0.28, 0.11)], shade_m, (x0 + 0.25, WALL_Y + 1.1, 1.05), seg=32, check=False)
    _lathe_obj(name + "_lampbase", [(0.0, 0.1), (0.04, 0.1), (0.05, 0.02), (1.05, 0.015), (1.06, 0.0)],
               mat_simple("lamp_base", "#2a2018", 0.5), (x0 + 0.25, WALL_Y + 1.1, 0.0), seg=20, check=False)
    lamp_in = light(name + "_tablelamp", "POINT", 25.0, "#ffb060", (x0 + 0.25, WALL_Y + 1.1, 1.2), shadow_soft_size=0.06)
    lamp_in.visible_camera = False
    # room ceiling light (small bulb → muntin/frame shadows sharp enough), 1.6 m behind the window, 2.6 m high: lower pane +
    # middle rail cast a trapezoid light patch on the porch floor (y ≈ 0.8 → front edge). Spot light so nothing leaks outside the opening.
    xc = (x0 + x1) / 2
    lamp = light(name + "_lamp", "SPOT", WINDOW_LAMP_W, "#ffb468", (xc, WALL_Y + 1.6, 2.6), shadow_soft_size=0.035,
                 spot_size=rad(80), spot_blend=0.25)
    lamp.rotation_euler = (_V((xc, WALL_Y, (z0 + z1) / 2 - 0.15)) - lamp.location).to_track_quat("-Z", "Y").to_euler()
    lamp.visible_camera = False
    # voile glow: very soft light strip right behind the glass, pointing down → soft halo on the sill + floor by the wall
    soft = light(name + "_soft", "AREA", 2.5, "#ffae5c", (xc, WALL_Y + 0.15, (z0 + z1) / 2), size=W_ * 0.8,
                 size_y=(z1 - z0) * 0.8, shape="RECTANGLE")
    soft.rotation_euler = _V((0, -1, -0.6)).to_track_quat("-Z", "Y").to_euler()
    soft.visible_camera = False


def _house():
    # siding wall: extended right to HOUSE_X1, up through the second floor, down to the yard (outside the porch)
    _stretch("wall", "x", None, HOUSE_X1)
    _stretch("wall", "z", YARD_Z, WALL_TOP)
    paint = _bpy.data.materials.get("porch_paint") or M_TRIM
    _bx("house_corner_r", HOUSE_X1 - 0.12, HOUSE_X1, WALL_Y - 0.03, WALL_Y + 0.03, YARD_Z, WALL_TOP, paint)
    # stone foundation at the wall base outside the porch
    stone = MB("foundation")
    tcs = stone.node("ShaderNodeTexCoord")
    vor = stone.node("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 7.0
    stone.link(tcs.outputs["Object"], vor.inputs["Vector"])
    stone.link(stone.ramp(vor.outputs["Distance"], [(0.0, "#2a2a2e"), (0.35, "#45444a"), (0.5, "#151518")]), stone.bsdf.inputs["Base Color"])
    stone.set(Roughness=0.9)
    stone.bump(vor.outputs["Distance"], 0.5)
    _bx("foundation", PX1 + 0.02, HOUSE_X1, WALL_Y - 0.06, WALL_Y, YARD_Z - 0.02, 0.0, stone.m)
    # ground-floor windows under the porch (past the front door) + beyond the porch; second floor: a few dimly lit panes
    glow = _see_through(_mat_window_glow("window_glow", 1.0))
    clear = _mat_clear_glass()
    glow_dim = _mat_window_glow("window_glow_dim", 0.45)
    dark = _mat_window_dark()
    _window("window_porch", 2.05, 3.15, 0.85, 2.05, clear)        # real glass: shows the voile curtain + room behind
    _window("window_side1", 7.0, 8.1, 0.85, 2.05, dark)
    _window("window_side2", 10.4, 11.5, 0.85, 2.05, glow_dim)
    _window("window_side3", 13.6, 14.7, 0.85, 2.05, dark)
    for i, (x, m_) in enumerate(((0.3, dark), (2.6, glow_dim), (5.3, dark), (7.55, dark), (10.95, glow_dim), (14.15, dark))):
        _window(f"window_up{i}", x - 0.5, x + 0.5, 3.75, 4.95, m_)
    _window_light("window_porch", 2.05, 3.15, 0.85, 2.05)
    # main roof above the second floor: soffit, fascia, gutter, roof surface (camera-only)
    ey, ez = WALL_Y - 0.45, WALL_TOP + 0.2
    _bx("main_soffit", WALL_X0 - 0.45, HOUSE_X1 + 0.45, ey, WALL_Y, WALL_TOP - 0.02, WALL_TOP, paint, True)
    _bx("main_fascia", WALL_X0 - 0.45, HOUSE_X1 + 0.45, ey - 0.025, ey, WALL_TOP - 0.04, ez, paint, True)
    gut = _bpy.data.materials.get("gutter") or _mat_metal("gutter", "#3a3632", 0.4)
    _gutter("main_gutter", _V((WALL_X0 - 0.45, ey - 0.09, ez - 0.02)), _V((HOUSE_X1 + 0.45, ey - 0.09, ez - 0.02)), gut)
    bm = _bmesh.new()
    ridge_y, ridge_z = 6.5, ez + (6.5 - ey) * 0.55
    vs = [bm.verts.new(p) for p in ((WALL_X0 - 0.45, ey, ez), (HOUSE_X1 + 0.45, ey, ez),
                                    (HOUSE_X1 + 0.45, ridge_y, ridge_z), (WALL_X0 - 0.45, ridge_y, ridge_z))]
    bm.faces.new(vs)
    _bm_obj("main_roof", bm, _bpy.data.materials.get("roof_shingle") or _mat_shingle(), cam_only=True)
    print("WIDE house")


# ───────────────────────── 3. left end: side railing, corner post, steps down to the yard ─────────────────────────
def _left():
    paint = _bpy.data.materials.get("porch_paint") or M_TRIM
    x = -2.5
    # side railing from the back corner post (porch_post_far) out to the newel
    _railing("rail_left", _V((x, RAIL_Y - 0.06, 0)), _V((x, 0.5, 0)), paint)
    # newel post with cap
    _bx("newel_left", x - 0.06, x + 0.06, 0.39, 0.51, 0.0, 1.0, paint)
    _bx("newel_left_cap", x - 0.08, x + 0.08, 0.37, 0.53, 1.0, 1.04, paint)
    # steps down to the yard (two steps + a stone block), each step a solid block down to the yard
    y0, y1 = POST_Y + 0.08, 0.39
    steps = [(PX0 - 0.30, PX0, -0.143), (PX0 - 0.60, PX0 - 0.30, -0.286)]
    for i, (a, b, ztop) in enumerate(steps):
        _bx(f"lstep{i}", a, b, y0, y1, YARD_Z - 0.02, ztop - 0.03, M_STEP)
        _bx(f"lstep{i}_tread", a - 0.02, b, y0 - 0.02, y1 + 0.02, ztop - 0.035, ztop, M_STEP)
    _bx("lstep_stone", PX0 - 0.95, PX0 - 0.6, y0 + 0.05, y1 - 0.05, YARD_Z - 0.02, YARD_Z + 0.025,
        mat_simple("stone_pad", "#4a4a50", 0.85))
    # stair stringers on both sides (simple sloped beams)
    for i, yy in enumerate((y0 - 0.04, y1 + 0.04)):
        bm = _bmesh.new()
        prof = [(PX0, 0.0), (PX0, YARD_Z), (PX0 - 0.62, YARD_Z), (PX0 - 0.62, YARD_Z + 0.06)]
        vs = [bm.verts.new((px, yy - 0.02, pz)) for px, pz in prof] + [bm.verts.new((px, yy + 0.02, pz)) for px, pz in prof]
        n = len(prof)
        bm.faces.new(vs[:n][::-1])
        bm.faces.new(vs[n:])
        for k in range(n):
            bm.faces.new((vs[k], vs[(k + 1) % n], vs[n + (k + 1) % n], vs[n + k]))
        _bm_obj(f"lstep_stringer{i}", bm, paint)
    # stepping stones from the foot of the steps to the fence gate
    sm = mat_simple("path_stone", "#3c3c42", 0.9)
    bm = _bmesh.new()
    for k in range(6):
        cx = PX0 - 1.3 - k * 0.68 + _wrng.uniform(-0.05, 0.05)
        cy = -0.02 + _wrng.uniform(-0.1, 0.1)
        g = _bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.24, radius2=0.22, depth=0.05)
        vs = g["verts"]
        for v in vs:
            a = _m.atan2(v.co.y, v.co.x)
            v.co.x *= 1.0 + 0.12 * _m.sin(3 * a + k)
            v.co.y *= 0.85 + 0.1 * _m.cos(2 * a + k)
        _bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=_Mx.Rotation(_wrng.uniform(0, 3), 3, "Z"))
        _bmesh.ops.translate(bm, verts=vs, vec=(cx, cy, YARD_Z + 0.01))
    _bm_obj("path_stones", bm, sm)
    print("WIDE left")


# ───────────────────────── 4. yard ─────────────────────────
def _yard():
    yd = _bpy.data.objects.get("yard")
    if yd:
        # wider so the horizon on both sides is farther (the front is covered by the flat sky backdrop from 30 m as before)
        _stretch("yard", "x", -90.0, 90.0)
        _stretch("yard", "y", -60.0, 95.0)
        yd.data.materials.clear()
        yd.data.materials.append(_mat_ground())
    print("WIDE yard")


# ───────────────────────── 5. picket fence ─────────────────────────
def _fence():
    m_ = _mat_paint("fence_paint", "#a39d90", 0.75, 0.55, 1.5)
    bm = _bmesh.new()
    segs = [((-7.2, -4.6), (-7.2, -0.55)), ((-7.2, 0.55), (-7.2, 7.4)), ((-7.2, 7.4), (-5.3, 7.4))]
    z0 = YARD_Z
    for (ax, ay), (bx_, by) in segs:
        a, b = _V((ax, ay, 0)), _V((bx_, by, 0))
        L = (b - a).length
        t = (b - a).normalized()
        nrm = _V((-t.y, t.x, 0))
        along_x = abs(t.x) > 0.5
        # fence post every ~2 m
        npost = max(1, round(L / 2.0))
        for k in range(npost + 1):
            p = a + t * (L * k / npost)
            _bm_box(bm, p.x - 0.045, p.x + 0.045, p.y - 0.045, p.y + 0.045, z0 - 0.05, z0 + 1.05)
            _bm_box(bm, p.x - 0.06, p.x + 0.06, p.y - 0.06, p.y + 0.06, z0 + 1.05, z0 + 1.09)
        # hai thanh ngang
        for zz in (0.22, 0.72):
            if along_x:
                _bm_box(bm, min(a.x, b.x), max(a.x, b.x), a.y + 0.03, a.y + 0.065, z0 + zz - 0.035, z0 + zz + 0.035)
            else:
                _bm_box(bm, a.x - 0.065, a.x - 0.03, min(a.y, b.y), max(a.y, b.y), z0 + zz - 0.035, z0 + zz + 0.035)
        # pickets outside the rails, slightly uneven heights, a bit tilted like an old fence
        k = 0.07
        while k < L - 0.05:
            p = a + t * k
            h = 0.92 + _wrng.uniform(-0.02, 0.02)
            w, th = 0.075, 0.02
            off = _V((0, 0.085, 0)) if along_x else _V((-0.085, 0, 0))     # outside the rails
            c = p + off
            lean = _wrng.uniform(-0.025, 0.025)
            pts2 = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, h - 0.06), (0.0, h), (-w / 2, h - 0.06)]
            ring0, ring1 = [], []
            for (s_, zz) in pts2:
                q = c + t * s_ + _V((0, 0, z0 - 0.04 + zz)) + t * lean * zz
                ring0.append(bm.verts.new(q - nrm * th / 2))
                ring1.append(bm.verts.new(q + nrm * th / 2))
            bm.faces.new(ring0[::-1])
            bm.faces.new(ring1)
            for i in range(5):
                bm.faces.new((ring0[i], ring0[(i + 1) % 5], ring1[(i + 1) % 5], ring1[i]))
            k += 0.13 + _wrng.uniform(-0.006, 0.006)
    _bm_obj("picket_fence", bm, m_)
    # two gate posts with ball finials
    bm = _bmesh.new()
    for y in (-0.6, 0.6):
        _bm_box(bm, -7.27, -7.13, y - 0.07, y + 0.07, z0 - 0.05, z0 + 1.2)
        g = _bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.07)
        _bmesh.ops.translate(bm, verts=g["verts"], vec=(-7.2, y, z0 + 1.27))
    _bm_obj("fence_gate_posts", bm, m_, smooth=False)
    print("WIDE fence")


# ───────────────────────── 6. bare trees ─────────────────────────
def _tree(name, base, height, seed, maxd=5):
    rng = _random_mod.Random(seed)
    cu = _bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 1
    cu.use_fill_caps = True
    cu.resolution_u = 3

    def spline(pts, radii):
        sp = cu.splines.new("NURBS")
        sp.points.add(len(pts) - 1)
        for k, (p, r_) in enumerate(zip(pts, radii)):
            sp.points[k].co = (p.x, p.y, p.z, 1.0)
            sp.points[k].radius = r_
        sp.use_endpoint_u = True
        sp.order_u = min(3, len(pts))

    count = [0]

    def grow(p, d, L, r_, depth):
        n = 4
        pts, radii = [p], [r_]
        for k in range(1, n + 1):
            jit = _V((rng.gauss(0, 0.2), rng.gauss(0, 0.2), rng.gauss(0, 0.1)))
            d = (d + jit + _V((0, 0, 0.05 if depth else 0.12))).normalized()
            p = p + d * (L / n)
            pts.append(p)
            radii.append(r_ * (1 - 0.42 * k / n))
        spline(pts, radii)
        count[0] += 1
        if depth >= maxd:
            return
        kids = 2 if depth == 0 else rng.choice((2, 3, 3))
        for _ in range(kids):
            i = rng.randint(2, n)
            q = pts[i]
            axis = d.cross(_V((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))).normalized()
            cd = (_Mx.Rotation(rad(rng.uniform(24, 48)), 3, axis) @ d).normalized()
            if depth < 2:
                cd = (cd + _V((0, 0, 0.3))).normalized()
            grow(q, cd, L * rng.uniform(0.62, 0.76), radii[i] * 0.72, depth + 1)

    lean = _V((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 1.0)).normalized()
    grow(_V(base) + _V((0, 0, -0.1)), lean, height * 0.36, height * 0.022, 0)
    cu.materials.append(_bpy.data.materials.get("bark") or _mat_bark())
    ob = obj(name, cu, C_ENV)
    return _wreg(ob), count[0]


def _trees():
    _mat_bark()
    spots = [  # (x, y, height, seed) — all on the left, outside the railing window of the base frame
        (-8.6, 5.2, 7.5, 11), (-9.8, 1.8, 8.5, 12), (-14.5, 15.0, 9.5, 13), (-20.0, 8.0, 10.5, 14),
        (-4.6, -2.8, 6.5, 15), (-24.0, 21.0, 11.0, 16), (-13.0, -3.5, 8.0, 17),
    ]
    tot = 0
    for i, (x, y, h, s) in enumerate(spots):
        _, n = _tree(f"tree{i}", (x, y, YARD_Z), h, s)
        tot += n
    print("WIDE trees", len(spots), "branches", tot)


# ───────────────────────── 7. distant houses with lit windows ─────────────────────────
def _far_house(i, cx, cy, w, d, h, wall_col, lit_pattern, yaw_jitter=0.0):
    to_cam = _V((CAM_LOC.x - cx, CAM_LOC.y - cy, 0)).normalized()
    yaw = _m.atan2(to_cam.x, -to_cam.y) + yaw_jitter        # front face (local −y) turned towards the porch
    R_ = _Mx.Rotation(yaw, 3, "Z")
    o = _V((cx, cy, YARD_Z))
    roof_h = w * 0.38

    def P(x, y, z):
        return o + R_ @ _V((x, y, z))

    bm = _bmesh.new()                                  # house body + gable
    hw, hd = w / 2, d / 2
    vb = [bm.verts.new(P(x, y, 0)) for x, y in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
    vt = [bm.verts.new(P(x, y, h)) for x, y in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
    gl, gr = bm.verts.new(P(-hw, 0, h + roof_h)), bm.verts.new(P(hw, 0, h + roof_h))
    for k in range(4):
        bm.faces.new((vb[k], vb[(k + 1) % 4], vt[(k + 1) % 4], vt[k]))
    bm.faces.new((vt[3], vt[0], gl))
    bm.faces.new((vt[1], vt[2], gr))
    _bm_obj(f"far_house{i}", bm, mat_simple(f"far_wall{i}", wall_col, 0.85))
    bm = _bmesh.new()                                  # gable roof with overhang + chimney
    ov = 0.35
    e0 = [P(-hw - ov, -hd - ov, h - ov * 0.7), P(hw + ov, -hd - ov, h - ov * 0.7)]
    e1 = [P(-hw - ov, hd + ov, h - ov * 0.7), P(hw + ov, hd + ov, h - ov * 0.7)]
    rg = [P(-hw - ov, 0, h + roof_h + 0.05), P(hw + ov, 0, h + roof_h + 0.05)]
    a = [bm.verts.new(p) for p in e0 + rg[::-1]]
    bm.faces.new(a)
    b_ = [bm.verts.new(p) for p in rg + e1[::-1]]
    bm.faces.new(b_)
    cx_ = hw * 0.45
    for v in _bm_box(bm, cx_ - 0.35, cx_ + 0.35, 0.3, 0.9, h, h + roof_h + 0.9):
        v.co = o + R_ @ v.co
    _bm_obj(f"far_roof{i}", bm, _bpy.data.materials.get("roof_shingle") or _mat_shingle())
    # windows: two floors on the front face, one column on the gable end the camera sees
    lit_m, dark_m = _bpy.data.materials["far_window_lit"], _bpy.data.materials["window_dark"]
    side = 1 if (R_.inverted() @ _V((CAM_LOC.x - cx, CAM_LOC.y - cy, 0))).x > 0 else -1
    wins = []
    ncol = max(2, int(w / 2.2))
    for row, z in enumerate((1.0, 3.4) if h > 4.5 else (1.0,)):
        for c in range(ncol):
            x = -hw + (c + 0.5) * w / ncol
            wins.append(("f", x, z))
    for row, z in enumerate((1.0, 3.4) if h > 4.5 else (1.0,)):
        wins.append(("s", 0.0, z))
    bl, bd = _bmesh.new(), _bmesh.new()
    for k, (face, x, z) in enumerate(wins):
        lit = lit_pattern[k % len(lit_pattern)] == "1"
        bmx = bl if lit else bd
        if face == "f":
            vs = _bm_box(bmx, x - 0.45, x + 0.45, -hd - 0.04, -hd + 0.01, z, z + 1.2)
        else:
            xa, xb = (hw - 0.01, hw + 0.04) if side > 0 else (-hw - 0.04, -hw + 0.01)
            vs = _bm_box(bmx, xa, xb, -0.5, 0.5, z, z + 1.2)
        for v in vs:
            v.co = o + R_ @ v.co
    _bm_obj(f"far_windows_lit{i}", bl, lit_m)
    _bm_obj(f"far_windows_dark{i}", bd, dark_m)


def _town():
    if not _bpy.data.materials.get("window_dark"):
        _mat_window_dark()
    _emit_mat("far_window_lit", lambda nt: hexc("#ffb257"), 3.2)
    if not _bpy.data.materials.get("roof_shingle"):
        _mat_shingle()
    # (x, y, width, depth, height, wall colour, lit-window pattern) — all outside the railing window of the base frame
    _far_house(0, -16.5, 21.0, 7.0, 6.0, 5.2, "#39404f", "1001101", 0.25)
    _far_house(1, -26.0, 13.0, 8.0, 6.5, 5.6, "#4a3d35", "0110011", -0.2)
    _far_house(2, -28.0, -2.0, 6.5, 6.0, 3.6, "#33403c", "101", 0.3)
    _far_house(3, -40.0, 30.0, 9.0, 7.0, 6.0, "#3a3446", "10011", 0.0)
    print("WIDE town")


# ───────────────────────── 8. panoramic sky ─────────────────────────
# "Level" equirect sky image: lon ∈ [-180, 180] (0 = horizontal direction of the base camera, positive = to the right),
# lat ∈ [SKY_LAT0, 90]. Built once with numpy then cached at blender/textures/sky_pano.jpg:
#   - base: Codex sky painting (raw/sky_pano_raw.png, no moon) spread over lon [-140, 10], mirrored for the rest
#     (the mirror axis at lon 10° sits behind the house wall/porch ceiling so it never shows),
#     the painting's horizon placed at SKY_HOR°, colour-matched to sky.jpg;
#   - moon: moon disc + halo + nearby clouds taken from sky.jpg, projected exactly like the old flat backdrop so the moon stays in the top
#     left of the base frame; full sky.jpg detail within 4.6° of the moon centre, gone by 7°; brightness/colour (halo) blended out to 20°.
#     Drop the flat `sky` backdrop: the base frame and the pano share ONE sky (world), no backdrop edges left;
#   - sprinkle small sharp stars in the dark sky areas.
SKY_PXD = 30                    # px / degree (base frame ~32 px/degree)
SKY_LAT0 = -12.0
SKY_HOR = 0.6                   # latitude of the Codex painting's horizon (distant hills rise above the yard)
SKY_VER = 6


def _np_load(path):
    """Image → float32 HxWx3 sRGB values 0..1, row 0 = top."""
    im = _bpy.data.images.load(path, check_existing=False)
    w_, h_ = im.size
    a = _np.empty(w_ * h_ * 4, _np.float32)
    im.pixels.foreach_get(a)
    fl = im.is_float
    _bpy.data.images.remove(im)
    a = a.reshape(h_, w_, 4)[::-1, :, :3].copy()
    if fl:                                             # float images are linear → convert to sRGB
        a = _np.where(a <= 0.0031308, a * 12.92, 1.055 * _np.power(_np.clip(a, 0, None), 1 / 2.4) - 0.055)
    return a


def _np_save_jpg(a, path, q=92):
    h_, w_ = a.shape[:2]
    rgba = _np.ones((h_, w_, 4), _np.float32)
    rgba[..., :3] = _np.clip(a, 0, 1)
    im = _bpy.data.images.new("sky_pano_tmp", w_, h_, alpha=False)
    im.pixels.foreach_set(rgba[::-1].ravel())
    im.filepath_raw = path
    im.file_format = "JPEG"
    im.save(quality=q)
    _bpy.data.images.remove(im)


def _bilerp(a, x, y):
    """Bilinear sampling; x, y in pixels (pixel 0 centre at 0.5), clamped at the edges."""
    h_, w_ = a.shape[:2]
    x = _np.clip(x - 0.5, 0, w_ - 1.001)
    y = _np.clip(y - 0.5, 0, h_ - 1.001)
    x0 = _np.floor(x).astype(_np.int32)
    y0 = _np.floor(y).astype(_np.int32)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    return ((a[y0, x0] * (1 - fx) + a[y0, x0 + 1] * fx) * (1 - fy) + (a[y0 + 1, x0] * (1 - fx) + a[y0 + 1, x0 + 1] * fx) * fy)


def _down2(a):
    h_, w_ = a.shape[:2]
    a = a[:h_ // 2 * 2, :w_ // 2 * 2]
    return (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) / 4


def _up2(a, shape):
    b = _np.repeat(_np.repeat(a, 2, 0), 2, 1)
    out = _np.empty(shape[:2] + a.shape[2:], a.dtype)
    hh, ww = min(shape[0], b.shape[0]), min(shape[1], b.shape[1])
    out[:hh, :ww] = b[:hh, :ww]
    out[hh:, :ww] = b[hh - 1:hh, :ww]
    out[:, ww:] = out[:, ww - 1:ww]
    # soften with a 2×2 box
    out = (out + _np.roll(out, 1, 0) + _np.roll(out, -1, 0) + _np.roll(out, 1, 1) + _np.roll(out, -1, 1)) / 5
    return out


def _blur_pyr(a, k):
    """Cheap very wide blur: downscale 2^k times then upscale again."""
    shapes = []
    for _ in range(k):
        shapes.append(a.shape)
        a = _down2(a)
    for sh_ in shapes[::-1]:
        a = _up2(a, sh_)
    return a


def _pull_push(col, msk):
    """Fill outside the mask with colour smoothly extended from inside (multi-level pull-push)."""
    cs, ws = [col * msk[..., None]], [msk]
    while min(ws[-1].shape) > 4:
        cs.append(_down2(cs[-1]))
        ws.append(_down2(ws[-1]))
    f = cs[-1] / _np.maximum(ws[-1], 1e-6)[..., None]
    for c, w_ in zip(cs[-2::-1], ws[-2::-1]):
        up = _up2(f, c.shape)
        val = c / _np.maximum(w_, 1e-6)[..., None]
        a_ = _np.clip(w_ * 1.5, 0, 1)[..., None]
        f = val * a_ + up * (1 - a_)
    return f


def _sky_geom():
    """Flat backdrop parameters (from build_scene) to project sky.jpg exactly like the `sky` plane."""
    fwd_c = _V(fwd).normalized()
    rgt = _V(right).normalized()
    upp = rgt.cross(fwd_c).normalized()
    fh_ = _V(fwd_h).normalized()
    return fwd_c, rgt, upp, fh_


def _sky_dirs(lon, lat):
    """World directions for a lon/lat grid (degrees) in the level frame: fwd_h, right, z."""
    _, rgt, _, fh_ = _sky_geom()
    lo, la = _np.radians(lon), _np.radians(lat)
    cl = _np.cos(la)
    F = _np.array(fh_)[None, None, :]
    Rr = _np.array(rgt)[None, None, :]
    Z = _np.array((0.0, 0.0, 1.0))[None, None, :]
    return (cl * _np.cos(lo))[..., None] * F + (cl * _np.sin(lo))[..., None] * Rr + _np.sin(la)[..., None] * Z


def _skyjpg_uv(d):
    """Direction → (u, v) on the flat backdrop (same as the `sky` mesh UVs), v up. Also returns a validity flag."""
    fwd_c, rgt, upp, _ = _sky_geom()
    df = d @ _np.array(fwd_c)
    ok = df > 0.05
    t = SKY_D / _np.where(ok, df, 1.0)
    X = t * (d @ _np.array(rgt))
    Y = t * (d @ _np.array(upp)) - fh
    u = (X - x0) / sw
    v = (Y + sh) / (sh + 0.5)
    return u, v, ok


def _build_sky_pano(out_path):
    raw_p = os.path.join(TEX, "raw", "sky_pano_raw.png")
    sky_p = os.path.join(TEX, "sky.jpg")
    meta_p = out_path + ".json"
    key = {"ver": SKY_VER, "mt": [round(os.path.getmtime(p)) for p in (raw_p, sky_p) if os.path.exists(p)], "pxd": SKY_PXD,
           "geom": [round(c, 5) for c in list(fwd) + [x0, sw, sh, fh]]}
    try:
        if os.path.exists(out_path) and _json.load(open(meta_p)) == key:
            print("WIDE sky_pano cached")
            return
    except Exception:
        pass
    PW, PH = 360 * SKY_PXD, int(round((90 - SKY_LAT0) * SKY_PXD))
    lon = -180 + (_np.arange(PW, dtype=_np.float32) + 0.5) / SKY_PXD
    lat = 90 - (_np.arange(PH, dtype=_np.float32) + 0.5) / SKY_PXD
    LON, LAT = _np.meshgrid(lon, lat)
    skyj = _np_load(sky_p) if os.path.exists(sky_p) else None
    # 1. Codex base
    if os.path.exists(raw_p):
        cod = _np_load(raw_p)
        Hc, Wc = cod.shape[:2]
        s = Wc / 150.0
        base = _np.empty((PH, PW, 3), _np.float32)
        for j in range(0, PH, 256):                    # in row blocks to save RAM
            t = _np.mod((LON[j:j + 256] + 140.0) / 150.0, 2.0)
            t = _np.where(t > 1, 2 - t, t)
            base[j:j + 256] = _bilerp(cod, t * Wc, 0.88 * Hc - (LAT[j:j + 256] - SKY_HOR) * s)
        if skyj is not None:                           # colour-match to the sky part of sky.jpg (excluding the moon area)
            ref = skyj[:int(skyj.shape[0] * 0.62)].reshape(-1, 3)
            ref = ref[ref.mean(1) < 0.45]
            src = cod[:int(Hc * 0.8)].reshape(-1, 3)
            mu_r, sd_r, mu_s, sd_s = ref.mean(0), ref.std(0), src.mean(0), src.std(0)
            k_ = _np.clip(sd_r / _np.maximum(sd_s, 1e-4), 0.7, 1.4)
            base = (base - mu_s) * k_ + mu_r
    else:                                              # no painting: indigo → blue-grey gradient
        g = _np.clip((LAT - SKY_HOR) / 60.0, 0, 1)[..., None]
        base = _np.array((0.23, 0.29, 0.42)) * (1 - g) + _np.array((0.08, 0.10, 0.2)) * g
        base = _np.where((LAT < SKY_HOR)[..., None], _np.array((0.03, 0.035, 0.05)), base)
    base = base.astype(_np.float32)
    # 2–3. the sky.jpg moon (disc, halo, nearby clouds) pasted at the old direction, blended into the Codex painting by radius
    keep = _np.zeros((PH, PW), bool)
    if skyj is not None:
        Hs, Ws = skyj.shape[:2]
        lum = skyj.mean(-1)
        rr, cc = _np.nonzero(lum > 0.85)                # moon disc centre in sky.jpg
        mu, mv = (cc.mean() + 0.5) / Ws, 1 - (rr.mean() + 0.5) / Hs
        fwd_c, rgt, upp, _ = _sky_geom()
        mdir = (fwd_c * SKY_D + upp * (mv * (sh + 0.5) - sh + fh) + rgt * (x0 + mu * sw)).normalized()
        mlat = _m.degrees(_m.asin(mdir.z))
        mlon = _m.degrees(_m.atan2(mdir.dot(rgt), mdir.dot(_sky_geom()[3])))
        print(f"WIDE moon lon {mlon:.1f} lat {mlat:.1f}")
        j0, j1 = int((90 - min(89.0, mlat + 32)) * SKY_PXD), int((90 - max(SKY_LAT0, mlat - 32)) * SKY_PXD)
        i0, i1 = int((mlon - 34 + 180) * SKY_PXD), int((mlon + 34 + 180) * SKY_PXD)
        d = _sky_dirs(LON[j0:j1, i0:i1], LAT[j0:j1, i0:i1])
        u, v, ok = _skyjpg_uv(d)
        inside = ok & (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
        S = _np.where(inside[..., None], _bilerp(skyj, u * Ws, (1 - v) * Hs), 0).astype(_np.float32)
        # beyond the sky.jpg edge (left of the moon): blurred extension from the edge strip, excluding the moon disc so it doesn't smear
        din = _np.degrees(_np.minimum(_np.minimum(u, 1 - u) * sw, _np.minimum(v, 1 - v) * (sh + 0.5)) / SKY_D)
        src = inside & (din < 2.0) & (S.mean(-1) < 0.75)
        X = _np.where(inside[..., None], S, _pull_push(S, src.astype(_np.float32))).astype(_np.float32)
        dist = _np.degrees(_np.arccos(_np.clip(d @ _np.array(mdir), -1, 1)))
        sstep = lambda x: x * x * (3 - 2 * x)
        wNear = sstep(_np.clip((7.0 - dist) / 2.4, 0, 1))[..., None]      # sky.jpg detail: full within 4.6°, gone by 7°
        wLow = sstep(_np.clip((20.0 - dist) / 15.0, 0, 1))[..., None]     # brightness/colour (moon halo): out to 20°
        C = base[j0:j1, i0:i1]
        Lc, Lx = _blur_pyr(C, 6), _blur_pyr(X, 6)
        base[j0:j1, i0:i1] = (C - Lc) * (1 - wNear) + (X - Lx) * wNear + Lc * (1 - wLow) + Lx * wLow
        keep[j0:j1, i0:i1] = wNear[..., 0] > 0.02
    # 4. small sharp stars in dark sky areas (outside the sky.jpg area)
    rs = _np.random.RandomState(31)
    nstar = 1400
    sx = rs.uniform(0, PW, nstar)
    sl = _np.degrees(_np.arcsin(rs.uniform(_np.sin(_np.radians(SKY_HOR + 4)), 1, nstar)))
    sy = (90 - sl) * SKY_PXD
    br = rs.uniform(0, 1, nstar) ** 3 * 0.75 + 0.12
    tint = _np.array([(1.0, 0.95, 0.85), (0.85, 0.9, 1.0), (1.0, 1.0, 1.0)])[rs.randint(0, 3, nstar)]
    for x_, y_, b_, c_ in zip(sx, sy, br, tint):
        xi, yi = int(x_), int(y_)
        if yi < 1 or yi >= PH - 1 or xi < 1 or xi >= PW - 1 or keep[yi, xi]:
            continue
        bg = base[yi, xi].mean()
        if bg > 0.2:                                   # behind bright clouds: skip
            continue
        k_ = b_ * _np.clip((0.2 - bg) * 6, 0, 1)
        base[yi, xi] += c_ * k_
        for dy_, dx_ in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            base[yi + dy_, xi + dx_] += c_ * k_ * 0.28
    _np_save_jpg(base, out_path)
    _json.dump(key, open(meta_p, "w"))
    print("WIDE sky_pano built", PW, PH)


def _sky():
    tex_path = os.path.join(TEX, "sky_pano.jpg")
    _build_sky_pano(tex_path)
    wt = sc.world.node_tree
    nodes = wt.nodes
    bg0 = next(n for n in nodes if n.type == "BACKGROUND")        # old ambient light (#141a33, adjusted by render_passes)
    out = next(n for n in nodes if n.type == "OUTPUT_WORLD")
    tc = nodes.new("ShaderNodeTexCoord")
    dvec = _nvm(wt, "NORMALIZE", tc.outputs["Generated"])
    _, rgt, _, fh_ = _sky_geom()
    dF = _nvm(wt, "DOT_PRODUCT", dvec, tuple(fh_), out="Value")
    dR = _nvm(wt, "DOT_PRODUCT", dvec, tuple(rgt), out="Value")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    wt.links.new(dvec, sep.inputs[0])
    lon = _nm(wt, "ARCTAN2", dR, dF)
    lat = _nm(wt, "ARCSINE", sep.outputs["Z"])
    u = _nm(wt, "MULTIPLY_ADD", lon, 1 / (2 * _m.pi), 0.5)
    span = _m.radians(90 - SKY_LAT0)
    v = _nm(wt, "MULTIPLY_ADD", lat, 1 / span, -_m.radians(SKY_LAT0) / span)
    cmb = nodes.new("ShaderNodeCombineXYZ")
    wt.links.new(u, cmb.inputs["X"])
    wt.links.new(v, cmb.inputs["Y"])
    it = nodes.new("ShaderNodeTexImage")
    it.image = _bpy.data.images.load(tex_path, check_existing=True)
    it.extension = "EXTEND"
    it.interpolation = "Linear"
    wt.links.new(cmb.outputs[0], it.inputs["Vector"])
    bg1 = nodes.new("ShaderNodeBackground")
    bg1.name = "sky_bg"                                # render_passes.py adjusts Strength together with the flat sky backdrop
    bg1.inputs["Strength"].default_value = 1.0
    wt.links.new(it.outputs["Color"], bg1.inputs["Color"])
    lp = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    wt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    wt.links.new(bg0.outputs[0], mix.inputs[1])
    wt.links.new(bg1.outputs[0], mix.inputs[2])
    wt.links.new(mix.outputs[0], out.inputs["Surface"])
    # drop the old flat sky backdrop: the sky is now world-only (keep the "sky" material so old scripts don't break)
    old = _bpy.data.objects.get("sky")
    if old:
        old.data.materials[0].use_fake_user = True
        _bpy.data.objects.remove(old, do_unlink=True)
    print("WIDE sky world")


# ───────────────────────── 8b. a more refined front door + decorations along the wall base ─────────────────────────
# Old door (flat box + 4 stuck-on panels + square knob) → wine-red satin painted wood door: real stiles/rails, upper half
# 6-pane glass (warm room glow through a voile curtain), lower half 2 bevelled raised panels + mouldings, brass handle + lock,
# mail slot, autumn-leaf wreath hung on a ribbon; door casing with plinth blocks + head moulding; house number.
# Wall base right of the door: hay bale + big/small pumpkins, potted mums; under the window: wooden bench + plaid blanket + white pumpkin.
# The doormat now sits right in front of the door (fixed in porch_details). Dry leaves under the new items are cleared.
def _mat_door_paint():
    mb = MB("door_paint")
    tc = mb.node("ShaderNodeTexCoord")
    mp = mb.node("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (60.0, 60.0, 2.5)    # vertical wood grain under the paint
    mb.link(tc.outputs["Object"], mp.inputs["Vector"])
    grain = mb.noise(1.0, 6.0, mp.outputs[0], 0.6)
    col = mb.ramp(grain.outputs["Fac"], [(0.3, "#401806"), (0.7, "#62260c")])
    mb.link(col, mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.38, Coat_Weight=0.35, Coat_Roughness=0.18)
    mb.bump(grain.outputs["Fac"], 0.05, 0.001)
    return mb.m


def _mat_brass(name="brass", rough=0.28):
    mb = MB(name)
    tc = mb.node("ShaderNodeTexCoord")
    nz = mb.noise(40.0, 4.0, tc.outputs["Object"])
    mb.link(mb.ramp(nz.outputs["Fac"], [(0.3, "#8a6a3a"), (0.7, "#c9a467")]), mb.bsdf.inputs["Base Color"])
    mb.link(_nm(mb.nt, "MULTIPLY_ADD", nz.outputs["Fac"], 0.2, rough - 0.1), mb.bsdf.inputs["Roughness"])
    mb.set(Metallic=1.0)
    return mb.m


def _mat_door_glass():
    """Door glass pane: room behind a voile curtain (vertical folds), warm at the lower middle; + glossy glass reflection."""
    def build(nt):
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Object"], sep.inputs[0])
        x, z = sep.outputs["X"], sep.outputs["Z"]
        fold = _nm(nt, "MULTIPLY_ADD", _nm(nt, "SINE", _nm(nt, "MULTIPLY", x, 140.0)), 0.12, 0.88)
        cmb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(_nm(nt, "SUBTRACT", x, (DX0 + DX1) / 2), cmb.inputs["X"])
        nt.links.new(_nm(nt, "MULTIPLY", _nm(nt, "SUBTRACT", z, 1.35), 0.7), cmb.inputs["Z"])
        d = _nvm(nt, "LENGTH", cmb.outputs[0], out="Value")
        room = _nramp(nt, d, [(0.0, "#ffc070"), (0.3, "#d07a34"), (0.65, "#4e200c")])
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type, mul.blend_type = "RGBA", "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        nt.links.new(room, [s_ for s_ in mul.inputs if s_.name == "A" and s_.type == "RGBA"][0])
        cf = nt.nodes.new("ShaderNodeCombineColor")
        for k in range(3):
            nt.links.new(fold, cf.inputs[k])
        nt.links.new(cf.outputs[0], [s_ for s_ in mul.inputs if s_.name == "B" and s_.type == "RGBA"][0])
        return [o for o in mul.outputs if o.type == "RGBA"][0]
    m = _emit_mat("door_glass", build, 0.24)
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = nt.nodes["emit_env"]
    gl = nt.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.04
    fr = nt.nodes.new("ShaderNodeFresnel")
    fr.inputs["IOR"].default_value = 1.5
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fr.outputs[0], mx.inputs[0])
    nt.links.new(em.outputs[0], mx.inputs[1])
    nt.links.new(gl.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    return m


def _mat_straw():
    mb = MB("straw")
    tc = mb.node("ShaderNodeTexCoord")
    mp = mb.node("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (3.0, 45.0, 45.0)
    mb.link(tc.outputs["Object"], mp.inputs["Vector"])
    fib = mb.noise(1.0, 10.0, mp.outputs[0], 0.7)
    blot = mb.noise(6.0, 3.0, tc.outputs["Object"])
    col = mb.ramp(fib.outputs["Fac"], [(0.25, "#3c2c12"), (0.5, "#8c6c34"), (0.75, "#c8a45e")])
    dim = mb.mix(blot.outputs["Fac"], hexc("#7a6a52"), hexc("#ffffff"))
    mul = mb.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    mul.inputs["Factor"].default_value = 0.6
    mb.link(col, [s_ for s_ in mul.inputs if s_.name == "A" and s_.type == "RGBA"][0])
    mb.link(dim, [s_ for s_ in mul.inputs if s_.name == "B" and s_.type == "RGBA"][0])
    mb.link([o for o in mul.outputs if o.type == "RGBA"][0], mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.85, Subsurface_Weight=0.05)
    mb.bump(fib.outputs["Fac"], 0.9, 0.006)
    return mb.m


def _mat_mum():
    """Mums: dense small blooms (voronoi), wine red → rust orange, yellow centres, dark gaps between blooms."""
    mb = MB("mum_flowers")
    nt = mb.nt
    tc = mb.node("ShaderNodeTexCoord")
    vor = mb.node("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 60.0
    mb.link(tc.outputs["Object"], vor.inputs["Vector"])
    big = mb.noise(8.0, 3.0, tc.outputs["Object"])
    petals = _nramp(nt, big.outputs["Fac"], [(0.35, "#6a1420"), (0.65, "#b4442a")])
    dist = vor.outputs["Distance"]
    col = _nmix(nt, _nm(nt, "LESS_THAN", dist, 0.12), petals, hexc("#d8a030"))
    col = _nmix(nt, _nm(nt, "GREATER_THAN", dist, 0.62), col, hexc("#1c0a08"))
    mb.link(col, mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.7, Subsurface_Weight=0.15)
    mb.bump(_nm(nt, "SUBTRACT", 1.0, dist), 0.7, 0.006)
    return mb.m


def _mat_plaid():
    """Red–black buffalo-check wool blanket."""
    mb = MB("plaid")
    nt = mb.nt
    tc = mb.node("ShaderNodeTexCoord")
    sep = mb.node("ShaderNodeSeparateXYZ")
    mb.link(tc.outputs["Object"], sep.inputs[0])
    a = _nm(nt, "LESS_THAN", _nm(nt, "FRACT", _nm(nt, "DIVIDE", sep.outputs["X"], 0.08)), 0.5)
    b = _nm(nt, "LESS_THAN", _nm(nt, "FRACT", _nm(nt, "DIVIDE", _nm(nt, "ADD", sep.outputs["Y"], sep.outputs["Z"]), 0.08)), 0.5)
    k = _nm(nt, "ADD", a, b)                                     # 0 black, 1 dark red, 2 red
    col = _nramp(nt, _nm(nt, "MULTIPLY", k, 0.5), [(0.0, "#141012"), (0.5, "#4a1012"), (1.0, "#8e1c1a")])
    mb.link(col, mb.bsdf.inputs["Base Color"])
    mb.set(Roughness=0.95, Sheen_Weight=0.6)
    fz = mb.noise(300.0, 2.0, tc.outputs["Object"])
    mb.bump(fz.outputs["Fac"], 0.3, 0.002)
    return mb.m


def _lathe_obj(name, prof, mat, loc, seg=32, smooth=True, check=True):
    bm = _bmesh.new()
    rings = []
    for z, r in prof:
        rings.append([bm.verts.new((r * _m.cos(2 * _m.pi * i / seg), r * _m.sin(2 * _m.pi * i / seg), z)) for i in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    _bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    return _bm_obj(name, bm, mat, smooth=smooth, check=check)


def _clear_leaves(rects):
    """Remove dry leaves (connected face islands) whose centre lies inside the rectangles (x0, x1, y0, y1)."""
    for on in ("porch_leaves", "porch_leaves_wide"):
        ob = _bpy.data.objects.get(on)
        if not ob:
            continue
        bm = _bmesh.new()
        bm.from_mesh(ob.data)
        bm.verts.ensure_lookup_table()
        seen, kill = set(), []
        for v0 in bm.verts:
            if v0.index in seen:
                continue
            isl, stack = [], [v0]
            seen.add(v0.index)
            while stack:
                v = stack.pop()
                isl.append(v)
                for e in v.link_edges:
                    w = e.other_vert(v)
                    if w.index not in seen:
                        seen.add(w.index)
                        stack.append(w)
            cx = sum(v.co.x for v in isl) / len(isl) + ob.location.x
            cy = sum(v.co.y for v in isl) / len(isl) + ob.location.y
            if any(x0 < cx < x1 and y0 < cy < y1 for x0, x1, y0, y1 in rects):
                kill += isl
        if kill:
            _bmesh.ops.delete(bm, geom=kill, context="VERTS")
            bm.to_mesh(ob.data)
        bm.free()


def _door():
    O_ = _bpy.data.objects
    for ob in [o for o in list(C_ENV.objects) if o.name in ("door", "knob") or o.name.startswith("panel")]:
        _bpy.data.objects.remove(ob, do_unlink=True)
    paint = _mat_door_paint()
    brass = _mat_brass()
    trim_m = _bpy.data.materials.get("porch_paint") or M_TRIM
    x0, x1, zt = DX0, DX1, DZ
    cx = (x0 + x1) / 2
    yF, yB = WALL_Y - 0.048, WALL_Y - 0.006                      # front / back face of the door leaf
    ST, TR, LR0, LR1, BR, MS = 0.12, 0.13, 0.92, 1.12, 0.24, 0.045
    # door frame: stiles, top / lock / bottom rails, centre mullion in the lower half
    bm = _bmesh.new()
    _bm_box(bm, x0, x0 + ST, yF, yB, 0.004, zt)
    _bm_box(bm, x1 - ST, x1, yF, yB, 0.004, zt)
    _bm_box(bm, x0 + ST, x1 - ST, yF, yB, zt - TR, zt)
    _bm_box(bm, x0 + ST, x1 - ST, yF, yB, LR0, LR1)
    _bm_box(bm, x0 + ST, x1 - ST, yF, yB, 0.004, BR)
    _bm_box(bm, cx - MS, cx + MS, yF, yB, BR, LR0)
    _bm_box(bm, x0 + ST, x1 - ST, yF + 0.018, yF + 0.024, BR, LR0)          # backing board behind the two lower panels
    slab = _bm_obj("door_frame", bm, paint, check=False)
    bv = slab.modifiers.new("bevel", "BEVEL")
    bv.width, bv.segments, bv.limit_method = 0.003, 2, "ANGLE"
    # bevelled raised field panels in the two lower openings
    for i, (a, b) in enumerate(((x0 + ST, cx - MS), (cx + MS, x1 - ST))):
        bm = _bmesh.new()
        _bm_box(bm, a + 0.004, b - 0.004, yF + 0.006, yF + 0.018, BR + 0.004, LR0 - 0.004)
        pn = _bm_obj(f"door_panel{i}", bm, paint, check=False)
        bv = pn.modifiers.new("bevel", "BEVEL")
        bv.width, bv.segments, bv.profile = 0.028, 2, 0.15
    # moulding around every opening (slightly proud of the frame, rounded)
    bm = _bmesh.new()
    w_, d_ = 0.016, 0.01
    for (a, b, c, d) in ((x0 + ST, cx - MS, BR, LR0), (cx + MS, x1 - ST, BR, LR0), (x0 + ST, x1 - ST, LR1, zt - TR)):
        _bm_box(bm, a, b, yF - d_, yF + 0.006, c, c + w_)
        _bm_box(bm, a, b, yF - d_, yF + 0.006, d - w_, d)
        _bm_box(bm, a, a + w_, yF - d_, yF + 0.006, c, d)
        _bm_box(bm, b - w_, b, yF - d_, yF + 0.006, c, d)
    mo = _bm_obj("door_moulding", bm, paint, check=False)
    bv = mo.modifiers.new("bevel", "BEVEL")
    bv.width, bv.segments = 0.005, 3
    # glass + 2×3 muntins
    gx0, gx1, gz0, gz1 = x0 + ST + w_, x1 - ST - w_, LR1 + w_, zt - TR - w_
    bm = _bmesh.new()
    _bm_box(bm, gx0, gx1, yF + 0.012, yF + 0.016, gz0, gz1)
    if _bpy.data.materials.get("window_clear") and _bpy.data.materials.get("sheer_voile"):
        # real glass: cut the wall behind the pane, voile curtain + hall light inside (the porch window's room extends to here)
        _bm_obj("door_glass", bm, _bpy.data.materials["window_clear"], check=False)
        _cut_wall("door_glass", gx0, gx1, gz0, gz1)
        _voile("door_voile", gx0 - 0.03, gx1 + 0.03, gz0 - 0.03, gz1 + 0.03, y=WALL_Y + 0.02)
        hall = light("door_hall", "POINT", 18.0, "#ffb468", (cx, WALL_Y + 1.0, 2.3), shadow_soft_size=0.08)
        hall.visible_camera = False
    else:
        _bm_obj("door_glass", bm, _mat_door_glass(), check=False)
    bm = _bmesh.new()
    gm = (gx0 + gx1) / 2
    _bm_box(bm, gm - 0.011, gm + 0.011, yF + 0.002, yF + 0.012, gz0, gz1)
    for k in (1, 2):
        z = gz0 + (gz1 - gz0) * k / 3
        _bm_box(bm, gx0, gx1, yF + 0.002, yF + 0.012, z - 0.011, z + 0.011)
    mu = _bm_obj("door_muntins", bm, paint, check=False)
    bv = mu.modifiers.new("bevel", "BEVEL")
    bv.width, bv.segments = 0.003, 2
    # brass hardware: mail slot, handle + lock on a backplate, hinges
    bm = _bmesh.new()
    _bm_box(bm, cx - 0.14, cx + 0.14, yF - 0.006, yF, 0.985, 1.055)
    _bm_obj("door_mailslot", bm, brass, check=False).modifiers.new("bevel", "BEVEL").width = 0.004
    bm = _bmesh.new()
    _bm_box(bm, cx - 0.11, cx + 0.11, yF - 0.008, yF - 0.004, 1.005, 1.035)
    _bm_obj("door_mailslot_flap", bm, brass, check=False).modifiers.new("bevel", "BEVEL").width = 0.003
    hx = x0 + 0.065                                              # lock stile (hinges on the right)
    bm = _bmesh.new()
    _bm_box(bm, hx - 0.028, hx + 0.028, yF - 0.007, yF, 0.84, 1.2)
    bp = _bm_obj("door_backplate", bm, brass, check=False)
    bv = bp.modifiers.new("bevel", "BEVEL")
    bv.width, bv.segments = 0.012, 4
    for nm_, z, prof in (("door_knob", 0.95, [(0.0, 0.024), (0.008, 0.024), (0.012, 0.009), (0.04, 0.008), (0.05, 0.024),
                                              (0.062, 0.031), (0.074, 0.027), (0.08, 0.012), (0.082, 0.0)]),
                         ("door_deadbolt", 1.12, [(0.0, 0.02), (0.01, 0.018), (0.014, 0.012), (0.022, 0.012), (0.024, 0.0)])):
        k = _lathe_obj(nm_, prof, brass, (0, 0, 0), seg=40, check=False)
        k.rotation_euler = (_m.pi / 2, 0, 0)                    # z axis → −y (facing the porch)
        k.location = (hx, yF - 0.006, z)
    bm = _bmesh.new()
    _bm_box(bm, hx - 0.006, hx + 0.006, yF - 0.026, yF - 0.02, 1.105, 1.135)       # deadbolt thumb turn
    _bm_obj("door_thumbturn", bm, brass, check=False)
    # wreath: dry twig ring + autumn leaves (atlas) + berries, hung on a plaid ribbon from the top of the door
    wz, wr = 1.55, 0.155
    wy = yF - 0.02
    tor = _bpy.data.meshes.new("wreath_base")
    bm = _bmesh.new()
    seg, ring = 48, 10
    rows = []
    for i in range(seg):
        a = 2 * _m.pi * i / seg
        c = _V((wr * _m.cos(a), 0, wr * _m.sin(a)))
        n_ = c.normalized()
        rows.append([bm.verts.new(c + (n_ * _m.cos(2 * _m.pi * j / ring) + _V((0, 1, 0)) * _m.sin(2 * _m.pi * j / ring)) * 0.026)
                     for j in range(ring)])
    for i in range(seg):
        for j in range(ring):
            bm.faces.new((rows[i][j], rows[(i + 1) % seg][j], rows[(i + 1) % seg][(j + 1) % ring], rows[i][(j + 1) % ring]))
    _bmesh.ops.translate(bm, vec=(cx, wy, wz), verts=bm.verts)
    _bm_obj("wreath_base", bm, _bpy.data.materials.get("bark") or _mat_bark(), smooth=True, check=False)
    if "_add_leaf" in globals() and _bpy.data.materials.get("leaf"):
        bm = _bmesh.new()
        n_leaf = 0
        while n_leaf < 64:
            a = 2 * _m.pi * (n_leaf + _wrng.random() * 0.8) / 64
            rr = wr + _wrng.uniform(-0.03, 0.035)
            loc = _V((rr * _m.cos(a), rr * _m.sin(a), _wrng.uniform(0.0, 0.03)))
            yaw = a + _m.pi / 2 + _wrng.uniform(-0.6, 0.6)
            _add_leaf(bm, _pick_tint(0.1) if "_pick_tint" in globals() else (1, 1, 1), loc, _wrng.uniform(0.07, 0.1), yaw,
                      _wrng.randrange(8), (_wrng.uniform(-0.25, 0.25), _wrng.uniform(-0.25, 0.25)))
            n_leaf += 1
        _bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=_Mx.Rotation(_m.pi / 2, 3, "X"))   # leaf face → −y
        _bmesh.ops.translate(bm, vec=(cx, wy - 0.01, wz), verts=bm.verts)
        _bm_obj("wreath_leaves", bm, _bpy.data.materials["leaf"], smooth=True, check=False)
    berry = mat_simple("berry", "#a8241a", 0.25, Coat_Weight=0.6)
    bm = _bmesh.new()
    for k in range(16):
        a = 2 * _m.pi * k / 16 + _wrng.uniform(-0.15, 0.15)
        rr = wr + _wrng.uniform(-0.02, 0.02)
        for j in range(3):
            g = _bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.0085)
            _bmesh.ops.translate(bm, verts=g["verts"], vec=(cx + rr * _m.cos(a) + _wrng.uniform(-0.012, 0.012),
                                                            wy - 0.04 + _wrng.uniform(-0.006, 0.006),
                                                            wz + rr * _m.sin(a) + _wrng.uniform(-0.012, 0.012)))
    _bm_obj("wreath_berries", bm, berry, smooth=True, check=False)
    plaid = _mat_plaid()
    bm = _bmesh.new()
    _bm_box(bm, cx - 0.018, cx + 0.018, yF - 0.004, yF - 0.001, wz + wr - 0.01, zt + 0.004)
    _bm_box(bm, cx - 0.018, cx + 0.018, yF - 0.004, yB, zt - 0.002, zt + 0.006)                # draped over the top of the door
    _bm_obj("wreath_ribbon", bm, plaid, check=False)
    # door casing: plinth blocks, head moulding (cornice + bed moulding)
    for nm_, a, b in (("plinth_l", x0 - 0.115, x0 + 0.005), ("plinth_r", x1 - 0.005, x1 + 0.115)):
        _bx(nm_, a, b, WALL_Y - 0.07, WALL_Y, 0.0, 0.2, trim_m, check=False)
    _bx("door_head_cap", x0 - 0.15, x1 + 0.15, WALL_Y - 0.085, WALL_Y, DZ + 0.17, DZ + 0.205, trim_m, check=False)
    _bx("door_head_bed", x0 - 0.12, x1 + 0.12, WALL_Y - 0.065, WALL_Y, DZ + 0.15, DZ + 0.172, trim_m, check=False)
    # brass house number on the wall right of the door
    cu = _bpy.data.curves.new("house_number", "FONT")
    cu.body = "13"
    cu.size = 0.13
    cu.extrude = 0.004
    cu.bevel_depth = 0.0012
    cu.align_x = "CENTER"
    cu.materials.append(brass)
    num = obj("house_number", cu, C_ENV)
    num.rotation_euler = (_m.pi / 2, 0, 0)
    num.location = (x1 + 0.34, WALL_Y - 0.006, 1.48)
    bm = _bmesh.new()
    _bm_box(bm, x1 + 0.24, x1 + 0.44, WALL_Y - 0.004, WALL_Y, 1.44, 1.62)
    _bm_obj("house_number_plate", bm, mat_simple("number_plate", "#1a1c1e", 0.5), check=False)

    # ── wall-base decorations ──
    straw = _mat_straw()
    bx0, bx1, by0, by1, bh = 1.48, 1.94, 1.15, 1.49, 0.32
    bm = _bmesh.new()
    _bm_box(bm, bx0, bx1, by0, by1, 0.0, bh)
    hb = _bm_obj("hay_bale", bm, straw)
    bv = hb.modifiers.new("bevel", "BEVEL")
    bv.width, bv.segments = 0.035, 3
    bm = _bmesh.new()
    for xx in (bx0 + 0.12, bx1 - 0.12):
        _bm_box(bm, xx - 0.005, xx + 0.005, by0 - 0.003, by1 + 0.003, -0.001, bh + 0.003)
    _bm_obj("hay_twine", bm, mat_simple("twine", "#5a4428", 0.9))
    if "_gourd" in globals():
        white = _bpy.data.materials.get("gourd_white")
        orange = _bpy.data.materials.get("gourd_orange")
        pear = _bpy.data.materials.get("gourd_pear")
        for nm_, x, y, z, r, hz, lob, dep, m_, yaw, kw in (
                ("deco_pumpkin_big", 1.64, 1.33, bh, 0.135, 0.72, 10, 0.08, orange, 0.7, {}),
                ("deco_pumpkin_white", 1.85, 1.29, bh, 0.085, 0.66, 10, 0.07, white, 2.0, {}),
                ("deco_gourd_floor", 1.43, 1.06, 0.0, 0.06, 0.62, 12, 0.08, orange, 0.3, {"tilt": 0.08}),
                ("deco_gourd_pear", 1.56, 1.04, 0.0, 0.04, 0.95, 8, 0.02, pear, 1.1, {"pear": 0.8, "tilt": 0.15}),
                ("bench_pumpkin", 2.93, 1.33, 0.452, 0.075, 0.66, 10, 0.07, white, 0.9, {})):
            if m_ is None:
                continue
            g = _gourd(nm_, x, y, r, hz, lob, dep, m_, yaw=yaw, stem_len=0.02 + r * 0.12, stem_r=0.004 + r * 0.03, **kw)
            g.location.z += z
            _wreg(g)
    # potted mums: rimmed terracotta pot, domed flower mound
    terra = MB("terracotta")
    tcn = terra.node("ShaderNodeTexCoord")
    tnz = terra.noise(18.0, 5.0, tcn.outputs["Object"])
    terra.link(terra.ramp(tnz.outputs["Fac"], [(0.3, "#6e3420"), (0.7, "#9c5434")]), terra.bsdf.inputs["Base Color"])
    terra.set(Roughness=0.85)
    terra.bump(tnz.outputs["Fac"], 0.2)
    px_, py_ = 2.0, 0.97
    _wreg(_lathe_obj("mum_pot", [(0.0, 0.085), (0.17, 0.112), (0.172, 0.126), (0.215, 0.13), (0.217, 0.118), (0.2, 0.112)],
                     terra.m, (px_, py_, 0.0), seg=40))
    bm = _bmesh.new()
    g = _bmesh.ops.create_icosphere(bm, subdivisions=4, radius=0.16)
    for v in g["verts"]:
        d = v.co.normalized()
        bump_ = 1.0 + 0.06 * noise.noise(d * 6.0) + 0.03 * noise.noise(d * 17.0)
        v.co = _V((v.co.x * bump_, v.co.y * bump_, max(v.co.z * 0.78 * bump_, -0.02)))
    _bmesh.ops.translate(bm, verts=bm.verts, vec=(px_, py_, 0.255))
    _bm_obj("mum_flowers", bm, _mat_mum(), smooth=True)
    # wooden bench under the window + folded plaid blanket
    bench_m = mat_wood("bench_wood", "#9a7a5c", tile=0.6)
    sx0, sx1, sy0, sy1, sz = 2.12, 3.08, 1.12, 1.49, 0.45
    bm = _bmesh.new()
    n_sl = 4
    sw_ = (sy1 - sy0 - 0.012 * (n_sl - 1)) / n_sl
    for k in range(n_sl):
        y0 = sy0 + k * (sw_ + 0.012)
        _bm_box(bm, sx0, sx1, y0, y0 + sw_, sz - 0.032, sz)
    for xx in (sx0 + 0.06, sx1 - 0.06):
        for yy in (sy0 + 0.04, sy1 - 0.04):
            _bm_box(bm, xx - 0.025, xx + 0.025, yy - 0.025, yy + 0.025, 0.0, sz - 0.032)
        _bm_box(bm, xx - 0.02, xx + 0.02, sy0 + 0.04, sy1 - 0.04, 0.09, 0.14)       # stretcher
    _bm_box(bm, sx0 + 0.06, sx1 - 0.06, sy0 + 0.02, sy0 + 0.05, sz - 0.1, sz - 0.032)  # front apron
    bn = _bm_obj("bench", bm, bench_m)
    bv = bn.modifiers.new("bevel", "BEVEL")
    bv.width, bv.segments = 0.004, 2
    bm = _bmesh.new()
    _bm_box(bm, 2.2, 2.68, 1.17, 1.46, sz, sz + 0.07)
    bl = _bm_obj("blanket", bm, plaid)
    bv = bl.modifiers.new("bevel", "BEVEL")
    bv.width, bv.segments = 0.03, 4
    bm = _bmesh.new()                                            # blanket edge hanging down in front of the bench
    _bm_box(bm, 2.26, 2.62, sy0 - 0.012, sy0 - 0.002, sz - 0.2, sz + 0.02)
    _bm_obj("blanket_drape", bm, plaid).modifiers.new("bevel", "BEVEL").width = 0.004
    # clear leaves under the new items
    _clear_leaves([(bx0 - 0.03, bx1 + 0.03, by0 - 0.03, by1 + 0.03), (px_ - 0.15, px_ + 0.15, py_ - 0.15, py_ + 0.15),
                   (1.36, 1.5, 0.98, 1.14), (1.5, 1.62, 0.97, 1.11),
                   (sx0 + 0.03, sx0 + 0.09, sy0 + 0.01, sy1 - 0.01), (sx1 - 0.09, sx1 - 0.03, sy0 + 0.01, sy1 - 0.01)])
    print("WIDE door")


# ───────────────────────── 9. rain: wet surfaces outside the roof + strips along the open edges of the porch floor ─────────────────────────
# Open edges (rain blows in): front y = FRONT_EDGE (the overhang shields part of it), left x = PX0, right x = PX1, back y = WALL_Y only for
# x < WALL_X0 (railing looking out to the yard; right of WALL_X0 is the house wall). Wetness = 1 outside the edge, fading smoothly inwards by
# each edge's width; downward-facing surfaces (ceiling, beam bottoms) always dry. Wet = darker + glossy water coat (IOR 1.33) reflecting sky/moon.
WET_REACH = {"front": 0.16, "left": 0.55, "right": 0.55, "back": 0.80}


def _wet_mask(nt, full=False):
    """0..1 wetness socket by world position (full=True: uniformly wet, e.g. roof, yard)."""
    if full:
        v = nt.nodes.new("ShaderNodeValue")
        v.outputs[0].default_value = 1.0
        return v.outputs[0]
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    x, y = sep.outputs["X"], sep.outputs["Y"]
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 2.2
    nz.inputs["Detail"].default_value = 4.0
    nt.links.new(geo.outputs["Position"], nz.inputs["Vector"])
    jit = _nm(nt, "MULTIPLY_ADD", nz.outputs["Fac"], 0.5, -0.25)          # wet-area edge wanders ±12 cm

    def edge(d, reach):                                # d: distance inward from the edge (m) → 1 − smoothstep(0, reach, d)
        t = _nm(nt, "DIVIDE", _nm(nt, "ADD", d, _nm(nt, "MULTIPLY", jit, reach / 0.6)), reach, clamp=True)
        return _nm(nt, "SUBTRACT", 1.0, _nm(nt, "MULTIPLY", _nm(nt, "MULTIPLY", t, t), _nm(nt, "MULTIPLY_ADD", t, -2.0, 3.0)))

    wf = edge(_nm(nt, "SUBTRACT", y, FRONT_EDGE), WET_REACH["front"])
    wl = edge(_nm(nt, "SUBTRACT", x, PX0), WET_REACH["left"])
    wr = edge(_nm(nt, "SUBTRACT", PX1, x), WET_REACH["right"])
    # back: the house wall shields progressively from the WALL_X0 corner rightwards (adds 3 m of "distance" per metre)
    db = _nm(nt, "ADD", _nm(nt, "SUBTRACT", WALL_Y, y), _nm(nt, "MULTIPLY", _nm(nt, "MAXIMUM", _nm(nt, "SUBTRACT", x, WALL_X0), 0.0), 3.0))
    wb = edge(db, WET_REACH["back"])
    w = _nm(nt, "MAXIMUM", _nm(nt, "MAXIMUM", wf, wl), _nm(nt, "MAXIMUM", wr, wb))
    # downward-facing surfaces stay dry
    sn = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], sn.inputs[0])
    up = _nm(nt, "MULTIPLY_ADD", sn.outputs["Z"], 2.0, 1.4, clamp=True)
    return _nm(nt, "MULTIPLY", w, up)


def _wetify(mname, full=False, dark=0.55, coat=1.0, rough_wet=0.3, puddle=True, coat_rough=0.16):
    m = _bpy.data.materials.get(mname)
    if not m or not m.use_nodes:
        return
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return
    w = _wet_mask(nt, full)
    # colour: darkens with wetness
    bc = bsdf.inputs["Base Color"]
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type, mul.blend_type = "RGBA", "MULTIPLY"
    a = [s_ for s_ in mul.inputs if s_.name == "A" and s_.type == "RGBA"][0]
    b = [s_ for s_ in mul.inputs if s_.name == "B" and s_.type == "RGBA"][0]
    if bc.is_linked:
        nt.links.new(bc.links[0].from_socket, a)
    else:
        a.default_value = bc.default_value[:]
    b.default_value = (dark, dark, dark, 1.0)
    nt.links.new(w, mul.inputs["Factor"])
    nt.links.new([o for o in mul.outputs if o.type == "RGBA"][0], bc)
    # roughness: decreases with wetness
    rs = bsdf.inputs["Roughness"]
    rmix = nt.nodes.new("ShaderNodeMix")
    rmix.data_type = "FLOAT"
    fa = [s_ for s_ in rmix.inputs if s_.name == "A" and s_.type == "VALUE"][0]
    fb = [s_ for s_ in rmix.inputs if s_.name == "B" and s_.type == "VALUE"][0]
    if rs.is_linked:
        nt.links.new(rs.links[0].from_socket, fa)
    else:
        fa.default_value = rs.default_value
    fb.default_value = rough_wet
    nt.links.new(w, rmix.inputs["Factor"])
    nt.links.new([o for o in rmix.outputs if o.type == "VALUE"][0], rs)
    # water film: glossy coat; puddles (noise) almost mirror-like
    nt.links.new(_nm(nt, "MULTIPLY", w, coat), bsdf.inputs["Coat Weight"])
    bsdf.inputs["Coat IOR"].default_value = 1.33
    if puddle:
        tc = nt.nodes.new("ShaderNodeNewGeometry")
        pn = nt.nodes.new("ShaderNodeTexNoise")
        pn.inputs["Scale"].default_value = 3.5
        pn.inputs["Detail"].default_value = 3.0
        nt.links.new(tc.outputs["Position"], pn.inputs["Vector"])
        cr = _nm(nt, "MULTIPLY_ADD", _nm(nt, "SUBTRACT", 0.62, pn.outputs["Fac"], clamp=True), 0.9, 0.025)
        nt.links.new(_nm(nt, "MINIMUM", cr, coat_rough), bsdf.inputs["Coat Roughness"])
    else:
        bsdf.inputs["Coat Roughness"].default_value = min(0.08, coat_rough)


def _rain():
    for mn in ("porch_floor", "porch_step"):
        _wetify(mn, dark=0.55, coat=1.0, rough_wet=0.35)
    for mn in ("trim", "porch_paint", "fence_paint", "path_stone", "stone_pad", "porch_lattice"):
        _wetify(mn, dark=0.75, coat=0.85, rough_wet=0.3, puddle=False)
    for mn in ("leaf", "vine_leaf"):
        _wetify(mn, dark=0.7, coat=0.5, rough_wet=0.4, puddle=False)
    # yard: wet = darker + a little gloss, but keep base specular low (at grazing angles far away, the bright sky reflection turns it into a "lake")
    _wetify("yard_ground", full=True, dark=0.75, coat=0.1, rough_wet=0.9, coat_rough=0.3)
    _yg = _bpy.data.materials.get("yard_ground")
    if _yg:
        next(n for n in _yg.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Specular IOR Level"].default_value = 0.035
    _wetify("roof_shingle", full=True, dark=0.8, coat=0.6, rough_wet=0.5, puddle=False)
    _wetify("bark", full=True, dark=0.6, coat=0.4, rough_wet=0.5, puddle=False)
    # meta for layout.json (render_passes.py): porch roof rain cover, porch floor edges
    sc["pc_roof"] = [EAVE_X0, EAVE_X1, EAVE_Y, WALL_Y, EAVE_Z]
    sc["pc_floor_edge"] = [FRONT_EDGE, PX0, PX1, WALL_Y, WALL_X0]
    print("WIDE rain")


# ───────────────────────── 10. rebalance lighting: sky as ambient light source, crisper moon shadows ─────────────────────────
SKY_AMB = 0.16       # diffuse rays see (SKY_AMB × panoramic sky) + (1 − SKY_AMB) × the old #141a33 background
SKY_GLOSS = 0.8      # glossy rays see a near-real sky (wet surfaces mirror the sky, moon)


def _relight():
    wt = sc.world.node_tree
    bg1 = wt.nodes.get("sky_bg")
    if bg1 is not None:
        bg0 = next(n for n in wt.nodes if n.type == "BACKGROUND" and n.name != "sky_bg")
        out = next(n for n in wt.nodes if n.type == "OUTPUT_WORLD")
        mix_cam = out.inputs["Surface"].links[0].from_node          # mix(Is Camera Ray, bg0, bg1) from _sky()
        lp = next(n for n in wt.nodes if n.type == "LIGHT_PATH")
        fac = _nm(wt, "MULTIPLY_ADD", lp.outputs["Is Glossy Ray"], SKY_GLOSS - SKY_AMB, SKY_AMB)
        mx = wt.nodes.new("ShaderNodeMixShader")
        wt.links.new(fac, mx.inputs[0])
        wt.links.new(bg0.outputs[0], mx.inputs[1])
        wt.links.new(bg1.outputs[0], mx.inputs[2])
        wt.links.new(mx.outputs[0], mix_cam.inputs[1])
    O_ = _bpy.data.objects
    if "moon" in O_:
        O_["moon"].data.energy = 1.0                 # 0.7 → 1.0: crisper moon shadows
    if "moon_fill" in O_:
        O_["moon_fill"].data.energy = 2.2            # 4 → 2.2: less flat, the (directional) sky makes up the difference
        O_["moon_fill"].visible_glossy = False       # fake fill light: don't reveal its rectangle in wet surfaces
    if "porch_key" in O_:
        O_["porch_key"].visible_glossy = False       # (same reason: bright rectangle in the puddle on the front step)
    print("WIDE relight")


# ───────────────────────── check: nothing leaks into the base frame ─────────────────────────
def _check_base_frame():
    """Count new-object verts that fall inside the base frame. Ceiling, roof, trees, distant houses… must be 0."""
    _bpy.context.view_layer.update()
    camo = sc.camera
    dg = _bpy.context.evaluated_depsgraph_get()
    bad = 0
    for o in _WNEW:
        ev = o.evaluated_get(dg)
        try:
            me = ev.to_mesh()
        except RuntimeError:
            continue
        n = 0
        for v in me.vertices:
            p = ev.matrix_world @ v.co
            q = _w2c(sc, camo, p)
            if 0 <= q.x <= 1 and 0 <= q.y <= 1 and q.z > 0:
                n += 1
        ev.to_mesh_clear()
        if n:
            bad += 1
            print(f"WIDE_WARN {o.name}: {n} verts inside the base frame")
    print("WIDE check base frame:", "ok" if not bad else f"{bad} objects leak into the frame")


if "porch" in _WPARTS:
    _porch()
if "house" in _WPARTS:
    _house()
if "left" in _WPARTS:
    _left()
if "yard" in _WPARTS:
    _yard()
if "fence" in _WPARTS:
    _fence()
if "trees" in _WPARTS:
    _trees()
if "town" in _WPARTS:
    _town()
if "sky" in _WPARTS:
    _sky()
if "door" in _WPARTS:
    _door()
if "rain" in _WPARTS:
    _rain()
if "relight" in _WPARTS:
    _relight()
# area lights not directly visible to the camera when looking around
for _n in ("porch_key", "moon_fill"):
    if _n in _bpy.data.objects:
        _bpy.data.objects[_n].visible_camera = False
_check_base_frame()
