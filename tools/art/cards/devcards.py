# Development-card still lifes, built with the same pipeline and look as the resource cards.
#   python3.11 devcards.py <knight|road|plenty|monopoly|vp|all> <outdir> [width=600] [samples=128]
import math, random
import bpy, bmesh
from mathutils import Vector, Matrix, noise
import cards as C
from cards import TAU, T1, T2, M1, M2


# ───────────────────────── shared bits ─────────────────────────
def plank_table(size=6.0, scale=0.8, tint=(1, 1, 1), fade=(0.9, 3.0), fade_to=0.25, base='weathered_brown_planks', rot=0.0):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for lp in f.loops:
            lp[uvl].uv = ((lp.vert.co.x + size / 2) / size, (lp.vert.co.y + size / 2) / size)
    m, g = C.material('Table')
    vec = g.coords('UV', scale=(size * scale, size * scale, 1), rot=(0, 0, rot))
    b = T2 + f'{base}/{base}_'
    d = g.tex(b + 'diff_1k.jpg', vec)
    n = g.tex(b + 'nor_gl_1k.jpg', vec, data=True)
    arm = g.tex(b + 'arm_1k.jpg', vec, data=True)
    sep = g.n('ShaderNodeSeparateColor')
    g.ln(arm.outputs['Color'], sep.inputs['Color'])
    col = g.mix(1.0, d.outputs['Color'], tint, blend='MULTIPLY')
    col = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', 1.0, sep.outputs['Red']), 0.6), col, (0, 0, 0))
    tc = g.n('ShaderNodeTexCoord')
    dist = g.vmath('LENGTH', g.vmath('MULTIPLY', tc.outputs['Object'], (1, 1, 0)))
    fd = g.smooth(dist, fade[0], fade[1])
    col = g.mix(g.math('MULTIPLY', fd, 1 - fade_to), col, (0, 0, 0))
    p = g.principled(Base_Color=col, Roughness=sep.outputs['Green'], Normal=g.normal_map(n.outputs['Color'], 1.0, uv='UVMap'))
    p.inputs['Specular IOR Level'].default_value = 0.4
    g.output(p.outputs[0])
    return C.mesh_obj('Table', bm, [m])


def metal(name, color, rough=0.25, scratch=0.12, scale=40.0, dark=0.55):
    m, g = C.material(name)
    tc = g.n('ShaderNodeTexCoord')
    nz = g.noise(tc.outputs['Object'], scale=scale, detail=8, rough=0.6)
    sc = g.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z')
    g.s(sc, Vector=tc.outputs['Object'], Scale=scale * 6, Distortion=8.0, Detail=4.0)
    r = g.math('ADD', rough, g.math('MULTIPLY', g.math('SUBTRACT', nz.outputs['Fac'], 0.5), scratch))
    r = g.math('ADD', r, g.math('MULTIPLY', sc.outputs['Fac'], scratch * 0.5))
    base = g.mix(g.math('MULTIPLY', g.smooth(nz.outputs['Fac'], 0.55, 0.8), 0.35), tuple(color), tuple(c * dark for c in color))
    p = g.principled(Base_Color=base, Metallic=1.0, Roughness=r)
    g.output(p.outputs[0])
    return m


def plain(name, color, rough=0.5, metallic=0.0, sheen=0.0, sss=0.0, transmission=0.0, ior=1.45, emission=None):
    m, g = C.material(name)
    p = g.principled(Base_Color=tuple(color), Roughness=rough, Metallic=metallic)
    if sheen:
        p.inputs['Sheen Weight'].default_value = sheen
        p.inputs['Sheen Roughness'].default_value = 0.4
    if sss:
        p.inputs['Subsurface Weight'].default_value = sss
    if transmission:
        p.inputs['Transmission Weight'].default_value = transmission
        p.inputs['IOR'].default_value = ior
    if emission:
        p.inputs['Emission Color'].default_value = tuple(emission[0]) + (1,)
        p.inputs['Emission Strength'].default_value = emission[1]
    g.output(p.outputs[0])
    return m


def bbox(name, dims, mats, bevel=0.0015, segs=2, at=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dims[0], v.co.y * dims[1], v.co.z * dims[2]))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
    o = C.mesh_obj(name, bm, mats)
    o.location = at
    return o


