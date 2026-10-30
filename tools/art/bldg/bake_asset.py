# Generic asset bake (Blender/Cycles, headless): import a Poly Haven glTF (or .blend), keep/drop parts,
# decimate, unwrap one atlas, bake albedo / AO / roughness / tangent normals / masks, export a lean GLB.
#   python3.11 bake_asset.py -- <src> <out-prefix> <res> '<json opts>'
# opts: keep:[substr], drop:[substr], dec:{substr:ratio,'*':ratio}, alpha:{matsubstr:png}, roof:[matsubstr],
#       normal:bool, ground:bool, aodist:float(×max dim), place:{name:[x,y,z,rz]} (Blender units, z up)
import bpy, sys, os, math, json, mathutils

a = sys.argv[sys.argv.index('--') + 1:]
src, out, res = a[0], a[1], int(a[2])
O = json.loads(a[3]) if len(a) > 3 else {}
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    for f in src.split(','):
        bpy.ops.import_scene.gltf(filepath=f)
for o in list(bpy.data.objects):
    keep = O.get('keep'); drop = O.get('drop', [])
    if o.type != 'MESH' or (keep and not any(k in o.name for k in keep)) or any(d in o.name for d in drop):
        bpy.data.objects.remove(o, do_unlink=True)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
print('parts', [(o.name, sum(len(p.vertices) - 2 for p in o.data.polygons)) for o in objs])

# optional re-placement of modular pieces (copies allowed: name#k)
if O.get('place'):
    placed = []
    for key, (x, y, z, rz) in O['place'].items():
        base = key.split('#')[0]
        srco = next(o for o in objs if o.name == base or o.name.endswith(base))
        c = srco.copy(); c.data = srco.data.copy(); bpy.context.scene.collection.objects.link(c)
        c.location = (x, y, z); c.rotation_mode = 'XYZ'; c.rotation_euler = (math.radians(90), 0, math.radians(rz))
        placed.append(c)
    for o in objs: bpy.data.objects.remove(o, do_unlink=True)
    objs = placed

# external alpha maps (Poly Haven ships: MASK materials whose 1k JPG carries no alpha)
for m in bpy.data.materials:
    if not m.use_nodes: continue
    for sub, png in O.get('alpha', {}).items():
        if sub in m.name:
            nt = m.node_tree
            bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
            base_tex = bsdf.inputs['Base Color'].links[0].from_node
            uv_src = base_tex.inputs['Vector'].links[0].from_socket if base_tex.inputs['Vector'].links else None
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(png); t.image.colorspace_settings.name = 'Non-Color'
            if uv_src: nt.links.new(uv_src, t.inputs['Vector'])
            nt.links.new(t.outputs['Color'], bsdf.inputs['Alpha'])
            m.blend_method = 'CLIP' if hasattr(m, 'blend_method') else None

# decimate per part
for o in objs:
    r = None
    for k, v in O.get('dec', {}).items():
        if k != '*' and k in o.name: r = v
    if r is None: r = O.get('dec', {}).get('*')
    if r and r < 1:
        md = o.modifiers.new('dec', 'DECIMATE'); md.ratio = r; md.use_collapse_triangulate = True
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
for o in objs:
    bpy.context.view_layer.objects.active = o
    for md in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=md.name)
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
KIT = O.get('kit', False)
if len(objs) > 1 and not KIT:
    bpy.ops.object.join()
    objs = [bpy.context.view_layer.objects.active]
info = {}
for ob in objs:
    me = ob.data
    if ob.data.users > 1: ob.data = ob.data.copy(); me = ob.data
    bb = [mathutils.Vector(c) for c in ob.bound_box]
    mn = mathutils.Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = mathutils.Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    off = mathutils.Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z if O.get('base', True) else 0))
    me.transform(mathutils.Matrix.Translation(-off)); me.update()
    ob.location = (0, 0, 0)
    if O.get('dropBottom'):
        import bmesh
        bm = bmesh.new(); bm.from_mesh(me)
        h = mx.z - mn.z
        kill = [f for f in bm.faces if f.normal.z < -0.95 and f.calc_center_median().z < 0.02 * h + 0.05]
        bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(me); bm.free(); me.update()
    info[ob.name] = {'dims': [round(v, 3) for v in (mx - mn)], 'tris': sum(len(p.vertices) - 2 for p in me.polygons), 'mats': len(me.materials)}
print('parts', info)
ob = objs[0]; me = ob.data
dims = [max(i['dims'][k] for i in info.values()) for k in range(3)]
tris = sum(i['tris'] for i in info.values())

