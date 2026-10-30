# Downsample the raw impostor bakes (premultiplied box filter), bleed colours/normals into the
# transparent texels (nearest opaque texel) so filtering and mips never pull in black, encode WebP.
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

RAW = 'out/imp-raw'
OUT = 'out/imp'
SIZES = {'fir_a': 1024, 'fir_b': 1024, 'fir_c': 1024, 'quiver1': 1024, 'quiver2': 1024,
         'rooibos_a': 512, 'rooibos_b': 512, 'fern_b': 512, 'fern_c': 512, 'broad_a': 1024, 'broad_b': 1024}
meta = json.load(open(f'{RAW}/meta.json'))
out_meta = {}
for name, T in SIZES.items():
    c = np.asarray(Image.open(f'{RAW}/{name}_color.png').convert('RGBA')).astype(np.float64) / 255
    n = np.asarray(Image.open(f'{RAW}/{name}_normal.png').convert('RGBA')).astype(np.float64) / 255
    S = c.shape[0]
    f = S // T
    def box(a):
        return a.reshape(T, f, T, f, a.shape[-1]).mean(axis=(1, 3))
    a = c[..., 3:4]
    pc = box(np.concatenate([c[..., :3] * a, a], -1))
    alpha = pc[..., 3]
    col = pc[..., :3] / np.maximum(alpha[..., None], 1e-6)
    nv = (n[..., :3] * 2 - 1) * n[..., 3:4]
    nb = box(nv)
    nb = nb / np.maximum(np.linalg.norm(nb, axis=-1, keepdims=True), 1e-6)
    solid = alpha >= 0.5
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    weak = alpha < 0.5
    col[weak] = col[iy[weak], ix[weak]]
    nb[weak] = nb[iy[weak], ix[weak]]
    rgba = np.dstack([np.clip(col, 0, 1), alpha])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(f'{OUT}/{name}.webp', quality=86, alpha_quality=100, method=6, exact=True)
    # normals at half resolution: lighting detail only
    nh = nb.reshape(T // 2, 2, T // 2, 2, 3).mean(axis=(1, 3))
    nh = nh / np.maximum(np.linalg.norm(nh, axis=-1, keepdims=True), 1e-6)
    Image.fromarray(((nh * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8), 'RGB').save(f'{OUT}/{name}_n.webp', quality=86, method=6)
    m = meta[name]
    out_meta[name] = {'R': round(m['R'], 4), 'Cy': round(m['C'][1], 4), 'h': round(m['height'], 4), 'w': round(m['width'], 4), 'G': m['G'], 'size': T}
    # verify the exact flag kept the bled colours under alpha 0
    chk = np.asarray(Image.open(f'{OUT}/{name}.webp').convert('RGBA'))
    z = chk[..., 3] == 0
    print(name, T, 'coverage %.3f' % solid.mean(), 'rgb under a=0 mean', chk[z][:, :3].mean(0).round(1) if z.any() else '-')
json.dump(out_meta, open(f'{OUT}/impostors.json', 'w'), indent=1)
