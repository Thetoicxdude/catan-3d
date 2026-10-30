# Photographic still lifes for the five resource cards, rendered with Cycles on the CPU.
# Every scene is built from CC0 Poly Haven scans (textures, rocks, props) plus procedural
# geometry (logs, bricks, wheat, yarn, fleece) and lit like a product shot: warm key, cool
# rim, an out-of-focus backdrop tinted with the resource's colour.
#   python3.11 cards.py <wood|brick|wool|grain|ore|all> <outdir> [width=600] [samples=128]
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Matrix, Euler, noise

U = '/mnt/user-data/uploads/Claude/catan-assets/'
T1 = U + 'textures/'
T2 = U + 'round2/textures/'
M1 = U + 'models/'
M2 = U + 'round2/models/'
HDRI = U + 'hdri/kloofendal_43d_clear.hdr'

ARGS = sys.argv[1:]
WHICH = ARGS[0] if ARGS else 'wood'
OUT = ARGS[1] if len(ARGS) > 1 else '/tmp/cards'
WIDTH = int(ARGS[2]) if len(ARGS) > 2 else 600
SAMPLES = int(ARGS[3]) if len(ARGS) > 3 else 128
HEIGHT = round(WIDTH * 7 / 5)
os.makedirs(OUT, exist_ok=True)
TAU = math.pi * 2


# ───────────────────────── scene basics ─────────────────────────
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _imgs.clear()
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    c = s.cycles
    c.device = 'CPU'
    c.samples = SAMPLES
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.02
    c.use_denoising = True
    c.denoiser = 'OPENIMAGEDENOISE'
    try:
        c.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    except Exception:
        pass
    c.max_bounces = 8
    c.diffuse_bounces = 3
    c.glossy_bounces = 3
    c.transmission_bounces = 6
    c.transparent_max_bounces = 24
    c.volume_bounces = 0
    c.sample_clamp_indirect = 6
    c.blur_glossy = 0.6
    c.caustics_reflective = False
    c.caustics_refractive = False
    s.render.resolution_x = WIDTH
    s.render.resolution_y = HEIGHT
    s.render.resolution_percentage = 100
    s.render.film_transparent = False
    s.render.filter_size = 1.2
    s.view_settings.view_transform = 'AgX'
    s.view_settings.look = 'AgX - Medium High Contrast'
    s.view_settings.exposure = 0.0
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_depth = '8'
    try:
        s.cycles_curves.shape = 'THICK'
        s.cycles_curves.subdivisions = 2
    except Exception:
        pass
    return s


def link(o):
    bpy.context.scene.collection.objects.link(o)
    return o


_imgs = {}


def img(path, data=False):
    k = path
    if k not in _imgs:
        im = bpy.data.images.load(path, check_existing=False)
        im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
        _imgs[k] = im
    return _imgs[k]


class NT:
    """Tiny node-graph helper: n(kind, **attrs) makes a node; s(node, Input=value|socket) sets inputs."""

    def __init__(self, mat_or_tree, clear=True):
        if isinstance(mat_or_tree, bpy.types.Material):
            mat_or_tree.use_nodes = True
            self.t = mat_or_tree.node_tree
        else:
            self.t = mat_or_tree
        if clear:
            self.t.nodes.clear()

    def n(self, kind, **attrs):
        nd = self.t.nodes.new(kind)
        for k, v in attrs.items():
            setattr(nd, k, v)
        return nd

    def s(self, nd, **ins):
        for k, v in ins.items():
            k = k.replace('_', ' ')
            sock = nd.inputs[k]
            if isinstance(v, bpy.types.NodeSocket):
                self.t.links.new(v, sock)
            else:
                if sock.type == 'RGBA' and isinstance(v, (tuple, list)) and len(v) == 3:
                    v = tuple(v) + (1.0,)
                sock.default_value = v
        return nd

    def ln(self, a, b):
        self.t.links.new(a, b)

    # common little blocks ------------------------------------------------
    def math(self, op, a, b=None, clamp=False):
        m = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, bpy.types.NodeSocket):
                self.ln(v, m.inputs[i])
            else:
                m.inputs[i].default_value = v
        return m.outputs[0]

    def vmath(self, op, a, b=None):
        m = self.n('ShaderNodeVectorMath', operation=op)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, bpy.types.NodeSocket):
                self.ln(v, m.inputs[i])
            else:
                m.inputs[i].default_value = v
        return m.outputs['Value'] if op in ('LENGTH', 'DOT_PRODUCT', 'DISTANCE') else m.outputs['Vector']

    def mix(self, fac, a, b, blend='MIX'):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        for name, v in (('Factor', fac), ('A', a), ('B', b)):
            sock = m.inputs[name] if name == 'Factor' else [x for x in m.inputs if x.name == name and x.type == 'RGBA'][0]
            if isinstance(v, bpy.types.NodeSocket):
                self.ln(v, sock)
            else:
                sock.default_value = v if name == 'Factor' else (tuple(v) + (1.0,))[:4]
        return [x for x in m.outputs if x.type == 'RGBA'][0]

    def ramp(self, fac, stops, interp='LINEAR'):
        r = self.n('ShaderNodeValToRGB')
        r.color_ramp.interpolation = interp
        els = r.color_ramp.elements
        els[0].position = stops[0][0]
        els[-1].position = stops[-1][0]
        for p, _ in stops[1:-1]:
            els.new(p)
        for e, (p, c) in zip(sorted(els, key=lambda e: e.position), stops):
            e.color = (tuple(c) + (1.0,))[:4] if not isinstance(c, (int, float)) else (c, c, c, 1.0)
        self.ln(fac, r.inputs['Fac'])
        return r.outputs['Color']

    def smooth(self, x, a, b):
        m = self.n('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self.ln(x, m.inputs['Value'])
        m.inputs['From Min'].default_value = a
        m.inputs['From Max'].default_value = b
        return m.outputs['Result']

    def noise(self, vec, scale=5.0, detail=4.0, rough=0.5, dim='3D', w=0.0):
        nz = self.n('ShaderNodeTexNoise', noise_dimensions=dim)
        self.s(nz, Scale=scale, Detail=detail, Roughness=rough)
        if dim == '4D':
            nz.inputs['W'].default_value = w
        if vec is not None:
            self.ln(vec, nz.inputs['Vector'])
        return nz

    def tex(self, path, vec, data=False, interp='Linear'):
        t = self.n('ShaderNodeTexImage')
        t.image = img(path, data)
        t.interpolation = interp
        if vec is not None:
            self.ln(vec, t.inputs['Vector'])
        return t

    def coords(self, kind='UV', scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), uv=None):
        if uv:
            src = self.n('ShaderNodeUVMap', uv_map=uv).outputs['UV']
        else:
            src = self.n('ShaderNodeTexCoord').outputs[kind]
        mp = self.n('ShaderNodeMapping')
        if not isinstance(scale, (tuple, list)):
            scale = (scale, scale, scale)
        mp.inputs['Scale'].default_value = scale
        mp.inputs['Location'].default_value = loc
        mp.inputs['Rotation'].default_value = rot
        self.ln(src, mp.inputs['Vector'])
        return mp.outputs['Vector']

    def normal_map(self, color, strength=1.0, uv=''):
        nm = self.n('ShaderNodeNormalMap', uv_map=uv)
        self.s(nm, Strength=strength, Color=color)
        return nm.outputs['Normal']

    def bump(self, height, strength=0.3, distance=0.01, normal=None):
        b = self.n('ShaderNodeBump')
        self.s(b, Strength=strength, Distance=distance, Height=height)
        if normal is not None:
            self.ln(normal, b.inputs['Normal'])
        return b.outputs['Normal']

    def principled(self, **ins):
        p = self.n('ShaderNodeBsdfPrincipled')
        self.s(p, **ins)
        return p

    def output(self, shader, displacement=None):
        o = self.n('ShaderNodeOutputMaterial')
        self.ln(shader, o.inputs['Surface'])
        if displacement is not None:
            self.ln(displacement, o.inputs['Displacement'])
        return o


def material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, NT(m)


