"""Building stock (Keith 2026-10-19, docs/todo-building-materials-and-canopies.md): the standard sections every
building part is made from, so nothing is an ad-hoc block. Steel turns up only as corrugated sheet, flat panel, bolted
plate, I / U / L beam, pipe and tube; wood only as boards, battens, posts and beams of standard sections; concrete as
slabs and blocks (broken: rebar bars or a grid); brick at one brick size.

Units: real metres, the kit's own scale (1 unit = 1 m in game; a wall bay is 2 m wide, a person 1.8 m). Nothing here
scales a section up to look chunky: the top-down camera (50 degrees, 40 m, about 21 px per metre, 80+ when zoomed in)
loses very thin things, so a section's *rendered* thickness is lifted to a documented floor:

    MIN_STEEL = 0.020   no steel web, flange, plate or sheet renders thinner than 2 cm (a real web is 5 to 10 mm)
    MIN_ROD   = 0.012   no bar, rebar or tube wall renders thinner than a 12 mm radius... see rod_r()
    wood and concrete need no floor: the thinnest standard board (25 mm) already clears MIN_STEEL.

Real values stay in the tables (comments); the builders read them through vis_steel() / rod_r(). Raise or drop the
floors here and every part follows.

Builders append geometry to a `parts.Part` the way parts.box / parts.strut do (call `prim(p, tone, ...)` after each to
paint it); they never paint. Profiles are swept along straight or curved paths with `sweep()`, so an I-beam is a cheap
extrusion: 12 profile points = 24 side triangles plus two caps.
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector

# ---- Floors on rendered thickness (see the module doc) ----
MIN_STEEL = 0.020
MIN_ROD = 0.012


def vis_steel(t):
    return max(t, MIN_STEEL)


def rod_r(r):
    return max(r, MIN_ROD)


# ---- Wood (nominal-dressed sizes in metres: thickness x width) ----
BOARD_T = 0.025                       # a roof, wall or floor board: 25 mm
BOARD_W = (0.10, 0.15, 0.19, 0.25)    # 4, 6, 8 and 10 inch boards
BATTEN = (0.025, 0.07)                # strip over a joint or a rafter
POST = {"S": 0.09, "M": 0.12, "L": 0.15}             # square posts: 4x4, 5x5, 6x6
RAFTER = (0.045, 0.10)                # 2x4 on edge
BEAM = {"S": (0.05, 0.15), "M": (0.07, 0.20), "L": (0.09, 0.24)}   # (width, height) of a beam on edge
LEDGER = (0.045, 0.14)                # the 2x6 bolted to a wall that a canopy hangs from
ROOF_BOARD_T = BOARD_T                # board roofs: one layer of 25 mm board on rafters

# ---- Steel sections: (depth, flange width, web, flange thickness), real, in metres ----
IBEAM = {
    "S": (0.100, 0.055, 0.0045, 0.0075),
    "M": (0.200, 0.100, 0.0056, 0.0085),
    "L": (0.300, 0.150, 0.0071, 0.0107),
    "XL": (0.400, 0.180, 0.0086, 0.0135),
    "RIB": (0.240, 0.120, 0.0062, 0.0098),   # the ship ribs: thin, always this I-beam (Keith 2026-10-19)
}
UBEAM = {      # channel: (depth, flange width, web, flange thickness)
    "S": (0.080, 0.045, 0.006, 0.0085),
    "M": (0.140, 0.060, 0.007, 0.0105),
    "L": (0.200, 0.075, 0.009, 0.0115),
}
LBEAM = {      # angle: (leg, thickness)
    "S": (0.040, 0.005),
    "M": (0.065, 0.007),
    "L": (0.100, 0.010),
}
PIPE_R = {"tube": 0.016, "S": 0.021, "M": 0.030, "L": 0.045, "XL": 0.070}   # outer radius; mostly small
SQ_TUBE = {"S": 0.040, "M": 0.050, "L": 0.075}                              # square tube side
PLATE_T = 0.010                       # a joining plate between beams
PANEL_T = 0.012                       # a flat steel panel (hull plate is 25 mm: HULL_PLATE_T)
HULL_PLATE_T = 0.025
CORR_T = 0.0008                       # corrugated sheet: the iron itself
CORR_PITCH = 0.076                    # real ridge pitch (3 in)
CORR_DEPTH = 0.018
CORR_SHEET_W = 0.76                   # a sheet as sold: 0.76 m wide (0.66 m after the side lap)
CORR_LAP = 0.10
# Low-poly stand-in for the ridges: one wave per ~0.17 m, 3.5 cm deep (a real wave would be 3 px at the game camera)
CORR_PITCH_GAME = 0.17
CORR_DEPTH_GAME = 0.035
BOLT_R = 0.016                        # a bolt head (M20 hex, across flats 30 mm)
BOLT_H = 0.012

# ---- Concrete and brick ----
SLAB_T = {"floor": 0.10, "pad": 0.15, "roof": 0.18, "deck": 0.25}
BLOCK = (0.39, 0.19, 0.19)            # a hollow concrete block: 390 long x 190 thick x 190 high
BRICK = (0.23, 0.11, 0.075)           # length, depth, height
BRICK_JOINT = 0.010
BRICK_PITCH = (BRICK[0] + BRICK_JOINT, BRICK[2] + BRICK_JOINT)   # one brick plus its mortar: 0.24 x 0.085
REBAR_R = 0.008                       # 16 mm bar
REBAR_SPACING = 0.20


# ---- Sweeping a profile ----

def _frame(w, up):
    """Right and up vectors for a section running along w (the profile's u is Right, v is Up)."""
    w = Vector(w).normalized()
    up = Vector(up)
    r = up.cross(w)
    if r.length < 1e-4:
        r = Vector((0, 1, 0)).cross(w)
        if r.length < 1e-4:
            r = Vector((1, 0, 0)).cross(w)
    r.normalize()
    v = w.cross(r)
    return r, v


def sweep(p, profile, centres, frames, closed=False, caps=True):
    """A solid from a 2D profile (u, v points, closed polygon) swept through `centres` (Vectors) with a (right, up)
    frame at each. Smooth rings stay closed (closed=True: the last ring joins the first, no caps)."""
    p.seal()
    bm = p.bm
    n = len(profile)
    rings = []
    for c, (r, v) in zip(centres, frames):
        rings.append([bm.verts.new(Vector(c) + r * u + v * w) for u, w in profile])
    count = len(rings) if closed else len(rings) - 1
    for i in range(count):
        a, b = rings[i], rings[(i + 1) % len(rings)]
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    if caps and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f[p.pid] == 0])


def _straight(p, profile, a, b, up=(0, 0, 1)):
    a, b = Vector(a), Vector(b)
    if (b - a).length < 1e-4:
        return
    r, v = _frame(b - a, up)
    sweep(p, profile, [a, b], [(r, v), (r, v)])


# ---- Profiles ----

def rect_profile(w, h):
    return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]


def i_profile(size="M"):
    d, bf, tw, tf = IBEAM[size] if isinstance(size, str) else size
    tw, tf = vis_steel(tw), vis_steel(tf)
    return [(-bf / 2, -d / 2), (bf / 2, -d / 2), (bf / 2, -d / 2 + tf), (tw / 2, -d / 2 + tf), (tw / 2, d / 2 - tf),
            (bf / 2, d / 2 - tf), (bf / 2, d / 2), (-bf / 2, d / 2), (-bf / 2, d / 2 - tf), (-tw / 2, d / 2 - tf),
            (-tw / 2, -d / 2 + tf), (-bf / 2, -d / 2 + tf)]


def u_profile(size="M"):
    d, bf, tw, tf = UBEAM[size] if isinstance(size, str) else size
    tw, tf = vis_steel(tw), vis_steel(tf)
    x0 = -bf / 2
    return [(x0, -d / 2), (x0 + bf, -d / 2), (x0 + bf, -d / 2 + tf), (x0 + tw, -d / 2 + tf), (x0 + tw, d / 2 - tf),
            (x0 + bf, d / 2 - tf), (x0 + bf, d / 2), (x0, d / 2)]


def l_profile(size="M"):
    leg, t = LBEAM[size] if isinstance(size, str) else size
    t = vis_steel(t)
    o = -leg / 2
    return [(o, o), (o + leg, o), (o + leg, o + t), (o + t, o + t), (o + t, o + leg), (o, o + leg)]


