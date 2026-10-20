#!/usr/bin/env python3
"""TinTito mascot: a Yorkie knight. Pixel grid -> PNG + SVG."""
import os, struct, zlib

W = H = 40

PAL = {
    '.': None,
    'o': (32, 26, 36, 255),       # outline
    't': (201, 139, 85, 255),     # tan fur
    'T': (231, 178, 123, 255),    # tan light
    'd': (147, 96, 60, 255),      # tan dark
    'b': (241, 227, 199, 255),    # beard
    'B': (214, 194, 159, 255),    # beard shadow
    's': (150, 163, 182, 255),    # steel
    'S': (219, 227, 236, 255),    # steel light
    'g': (92, 104, 122, 255),     # steel dark
    'G': (232, 187, 88, 255),     # gold
    'H': (247, 220, 146, 255),    # gold light
    'r': (213, 74, 60, 255),      # plume
    'R': (156, 47, 39, 255),      # plume dark
    'e': (23, 19, 27, 255),       # eye / nose
    'w': (255, 255, 255, 255),    # glint
    'p': (217, 128, 128, 255),    # tongue
    'c': (67, 83, 109, 255),      # blue cloth
    'C': (93, 112, 142, 255),     # blue light
    'n': (47, 59, 79, 255),       # blue dark
}

