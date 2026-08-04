#!/usr/bin/env python3
"""Turn raw Overpass JSON for Jeddah's Corniche into a compact local-metre scene."""
import json, math, hashlib

BUILDINGS = 'jed_buildings_all.json'
ROADS     = 'jed_roads.json'
COAST     = 'jed_coast.json'
OUT       = 'jeddah-scene.json'

SPINE_RE = ('corniche', 'kurnaysh', 'كورنيش')


def is_spine(t):
    n = ((t.get('name:en') or '') + ' ' + (t.get('name') or '')).lower()
    return any(k in n for k in SPINE_RE) and t.get('highway') != 'raceway'


bj = json.load(open(BUILDINGS))['elements']
rj = json.load(open(ROADS))['elements']
try:
    cj = json.load(open(COAST))['elements']
except Exception:
    cj = []

# the Floating Mosque block sits just north of the main tile grid
try:
    extra = json.load(open('jed_mosque_area.json'))['elements']
    seen_ids = {(e.get('type'), e.get('id')) for e in bj}
    for e in extra:
        k = (e.get('type'), e.get('id'))
        if k in seen_ids:
            continue
        if e.get('tags', {}).get('natural') == 'coastline':
            cj.append(e)
        elif 'building' in e.get('tags', {}):
            bj.append(e)
except Exception as ex:
    print('no mosque-area file:', ex)

# ---------- centre: the corniche itself ----------
spine_pts = []
for e in rj:
    if e.get('type') == 'way' and is_spine(e.get('tags', {})):
        for g in e.get('geometry') or []:
            if g:
                spine_pts.append((g['lon'], g['lat']))
if not spine_pts:
    raise SystemExit('no corniche ways found in roads file')

lat0 = sum(p[1] for p in spine_pts) / len(spine_pts)
lon0 = sum(p[0] for p in spine_pts) / len(spine_pts)
KX = 111320.0 * math.cos(math.radians(lat0))
KZ = 110574.0


def prj(lon, lat):
    return (round((lon - lon0) * KX, 1), round((lat0 - lat) * KZ, 1))


def ring_area(r):
    s = 0.0
    for i in range(len(r) - 1):
        s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
    return s / 2.0


def simplify(r, tol=0.8):
    out = [r[0]]
    for p in r[1:]:
        dx, dy = p[0] - out[-1][0], p[1] - out[-1][1]
        if dx * dx + dy * dy >= tol * tol:
            out.append(p)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def h_hash(key, lo, hi):
    v = int(hashlib.md5(str(key).encode()).hexdigest()[:6], 16) / 0xFFFFFF
    return lo + v * (hi - lo)


def parse_h(v):
    try:
        return float(str(v).lower().replace('m', '').replace(',', '.').strip())
    except Exception:
        return None


def parse_levels(v):
    try:
        return max(float(x) for x in str(v).replace(';', ',').split(',') if x.strip())
    except Exception:
        return None


# published heights for towers OSM leaves untagged / undertagged
OVERRIDES = {
    'Aqua Tower': 251.0,
    'Headquarters Business Park': 174.0,
    'Rosewood': 155.0,
    'Raffles Jeddah': 150.0,
    'Park Hyatt Jeddah': 90.0,
    'Four Seasons Hotel': 100.0,
    'Trump Towers': 120.0,
    'Jeddah Municipality': 60.0,
}


def bname(t):
    return t.get('name:en') or t.get('name') or ''


def height_for(t, area, key):
    n = bname(t)
    if n in OVERRIDES:
        return OVERRIDES[n]
    h = parse_h(t.get('height'))
    if h:
        return h
    lv = parse_levels(t.get('building:levels'))
    if lv and lv > 0:
        return lv * 3.5
    bt = t.get('building', 'yes')
    if bt == 'house':
        return round(h_hash(key, 4.5, 7.5), 1)
    if bt in ('residential', 'apartments'):
        return round(h_hash(key, 9, 20), 1)
    if bt == 'mosque':
        return round(h_hash(key, 8, 12), 1)
    if bt in ('school', 'public', 'civic', 'government'):
        return round(h_hash(key, 7, 12), 1)
    if bt == 'hospital':
        return round(h_hash(key, 14, 22), 1)
    if bt in ('commercial', 'retail', 'office', 'hotel'):
        big = min(1.0, area / 4000.0)
        return round(h_hash(key, 10, 26) * (1 - 0.35 * big) + big * 4, 1)
    return round(h_hash(key, 6, 16), 1)