def world(strength=0.3, rot=0.0, clamp=2.0, tint=(1.0, 1.0, 1.0)):
    w = bpy.data.worlds.new('World')
    bpy.context.scene.world = w
    w.use_nodes = True
    g = NT(w.node_tree)
    tc = g.n('ShaderNodeTexCoord')
    mp = g.n('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = (0, 0, rot)
    g.ln(tc.outputs['Generated'], mp.inputs['Vector'])
    env = g.n('ShaderNodeTexEnvironment')
    env.image = img(HDRI)
    g.ln(mp.outputs['Vector'], env.inputs['Vector'])
    bg = g.n('ShaderNodeBackground')
    # the HDRI's sun peaks at ~70 000: clip it so the sky only fills and reflects; the lamps are the key
    sky = g.vmath('MINIMUM', env.outputs['Color'], (clamp, clamp, clamp))
    sky = g.vmath('MULTIPLY', sky, tuple(tint))
    g.s(bg, Color=sky, Strength=strength)
    out = g.n('ShaderNodeOutputWorld')
    g.ln(bg.outputs['Background'], out.inputs['Surface'])


def aim(o, target):
    d = Vector(target) - o.location
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def camera(loc, target, lens=55, fstop=2.8, focus=None):
    cd = bpy.data.cameras.new('Cam')
    cd.lens = lens
    cd.sensor_width = 36
    cd.clip_start = 0.02
    co = link(bpy.data.objects.new('Cam', cd))
    co.location = loc
    aim(co, target)
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = fstop
    cd.dof.aperture_blades = 7
    cd.dof.aperture_rotation = 0.3
    cd.dof.focus_distance = focus if focus else (Vector(target) - Vector(loc)).length
    bpy.context.scene.camera = co
    return co


def area(name, loc, target, size, power, color=(1, 1, 1), shape='DISK', spread=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.shape = shape
    ld.size = size
    ld.color = color
    if spread:
        ld.spread = spread
    lo = link(bpy.data.objects.new(name, ld))
    lo.location = loc
    aim(lo, target)
    return lo


def point(name, loc, power, color=(1, 1, 1), radius=0.05):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.energy = power
    ld.color = color
    ld.shadow_soft_size = radius
    lo = link(bpy.data.objects.new(name, ld))
    lo.location = loc
    return lo


def sun(name, direction_from, strength, color=(1, 1, 1), angle=0.05):
    ld = bpy.data.lights.new(name, 'SUN')
    ld.energy = strength
    ld.color = color
    ld.angle = angle
    lo = link(bpy.data.objects.new(name, ld))
    lo.location = Vector(direction_from)
    aim(lo, (0, 0, 0))
    return lo


def mesh_obj(name, bm, mats=()):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = link(bpy.data.objects.new(name, me))
    return o


def smooth_all(o):
    for p in o.data.polygons:
        p.use_smooth = True


def backdrop(inner, outer, center=(0.0, 3.0, 0.9), w=9.0, h=6.0, glow=(0.0, 0.0), radius=2.6, strength=1.0, face=None):
    """An emissive gradient card far behind the subject (always out of focus)."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    for v in bm.verts:
        v.co = Vector((v.co.x * w, 0, v.co.y * h))
    m, g = material('Backdrop')
    tc = g.n('ShaderNodeTexCoord')
    rel = g.vmath('SUBTRACT', tc.outputs['Object'], (glow[0], 0, glow[1]))
    rel = g.vmath('MULTIPLY', rel, (1.0, 0.0, 1.25))
    d = g.vmath('LENGTH', rel)
    f = g.smooth(d, 0.0, radius)
    nz = g.noise(tc.outputs['Object'], scale=0.6, detail=2)
    f = g.math('ADD', f, g.math('MULTIPLY', g.math('SUBTRACT', nz.outputs['Fac'], 0.5), 0.25))
    col = g.mix(f, inner, outer)
    em = g.n('ShaderNodeEmission')
    g.s(em, Color=col, Strength=strength)
    g.output(em.outputs[0])
    o = mesh_obj('Backdrop', bm, [m])
    o.location = center
    if face is not None:
        fx, fy = face
        o.rotation_euler = (0, 0, math.atan2(-fx, fy))
    o.visible_shadow = False
    o.visible_diffuse = False
    o.visible_glossy = True
    return o


def ground(name, scale=1.5, size=8.0, tint=(1, 1, 1), fade=(0.6, 2.2), fade_to=0.08, nor=1.0, rough_add=0.0,
           center=(0, 0), set_dir=T1, sat=1.0):
    """A big textured ground plane that darkens with distance so the subject pops."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for lp in f.loops:
            lp[uvl].uv = ((lp.vert.co.x + size / 2) / size, (lp.vert.co.y + size / 2) / size)
    m, g = material('Ground_' + name)
    vec = g.coords('UV', scale=(size * scale, size * scale, 1))
    base = set_dir + f'{name}/{name}_'
    d = g.tex(base + 'diff_1k.jpg', vec)
    r = g.tex(base + 'rough_1k.jpg', vec, data=True)
    n = g.tex(base + 'nor_gl_1k.jpg', vec, data=True)
    col = d.outputs['Color']
    if sat != 1.0:
        hs = g.n('ShaderNodeHueSaturation')
        g.s(hs, Saturation=sat, Color=col)
        col = hs.outputs['Color']
    col = g.mix(1.0, col, tint, blend='MULTIPLY')
    tc = g.n('ShaderNodeTexCoord')
    rel = g.vmath('MULTIPLY', g.vmath('SUBTRACT', tc.outputs['Object'], (center[0], center[1], 0)), (1, 1, 0))
    dist = g.vmath('LENGTH', rel)
    fd = g.smooth(dist, fade[0], fade[1])
    col = g.mix(g.math('MULTIPLY', fd, 1.0 - fade_to), col, (0, 0, 0))
    rough = g.math('ADD', r.outputs['Color'], rough_add, clamp=True)
    p = g.principled(Base_Color=col, Roughness=rough, Normal=g.normal_map(n.outputs['Color'], nor))
    p.inputs['Specular IOR Level'].default_value = 0.35
    g.output(p.outputs[0])
    o = mesh_obj('Ground', bm, [m])
    return o


def view_basis(cam, target):
    f = (Vector(target) - Vector(cam))
    f.z = 0
    f.normalize()
    right = Vector((f.y, -f.x, 0))
    return f, right


def backdrop_behind(cam, target, dist, inner, outer, w=16.0, h=10.0, lift=1.2, **kw):
    f, right = view_basis(cam, target)
    c = Vector(cam) + f * dist
    c.z = lift
    return backdrop(inner, outer, center=tuple(c), w=w, h=h, face=(f.x, f.y), **kw)


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    return new


def bokeh(points, color, strength, radius=0.03):
    """Tiny emissive spheres far behind the focus plane read as photographic bokeh discs."""
    m, g = material('Bokeh')
    em = g.n('ShaderNodeEmission')
    g.s(em, Color=tuple(color) + (1,), Strength=strength)
    g.output(em.outputs[0])
    objs = []
    for i, (p, s) in enumerate(points):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=radius * s)
        o = mesh_obj(f'Bokeh{i}', bm, [m])
        o.location = p
        o.visible_shadow = False
        o.visible_diffuse = False
        objs.append(o)
    return objs


def fog(color, start=3.2, depth=9.0, amount=0.85):
    """Aerial perspective via the mist pass: far things melt into the backdrop colour."""
    s = bpy.context.scene
    vl = s.view_layers[0]
    vl.use_pass_mist = True
    w = s.world
    w.mist_settings.start = start
    w.mist_settings.depth = depth
    w.mist_settings.falloff = 'QUADRATIC'
    s.use_nodes = True
    t = s.node_tree
    t.nodes.clear()
    rl = t.nodes.new('CompositorNodeRLayers')
    mul = t.nodes.new('CompositorNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = amount
    t.links.new(rl.outputs['Mist'], mul.inputs[0])
    mix = t.nodes.new('CompositorNodeMixRGB')
    mix.blend_type = 'MIX'
    t.links.new(mul.outputs[0], mix.inputs['Fac'])
    t.links.new(rl.outputs['Image'], mix.inputs[1])
    mix.inputs[2].default_value = tuple(color) + (1.0,)
    comp = t.nodes.new('CompositorNodeComposite')
    t.links.new(mix.outputs[0], comp.inputs['Image'])


def render(name):
    s = bpy.context.scene
    s.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', s.render.filepath, flush=True)


# ───────────────────────── wood: a stacked pile of cut logs ─────────────────────────
_heights = {}


def height_sampler(path):
    """Bilinear sampler of an image's luminance, normalised to zero mean / unit spread."""
    if path in _heights:
        return _heights[path]
    import numpy as np
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    lum = px[..., 0] * 0.3 + px[..., 1] * 0.55 + px[..., 2] * 0.15
    lum = (lum - lum.mean()) / (lum.std() + 1e-6)
    bpy.data.images.remove(im)

    def sample(u, v):
        x = (u % 1.0) * w - 0.5
        y = (v % 1.0) * h - 0.5
        x0, y0 = int(math.floor(x)), int(math.floor(y))
        fx, fy = x - x0, y - y0
        x0 %= w
        y0 %= h
        x1, y1 = (x0 + 1) % w, (y0 + 1) % h
        a = lum[y0, x0] * (1 - fx) + lum[y0, x1] * fx
        b = lum[y1, x0] * (1 - fx) + lum[y1, x1] * fx
        return float(a * (1 - fy) + b * fy)

    _heights[path] = sample
    return sample


def log_mesh(name, r, L, seed, mats, tilt0=(0, 0), tilt1=(0, 0), bend=0.0, segs=128, rings=44, tile=0.3,
             oval=1.0, relief=0.0045, bark_img=None):
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(-50, 50), rnd.uniform(-50, 50), rnd.uniform(-50, 50)))
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    capl = bm.loops.layers.uv.new('Cap')
    rows = []
    # an integer number of texture repeats around the log keeps the bark seamless
    tiles_u = max(1, round(TAU * r / tile))
    v_scale = L / (TAU * r / tiles_u)
    u_off, v_off = rnd.random(), rnd.random()
    hs = height_sampler(bark_img) if bark_img else None
    for j in range(rings + 1):
        t = j / rings
        z = -L / 2 + L * t
        bx = bend * ((t - 0.5) ** 2 - 0.25) * L
        row = []
        edge = j in (0, rings)
        for i in range(segs):
            a = TAU * i / segs
            p = Vector((math.cos(a) * 1.4, math.sin(a) * 1.4, z * 3.0))
            lump = noise.noise(p + off) * 0.05 + noise.noise(p * 3.1 + off * 1.3) * 0.016
            rr = r * (1 + lump) * (1.0 - 0.05 * t)
            if hs and not edge:
                hgt = max(-2.2, min(2.2, hs(u_off + tiles_u * i / segs, v_off + v_scale * t)))
                rr += relief * hgt * (0.35 if j in (1, rings - 1) else 1.0)
            x = rr * math.cos(a) * oval + bx
            y = rr * math.sin(a) / oval
            zz = z
            if j == 0:
                zz += tilt0[0] * (x - bx) + tilt0[1] * y
            if j == rings:
                zz += tilt1[0] * (x - bx) + tilt1[1] * y
            row.append(bm.verts.new((x, y, zz)))
        rows.append((row, bx))
    for j in range(rings):
        for i in range(segs):
            i2 = (i + 1) % segs
            vs = (rows[j][0][i], rows[j][0][i2], rows[j + 1][0][i2], rows[j + 1][0][i])
            f = bm.faces.new(vs)
            f.material_index = 0
            f.smooth = True
            us = (i / segs, (i + 1) / segs, (i + 1) / segs, i / segs)
            vv = (j / rings, j / rings, (j + 1) / rings, (j + 1) / rings)
            for lp, u, v in zip(f.loops, us, vv):
                lp[uvl].uv = (u_off + u * tiles_u, v_off + v * v_scale)
    for end, (row, bx), tilt in ((0, rows[0], tilt0), (1, rows[-1], tilt1)):
        zc = (-L / 2 if end == 0 else L / 2) + rnd.uniform(-0.004, 0.004)
        c = bm.verts.new((bx, 0, zc))
        for i in range(segs):
            i2 = (i + 1) % segs
            tri = (c, row[i2], row[i]) if end == 0 else (c, row[i], row[i2])
            f = bm.faces.new(tri)
            f.material_index = 1
            f.smooth = False
            for lp in f.loops:
                lp[capl].uv = ((lp.vert.co.x - bx) / (r * oval), lp.vert.co.y * oval / r)
                lp[uvl].uv = ((lp.vert.co.x - bx) / tile, lp.vert.co.y / tile)
    return mesh_obj(name, bm, mats)


def bark_material():
    m, g = material('Bark')
    vec = g.coords(uv='UVMap')
    base = T2 + 'bark_brown_01/bark_brown_01_'
    d = g.tex(base + 'diff_1k.jpg', vec)
    n = g.tex(base + 'nor_gl_1k.jpg', vec, data=True)
    arm = g.tex(base + 'arm_1k.jpg', vec, data=True)
    sep = g.n('ShaderNodeSeparateColor')
    g.ln(arm.outputs['Color'], sep.inputs['Color'])
    info = g.n('ShaderNodeObjectInfo')
    tint = g.ramp(info.outputs['Random'], [(0, (0.82, 0.8, 0.78)), (0.5, (1.0, 0.96, 0.9)), (1, (1.12, 1.02, 0.9))])
    col = g.mix(1.0, d.outputs['Color'], tint, blend='MULTIPLY')
    col = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', 1.0, sep.outputs['Red']), 0.7), col, (0, 0, 0))
    # moss on the upward-facing bark of some logs
    geo = g.n('ShaderNodeNewGeometry')
    up = g.vmath('DOT_PRODUCT', geo.outputs['Normal'], (0, 0, 1))
    tc = g.n('ShaderNodeTexCoord')
    mz = g.noise(tc.outputs['Object'], scale=9.0, detail=6, rough=0.6)
    moss = g.math('MULTIPLY', g.smooth(up, 0.35, 0.9), g.smooth(mz.outputs['Fac'], 0.57, 0.72))
    moss = g.math('MULTIPLY', moss, g.smooth(info.outputs['Random'], 0.35, 0.6))
    mosscol = g.mix(mz.outputs['Fac'], (0.07, 0.09, 0.02), (0.17, 0.2, 0.05))
    col = g.mix(moss, col, mosscol)
    rough = g.math('ADD', sep.outputs['Green'], g.math('MULTIPLY', moss, 0.3), clamp=True)
    nrm = g.normal_map(n.outputs['Color'], 1.8, uv='UVMap')
    p = g.principled(Base_Color=col, Roughness=rough, Normal=nrm)
    p.inputs['Specular IOR Level'].default_value = 0.4
    g.output(p.outputs[0])
    return m


