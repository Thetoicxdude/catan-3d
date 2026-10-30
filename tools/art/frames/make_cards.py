# Card faces from the frame templates (src/frame*.webp, supplied by the project owner): each frame is cropped to the card, its
# corners cut round, and the card's art is set into the arched window behind the frame's bevel.
# The name strip at the bottom keeps the frame's parchment; the name itself is set in HTML.
#   python3 make_cards.py <out dir>
import sys, os
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
CARDS = '/home/claude/assetwork/cards'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out/cards')
os.makedirs(OUT, exist_ok=True)

BOX = (102, 104, 663, 922)  # the card inside each 765x1024 template
W, H = BOX[2] - BOX[0], BOX[3] - BOX[1]  # 561 x 818
RADIUS = 27
# frame templates: 7 bronze (lumber), 2 verdigris (wool), 3 gold (grain), 4 red (brick), 5 silver (ore),
# 6 iridescent (development cards); 1 (dark green) was lumber's first frame
FRAME = {'wood': 7, 'wool': 2, 'grain': 3, 'brick': 4, 'ore': 5}
DEV = ['dev_knight', 'dev_road', 'dev_plenty', 'dev_monopoly', 'dev_vp']
GRADE = {'grain': (1.22, 0.035), 'wool': (1.05, 0.0), 'ore': (1.0, 0.0), 'brick': (1.04, 0.0), 'wood': (1.06, 0.0)}
SIZES = {'': 480, '_s': 160}


def rounded_alpha(w, h, r, ss=4):
    big = np.zeros((h * ss, w * ss), np.float32)
    yy, xx = np.mgrid[0 : h * ss, 0 : w * ss]
    R = r * ss
    cx = np.clip(xx, R, w * ss - 1 - R)
    cy = np.clip(yy, R, h * ss - 1 - R)
    inside = (xx - cx) ** 2 + (yy - cy) ** 2 <= R * R
    big[inside] = 1
    return np.asarray(Image.fromarray((big * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS), np.float32) / 255


def window_mask():
    m = np.asarray(Image.open(os.path.join(HERE, 'window_mask.png')), np.float32) / 255 > 0.5
    # tuck the art one pixel under the frame's bevel, then soften the edge
    m = ndimage.binary_dilation(m, iterations=1)
    soft = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255
    dist = ndimage.distance_transform_edt(m)
    return soft, dist


# how far to close in on the subject so it reads at hand-card size
ZOOM = {'wood': 1.25, 'wool': 1.35, 'grain': 1.12, 'brick': 1.22, 'ore': 1.3,
        'dev_knight': 1.0, 'dev_road': 1.12, 'dev_plenty': 1.25, 'dev_monopoly': 1.25, 'dev_vp': 1.22}


def subject_center(im):
    g = np.asarray(im.convert('L'), np.float32) / 255.0
    gx = np.abs(np.diff(g, axis=1))[:-1, :]
    gy = np.abs(np.diff(g, axis=0))[:, :-1]
    e = Image.fromarray(np.clip((gx + gy) * 255 * 4, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18))
    e = np.asarray(e, np.float32)
    h, w = e.shape
    e[:, : int(w * 0.04)] = 0
    e[:, int(w * 0.96) :] = 0
    thr = np.percentile(e, 80)
    m = np.where(e >= thr, e, 0)
    yy, xx = np.mgrid[0:h, 0:w]
    return float((m * xx).sum() / m.sum()), float((m * yy).sum() / m.sum())


def art(name):
    src = os.path.join(CARDS, 'dfinal' if name.startswith('dev_') else 'final', name + '.png')
    im = Image.open(src).convert('RGB')
    z = ZOOM.get(name, 1.0)
    if z > 1.0:
        cx, cy = subject_center(im)
        cx = min(max(cx, im.width * 0.4), im.width * 0.6)
        cy = min(max(cy, im.height * 0.4), im.height * 0.6)
        cw, ch = im.width / z, im.height / z
        x0 = min(max(0, cx - cw / 2), im.width - cw)
        y0 = min(max(0, cy - ch / 2), im.height - ch)
        im = im.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch)))
    sat, warm = GRADE.get(name, (1.0, 0.0))
    if sat != 1.0:
        im = ImageEnhance.Color(im).enhance(sat)
    if warm:
        a = np.asarray(im, np.float32)
        a[..., 0] *= 1 + warm
        a[..., 2] *= 1 - warm
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return im


