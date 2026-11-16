# Building-card pictures: the development mode's models (src/render/devmodels.js, written out by
# tools/art/exportobj.mjs) rendered with Cycles in the look of the resource and development cards: the
# building on a patch of its ground, a warm key light, a cool rim, an out-of-focus backdrop tinted with
# its direction's colour. The materials are the original Poly Haven scans the map's tiles were made from;
# the owner's colour (roofs, cloth) is the direction's colour. Plants and kit parts the model asks for
# are the original Poly Haven models.
#   node tools/art/exportobj.mjs OBJDIR [items…]
#   python3.11 bldgcards.py OBJDIR <b_granary|w_gardens_done|…|all> OUTDIR [width=640] [samples=96]
import sys, os, json, math, glob
ARGV = sys.argv[1:]
OBJ = ARGV[0]
WHICH = ARGV[1] if len(ARGV) > 1 else 'all'
OUTD = ARGV[2] if len(ARGV) > 2 else '/tmp/bldgcards'
WIDTH = int(ARGV[3]) if len(ARGV) > 3 else 640
SAMPLES = int(ARGV[4]) if len(ARGV) > 4 else 96
# (cards.py reads its own arguments when it is imported)
sys.argv = [sys.argv[0], 'none', OUTD, str(WIDTH), str(SAMPLES)]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector
import cards as C
from cards import T1, T2, M1, M2

HEIGHT = round(WIDTH * 3 / 4)
DIR_COLOR = {'farm': '#6f8f2c', 'trade': '#2a76a0', 'army': '#a4362a', 'frontier': '#b0702a', 'lore': '#6a4c9c', 'basic': '#7a6448'}
DIR = {'aqueduct': 'farm', 'granary': 'farm', 'gardens': 'farm', 'market': 'trade', 'shipyard': 'trade', 'guild': 'trade', 'lighthouse': 'trade',
       'barracks': 'army', 'wall': 'army', 'mercenaries': 'army', 'adventurers': 'army', 'greatWall': 'army', 'post': 'frontier', 'camp': 'frontier',
       'royalRoad': 'frontier', 'academy': 'lore', 'press': 'lore', 'library': 'lore'}
# the ground each stands on (its building condition): Poly Haven ground scans
GROUND = {'w': ('sandy_gravel_02', T1, (1.1, 1.0, 0.88)), 'shipyard': ('coast_sand_01', T1, (1, 1, 1)), 'b': ('leafy_grass', T1, (0.8, 1.0, 0.62)), 'f': ('leafy_grass', T1, (0.8, 1.0, 0.62)),
          'k': ('leafy_grass', T1, (0.8, 1.0, 0.62))}
# (flat things are framed closer)
ZOOM = {'road': 0.6, 'dev': 0.85, 'wall': 0.85, 'greatWall': 0.72}
# the plants the models ask for → Poly Haven models
PLANTS = {'broad_a': M1 + 'island_tree_01/island_tree_01_1k.gltf', 'broad_b': M1 + 'tree_small_02/tree_small_02_1k.gltf', 'fern_b': M1 + 'fern_02/fern_02_1k.gltf',
          'fern_c': M1 + 'fern_02/fern_02_1k.gltf', 'rooibos_a': M1 + 'wild_rooibos_bush/wild_rooibos_bush_1k.gltf', 'rooibos_b': M1 + 'wild_rooibos_bush/wild_rooibos_bush_1k.gltf',
          'quiver1': M1 + 'quiver_tree_01/quiver_tree_01_1k.gltf', 'quiver2': M1 + 'quiver_tree_02/quiver_tree_02_1k.gltf'}