# ---- Straight sections between two points ----

def i_beam(p, a, b, size="M", up=(0, 0, 1)):
    """An I-beam from a to b; its web stands in the plane of the run and `up` (flanges across `up` x run)."""
    _straight(p, i_profile(size), a, b, up)


def u_beam(p, a, b, size="M", up=(0, 0, 1)):
    _straight(p, u_profile(size), a, b, up)


def l_beam(p, a, b, size="M", up=(0, 0, 1)):
    _straight(p, l_profile(size), a, b, up)


def lumber(p, a, b, width, height, up=(0, 0, 1)):
    """A timber section (width across, height along `up`) from a to b: beam, rafter, brace, batten."""
    _straight(p, rect_profile(width, height), a, b, up)


def post(p, base, top, size="S"):
    s = POST[size] if isinstance(size, str) else size
    lumber(p, base, top, s, s, up=(1, 0, 0) if abs(Vector(top).z - Vector(base).z) > abs(Vector(top).x - Vector(base).x) else (0, 0, 1))


def pipe(p, a, b, size="S", sides=6):
    """A steel pipe from a to b (outer radius from PIPE_R, floored at MIN_ROD)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    if d.length < 1e-4:
        return
    r = rod_r(PIPE_R[size] if isinstance(size, str) else size)
    p.seal()
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.create_cone(p.bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=r, depth=d.length,
                          matrix=Matrix.Translation(a + d / 2) @ rot)


def sq_tube(p, a, b, size="S", up=(0, 0, 1)):
    s = SQ_TUBE[size]
    lumber(p, a, b, s, s, up)


def plate(p, centre, w, h, t=PANEL_T, normal="y"):
    """A flat steel panel w x h and thickness max(t, MIN_STEEL), centred on `centre`; normal 'y' (a wall panel), 'z'
    (lying flat) or 'x'."""
    t = vis_steel(t)
    c = Vector(centre)
    dims = {"y": (w, t, h), "z": (w, h, t), "x": (t, w, h)}[normal]
    p.seal()
    res = bmesh.ops.create_cube(p.bm, size=1.0)
    for v in res["verts"]:
        v.co = Vector((v.co.x * dims[0], v.co.y * dims[1], v.co.z * dims[2])) + c


def bolt(p, pos, normal=(0, -1, 0), r=BOLT_R, h=BOLT_H, sides=6):
    """A hex bolt head standing out of a surface along `normal`."""
    n = Vector(normal).normalized()
    p.seal()
    rot = Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4()
    bmesh.ops.create_cone(p.bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=r, depth=h,
                          matrix=Matrix.Translation(Vector(pos) + n * h / 2) @ rot)


def bolt_grid(p, centre, w, h, normal="y", sign=-1, count=4, t=PLATE_T):
    """The bolt heads for a plate made by plate() (corners, or two for a narrow plate)."""
    c = Vector(centre)
    t = vis_steel(t)
    nv = {"x": Vector((sign, 0, 0)), "y": Vector((0, sign, 0)), "z": Vector((0, 0, sign))}[normal]
    ax = {"x": (Vector((0, 1, 0)), Vector((0, 0, 1))), "y": (Vector((1, 0, 0)), Vector((0, 0, 1))),
          "z": (Vector((1, 0, 0)), Vector((0, 1, 0)))}[normal]
    pts = [(-1, -1), (1, -1), (1, 1), (-1, 1)] if count >= 4 else [(-1, 0), (1, 0)]
    for su, sv in pts:
        pos = c + ax[0] * su * (w / 2 - 0.04) + ax[1] * sv * (h / 2 - 0.04) + nv * t / 2
        bolt(p, pos, nv)


# ---- Sweeps along curves (ribs) ----

def i_sweep(p, path, radials, size="RIB", x=0.0, closed=False):
    """An I-beam bent along `path` (Vectors in the YZ plane, or any 3D line) whose depth runs along `radials` (unit
    vectors, per point) and whose flanges lie across X: a ship rib. `x` shifts the whole thing along X."""
    prof = i_profile(size)
    centres = [Vector(c) + Vector((x, 0, 0)) for c in path]
    frames = []
    for rad in radials:
        frames.append((Vector((1, 0, 0)), Vector(rad).normalized()))
    sweep(p, prof, centres, frames, closed=closed)


def ring_i_sweep(p, centre, radius, size="RIB", sides=20, axis="x"):
    """A closed I-beam ring of the given centre-line radius round the X axis (a pod's rib ring); depth radial."""
    prof = i_profile(size)
    c = Vector(centre)
    centres, frames = [], []
    for k in range(sides):
        a = k * 2 * math.pi / sides
        rad = Vector((0, math.cos(a), math.sin(a)))
        centres.append(c + rad * radius)
        frames.append((Vector((1, 0, 0)), rad))
    sweep(p, prof, centres, frames, closed=True)


# ---- Sheet ----

def corr_sheet(p, w, h, at=(0.0, 0.0, 0.0), pitch=CORR_PITCH_GAME, depth=CORR_DEPTH_GAME, tilt_y=0.0):
    """A corrugated iron sheet facing -Y: w wide (X), h tall (Z), its crest line on y = at.y, ridges running vertically
    (one wave per `pitch`, game depth). A single skin: the thin iron itself (0.8 mm) is not modelled."""
    p.seal()
    bm = p.bm
    ridges = max(1, int(round(w / pitch)))
    n = ridges * 4
    cols = []
    for i in range(n + 1):
        x = at[0] - w / 2 + w * i / n
        y = at[1] - depth * (0.5 + 0.5 * math.sin(i / 4 * 2 * math.pi))
        cols.append((bm.verts.new((x, y, at[2])), bm.verts.new((x, y, at[2] + h))))
    for i in range(n):
        (a0, a1), (b0, b1) = cols[i], cols[i + 1]
        bm.faces.new((a0, b0, b1, a1))


# ---- Concrete: footings, slabs, rebar ----

def footing(p, x, y, size=0.34, h=0.22, sink=0.06):
    """A small concrete footing under a post: a block `size` square, h tall, sunk `sink` into the ground."""
    p.seal()
    res = bmesh.ops.create_cube(p.bm, size=1.0)
    for v in res["verts"]:
        v.co = Vector((v.co.x * size + x, v.co.y * size + y, (v.co.z + 0.5) * h - sink))
    # a chamfer on the top edge reads as a poured pad
    top = [v for v in res["verts"] if v.co.z > h - sink - 1e-4]
    cx, cy = x, y
    for v in top:
        v.co.x = cx + (v.co.x - cx) * 0.88
        v.co.y = cy + (v.co.y - cy) * 0.88


def rebar(p, a, b, r=REBAR_R, sides=4):
    """A rebar bar (radius floored at MIN_ROD)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    if d.length < 1e-4:
        return
    p.seal()
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.create_cone(p.bm, cap_ends=True, cap_tris=False, segments=sides, radius1=rod_r(r), radius2=rod_r(r),
                          depth=d.length, matrix=Matrix.Translation(a + d / 2) @ rot)


def rebar_grid(p, x0, x1, z0, z1, y, spacing=REBAR_SPACING, jitter=None, top=None):
    """A grid of rebar in the wall plane (XZ) at depth y: vertical bars every `spacing`, horizontal bars crossing them
    on the -Y side (a mat has two layers). `top(x)` gives where each vertical bar breaks off (z), if given."""
    nx = max(1, int(round((x1 - x0) / spacing)))
    nz = max(1, int(round((z1 - z0) / spacing)))
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        zt = z1 if top is None else top(x)
        rebar(p, (x, y, z0), (x, y, zt))
    for j in range(nz + 1):
        z = z0 + (z1 - z0) * j / nz
        for i in range(nx):
            xa = x0 + (x1 - x0) * i / nx
            xb = x0 + (x1 - x0) * (i + 1) / nx
            if top is not None and z > min(top(xa), top(xb)) + 0.02:
                continue
            rebar(p, (xa, y - 2 * rod_r(REBAR_R), z), (xb, y - 2 * rod_r(REBAR_R), z))


# ---- Brick ----

def brick_courses(p, w, h, y_face, rng, tones, at_x=0.0, z0=0.0, relief=0.012, joint=BRICK_JOINT, mortar=None, paint=None):
    """A brick face of w x h (X by Z) at the standard brick size: courses 0.085 apart (one brick plus mortar), bricks
    0.23 long with 0.01 mortar, every other course shifted half a brick (running bond). Each brick is one raised quad
    block `relief` proud of the mortar plane; the mortar is a single dark sheet behind. `paint(p, tone)` is called
    after each brick so each keeps its own tone (a Part's prim). Returns the number of courses."""
    bl, bh = BRICK[0], BRICK[2]
    pitch_x, pitch_z = bl + joint, bh + joint
    courses = int(h / pitch_z)
    if mortar is not None:
        p.seal()
        bm = p.bm
        a = [bm.verts.new((at_x - w / 2, y_face, z0)), bm.verts.new((at_x + w / 2, y_face, z0)),
             bm.verts.new((at_x + w / 2, y_face, z0 + courses * pitch_z)), bm.verts.new((at_x - w / 2, y_face, z0 + courses * pitch_z))]
        bm.faces.new(a)
        paint(p, mortar)
    for c in range(courses):
        z = z0 + c * pitch_z + joint
        shift = (pitch_x / 2) if c % 2 else 0.0
        x = at_x - w / 2 - shift
        while x < at_x + w / 2:
            xa, xb = max(x, at_x - w / 2), min(x + bl, at_x + w / 2)
            if xb - xa > 0.03:
                p.seal()
                _brick_block(p.bm, xa, xb, z, z + bh, y_face, relief)
                paint(p, rng.choice(tones))
            x += pitch_x
    return courses


def _brick_block(bm, xa, xb, za, zb, y, relief):
    """One brick's visible faces: the front (toward -Y, `relief` proud of the mortar plane) and its top. The other
    faces are 1 cm slivers nobody sees at the game camera, so they are left out (a 30 x 9 face wall stays near 1,200
    triangles instead of 3,000)."""
    g = [bm.verts.new((xa, y - relief, za)), bm.verts.new((xb, y - relief, za)), bm.verts.new((xb, y - relief, zb)),
         bm.verts.new((xa, y - relief, zb))]
    bm.faces.new(g)
    t = [bm.verts.new((xa, y, zb)), bm.verts.new((xb, y, zb))]
    bm.faces.new((g[3], g[2], t[1], t[0]))


# =====================================================================================================================
# Ship / spacefaring stock (Keith 2026-10-20: ships extend the shared stock rather than getting a rulebook of their own;
# the villages are built from salvaged ship parts, so a rib or a hull plate in a crash is the very same section as in a
# hull house). Everything above (I / U / L beams, PIPE_R, SQ_TUBE, bolts, MIN_STEEL / MIN_ROD) is used as it is; this
# block adds the materials a ship has and a building does not.
#
# Builders here are pure geometry: they return a `Solid` (a list of faces, each with a *role* naming what it is made of:
# "skin", "steel", "pipe", "cable_red", ...), in a local frame (x along the part, z up) in metres. A consumer places and
# paints them: the wreck kit (tools/blender/wrecks) turns roles into livery colours; buildings call `to_part(p, solid)`
# and paint with `prim` as with the other stock builders. Nothing here paints.
#
# Real values (comments) are lifted through vis_steel() / rod_r() like every other section.
#
#   ARMOUR_T       0.060   armoured hull plate (HULL_PLATE_T 0.025 is the lighter salvage plate the villages cut up)
#   ARMOUR_MODULE  2.4 x 3.6 m, a plate as shipped; bigger ships bolt plates into 2x or 3x gangs (the wreck's `pitch`)
#   HEAT_TILE      real 0.15 m silica tile, 0.07 thick; a game block is 0.5 m of tiles (a real tile would be 5 px at
#                  the game camera) with the grout kept as the gap between blocks
#   HONEY          composite sandwich 0.05 thick: two 12 mm skins (floored to MIN_STEEL) round a hex core, real cell
#                  6 mm, game cell 0.12 m across flats
#   TANK_R         pressure vessels by outer radius, wall 12 mm: bottle 0.25, S 0.5, M 1.0, L 1.6, XL 2.4
#   BELL_SKIN      0.040 regeneratively cooled nozzle skin; cooling tubes PIPE_R["S"]; stiffener rings are RIB I-beams
#   TRAY           cable tray = UBEAM "M" (140 mm) with sheathed cables laid in it, hung from L-beam brackets
#   HATCH          frame of LBEAM "L" (100 mm angle), leaf 0.05, dogging wheel of PIPE_R "S"
#   GRATING        bearing bars 0.020 x 0.040 (MIN_STEEL wide) every 0.06 m (real: 3 x 25 mm every 30 mm), cross bars
#                  every 0.30 m
#   CRYO_POD       2.2 x 0.9 x 0.8 m on a UBEAM "S" cradle; RACK uprights IBEAM "S"
#   CABLE_R        sheath radius, lifted for the game camera: signal 18 mm, power 28 mm, trunk 45 mm (real 6 / 12 / 25 mm)
#   Technical layer (pipe_run, cable_loom, cable_droop, junction_box, duct_run, machinery_module): bundles, never a
#   single thin line (a lone 12 mm line vanishes at the game camera), brackets at a fixed pitch, loose ends cut square.
# =====================================================================================================================
import numpy as np  # noqa: E402

ARMOUR_T = 0.060
ARMOUR_MODULE = (2.4, 3.6)
ARMOUR_SEAM = 0.025
HEAT_TILE_REAL = (0.15, 0.15, 0.07)
HEAT_BLOCK = 0.5
HEAT_T = 0.07
HONEY_T = 0.05
HONEY_SKIN = 0.012
HONEY_CELL_GAME = 0.12
TANK_R = {"bottle": 0.25, "S": 0.5, "M": 1.0, "L": 1.6, "XL": 2.4}
TANK_WALL = 0.012
BELL_SKIN = 0.040
HATCH_LEAF_T = 0.05
GRATING_BAR = (0.020, 0.040)
GRATING_PITCH = 0.06
GRATING_CROSS = 0.30
CRYO_POD = (2.2, 0.9, 0.8)
CABLE_R = {"signal": 0.018, "power": 0.028, "trunk": 0.045}   # game-lifted sheath radii (real 6 / 12 / 25 mm): a 12 mm line is under 1 px at the game camera
CABLE_ROLES = ("cable_red", "cable_blue", "cable_yellow", "cable_black", "cable_white")


class Solid:
    """A bag of faces: (points (n, 3), role). Winding is outward (the builders take care of it)."""

    def __init__(self):
        self.f = []

    def add(self, pts, role="skin"):
        self.f.append((np.asarray(pts, float), role))

    def add_out(self, pts, role, away):
        a = np.asarray(pts, float)
        n = np.cross(a[1] - a[0], a[2] - a[0])
        if len(a) == 4:
            n = n + np.cross(a[2] - a[0], a[3] - a[0])
        if np.dot(n, a.mean(0) - np.asarray(away, float)) < 0:
            a = a[::-1]
        self.f.append((a, role))

    def extend(self, other, R=None, t=None):
        R = np.eye(3) if R is None else np.asarray(R, float)
        t = np.zeros(3) if t is None else np.asarray(t, float)
        for pts, role in other.f:
            self.f.append((pts @ R.T + t, role))
        return self

    def moved(self, R=None, t=None):
        return Solid().extend(self, R, t)

    def tris(self):
        return sum(max(1, len(p) - 2) for p, _ in self.f)


def _rot(a, axis):
    c, s = math.cos(a), math.sin(a)
    if axis == "x":
        return np.array([[1.0, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def _unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def sweep_solid(profile, centres, rights, ups, role="steel", closed=False, caps=True):
    """A profile (list of (u, v), closed polygon) swept through `centres` with a (right, up) frame per centre. Winding is
    corrected from the profile's handedness and the frame, so I, U, L, pipe and ring sweeps all come out facing out."""
    pr = np.asarray(profile, float)
    n = len(pr)
    area = 0.5 * np.sum(pr[:, 0] * np.roll(pr[:, 1], -1) - np.roll(pr[:, 0], -1) * pr[:, 1])
    C = np.asarray(centres, float)
    Rr = np.asarray(rights, float)
    U = np.asarray(ups, float)
    rings = [C[k] + Rr[k][None, :] * pr[:, 0:1] + U[k][None, :] * pr[:, 1:2] for k in range(len(C))]
    s = Solid()
    cnt = len(C) if closed else len(C) - 1
    for k in range(cnt):
        k2 = (k + 1) % len(C)
        a, b = rings[k], rings[k2]
        w = C[k2] - C[k]
        sg = np.sign(area) * np.sign(np.dot(np.cross(Rr[k], U[k]), w))
        for j in range(n):
            j2 = (j + 1) % n
            q = [a[j], a[j2], b[j2], b[j]]
            s.add(q if sg >= 0 else q[::-1], role)
    if caps and not closed:
        w0 = C[1] - C[0]
        sg0 = np.sign(area) * np.sign(np.dot(np.cross(Rr[0], U[0]), w0))
        s.add(rings[0][::-1] if sg0 >= 0 else rings[0], role)
        w1 = C[-1] - C[-2]
        sg1 = np.sign(area) * np.sign(np.dot(np.cross(Rr[-1], U[-1]), w1))
        s.add(rings[-1] if sg1 >= 0 else rings[-1][::-1], role)
    return s


def _circle(r, sides, phase=0.0):
    return [(r * math.cos(phase + 2 * math.pi * i / sides), r * math.sin(phase + 2 * math.pi * i / sides)) for i in range(sides)]


def frames_along(pts, up_hint=(0, 0, 1)):
    """(right, up, miter) per point of a polyline (N, 3): mitred tangents, parallel-transported right vectors; up = T x right
    so (right, up, T) is right-handed."""
    P = np.asarray(pts, float)
    n = len(P)
    T = np.zeros_like(P)
    for i in range(n):
        a = _unit(P[i] - P[i - 1]) if i > 0 else np.zeros(3)
        b = _unit(P[i + 1] - P[i]) if i < n - 1 else np.zeros(3)
        T[i] = _unit(a + b) if np.linalg.norm(a + b) > 1e-6 else (a if np.linalg.norm(a) > 0 else b)
    hint = np.asarray(up_hint, float)
    if abs(np.dot(_unit(T[0]), _unit(hint))) > 0.95:
        hint = np.array([1.0, 0, 0])
    R, U, miter = [], [], []
    r = _unit(np.cross(hint, T[0]))
    for i in range(n):
        r = r - T[i] * np.dot(r, T[i])
        if np.linalg.norm(r) < 1e-6:
            r = _unit(np.cross(hint, T[i]))
        r = _unit(r)
        R.append(r)
        U.append(np.cross(T[i], r))
        if 0 < i < n - 1:
            c = float(np.dot(_unit(P[i] - P[i - 1]), _unit(P[i + 1] - P[i])))
            half = math.acos(max(-1.0, min(1.0, c))) / 2
            miter.append(min(1.0 / max(math.cos(half), 0.35), 1.6))
        else:
            miter.append(1.0)
    return R, U, miter


def tube_solid(pts, r, sides=5, role="pipe", caps=True, closed=False, phase=0.0):
    """A round tube (pipe, cable, hose) of outer radius r (floored at MIN_ROD) swept along a polyline; corners mitred."""
    P = np.asarray(pts, float)
    r = rod_r(r)
    R, U, M = frames_along(P)
    prof = np.array(_circle(r, sides, phase))
    s = Solid()
    rings = [P[i] + R[i][None, :] * (prof[:, 0:1] * M[i]) + U[i][None, :] * (prof[:, 1:2] * M[i]) for i in range(len(P))]
    cnt = len(P) if closed else len(P) - 1
    for k in range(cnt):
        a, b = rings[k], rings[(k + 1) % len(P)]
        for j in range(sides):
            j2 = (j + 1) % sides
            s.add([a[j], b[j], b[j2], a[j2]], role)
    if caps and not closed:
        s.add(rings[0][::-1].copy(), role)
        s.add(rings[-1], role)
    return s


def _beam(prof, a, b, up, role):
    a, b = np.asarray(a, float), np.asarray(b, float)
    w = _unit(b - a)
    r = _unit(np.cross(up, w))
    if np.linalg.norm(r) < 1e-6:
        r = _unit(np.cross((0, 1, 0), w))
    u = np.cross(w, r)
    return sweep_solid(prof, [a, b], [r, r], [u, u], role)


def i_solid(a, b, size="M", up=(0, 0, 1), role="steel"):
    return _beam(i_profile(size), a, b, up, role)


def u_solid(a, b, size="M", up=(0, 0, 1), role="steel"):
    return _beam(u_profile(size), a, b, up, role)


def l_solid(a, b, size="M", up=(0, 0, 1), role="steel"):
    return _beam(l_profile(size), a, b, up, role)


def pipe_solid(a, b, size="S", sides=5, role="pipe"):
    return tube_solid([a, b], PIPE_R[size] if isinstance(size, str) else size, sides, role)


def box_solid(c, size, R=None, role="steel", bottom=True):
    """A closed box (outward faces) of full extents `size` (x, y, z) centred on c, turned by the 3x3 matrix R."""
    R = np.eye(3) if R is None else np.asarray(R, float)
    h = np.asarray(size, float) / 2
    K = {}
    for ix in (-1, 1):
        for iy in (-1, 1):
            for iz in (-1, 1):
                K[ix, iy, iz] = np.asarray(c, float) + R @ (np.array([ix, iy, iz]) * h)
    s = Solid()
    s.add([K[-1, -1, 1], K[1, -1, 1], K[1, 1, 1], K[-1, 1, 1]], role)
    if bottom:
        s.add([K[-1, 1, -1], K[1, 1, -1], K[1, -1, -1], K[-1, -1, -1]], role)
    s.add([K[-1, -1, -1], K[1, -1, -1], K[1, -1, 1], K[-1, -1, 1]], role)
    s.add([K[1, -1, -1], K[1, 1, -1], K[1, 1, 1], K[1, -1, 1]], role)
    s.add([K[1, 1, -1], K[-1, 1, -1], K[-1, 1, 1], K[1, 1, 1]], role)
    s.add([K[-1, 1, -1], K[-1, -1, -1], K[-1, -1, 1], K[-1, 1, 1]], role)
    return s


def revolve_solid(rs, sides=10, role="skin", sy=1.0, sz=1.0, cap=True, hollow_t=0.0, phase=0.0):
    """Surface of revolution round the x axis: rs = [(x, radius), ...] (outside faces out). sy / sz make the section
    elliptical. A radius of 0 closes to a point; cap=True also closes a flat open end. hollow_t > 0 adds an inner skin
    ("dark") and rim, for an open nozzle."""
    s = Solid()

    def ring(x, r):
        return [np.array([x, r * sy * math.cos(phase + 2 * math.pi * i / sides), r * sz * math.sin(phase + 2 * math.pi * i / sides)]) for i in range(sides)]

    rings = [ring(x, r) for x, r in rs]
    for k in range(len(rs) - 1):
        a, b = rings[k], rings[k + 1]
        for j in range(sides):
            j2 = (j + 1) % sides
            if rs[k][1] < 1e-6 and rs[k + 1][1] < 1e-6:
                continue
            if rs[k][1] < 1e-6:
                s.add([a[j], b[j2], b[j]], role)
            elif rs[k + 1][1] < 1e-6:
                s.add([a[j], a[j2], b[j]], role)
            else:
                s.add([a[j], a[j2], b[j2], b[j]], role)
    if cap and hollow_t <= 0:
        if rs[0][1] > 1e-6:
            s.add(rings[0][::-1], role)
        if rs[-1][1] > 1e-6:
            s.add(rings[-1], role)
    if hollow_t > 0:
        inner = [ring(x, max(r - hollow_t, 0.0)) for x, r in rs]
        for k in range(len(rs) - 1):
            a, b = inner[k], inner[k + 1]
            for j in range(sides):
                j2 = (j + 1) % sides
                s.add([a[j], b[j], b[j2], a[j2]], "dark")
        for end in (0, -1):
            ra, rb = rings[end], inner[end]
            for j in range(sides):
                j2 = (j + 1) % sides
                q = [ra[j], ra[j2], rb[j2], rb[j]]
                s.add(q[::-1] if end == 0 else q, "edge")
    return s


# ---- Plates: armour, heat tiles, composite ----

def _ring_pts(l, w, d, nv, zc, drop=0.0):
    """Perimeter (CCW seen from +z) of a rectangle inset by d, nv segments up the short edges, at z = zc(y) - drop."""
    X = l / 2 - d
    ys = np.linspace(-w / 2 + d, w / 2 - d, nv + 1)
    pts = [(-X, ys[0])] + [(X, y) for y in ys] + [(-X, y) for y in ys[::-1][:-1]]
    return [np.array([x, y, zc(y) - drop]) for x, y in pts]


def armour_plate(w=ARMOUR_MODULE[0], l=ARMOUR_MODULE[1], t=ARMOUR_T, curve_r=0.0, role="skin", bolts=True, bev=0.03):
    """One armoured hull plate: l along x, w along y, t thick below the top face (z = 0 at the crown), optionally curved
    round the x axis (curve_r > 0, as a plate lying on ribs). A bevel frames the top face (so every plate has a light
    edge and a seam), the sides show their thickness, bolt heads (BOLT_R) sit in two rows along the long edges."""
    nv = 1 if curve_r <= 0 else max(1, int(math.ceil(w / (curve_r * 0.4))))

    def zc(y):
        return -(curve_r - math.sqrt(max(curve_r ** 2 - y ** 2, 0.0))) if curve_r > 0 else 0.0

    s = Solid()
    inner = _ring_pts(l, w, bev, nv, zc)
    outer = _ring_pts(l, w, 0.0, nv, zc, bev * 0.6)
    under = _ring_pts(l, w, 0.0, nv, zc, t)
    s.add(inner, role)
    n = len(inner)
    for k in range(n):
        k2 = (k + 1) % n
        s.add([outer[k], outer[k2], inner[k2], inner[k]], "edge")
        s.add([under[k], under[k2], outer[k2], outer[k]], "dark")
    s.add(under[::-1], "dark")
    if bolts:
        nb = max(2, int(l / 0.6))
        for sgn in (-1, 1):
            y = sgn * (w / 2 - 0.12)
            for i in range(nb):
                x = -l / 2 + (i + 0.5) * l / nb
                s.extend(bolt_solid((x, y, zc(y)), (0, 0, 1)))
    return s


def bolt_solid(pos, normal=(0, 0, 1), r=BOLT_R, h=BOLT_H, sides=4, role="steel"):
    n = _unit(normal)
    ref = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    a = _unit(np.cross(n, ref))
    b = np.cross(n, a)
    p = np.asarray(pos, float)
    base = [p + a * r * math.cos(2 * math.pi * i / sides + 0.4) + b * r * math.sin(2 * math.pi * i / sides + 0.4) for i in range(sides)]
    top = [q + n * h for q in base]
    s = Solid()
    for i in range(sides):
        j = (i + 1) % sides
        s.add([base[i], base[j], top[j], top[i]], role)
    s.add(top, role)
    return s


def heat_tile_panel(w=2.4, l=3.6, rng=None, missing=0.07, curve_r=0.0, block=HEAT_BLOCK, role="tile"):
    """Heat-shield tiles on a base plate: blocks of `block` m (real HEAT_TILE_REAL tiles gang into game-size blocks), each
    standing HEAT_T above the plate with a groove between; a few missing (the plate shows) and a few worn low."""
    rng = rng or np.random.default_rng(1)
    s = armour_plate(w, l, ARMOUR_T, curve_r, role="dark", bolts=False)
    nx, ny = max(1, int(round(l / block))), max(1, int(round(w / block)))
    gx, gy = l / nx, w / ny

    def zc(y):
        return -(curve_r - math.sqrt(max(curve_r ** 2 - y ** 2, 0.0))) if curve_r > 0 else 0.0
    for i in range(nx):
        for j in range(ny):
            if rng.random() < missing:
                continue
            x0, x1 = -l / 2 + i * gx + 0.02, -l / 2 + (i + 1) * gx - 0.02
            y0, y1 = -w / 2 + j * gy + 0.02, -w / 2 + (j + 1) * gy - 0.02
            h = HEAT_T * (0.45 if rng.random() < 0.15 else 1.0) + rng.uniform(-0.008, 0.01)
            z0, z1 = zc(y0), zc(y1)
            s.add([(x0, y0, z0 + h), (x1, y0, z0 + h), (x1, y1, z1 + h), (x0, y1, z1 + h)], role)
            s.add([(x0, y0, z0), (x1, y0, z0), (x1, y0, z0 + h), (x0, y0, z0 + h)], "tile_edge")
            s.add([(x1, y1, z1), (x0, y1, z1), (x0, y1, z1 + h), (x1, y1, z1 + h)], "tile_edge")
            s.add([(x1, y0, z0), (x1, y1, z1), (x1, y1, z1 + h), (x1, y0, z0 + h)], "tile_edge")
            s.add([(x0, y1, z1), (x0, y0, z0), (x0, y0, z0 + h), (x0, y1, z1 + h)], "tile_edge")
    return s


def _hex(cx, cy, r, h, role, z0=0.0):
    """One honeycomb cell: a hex ring wall (outside faces only, open top and bottom) rising h from z0."""
    s = Solid()
    pts = [(cx + r * math.cos(math.pi / 3 * i), cy + r * math.sin(math.pi / 3 * i)) for i in range(6)]
    for i in range(6):
        j = (i + 1) % 6
        s.add([(pts[i][0], pts[i][1], z0), (pts[j][0], pts[j][1], z0), (pts[j][0], pts[j][1], z0 + h), (pts[i][0], pts[i][1], z0 + h)], role)
    return s


def honeycomb_panel(w=1.2, l=2.4, t=HONEY_T, bare=0.45, rng=None, role="skin"):
    """A composite sandwich panel (l along x, w along y, top skin at z = 0, bottom skin at z = -t): a bottom skin everywhere,
    a top skin over the part that survives, and where it is torn off (`bare` = the share bare, a ragged diagonal) the hex
    core shows, HONEY_CELL_GAME across, with the torn skin's edge standing out as a thin lip."""
    rng = rng or np.random.default_rng(1)
    sk = vis_steel(HONEY_SKIN)
    s = Solid()
    s.add([(-l / 2, -w / 2, -t), (-l / 2, w / 2, -t), (l / 2, w / 2, -t), (l / 2, -w / 2, -t)], "dark")
    s.add([(-l / 2, -w / 2, -t + sk), (l / 2, -w / 2, -t + sk), (l / 2, w / 2, -t + sk), (-l / 2, w / 2, -t + sk)], "edge")
    cut = (0.5 - bare) * (l + w) * 0.8

    def kept(x, y):
        return (x + y * 0.6) + 0.0 > cut

    nx, ny = max(2, int(l / 0.4)), max(2, int(w / 0.4))
    jit = rng.uniform(-0.15, 0.15, (nx, ny))
    for i in range(nx):
        for j in range(ny):
            x0, x1 = -l / 2 + i * l / nx, -l / 2 + (i + 1) * l / nx
            y0, y1 = -w / 2 + j * w / ny, -w / 2 + (j + 1) * w / ny
            if (x0 + x1) / 2 + (y0 + y1) / 2 * 0.6 + jit[i, j] > cut:
                s.add([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)], role)
                s.add([(x0, y1, -sk), (x1, y1, -sk), (x1, y0, -sk), (x0, y0, -sk)], "dark")
    r = HONEY_CELL_GAME / math.sqrt(3)
    col, xx = 0, -l / 2 + r
    while xx < l / 2 - r * 0.5:
        yy = -w / 2 + r + (0.5 * math.sqrt(3) * r if col % 2 else 0.0)
        while yy < w / 2 - r * 0.8:
            i = min(nx - 1, max(0, int((xx + l / 2) / l * nx)))
            j = min(ny - 1, max(0, int((yy + w / 2) / w * ny)))
            if (xx + yy * 0.6) + jit[i, j] <= cut:
                s.extend(_hex(xx, yy, r * 0.96, t - sk, "core", z0=-t + sk))
            yy += math.sqrt(3) * r
        xx += 1.5 * r
        col += 1
    return s


# ---- Tanks, bells, hatches, grating, trays, pods ----

def pressure_tank(r="M", length=3.0, saddles=2, nozzles=2, sides=10, role="tank"):
    """A pressure vessel lying along x (z up, standing on its saddles at z = 0): cylinder with domed ends, weld bands every
    ~1.2 m (proud rings), U-beam saddles with straps, `nozzles` pipe stubs on top."""
    rr = TANK_R[r] if isinstance(r, str) else r
    L = max(length, 2 * rr + 0.4)
    z0 = rr + 0.12
    dome = [(0.0, 0.0), (0.12 * rr, rr * 0.55), (0.38 * rr, rr * 0.87), (rr * 0.8, rr)]
    pts = dome + [(L - x, y) for x, y in reversed(dome)]
    s = revolve_solid(pts, sides, role).moved(t=(0, 0, z0))
    nb = max(0, int((L - 2 * rr) / 1.2))
    for k in range(1, nb + 1):
        x = rr * 0.8 + k * (L - 1.6 * rr) / (nb + 1)
        s.extend(revolve_solid([(x - 0.04, rr * 1.03), (x + 0.04, rr * 1.03)], sides, "steel", cap=False).moved(t=(0, 0, z0)))
    for k in range(saddles):
        x = L * (0.22 + 0.56 * k / (saddles - 1)) if saddles > 1 else L / 2
        s.extend(u_solid((x, -rr * 0.7, 0.07), (x, rr * 0.7, 0.07), "L", up=(1, 0, 0), role="steel"))
        for sgn in (-1, 1):
            s.extend(l_solid((x, sgn * rr * 0.62, 0.12), (x, sgn * rr * 0.55, z0 + rr * 0.5), "M", up=(1, 0, 0), role="steel"))
    for k in range(nozzles):
        x = L * (0.35 + 0.3 * k)
        s.extend(pipe_solid((x, 0, z0 + rr - 0.02), (x, 0, z0 + rr + 0.28), "M", 6, "pipe"))
        s.extend(pipe_solid((x, 0, z0 + rr + 0.28), (x + 0.5, 0, z0 + rr + 0.28), "S", 5, "pipe"))
    return s


def bell_profile(rt, re, length, n=8):
    """(x, radius) of a nozzle: a short chamber at 1.35 x throat radius, the throat at 22% of the length, then a parabolic bell."""
    pts = [(0.0, rt * 1.35), (0.10 * length, rt * 1.35), (0.22 * length, rt)]
    for i in range(1, n + 1):
        t = i / n
        pts.append((0.22 * length + t * 0.78 * length, rt + (re - rt) * (t ** 0.62)))
    return pts


def ring_solid(x, radius, size="RIB", sides=20, role="steel", arc=None):
    """A closed IBEAM ring of centre-line radius `radius` round the x axis at x, depth radial, flanges along x (a rib or a
    bell stiffener). With arc=(a0, a1) in radians, only that part."""
    prof = i_profile(size)
    n = sides if arc is None else max(3, int(sides * (arc[1] - arc[0]) / (2 * math.pi)) + 1)
    C, Rr, U = [], [], []
    for k in range(n):
        a = 2 * math.pi * k / sides if arc is None else arc[0] + (arc[1] - arc[0]) * k / (n - 1)
        rad = np.array([0, math.cos(a), math.sin(a)])
        C.append(np.array([x, 0, 0]) + rad * radius)
        Rr.append(np.array([1.0, 0, 0]))
        U.append(rad)
    return sweep_solid(prof, C, Rr, U, role, closed=arc is None, caps=arc is not None)


def injector_head(r, sides=12):
    """The back of an engine (it faces -x from x = 0): a domed injector plate, a manifold ring of PIPE_R "M" pipe and four
    feed lines leaving it. Never a flat disc."""
    s = revolve_solid([(0.0, r), (-0.10 * r, r * 1.02), (-0.16 * r, r * 0.9), (-0.10 * r, r * 0.55), (-0.22 * r, r * 0.30), (-0.24 * r, 0.0)],
                      sides, "steel", cap=False)
    tor = [(-0.17 * r, 0.7 * r * math.cos(2 * math.pi * k / sides), 0.7 * r * math.sin(2 * math.pi * k / sides)) for k in range(sides)]
    s.extend(tube_solid(tor, PIPE_R["M"], 5, "pipe", closed=True))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        y, z = 0.7 * r * math.cos(a), 0.7 * r * math.sin(a)
        s.extend(tube_solid([(-0.17 * r, y, z), (-0.55 * r, y * 1.2, z * 1.2), (-1.0 * r, y * 1.55, z * 1.55)], PIPE_R["M"], 5, "pipe"))
    return s


def thruster_bell(rt=0.5, re=1.6, length=3.2, sides=12, tubes=True, role="bell"):
    """An engine nozzle along +x (injector end at x = 0): chamber, throat, bell (BELL_SKIN shell, open wide end, dark inner
    skin), RIB I-beam stiffener rings at the throat and every 0.9 m, PIPE_R "S" cooling tubes along the outside (one per
    ~0.35 m round, 18 at most), a gimbal ring of "L" I-beam with two actuators, and the domed injector head."""
    prof = bell_profile(rt, re, length)
    s = revolve_solid(prof, sides, role, cap=False, hollow_t=BELL_SKIN)
    s.extend(injector_head(rt * 1.35, sides))
    px, pr = [p[0] for p in prof], [p[1] for p in prof]
    xs = [0.22 * length] + list(np.arange(0.22 * length + 0.9, length - 0.2, 0.9))
    for x in xs:
        s.extend(ring_solid(x, float(np.interp(x, px, pr)) + 0.02, "RIB", sides + 4))
    if tubes:
        nt = min(18, max(6, int(2 * math.pi * rt * 1.4 / 0.35)))
        for k in range(nt):
            a = 2 * math.pi * k / nt
            path = [(x, (r + 0.11) * math.cos(a), (r + 0.11) * math.sin(a)) for x, r in prof[2:]]
            s.extend(tube_solid(path, PIPE_R["S"], 4, "pipe"))
    s.extend(ring_solid(0.06 * length, rt * 1.35 + 0.3, "L", sides + 4))
    for sgn in (-1, 1):
        s.extend(pipe_solid((0.06 * length, 0, sgn * (rt * 1.35 + 0.3)), (-0.2 * length, 0, sgn * (rt * 1.35 + 0.9)), "L", 5, "steel"))
    return s


def hatch_frame(w=1.1, h=1.9, open_deg=70.0, role="steel", leaf_role="skin"):
    """A hatch or airlock door in a bulkhead (the bulkhead plane is x = 0, the door faces +x, z = 0 the sill): a frame of
    LBEAM "L" angle on four sides, a leaf of HATCH_LEAF_T hung on the -y hinge and swung open `open_deg` (0 = shut), a
    dogging wheel (ring of PIPE_R "S" with spokes)."""
    s = Solid()
    for a, b in (((0, -w / 2, 0), (0, -w / 2, h)), ((0, w / 2, 0), (0, w / 2, h)), ((0, -w / 2, h), (0, w / 2, h)), ((0, -w / 2, 0), (0, w / 2, 0))):
        s.extend(l_solid(a, b, "L", up=(1, 0, 0), role=role))
    lw, lh = w - 0.1, h - 0.1
    leaf = box_solid((0, lw / 2, 0), (HATCH_LEAF_T, lw, lh), None, leaf_role)
    wheel = tube_solid([(0.0, lw / 2 + 0.18 * math.cos(2 * math.pi * k / 8), 0.18 * math.sin(2 * math.pi * k / 8)) for k in range(8)], PIPE_R["S"], 4, "steel", closed=True)
    for k in range(4):
        ang = k * math.pi / 2
        wheel.extend(tube_solid([(0, lw / 2, 0), (0, lw / 2 + 0.18 * math.cos(ang), 0.18 * math.sin(ang))], 0.012, 4, "steel"))
    wheel = wheel.moved(t=(HATCH_LEAF_T / 2 + 0.03, 0, 0))
    leaf.extend(wheel)
    leaf = leaf.moved(_rot(math.radians(open_deg), "z"), (0.0, -w / 2 + 0.05, h / 2))
    s.extend(leaf)
    return s


def deck_grating(w=1.2, l=2.4, role="grate"):
    """Bar grating (top at z = 0): bearing bars GRATING_BAR across the short side every GRATING_PITCH, cross bars every
    GRATING_CROSS, in a frame of LBEAM "S" angle."""
    s = Solid()
    bw, bh = GRATING_BAR
    nb = max(2, int(w / GRATING_PITCH))
    for i in range(nb):
        y = -w / 2 + (i + 0.5) * w / nb
        s.extend(box_solid((0, y, -bh / 2), (l, bw, bh), None, role, bottom=False))
    nc = max(1, int(l / GRATING_CROSS))
    for k in range(nc):
        s.extend(box_solid((-l / 2 + (k + 0.5) * l / nc, 0, -bh * 0.8), (0.015, w, 0.02), None, "steel", bottom=False))
    for sgn in (-1, 1):
        s.extend(l_solid((-l / 2, sgn * w / 2, -0.02), (l / 2, sgn * w / 2, -0.02), "S", up=(0, 0, 1), role="steel"))
    return s


def cable_tray(length=3.0, size="M", cables=3, rng=None, hang=0.0):
    """A cable tray along +x: a UBEAM channel opening up, cables (sheaths in the cable roles) laid in it with a slight
    wander, an L-beam hanger every 1.2 m when hang > 0 (down to z = -hang)."""
    s = u_solid((0, 0, 0), (length, 0, 0), size, up=(0, 0, 1), role="steel")
    d, bf = UBEAM[size][0], UBEAM[size][1]
    for k in range(cables):
        y = (k - (cables - 1) / 2) * (bf * 0.8 / max(cables, 1))
        pts = [(x, y + 0.012 * math.sin(x * 2 + k), -d / 2 + vis_steel(UBEAM[size][3]) + CABLE_R["power"]) for x in np.linspace(0, length, max(3, int(length / 0.5)))]
        s.extend(tube_solid(pts, CABLE_R["power"], 4, CABLE_ROLES[k % len(CABLE_ROLES)]))
    if hang > 0:
        for x in np.arange(0.3, length, 1.2):
            s.extend(l_solid((x, 0, -d / 2), (x, 0, -hang), "M", up=(1, 0, 0), role="steel"))
    return s


def cryo_pod(lid_open=0.0):
    """One cryogenic sleeper pod (CRYO_POD 2.2 x 0.9 x 0.8, centred on x and y, floor at z = 0): a UBEAM "S" cradle, a rounded
    shell, a canopy lid (open by `lid_open` radians about a long edge), two hoses and a status screen."""
    L, W, H = CRYO_POD
    s = Solid()
    for sg in (-1, 1):
        s.extend(u_solid((-L / 2 + 0.1, sg * W * 0.4, 0.12), (L / 2 - 0.1, sg * W * 0.4, 0.12), "S", up=(0, 0, 1), role="steel"))
    body = revolve_solid([(-L / 2, 0.0), (-L / 2 + 0.12, 0.34), (-L / 2 + 0.5, 0.42), (L / 2 - 0.5, 0.42), (L / 2 - 0.12, 0.34), (L / 2, 0.0)], 8, "pod", sy=1.0, sz=0.62)
    s.extend(body.moved(t=(0, 0, 0.36)))
    lid = revolve_solid([(-L / 2 + 0.35, 0.0), (-L / 2 + 0.5, 0.30), (L / 2 - 0.7, 0.30), (L / 2 - 0.4, 0.0)], 6, "glass", sy=1.0, sz=0.5).moved(t=(0, 0, 0.36 + 0.2))
    if lid_open > 0:
        piv = np.array([0, -W / 2 * 0.6, 0.5])
        lid = lid.moved(t=-piv).moved(_rot(lid_open, "x"), piv)
    s.extend(lid)
    for sg in (-1, 1):
        s.extend(tube_solid([(L / 2 - 0.25, sg * 0.15, 0.58), (L / 2 + 0.05, sg * 0.2, 0.5), (L / 2 + 0.12, sg * 0.3, 0.1)], 0.03, 4, "cable_blue" if sg < 0 else "cable_white"))
    s.extend(box_solid((L / 2 - 0.15, W / 2 * 0.7, 0.62), (0.02, 0.28, 0.18), None, "screen", bottom=False))
    return s


def cryo_rack(n=2, levels=2, pod_open=(0.0, 0.0)):
    """A rack of cryo pods side by side (n along x) and `levels` high: IBEAM "S" uprights between pods, steel shelves, pods;
    stands on the floor at z = 0."""
    s = Solid()
    L, W, H = CRYO_POD
    pitch = L + 0.25
    lev_h = H + 0.55
    total = n * pitch
    for i in range(n + 1):
        x = -total / 2 + i * pitch
        for sg in (-1, 1):
            s.extend(i_solid((x, sg * (W / 2 + 0.1), 0), (x, sg * (W / 2 + 0.1), levels * lev_h + 0.1), "S", up=(1, 0, 0), role="steel"))
    for lv in range(levels):
        z = lv * lev_h
        s.extend(box_solid((0, 0, z + 0.04), (total, W + 0.2, 0.03), None, "steel"))
        for i in range(n):
            x = -total / 2 + (i + 0.5) * pitch
            opn = pod_open[(i + lv) % len(pod_open)] if pod_open else 0.0
            s.extend(cryo_pod(lid_open=opn).moved(t=(x, 0, z + 0.05)))
    return s


# ---- Technical layer: pipe runs, cable looms, droops, junction boxes, ducts, machinery ----

def pipe_run(path, sizes=("M", "S", "S"), spread=0.14, bracket_every=1.4, flange_every=2.6, valve_every=0, rng=None,
             roles=("pipe", "pipe2", "pipe"), up_hint=(0, 0, 1), sides=5, lift=1.0):
    """A bundle of parallel pipes (mixed PIPE_R sizes, `spread` apart across the path's right axis, every other pipe lifted)
    along a polyline, corners mitred; bracket straps at `bracket_every`, a flange ring at `flange_every` and a valve (body
    + stem + wheel) every `valve_every` when set. `lift` scales the pipe radii (game lift: a 3 cm pipe is under 2 px at the
    game camera, so a wreck's coolant lines are drawn at 2-2.5 x); the caller scales `spread` itself."""
    P = np.asarray(path, float)
    R, U, M = frames_along(P, up_hint)
    s = Solid()
    n = len(sizes)
    offs = [((k - (n - 1) / 2) * spread, 0.45 * spread * (k % 2)) for k in range(n)]
    for k, sz in enumerate(sizes):
        pts = [P[i] + (R[i] * offs[k][0] + U[i] * offs[k][1]) * M[i] for i in range(len(P))]
        s.extend(tube_solid(pts, (PIPE_R[sz] if isinstance(sz, str) else sz) * lift, sides, roles[k % len(roles)]))
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        seg = np.linalg.norm(b - a)
        if seg < 1e-3:
            continue
        w = _unit(b - a)
        r = R[i]
        u = np.cross(w, r)
        Rm = np.column_stack([w, r, u])
        for d in np.arange(bracket_every * 0.5, seg, bracket_every):
            s.extend(box_solid(a + w * d - u * 0.05, (0.05, (n - 1) * spread + 0.2, 0.04), Rm, "steel", bottom=False))
        if flange_every:
            for d in np.arange(flange_every * 0.5, seg, flange_every):
                for k, sz in enumerate(sizes):
                    c = a + w * d + r * offs[k][0] + u * offs[k][1]
                    rr = rod_r((PIPE_R[sz] if isinstance(sz, str) else sz) * lift) * 1.45
                    s.extend(tube_solid([c - w * 0.025, c + w * 0.025], rr, 5, "steel", caps=False))
        if valve_every:
            for d in np.arange(valve_every * 0.5, seg, valve_every):
                c = a + w * d + r * offs[0][0]
                s.extend(box_solid(c, (0.22, 0.14, 0.16), Rm, "steel"))
                s.extend(tube_solid([c + u * 0.08, c + u * 0.22], 0.012, 4, "steel"))
                s.extend(tube_solid([c + u * 0.22 - r * 0.07, c + u * 0.22 + r * 0.07], 0.014, 4, "cable_red"))
    return s


def cable_loom(path, n=4, spread=0.05, clamp_every=1.0, up_hint=(0, 0, 1), trunk=False):
    """A loom of `n` sheathed cables (one colour each) bundled along a polyline, a clamp strap every `clamp_every`;
    `trunk` makes the first cable a thick trunk."""
    P = np.asarray(path, float)
    R, U, M = frames_along(P, up_hint)
    s = Solid()
    for k in range(n):
        ang = 2 * math.pi * k / n + 0.5
        r_c = CABLE_R["trunk"] if (trunk and k == 0) else (CABLE_R["power"] if k % 2 else CABLE_R["signal"])
        pts = [P[i] + (R[i] * math.cos(ang) + U[i] * math.sin(ang)) * spread * M[i] for i in range(len(P))]
        s.extend(tube_solid(pts, r_c, 4, CABLE_ROLES[k % len(CABLE_ROLES)]))
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        seg = np.linalg.norm(b - a)
        if seg < 1e-3:
            continue
        w = _unit(b - a)
        for d in np.arange(clamp_every * 0.5, seg, clamp_every):
            c = a + w * d
            s.extend(tube_solid([c - w * 0.02, c + w * 0.02], spread + 0.035, 6, "steel"))
    return s


def cable_droop(a, b, sag=0.5, n=3, spread=0.04, rng=None, splay=0.35, loose_end=True, seg=6):
    """Loose cables hanging between two points with a sag (a parabola, `sag` metres down at the middle), `n` cables a few
    cm apart. With loose_end each cable stops at 70-90% of the span and its last bit splays (each a different way, the end
    cut square), as at a torn opening."""
    rng = rng or np.random.default_rng(7)
    A, B = np.asarray(a, float), np.asarray(b, float)
    s = Solid()
    w = _unit(B - A)
    side = _unit(np.cross(w, (0, 0, 1)))
    if np.linalg.norm(side) < 1e-6:
        side = np.array([0, 1.0, 0])
    for k in range(n):
        off = side * (k - (n - 1) / 2) * spread
        t_end = 1.0 if not loose_end else rng.uniform(0.7, 0.9)
        pts = []
        for i in range(seg + 1):
            t = i / seg * t_end
            pts.append(A + (B - A) * t + off - np.array([0, 0, 4 * sag * t * (1 - t)]))
        if loose_end:
            d = rng.uniform(-1, 1, 3) * splay
            d[2] = -abs(d[2]) - 0.2
            for j in (1, 2):
                pts.append(pts[-1] + d * 0.5)
        s.extend(tube_solid(pts, CABLE_R["power"] if k % 2 else CABLE_R["signal"], 4, CABLE_ROLES[int(rng.integers(0, len(CABLE_ROLES)))]))
    return s


def junction_box(w=0.5, h=0.6, d=0.22, conduits=3, lid_open=0.0, rng=None):
    """An electrical junction box on a wall (back at y = 0, standing out along +y, z up from 0): a box with a lid (hinged at
    +x, swung out by lid_open radians), four bolt heads, `conduits` pipe stubs out of the bottom each with a cable."""
    s = box_solid((0, d / 2, h / 2), (w, d, h), None, "steel")
    if lid_open <= 0.01:
        s.extend(box_solid((0, d + 0.012, h / 2), (w - 0.06, 0.024, h - 0.06), None, "panel", bottom=False))
    else:
        lid = box_solid((-(w - 0.06) / 2, 0, 0), (w - 0.06, 0.024, h - 0.06), None, "panel")
        s.extend(lid.moved(_rot(lid_open, "z"), (w / 2 - 0.03, d + 0.012, h / 2)))
        s.extend(box_solid((0, d - 0.02, h / 2), (w - 0.12, 0.04, h - 0.12), None, "dark", bottom=False))
        for k in range(3):
            s.extend(tube_solid([(-w / 2 + 0.1 + k * 0.1, d - 0.02, h * 0.3), (-w / 2 + 0.1 + k * 0.1, d + 0.06, h * 0.7)], 0.012, 4, CABLE_ROLES[k]))
    for k in range(conduits):
        x = (k - (conduits - 1) / 2) * w / (conduits + 0.5)
        s.extend(pipe_solid((x, d / 2, 0.0), (x, d / 2, -0.3), "tube", 5, "pipe"))
        s.extend(tube_solid([(x, d / 2, -0.3), (x + 0.04, d / 2 + 0.03, -0.5), (x + 0.12 * (1 if k % 2 else -1), d / 2 + 0.1, -0.8)], CABLE_R["power"], 4, CABLE_ROLES[k % 5]))
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.extend(bolt_solid((sx * (w / 2 - 0.05), d, h / 2 + sz * (h / 2 - 0.05)), (0, 1, 0)))
    return s


def duct_run(a, b, w=0.5, h=0.4, flange_every=1.5, role="duct", up=(0, 0, 1)):
    """Rectangular ducting from a to b, a flange frame (4 cm bigger, 4 cm long) every `flange_every`."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ln = np.linalg.norm(b - a)
    wv = _unit(b - a)
    r = _unit(np.cross(up, wv))
    u = np.cross(wv, r)
    Rm = np.column_stack([wv, r, u])
    s = box_solid((a + b) / 2, (ln, w, h), Rm, role)
    for d in np.arange(flange_every * 0.5, ln, flange_every):
        s.extend(box_solid(a + wv * d, (0.04, w + 0.08, h + 0.08), Rm, "steel"))
    return s


def machinery_module(kind="pump"):
    """A small machine on a skid (floor z = 0, centred): `pump` (motor + volute on UBEAM "M" rails, two ports), `compressor`
    (a small tank with a motor and a pipe manifold), `generator` (a block with cooling fins and an exhaust stack), `cabinet`
    (a control cabinet with louvres and a row of cable glands)."""
    s = Solid()
    if kind == "pump":
        for sg in (-1, 1):
            s.extend(u_solid((-0.7, sg * 0.35, 0.07), (0.7, sg * 0.35, 0.07), "M", up=(0, 0, 1), role="steel"))
        s.extend(revolve_solid([(-0.7, 0.0), (-0.65, 0.26), (-0.05, 0.28), (0.0, 0.0)], 8, "machine").moved(t=(0, 0, 0.5)))
        s.extend(revolve_solid([(0.0, 0.0), (0.05, 0.38), (0.5, 0.42), (0.55, 0.0)], 8, "steel").moved(t=(0, 0, 0.5)))
        s.extend(pipe_solid((0.3, 0, 0.85), (0.3, 0, 1.4), "M", 6, "pipe"))
        s.extend(pipe_solid((0.55, 0, 0.5), (0.95, 0, 0.5), "M", 6, "pipe"))
    elif kind == "compressor":
        s.extend(pressure_tank("S", 1.8, 2, 1).moved(t=(-0.9, 0, 0)))
        s.extend(box_solid((0.3, 0.8, 0.5), (0.5, 0.5, 0.6), None, "machine"))
        s.extend(tube_solid([(0.3, 0.8, 0.8), (0.3, 0.8, 1.5), (0.0, 0.1, 1.5)], 0.03, 5, "pipe"))
    elif kind == "generator":
        s.extend(box_solid((0, 0, 0.6), (1.6, 0.9, 1.0), None, "machine"))
        for i in range(7):
            s.extend(box_solid((-0.6 + i * 0.2, 0.0, 1.22), (0.05, 0.9, 0.24), None, "steel"))
        s.extend(pipe_solid((0.6, 0.0, 1.1), (0.6, 0.0, 2.2), "M", 6, "pipe"))
    else:
        s.extend(box_solid((0, 0, 0.9), (0.9, 0.6, 1.8), None, "steel"))
        for i in range(6):
            s.extend(box_solid((0, 0.31, 1.3 + i * 0.07), (0.6, 0.02, 0.03), None, "dark", bottom=False))
        for i in range(5):
            s.extend(tube_solid([(-0.3 + i * 0.15, 0.3, 0.08), (-0.3 + i * 0.15, 0.34, -0.15)], 0.02, 4, CABLE_ROLES[i % 5]))
    return s


def to_part(p, solid):
    """Adds a Solid to a buildings `parts.Part` (n-gons stay n-gons; bmesh triangulates later like the other stock builders).
    The caller paints the whole primitive with prim()."""
    p.seal()
    bm = p.bm
    for pts, role in solid.f:
        vs = [bm.verts.new(Vector(q)) for q in pts]
        try:
            bm.faces.new(vs)
        except ValueError:
            pass