class Canvas:
    def __init__(self, w=W, h=H):
        self.w, self.h = w, h
        self.g = [['.' for _ in range(w)] for _ in range(h)]
    def p(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.g[y][x] = c
    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.p(x, y, c)
    def rows(self, y, spec, x0=0):
        for dx, c in enumerate(spec):
            self.p(x0 + dx, y, c)

c = Canvas()

# ---- plume / crest: a flame sweeping back over the helm ----
crest_rows = {
    1: [20, 21],
    2: [18, 19, 20, 21],
    3: [16, 17, 18, 19, 20, 21],
    4: [15, 16, 17, 18, 19, 20, 21, 22],
    5: [16, 17, 18, 19, 20, 21, 22],
    6: [18, 19, 20, 21, 22],
}
for y, xs in crest_rows.items():
    for x in xs:
        c.p(x, y, 'r')
# shaded lee side + underside
for x, y in [(21, 2), (22, 4), (22, 5), (21, 5), (22, 3), (20, 4), (21, 4),
             (18, 6), (19, 6), (20, 6), (21, 6), (22, 6)]:
    c.p(x, y, 'R')
for x, y in [(15, 4), (16, 4), (16, 5)]:
    c.p(x, y, 'R')

# ---- ears (small, erect Yorkie triangles) ----
left_ear = [
    (12, 3),
    (12, 4), (13, 4),
    (11, 5), (12, 5), (13, 5),
    (10, 6), (11, 6), (12, 6), (13, 6), (14, 6),
    (9, 7), (10, 7), (11, 7), (12, 7), (13, 7), (14, 7),
    (9, 8), (10, 8), (11, 8), (12, 8), (13, 8), (14, 8),
    (10, 9), (11, 9), (12, 9), (13, 9), (14, 9),
    (10, 10), (11, 10), (12, 10), (13, 10), (14, 10),
    (11, 11), (12, 11), (13, 11), (14, 11),
    (12, 12), (13, 12), (14, 12),
]
for x, y in left_ear:
    c.p(x, y, 't')
# darker inner ear
for x, y in [(12, 4), (11, 5), (12, 5), (11, 6), (12, 6), (13, 6),
             (10, 7), (11, 7), (12, 7), (13, 7),
             (10, 8), (11, 8), (12, 8), (11, 9), (12, 9), (11, 10)]:
    c.p(x, y, 'd')
for y in (6, 7, 8):
    c.p(12, y, 'p')

# right ear, mirrored about the head centre (x=20)
right_ear = [(40 - x, y) for x, y in left_ear]
for x, y in right_ear:
    c.p(x, y, 't')
for x, y in [(40 - x, y) for x, y in [(12, 4), (11, 5), (12, 5), (11, 6), (12, 6), (13, 6),
             (10, 7), (11, 7), (12, 7), (13, 7),
             (10, 8), (11, 8), (12, 8), (11, 9), (12, 9), (11, 10)]]:
    c.p(x, y, 'd')
for y in (6, 7, 8):
    c.p(40 - 12, y, 'p')

# ---- helmet dome ----
for y in range(6, 13):
    c.rect(15, y, 25, y, 's')
# round the top corners
for x, y in [(15, 6), (25, 6), (15, 7), (25, 7)]:
    c.p(x, y, '.')
c.rect(16, 5, 24, 5, 's')
# highlight
c.rect(17, 6, 19, 6, 'S')
c.rect(16, 6, 17, 7, 'S')
c.rect(18, 7, 19, 7, 'S')
c.p(16, 8, 'S')
# lower dome shading
c.rect(16, 10, 24, 10, 'g')
c.rect(16, 11, 24, 11, 's')
# brim
c.rect(14, 12, 26, 12, 'S')
c.rect(14, 13, 26, 13, 's')
c.rect(14, 13, 26, 13, 'g')
# rivets on brim
c.p(16, 12, 'G'); c.p(20, 12, 'G'); c.p(24, 12, 'G')
# center ridge
c.rect(20, 5, 20, 11, 'S')

# ---- face ----
c.rect(15, 14, 25, 20, 't')
c.rect(16, 13, 24, 13, 't')
# cheek fur tufts
for x, y in [(14, 15), (14, 16), (14, 17), (13, 16), (13, 17), (13, 18), (14, 18),
             (26, 15), (26, 16), (26, 17), (27, 16), (27, 17), (27, 18), (26, 18)]:
    c.p(x, y, 't')
# forehead fur under helmet
c.rect(17, 14, 23, 14, 'T')
# eyes
c.rect(18, 15, 19, 16, 'e')
c.rect(22, 15, 23, 16, 'e')
c.p(18, 15, 'w'); c.p(22, 15, 'w')
# eyebrows / fur
c.p(17, 14, 'd'); c.p(24, 14, 'd')

# muzzle + beard
c.rect(18, 18, 22, 21, 'b')
c.rect(17, 19, 23, 20, 'b')
c.rect(17, 21, 23, 22, 'b')
c.rect(18, 23, 22, 23, 'b')
# beard points
c.rect(16, 22, 24, 22, 'b')
c.rect(16, 23, 24, 24, 'b')
c.rect(17, 25, 23, 25, 'b')
c.rect(18, 26, 22, 26, 'b')
c.p(16, 25, 'B'); c.p(23, 25, 'B'); c.p(17, 24, 'B'); c.p(22, 24, 'B'); c.p(18, 26, 'B'); c.p(21, 26, 'B')
# nose
c.rect(19, 18, 21, 19, 'e')
c.p(20, 18, 'g')
# mouth
c.p(20, 20, 'e'); c.p(19, 21, 'e'); c.p(21, 21, 'e')
# tongue
c.rect(20, 22, 21, 22, 'p')

# ---- helmet cheek guards ----
c.rect(13, 14, 14, 19, 's')
c.rect(26, 14, 27, 19, 's')
c.rect(13, 14, 13, 19, 'S')
c.rect(27, 14, 27, 19, 'g')
c.rect(13, 19, 14, 19, 'g')
c.rect(26, 19, 27, 19, 'g')
# gold studs
c.p(13, 16, 'G'); c.p(27, 16, 'G')

# ---- gorget / collar ----
c.rect(16, 26, 24, 27, 'G')
c.rect(16, 27, 24, 27, 'H')
c.rect(18, 27, 22, 27, 'G')

# ---- torso ----
c.rect(15, 28, 25, 34, 'c')
c.rect(15, 28, 15, 34, 'C')
c.rect(25, 28, 25, 34, 'n')
# tabard stripe
c.rect(19, 28, 21, 34, 'C')
c.p(20, 29, 'H'); c.p(20, 32, 'H')
# belt
c.rect(15, 33, 25, 34, 'G')
c.rect(15, 34, 25, 34, 'H')
c.rect(19, 33, 21, 34, 'H')
# legs
c.rect(16, 35, 19, 37, 'c')
c.rect(22, 35, 25, 37, 'c')
c.rect(16, 35, 16, 37, 'C')
c.rect(25, 35, 25, 37, 'n')
# boots
c.rect(15, 38, 19, 38, 's')
c.rect(22, 38, 26, 38, 's')
c.rect(15, 39, 19, 39, 'g')
c.rect(22, 39, 26, 39, 'g')
c.rect(14, 39, 15, 39, 'S')
c.rect(27, 39, 28, 39, 'S')

# ---- left arm + paw ----
c.rect(12, 28, 15, 32, 'c')
c.rect(12, 28, 12, 32, 'C')
c.rect(11, 32, 14, 34, 't')
c.rect(11, 32, 11, 34, 'T')
c.p(11, 35, 'd'); c.p(12, 35, 'd'); c.p(13, 35, 'd'); c.p(14, 35, 'd')
c.p(12, 34, 'B'); c.p(13, 34, 'B')

# ---- sword arm (right) ----
c.rect(26, 27, 30, 29, 'c')
c.rect(26, 28, 30, 29, 'n')
# pauldron
c.rect(25, 25, 29, 27, 's')
c.rect(25, 25, 29, 25, 'S')
c.rect(25, 27, 29, 27, 'g')
c.p(27, 26, 'G')

# ---- sword ----
# blade (tip at y=3)
c.rect(33, 4, 33, 22, 'S')
c.rect(34, 3, 34, 22, 'S')
c.rect(35, 4, 35, 22, 's')
c.p(34, 2, 'S')
c.p(33, 3, 's'); c.p(35, 3, 'g')
c.p(33, 22, 'S'); c.p(35, 22, 'g')
# fuller
c.rect(34, 5, 34, 21, 'w')
# crossguard, tips curled up
c.rect(28, 23, 38, 23, 'G')
c.rect(28, 24, 38, 24, 'H')
c.p(28, 22, 'H'); c.p(38, 22, 'H')
c.p(27, 23, 'g'); c.p(39, 23, 'g')
# grip
c.rect(33, 25, 35, 29, 'n')
c.p(33, 26, 'g'); c.p(35, 26, 'g'); c.p(33, 28, 'g'); c.p(35, 28, 'g')
# pommel
c.rect(33, 30, 35, 30, 'G')
c.p(34, 31, 'G')
# paw gripping below the guard
c.rect(30, 25, 32, 29, 't')
c.rect(30, 25, 30, 29, 'T')
c.rect(27, 28, 30, 29, 't')
c.p(31, 26, 'd'); c.p(32, 26, 'd')
c.p(31, 28, 'd'); c.p(32, 28, 'd')
c.p(31, 29, 'd'); c.p(32, 29, 'd')
c.p(33, 27, 'T'); c.p(33, 29, 'd')
# claws on the outer edge
c.p(29, 25, 'd'); c.p(29, 29, 'd')

# ---- derive outline around transparent boundaries ----
src = [row[:] for row in c.g]
for y in range(H):
    for x in range(W):
        if c.g[y][x] != '.':
            continue
        neighbours = []
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and src[ny][nx] != '.':
                neighbours.append(src[ny][nx])
        if neighbours:
            c.g[y][x] = 'o'

def rgba(char):
    return PAL[char]

def png_bytes(scale=1, bg=None, pad=0):
    w = (W + pad * 2) * scale
    h = (H + pad * 2) * scale
    rows = []
    for y in range(h):
        row = bytearray([0])
        gy = y // scale - pad
        for x in range(w):
            gx = x // scale - pad
            col = None
            if 0 <= gx < W and 0 <= gy < H:
                col = rgba(c.g[gy][gx])
            if col is None:
                col = bg if bg is not None else (0, 0, 0, 0)
            row.extend(col)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))