def endgrain_material():
    m, g = material('EndGrain')
    uv = g.n('ShaderNodeUVMap', uv_map='Cap').outputs['UV']
    info = g.n('ShaderNodeObjectInfo')
    rnd = info.outputs['Random']
    # off-centre pith and wobbly rings
    pofs = g.n('ShaderNodeCombineXYZ')
    g.s(pofs, X=g.math('MULTIPLY', g.math('SUBTRACT', g.math('FRACT', g.math('MULTIPLY', rnd, 7.3)), 0.5), 0.3),
        Y=g.math('MULTIPLY', g.math('SUBTRACT', g.math('FRACT', g.math('MULTIPLY', rnd, 13.7)), 0.5), 0.3), Z=0.0)
    pith = g.vmath('SUBTRACT', uv, pofs.outputs['Vector'])
    seedv = g.n('ShaderNodeCombineXYZ')
    g.s(seedv, X=g.math('MULTIPLY', rnd, 37.0), Y=g.math('MULTIPLY', rnd, 11.0), Z=0.0)
    pv = g.vmath('ADD', pith, seedv.outputs['Vector'])
    wob = g.noise(pv, scale=1.6, detail=3, rough=0.5)
    wobv = g.vmath('SUBTRACT', wob.outputs['Color'], (0.5, 0.5, 0.5))
    q = g.vmath('ADD', pith, g.vmath('MULTIPLY', wobv, (0.2, 0.2, 0.0)))
    q = g.vmath('MULTIPLY', q, (1, 1, 0))
    d = g.vmath('LENGTH', q)
    # annual rings: saw profile = earlywood fading into a dark latewood band
    yr = g.noise(g.vmath('MULTIPLY', seedv.outputs['Vector'], (1, 1, 1)), scale=1.0, detail=1)
    dn = g.n('ShaderNodeTexNoise', noise_dimensions='1D')
    g.s(dn, Scale=6.0, Detail=2.0, Roughness=0.5)
    g.ln(g.math('ADD', d, g.math('MULTIPLY', rnd, 50.0)), dn.inputs['W'])
    dd = g.math('ADD', d, g.math('MULTIPLY', g.math('SUBTRACT', dn.outputs['Fac'], 0.5), 0.09))
    rings = g.math('FRACT', g.math('MULTIPLY', dd, g.math('ADD', 13.0, g.math('MULTIPLY', rnd, 7.0))))
    late = g.smooth(rings, 0.6, 0.95)
    wood = g.mix(g.math('MULTIPLY', late, 0.8), (0.7, 0.5, 0.29), (0.42, 0.25, 0.12))
    stain = g.noise(q, scale=2.4, detail=4, rough=0.6)
    wood = g.mix(g.math('MULTIPLY', g.smooth(stain.outputs['Fac'], 0.42, 0.68), 0.5), wood, (0.55, 0.42, 0.33), blend='MULTIPLY')
    # heartwood is darker and warmer than the sapwood
    heart = g.math('SUBTRACT', 1.0, g.smooth(d, 0.5, 0.72))
    wood = g.mix(g.math('MULTIPLY', heart, 0.65), wood, (0.78, 0.52, 0.34), blend='MULTIPLY')
    # fine fibre streaks + stain
    fib = g.noise(g.vmath('MULTIPLY', q, (40, 40, 1)), scale=4.0, detail=8, rough=0.7)
    wood = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', fib.outputs['Fac'], 0.5), 0.5), wood, (0.35, 0.22, 0.12), blend='MULTIPLY')
    # radial drying checks
    sep = g.n('ShaderNodeSeparateXYZ')
    g.ln(q, sep.inputs['Vector'])
    ang = g.math('ARCTAN2', sep.outputs['Y'], sep.outputs['X'])
    angw = g.math('ADD', ang, g.math('MULTIPLY', g.math('SUBTRACT', wob.outputs['Fac'], 0.5), 0.9))
    s1 = g.math('ABSOLUTE', g.math('SINE', g.math('ADD', g.math('MULTIPLY', angw, 1.5), g.math('MULTIPLY', rnd, 40.0))))
    width = g.math('MULTIPLY', d, 0.05)
    crack = g.math('SUBTRACT', 1.0, g.smooth(g.math('SUBTRACT', s1, width), 0.0, 0.015))
    crack = g.math('MULTIPLY', crack, g.math('MULTIPLY', g.smooth(d, 0.12, 0.3), g.math('SUBTRACT', 1.0, g.smooth(d, 0.7, 0.88))))
    crack = g.math('MULTIPLY', crack, g.smooth(rnd, 0.2, 0.35))
    wood = g.mix(crack, wood, (0.12, 0.07, 0.04))
    # inner bark ring and the bark itself at the rim
    edge = g.math('ADD', d, g.math('MULTIPLY', g.math('SUBTRACT', fib.outputs['Fac'], 0.5), 0.05))
    inner = g.smooth(edge, 0.86, 0.88)
    wood = g.mix(inner, wood, (0.36, 0.22, 0.12))
    outer = g.smooth(edge, 0.9, 0.92)
    wood = g.mix(outer, wood, (0.12, 0.085, 0.06))
    # darker grime toward the rim
    wood = g.mix(g.math('MULTIPLY', g.smooth(d, 0.65, 0.9), 0.25), wood, (0, 0, 0))
    # saw marks + ring relief
    saw = g.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='X')
    g.s(saw, Vector=q, Scale=2.2, Distortion=3.0, Detail=2.0)
    hgt = g.math('ADD', g.math('MULTIPLY', saw.outputs['Fac'], 0.5), g.math('MULTIPLY', late, 0.35))
    hgt = g.math('SUBTRACT', hgt, g.math('MULTIPLY', crack, 2.0))
    nrm = g.bump(hgt, strength=0.22, distance=0.004)
    p = g.principled(Base_Color=wood, Roughness=0.72, Normal=nrm)
    p.inputs['Specular IOR Level'].default_value = 0.35
    g.output(p.outputs[0])
    return m


def fresh_wood_material():
    m, g = material('Chip')
    tc = g.n('ShaderNodeTexCoord')
    w = g.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='X')
    g.s(w, Vector=tc.outputs['Object'], Scale=24.0, Distortion=6.0, Detail=3.0)
    col = g.mix(w.outputs['Fac'], (0.5, 0.36, 0.21), (0.36, 0.24, 0.13))
    p = g.principled(Base_Color=col, Roughness=0.8)
    g.output(p.outputs[0])
    return m


def circle_rest(c1, c2, r):
    """Centre of a circle of radius r resting on two circles (x, z, radius), above them."""
    (x1, z1, r1), (x2, z2, r2) = c1, c2
    a, b = r1 + r, r2 + r
    dx, dz = x2 - x1, z2 - z1
    d = math.hypot(dx, dz)
    l = (a * a - b * b + d * d) / (2 * d)
    h = math.sqrt(max(0.0, a * a - l * l))
    mx, mz = x1 + l * dx / d, z1 + l * dz / d
    return (mx - h * dz / d, mz + h * dx / d) if dx > 0 else (mx + h * dz / d, mz - h * dx / d)


def scene_wood():
    s = reset()
    world(0.6, rot=2.2)
    rnd = random.Random(7)
    bark, grain, chipm = bark_material(), endgrain_material(), fresh_wood_material()
    bark_img = T2 + 'bark_brown_01/bark_brown_01_diff_1k.jpg'
    # rows of logs resting in each other's grooves (axes along +Y, cut ends toward the camera)
    rows = [[0.082, 0.064, 0.09, 0.07], [0.075, 0.06, 0.08], [0.068, 0.076], [0.064]]
    placed = []
    x = 0.0
    bottom = []
    for k, r in enumerate(rows[0]):
        if k:
            x += bottom[-1][2] + r + 0.003
        bottom.append((x, r, r))
    shift = (bottom[0][0] + bottom[-1][0]) / 2
    bottom = [(bx - shift, bz, br) for bx, bz, br in bottom]
    placed.append(bottom)
    for rr in rows[1:]:
        prev = placed[-1]
        row = []
        for k, r in enumerate(rr):
            cx, cz = circle_rest(prev[k], prev[k + 1], r)
            row.append((cx, cz + 0.002, r))
        placed.append(row)
    n = 0
    for row in placed:
        for (cx, cz, r) in row:
            L = rnd.uniform(0.58, 0.74)
            o = log_mesh(f'Log{n}', r, L, seed=100 + n, mats=[bark, grain],
                         tilt0=(rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2)),
                         tilt1=(rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2)), bend=rnd.uniform(-0.05, 0.05),
                         oval=rnd.uniform(0.93, 1.07), bark_img=bark_img)
            o.rotation_euler = (math.pi / 2, 0, rnd.uniform(-0.035, 0.035))
            o.location = (cx, rnd.uniform(-0.06, 0.06) + 0.32 - L / 2, cz)
            n += 1
    # a few wood chips in front of the pile
    for i in range(9):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        sx, sy, sz = rnd.uniform(0.012, 0.03), rnd.uniform(0.006, 0.014), rnd.uniform(0.002, 0.004)
        for v in bm.verts:
            v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
            v.co.x += rnd.uniform(-0.002, 0.002)
        o = mesh_obj(f'Chip{i}', bm, [chipm])
        o.location = (rnd.uniform(-0.35, 0.35), -0.42 - rnd.uniform(0.0, 0.22), sz / 2)
        o.rotation_euler = (rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), rnd.uniform(0, TAU))
    # standing trunks far behind: an out-of-focus forest
    CAM, TGT = (-1.687, -3.126, 0.766), (0.03, -0.08, 0.15)
    f, right = view_basis(CAM, TGT)
    for i, (k, side, tr) in enumerate([(5.0, -1.9, 0.2), (6.5, -0.6, 0.26), (5.6, 0.7, 0.17), (7.5, 1.7, 0.24),
                                       (9.0, -2.6, 0.3), (8.2, 0.1, 0.22), (10.5, 2.9, 0.3), (4.6, 2.3, 0.18)]):
        o = log_mesh(f'Trunk{i}', tr, 7.0, seed=300 + i, mats=[bark, grain], segs=64, rings=30, tile=0.45,
                     bark_img=bark_img, relief=0.01)
        p = Vector(CAM) + f * (k + 2.9) + right * side
        o.location = (p.x, p.y, 3.0)
        o.rotation_euler = (0, 0, rnd.uniform(0, TAU))
    # ferns around the pile
    ferns = import_gltf(M1 + 'fern_02/fern_02_1k.gltf')
    for o in ferns:
        o.select_set(False)
    keep = {'fern_02_b': ((-0.55, 0.35, 0), 0.55, 0.4), 'fern_02_c': ((0.5, 0.45, 0), 0.6, 2.0)}
    for o in ferns:
        if o.type != 'MESH':
            continue
        if o.name in keep:
            loc, sc, rz = keep[o.name]
            o.parent = None
            # recentre the clump on its own bounds, then place it
            bb = [Vector(c) for c in o.bound_box]
            cx = sum(v.x for v in bb) / 8
            cy = sum(v.y for v in bb) / 8
            o.data.transform(Matrix.Translation((-cx, -cy, 0)))
            o.location = loc
            o.scale = (sc, sc, sc)
            o.rotation_euler = (0, 0, rz)
        else:
            bpy.data.objects.remove(o)
    ground('forest_leaves_04', scale=0.9, tint=(0.85, 0.85, 0.8), fade=(0.9, 9.0), fade_to=0.3, size=40.0)
    backdrop_behind(CAM, TGT, 17.0, (0.16, 0.2, 0.1), (0.025, 0.035, 0.018), w=24, h=14, lift=2.0, glow=(-1.0, 1.0), radius=6.5)
    area('Key', (-1.3, -1.25, 1.35), (0, 0.1, 0.18), 1.1, 22, (1.0, 0.84, 0.66))
    area('Rim', (1.1, 1.0, 1.0), (0, 0, 0.2), 0.9, 12, (0.85, 0.92, 1.0))
    sun('Sun', (2.5, 3.5, 1.9), 1.6, (1.0, 0.8, 0.58), angle=0.04)
    area('Fill', (0.9, -1.4, 0.4), (0, 0, 0.2), 1.4, 5, (0.9, 0.95, 1.0))
    camera(CAM, TGT, lens=85, fstop=2.4, focus=(Vector(TGT) - Vector(CAM)).length - 0.25)
    fog((0.05, 0.065, 0.035), start=3.6, depth=10.0, amount=0.9)
    render('wood')


