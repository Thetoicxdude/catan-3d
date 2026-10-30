# Pack baked maps for the game:
#   _d.webp  albedo (sRGB) with part of the baked AO multiplied in
#   _m.webp  (lossless) R = AO, G = roughness, B = roof/player-colour mask, A = alpha (cut-out)
#   _n.webp  tangent-space normal map (only when baked)
# Unused atlas space is filled from the nearest island texel, so mip levels never bleed black.
# usage: post.py <prefix> <mode: house|asset> <dsize> <msize> [nsize] [minRough]
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage
def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
def l2s(x): return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.maximum(x, 0), 1 / 2.4) - 0.055)
def load(p, mode='RGB'): return np.asarray(Image.open(p).convert(mode)).astype(np.float32) / 255
def save(arr, path, size, **kw):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    if size and im.size[0] != size: im = im.resize((size, size), Image.LANCZOS)
    im.save(path, **kw)
base, mode = sys.argv[1], sys.argv[2]
ds, ms = int(sys.argv[3]), int(sys.argv[4])
ns = int(sys.argv[5]) if len(sys.argv) > 5 else 0
minr = float(sys.argv[6]) if len(sys.argv) > 6 else 0.0
gain = float(sys.argv[7]) if len(sys.argv) > 7 else 1.0
alb = load(base + '_alb.png')
ao = np.clip(load(base + '_ao.png', 'L'), 0, 1)
mk = load(base + '_mask.png')
# coverage: every texel the bake wrote (islands + their margin) is non-black in at least one map
if mode == 'house':
    cov = (alb.max(-1) > 0.002) | (mk.max(-1) > 0.002) | (ao > 0.002)
    cov = ndimage.binary_erosion(cov, iterations=1)
else:
    cov = mk[..., 2] > 0.5  # explicit coverage channel
idx = ndimage.distance_transform_edt(~cov, return_distances=False, return_indices=True)
fill = lambda a: a[idx[0], idx[1]]
if mode == 'house':
    roof, rough, alpha = mk[..., 0], mk[..., 1], np.ones_like(ao)
else:
    roof, alpha = mk[..., 0], mk[..., 1]
    rough = load(base + '_rough.png', 'L')
rough = np.maximum(rough, minr)
alb, ao, rough, roof = fill(alb), fill(ao), fill(rough), fill(roof)
alpha = np.where(cov, alpha, fill(alpha))
save(l2s(s2l(alb) * gain * (0.55 + 0.45 * ao)[..., None]), base + '_d.webp', ds, quality=86, method=6)
save(np.dstack([ao, rough, roof, alpha]), base + '_m.webp', ms, lossless=True, exact=True, method=6)
if ns and os.path.exists(base + '_nrm.png'):
    save(fill(load(base + '_nrm.png')), base + '_n.webp', ns, quality=90, method=6)
print('packed', os.path.basename(base), 'coverage %.2f' % cov.mean())