# atlas
for o in objs:
    u = o.data.uv_layers.new(name='Atlas'); o.data.uv_layers.active = u
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = ob
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(O.get('angle', 60)), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
bpy.ops.uv.pack_islands(rotate=True, margin=O.get('margin', 0.003), shape_method='CONCAVE')
bpy.ops.object.mode_set(mode='OBJECT')
# every image texture keeps sampling its original UV set
def orig_uv(o):
    return [u.name for u in o.data.uv_layers if u.name != 'Atlas'][0]
first_uv = orig_uv(ob)
for m in {m for o in objs for m in o.data.materials if m}:
    if not m.use_nodes: continue
    nt = m.node_tree
    for n in nt.nodes:
        if n.type == 'TEX_IMAGE' and not n.inputs['Vector'].links:
            uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = first_uv
            nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
        if n.type == 'UVMAP' and (not n.uv_map or n.uv_map == 'Atlas'):
            n.uv_map = first_uv
    for n in nt.nodes:
        if n.type == 'NORMAL_MAP' and not n.uv_map:
            n.uv_map = first_uv
# glTF imports name their first UV set 'UVMap' everywhere; make all objects agree on the name
for o in objs:
    nm = orig_uv(o)
    if nm != first_uv: o.data.uv_layers[nm].name = first_uv

# kit pieces share the origin: spread them out so they do not occlude each other while baking AO
if KIT:
    x = 0
    for o in objs:
        w = info[o.name]['dims'][0]
        o.location = (x + w / 2, 0, 0); x += w + 3
    span = x
else:
    span = max(dims)
bpy.context.view_layer.update()
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
MARGIN = 0 if KIT else 16  # several objects into one image: per-object margins would overwrite each other
sc.render.bake.margin = MARGIN; sc.render.bake.margin_type = 'EXTEND'
mats = list({m for o in objs for m in o.data.materials if m})

def target(img):
    for m in mats:
        m.use_nodes = True
        nt = m.node_tree
        n = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage')
        n.name = 'BAKE'; n.image = img
        for x in nt.nodes: x.select = False
        n.select = True; nt.nodes.active = n

def bake(name, typ, samples, colorspace='Non-Color', **kw):
    img = bpy.data.images.new(name, res, res, alpha=False)
    img.colorspace_settings.name = colorspace
    target(img); sc.cycles.samples = samples
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type=typ, margin=MARGIN, use_clear=True, **kw)
    img.filepath_raw = f'{out}_{name}.png'; img.file_format = 'PNG'; img.save()
    return img

bake('alb', 'DIFFUSE', 6, 'sRGB', pass_filter={'COLOR'})
bake('rough', 'ROUGHNESS', 4)
if O.get('normal', True):
    bake('nrm', 'NORMAL', 6, normal_space='TANGENT')
ground = None
if O.get('ground', True):
    bpy.ops.mesh.primitive_plane_add(size=max(span, max(dims)) * 4, location=(span / 2 if KIT else 0, 0, -0.02)); ground = bpy.context.active_object
w.light_settings.distance = max(dims) * O.get('aodist', 0.12)
bake('ao', 'AO', O.get('aosamples', 64))
if ground: bpy.data.objects.remove(ground, do_unlink=True)
# masks via emission: R = roof (player colour), G = alpha, B = coverage
for m in mats:
    nt = m.node_tree
    outn = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1
    roof = 1.0 if any(r in m.name for r in O.get('roof', [])) else 0.0
    comb = nt.nodes.new('ShaderNodeCombineColor')
    comb.inputs['Red'].default_value = roof; comb.inputs['Green'].default_value = 1.0; comb.inputs['Blue'].default_value = 1.0  # B = coverage
    if bsdf and bsdf.inputs['Alpha'].links:
        nt.links.new(bsdf.inputs['Alpha'].links[0].from_socket, comb.inputs['Green'])
    nt.links.new(comb.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], outn.inputs['Surface'])
bake('mask', 'EMIT', 4)

# export geometry with the atlas as its only UV set
for o in objs: o.location = (0, 0, 0)
mat = bpy.data.materials.new('baked')
for o in objs:
    me = o.data
    for nm in [u.name for u in me.uv_layers if u.name != 'Atlas']: me.uv_layers.remove(me.uv_layers[nm])
    me.uv_layers['Atlas'].name = 'UVMap'
    me.materials.clear(); me.materials.append(mat)
    for p in me.polygons: p.material_index = 0
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', use_selection=True, export_materials='PLACEHOLDER',
                          export_yup=True, export_apply=True, export_texcoords=True, export_normals=True)
json.dump({'dims': dims, 'tris': tris, 'parts': info}, open(out + '.json', 'w'))
print('DONE', out, tris)