# ───────────────────────── brick: a brickyard stack of fired clay bricks ─────────────────────────
def brick_mesh(name, mats, dims=(0.215, 0.1025, 0.065), seed=0, bevel=0.0045, cuts=7, rough=0.0007, chips=5):
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(-90, 90), rnd.uniform(-90, 90), rnd.uniform(-90, 90)))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dims[0], v.co.y * dims[1], v.co.z * dims[2]))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=3, profile=0.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.calc_length() > 0.012], cuts=cuts, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.normal_update()
    # handmade irregularity: soft undulation everywhere, a few chipped corners and edges
    chip_pts = []
    for _ in range(chips):
        cx = rnd.choice((-1, 1)) * dims[0] / 2 * rnd.uniform(0.2, 1.0)
        cy = rnd.choice((-1, 1)) * dims[1] / 2
        cz = rnd.choice((-1, 1)) * dims[2] / 2
        chip_pts.append((Vector((cx, cy, cz)), rnd.uniform(0.008, 0.024), rnd.uniform(0.003, 0.008)))
    for v in bm.verts:
        p = v.co
        n = v.normal
        d = noise.noise(p * 18 + off) * rough + noise.noise(p * 60 + off) * rough * 0.4
        for c, rad, depth in chip_pts:
            dist = (p - c).length
            if dist < rad:
                d -= depth * (1 - (dist / rad) ** 2) * (0.6 + 0.4 * noise.noise(p * 200 + off))
        v.co = p + n * d
    # a slight warp so no two bricks are the same box
    warp = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.002
    for v in bm.verts:
        v.co.z += warp.x * (v.co.x / dims[0]) ** 2 * 4 + warp.y * (v.co.y / dims[1]) * (v.co.x / dims[0]) * 2
    for f in bm.faces:
        f.smooth = True
    return mesh_obj(name, bm, mats)


def clay_material():
    m, g = material('Clay')
    tc = g.n('ShaderNodeTexCoord')
    info = g.n('ShaderNodeObjectInfo')
    rnd = info.outputs['Random']
    ofs = g.n('ShaderNodeCombineXYZ')
    g.s(ofs, X=g.math('MULTIPLY', rnd, 91.0), Y=g.math('MULTIPLY', rnd, 47.0), Z=g.math('MULTIPLY', rnd, 23.0))
    p = g.vmath('ADD', tc.outputs['Object'], ofs.outputs['Vector'])
    # per-brick firing colour: a few run dark (closer to the fire), most a deep terracotta
    fire = g.ramp(rnd, [(0.0, (0.13, 0.045, 0.028)), (0.15, (0.22, 0.07, 0.035)), (0.4, (0.33, 0.1, 0.045)),
                        (0.75, (0.42, 0.15, 0.065)), (1.0, (0.5, 0.22, 0.1))])
    # large and small mottling
    m1 = g.noise(p, scale=7.0, detail=5, rough=0.6)
    m2 = g.noise(p, scale=34.0, detail=6, rough=0.65)
    mott = g.math('ADD', g.math('MULTIPLY', m1.outputs['Fac'], 0.6), g.math('MULTIPLY', m2.outputs['Fac'], 0.4))
    col = g.mix(g.smooth(mott, 0.35, 0.7), g.mix(1.0, fire, (1.25, 1.2, 1.15), blend='MULTIPLY'), g.mix(1.0, fire, (0.62, 0.55, 0.5), blend='MULTIPLY'))
    # fire flashing: darker clouds that drift over one end
    fl = g.noise(p, scale=3.0, detail=3)
    sep = g.n('ShaderNodeSeparateXYZ')
    g.ln(tc.outputs['Object'], sep.inputs['Vector'])
    endw = g.smooth(g.math('MULTIPLY', sep.outputs['X'], g.math('SUBTRACT', g.math('MULTIPLY', g.math('GREATER_THAN', rnd, 0.5), 2.0), 1.0)), -0.03, 0.1)
    flash = g.math('MULTIPLY', g.smooth(fl.outputs['Fac'], 0.42, 0.68), endw)
    col = g.mix(g.math('MULTIPLY', flash, 0.8), col, (0.07, 0.03, 0.02))
    # sand and lime specks pressed into the surface
    vs = g.n('ShaderNodeTexVoronoi', feature='F1')
    g.s(vs, Vector=p, Scale=150.0, Randomness=1.0)
    speck = g.math('SUBTRACT', 1.0, g.smooth(vs.outputs['Distance'], 0.04, 0.12))
    smask = g.smooth(g.noise(p, scale=6.0, detail=2).outputs['Fac'], 0.42, 0.62)
    col = g.mix(g.math('MULTIPLY', speck, g.math('MULTIPLY', smask, 0.6)), col, (0.55, 0.42, 0.3))
    # pits, creases and a sandy grain for the bump
    vp = g.n('ShaderNodeTexVoronoi', feature='F1')
    g.s(vp, Vector=p, Scale=34.0, Randomness=1.0)
    pit = g.math('SUBTRACT', 1.0, g.smooth(vp.outputs['Distance'], 0.0, 0.17))
    pit = g.math('MULTIPLY', pit, g.smooth(g.noise(p, scale=7.0, detail=2).outputs['Fac'], 0.46, 0.6))
    cr = g.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE')
    g.s(cr, Vector=g.vmath('MULTIPLY', p, (1.0, 2.2, 1.0)), Scale=16.0, Randomness=1.0)
    crease = g.math('SUBTRACT', 1.0, g.smooth(cr.outputs['Distance'], 0.0, 0.035))
    crease = g.math('MULTIPLY', crease, g.smooth(g.noise(p, scale=5.0, detail=2).outputs['Fac'], 0.55, 0.65))
    grain = g.noise(p, scale=180.0, detail=4)
    hgt = g.math('SUBTRACT', g.math('MULTIPLY', grain.outputs['Fac'], 0.45), g.math('ADD', pit, g.math('MULTIPLY', crease, 0.6)))
    hgt = g.math('ADD', hgt, g.math('MULTIPLY', m2.outputs['Fac'], 0.5))
    col = g.mix(g.math('MULTIPLY', g.math('ADD', pit, crease), 0.5), col, (0.05, 0.02, 0.012))
    # dust settles on the upward faces
    geo = g.n('ShaderNodeNewGeometry')
    up = g.vmath('DOT_PRODUCT', geo.outputs['Normal'], (0, 0, 1))
    dust = g.math('MULTIPLY', g.smooth(up, 0.6, 0.95), g.smooth(g.noise(p, scale=11.0, detail=4).outputs['Fac'], 0.42, 0.72))
    col = g.mix(g.math('MULTIPLY', dust, 0.45), col, (0.42, 0.3, 0.22))
    nrm = g.bump(hgt, strength=0.55, distance=0.0025)
    pr = g.principled(Base_Color=col, Roughness=g.math('ADD', 0.84, g.math('MULTIPLY', dust, 0.1)), Normal=nrm)
    pr.inputs['Specular IOR Level'].default_value = 0.28
    g.output(pr.outputs[0])
    return m


def brick_stack(prefix, mats, origin=(0, 0, 0), yaw=0.0, layers=6, seed=1, missing=0, dims=(0.215, 0.1025, 0.065),
                linked=None, wide=(3, 4)):
    """A brickyard cube: even layers lie lengthwise in X (wide[0] × wide[1]), odd layers lengthwise in Y."""
    rnd = random.Random(seed)
    L, W, H = dims
    gap = 0.011
    nx, ny = wide
    sx_len = nx * (L + gap)
    sy_len = ny * (W + gap)
    objs = []
    rot = Matrix.Rotation(yaw, 4, 'Z')
    k = 0
    for layer in range(layers):
        z = H / 2 + layer * (H + 0.0015)
        slots = []
        if layer % 2 == 0:
            for ix in range(nx):
                for iy in range(ny):
                    slots.append(((ix - (nx - 1) / 2) * (L + gap), (iy - (ny - 1) / 2) * (W + gap), 0.0))
        else:
            mx = max(1, round(sx_len / (W + gap)))
            my = max(1, round(sy_len / (L + gap)))
            for ix in range(mx):
                for iy in range(my):
                    slots.append(((ix - (mx - 1) / 2) * (W + gap), (iy - (my - 1) / 2) * (L + gap), math.pi / 2))
        if layer == layers - 1 and missing:
            rnd.shuffle(slots)
            slots = slots[missing:]
        for (sx, sy, rz) in slots:
            if linked is not None:
                o = link(bpy.data.objects.new(f'{prefix}{k}', linked[k % len(linked)].data))
            else:
                o = brick_mesh(f'{prefix}{k}', mats, dims=dims, seed=seed * 100 + k)
            pos = rot @ Vector((sx + rnd.uniform(-0.007, 0.007), sy + rnd.uniform(-0.007, 0.007), z))
            o.location = Vector(origin) + pos
            o.rotation_euler = (rnd.uniform(-0.01, 0.01), rnd.uniform(-0.01, 0.01), yaw + rz + rnd.uniform(-0.05, 0.05))
            objs.append(o)
            k += 1
    return objs


def scene_brick():
    s = reset()
    world(0.6, rot=0.6)
    rnd = random.Random(11)
    clay = clay_material()
    CAM, TGT = (-1.55, -3.0, 1.06), (-0.04, -0.03, 0.2)
    stack = brick_stack('B', [clay], origin=(0.0, 0.08, 0.0), yaw=0.1, layers=6, seed=3, missing=5, wide=(3, 4))
    # loose bricks in front: one flat and turned, one on edge, one broken half
    for i, (loc, rot, dims) in enumerate([
        ((-0.26, -0.36, 0.0325), (0, 0, 0.55), (0.215, 0.1025, 0.065)),
        ((0.27, -0.33, 0.05125), (math.pi / 2, 0, -0.35), (0.215, 0.1025, 0.065)),
        ((0.02, -0.5, 0.0325), (0, 0, 1.9), (0.105, 0.1025, 0.065))]):
        o = brick_mesh(f'Loose{i}', [clay], dims=dims, seed=900 + i, chips=8 if i == 2 else 5)
        o.location = loc
        o.rotation_euler = rot
    # crumbs of broken brick
    for i in range(10):
        o = brick_mesh(f'Crumb{i}', [clay], dims=(rnd.uniform(0.012, 0.03), rnd.uniform(0.01, 0.022), rnd.uniform(0.008, 0.016)),
                       seed=950 + i, bevel=0.002, cuts=2, rough=0.0015, chips=2)
        o.location = (rnd.uniform(-0.45, 0.45), rnd.uniform(-0.66, -0.36), 0.005)
        o.rotation_euler = (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), rnd.uniform(0, TAU))
    # a brickyard behind: more stacks, out of focus
    f, right = view_basis(CAM, TGT)
    for j, (k, side) in enumerate([(4.4, -1.3), (5.2, 0.6), (6.6, -0.2), (7.4, 1.9), (8.6, -2.4), (5.6, 2.6)]):
        p = Vector(CAM) + f * (k + 3.0) + right * side
        brick_stack(f'Y{j}_', [clay], origin=(p.x, p.y, 0), yaw=rnd.uniform(-0.4, 0.4), layers=rnd.choice((8, 10, 12)), seed=40 + j,
                    linked=stack, wide=(3, 4))
    ground('red_laterite_soil_stones', scale=0.65, tint=(0.95, 0.9, 0.86), fade=(1.0, 10.0), fade_to=0.3, size=40.0)
    backdrop_behind(CAM, TGT, 17.0, (0.3, 0.16, 0.08), (0.05, 0.025, 0.015), w=24, h=14, lift=2.0, glow=(1.5, 0.6), radius=7.0)
    # a kiln fire glowing somewhere behind the stacks
    p = Vector(CAM) + f * 9.5 + right * 0.9
    point('Kiln', (p.x, p.y, 0.4), 260, (1.0, 0.45, 0.15), radius=0.4)
    area('Key', (-1.9, -0.7, 1.1), (0, 0.05, 0.2), 0.8, 20, (1.0, 0.86, 0.7))
    area('Fill', (1.0, -1.6, 0.5), (0, 0, 0.2), 1.4, 4, (0.9, 0.95, 1.0))
    sun('Sun', (2.8, 3.0, 1.5), 1.8, (1.0, 0.72, 0.48), angle=0.05)
    camera(CAM, TGT, lens=85, fstop=2.4, focus=(Vector(TGT) - Vector(CAM)).length - 0.08)
    fog((0.11, 0.06, 0.035), start=3.6, depth=10.0, amount=0.9)
    render('brick')