KITS = {'props': {'wooden_crate_01': M2 + 'wooden_crate_01/wooden_crate_01_1k.gltf', 'wicker_basket_01': M2 + 'wicker_basket_01/wicker_basket_01_1k.gltf',
                  'wooden_bucket_01': M2 + 'wooden_bucket_01/wooden_bucket_01_1k.gltf', 'stone_fire_pit': M2 + 'stone_fire_pit/stone_fire_pit_1k.gltf'},
        'fort': M2 + 'modular_fort_01/modular_fort_01_1k.gltf',
        # the farm animals (Quaternius, CC0: the same the map bakes)
        'animal': {a: '/home/claude/assetwork/quaternius/Farm Animals by @Quaternius/OBJ/' + a.capitalize() + '.obj' for a in ('sheep', 'horse', 'cow', 'pig')}}
# the map's own village and city: the baked houses (Blend Swap, CC0) with their colour and data maps
HOUSES = '/home/claude/assetwork/bldg/out/'
METRE = 0.16
# the deck of development cards: the card faces of the asset pack
CARD_IMG = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'assets', 'cards')


def hexrgb(h, k=1.0):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x ** 2.2) * k for x in c)


# ── materials for the slots ──
def scan(name, tex, base_dir=T2, tint=(1, 1, 1), nor=1.0):
    m, g = C.material(name)
    vec = g.coords('UV')
    b = base_dir + f'{tex}/{tex}_'
    d = g.tex(b + 'diff_1k.jpg', vec)
    n = g.tex(b + 'nor_gl_1k.jpg', vec, data=True)
    arm_path = b + 'arm_1k.jpg'
    rough = 0.85
    col = g.mix(1.0, d.outputs['Color'], tuple(tint), blend='MULTIPLY')
    if os.path.exists(arm_path):
        arm = g.tex(arm_path, vec, data=True)
        sep = g.n('ShaderNodeSeparateColor')
        g.ln(arm.outputs['Color'], sep.inputs['Color'])
        rough = sep.outputs['Green']
        col = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', 1.0, sep.outputs['Red']), 0.7), col, (0, 0, 0))
    p = g.principled(Base_Color=col, Roughness=rough, Normal=g.normal_map(n.outputs['Color'], nor, uv='UVMap'))
    p.inputs['Specular IOR Level'].default_value = 0.35
    g.output(p.outputs[0])
    return m


def plain(name, color, rough=0.8, metallic=0.0, sheen=0.0, transmission=0.0, emission=None, bump=0.0):
    m, g = C.material(name)
    p = g.principled(Base_Color=tuple(color) + (1,) if len(color) == 3 else color, Roughness=rough, Metallic=metallic)
    if sheen:
        p.inputs['Sheen Weight'].default_value = sheen
    if transmission:
        p.inputs['Transmission Weight'].default_value = transmission
    if emission:
        p.inputs['Emission Color'].default_value = tuple(emission) + (1,)
        p.inputs['Emission Strength'].default_value = 6.0
    if bump:
        tc = g.n('ShaderNodeTexCoord')
        nz = g.noise(tc.outputs['Object'], scale=60.0, detail=6)
        bp = g.n('ShaderNodeBump')
        g.s(bp, Strength=bump, Height=nz.outputs['Fac'])
        g.ln(bp.outputs['Normal'], p.inputs['Normal'])
    g.output(p.outputs[0])
    return m


def roof_tiles(name, color):
    """Clay tiles in rows, the owner's colour: Blender's brick texture over the roof's UVs."""
    m, g = C.material(name)
    vec = g.coords('UV', scale=(4.0, 4.0, 1))
    br = g.n('ShaderNodeTexBrick')
    c = Vector(color)
    g.s(br, Vector=vec, Color1=tuple(c * 1.15) + (1,), Color2=tuple(c * 0.8) + (1,), Mortar=(0.05, 0.04, 0.035, 1), Scale=1.0, **{'Mortar Size': 0.025, 'Brick Width': 0.32, 'Row Height': 0.18})
    p = g.principled(Base_Color=br.outputs['Color'], Roughness=0.62)
    bp = g.n('ShaderNodeBump')
    g.s(bp, Strength=0.5, Height=br.outputs['Fac'])
    g.ln(bp.outputs['Normal'], p.inputs['Normal'])
    g.output(p.outputs[0])
    return m


