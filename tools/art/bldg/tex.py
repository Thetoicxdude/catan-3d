# Tiling PBR texture set (Poly Haven diff / nor_gl / arm) → game WebPs
import sys, os
from PIL import Image
name, src, out, size = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
os.makedirs(out, exist_ok=True)
for k, q in [('diff', 86), ('nor_gl', 90), ('arm', 90)]:
    f = [x for x in os.listdir(src) if f'_{k}_' in x][0]
    im = Image.open(os.path.join(src, f)).convert('RGB')
    if im.size[0] != size: im = im.resize((size, size), Image.LANCZOS)
    tag = {'diff': 'd', 'nor_gl': 'n', 'arm': 'arm'}[k]
    im.save(os.path.join(out, f'{name}_{tag}.webp'), quality=q, method=6)
print('tex', name)