def svg_text():
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges" role="img" aria-label="TinTito, a Yorkie knight holding a sword">' % (W, H)]
    # merge horizontal runs, one rect per run
    for y in range(H):
        x = 0
        while x < W:
            ch = c.g[y][x]
            if ch == '.':
                x += 1
                continue
            x2 = x
            while x2 + 1 < W and c.g[y][x2 + 1] == ch:
                x2 += 1
            r, g, b, a = PAL[ch]
            parts.append(f'<rect x="{x}" y="{y}" width="{x2 - x + 1}" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>')
            x = x2 + 1
    parts.append('</svg>')
    return ''.join(parts)

def grid_json():
    import json
    rows = []
    for y in range(H):
        row = []
        for x in range(W):
            ch = c.g[y][x]
            if ch == '.':
                row.append(None)
            else:
                r, g, b, a = PAL[ch]
                row.append('#%02x%02x%02x' % (r, g, b))
        rows.append(row)
    return json.dumps(rows, separators=(',', ':'))

if __name__ == '__main__':
    os.makedirs('public/icons', exist_ok=True)
    os.makedirs('assets', exist_ok=True)
    open('assets/tintito-logo.svg', 'w').write(svg_text())
    open('assets/mascot-grid.json', 'w').write(grid_json())
    open('assets/tintito-logo-preview.png', 'wb').write(png_bytes(scale=14))
    # app icons: full-bleed, safe-zone art, dark ground
    for size, pad, scale in [(180, 10, 3), (192, 4, 4), (512, 12, 8), (1024, 12, 16)]:
        open(f'public/icons/icon-{size}.png', 'wb').write(
            png_bytes(scale=scale, bg=(16, 23, 35, 255), pad=pad))
    print('wrote logo + icons')
