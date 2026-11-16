# Building-card renders (bldgcards.py) → web images for the asset pack:
#   bld_<key>.webp    640×480, the picture of an opened card (cardDetail)
#   bld_<key>_s.webp  256×192, the picture on the small cards (cardFace)
# The renders are named after their models (b_granary, w_gardens_done, k_road…); the files after the
# card's key (granary, gardens, road…), as cards-ui.js asks for them.
#   python3 post_bldg.py <render dir> <out dir>
import sys, os, glob
from PIL import Image, ImageEnhance

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
total = 0
for p in sorted(glob.glob(os.path.join(src, '*.png'))):
    stem = os.path.basename(p)[:-4]
    parts = stem.split('_')
    if parts[0] not in ('b', 'w', 'k') or len(parts) < 2:
        continue
    key = parts[1]
    im = Image.open(p).convert('RGB')
    if im.size != (640, 480):
        im = im.resize((640, 480), Image.LANCZOS)
    # (a touch of contrast and warmth, as the resource cards have)
    im = ImageEnhance.Contrast(im).enhance(1.06)
    im = ImageEnhance.Color(im).enhance(1.05)
    big = os.path.join(out, f'bld_{key}.webp')
    small = os.path.join(out, f'bld_{key}_s.webp')
    im.save(big, 'WEBP', quality=78, method=6)
    im.resize((256, 192), Image.LANCZOS).save(small, 'WEBP', quality=80, method=6)
    total += os.path.getsize(big) + os.path.getsize(small)
    print(key, os.path.getsize(big) // 1024, 'KB +', os.path.getsize(small) // 1024, 'KB')
print('total', total // 1024, 'KB')