def materials(owner):
    sand = (1.32, 1.08, 0.78)
    return {
        'stone': scan('stone', 'rustic_stone_wall_02', tint=(1.15, 1.1, 1.02)),
        'sand': scan('sand', 'rustic_stone_wall_02', tint=sand),
        'marble': scan('marble', 'rustic_stone_wall_02', tint=(1.55, 1.5, 1.42), nor=0.5),
        'wood': scan('wood', 'rough_wood'),
        'dark': scan('dark', 'rough_wood', tint=(0.22, 0.19, 0.17)),
        'thatch': scan('thatch', 'thatch_roof_angled', tint=(1.75, 1.45, 0.9)),
        'brick': scan('brick', 'medieval_red_brick'),
        'rock': scan('rock', 'rock_face_03'),
        'street': scan('street', 'cobblestone_floor_08'),
        'burlap': plain('burlap', hexrgb('#a88c5c'), rough=0.95, bump=0.3),
        'earth': plain('earth', hexrgb('#5e4631'), rough=1.0, bump=0.4),
        'plaster': plain('plaster', hexrgb('#e6dac2'), rough=0.9, bump=0.08),
        'canvas': plain('canvas', hexrgb('#ece2cc'), rough=0.9, sheen=0.3),
        'paper': plain('paper', hexrgb('#f4efe2'), rough=0.85),
        'metal': plain('metal', hexrgb('#5a5c61'), rough=0.4, metallic=1.0),
        'copper': plain('copper', hexrgb('#5f9a83'), rough=0.5, metallic=0.4),
        'gold': plain('gold', hexrgb('#c9a03e'), rough=0.3, metallic=1.0),
        'leaf': plain('leaf', hexrgb('#4d7a30'), rough=0.7, sheen=0.4),
        'water': plain('water', hexrgb('#3f7f9a'), rough=0.05, transmission=0.4),
        'glow': plain('glow', hexrgb('#ffb347'), emission=hexrgb('#ffb347')),
        'roof': roof_tiles('roof', owner),
        'cloth': plain('cloth', owner, rough=0.75, sheen=0.5),
    }


# (each species imported once per picture; the other plants of it share its mesh: a tree's glTF is
# heavy, and a garden of them ran out of memory)
PLANT_SRC = {}
# the one plant of a set the map's species is (a glTF of ferns or bushes holds several, side by side)
VARIANT = {'fern_b': 'fern_02_b', 'fern_c': 'fern_02_c', 'rooibos_a': 'wild_rooibos_bush_a', 'rooibos_b': 'wild_rooibos_bush_b'}


def place_plant(p):
    path = PLANTS.get(p['sp'])
    if not path or not os.path.exists(path):
        return
    src = PLANT_SRC.get(p['sp'])
    if src is None:
        new = C.import_gltf(path)
        meshes = [o for o in new if o.type == 'MESH']
        want = VARIANT.get(p['sp'])
        if want and any(want in o.name for o in meshes):
            drop = [o for o in meshes if want not in o.name]
            keep = [o for o in meshes if want in o.name]
            others = [o for o in new if o.type != 'MESH']
            for o in drop:
                bpy.data.objects.remove(o, do_unlink=True)
            meshes = keep
            new = keep + others
        if not meshes:
            return
        # (the meshes out of their hierarchy, joined into one object with its transforms applied)
        for o in meshes:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
        for o in new:
            if o.type != 'MESH':
                bpy.data.objects.remove(o, do_unlink=True)
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        # (its middle over the origin: a plant of a set stood off to one side)
        from mathutils import Matrix
        xs = [c[0] for c in obj.bound_box]
        ys = [c[1] for c in obj.bound_box]
        obj.data.transform(Matrix.Translation((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0)))
        zs = [c[2] for c in obj.bound_box]
        src = PLANT_SRC[p['sp']] = (obj, max(max(zs) - min(zs), 1e-3), min(zs))
    else:
        obj = src[0].copy()
        bpy.context.collection.objects.link(obj)
    h0, z0 = src[1], src[2]
    s = p['h'] / h0
    obj.scale = (s, s, s)
    # three.js (x, y, z) → Blender (x, −z, y)
    obj.location = (p['x'], -p['z'], p['y'] - z0 * s)
    obj.rotation_euler[2] = (hash((p['x'], p['z'])) % 628) / 100.0


