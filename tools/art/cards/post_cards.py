# Card art → web images.
#   <res>.webp    360×504 full art for cards in the hand, dialogs and flights
#   <res>_s.webp  96×134 close crop around the subject for inline miniatures
# The subject is found as the sharpest region of the render (everything else sits in the
# camera's depth-of-field blur), so the miniature always frames the logs / bricks / sheaf.
#   python3 post_cards.py <render dir> <out dir>
import sys, os
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

GRADE = {'grain': (1.22, 0.035), 'wool': (1.05, 0.0), 'ore': (1.0, 0.0), 'brick': (1.04, 0.0), 'wood': (1.06, 0.0)}

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def subject_center(im):
    g = np.asarray(im.convert('L'), dtype=np.float32) / 255.0
    gx = np.abs(np.diff(g, axis=1))[:-1, :]
    gy = np.abs(np.diff(g, axis=0))[:, :-1]
    e = Image.fromarray(np.clip((gx + gy) * 255 * 4, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18))
    e = np.asarray(e, dtype=np.float32)
    h, w = e.shape
    # ignore the bottom band (the card's name banner covers it) and the very edges
    e[int(h * 0.86):, :] = 0
    e[:, : int(w * 0.04)] = 0
    e[:, int(w * 0.96):] = 0
    thr = np.percentile(e, 80)
    m = np.where(e >= thr, e, 0)
    ys, xs = np.mgrid[0:h, 0:w]
    cx = float((m * xs).sum() / m.sum())
    cy = float((m * ys).sum() / m.sum())
    return cx, cy


NAMES = ('wood', 'brick', 'wool', 'grain', 'ore', 'dev_knight', 'dev_road', 'dev_plenty', 'dev_monopoly', 'dev_vp')
for name in NAMES:
    p = os.path.join(src, name + '.png')
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert('RGB')
    W, H = im.size
    # light per-card grade on top of the render's look
    sat, warm = GRADE.get(name, (1.0, 0.0))
    if sat != 1.0:
        im = ImageEnhance.Color(im).enhance(sat)
    if warm:
        a = np.asarray(im, dtype=np.float32)
        a[..., 0] *= 1 + warm
        a[..., 2] *= 1 - warm
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    full = im.resize((360, 504), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.0, percent=45, threshold=2))
    full.save(os.path.join(out, name + '.webp'), 'WEBP', quality=84, method=6)
    cx, cy = subject_center(im)
    # keep the crop on the main subject (spill in the foreground can pull the centroid down)
    cx = min(max(cx, W * 0.4), W * 0.6)
    cy = min(max(cy, H * 0.38), H * 0.54)
    zoom = 1.7
    cw, ch = W / zoom, H / zoom
    x0 = min(max(0, cx - cw / 2), W - cw)
    y0 = min(max(0, cy - ch * 0.48), H - ch)
    thumb = im.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch))).resize((96, 134), Image.LANCZOS)
    thumb = thumb.filter(ImageFilter.UnsharpMask(radius=0.8, percent=50, threshold=2))
    thumb.save(os.path.join(out, name + '_s.webp'), 'WEBP', quality=82, method=6)
    print(name, 'subject at', round(cx / W, 3), round(cy / H, 3),
          os.path.getsize(os.path.join(out, name + '.webp')), os.path.getsize(os.path.join(out, name + '_s.webp')))