# ───────────────────────── wool: a basket of fleece and spun yarn on a pasture ─────────────────────────
def hair_material(name, color, rough=0.32, radial=0.55, coat=0.05, random_color=0.15, random_rough=0.2):
    m, g = material(name)
    h = g.n('ShaderNodeBsdfHairPrincipled')
    try:
        h.model = 'CHIANG'
    except Exception:
        pass
    h.parametrization = 'COLOR'
    g.s(h, Color=tuple(color) + (1,), Roughness=rough, Coat=coat)
    for k, v in (('Radial Roughness', radial), ('Random Color', random_color), ('Random Roughness', random_rough)):
        if k in h.inputs:
            h.inputs[k].default_value = v
    g.output(h.outputs[0])
    return m


def add_hair(o, mat_index, count, length, *, children=8, radius=0.0005, tip=0.2, kink='NO', kamp=0.003, kfreq=6.0,
             clump=0.2, rough1=0.0, rough2=0.0, rand_len=0.4, steps=4, seed=0, normal=1.0, rand_dir=0.2, tangent=0.0,
             child_type='INTERPOLATED', vgroup=None, even=True):
    mod = o.modifiers.new('Hair', 'PARTICLE_SYSTEM')
    ps = mod.particle_system
    ps.seed = seed
    st = ps.settings
    st.type = 'HAIR'
    st.use_advanced_hair = True
    st.count = count
    st.emit_from = 'FACE'
    st.use_emit_random = True
    st.use_even_distribution = even
    # hair_length is stored as the normal velocity (length = 4 × normal_factor), so the random and
    # tangential velocities are scaled to the same unit
    st.hair_length = length
    st.factor_random = rand_dir * length / 4.0
    st.tangent_factor = tangent * length / 4.0
    try:
        st.length_random = rand_len
    except Exception:
        pass
    st.child_type = child_type
    st.child_percent = 1
    st.rendered_child_count = children
    st.clump_factor = clump
    st.roughness_1 = rough1
    st.roughness_2 = rough2
    st.kink = kink
    st.kink_amplitude = kamp
    st.kink_frequency = kfreq
    st.render_step = steps
    st.display_step = 2
    st.root_radius = 1.0
    st.tip_radius = tip
    st.radius_scale = radius
    st.use_close_tip = True
    st.material = mat_index
    if vgroup:
        ps.vertex_group_density = vgroup
    return ps


def fleece_blob(name, mats, radius, seed, squash=0.62):
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(-60, 60), rnd.uniform(-60, 60), rnd.uniform(-60, 60)))
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=radius)
    for v in bm.verts:
        n = v.co.normalized()
        d = noise.noise(n * 1.7 + off) * 0.3 + noise.noise(n * 4.2 + off) * 0.12 + noise.noise(n * 9 + off) * 0.04
        v.co = n * radius * (1 + d)
        v.co.z *= squash
    for f in bm.faces:
        f.smooth = True
    return mesh_obj(name, bm, mats)


def yarn_ball(name, mats, R, seed, bands=12, per=6, thick=0.0034):
    """A wound ball: bands of parallel strands, each band a set of circles around one random axis."""
    rnd = random.Random(seed)
    cu = bpy.data.curves.new(name + 'C', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = thick
    cu.bevel_resolution = 1
    cu.fill_mode = 'FULL'
    for bnd in range(bands):
        ax = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
        u = ax.orthogonal().normalized()
        v = ax.cross(u)
        shell = R * (0.9 + 0.1 * (bnd + 1) / bands)
        for k in range(per):
            h = (k - (per - 1) / 2) * thick * 2.05
            rr = math.sqrt(max(1e-6, shell * shell - h * h))
            sp = cu.splines.new('POLY')
            N = 72
            sp.points.add(N - 1)
            ph = rnd.uniform(0, TAU)
            for i in range(N):
                a = TAU * i / N + ph
                p = (u * math.cos(a) + v * math.sin(a)) * rr + ax * h
                sp.points[i].co = (p.x, p.y, p.z, 1.0)
            sp.use_cyclic_u = True
    co = link(bpy.data.objects.new(name + 'C', cu))
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(co.evaluated_get(dg))
    bpy.data.objects.remove(co)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=R * 0.9)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    for m in mats:
        me.materials.append(m)
    o = link(bpy.data.objects.new(name, me))
    return o


def yarn_material(name, color):
    m, g = material(name)
    tc = g.n('ShaderNodeTexCoord')
    nz = g.noise(tc.outputs['Object'], scale=90.0, detail=4)
    col = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', nz.outputs['Fac'], 0.5), 0.6), tuple(color), (0.25, 0.22, 0.18), blend='MULTIPLY')
    tw = g.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL')
    g.s(tw, Vector=tc.outputs['Object'], Scale=260.0, Distortion=2.0, Detail=1.0)
    nrm = g.bump(tw.outputs['Fac'], strength=0.25, distance=0.0006)
    p = g.principled(Base_Color=col, Roughness=0.9, Normal=nrm)
    p.inputs['Sheen Weight'].default_value = 0.45
    p.inputs['Sheen Roughness'].default_value = 0.5
    p.inputs['Subsurface Weight'].default_value = 0.1
    p.inputs['Subsurface Radius'].default_value = (0.004, 0.003, 0.002)
    p.inputs['Specular IOR Level'].default_value = 0.2
    g.output(p.outputs[0])
    return m


def grass_hair_material():
    m, g = material('GrassHair')
    hi = g.n('ShaderNodeHairInfo')
    col = g.ramp(hi.outputs['Intercept'], [(0.0, (0.02, 0.035, 0.008)), (0.45, (0.09, 0.16, 0.03)), (1.0, (0.3, 0.36, 0.1))])
    col = g.mix(g.math('MULTIPLY', hi.outputs['Random'], 0.5), col, (0.55, 0.45, 0.15))
    p = g.principled(Base_Color=col, Roughness=0.45)
    tr = g.n('ShaderNodeBsdfTranslucent')
    g.s(tr, Color=col)
    mx = g.n('ShaderNodeMixShader')
    g.s(mx, Fac=0.3)
    g.ln(p.outputs[0], mx.inputs[1])
    g.ln(tr.outputs[0], mx.inputs[2])
    g.output(mx.outputs[0])
    return m