def cyl(name, r, h, mats, segs=32, at=(0, 0, 0), r2=None, caps=True, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
    for f in bm.faces:
        f.smooth = smooth and len(f.verts) == 4
    o = C.mesh_obj(name, bm, mats)
    o.location = at
    return o


def ball(name, r, mats, scale=(1, 1, 1), at=(0, 0, 0), segs=24, rings=14):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    for f in bm.faces:
        f.smooth = True
    o = C.mesh_obj(name, bm, mats)
    o.location = at
    return o


def group(name, children, loc=(0, 0, 0), rot=(0, 0, 0)):
    e = C.link(bpy.data.objects.new(name, None))
    for c in children:
        c.parent = e
    e.location = loc
    e.rotation_euler = rot
    return e


def finish(name, CAM, TGT, fogc, fstop=2.8, focus_back=0.0, exposure=0.0, look=None, start=3.4, amount=0.8, depth=10.0):
    C.camera(CAM, TGT, lens=85, fstop=fstop, focus=(Vector(TGT) - Vector(CAM)).length - focus_back)
    C.fog(fogc, start=start, depth=depth, amount=amount)
    s = bpy.context.scene
    s.view_settings.exposure = exposure
    if look:
        s.view_settings.look = look
    C.render(name)


# ───────────────────────── knight: sword and shield before the castle ─────────────────────────
def sword(steel, brass, leather):
    bm = bmesh.new()
    L, W0, T0, N = 0.8, 0.026, 0.0045, 48
    rings = []
    for i in range(N + 1):
        t = i / N
        z = t * L * 0.965
        w = W0 * (1 - 0.32 * t) if t < 0.84 else W0 * 0.68 * max(0.0, 1 - (t - 0.84) / 0.16) ** 0.85
        w = max(w, 0.0008)
        th = max(T0 * (1 - 0.35 * t) * (w / W0) ** 0.3, 0.0004)
        pts = [(w, 0), (w * 0.5, th), (-w * 0.5, th), (-w, 0), (-w * 0.5, -th), (w * 0.5, -th)]
        rings.append([bm.verts.new((x, y, z)) for x, y in pts])
    tip = bm.verts.new((0, 0, L))
    for i in range(N):
        for k in range(6):
            k2 = (k + 1) % 6
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    for k in range(6):
        bm.faces.new((rings[N][k], rings[N][(k + 1) % 6], tip))
    bm.faces.new(list(reversed(rings[0])))
    blade = C.mesh_obj('Blade', bm, [steel])
    guard = bbox('Guard', (0.19, 0.024, 0.02), [brass], bevel=0.004, at=(0, 0, -0.01))
    knot = bbox('GuardCore', (0.034, 0.03, 0.034), [brass], bevel=0.005, at=(0, 0, -0.012))
    grip = cyl('Grip', 0.0135, 0.11, [leather], segs=24, at=(0, 0, -0.075))
    pommel = ball('Pommel', 0.022, [brass], scale=(1.0, 0.8, 0.9), at=(0, 0, -0.142))
    return [blade, guard, knot, grip, pommel]


def leather_material(name, color):
    m, g = C.material(name)
    tc = g.n('ShaderNodeTexCoord')
    wv = g.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z')
    g.s(wv, Vector=tc.outputs['Object'], Scale=90.0, Distortion=1.5, Detail=1.0)
    nz = g.noise(tc.outputs['Object'], scale=300.0, detail=4)
    h = g.math('ADD', wv.outputs['Fac'], g.math('MULTIPLY', nz.outputs['Fac'], 0.3))
    p = g.principled(Base_Color=tuple(color), Roughness=0.6, Normal=g.bump(h, 0.6, 0.001))
    g.output(p.outputs[0])
    return m


def shield(R=0.26, dome=0.028):
    """Round wooden shield: planked board under chipped red paint with a pale cross, iron rim and boss."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    K, S = 18, 96
    centre = bm.verts.new((0, 0, dome))
    rings = []
    for k in range(1, K + 1):
        r = R * k / K
        rings.append([bm.verts.new((r * math.cos(TAU * i / S), r * math.sin(TAU * i / S), dome * (1 - (r / R) ** 2))) for i in range(S)])
    faces = []
    for i in range(S):
        faces.append(bm.faces.new((centre, rings[0][i], rings[0][(i + 1) % S])))
    for k in range(K - 1):
        for i in range(S):
            i2 = (i + 1) % S
            faces.append(bm.faces.new((rings[k][i], rings[k + 1][i], rings[k + 1][i2], rings[k][i2])))
    for f in faces:
        f.smooth = True
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.x / (2 * R) + 0.5, lp.vert.co.y / (2 * R) + 0.5)
    m, g = C.material('ShieldFace')
    vec = g.coords(uv='UVMap', rot=(0, 0, math.pi / 2))
    b = T2 + 'weathered_brown_planks/weathered_brown_planks_'
    d = g.tex(b + 'diff_1k.jpg', vec)
    n = g.tex(b + 'nor_gl_1k.jpg', vec, data=True)
    tc = g.n('ShaderNodeTexCoord')
    sep = g.n('ShaderNodeSeparateXYZ')
    g.ln(tc.outputs['Object'], sep.inputs['Vector'])
    # a gold bend (diagonal band) on deep red: plain heraldry, not any real arms or flag
    diag = g.math('ABSOLUTE', g.math('ADD', sep.outputs['X'], sep.outputs['Y']))
    band = g.math('LESS_THAN', diag, 0.06)
    paint = g.mix(band, (0.3, 0.02, 0.025), (0.72, 0.5, 0.16))
    rad = g.vmath('LENGTH', g.vmath('MULTIPLY', tc.outputs['Object'], (1, 1, 0)))
    wear = g.noise(tc.outputs['Object'], scale=14.0, detail=6, rough=0.65)
    chip = g.math('ADD', g.smooth(wear.outputs['Fac'], 0.6, 0.66), g.smooth(rad, R * 0.86, R * 0.97))
    chip = g.math('MINIMUM', chip, 1.0)
    col = g.mix(chip, paint, d.outputs['Color'])
    p = g.principled(Base_Color=col, Roughness=g.math('ADD', 0.5, g.math('MULTIPLY', chip, 0.32)),
                     Normal=g.normal_map(n.outputs['Color'], 0.8, uv='UVMap'))
    g.output(p.outputs[0])
    board = C.mesh_obj('Shield', bm, [m])
    sol = board.modifiers.new('Thick', 'SOLIDIFY')
    sol.thickness = 0.018
    sol.offset = -1
    iron = metal('Iron', (0.16, 0.16, 0.17), rough=0.45, scratch=0.18, dark=0.5)
    cu = bpy.data.curves.new('Rim', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.012
    cu.bevel_resolution = 3
    sp = cu.splines.new('POLY')
    sp.points.add(S - 1)
    for i in range(S):
        sp.points[i].co = (R * math.cos(TAU * i / S), R * math.sin(TAU * i / S), -0.004, 1)
    sp.use_cyclic_u = True
    rim = C.link(bpy.data.objects.new('Rim', cu))
    rim.data.materials.append(iron)
    boss = ball('Boss', 0.07, [iron], scale=(1, 1, 0.55), at=(0, 0, dome))
    parts = [board, rim, boss]
    for i in range(16):
        a = TAU * (i + 0.5) / 16
        rr = R - 0.03
        parts.append(ball(f'Rivet{i}', 0.0075, [iron], scale=(1, 1, 0.6), at=(rr * math.cos(a), rr * math.sin(a), dome * (1 - (rr / R) ** 2) + 0.002), segs=10, rings=6))
    return parts


def scene_knight():
    s = C.reset()
    C.world(0.8, rot=3.4, tint=(0.9, 0.95, 1.1))
    rnd = random.Random(5)
    CAM, TGT = (-1.05, -3.1, 0.24), (0.02, 0.0, 0.43)
    steel = metal('Steel', (0.6, 0.62, 0.66), rough=0.2, scratch=0.14)
    brass = metal('Brass', (0.78, 0.56, 0.26), rough=0.3, scratch=0.15)
    leather = leather_material('Leather', (0.09, 0.045, 0.025))
    sw = group('Sword', sword(steel, brass, leather))
    # driven point-first into the turf behind the shield
    sw.location = (-0.07, 0.1, 0.64)
    sw.rotation_euler = (math.pi + 0.06, 0.05, 0.5)
    sh = group('ShieldG', shield())
    sh.location = (0.1, -0.05, 0.255)
    sh.rotation_euler = (math.radians(70), 0, -0.62)
    C.grass_patch('Grass', 3.0, 60000, length=0.055, seed=3, center=(0.2, 1.0), focus=(0.0, 0.0, 0.8, 2.6), children=4)
    C.ground('leafy_grass', scale=1.0, tint=(0.62, 0.7, 0.5), fade=(1.0, 14.0), fade_to=0.4, size=400.0)
    # the castle on the hill behind
    f, right = C.view_basis(CAM, TGT)
    fort = [o for o in C.import_gltf(M2 + 'modular_fort_01/modular_fort_01_1k.gltf') if o.type == 'MESH']
    keep = {'modular_fort_01_tower_round': (105.0, 9.0, 0.0), 'modular_fort_01_wall_thick_straight_01': (108.0, -9.0, 1.6),
            'modular_fort_01_wall_thin_gate_01': (106.0, 28.0, 1.4), 'modular_fort_01_wall_thick_corner_01': (111.0, -25.0, 0.9)}
    for o in fort:
        if o.name not in keep:
            bpy.data.objects.remove(o)
            continue
        dist, side, yaw = keep[o.name]
        bb = [Vector(c) for c in o.bound_box]
        cen = sum(bb, Vector()) / 8
        o.data.transform(Matrix.Translation((-cen.x, -cen.y, 0)))
        p = Vector(CAM) + f * dist + right * side
        o.location = (p.x, p.y, 0.0)
        o.rotation_euler = (0, 0, yaw)
        o.scale = (2.0, 2.0, 2.0)
    flag_m = plain('Flag', (0.42, 0.03, 0.03), rough=0.7, sheen=0.6)
    p = Vector(CAM) + f * 105.0 + right * 9.0
    pole = cyl('Pole', 0.16, 10.0, [plain('PoleWood', (0.12, 0.08, 0.05), 0.7)], at=(p.x, p.y, 27.0 + 5.0))
    bmf = bmesh.new()
    bmesh.ops.create_grid(bmf, x_segments=16, y_segments=6, size=1.0)
    for v in bmf.verts:
        u = (v.co.x + 1) / 2
        v.co = Vector((u * 3.6, 0.35 * math.sin(u * 5.0) * u, (v.co.y + 1) / 2 * 2.0))
    flag = C.mesh_obj('Banner', bmf, [flag_m])
    flag.location = (p.x, p.y, 32.0)
    flag.scale = (2.0, 2.0, 2.0)
    flag.rotation_euler = (0, 0, math.atan2(right.y, right.x))
    C.backdrop_behind(CAM, TGT, 170.0, (0.82, 0.86, 0.92), (0.46, 0.52, 0.62), w=260, h=140, lift=30.0, glow=(-20.0, 4.0), radius=110.0)
    C.sun('Sun', (-2.5, 3.0, 1.6), 3.0, (1.0, 0.86, 0.68), angle=0.03)
    C.area('Key', (1.4, -1.7, 1.5), (0, 0, 0.35), 1.3, 26, (1.0, 0.94, 0.88))
    C.area('Fill', (-1.6, -1.4, 0.7), (0, 0, 0.35), 1.4, 6, (0.8, 0.88, 1.0))
    finish('dev_knight', CAM, TGT, (0.66, 0.71, 0.78), fstop=2.8, focus_back=0.05, start=8.0, amount=0.7, depth=150.0)


# ───────────────────────── road building: a cobbled lane being laid ─────────────────────────
def road_path():
    pts = [Vector((0.05, -1.6)), Vector((0.0, 1.0)), Vector((0.9, 4.6)), Vector((3.2, 9.5))]

    def at(t):
        a, b, c, d = pts
        u = 1 - t
        return a * u ** 3 + b * 3 * u * u * t + c * 3 * u * t * t + d * t ** 3
    return at


def scene_road():
    s = C.reset()
    C.world(0.8, rot=1.4, tint=(1.0, 0.98, 0.92))
    rnd = random.Random(9)
    CAM, TGT = (-0.78, -3.25, 1.06), (0.62, 0.0, 0.06)
    at = road_path()
    # sample the centreline by arc length
    samples = [at(i / 2000) for i in range(2001)]
    acc = [0.0]
    for i in range(1, len(samples)):
        acc.append(acc[-1] + (samples[i] - samples[i - 1]).length)
    total = acc[-1]

    def by_len(sv):
        lo, hi = 0, len(acc) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if acc[mid] < sv:
                lo = mid + 1
            else:
                hi = mid
        i = max(1, lo)
        t = (sv - acc[i - 1]) / max(1e-6, acc[i] - acc[i - 1])
        p = samples[i - 1].lerp(samples[i], t)
        tg = (samples[i] - samples[i - 1]).normalized()
        return p, tg
    W, TILE = 1.15, 0.85
    NL, NW = 520, 64
    hs = C.height_sampler(T2 + 'cobblestone_floor_08/cobblestone_floor_08_diff_1k.jpg')
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    grid = []
    for i in range(NL + 1):
        sv = total * i / NL
        p, tg = by_len(sv)
        nrm = Vector((-tg.y, tg.x))
        row = []
        for j in range(NW + 1):
            u = j / NW - 0.5
            q = p + nrm * u * W
            edge = abs(u) * 2
            h = 0.022 * (1 - edge ** 2) - 0.012 * max(0.0, edge - 0.9) * 10
            h += 0.011 * max(-1.6, min(1.6, hs((u + 0.5) * W / TILE, sv / TILE)))
            row.append((bm.verts.new((q.x, q.y, h)), ((u + 0.5) * W / TILE, sv / TILE)))
        grid.append(row)
    for i in range(NL):
        for j in range(NW):
            f = bm.faces.new((grid[i][j][0], grid[i][j + 1][0], grid[i + 1][j + 1][0], grid[i + 1][j][0]))
            f.smooth = True
            for lp, (a, b) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                lp[uvl].uv = grid[a][b][1]
    m, g = C.material('Cobbles')
    vec = g.coords(uv='UVMap')
    b = T2 + 'cobblestone_floor_08/cobblestone_floor_08_'
    d = g.tex(b + 'diff_1k.jpg', vec)
    n = g.tex(b + 'nor_gl_1k.jpg', vec, data=True)
    arm = g.tex(b + 'arm_1k.jpg', vec, data=True)
    sep = g.n('ShaderNodeSeparateColor')
    g.ln(arm.outputs['Color'], sep.inputs['Color'])
    col = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', 1.0, sep.outputs['Red']), 0.6), d.outputs['Color'], (0, 0, 0))
    col = g.mix(1.0, col, (0.72, 0.68, 0.62), blend='MULTIPLY')
    p = g.principled(Base_Color=col, Roughness=sep.outputs['Green'], Normal=g.normal_map(n.outputs['Color'], 1.2, uv='UVMap'))
    g.output(p.outputs[0])
    C.mesh_obj('Road', bm, [m])

    def road_mask(x, y):
        best = 9.0
        for k in range(0, len(samples), 20):
            dd = (Vector((x, y)) - samples[k]).length
            if dd < best:
                best = dd
        return max(0.0, min(1.0, (best - W / 2 - 0.02) / 0.12))
    # granite setts waiting in a heap beside the road, a few already set loose on it
    granite = granite_material()
    heap = []
    for i in range(26):
        o = C.brick_mesh(f'Sett{i}', [granite], dims=(rnd.uniform(0.09, 0.12), rnd.uniform(0.075, 0.095), rnd.uniform(0.07, 0.085)),
                         seed=400 + i, bevel=0.006, cuts=3, rough=0.0018, chips=4)
        a = i * 2.39
        rr = 0.04 + 0.13 * ((i * 0.61) % 1.0)
        o.location = (0.95 + math.cos(a) * rr, -0.05 + math.sin(a) * rr, 0.12 + i * 0.055)
        o.rotation_euler = (rnd.uniform(0, TAU), rnd.uniform(0, TAU), rnd.uniform(0, TAU))
        heap.append(o)
    for i, (x, y, rz) in enumerate([(0.36, -0.34, 0.4), (0.5, -0.12, 1.2), (0.28, 0.12, 2.4)]):
        o = C.brick_mesh(f'Loose{i}', [granite], dims=(0.11, 0.085, 0.078), seed=480 + i, bevel=0.006, cuts=3, rough=0.0018, chips=4)
        o.location = (x, y, 0.16)
        o.rotation_euler = (0, 0, rz)
        heap.append(o)
    gb = bmesh.new()
    bmesh.ops.create_cube(gb, size=1.0, matrix=Matrix.Translation((0, 0, -0.05)) @ Matrix.Diagonal((12, 12, 0.1, 1)))
    floor = C.mesh_obj('Floor', gb, [])
    road_obj = bpy.data.objects['Road']
    C.simulate([floor, road_obj], heap, frames=120)
    bpy.data.objects.remove(floor)
    # a paviour's mallet resting against the heap
    wood = plain('MalletWood', (0.3, 0.2, 0.11), rough=0.6)
    head = cyl('MalletHead', 0.055, 0.17, [wood_material()], segs=32)
    head.rotation_euler = (0, math.pi / 2, 0)
    handle = cyl('MalletHandle', 0.014, 0.62, [wood], segs=16, at=(0, 0, 0.31))
    mallet = group('Mallet', [head, handle])
    head.location = (0, 0, 0.0)
    mallet.location = (0.62, -0.42, 0.056)
    mallet.rotation_euler = (math.radians(95), 0, 0.9)
    C.grass_patch('Grass', 3.2, 70000, length=0.06, seed=7, center=(0.4, 1.2), focus=(0.3, 0.0, 0.8, 2.8), children=4, mask=road_mask)
    C.ground('leafy_grass', scale=1.0, tint=(0.62, 0.7, 0.5), fade=(1.0, 14.0), fade_to=0.4, size=60.0)
    # poplars along the lane
    bark = C.bark_material()
    endg = C.endgrain_material()
    for k, (sv, side) in enumerate([(3.2, -1.3), (5.0, 1.4), (6.6, -1.4), (8.2, 1.5), (9.6, -1.5)]):
        p, tg = by_len(min(total - 0.01, sv))
        q = p + Vector((-tg.y, tg.x)) * side
        o = C.log_mesh(f'Poplar{k}', 0.16, 8.0, seed=600 + k, mats=[bark, endg], segs=48, rings=24, tile=0.45,
                       bark_img=T2 + 'bark_brown_01/bark_brown_01_diff_1k.jpg', relief=0.01)
        o.location = (q.x, q.y, 3.6)
    C.backdrop_behind(CAM, TGT, 40.0, (0.5, 0.6, 0.42), (0.14, 0.18, 0.1), w=70, h=40, lift=6.0, glow=(4.0, 4.0), radius=28.0)
    C.sun('Sun', (2.6, 3.4, 1.7), 2.6, (1.0, 0.84, 0.62), angle=0.04)
    C.area('Key', (-1.6, -1.4, 1.6), (0.4, 0, 0.1), 1.3, 22, (1.0, 0.93, 0.85))
    C.area('Fill', (1.6, -1.8, 0.8), (0.4, 0, 0.1), 1.4, 5, (0.85, 0.9, 1.0))
    finish('dev_road', CAM, TGT, (0.3, 0.36, 0.26), fstop=2.8, focus_back=0.15, start=3.6, amount=0.7)


def granite_material():
    m, g = C.material('Granite')
    tc = g.n('ShaderNodeTexCoord')
    info = g.n('ShaderNodeObjectInfo')
    ofs = g.n('ShaderNodeCombineXYZ')
    g.s(ofs, X=g.math('MULTIPLY', info.outputs['Random'], 61.0), Y=g.math('MULTIPLY', info.outputs['Random'], 37.0), Z=0.0)
    p = g.vmath('ADD', tc.outputs['Object'], ofs.outputs['Vector'])
    vor = g.n('ShaderNodeTexVoronoi', feature='F1')
    g.s(vor, Vector=p, Scale=420.0, Randomness=1.0)
    grains = vor.outputs['Color']
    base = g.ramp(info.outputs['Random'], [(0.0, (0.17, 0.165, 0.16)), (0.5, (0.23, 0.22, 0.2)), (1.0, (0.3, 0.26, 0.22))])
    speck = g.ramp(g.math('MULTIPLY', g.vmath('LENGTH', grains), 0.6),
                   [(0.0, (0.06, 0.06, 0.065)), (0.35, (0.5, 0.5, 0.5)), (0.7, (0.95, 0.93, 0.9)), (1.0, (0.7, 0.6, 0.55))])
    col = g.mix(0.45, base, speck, blend='MULTIPLY')
    col = g.mix(0.35, col, speck)
    dirt = g.noise(p, scale=9.0, detail=4)
    col = g.mix(g.math('MULTIPLY', g.smooth(dirt.outputs['Fac'], 0.5, 0.7), 0.5), col, (0.16, 0.13, 0.1))
    bump = g.noise(p, scale=160.0, detail=4)
    pr = g.principled(Base_Color=col, Roughness=0.72, Normal=g.bump(bump.outputs['Fac'], 0.35, 0.0015))
    g.output(pr.outputs[0])
    return m


def wood_material():
    m, g = C.material('TurnedWood')
    vec = g.coords('Object', scale=(6.0, 6.0, 6.0))
    d = g.tex(T2 + 'rough_wood/rough_wood_diff_1k.jpg', vec)
    p = g.principled(Base_Color=g.mix(1.0, d.outputs['Color'], (0.8, 0.66, 0.5), blend='MULTIPLY'), Roughness=0.7)
    g.output(p.outputs[0])
    return m


# ───────────────────────── year of plenty: a harvest basket ─────────────────────────
def apple(name, mats, seed, r=0.038):
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=36, v_segments=20, radius=r)
    off = Vector((rnd.uniform(-9, 9), rnd.uniform(-9, 9), rnd.uniform(-9, 9)))
    for v in bm.verts:
        n = v.co.normalized()
        top = max(0.0, n.z)
        bot = max(0.0, -n.z)
        rr = r * (1 + 0.05 * noise.noise(n * 1.5 + off) + 0.06 * (1 - abs(n.z)))
        v.co = n * rr
        v.co.z *= 0.88
        v.co.z -= r * 0.32 * math.exp(-((1 - top) / 0.035)) if top > 0.8 else 0.0
        v.co.z += r * 0.18 * math.exp(-((1 - bot) / 0.05)) if bot > 0.85 else 0.0
    for f in bm.faces:
        f.smooth = True
    o = C.mesh_obj(name, bm, mats)
    cu = bpy.data.curves.new(name + 'Stem', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.0022
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(2)
    tip = (rnd.uniform(-0.006, 0.006), rnd.uniform(-0.006, 0.006))
    for bp, pt in zip(sp.bezier_points, [(0, 0, r * 0.58), (tip[0] * 0.5, tip[1] * 0.5, r * 0.85), (tip[0], tip[1], r * 1.1)]):
        bp.co = pt
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    st = C.link(bpy.data.objects.new(name + 'Stem', cu))
    st.data.materials.append(bpy.data.materials.get('Stem') or plain('Stem', (0.1, 0.07, 0.03), 0.8))
    st.parent = o
    return o


def apple_material():
    m, g = C.material('Apple')
    tc = g.n('ShaderNodeTexCoord')
    info = g.n('ShaderNodeObjectInfo')
    ofs = g.n('ShaderNodeCombineXYZ')
    g.s(ofs, X=g.math('MULTIPLY', info.outputs['Random'], 41.0), Y=g.math('MULTIPLY', info.outputs['Random'], 17.0), Z=0.0)
    p = g.vmath('ADD', tc.outputs['Object'], ofs.outputs['Vector'])
    sep = g.n('ShaderNodeSeparateXYZ')
    g.ln(tc.outputs['Object'], sep.inputs['Vector'])
    streak = g.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z')
    g.s(streak, Vector=g.vmath('MULTIPLY', p, (1.0, 1.0, 0.25)), Scale=90.0, Distortion=6.0, Detail=2.0)
    blush = g.noise(p, scale=18.0, detail=3)
    red = g.mix(streak.outputs['Fac'], (0.32, 0.015, 0.012), (0.5, 0.05, 0.02))
    yellow = (0.62, 0.42, 0.06)
    k = g.math('ADD', g.smooth(blush.outputs['Fac'], 0.3, 0.6), g.math('MULTIPLY', g.math('SUBTRACT', info.outputs['Random'], 0.5), 0.6))
    col = g.mix(g.math('MINIMUM', g.math('MAXIMUM', k, 0.0), 1.0), yellow, red)
    vor = g.n('ShaderNodeTexVoronoi', feature='F1')
    g.s(vor, Vector=p, Scale=320.0)
    dots = g.math('SUBTRACT', 1.0, g.smooth(vor.outputs['Distance'], 0.02, 0.07))
    col = g.mix(g.math('MULTIPLY', dots, 0.5), col, (0.72, 0.55, 0.25))
    pr = g.principled(Base_Color=col, Roughness=0.33)
    pr.inputs['Subsurface Weight'].default_value = 0.08
    pr.inputs['Coat Weight'].default_value = 0.3
    pr.inputs['Coat Roughness'].default_value = 0.25
    g.output(pr.outputs[0])
    return m


def scene_plenty():
    s = C.reset()
    C.world(0.6, rot=2.0, tint=(1.1, 1.0, 0.85))
    rnd = random.Random(13)
    CAM, TGT = (-0.72, -1.66, 0.72), (-0.03, 0.04, 0.12)
    table = plank_table(size=8.0, scale=0.7, tint=(0.78, 0.66, 0.55), fade=(0.9, 3.6), fade_to=0.25, rot=0.3)
    parts = C.import_gltf(M2 + 'wicker_basket_01/wicker_basket_01_1k.gltf')
    basket = [o for o in parts if o.type == 'MESH']
    for o in basket:
        o.scale = (1.3, 1.3, 1.3)
        o.location = (0.0, 0.06, 0.0)
        o.rotation_euler = (0, 0, -0.2)
    am = apple_material()
    apples = []
    for i in range(34):
        o = apple(f'Apple{i}', [am], seed=200 + i, r=rnd.uniform(0.034, 0.042))
        a = i * 2.4
        rr = 0.03 + 0.15 * ((i * 0.37) % 1.0)
        o.location = (math.cos(a) * rr * 1.2, 0.06 + math.sin(a) * rr * 0.8, 0.12 + i * 0.045)
        o.rotation_euler = (rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(0, TAU))
        apples.append(o)
    for i, (x, y) in enumerate([(0.28, -0.24), (0.36, -0.12), (-0.24, -0.27)]):
        o = apple(f'Fallen{i}', [am], seed=260 + i)
        o.location = (x, y, 0.06)
        o.rotation_euler = (rnd.uniform(-1.4, 1.4), rnd.uniform(-1.4, 1.4), 0)
        apples.append(o)
    # the basket's woven floor as a passive dish so the fruit heaps above the rim
    bmf = bmesh.new()
    bmesh.ops.create_cone(bmf, cap_ends=True, segments=32, radius1=0.2, radius2=0.2, depth=0.05,
                          matrix=Matrix.Translation((0, 0.06, 0.05)) @ Matrix.Diagonal((1.2, 0.85, 1.0, 1)))
    filler = C.mesh_obj('Filler', bmf, [])
    gb = bmesh.new()
    bmesh.ops.create_cube(gb, size=1.0, matrix=Matrix.Translation((0, 0, -0.05)) @ Matrix.Diagonal((8, 8, 0.1, 1)))
    floor = C.mesh_obj('Floor', gb, [])
    C.simulate(basket + [filler, floor], apples, frames=110)
    bpy.data.objects.remove(filler)
    bpy.data.objects.remove(floor)
    # a sheaf of wheat laid across the basket, ears spilling over the rim
    straw = C.straw_material('Straw', (0.82, 0.6, 0.27), translucent=0.35)
    earm = C.straw_material('Ear', (0.8, 0.53, 0.18), translucent=0.3, rough=0.5)
    awnm = C.straw_material('Awn', (0.88, 0.68, 0.34), translucent=0.5, rough=0.4)
    ears = [C.ear_mesh(f'EarSrc{i}', [earm, awnm], seed=700 + i) for i in range(3)]
    for e in ears:
        e.hide_render = True
        e.location = (0, 0, -5)
    splines = []
    for i in range(22):
        y0 = rnd.uniform(-0.02, 0.06)
        z0 = rnd.uniform(0.17, 0.2)
        A = Vector((-0.3, y0 + 0.1, 0.16 + rnd.uniform(-0.01, 0.01)))
        B = Vector((0.04 + rnd.uniform(-0.03, 0.03), y0 + rnd.uniform(-0.02, 0.02), z0 + 0.02))
        E = Vector((0.24 + rnd.uniform(-0.03, 0.04), y0 - 0.12 + rnd.uniform(-0.05, 0.05), 0.17 + rnd.uniform(-0.02, 0.02)))
        splines.append([A, B, E])
        C.place_ear(f'Ear{i}', ears, E, (E - B).normalized() + Vector((0, 0, -0.3)), rnd, scale=1.1)
    C.stalk_curve('Sheaf', straw, splines)
    C.backdrop_behind(CAM, TGT, 9.0, (0.42, 0.26, 0.12), (0.05, 0.03, 0.02), w=24, h=14, lift=1.5, glow=(1.0, 0.6), radius=6.0)
    C.bokeh([((rnd.uniform(-2.5, 2.5), rnd.uniform(4.5, 6.0), rnd.uniform(0.6, 2.4)), rnd.uniform(0.8, 1.6)) for _ in range(16)],
            (1.0, 0.7, 0.35), 10.0, radius=0.035)
    C.area('Key', (-1.2, -1.2, 1.6), (0, 0, 0.1), 1.0, 26, (1.0, 0.86, 0.68))
    C.area('Rim', (1.0, 1.2, 1.0), (0, 0, 0.12), 0.8, 16, (1.0, 0.8, 0.6))
    C.area('Fill', (1.2, -1.5, 0.5), (0, 0, 0.1), 1.4, 4, (0.85, 0.9, 1.0))
    finish('dev_plenty', CAM, TGT, (0.12, 0.07, 0.04), fstop=2.6, focus_back=0.08, start=3.2, amount=0.6)


# ───────────────────────── monopoly: the merchant's gold ─────────────────────────
def coin_material():
    m, g = C.material('Gold')
    tc = g.n('ShaderNodeTexCoord')
    sep = g.n('ShaderNodeSeparateXYZ')
    g.ln(tc.outputs['Object'], sep.inputs['Vector'])
    R = 0.024
    r = g.math('DIVIDE', g.vmath('LENGTH', g.vmath('MULTIPLY', tc.outputs['Object'], (1, 1, 0))), R)
    ang = g.math('ARCTAN2', sep.outputs['Y'], sep.outputs['X'])
    ring = g.math('MULTIPLY', g.smooth(r, 0.78, 0.82), g.math('SUBTRACT', 1.0, g.smooth(r, 0.86, 0.9)))
    star_r = g.math('MULTIPLY', 0.42, g.math('ADD', 0.62, g.math('MULTIPLY', 0.38, g.math('COSINE', g.math('MULTIPLY', ang, 5.0)))))
    star = g.math('SUBTRACT', 1.0, g.smooth(g.math('SUBTRACT', r, star_r), -0.02, 0.02))
    dots = g.math('MULTIPLY', g.smooth(g.math('ABSOLUTE', g.math('SINE', g.math('MULTIPLY', ang, 18.0))), 0.86, 0.98),
                  g.math('MULTIPLY', g.smooth(r, 0.62, 0.65), g.math('SUBTRACT', 1.0, g.smooth(r, 0.7, 0.73))))
    h = g.math('ADD', g.math('ADD', ring, star), dots)
    wear = g.noise(tc.outputs['Object'], scale=500.0, detail=6)
    col = g.mix(g.math('MULTIPLY', g.smooth(wear.outputs['Fac'], 0.45, 0.75), 0.4), (1.0, 0.74, 0.32), (0.62, 0.4, 0.14))
    pr = g.principled(Base_Color=col, Metallic=1.0, Roughness=g.math('ADD', 0.2, g.math('MULTIPLY', wear.outputs['Fac'], 0.15)),
                      Normal=g.bump(h, 0.6, 0.0006))
    g.output(pr.outputs[0])
    return m


def coin(name, mat, R=0.024, T=0.0032):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=48, radius1=R, radius2=R, depth=T)
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.calc_face_angle(0) > 0.5], offset=0.0006, segments=2, affect='EDGES', clamp_overlap=True)
    for f in bm.faces:
        f.smooth = len(f.verts) == 4
    return C.mesh_obj(name, bm, [mat])


def scene_monopoly():
    s = C.reset()
    C.world(0.35, rot=0.8, tint=(1.0, 0.95, 0.9))
    rnd = random.Random(17)
    CAM, TGT = (-0.51, -1.4, 0.46), (0.08, 0.04, 0.07)
    plank_table(size=8.0, scale=0.7, tint=(0.42, 0.3, 0.22), fade=(0.7, 2.8), fade_to=0.15, rot=0.1)
    gold = coin_material()
    T = 0.0032
    proto = coin('CoinSrc', gold)
    proto.location = (0, 0, -3)
    proto.hide_render = True
    k = 0
    for (x, y, n) in [(-0.1, -0.02, 11), (-0.05, 0.05, 7), (0.0, -0.06, 14), (0.06, 0.03, 5), (-0.15, 0.06, 4)]:
        for i in range(n):
            o = C.link(bpy.data.objects.new(f'Coin{k}', proto.data))
            o.location = (x + rnd.uniform(-0.0015, 0.0015), y + rnd.uniform(-0.0015, 0.0015), T / 2 + i * (T + 0.0001))
            o.rotation_euler = (rnd.uniform(-0.02, 0.02), rnd.uniform(-0.02, 0.02), rnd.uniform(0, TAU))
            k += 1
    for i in range(10):
        o = C.link(bpy.data.objects.new(f'Loose{i}', proto.data))
        a = rnd.uniform(0, TAU)
        rr = rnd.uniform(0.1, 0.24)
        tilt = rnd.uniform(0.0, 0.35) if i % 3 == 0 else 0.0
        o.location = (math.cos(a) * rr * 1.2, -0.08 + math.sin(a) * rr * 0.6, T / 2 + 0.019 * math.sin(tilt))
        o.rotation_euler = (tilt, 0, rnd.uniform(0, TAU))
    # a brass balance, one pan weighed down with gold
    brass = metal('Brass', (0.8, 0.6, 0.3), rough=0.28, scratch=0.12)
    X0, Y0 = 0.17, 0.12
    cyl('ScaleBase', 0.06, 0.018, [brass], segs=48, at=(X0, Y0, 0.009))
    cyl('ScaleFoot', 0.035, 0.03, [brass], segs=48, at=(X0, Y0, 0.033))
    cyl('ScaleColumn', 0.007, 0.34, [brass], segs=24, at=(X0, Y0, 0.2))
    ball('ScaleFinial', 0.012, [brass], at=(X0, Y0, 0.385))
    tiltb = math.radians(7)
    beam_len = 0.36
    beam = bbox('Beam', (beam_len, 0.01, 0.012), [brass], bevel=0.002, at=(X0, Y0, 0.36))
    beam.rotation_euler = (0, tiltb, 0)
    for side in (-1, 1):
        ex = X0 + side * beam_len / 2 * math.cos(tiltb)
        ez = 0.36 - side * beam_len / 2 * math.sin(tiltb)
        pan_z = ez - 0.2
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=16, radius=0.075)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > -0.035], context='VERTS')
        for v in bm.verts:
            v.co.z = (v.co.z + 0.035) * 0.6
        for f in bm.faces:
            f.smooth = True
        pan = C.mesh_obj(f'Pan{side}', bm, [brass])
        pan.modifiers.new('Thick', 'SOLIDIFY').thickness = 0.0025
        pan.location = (ex, Y0, pan_z + 0.01)
        for c in range(3):
            a = TAU * c / 3 + 0.4
            px, py = ex + 0.045 * math.cos(a), Y0 + 0.045 * math.sin(a)
            top = Vector((ex, Y0, ez))
            bot = Vector((px, py, pan_z + 0.012))
            mid = (top + bot) / 2
            dvec = top - bot
            ch = cyl(f'Chain{side}{c}', 0.0011, dvec.length, [brass], segs=6, at=tuple(mid))
            ch.rotation_euler = dvec.to_track_quat('Z', 'Y').to_euler()
        if side == 1:
            for i in range(4):
                o = C.link(bpy.data.objects.new(f'PanCoin{i}', proto.data))
                o.location = (ex + rnd.uniform(-0.012, 0.012), Y0 + rnd.uniform(-0.012, 0.012), pan_z - 0.011 + i * T)
                o.rotation_euler = (rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), rnd.uniform(0, TAU))
    # a tallow candle lights the counting table
    wax = plain('Wax', (0.85, 0.78, 0.62), rough=0.45, sss=0.4)
    cx, cy = -0.2, 0.34
    cyl('Candle', 0.018, 0.12, [wax], segs=32, at=(cx, cy, 0.06))
    cyl('Holder', 0.04, 0.008, [brass], segs=40, at=(cx, cy, 0.004))
    flame = ball('Flame', 0.006, [plain('FlameM', (1, 0.6, 0.2), emission=((1.0, 0.62, 0.22), 40.0))], scale=(1, 1, 2.2), at=(cx, cy, 0.136))
    flame.visible_shadow = False
    C.point('CandleLight', (cx, cy, 0.15), 6.0, (1.0, 0.6, 0.25), radius=0.01)
    C.backdrop_behind(CAM, TGT, 8.0, (0.16, 0.09, 0.045), (0.015, 0.01, 0.008), w=20, h=12, lift=1.4, glow=(-1.2, 0.4), radius=5.0)
    C.bokeh([((rnd.uniform(-2.2, 2.2), rnd.uniform(3.5, 5.0), rnd.uniform(0.4, 1.8)), rnd.uniform(0.8, 1.5)) for _ in range(12)],
            (1.0, 0.68, 0.3), 12.0, radius=0.03)
    C.area('Key', (-1.0, -1.0, 1.3), (0, 0, 0.08), 0.7, 14, (1.0, 0.9, 0.78))
    C.area('Rim', (0.9, 1.0, 0.8), (0, 0, 0.1), 0.6, 10, (0.85, 0.9, 1.0))
    finish('dev_monopoly', CAM, TGT, (0.05, 0.03, 0.02), fstop=2.4, focus_back=0.02, start=2.6, amount=0.6)


# ───────────────────────── victory point: a crown on its cushion ─────────────────────────
def crown(gold, ruby, sapphire, pearl, velvet):
    parts = []
    R, H, TH = 0.082, 0.046, 0.006
    bm = bmesh.new()
    S = 96
    rings = []
    for (rr, z) in ((R, 0.0), (R, H), (R - TH, H), (R - TH, 0.0)):
        rings.append([bm.verts.new((rr * math.cos(TAU * i / S), rr * math.sin(TAU * i / S), z)) for i in range(S)])
    for k in range(4):
        a, b = rings[k], rings[(k + 1) % 4]
        for i in range(S):
            i2 = (i + 1) % S
            f = bm.faces.new((a[i], a[i2], b[i2], b[i]))
            f.smooth = k in (0, 2)
    band = C.mesh_obj('Band', bm, [gold])
    parts.append(band)
    # eight points, each a curved gold leaf ending in a pearl
    for j in range(8):
        a0 = TAU * j / 8
        bm = bmesh.new()
        hgt = 0.05 if j % 2 == 0 else 0.034
        half = TAU / 16 * 0.9
        cols = []
        M = 10
        for i in range(M + 1):
            t = i / M
            a = a0 - half + 2 * half * t
            peak = 1 - abs(2 * t - 1)
            ztop = H + hgt * peak ** 1.6
            col = []
            for (rr, z) in ((R, H - 0.002), (R, ztop), (R - TH * 0.8, ztop), (R - TH * 0.8, H - 0.002)):
                col.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
            cols.append(col)
        for i in range(M):
            for k in range(4):
                k2 = (k + 1) % 4
                bm.faces.new((cols[i][k], cols[i + 1][k], cols[i + 1][k2], cols[i][k2]))
        bm.faces.new(list(reversed(cols[0])))
        bm.faces.new(cols[M])
        pt = C.mesh_obj(f'Point{j}', bm, [gold])
        parts.append(pt)
        parts.append(ball(f'Pearl{j}', 0.0075, [pearl], at=((R - 0.003) * math.cos(a0), (R - 0.003) * math.sin(a0), H + hgt + 0.006), segs=16, rings=10))
        # gems on the band
        ga = a0 + TAU / 16
        gem = ball(f'Gem{j}', 0.0085, [ruby if j % 2 == 0 else sapphire], scale=(1.0, 0.55, 1.25),
                   at=((R + 0.002) * math.cos(ga), (R + 0.002) * math.sin(ga), H * 0.5), segs=20, rings=12)
        gem.rotation_euler = (0, 0, ga + math.pi / 2)
        parts.append(gem)
        parts.append(ball(f'Bezel{j}', 0.0105, [gold], scale=(1.0, 0.4, 1.3),
                          at=((R + 0.0005) * math.cos(ga), (R + 0.0005) * math.sin(ga), H * 0.5), segs=20, rings=12))
        parts[-1].rotation_euler = (0, 0, ga + math.pi / 2)
    # velvet cap and a small orb and cross on top
    cap = ball('Cap', R - TH, [velvet], scale=(1, 1, 0.8), at=(0, 0, H * 0.4))
    parts.append(cap)
    parts.append(ball('Orb', 0.013, [gold], at=(0, 0, H * 0.4 + (R - TH) * 0.8 + 0.01)))
    parts.append(bbox('CrossV', (0.006, 0.006, 0.03), [gold], bevel=0.0012, at=(0, 0, H * 0.4 + (R - TH) * 0.8 + 0.035)))
    parts.append(bbox('CrossH', (0.02, 0.006, 0.006), [gold], bevel=0.0012, at=(0, 0, H * 0.4 + (R - TH) * 0.8 + 0.04)))
    return parts


def scene_vp():
    s = C.reset()
    C.world(0.5, rot=5.0, tint=(1.0, 0.95, 0.9))
    rnd = random.Random(23)
    CAM, TGT = (-0.46, -1.24, 0.5), (0.0, 0.0, 0.13)
    plank_table(size=8.0, scale=0.7, tint=(0.36, 0.24, 0.18), fade=(0.7, 2.6), fade_to=0.12, rot=0.2)
    velvet = plain('Velvet', (0.2, 0.012, 0.02), rough=0.85, sheen=1.0)
    gold = metal('CrownGold', (1.0, 0.76, 0.34), rough=0.18, scratch=0.08, scale=60.0, dark=0.6)
    ruby = plain('Ruby', (0.8, 0.02, 0.05), rough=0.02, transmission=1.0, ior=1.77)
    sapph = plain('Sapphire', (0.04, 0.1, 0.8), rough=0.02, transmission=1.0, ior=1.77)
    pearl = plain('Pearl', (0.9, 0.86, 0.8), rough=0.25, sheen=0.3, sss=0.2)
    # the cushion: a puffed square with gold piping and corner tassels
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=12, use_grid_fill=True)
    for v in bm.verts:
        x, y, z = v.co
        puff = (1 - (2 * x) ** 2) * (1 - (2 * y) ** 2)
        v.co = Vector((x * 0.34, y * 0.34, (z * 0.05 + (0.05 * puff if z > 0 else -0.012 * puff)) + 0.04))
        v.co.z -= 0.012 * math.exp(-(x * x + y * y) / 0.004) if z > 0 else 0.0
    for f in bm.faces:
        f.smooth = True
    cushion = C.mesh_obj('Cushion', bm, [velvet])
    sub = cushion.modifiers.new('Smooth', 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 3
    cord = metal('Cord', (0.85, 0.62, 0.28), rough=0.4, scratch=0.1)
    cu = bpy.data.curves.new('Piping', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.006
    sp = cu.splines.new('POLY')
    corners = [(0.17, 0.17), (-0.17, 0.17), (-0.17, -0.17), (0.17, -0.17)]
    sp.points.add(3)
    for i, (x, y) in enumerate(corners):
        sp.points[i].co = (x, y, 0.04, 1)
    sp.use_cyclic_u = True
    pipe = C.link(bpy.data.objects.new('Piping', cu))
    pipe.data.materials.append(cord)
    for i, (x, y) in enumerate(corners):
        knot = ball(f'Knot{i}', 0.012, [cord], at=(x * 1.02, y * 1.02, 0.04))
    cr = group('Crown', crown(gold, ruby, sapph, pearl, velvet), loc=(0, 0, 0.07), rot=(0.0, 0.0, 0.3))
    cr.scale = (1.3, 1.3, 1.3)
    C.backdrop_behind(CAM, TGT, 8.0, (0.2, 0.05, 0.05), (0.02, 0.008, 0.01), w=20, h=12, lift=1.4, glow=(0.6, 0.5), radius=5.0)
    C.bokeh([((rnd.uniform(-2.2, 2.2), rnd.uniform(3.5, 5.0), rnd.uniform(0.4, 1.9)), rnd.uniform(0.8, 1.6)) for _ in range(18)],
            (1.0, 0.75, 0.38), 12.0, radius=0.03)
    C.area('Key', (-0.6, -0.9, 1.4), (0, 0, 0.12), 0.6, 20, (1.0, 0.9, 0.78))
    C.area('Rim', (0.7, 1.0, 0.9), (0, 0, 0.14), 0.6, 18, (0.9, 0.92, 1.0))
    C.area('Fill', (1.2, -1.0, 0.4), (0, 0, 0.1), 1.0, 3, (1.0, 0.85, 0.7))
    finish('dev_vp', CAM, TGT, (0.06, 0.02, 0.02), fstop=2.6, focus_back=0.02, start=2.6, amount=0.6)


SCENES = {'knight': scene_knight, 'road': scene_road, 'plenty': scene_plenty, 'monopoly': scene_monopoly, 'vp': scene_vp}

if __name__ == '__main__':
    names = list(SCENES) if C.WHICH == 'all' else C.WHICH.split(',')
    for nm in names:
        SCENES[nm]()