def compose(name, frame_no, soft, dist, ys, xs):
    fr = np.asarray(Image.open(os.path.join(HERE, f'src/frame{frame_no}.webp')).convert('RGB'), np.float32)[BOX[1] : BOX[3], BOX[0] : BOX[2]]
    # art covers the window's bounding box
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    bw, bh = x1 - x0 + 4, y1 - y0 + 4
    im = art(name)
    s = max(bw / im.width, bh / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    ox = (im.width - bw) // 2
    oy = (im.height - bh) // 2
    im = im.crop((ox, oy, ox + bw, oy + bh))
    canvas = np.zeros_like(fr)
    canvas[y0 - 2 : y0 - 2 + bh, x0 - 2 : x0 - 2 + bw] = np.asarray(im, np.float32)[: H - (y0 - 2), : W - (x0 - 2)]
    # set into the card: a soft shadow just inside the bevel, a little darker toward the top
    shade = 1 - 0.5 * np.exp(-dist / 7.0) - 0.18 * np.exp(-dist / 22.0)
    canvas *= shade[..., None]
    out = fr * (1 - soft[..., None]) + canvas * soft[..., None]
    alpha = rounded_alpha(W, H, RADIUS)
    rgba = np.dstack([np.clip(out, 0, 255), alpha * 255]).astype(np.uint8)
    card = Image.fromarray(rgba, 'RGBA')
    for suffix, w in SIZES.items():
        h = round(w * H / W)
        c = card.resize((w, h), Image.LANCZOS)
        if w < 300:
            c = c.filter(ImageFilter.UnsharpMask(radius=0.8, percent=60, threshold=1))
        c.save(os.path.join(OUT, f'card_{name}{suffix}.webp'), 'WEBP', quality=88, alpha_quality=90, method=6)
    return card


def back(soft, dist):
    # the development deck's back: the same frame, its window a deep enamel field
    fr = np.asarray(Image.open(os.path.join(HERE, 'src/frame6.webp')).convert('RGB'), np.float32)[BOX[1] : BOX[3], BOX[0] : BOX[2]]
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy = W / 2, H * 0.4
    r = np.hypot((xx - cx) / W, (yy - cy) / H)
    inner = np.array([38, 74, 86], np.float32)
    outer = np.array([10, 22, 30], np.float32)
    t = np.clip(r / 0.42, 0, 1)[..., None]
    field = inner * (1 - t) + outer * t
    rng = np.random.default_rng(7)
    field *= 1 + rng.normal(0, 0.035, (H, W, 1)).astype(np.float32)
    # a faint lozenge lattice
    lat = (np.abs(((xx + yy) % 46) - 23) < 1.2) | (np.abs(((xx - yy) % 46) - 23) < 1.2)
    field[lat] *= 1.22
    shade = 1 - 0.5 * np.exp(-dist / 7.0) - 0.18 * np.exp(-dist / 22.0)
    field *= shade[..., None]
    out = fr * (1 - soft[..., None]) + field * soft[..., None]
    alpha = rounded_alpha(W, H, RADIUS)
    card = Image.fromarray(np.dstack([np.clip(out, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA')
    for suffix, w in SIZES.items():
        c = card.resize((w, round(w * H / W)), Image.LANCZOS)
        c.save(os.path.join(OUT, f'card_dev_back{suffix}.webp'), 'WEBP', quality=88, alpha_quality=90, method=6)
    return card


soft, dist = window_mask()
ys, xs = np.where(soft > 0.5)
back(soft, dist)
made = []
for name, f in FRAME.items():
    made.append(compose(name, f, soft, dist, ys, xs))
for name in DEV:
    made.append(compose(name, 6, soft, dist, ys, xs))
# contact sheet for review
tw = 187
th = round(tw * H / W)
sheet = Image.new('RGB', (tw * 5, th * 2), (14, 18, 22))
for k, c in enumerate(made):
    t = c.resize((tw, th), Image.LANCZOS)
    sheet.paste(t, ((k % 5) * tw, (k // 5) * th), t)
sheet.save(os.path.join(OUT, 'sheet.png'))
strip = np.asarray(Image.open(os.path.join(HERE, 'strip_mask.png'))) > 127
sy, sx = np.where(strip)
print('window box', xs.min(), ys.min(), xs.max(), ys.max(), 'strip box', sx.min(), sy.min(), sx.max(), sy.max(), 'card', W, H)
print('strip % left/top/width/height', round(sx.min() / W * 100, 2), round(sy.min() / H * 100, 2), round((sx.max() - sx.min() + 1) / W * 100, 2), round((sy.max() - sy.min() + 1) / H * 100, 2))