def grass_patch(name, radius, count, length=0.06, seed=0, center=(0, 0), hole=None, focus=None, steps=3, children=4, mask=None):
    """Hair grass on an invisible grid; density peaks around `focus` and fades out before the edge."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=64, y_segments=64, size=radius)
    gm = grass_hair_material()
    o = mesh_obj(name, bm, [gm, gm])
    o.location = (center[0], center[1], 0.002)
    vg = o.vertex_groups.new(name='density')
    fx, fy, r0, r1 = focus if focus else (center[0], center[1], radius, radius)
    for v in o.data.vertices:
        p = Vector(center) + v.co.xy
        edge = min(radius - abs(v.co.x), radius - abs(v.co.y))
        w = max(0.0, min(1.0, edge / (radius * 0.35)))
        df = (p - Vector((fx, fy))).length
        w *= 1.0 - 0.7 * max(0.0, min(1.0, (df - r0) / max(0.01, r1 - r0)))
        for (hx, hy, hr) in (hole or []):
            d = (p - Vector((hx, hy))).length
            w = min(w, max(0.0, min(1.0, (d - hr) / 0.05)))
        if mask:
            w *= mask(p.x, p.y)
        vg.add([v.index], w, 'REPLACE')
    mat_hide = bpy.data.materials.new('GrassBase')
    mat_hide.use_nodes = True
    g = NT(mat_hide)
    tr = g.n('ShaderNodeBsdfTransparent')
    g.output(tr.outputs[0])
    o.data.materials[0] = mat_hide
    add_hair(o, 2, count, length, children=children, radius=0.0011, tip=0.1, clump=0.0, rough2=0.012, rand_len=0.6,
             steps=steps, seed=seed, rand_dir=0.5, vgroup=vg.name)
    return o


def fleece_hair_material():
    m, g = material('FleeceHair')
    hi = g.n('ShaderNodeHairInfo')
    col = g.ramp(hi.outputs['Intercept'], [(0.0, (0.66, 0.6, 0.48)), (0.5, (0.64, 0.57, 0.44)), (1.0, (0.42, 0.33, 0.2))])
    col = g.mix(g.math('MULTIPLY', hi.outputs['Random'], 0.35), col, (0.55, 0.5, 0.42))
    h = g.n('ShaderNodeBsdfHairPrincipled')
    try:
        h.model = 'CHIANG'
    except Exception:
        pass
    h.parametrization = 'COLOR'
    g.s(h, Color=col, Roughness=0.42, Coat=0.0)
    if 'Radial Roughness' in h.inputs:
        h.inputs['Radial Roughness'].default_value = 0.6
    g.output(h.outputs[0])
    return m


def fence(prefix, start, end, posts=5, height=1.05, seed=0):
    """Split-rail fence from rough planks: posts plus two rails."""
    rnd = random.Random(seed)
    m, g = material('FenceWood')
    vec = g.coords('Object', scale=(2.0, 2.0, 2.0))
    base = T2 + 'rough_wood/rough_wood_'
    d = g.tex(base + 'diff_1k.jpg', vec)
    p = g.principled(Base_Color=g.mix(1.0, d.outputs['Color'], (0.7, 0.68, 0.64), blend='MULTIPLY'), Roughness=0.85)
    g.output(p.outputs[0])
    s, e = Vector(start), Vector(end)
    objs = []
    for i in range(posts):
        t = i / (posts - 1)
        c = s.lerp(e, t)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.11, v.co.y * 0.11, (v.co.z + 0.5) * height))
        o = mesh_obj(f'{prefix}Post{i}', bm, [m])
        o.location = (c.x, c.y, 0)
        o.rotation_euler = (rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), rnd.uniform(0, 1))
        objs.append(o)
    d = e - s
    ang = math.atan2(d.y, d.x)
    for k, hgt in enumerate((0.45, 0.85)):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * d.length * 1.02, v.co.y * 0.07, v.co.z * 0.09))
        o = mesh_obj(f'{prefix}Rail{k}', bm, [m])
        c = s.lerp(e, 0.5)
        o.location = (c.x, c.y, hgt * height)
        o.rotation_euler = (0, rnd.uniform(-0.02, 0.02), ang)
        objs.append(o)
    return objs


def sheep(name, loc, yaw, scale=0.0019):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath='/home/claude/assetwork/out/animals-raw/sheep.glb')
    new = [o for o in bpy.data.objects if o not in before]
    root = [o for o in new if o.parent is None and o.type == 'EMPTY'][0]
    drop = [o for o in new if o.type == 'MESH' and o.name.startswith('Icosphere')]
    new = [o for o in new if o not in drop]
    for o in drop:
        bpy.data.objects.remove(o)
    root.location = loc
    root.rotation_euler = (0, 0, yaw)
    root.scale = (scale, scale, scale)
    for o in new:
        if o.type == 'MESH':
            for i, ms in enumerate(o.material_slots):
                if ms.material and ms.material.name.startswith('White'):
                    ms.material = bpy.data.materials.get('SheepWool') or _sheep_wool()
                elif ms.material:
                    ms.material = bpy.data.materials.get('SheepDark') or _sheep_dark()
    return root


def _sheep_wool():
    m, g = material('SheepWool')
    tc = g.n('ShaderNodeTexCoord')
    nz = g.noise(tc.outputs['Object'], scale=0.06, detail=6)
    p = g.principled(Base_Color=(0.62, 0.58, 0.5), Roughness=1.0, Normal=g.bump(nz.outputs['Fac'], strength=0.6, distance=4.0))
    p.inputs['Sheen Weight'].default_value = 1.0
    g.output(p.outputs[0])
    return m


def _sheep_dark():
    m, g = material('SheepDark')
    p = g.principled(Base_Color=(0.05, 0.045, 0.04), Roughness=0.7)
    g.output(p.outputs[0])
    return m


def scene_wool():
    s = reset()
    world(0.7, rot=1.0, tint=(1.1, 1.0, 0.85))
    rnd = random.Random(23)
    CAM, TGT = (-1.043, -2.574, 0.75), (-0.073, -0.094, 0.1)
    BASKET = Vector((0.0, 0.04, 0.0))
    # wicker basket
    parts = import_gltf(M2 + 'wicker_basket_01/wicker_basket_01_1k.gltf')
    for o in parts:
        if o.type == 'MESH':
            o.scale = (1.3, 1.3, 1.3)
            o.location = BASKET
            o.rotation_euler = (0, 0, 0.25)
    # raw fleece heaped in the basket: crimped, clumped locks with darker tips
    fh = fleece_hair_material()
    fm, fg = material('FleeceBase')
    fp = fg.principled(Base_Color=(0.6, 0.55, 0.44), Roughness=0.95)
    fp.inputs['Sheen Weight'].default_value = 1.0
    fp.inputs['Subsurface Weight'].default_value = 0.2
    fg.output(fp.outputs[0])
    blobs = [(-0.13, 0.02, 0.1, 0.095), (0.05, 0.1, 0.115, 0.1), (0.15, -0.02, 0.1, 0.09), (-0.03, -0.05, 0.125, 0.1),
             (-0.17, 0.13, 0.09, 0.08), (0.17, 0.15, 0.08, 0.08), (0.0, 0.17, 0.1, 0.085)]
    rot = Matrix.Rotation(0.25, 4, 'Z')
    for i, (bx, by, bz, br) in enumerate(blobs):
        o = fleece_blob(f'Fleece{i}', [fm, fh], br, seed=60 + i)
        o.location = BASKET + rot @ Vector((bx, by, bz))
        o.rotation_euler = (0, 0, rnd.uniform(0, TAU))
        ps = add_hair(o, 2, 1100, 0.028, children=26, radius=0.0003, tip=0.3, kink='CURL', kamp=0.0042, kfreq=5.0,
                      clump=0.55, rough1=0.0016, rough2=0.0025, rand_len=0.45, steps=5, seed=i, rand_dir=1.1)
        ps.settings.clump_shape = 0.2
        ps.settings.child_radius = 0.016
        ps.settings.kink_amplitude_random = 0.5
    # balls of spun yarn in front
    for i, (pos, R, col) in enumerate([((0.17, -0.31), 0.062, (0.56, 0.46, 0.3)), ((-0.15, -0.35), 0.052, (0.13, 0.075, 0.04)),
                                       ((0.02, -0.47), 0.045, (0.42, 0.33, 0.2))]):
        ym = yarn_material(f'Yarn{i}', col)
        o = yarn_ball(f'Yarn{i}', [ym], R, seed=70 + i, bands=int(14 * R / 0.06), per=int(round(7 * R / 0.06)), thick=0.0042)
        o.location = (pos[0], pos[1], R * 0.97)
        o.rotation_euler = (rnd.uniform(0, TAU), rnd.uniform(0, TAU), rnd.uniform(0, TAU))
        fz = hair_material(f'Fuzz{i}', tuple(c * 0.9 for c in col), rough=0.6, coat=0.0)
        o.data.materials.append(fz)
        add_hair(o, 2, 2600, 0.0035, children=3, radius=0.00008, tip=0.5, clump=0.0, rough2=0.0012, rand_len=0.7,
                 steps=2, seed=80 + i, rand_dir=0.6)
    # a loose strand trailing from the big ball
    cu = bpy.data.curves.new('Strand', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.0045
    cu.bevel_resolution = 1
    sp = cu.splines.new('BEZIER')
    pts = [(0.17, -0.37, 0.012), (0.22, -0.47, 0.004), (0.16, -0.58, 0.004), (0.26, -0.7, 0.004)]
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    so = link(bpy.data.objects.new('Strand', cu))
    so.data.materials.append(bpy.data.materials['Yarn0'])
    # pasture, a fence and grazing sheep far behind
    f, right = view_basis(CAM, TGT)
    gc = Vector(TGT) + f * 1.2
    grass_patch('Grass', 3.2, 90000, length=0.05, seed=5, center=(gc.x, gc.y), focus=(0.0, -0.1, 0.7, 2.6), children=5,
                hole=[(BASKET.x, BASKET.y, 0.28), (0.17, -0.31, 0.055), (-0.15, -0.35, 0.045), (0.02, -0.47, 0.04)])
    ground('leafy_grass', scale=1.0, tint=(0.62, 0.7, 0.5), fade=(1.0, 10.0), fade_to=0.4, size=40.0)
    a = Vector(CAM) + f * 10.0 - right * 5.0
    b = Vector(CAM) + f * 11.0 + right * 5.0
    fence('F', (a.x, a.y), (b.x, b.y), posts=6, seed=3)
    for k, (dist, side, yaw) in enumerate([(5.6, -1.2, 0.6), (6.8, 1.0, 2.6), (8.2, -2.3, 1.9)]):
        p = Vector(CAM) + f * dist + right * side
        sheep(f'Sheep{k}', (p.x, p.y, 0.0), yaw)
    backdrop_behind(CAM, TGT, 17.0, (0.36, 0.42, 0.24), (0.07, 0.1, 0.05), w=24, h=14, lift=2.0, glow=(1.0, 1.0), radius=7.0)
    area('Key', (1.3, -1.6, 1.4), (0, 0, 0.12), 1.2, 12, (1.0, 0.86, 0.7))
    area('Fill', (-1.4, -1.4, 0.6), (0, 0, 0.12), 1.4, 3, (0.85, 0.92, 1.0))
    sun('Sun', (-2.2, 3.0, 1.5), 2.6, (1.0, 0.8, 0.56), angle=0.05)
    camera(CAM, TGT, lens=85, fstop=2.4, focus=(Vector(TGT) - Vector(CAM)).length - 0.1)
    fog((0.22, 0.25, 0.13), start=3.4, depth=10.0, amount=0.65)
    s.view_settings.exposure = 0.2
    render('wool')


# ───────────────────────── grain: a tied wheat sheaf at golden hour ─────────────────────────
def ear_mesh(name, mats, seed, length=0.078, n=18, awn=(0.035, 0.075)):
    """A bearded wheat spike: two rows of spikelets (three florets each) with long awns. Axis +Z."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    mi = {}

    def tag(before, idx):
        for f in bm.faces:
            if f.index == -1 or f not in before:
                pass
    faces_before = set()
    # rachis
    bmesh.ops.create_cone(bm, cap_ends=False, segments=5, radius1=0.0009, radius2=0.0006, depth=length,
                          matrix=Matrix.Translation((0, 0, length / 2)))
    awns = []
    for k in range(n):
        t = (k + 0.5) / n
        z = 0.003 + t * (length - 0.006)
        side = 1 if k % 2 else -1
        prof = 0.62 + 0.38 * math.sin(math.pi * min(1.0, t * 1.05)) ** 0.6
        for j, (yoff, spread) in enumerate(((0.0, 0.0), (-0.0021, -0.42), (0.0021, 0.42))):
            lean = math.radians(rnd.uniform(16, 26)) + (0.08 if j else 0.0)
            d = Vector((side * math.sin(lean), 0.0, math.cos(lean)))
            d = (Matrix.Rotation(spread * 0.6, 3, 'Z') @ d).normalized()
            rx, ry, rz = 0.0019 * prof, 0.0016 * prof, 0.0044 * prof
            centre = Vector((side * 0.0012, yoff, z)) + d * rz * 0.75
            rot = d.to_track_quat('Z', 'X').to_matrix().to_4x4()
            M = Matrix.Translation(centre) @ rot @ Matrix.Diagonal((rx, ry, rz, 1.0))
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0, matrix=M)
            if j == 0 or rnd.random() < 0.45:
                al = rnd.uniform(*awn) * (0.6 + 0.6 * t)
                ad = (d + Vector((0, 0, 0.9)) + Vector((rnd.gauss(0, 0.08), rnd.gauss(0, 0.08), 0))).normalized()
                tip = centre + d * rz * 0.9
                awns.append((tip, ad, al))
    # top floret
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0,
                              matrix=Matrix.Translation((0, 0, length + 0.002)) @ Matrix.Diagonal((0.0016, 0.0014, 0.0038, 1.0)))
    nfl = len(bm.faces)
    for f in bm.faces:
        f.material_index = 0
        f.smooth = True
    for (tip, ad, al) in awns:
        rot = ad.to_track_quat('Z', 'X').to_matrix().to_4x4()
        M = Matrix.Translation(tip + ad * al / 2) @ rot
        res = bmesh.ops.create_cone(bm, cap_ends=False, segments=4, radius1=0.00026, radius2=0.00004, depth=al, matrix=M)
    for f in list(bm.faces)[nfl:]:
        f.material_index = 1
        f.smooth = True
    return mesh_obj(name, bm, mats)


def straw_material(name, base, translucent=0.3, rough=0.45):
    m, g = material(name)
    info = g.n('ShaderNodeObjectInfo')
    tc = g.n('ShaderNodeTexCoord')
    col = g.mix(g.math('MULTIPLY', info.outputs['Random'], 0.6), tuple(base), (0.55, 0.42, 0.22), blend='MULTIPLY')
    st = g.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z')
    g.s(st, Vector=tc.outputs['Object'], Scale=60.0, Distortion=1.0)
    col = g.mix(g.math('MULTIPLY', st.outputs['Fac'], 0.15), col, (0.6, 0.5, 0.3), blend='MULTIPLY')
    p = g.principled(Base_Color=col, Roughness=rough)
    p.inputs['Specular IOR Level'].default_value = 0.5
    tr = g.n('ShaderNodeBsdfTranslucent')
    g.s(tr, Color=col)
    mx = g.n('ShaderNodeMixShader')
    g.s(mx, Fac=translucent)
    g.ln(p.outputs[0], mx.inputs[1])
    g.ln(tr.outputs[0], mx.inputs[2])
    g.output(mx.outputs[0])
    return m