def place_kit(k):
    model, name = k['model'], k['name']
    path = KITS.get(model)
    if isinstance(path, dict):
        path = path.get(name)
    if not path or not os.path.exists(path):
        print('no kit for', model, name)
        return
    if path.endswith('.obj'):
        before = set(bpy.data.objects)
        bpy.ops.wm.obj_import(filepath=path, forward_axis='NEGATIVE_Z', up_axis='Y')
        new = [o for o in bpy.data.objects if o not in before]
    else:
        new = C.import_gltf(path)
    keep = [o for o in new if o.type == 'MESH' and (model != 'fort' or name in o.name)]
    for o in new:
        if o.type == 'MESH' and o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    keep_all = keep
    if not keep_all:
        return
    bpy.context.view_layer.update()
    zs = [(o.matrix_world @ Vector(c)).z for o in keep_all for c in o.bound_box]
    h0 = max(zs) - min(zs)
    s = k['scale'] if k.get('scale') else (k['h'] or 0.2) / max(h0, 1e-3)
    for o in keep_all:
        o.parent = None
        o.scale = tuple(v * s for v in o.scale)
        o.location = (k['x'], -k['z'], k['y'] - min(zs) * s)
        o.rotation_euler[2] = k['ry']


def house_material(name, owner):
    """A baked house: its colour map, the roof (the data map's blue) painted in the owner's colour the way
    the map paints it (the shingles' light and shade kept), roughness from the data map's green."""
    m, g = C.material('house_' + name)
    vec = g.coords('UV')
    alb = g.tex(HOUSES + name + '_alb.png', vec)
    dat = g.tex(HOUSES + name + '_m.png', vec, data=True)
    sep = g.n('ShaderNodeSeparateColor')
    g.ln(dat.outputs['Color'], sep.inputs['Color'])
    bw = g.n('ShaderNodeRGBToBW')
    g.ln(alb.outputs['Color'], bw.inputs['Color'])
    k = g.math('ADD', g.math('MULTIPLY', bw.outputs['Val'], 1.25), 0.42)
    kc = g.n('ShaderNodeCombineColor')
    for ch in ('Red', 'Green', 'Blue'):
        g.ln(k, kc.inputs[ch])
    painted = g.mix(1.0, kc.outputs['Color'], tuple(owner), blend='MULTIPLY')
    col = g.mix(g.math('MULTIPLY', sep.outputs['Blue'], 0.9), alb.outputs['Color'], painted)
    p = g.principled(Base_Color=col, Roughness=sep.outputs['Green'])
    p.inputs['Specular IOR Level'].default_value = 0.35
    g.output(p.outputs[0])
    return m


def place_house(name, owner, s=1.0, x=0.0, z=0.0, ry=0.0):
    new = C.import_gltf(HOUSES + name + '.glb')
    mat = house_material(name, owner)
    for o in new:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(mat)
    for o in new:
        if o.parent is None:
            o.scale = (METRE * s, METRE * s, METRE * s)
            o.location = (x, -z, 0)
            o.rotation_euler[2] = ry
    bpy.context.view_layer.update()


def place_fort(name, s, x, z, ry):
    place_kit({'model': 'fort', 'name': name, 'x': x, 'y': 0, 'z': z, 'ry': ry, 'h': None, 's': 1, 'scale': METRE * s})