def category(t, h, name):
    bt = t.get('building', 'yes')
    n = name.lower()
    if bt == 'mosque' or 'masjid' in n or 'mosque' in n or 'مسجد' in name or 'جامع' in name:
        return 'mq'
    if h >= 85:
        return 'lm'
    if h >= 35:
        return 'md'
    if bt in ('house', 'residential', 'apartments'):
        return 'rs'
    if bt in ('school', 'hospital', 'public', 'train_station', 'government', 'civic'):
        return 'cv'
    return 'cm'


def stitch(parts):
    segs = [list(map(tuple, p)) for p in parts]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]; segs.pop(i); changed = True; break
                if s[-1] == cur[-1]:
                    cur += list(reversed(s))[1:]; segs.pop(i); changed = True; break
                if s[-1] == cur[0]:
                    cur = s + cur[1:]; segs.pop(i); changed = True; break
                if s[0] == cur[0]:
                    cur = list(reversed(s)) + cur[1:]; segs.pop(i); changed = True; break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
    return rings


# ---------- buildings ----------
buildings = []
for e in bj:
    t = e.get('tags', {})
    geom = e.get('geometry')
    if e.get('type') == 'way':
        if not geom:
            continue
        rings_ll = [[(g['lon'], g['lat']) for g in geom if g]]
    else:  # relation (multipolygon)
        outers = [[(g['lon'], g['lat']) for g in m.get('geometry') or [] if g]
                  for m in e.get('members', []) if m.get('role') == 'outer']
        outers = [o for o in outers if len(o) >= 3]
        if not outers:
            continue
        rings_ll = stitch(outers) or outers
    rings = [simplify([prj(*p) for p in r]) for r in rings_ll]
    rings = [r for r in rings if len(r) >= 3]
    if not rings:
        continue
    rings.sort(key=lambda r: -abs(ring_area(r + [r[0]])))
    outer, holes = rings[0], rings[1:]
    area = abs(ring_area(outer + [outer[0]]))
    if area < 25:
        continue
    if ring_area(outer + [outer[0]]) < 0:
        outer = outer[::-1]
    holes = [h[::-1] if ring_area(h + [h[0]]) > 0 else h for h in holes]

    name = bname(t)
    key = e.get('id') or name or area
    h = height_for(t, area, key)
    b = {'h': round(h, 1), 'c': category(t, h, name),
         'o': [c for pt in outer for c in pt]}
    if holes:
        b['i'] = [[c for pt in hh for c in pt] for hh in holes]
    if name:
        b['n'] = name
    buildings.append(b)

# ---------- the Floating Mosque is a node in OSM: give it a footprint ----------
MOSQUE = (21.5971, 39.1054, 'Island Mosque')       # Al-Rahmah, out over the water
mx, mz = prj(MOSQUE[1], MOSQUE[0])
if not any(b.get('n') == MOSQUE[2] for b in buildings):
    s = 15.0                                        # ~30 m platform, interpreted
    ring = [(mx - s, mz - s), (mx + s, mz - s), (mx + s, mz + s), (mx - s, mz + s)]
    buildings.append({'h': 10.0, 'c': 'mq', 'n': MOSQUE[2],
                      'o': [c for pt in ring for c in pt]})

# labels: tallest named, latin-script, deduped
seen, labels = set(), []
for b in sorted([b for b in buildings if b.get('n') and b['h'] >= 45],
                key=lambda b: -b['h']):
    nm = b['n']
    if nm in seen or any(ord(ch) > 0x0590 for ch in nm):
        continue
    seen.add(nm)
    labels.append(nm)
labels = labels[:14]
for b in buildings:
    if b.get('n') in labels:
        b['lb'] = 1

# ---------- roads ----------
def road_class(t):
    hw = t.get('highway', '')
    if is_spine(t):
        return 'kf'
    if hw in ('motorway', 'trunk', 'primary'):
        return 'mj'
    if hw.endswith('_link'):
        return 'lk'
    if hw == 'secondary':
        return 'mj'
    return 'mn'


roads = []
for e in rj:
    geom = e.get('geometry')
    if not geom:
        continue
    t = e.get('tags', {})
    pts = simplify([prj(g['lon'], g['lat']) for g in geom if g], tol=2.0)
    if len(pts) >= 2:
        roads.append({'c': road_class(t), 'p': [c for pt in pts for c in pt]})

