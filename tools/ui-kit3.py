# The materials of the map-table interface (src/ui/theme3.css): parchment, walnut, cloth, a wax seal,
# ribbons and ink drawings, written into src/ui/kit3.css as data URIs so the page needs no asset pack
# for them (the claude.ai page has none).
#
# Sources (tools/art/kenney-ui3, all CC0, www.kenney.nl; SOURCES.txt there says which pack each file is
# from): the parchments and the ink drawings of the "Cartography Pack", the ribbon, seal and hexagon
# shapes of "UI Pack - Adventure", the dividers and the frame of "Fantasy UI Borders", a medal of
# "Medals"; the walnut is the Poly Haven wood the houses use (assets/tex/wood_d.webp, CC0). The cloth
# weave, the pennant and the torn paper edge are made here.
#   python3 tools/ui-kit3.py
import base64, io, os, random
from PIL import Image, ImageOps, ImageFilter, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'art', 'kenney-ui3')
TEX = os.path.join(HERE, '..', 'assets', 'tex')
OUT = os.path.join(HERE, '..', 'src', 'ui', 'kit3.css')
random.seed(20261113)


def uri(im, fmt='WEBP', q=62):
    buf = io.BytesIO()
    if fmt == 'WEBP':
        im.save(buf, 'WEBP', quality=q, method=6)
        mime = 'image/webp'
    else:
        im.save(buf, 'PNG', optimize=True)
        mime = 'image/png'
    return f'url(data:{mime};base64,' + base64.b64encode(buf.getvalue()).decode() + ')'


def src(name):
    return Image.open(os.path.join(SRC, name))


def alpha_of(im):
    im = im.convert('RGBA')
    return im.split()[3]


def tint(name, rgb, alpha=1.0, size=None):
    """a line drawing or a white sprite in one colour, its own transparency kept"""
    a = alpha_of(src(name))
    if alpha != 1.0:
        a = a.point(lambda v: int(v * alpha))
    out = Image.new('RGBA', a.size, rgb + (255,))
    out.putalpha(a)
    if size:
        out = out.resize(size, Image.LANCZOS)
    return out


def grade(lum, stops):
    """map a greyscale image through colour stops [(0..255, (r, g, b)), ...]"""
    lut = [[], [], []]
    for v in range(256):
        for i in range(len(stops) - 1):
            a, ca = stops[i]
            b, cb = stops[i + 1]
            if a <= v <= b:
                t = (v - a) / max(1, b - a)
                for c in range(3):
                    lut[c].append(int(ca[c] + (cb[c] - ca[c]) * t))
                break
        else:
            for c in range(3):
                lut[c].append(stops[-1][1][c] if v > stops[-1][0] else stops[0][1][c])
    return Image.merge('RGB', [lum.point(lut[c]) for c in range(3)])


rules = {}

# ── paper: two parchments (plain, old and stained) as tiles ──
for key, name in [('parch', 'parchmentBasic'), ('parch-old', 'parchmentAncient')]:
    rules[f'--u3-{key}'] = uri(src(name + '.png').convert('RGB'), q=58)

# ── walnut: the houses' weathered wood turned on its side and stained dark, two planks a tile ──
wood = Image.open(os.path.join(TEX, 'wood_d.webp')).convert('L').rotate(90, expand=True)
wood = ImageOps.autocontrast(wood, cutoff=1)
walnut = grade(wood, [(0, (22, 13, 7)), (110, (58, 36, 20)), (190, (96, 63, 36)), (255, (132, 92, 54))])
d = ImageDraw.Draw(walnut)
for y in (0, 256):
    d.line([(0, y), (512, y)], fill=(10, 6, 3), width=3)
    d.line([(0, y + 3), (512, y + 3)], fill=(110, 76, 44), width=1)
rules['--u3-walnut'] = uri(walnut, q=56)
dark = grade(wood, [(0, (12, 8, 5)), (120, (34, 22, 13)), (200, (58, 38, 22)), (255, (80, 54, 32))])
rules['--u3-walnut-dark'] = uri(dark, q=54)