def stalk_curve(name, mat, splines, radius=0.0016):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 1
    cu.resolution_u = 8
    cu.use_fill_caps = True
    for pts in splines:
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(pts) - 1)
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
    o = link(bpy.data.objects.new(name, cu))
    o.data.materials.append(mat)
    return o


def place_ear(name, ears, base, direction, rnd, scale=1.0):
    src = ears[rnd.randrange(len(ears))]
    o = link(bpy.data.objects.new(name, src.data))
    o.location = base
    q = direction.normalized().to_track_quat('Z', 'Y')
    o.rotation_euler = (q.to_matrix().to_4x4() @ Matrix.Rotation(rnd.uniform(0, TAU), 4, 'Z')).to_euler()
    o.scale = (scale, scale, scale)
    return o


def scene_grain():
    s = reset()
    world(0.9, rot=4.0, tint=(0.75, 0.9, 1.25))
    rnd = random.Random(31)
    CAM, TGT = (-0.95, -2.55, 0.92), (0.0, -0.02, 0.35)
    straw = straw_material('Straw', (0.82, 0.6, 0.27), translucent=0.35)
    earm = straw_material('Ear', (0.8, 0.53, 0.18), translucent=0.3, rough=0.5)
    awnm = straw_material('Awn', (0.88, 0.68, 0.34), translucent=0.5, rough=0.4)
    ears = [ear_mesh(f'EarSrc{i}', [earm, awnm], seed=500 + i) for i in range(5)]
    for e in ears:
        e.hide_render = True
        e.location = (0, 0, -5)
    # the sheaf: straight stalks crossing at the tie, fanning out above and below
    T = Vector((0.0, 0.0, 0.29))
    splines = []
    for i in range(170):
        a = rnd.uniform(0, TAU)
        r = 0.046 * math.sqrt(rnd.random())
        q = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        tilt_up = Vector((q.x * 7.0 + rnd.gauss(0, 0.06), q.y * 7.0 + rnd.gauss(0, 0.06), 1.0)).normalized()
        tilt_dn = Vector((q.x * 6.0 + rnd.gauss(0, 0.04), q.y * 6.0 + rnd.gauss(0, 0.04), 1.0)).normalized()
        P = T + q
        Lu = rnd.uniform(0.26, 0.37)
        E = P + tilt_up * Lu
        B = P - tilt_dn * (P.z / tilt_dn.z) + Vector((0, 0, 0.001))
        # a gentle bow toward the ear so the heads droop outward
        out = Vector((tilt_up.x, tilt_up.y, 0))
        if out.length < 1e-4:
            out = Vector((math.cos(a), math.sin(a), 0)) * 0.05
        mid = P + tilt_up * (Lu * 0.55)
        E2 = E + out.normalized() * Lu * rnd.uniform(0.02, 0.1) - Vector((0, 0, Lu * 0.02))
        splines.append([B, P, mid, E2])
        d = (E2 - mid).normalized()
        droop = (d + out.normalized() * rnd.uniform(0.15, 0.6)).normalized()
        place_ear(f'Ear{i}', ears, E2, droop, rnd, scale=rnd.uniform(1.15, 1.4))
    stalk_curve('Sheaf', straw, splines)
    # twine binding
    cu = bpy.data.curves.new('Twine', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.0038
    cu.bevel_resolution = 2
    sp = cu.splines.new('POLY')
    N = 160
    sp.points.add(N - 1)
    for k in range(N):
        a = TAU * 2.2 * k / N
        sp.points[k].co = (math.cos(a) * 0.058, math.sin(a) * 0.058, 0.278 + 0.024 * k / N, 1.0)
    tw = link(bpy.data.objects.new('Twine', cu))
    twm, tg = material('TwineMat')
    tcc = tg.n('ShaderNodeTexCoord')
    wv = tg.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL')
    tg.s(wv, Vector=tcc.outputs['Object'], Scale=120.0, Distortion=1.5)
    tp = tg.principled(Base_Color=(0.36, 0.25, 0.13), Roughness=0.85, Normal=tg.bump(wv.outputs['Fac'], 0.5, 0.001))
    tg.output(tp.outputs[0])
    tw.data.materials.append(twm)
    # a few loose stalks and grains on the ground in front
    loose = []
    for i in range(4):
        a = rnd.uniform(-0.5, 0.5)
        x0, y0 = rnd.uniform(-0.3, 0.2), rnd.uniform(-0.48, -0.3)
        L = rnd.uniform(0.32, 0.45)
        p0 = Vector((x0, y0, 0.002))
        p1 = p0 + Vector((math.cos(a) * L, math.sin(a) * L * 0.4, 0.0))
        loose.append([p0, p0.lerp(p1, 0.5) + Vector((0, 0, 0.004)), p1])
        place_ear(f'LooseEar{i}', ears, p1 + Vector((0, 0, 0.004)), (p1 - p0).normalized() + Vector((0, 0, 0.05)), rnd)
    stalk_curve('Loose', straw, loose)
    for i in range(18):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0,
                                  matrix=Matrix.Diagonal((0.0019, 0.0016, 0.0042, 1.0)))
        for f in bm.faces:
            f.smooth = True
        o = mesh_obj(f'Grain{i}', bm, [earm])
        o.location = (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.5, -0.2), 0.0017)
        o.rotation_euler = (math.pi / 2, 0, rnd.uniform(0, TAU))
    # standing wheat far behind, glowing in the low sun
    f, right = view_basis(CAM, TGT)
    field = []
    for i in range(3600):
        dist = rnd.uniform(6.5, 12.5)
        side = rnd.uniform(-1.0, 1.0) * (0.6 + dist * 0.2)
        p = Vector(CAM) + f * dist + right * side
        h = rnd.uniform(0.85, 1.05)
        lean = Vector((rnd.gauss(0, 0.06), rnd.gauss(0, 0.06), 1.0)).normalized()
        top = Vector((p.x, p.y, 0)) + lean * h
        field.append([Vector((p.x, p.y, 0.0)), Vector((p.x, p.y, 0)) + lean * h * 0.55, top])
        d = (lean + Vector((rnd.gauss(0, 0.25), rnd.gauss(0, 0.25), 0))).normalized()
        place_ear(f'FieldEar{i}', ears, top, d, rnd, scale=1.2)
    stalk_curve('Field', straw, field, radius=0.0018)
    # harvested stubble around the sheaf
    stub_m = straw_material('Stubble', (0.55, 0.42, 0.2), translucent=0.2)
    sb = bmesh.new()
    bmesh.ops.create_grid(sb, x_segments=40, y_segments=40, size=2.6)
    so = mesh_obj('Stubble', sb, [stub_m, stub_m])
    gc = Vector(TGT) + f * 1.2
    so.location = (gc.x, gc.y, 0.001)
    hide = bpy.data.materials.new('StubBase')
    hide.use_nodes = True
    hg = NT(hide)
    hg.output(hg.n('ShaderNodeBsdfTransparent').outputs[0])
    so.data.materials[0] = hide
    vg = so.vertex_groups.new(name='d')
    for v in so.data.vertices:
        pw = Vector((gc.x, gc.y)) + v.co.xy
        edge = min(2.6 - abs(v.co.x), 2.6 - abs(v.co.y))
        w = max(0.0, min(1.0, edge / 0.9)) * max(0.0, min(1.0, ((pw - Vector((0, 0))).length - 0.07) / 0.05))
        vg.add([v.index], w, 'REPLACE')
    add_hair(so, 2, 9000, 0.045, children=0, child_type='NONE', radius=0.0022, tip=0.85, clump=0.0, rand_len=0.6,
             steps=2, seed=4, rand_dir=0.35, vgroup='d')
    ground('dirt_floor', scale=0.8, tint=(0.95, 0.8, 0.58), fade=(1.2, 12.0), fade_to=0.5, size=40.0)
    backdrop_behind(CAM, TGT, 17.0, (2.6, 1.45, 0.55), (0.3, 0.17, 0.08), w=24, h=14, lift=1.4, glow=(1.3, -0.3), radius=7.0)
    sun('Sun', (2.2, 4.0, 1.0), 4.5, (1.0, 0.64, 0.32), angle=0.03)
    area('Key', (-1.7, -1.4, 1.2), (0, 0, 0.35), 1.2, 85, (1.0, 0.85, 0.66))
    area('Fill', (1.2, -1.8, 0.7), (0, 0, 0.35), 1.4, 3, (0.85, 0.9, 1.0))
    camera(CAM, TGT, lens=85, fstop=2.4, focus=(Vector(TGT) - Vector(CAM)).length - 0.04)
    fog((0.95, 0.56, 0.2), start=4.5, depth=12.0, amount=0.5)
    s.view_settings.exposure = 0.3
    s.view_settings.look = 'AgX - Punchy'
    render('grain')


# ───────────────────────── ore: a bucket of iron ore at the mine face ─────────────────────────
def ore_material(name, scan_base):
    """Dark, glinting ore over a scanned stone's normals: iron-grey rock with metallic veins and pyrite flecks."""
    m, g = material(name)
    uv = g.coords(uv='UVMap')
    d = g.tex(scan_base + 'diff_1k.jpg', uv)
    n = g.tex(scan_base + 'nor_gl_1k.jpg', uv, data=True)
    tc = g.n('ShaderNodeTexCoord')
    info = g.n('ShaderNodeObjectInfo')
    ofs = g.n('ShaderNodeCombineXYZ')
    g.s(ofs, X=g.math('MULTIPLY', info.outputs['Random'], 71.0), Y=g.math('MULTIPLY', info.outputs['Random'], 29.0), Z=0.0)
    p = g.vmath('ADD', g.vmath('MULTIPLY', tc.outputs['Object'], (1, 1, 1)), ofs.outputs['Vector'])
    bw = g.n('ShaderNodeRGBToBW')
    g.ln(d.outputs['Color'], bw.inputs['Color'])
    lum = bw.outputs['Val']
    rock = g.mix(g.smooth(lum, 0.12, 0.8), (0.035, 0.037, 0.042), (0.2, 0.205, 0.22))
    # rust-red hematite staining
    rz = g.noise(p, scale=6.0, detail=5, rough=0.6)
    rust = g.smooth(rz.outputs['Fac'], 0.56, 0.7)
    rock = g.mix(g.math('MULTIPLY', rust, 0.8), rock, (0.16, 0.055, 0.025))
    # metallic veins along noise iso-lines, and scattered flecks
    vz = g.noise(p, scale=11.0, detail=6, rough=0.55)
    vein = g.math('SUBTRACT', 1.0, g.smooth(g.math('ABSOLUTE', g.math('SUBTRACT', vz.outputs['Fac'], 0.5)), 0.006, 0.022))
    vor = g.n('ShaderNodeTexVoronoi', feature='F1')
    g.s(vor, Vector=p, Scale=95.0, Randomness=1.0)
    fleck = g.math('SUBTRACT', 1.0, g.smooth(vor.outputs['Distance'], 0.06, 0.16))
    fleck = g.math('MULTIPLY', fleck, g.smooth(g.noise(p, scale=8.0, detail=2).outputs['Fac'], 0.48, 0.62))
    metal = g.math('MAXIMUM', vein, fleck)
    pyr = g.smooth(g.noise(p, scale=3.5, detail=2).outputs['Fac'], 0.55, 0.62)
    mcol = g.mix(pyr, (0.56, 0.58, 0.62), (0.78, 0.6, 0.27))
    col = g.mix(metal, rock, mcol)
    rough = g.mix(metal, (0.74, 0.74, 0.74), (0.24, 0.24, 0.24))
    rough = g.mix(g.math('MULTIPLY', rust, g.math('SUBTRACT', 1.0, metal)), rough, (0.85, 0.85, 0.85))
    nrm = g.normal_map(n.outputs['Color'], 1.4, uv='UVMap')
    pr = g.principled(Base_Color=col, Metallic=metal, Roughness=rough, Normal=nrm)
    pr.inputs['Specular IOR Level'].default_value = 0.5
    g.output(pr.outputs[0])
    return m