def card_deck():
    """A deck of development cards on the table: backs stacked a little untidily, the top one turned up."""
    W, H, T = 0.5, 0.7, 0.008
    back = C.material('card_back')[0]
    face = C.material('card_face')[0]
    edge = plain('card_edge', hexrgb('#e9dfc8'), rough=0.8)
    for m, f in ((back, 'card_dev_back.webp'), (face, 'card_dev_knight.webp')):
        g = C.NT(m)
        t = g.tex(os.path.join(CARD_IMG, f), g.coords('UV'))
        p = g.principled(Base_Color=t.outputs['Color'], Roughness=0.55)
        p.inputs['Specular IOR Level'].default_value = 0.4
        g.output(p.outputs[0])
    import random
    rnd = random.Random(4)
    n = 9
    for i in range(n):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        uvl = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:
            top = f.normal.z > 0.5
            f.material_index = 1 if top else 0
            for lp in f.loops:
                lp[uvl].uv = (lp.vert.co.x + 0.5, lp.vert.co.y + 0.5)
        bmesh.ops.scale(bm, vec=(W, H, T), verts=bm.verts)
        last = i == n - 1
        o = C.mesh_obj(f'card{i}', bm, [edge, face if last else back])
        o.location = (rnd.uniform(-0.015, 0.015) + (0.2 if last else 0), rnd.uniform(-0.015, 0.015) + (-0.07 if last else 0), T * (i + 0.5))
        o.rotation_euler[2] = rnd.uniform(-0.05, 0.05) + (0.32 if last else 0)
    # a second, smaller pile and a card lying apart, face down
    for i in range(3):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        uvl = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:
            f.material_index = 1 if f.normal.z > 0.5 else 0
            for lp in f.loops:
                lp[uvl].uv = (lp.vert.co.x + 0.5, lp.vert.co.y + 0.5)
        bmesh.ops.scale(bm, vec=(W, H, T), verts=bm.verts)
        o = C.mesh_obj(f'pile{i}', bm, [edge, back])
        o.location = (-0.62 + rnd.uniform(-0.01, 0.01), 0.16 + rnd.uniform(-0.01, 0.01), T * (i + 0.5))
        o.rotation_euler[2] = -0.4 + rnd.uniform(-0.06, 0.06)


def render_one(stem):
    if stem.startswith('k_') and stem != 'k_road':
        return render_basic(stem)
    meta = json.load(open(os.path.join(OBJ, stem + '.json')))
    PLANT_SRC.clear()
    kind, key = stem.split('_')[0], stem.split('_')[1]
    d = DIR.get(key, 'basic')
    owner = hexrgb(DIR_COLOR[d])
    s = C.reset()
    s.render.resolution_x = WIDTH
    s.render.resolution_y = HEIGHT
    C.world(strength=0.35, rot=2.2, clamp=2.0)
    mats = materials(owner)
    bpy.ops.wm.obj_import(filepath=os.path.join(OBJ, stem + '.obj'), forward_axis='NEGATIVE_Z', up_axis='Y')
    for o in list(bpy.context.selected_objects):
        if o.type != 'MESH':
            continue
        for i, slot in enumerate(o.material_slots):
            name = slot.material.name.split('.')[0] if slot.material else 'stone'
            if name in mats:
                o.material_slots[i].material = mats[name]
        for p in o.data.polygons:
            p.use_smooth = name in ('leaf', 'water', 'cloth')
    for p in meta.get('plants', []):
        place_plant(p)
    for k in meta.get('kit', []):
        place_kit(k)
    mn = meta['box']['min']
    mx = meta['box']['max']
    mn = Vector((mn['x'], mn['y'], mn['z'])) if isinstance(mn, dict) else Vector(mn)
    mx = Vector((mx['x'], mx['y'], mx['z'])) if isinstance(mx, dict) else Vector(mx)
    # (foundations reach down into the ground: frame what stands above it)
    mn.y = max(mn.y, 0.0)
    stage(stem, kind, key, owner, mn, mx)


