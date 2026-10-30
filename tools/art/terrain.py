# Terrain texture layers: albedo 1024 / normal 512 WebP per layer, plus each layer's mean colour.
import json
import numpy as np
from PIL import Image
SRC = '/mnt/user-data/uploads/Claude/catan-assets/textures'
OUT = 'out/terrain'
LAYERS = ['forest_leaves_04', 'forest_ground_04', 'red_laterite_soil_stones', 'leafy_grass', 'sparse_grass',
          'brown_mud_leaves_01', 'dirt_floor', 'rock_face', 'rocks_ground_01', 'sandy_gravel_02', 'coast_sand_01',
          'aerial_grass_rock', 'cliff_side']
meta = []
for i, n in enumerate(LAYERS):
    d = Image.open(f'{SRC}/{n}/{n}_diff_1k.jpg').convert('RGB')
    a = np.asarray(d).astype(np.float64)
    Image.fromarray((a + 0.5).astype(np.uint8)).save(f'{OUT}/{n}.webp', quality=82, method=6)
    nm = np.asarray(Image.open(f'{SRC}/{n}/{n}_nor_gl_1k.jpg').convert('RGB')).astype(np.float64) / 255 * 2 - 1
    nm = nm.reshape(512, 2, 512, 2, 3).mean(axis=(1, 3))
    nm /= np.maximum(np.linalg.norm(nm, axis=-1, keepdims=True), 1e-6)
    Image.fromarray(((nm * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(f'{OUT}/{n}_n.webp', quality=88, method=6)
    lin = (a / 255) ** 2.2
    mean = lin.reshape(-1, 3).mean(0) ** (1 / 2.2)
    meta.append({'name': n, 'mean': [round(x, 4) for x in mean]})
    print(i, n, [round(x, 3) for x in mean])
json.dump({'layers': meta}, open(f'{OUT}/terrain.json', 'w'), indent=1)