def simulate(passive, active, frames=110):
    s = bpy.context.scene
    bpy.ops.rigidbody.world_add()
    w = s.rigidbody_world
    w.substeps_per_frame = 12
    w.solver_iterations = 24
    w.point_cache.frame_start = 1
    w.point_cache.frame_end = frames
    for o, kind in [(o, 'PASSIVE') for o in passive] + [(o, 'ACTIVE') for o in active]:
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
            bpy.ops.rigidbody.object_add(type=kind)
        rb = o.rigid_body
        rb.collision_shape = 'MESH' if kind == 'PASSIVE' else 'CONVEX_HULL'
        rb.friction = 0.9
        rb.restitution = 0.05
        rb.collision_margin = 0.001
        if kind == 'ACTIVE':
            rb.mass = 1.0
            rb.linear_damping = 0.2
            rb.angular_damping = 0.35
    for f in range(1, frames + 1):
        s.frame_set(f)
    final = {o.name: o.matrix_world.copy() for o in active}
    s.frame_set(frames)
    bpy.ops.rigidbody.world_remove()
    for o in passive + active:
        if o.rigid_body:
            with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
                bpy.ops.rigidbody.object_remove()
    for o in active:
        o.matrix_world = final[o.name]
    s.frame_set(1)


def pickaxe(loc, rot):
    """A forged pick on an ash handle."""
    wm, g = material('Handle')
    vec = g.coords('Object', scale=(6.0, 6.0, 1.2))
    d = g.tex(T2 + 'rough_wood/rough_wood_diff_1k.jpg', vec)
    p = g.principled(Base_Color=g.mix(1.0, d.outputs['Color'], (0.75, 0.62, 0.48), blend='MULTIPLY'), Roughness=0.62)
    g.output(p.outputs[0])
    im, ig = material('Iron')
    tc = ig.n('ShaderNodeTexCoord')
    rz = ig.noise(tc.outputs['Object'], scale=22.0, detail=6)
    rust = ig.smooth(rz.outputs['Fac'], 0.5, 0.68)
    col = ig.mix(rust, (0.05, 0.05, 0.055), (0.16, 0.06, 0.03))
    ip = ig.principled(Base_Color=col, Metallic=ig.math('SUBTRACT', 1.0, rust), Roughness=ig.math('ADD', 0.38, ig.math('MULTIPLY', rust, 0.5)),
                       Normal=ig.bump(rz.outputs['Fac'], 0.3, 0.002))
    ig.output(ip.outputs[0])
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.019, radius2=0.016, depth=0.78,
                          matrix=Matrix.Translation((0, 0, 0.39)))
    for f in bm.faces:
        f.smooth = True
    h = mesh_obj('PickHandle', bm, [wm])
    # head: a tube swept along an arc, tapering to points at both ends
    bm = bmesh.new()
    rings = []
    SEG, RS = 40, 10
    for i in range(SEG + 1):
        t = i / SEG
        a = math.radians(-58 + 116 * t)
        c = Vector((math.sin(a) * 0.24, 0.0, 0.76 - (1 - math.cos(a)) * 0.24))
        tang = Vector((math.cos(a), 0.0, math.sin(a))).normalized()
        nrm = Vector((0, 1, 0))
        bin_ = tang.cross(nrm).normalized()
        r = 0.017 * (1.0 - abs(2 * t - 1) ** 1.6 * 0.92)
        ring = []
        for k in range(RS):
            b = TAU * k / RS
            ring.append(bm.verts.new(c + (nrm * math.cos(b) * 0.85 + bin_ * math.sin(b) * 1.1) * r))
        rings.append(ring)
    for i in range(SEG):
        for k in range(RS):
            k2 = (k + 1) % RS
            f = bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
            f.smooth = True
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((0, 0, 0.75)) @ Matrix.Diagonal((0.05, 0.045, 0.075, 1)))
    head = mesh_obj('PickHead', bm, [im])
    head.parent = h
    h.location = loc
    h.rotation_euler = rot
    return h


def scene_ore():
    s = reset()
    world(0.5, rot=2.8)
    rnd = random.Random(41)
    CAM, TGT = (-1.02, -2.3, 0.82), (0.04, -0.03, 0.22)
    # bucket
    parts = import_gltf(M2 + 'wooden_bucket_01/wooden_bucket_01_1k.gltf')
    bucket = [o for o in parts if o.type == 'MESH']
    for o in bucket:
        o.scale = (0.85, 0.85, 0.85)
        o.location = (0.0, 0.06, 0.0)
        o.rotation_euler = (0, 0, 0.9)
    handle = [o for o in bucket if 'handle' in o.name]
    # ore chunks from scanned stones
    shapes = []
    for base, path in ((M1 + 'namaqualand_stones_01/textures/namaqualand_stones_01_', M1 + 'namaqualand_stones_01/namaqualand_stones_01_1k.gltf'),
                       (M1 + 'stone_01/textures/stone_01_', M1 + 'stone_01/stone_01_1k.gltf')):
        mat = ore_material('Ore_' + os.path.basename(base), base)
        for o in import_gltf(path):
            if o.type != 'MESH':
                continue
            o.data.materials[0] = mat
            bb = [Vector(c) for c in o.bound_box]
            cen = sum(bb, Vector()) / 8
            o.data.transform(Matrix.Translation(-cen))
            o.location = (0, 0, -10)
            o.hide_render = True
            shapes.append(o)
    # a passive filler keeps the heap near the rim
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.12, radius2=0.12, depth=0.16,
                          matrix=Matrix.Translation((0, 0.06, 0.08 + 0.1)))
    filler = mesh_obj('Filler', bm, [])
    gb = bmesh.new()
    bmesh.ops.create_cube(gb, size=1.0, matrix=Matrix.Translation((0, 0, -0.05)) @ Matrix.Diagonal((6, 6, 0.1, 1)))
    floor = mesh_obj('Floor', gb, [])
    chunks = []
    for i in range(30):
        src_o = shapes[rnd.randrange(len(shapes))]
        o = link(bpy.data.objects.new(f'Ore{i}', src_o.data))
        sz = max(src_o.dimensions)
        sc = rnd.uniform(0.065, 0.11) / sz
        o.scale = (sc, sc, sc)
        a = i * 2.4
        rr = 0.03 + 0.09 * ((i * 0.37) % 1.0)
        o.location = (math.cos(a) * rr, 0.06 + math.sin(a) * rr, 0.42 + i * 0.05)
        o.rotation_euler = (rnd.uniform(0, TAU), rnd.uniform(0, TAU), rnd.uniform(0, TAU))
        chunks.append(o)
    for i in range(9):
        src_o = shapes[rnd.randrange(len(shapes))]
        o = link(bpy.data.objects.new(f'Spill{i}', src_o.data))
        sz = max(src_o.dimensions)
        sc = rnd.uniform(0.045, 0.085) / sz
        o.scale = (sc, sc, sc)
        o.location = (rnd.uniform(-0.32, 0.3), rnd.uniform(-0.42, -0.2), 0.08 + i * 0.04)
        o.rotation_euler = (rnd.uniform(0, TAU), rnd.uniform(0, TAU), rnd.uniform(0, TAU))
        chunks.append(o)
    simulate([o for o in bucket if o not in handle] + [filler, floor], chunks, frames=120)
    bpy.data.objects.remove(filler)
    bpy.data.objects.remove(floor)
    # the pick leans on the bucket rim, its head over the ore
    C = Vector((0.0, 0.06, 0.0))
    A = C + Vector((0.3, -0.14, 0.0))
    u = (C - A).normalized()
    R = C - u * 0.128 + Vector((0, 0, 0.305))
    d = (R - A).normalized()
    side = Vector((-u.y, u.x, 0.0)).normalized()
    zax = d
    xax = side - zax * side.dot(zax)
    xax.normalize()
    yax = zax.cross(xax)
    M = Matrix((xax, yax, zax)).transposed()
    pickaxe(tuple(A), (M.to_4x4() @ Matrix.Rotation(0.35, 4, 'Z')).to_euler())
    # the mine face behind, boulders between
    f, right = view_basis(CAM, TGT)
    cliff = import_gltf(M1 + 'rock_face_01/rock_face_01_1k.gltf')
    for o in cliff:
        if o.type == 'MESH':
            p = Vector(CAM) + f * 8.0
            o.location = (p.x, p.y, -0.6)
            o.rotation_euler = (0, 0, math.atan2(-f.x, f.y) + math.pi)
            o.scale = (1.6, 1.6, 1.6)
    bould = import_gltf(M1 + 'namaqualand_boulders_01/namaqualand_boulders_01_1k.gltf')
    bm_src = [o for o in bould if o.type == 'MESH']
    for k, (dist, side, sc) in enumerate([(6.8, 2.2, 2.4), (7.6, -2.6, 2.6)]):
        p = Vector(CAM) + f * dist + right * side
        o = link(bpy.data.objects.new(f'Boulder{k}', bm_src[k % len(bm_src)].data))
        bb = [Vector(c) for c in bm_src[k % len(bm_src)].bound_box]
        cen = sum(bb, Vector()) / 8
        o.location = Vector((p.x, p.y, 0)) - Vector((cen.x, cen.y, 0)) * sc
        o.scale = (sc, sc, sc)
        o.rotation_euler = (0, 0, rnd.uniform(0, TAU))
    for o in bm_src:
        o.hide_render = True
    ground('rocks_ground_01', scale=0.8, tint=(0.42, 0.44, 0.48), fade=(1.0, 10.0), fade_to=0.35, size=40.0, sat=0.5)
    backdrop_behind(CAM, TGT, 17.0, (0.16, 0.19, 0.24), (0.025, 0.03, 0.04), w=24, h=14, lift=2.0, glow=(-1.2, 1.0), radius=7.0)
    # a miner's lantern somewhere off to the right, cool daylight from the left
    lp = Vector(CAM) + f * 3.4 + right * 1.3
    point('Lantern', (lp.x, lp.y, 0.55), 55, (1.0, 0.55, 0.22), radius=0.06)
    area('Key', (-1.8, -1.0, 1.6), (0, 0, 0.2), 0.9, 34, (0.88, 0.93, 1.0))
    area('Rim', (1.0, 1.4, 1.2), (0, 0, 0.2), 0.8, 20, (0.8, 0.88, 1.0))
    area('Fill', (0.8, -1.8, 0.6), (0, 0, 0.2), 1.4, 4, (1.0, 0.9, 0.8))
    camera(CAM, TGT, lens=85, fstop=2.4, focus=(Vector(TGT) - Vector(CAM)).length - 0.12)
    fog((0.05, 0.06, 0.075), start=3.4, depth=9.0, amount=0.85)
    render('ore')


SCENES = {'wood': scene_wood, 'brick': scene_brick, 'wool': scene_wool, 'grain': scene_grain, 'ore': scene_ore}

if __name__ == '__main__':
    names = list(SCENES) if WHICH == 'all' else WHICH.split(',')
    for nm in names:
        SCENES[nm]()
