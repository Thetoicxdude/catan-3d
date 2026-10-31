# Menu art from the same frame templates as the cards (src/frame*.webp, supplied by the project owner):
#   frame_<metal>.webp   a 9-slice of the card's outer meander band (CSS border-image, slice 45)
#   menu_<metal>.webp    a blank card for a menu button: the arched window filled with a dark enamel
#                        field (the emblem and the name are drawn by the page)
#   parchment.webp       a piece of the frames' parchment for name plates and labels
#   python3 make_ui.py <out dir>
import sys, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out/ui')
os.makedirs(OUT, exist_ok=True)

BOX = (102, 104, 663, 922)  # the card inside each 765x1024 template
W, H = BOX[2] - BOX[0], BOX[3] - BOX[1]  # 561 x 818
RADIUS = 27
METALS = {'bronze': 7, 'gold': 3, 'verdigris': 2, 'red': 4, 'silver': 5, 'green': 1}
S = 45  # the outer band: rim, meander and inner rim
T = 89  # three turns of the meander (about 29.6 px each), clear of the corner and centre ornaments


def card(n):
    return np.asarray(Image.open(os.path.join(HERE, f'src/frame{n}.webp')).convert('RGB'), np.float32)[BOX[1] : BOX[3], BOX[0] : BOX[2]]


def rounded_alpha(w, h, r, ss=4):
    yy, xx = np.mgrid[0 : h * ss, 0 : w * ss]
    R = r * ss
    cx = np.clip(xx, R, w * ss - 1 - R)
    cy = np.clip(yy, R, h * ss - 1 - R)
    big = ((xx - cx) ** 2 + (yy - cy) ** 2 <= R * R).astype(np.uint8) * 255
    return np.asarray(Image.fromarray(big).resize((w, h), Image.LANCZOS), np.float32) / 255


def flatten(tile, along_x):
    # even out the frame's soft lighting along an edge piece, so repeats join without a seam
    lum = tile[..., :3].mean(axis=2)
    prof = lum.mean(axis=0) if along_x else lum.mean(axis=1)
    k = 31  # about one turn of the meander
    sm = np.convolve(np.pad(prof, k // 2, mode='edge'), np.ones(k) / k, mode='valid')
    gain = prof.mean() / np.maximum(sm, 1)
    tile[..., :3] *= gain[None, :, None] if along_x else gain[:, None, None]
    return tile


def nine_slice(n):
    c = card(n)
    a = rounded_alpha(W, H, RADIUS)
    rgba = np.dstack([c, a * 255])
    out = np.zeros((2 * S + T, 2 * S + T, 4), np.float32)
    x2, y2 = W - S, H - S
    # corners
    out[:S, :S] = rgba[:S, :S]
    out[:S, S + T :] = rgba[:S, x2:]
    out[S + T :, :S] = rgba[y2:, :S]
    out[S + T :, S + T :] = rgba[y2:, x2:]
    # edges, continuing straight on from the corners
    out[:S, S : S + T] = flatten(rgba[:S, S : S + T].copy(), True)
    out[S + T :, S : S + T] = flatten(rgba[y2:, S : S + T].copy(), True)
    out[S : S + T, :S] = flatten(rgba[S : S + T, :S].copy(), False)
    out[S : S + T, S + T :] = flatten(rgba[S : S + T, x2:].copy(), False)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, f'frame_{name_of(n)}.webp'), 'WEBP', quality=92, alpha_quality=95, method=6)


def name_of(n):
    return next(k for k, v in METALS.items() if v == n)


def window_mask():
    m = np.asarray(Image.open(os.path.join(HERE, 'window_mask.png')), np.float32) / 255 > 0.5
    m = ndimage.binary_dilation(m, iterations=1)
    soft = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255
    return soft, ndimage.distance_transform_edt(m)


def menu_card(n, soft, dist, width=320):
    fr = card(n)
    yy, xx = np.mgrid[0:H, 0:W]
    # a deep enamel field, lit from behind the emblem
    cx, cy = W / 2, H * 0.43
    r = np.hypot((xx - cx) / W, (yy - cy) / H)
    inner = np.array([46, 64, 78], np.float32)
    outer = np.array([9, 15, 22], np.float32)
    t = np.clip(r / 0.46, 0, 1)[..., None] ** 0.8
    field = inner * (1 - t) + outer * t
    rng = np.random.default_rng(11 + n)
    field *= 1 + rng.normal(0, 0.03, (H, W, 1)).astype(np.float32)
    # faint rays from the centre, like an engraved sunburst
    ang = np.arctan2(yy - cy, xx - cx)
    rays = (np.cos(ang * 24) > 0.86) & (r > 0.12)
    field[rays] *= 1.1
    shade = 1 - 0.55 * np.exp(-dist / 7.0) - 0.2 * np.exp(-dist / 24.0)
    field *= shade[..., None]
    out = fr * (1 - soft[..., None]) + field * soft[..., None]
    alpha = rounded_alpha(W, H, RADIUS)
    im = Image.fromarray(np.dstack([np.clip(out, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA')
    im = im.resize((width, round(width * H / W)), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=0.7, percent=50, threshold=1))
    im.save(os.path.join(OUT, f'menu_{name_of(n)}.webp'), 'WEBP', quality=90, alpha_quality=92, method=6)
    return im


def parchment():
    fr = card(7)
    # the middle of the arched window: plain parchment
    p = fr[230:560, 110:450]
    Image.fromarray(np.clip(p, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'parchment.webp'), 'WEBP', quality=86, method=6)


soft, dist = window_mask()
for n in METALS.values():
    nine_slice(n)
cards = [menu_card(n, soft, dist) for n in METALS.values()]
parchment()
sheet = Image.new('RGB', (len(cards) * 164, 240), (14, 18, 22))
for k, c in enumerate(cards):
    t = c.resize((160, round(160 * H / W)), Image.LANCZOS)
    sheet.paste(t, (k * 164, 2), t)
sheet.save(os.path.join(OUT, 'sheet.png'))
print('ui art →', OUT)
