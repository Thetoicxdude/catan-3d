# Bake one CC0 Blend Swap medieval house (Daniel74) into a game asset:
# a single mesh with one atlas UV, albedo (+ baked AO) and a data map (R=AO, G=roughness, B=roof mask).
import bpy, sys, os, math, mathutils
sys.path.insert(0, '/home/claude/work/bake')
from house_common import setup_scene, find_img, kind_of, join_all

a = sys.argv[sys.argv.index('--') + 1:]
src, out, res = a[0], a[1], int(a[2])
bpy.ops.wm.open_mainfile(filepath=src)
setup_scene()
for o in list(bpy.data.objects):
    if 'Handle' in o.name:  # iron door/window handles: thousands of triangles, invisible at map scale
        bpy.data.objects.remove(o, do_unlink=True)

ROUGH = {'roof': 0.9, 'wood': 0.82, 'plaster': 0.94, 'stone': 0.9, 'window': 0.2, 'door': 0.78, 'metal': 0.55}

def make_mats():
    for m in bpy.data.materials:
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out_n = nt.nodes.new('ShaderNodeOutputMaterial'); out_n.name = 'OUT'
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.name = 'BSDF'
        nt.links.new(bsdf.outputs['BSDF'], out_n.inputs['Surface'])
        k = kind_of(m.name)
        im = find_img(m.name)
        if im:
            tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = im; tex.interpolation = 'Cubic'
            uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
            nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
            col = tex.outputs['Color']
            if k == 'window':  # the author's bright blue glass → dark leaded glass
                hsv = nt.nodes.new('ShaderNodeHueSaturation')
                hsv.inputs['Saturation'].default_value = 0.35
                hsv.inputs['Value'].default_value = 0.42
                nt.links.new(col, hsv.inputs['Color'])
                col = hsv.outputs['Color']
            nt.links.new(col, bsdf.inputs['Base Color'])
        else:
            bsdf.inputs['Base Color'].default_value = (*m.diffuse_color[:3], 1)
        m['kind'] = k

make_mats()
ob, dims = join_all()
me = ob.data
print('dims', [round(d, 2) for d in dims], 'tris', sum(len(p.vertices) - 2 for p in me.polygons))

# atlas UV
atlas = me.uv_layers.new(name='Atlas')
me.uv_layers.active = atlas
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
bpy.ops.uv.pack_islands(rotate=True, margin=0.0035, shape_method='CONCAVE')
bpy.ops.object.mode_set(mode='OBJECT')

sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
sc.render.bake.margin = 24
sc.render.bake.margin_type = 'EXTEND'

def bake_into(img, typ, **kw):
    for m in me.materials:
        nt = m.node_tree
        n = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage')
        n.name = 'BAKE'; n.image = img
        for x in nt.nodes: x.select = False
        n.select = True; nt.nodes.active = n
    bpy.ops.object.bake(type=typ, margin=24, use_clear=True, **kw)

# 1) albedo
sc.cycles.samples = 8
alb = bpy.data.images.new('alb', res, res, alpha=False)
bake_into(alb, 'DIFFUSE', pass_filter={'COLOR'})
alb.filepath_raw = out + '_alb.png'; alb.file_format = 'PNG'; alb.save()

# 2) ambient occlusion, with a ground plane so walls darken where they meet the earth
bpy.ops.mesh.primitive_plane_add(size=max(dims) * 4, location=(0, 0, -0.02))
ground = bpy.context.active_object
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
w.light_settings.distance = max(dims) * 0.14
sc.cycles.samples = 96
ao = bpy.data.images.new('ao', res, res, alpha=False); ao.colorspace_settings.name = 'Non-Color'
bake_into(ao, 'AO')
ao.filepath_raw = out + '_ao.png'; ao.file_format = 'PNG'; ao.save()
bpy.data.objects.remove(ground, do_unlink=True)

# 3) data masks via emission: R = roof, G = roughness, B = timber
for m in me.materials:
    nt = m.node_tree
    k = m.get('kind', 'stone')
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.0
    em.inputs['Color'].default_value = (1.0 if k == 'roof' else 0.0, ROUGH.get(k, 0.9), 1.0 if k == 'wood' else 0.0, 1)
    nt.links.new(em.outputs['Emission'], nt.nodes['OUT'].inputs['Surface'])
sc.cycles.samples = 4
mk = bpy.data.images.new('mask', res, res, alpha=False); mk.colorspace_settings.name = 'Non-Color'
bake_into(mk, 'EMIT')
mk.filepath_raw = out + '_mask.png'; mk.file_format = 'PNG'; mk.save()

# export geometry: one material, the atlas as the only UV set
me.uv_layers.remove(me.uv_layers['UVMap'])
atlas = me.uv_layers['Atlas']; atlas.name = 'UVMap'
mat = bpy.data.materials.new('house')
me.materials.clear(); me.materials.append(mat)
for p in me.polygons: p.material_index = 0
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=out + '.glb', export_format='GLB', use_selection=True, export_materials='PLACEHOLDER',
                          export_yup=True, export_apply=True, export_texcoords=True, export_normals=True)
import json
json.dump({'dims': dims}, open(out + '.json', 'w'))
print('DONE', out)