# ---------- water: close the coastline into a sea polygon to the west ----------
water = []
coast_parts = []
for e in cj:
    t = e.get('tags', {})
    geom = e.get('geometry')
    if not geom:
        continue
    pts = [(g['lon'], g['lat']) for g in geom if g]
    if len(pts) < 2:
        continue
    if t.get('natural') == 'coastline':
        coast_parts.append(pts)
    else:  # already-closed water bodies (lagoons, the fountain basin)
        r = simplify([prj(*p) for p in pts], tol=3.0)
        if len(r) >= 3 and abs(ring_area(r + [r[0]])) > 400:
            water.append([c for pt in r for c in pt])

# The Red Sea: OSM coastline arrives as fragmented chains, so instead of trying to
# stitch them, derive the shore per z-band from the coastline, the corniche and the
# westmost buildings, then flood everything west of it.
coast_pts = []
for ch in coast_parts:
    coast_pts.extend(prj(*p) for p in ch)

bld_pts = []
for b in buildings:
    xs, zs = b['o'][0::2], b['o'][1::2]
    bld_pts.append((min(xs), sum(zs) / len(zs)))
spine_local_all = [prj(*p) for p in spine_pts]

allz = [p[1] for p in bld_pts] + [p[1] for p in coast_pts]
z0, z1 = min(allz), max(allz)
BAND = 220.0
nb = max(2, int((z1 - z0) / BAND) + 1)
shore = [None] * nb


def note(x, z, pad):
    i = int((z - z0) / BAND)
    if 0 <= i < nb:
        v = x - pad
        if shore[i] is None or v < shore[i]:
            shore[i] = v


for x, z in coast_pts:
    note(x, z, 0)                     # the true coastline wins where it exists
for x, z in spine_local_all:
    note(x, z, 90)                    # else the corniche, minus its park strip
for x, z in bld_pts:
    note(x, z, 40)                    # else the westmost building edge

# fill gaps by carrying the nearest known value
last = None
for i in range(nb):
    if shore[i] is None:
        shore[i] = last
    else:
        last = shore[i]
last = None
for i in range(nb - 1, -1, -1):
    if shore[i] is None:
        shore[i] = last
    else:
        last = shore[i]

if any(s is not None for s in shore):
    # light smoothing so the shore reads as a drawn line, not a staircase
    sm = shore[:]
    for _ in range(2):
        sm = [sm[i] if i in (0, nb - 1) else (sm[i - 1] + sm[i] + sm[i + 1]) / 3.0
              for i in range(nb)]
    edge = [(sm[i], z0 + BAND * i) for i in range(nb) if sm[i] is not None]
    if len(edge) >= 2:
        west = min(p[0] for p in edge) - 5000
        poly = edge + [(west, edge[-1][1] + BAND), (west, edge[0][1] - BAND)]
        water.append([c for pt in poly for c in pt])

# ---------- presets + scrub anchors, derived from the data ----------
def centroid(b):
    xs = b['o'][0::2]; zs = b['o'][1::2]
    return sum(xs) / len(xs), sum(zs) / len(zs)


named = {}
for b in buildings:
    if b.get('n'):
        named.setdefault(b['n'], b)
        if b['h'] > named[b['n']]['h']:
            named[b['n']] = b

zs = [centroid(b)[1] for b in buildings]
xs = [centroid(b)[0] for b in buildings]
extent_z = max(zs) - min(zs)
cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2

presets = {'overview': {'label': 'Corniche', 'tx': round(cx), 'tz': round(cz),
                        'azim': -0.35, 'elev': 0.9, 'size': round(extent_z * 1.02)}}


def add_preset(key, label, name, azim, elev, size, dz=0):
    b = named.get(name)
    if not b:
        return None
    x, z = centroid(b)
    presets[key] = {'label': label, 'tx': round(x), 'tz': round(z + dz),
                    'azim': azim, 'elev': elev, 'size': size}
    return (x, z + dz)


# King Fahd's Fountain — an OSM node, carried as a scene feature (312 m jet)
FOUNTAIN = (21.5156595, 39.1450461, 312.0)
fx, fz = prj(FOUNTAIN[1], FOUNTAIN[0])

# The fountain stands in the Corniche lagoon, which OSM maps only as coastline
# fragments. Rebuild it as the hull of the coastline around the fountain so the
# jet rises from water rather than from the pavement.
try:
    lag = json.load(open('jed_lagoon.json'))['elements']
except Exception:
    lag = []
near = []
for e in lag:
    for g in e.get('geometry') or []:
        if not g:
            continue
        p = prj(g['lon'], g['lat'])
        if (p[0] - fx) ** 2 + (p[1] - fz) ** 2 < 500 ** 2:
            near.append(p)