# ── cloth: a coarse weave in grey, laid over a colour with multiply ──
W = 48
weave = Image.new('L', (W, W), 200)
px = weave.load()
for y in range(W):
    for x in range(W):
        over = ((x // 4) + (y // 4)) % 2
        thread = (x % 4) if over else (y % 4)
        v = 214 - abs(thread - 1.5) * 18 + random.uniform(-10, 10)
        px[x, y] = int(max(0, min(255, v if over else v - 16)))
weave = weave.filter(ImageFilter.GaussianBlur(0.6))
rules['--u3-weave'] = uri(weave.convert('RGB'), 'PNG')

# ── torn paper: a whole sheet of parchment with a ragged, darkened edge, used as a 9-slice with "fill"
#    (slice 48, drawn at 24 px): the panel is that one sheet stretched, so there are no seams ──
def ragged(n, base, amp):
    pts, v = [], 0.0
    for i in range(n):
        v = max(-1.0, min(1.0, v * 0.55 + random.uniform(-1, 1) * 0.9))
        pts.append(base + v * amp + random.uniform(-amp * 0.3, amp * 0.3))
    return pts
def sheet(name, size=512, edge=12, amp=4.5, rim=(112, 76, 44)):
    S = size
    tile = src(name).convert('RGB').resize((S, S), Image.LANCZOS)
    top, bot = ragged(S, edge, amp), ragged(S, S - 1 - edge, amp)
    lef, rig = ragged(S, edge, amp), ragged(S, S - 1 - edge, amp)
    a, b = edge + 2, S - 1 - edge - 2
    poly = [(x, top[x]) for x in range(a, b)] + [(rig[y], y) for y in range(a, b)]
    poly += [(x, bot[x]) for x in range(b - 1, a - 1, -1)] + [(lef[y], y) for y in range(b - 1, a - 1, -1)]
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    # the rim is darker and browner, as old paper is, with a few scorched spots
    dist = mask.filter(ImageFilter.GaussianBlur(9))
    spots = Image.new('L', (S, S), 255)
    sd = ImageDraw.Draw(spots)
    for _ in range(14):
        x, y, r = random.uniform(0, S), random.uniform(0, S), random.uniform(8, 30)
        if min(x, y, S - x, S - y) > 60:
            continue
        sd.ellipse([x - r, y - r, x + r, y + r], fill=int(random.uniform(150, 210)))
    spots = spots.filter(ImageFilter.GaussianBlur(10))
    shade = ImageChops.multiply(dist, spots)
    burnt = ImageChops.multiply(tile, grade(shade, [(0, rim), (170, (214, 182, 134)), (255, (255, 255, 255))]))
    out = burnt.convert('RGBA')
    out.putalpha(mask)
    return out
rules['--u3-sheet'] = uri(sheet('parchmentBasic.png'), q=64)
rules['--u3-sheet-old'] = uri(sheet('parchmentAncient.png', rim=(96, 62, 34)), q=64)
rules['--u3-sheet-fold'] = uri(sheet('parchmentFolded.png', amp=3.5), q=64)

# ── ribbons: the curtain ribbon in crimson cloth, and in dark green for good news ──
def ribbon(stops):
    im = src('banner_classic_curtain.png').convert('RGBA')
    lum = ImageOps.grayscale(im.convert('RGB'))
    lum = ImageOps.autocontrast(lum, cutoff=2)
    col = grade(lum, stops)
    cloth = Image.new('L', im.size)
    for y in range(0, im.size[1], W):
        for x in range(0, im.size[0], W):
            cloth.paste(weave, (x, y))
    col = ImageChops.multiply(col, Image.merge('RGB', [cloth.point(lambda v: min(255, v + 40))] * 3))
    col = col.convert('RGBA')
    col.putalpha(im.split()[3])
    return col
rules['--u3-ribbon'] = uri(ribbon([(0, (40, 6, 5)), (90, (98, 18, 14)), (170, (150, 34, 24)), (255, (196, 66, 46))]), q=74)
rules['--u3-ribbon-green'] = uri(ribbon([(0, (8, 26, 16)), (90, (22, 64, 40)), (170, (38, 98, 62)), (255, (70, 138, 92))]), q=74)
rules['--u3-ribbon-blue'] = uri(ribbon([(0, (8, 16, 34)), (90, (22, 42, 82)), (170, (36, 66, 120)), (255, (68, 102, 160))]), q=74)
rules['--u3-ribbon-ochre'] = uri(ribbon([(0, (40, 24, 6)), (90, (104, 66, 18)), (170, (150, 102, 34)), (255, (196, 146, 62))]), q=74)

# ── shapes used as masks (white where the shape is): the wax seal, the hexagon, a swallow-tailed pennant ──
def white(a):
    out = Image.new('RGBA', a.size, (255, 255, 255, 255))
    out.putalpha(a)
    return out
rules['--u3-seal-mask'] = uri(white(alpha_of(src('round_damaged_brown.png'))), 'PNG')
rules['--u3-hex-mask'] = uri(white(alpha_of(src('hexagon_brown.png'))), 'PNG')
pen = Image.new('L', (64, 96), 0)
ImageDraw.Draw(pen).polygon([(0, 0), (64, 0), (64, 96), (32, 74), (0, 96)], fill=255)
rules['--u3-pennant-mask'] = uri(white(pen.filter(ImageFilter.GaussianBlur(0.5))), 'PNG')

# ── ink drawings for the paper (dark brown ink) ──
INK = (58, 36, 20)
# (each drawing is also used as a mask, in red ink beside a dialog's title: see the vignettes in theme3.css)
for n in ['compass', 'chest', 'ship', 'castleWide', 'castle', 'flag', 'banner', 'elementShield', 'lighthouse', 'mill', 'houses',
          'towerWatch', 'rocksMountain', 'mine', 'waterWheel', 'gate']:
    rules[f'--u3-ink-{n}'] = uri(tint(n + '.png', INK, 0.9), 'PNG')
# the sea's waves, drawn faintly, as a tile
rules['--u3-ink-waves'] = uri(tint('textureWater.png', INK, 0.4), 'PNG')

# ── a medal for the awards (longest road, largest army): Kenney's medal with its disc in brass and its
#    ribbon in crimson with a gilt stripe ──
def medal():
    im = src('shaded_medal3.png').convert('RGBA')
    out = Image.new('RGBA', im.size)
    pi, po = im.load(), out.load()
    crimson = [(0, (40, 6, 5)), (110, (98, 18, 14)), (180, (150, 34, 24)), (255, (190, 62, 44))]
    gilt = [(0, (90, 60, 20)), (160, (200, 160, 80)), (230, (240, 214, 150)), (255, (255, 240, 200))]
    brass = [(0, (60, 36, 10)), (120, (150, 105, 40)), (190, (214, 168, 86)), (240, (246, 222, 150)), (255, (255, 244, 205))]
    def ramp(stops, v):
        for i in range(len(stops) - 1):
            a, ca = stops[i]
            b, cb = stops[i + 1]
            if a <= v <= b:
                t = (v - a) / max(1, b - a)
                return tuple(int(ca[k] + (cb[k] - ca[k]) * t) for k in range(3))
        return stops[-1][1]
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            r, g, b, a = pi[x, y]
            if not a:
                continue
            lum = (r * 299 + g * 587 + b * 114) / 1000
            if y < 4 or y >= 40:  # the clasp and the disc
                c = ramp(brass, lum)
            elif r - max(g, b) > 25:  # the ribbon's red
                c = ramp(crimson, lum + (255 - lum) * 0.35)
            else:  # its white stripe
                c = ramp(gilt, lum)
            po[x, y] = c + (a,)
    return out
rules['--u3-medal'] = uri(medal(), 'PNG')

# ── dividers and a frame drawn in ink on paper ──
rules['--u3-div-ink'] = uri(tint('divider-fade-000.png', INK, 0.85), 'PNG')
rules['--u3-div-ink-l'] = uri(ImageOps.mirror(tint('divider-fade-000.png', INK, 0.85)), 'PNG')
rules['--u3-rule-ink'] = uri(tint('divider-005.png', INK, 0.7), 'PNG')
rules['--u3-frame-ink'] = uri(tint('panel-border-019.png', INK, 0.75), 'PNG')

css = ['/* generated by tools/ui-kit3.py (Kenney CC0 art, Poly Haven CC0 wood): do not edit */', ':root {']
css += [f'  {k}: {v};' for k, v in rules.items()]
css += ['}', '']
open(OUT, 'w').write('\n'.join(css))
total = sum(len(v) for v in rules.values())
print('wrote', os.path.normpath(OUT), f'{total / 1024:.0f} KB of images in {len(rules)} variables')
for k, v in sorted(rules.items(), key=lambda kv: -len(kv[1]))[:8]:
    print(f'  {k}: {len(v) / 1024:.1f} KB')