def render_basic(stem):
    """The basic cards set up from the map's own pieces: a village, a city, a deck of development cards."""
    key = stem.split('_')[1]
    owner = hexrgb(DIR_COLOR['basic'])
    roof = hexrgb('#b8452f')
    s = C.reset()
    s.render.resolution_x = WIDTH
    s.render.resolution_y = HEIGHT
    C.world(strength=0.35, rot=2.2, clamp=2.0)
    if key == 'settlement':
        place_house('house2', roof)
        mn, mx = Vector((-1.35, 0, -1.0)), Vector((1.35, 1.4, 1.0))
    elif key == 'city':
        place_fort('tower_round', 0.72, 0.15, -1.05, 0)
        place_fort('wall_thin_straight_04', 0.62, -1.55, -0.95, math.pi / 2 + 0.18)
        place_fort('wall_thin_gate_01', 0.62, 1.78, -0.85, math.pi / 2 - 0.22)
        place_house('house3', roof, 0.8, -0.95, 0.55, 0.12)
        place_house('house1', roof, 0.74, 1.05, 0.72, -0.18)
        mn, mx = Vector((-2.3, 0, -1.9)), Vector((2.3, 2.2, 1.6))
    else:
        card_deck()
        mn, mx = Vector((-0.85, 0, -0.5)), Vector((0.55, 0.1, 0.42))
    stage(stem, 'k', key, owner, mn, mx)


def stage(stem, kind, key, owner, mn, mx):
    """The ground, the camera, the lights and the backdrop round what is in the scene, and the render."""
    s = bpy.context.scene
    size = max(mx.x - mn.x, mx.z - mn.z, (mx.y - mn.y) * 1.2)
    # the ground: a patch of its terrain, darkening away from the building
    if key == 'dev':
        # a table of old planks under the deck
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size * 7)
        uvl = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:
            for lp in f.loops:
                lp[uvl].uv = (lp.vert.co.x / 1.1, lp.vert.co.y / 1.1)
        gr = C.mesh_obj('Table', bm, [scan('table', 'weathered_brown_planks', tint=(0.95, 0.85, 0.75))])
    else:
        gname, gdir, gtint = GROUND.get(key, GROUND.get(kind, GROUND['b']))
        # (a ground scan covers a couple of metres: a third of a map unit)
        # (the scan's grain the same size on every card: a wonder's camera stands further off)
        gr = C.ground(gname, scale=min(3.2, 5.2 / size), size=size * 14, tint=gtint, fade=(size * 0.7, size * 2.4), fade_to=0.3, set_dir=gdir)
    gr.location.z = -0.002
    # three.js centre → Blender
    cx, cy, cz = (mn.x + mx.x) / 2, -(mn.z + mx.z) / 2, (mx.y - mn.y) * 0.42
    target = (cx, cy, cz)
    dist = size * 2.7 * ZOOM.get(key, 1.0)
    el = math.radians(34)
    az = math.radians(-32)
    cam = (cx + math.sin(-az) * math.cos(el) * dist, cy - math.cos(az) * math.cos(el) * dist, cz + math.sin(el) * dist)
    C.camera(cam, target, lens=50, fstop=4.0)
    # light: the map's sun (front left, high), a warm key, a cool rim from behind right
    C.sun('Sun', (-0.55 * 10, -0.42 * 10, 0.78 * 10), 3.2, color=(1.0, 0.94, 0.84), angle=0.06)
    C.area('Rim', (cx + size * 1.4, cy + size * 1.6, size * 1.2), target, size * 1.2, 120 * size * size, color=(0.75, 0.85, 1.0))
    C.area('Fill', (cx - size * 1.8, cy - size * 0.6, size * 0.9), target, size * 1.6, 40 * size * size, color=(1.0, 0.95, 0.9))
    sky = Vector(hexrgb('#9fb9cf'))
    tint = Vector(owner)
    inner = tuple(sky * 0.75 + tint * 0.6) + (1,)
    outer = tuple(sky * 0.35 + tint * 0.25) + (1,)
    C.backdrop_behind(cam, target, dist * 2.2, inner, outer, w=size * 14, h=size * 8, lift=size * 0.8, radius=size * 4, strength=1.0)
    s.render.filepath = os.path.join(OUTD, stem + '.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', s.render.filepath, flush=True)


os.makedirs(OUTD, exist_ok=True)
stems = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(OBJ, '*.obj'))) + ['k_settlement', 'k_city', 'k_dev']
for stem in stems if WHICH == 'all' else [WHICH]:
    render_one(stem)