if len(near) >= 8:
    def hull(pts):
        pts = sorted(set(pts))
        def half(ps):
            h = []
            for p in ps:
                while len(h) >= 2 and ((h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) -
                                       (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0])) <= 0:
                    h.pop()
                h.append(p)
            return h
        return half(pts)[:-1] + half(pts[::-1])[:-1]

    lagoon = hull(near)
    if len(lagoon) >= 3:
        # how much of it lands on buildings? (a sanity check, printed below)
        def inside(pt, poly):
            x, y = pt
            c = False
            n = len(poly)
            for i in range(n):
                a, b = poly[i], poly[(i + 1) % n]
                if (a[1] > y) != (b[1] > y):
                    xx = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
                    if x < xx:
                        c = not c
            return c
        hits = sum(1 for b in buildings
                   if inside((sum(b['o'][0::2]) / (len(b['o']) // 2),
                              sum(b['o'][1::2]) / (len(b['o']) // 2)), lagoon))
        print('lagoon hull: %d verts, %d buildings inside' % (len(lagoon), hits))
        water.append([c for pt in lagoon for c in pt])

# the fountain itself stands offshore: give its basin a disc of open water,
# sized to the largest radius that still clears every mapped building
bcent = [(sum(b['o'][0::2]) / (len(b['o']) // 2),
          sum(b['o'][1::2]) / (len(b['o']) // 2)) for b in buildings]
best_r = 0
for r in (300, 260, 220, 180, 140, 110, 85, 65, 45):
    if not any((c[0] - fx) ** 2 + (c[1] - fz) ** 2 < r * r for c in bcent):
        best_r = r
        break
if best_r:
    disc = [(fx + best_r * math.cos(2 * math.pi * i / 26),
             fz + best_r * math.sin(2 * math.pi * i / 26)) for i in range(26)]
    water.append([c for pt in disc for c in pt])
    print('fountain basin: r=%dm' % best_r)
else:
    print('fountain basin: skipped (buildings too close)')
features = [{'t': 'fountain', 'x': round(fx, 1), 'z': round(fz, 1), 'h': FOUNTAIN[2]}]

presets['fountain'] = {'label': 'Fountain', 'tx': round(fx), 'tz': round(fz),
                       'azim': -0.9, 'elev': 0.42, 'size': 1300}
add_preset('aqua', 'Aqua Tower', 'Aqua Tower', -0.5, 0.5, 900)
presets['mosque'] = {'label': 'Floating Mosque', 'tx': round(mx), 'tz': round(mz),
                     'azim': -1.0, 'elev': 0.42, 'size': 420}
add_preset('balad', 'Al Balad', 'Jeddah Municipality', -0.3, 0.6, 1600)

# scrub path: ride the story, not just the road — Al Balad, the fountain,
# Aqua Tower, then out to the Floating Mosque, south → north
def at(name, dx=0, dz=0):
    b = named.get(name)
    if not b:
        return None
    x, z = centroid(b)
    return (x + dx, z + dz)

stops = [at('Jeddah Municipality'), (fx, fz), at('Aqua Tower'), (mx, mz)]
stops = [s for s in stops if s]
if len(stops) < 2:                       # fall back to the road itself
    sl = sorted([prj(*p) for p in spine_pts], key=lambda p: -p[1])
    stops = [sl[int((len(sl) - 1) * i / 3)] for i in range(4)]

SIZES = [1700, 1400, 950, 320]      # tighten right down onto the mosque
ELEVS = [0.46, 0.48, 0.50, 0.34]    # and drop low for its silhouette
AZIMS = [-0.95, -0.80, -0.62, -0.42]
anchors = []
for i, s in enumerate(stops):
    anchors.append({'tx': round(s[0]), 'tz': round(s[1]),
                    'azim': AZIMS[i] if i < len(AZIMS) else -0.6,
                    'elev': ELEVS[i] if i < len(ELEVS) else 0.48,
                    'size': SIZES[i] if i < len(SIZES) else 1400})

scene = {
    'meta': {'city': 'Jeddah', 'spine': 'Corniche Road',
             'center': [round(lat0, 6), round(lon0, 6)],
             'attribution': '© OpenStreetMap contributors'},
    'buildings': buildings,
    'roads': roads,
    'water': water,
    'features': features,
    'presets': presets,
    'anchors': anchors,
}
json.dump(scene, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)

import os
from collections import Counter
print('buildings:', len(buildings), Counter(b['c'] for b in buildings))
print('roads:', len(roads), Counter(r['c'] for r in roads))
print('water polygons:', len(water))
print('labels:', labels)
print('presets:', list(presets))
print('size: %.2f MB' % (os.path.getsize(OUT) / 1e6))
