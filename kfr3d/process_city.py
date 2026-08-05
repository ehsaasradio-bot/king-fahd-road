#!/usr/bin/env python3
"""Turn raw Overpass JSON for a city into a compact local-metre scene.

    python3 process_city.py dammam
    python3 process_city.py makkah
"""
import json, math, hashlib, sys, os

CITIES = {
    'dammam': {
        'label': 'Dammam',
        'spine': 'King Saud Street',
        'spine_keys': ('king saud',),
        'coast': True,
        'corridor': 550,
        'overrides': {},
        'ride': [],                      # filled from tallest named if empty
    },
    'makkah': {
        'label': 'Makkah',
        'spine': 'Ibrahim Al Khalil Road',
        'spine_keys': ('ibrahim al khalil', 'ibrahim alkhalil', 'إبراهيم الخليل'),
        'coast': False,
        'corridor': 1100,
        'overrides': {
            'Abraj Al Bait': 601.0,
            'Makkah Royal Clock Tower': 601.0,
            'Abraj Al-Bait Towers': 601.0,
        },
        'ride': [],
    },
}

CITY = sys.argv[1]
cfg = CITIES[CITY]
OUT = '%s-scene.json' % CITY


def is_spine(t):
    n = ((t.get('name:en') or '') + ' ' + (t.get('name') or '')).lower()
    return any(k in n for k in cfg['spine_keys'])


bj = json.load(open('%s_buildings.json' % CITY))['elements']
rj = json.load(open('%s_roads.json' % CITY))['elements']
cj = []
if cfg['coast'] and os.path.exists('%s_coast.json' % CITY):
    cj = json.load(open('%s_coast.json' % CITY))['elements']

# ---------- centre on the spine (fall back to all roads) ----------
spine_pts = []
for e in rj:
    if e.get('type') == 'way' and is_spine(e.get('tags', {})):
        for g in e.get('geometry') or []:
            if g:
                spine_pts.append((g['lon'], g['lat']))
if not spine_pts:
    print('!! spine not found, centring on all roads')
    for e in rj:
        for g in (e.get('geometry') or [])[:4]:
            if g:
                spine_pts.append((g['lon'], g['lat']))

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


def bname(t):
    return t.get('name:en') or t.get('name') or ''


def height_for(t, area, key):
    n = bname(t)
    if n in cfg['overrides']:
        return cfg['overrides'][n]
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
    else:
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

# ---------- keep only the corridor along the spine ----------
# A whole-metro bbox runs to tens of thousands of buildings; these scenes are
# corridors, so drop anything further than `corridor` metres from the spine.
R = cfg.get('corridor')
if R:
    CELL = 250.0
    grid = {}
    for p in [prj(*q) for q in spine_pts]:
        grid.setdefault((int(p[0] // CELL), int(p[1] // CELL)), []).append(p)

    def near_spine(x, z, rad):
        gx, gz = int(x // CELL), int(z // CELL)
        span = int(rad // CELL) + 1
        for a in range(gx - span, gx + span + 1):
            for b in range(gz - span, gz + span + 1):
                for p in grid.get((a, b), ()):
                    if (p[0] - x) ** 2 + (p[1] - z) ** 2 <= rad * rad:
                        return True
        return False

    before = len(buildings)
    kept = []
    for b in buildings:
        xs, zs = b['o'][0::2], b['o'][1::2]
        cx0, cz0 = sum(xs) / len(xs), sum(zs) / len(zs)
        if near_spine(cx0, cz0, R):
            kept.append(b)
        elif (b.get('n') or b['h'] >= 35) and near_spine(cx0, cz0, R * 3):
            kept.append(b)          # landmarks just off the corridor still count
    buildings = kept
    print('  corridor %dm: %d -> %d buildings' % (R, before, len(buildings)))

# labels
seen, labels = set(), []
def foot(b):
    xs, zs = b['o'][0::2], b['o'][1::2]
    a = 0.0
    n = len(xs)
    for i in range(n):
        j = (i + 1) % n
        a += xs[i] * zs[j] - xs[j] * zs[i]
    return abs(a / 2)

# a label needs real presence: a shop unit with a name is not a landmark
BAR = 40 if sum(1 for b in buildings if b.get('n') and b['h'] >= 40) >= 3 else 18
cands = [b for b in buildings if b.get('n') and b['h'] >= BAR and foot(b) >= 600]
for b in sorted(cands, key=lambda b: -b['h']):
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
    if hw in ('motorway', 'trunk', 'primary', 'secondary'):
        return 'mj'
    if hw.endswith('_link'):
        return 'lk'
    return 'mn'


roads = []
for e in rj:
    geom = e.get('geometry')
    if not geom:
        continue
    pts = simplify([prj(g['lon'], g['lat']) for g in geom if g], tol=2.0)
    if len(pts) >= 2:
        roads.append({'c': road_class(e.get('tags', {})), 'p': [c for pt in pts for c in pt]})

# ---------- water (coastal cities): flood west/east of the derived shore ----------
water = []
if cfg['coast']:
    coast_pts = []
    for e in cj:
        t = e.get('tags', {})
        geom = e.get('geometry') or []
        pts = [(g['lon'], g['lat']) for g in geom if g]
        if len(pts) < 2:
            continue
        if t.get('natural') == 'coastline':
            coast_pts.extend(prj(*p) for p in pts)
        else:
            r = simplify([prj(*p) for p in pts], tol=3.0)
            if len(r) >= 3 and abs(ring_area(r + [r[0]])) > 400:
                water.append([c for pt in r for c in pt])

    if coast_pts:
        # Dammam faces the Gulf to the EAST, so the sea is at greater x
        bld = [(max(b['o'][0::2]), sum(b['o'][1::2]) / (len(b['o']) // 2)) for b in buildings]
        allz = [p[1] for p in bld] + [p[1] for p in coast_pts]
        z0, z1 = min(allz), max(allz)
        BAND = 220.0
        nb = max(2, int((z1 - z0) / BAND) + 1)
        shore = [None] * nb

        def note(x, z, pad):
            i = int((z - z0) / BAND)
            if 0 <= i < nb:
                v = x + pad
                if shore[i] is None or v > shore[i]:
                    shore[i] = v

        for x, z in coast_pts:
            note(x, z, 0)
        for x, z in bld:
            note(x, z, 40)

        last = None
        for i in range(nb):
            if shore[i] is None: shore[i] = last
            else: last = shore[i]
        last = None
        for i in range(nb - 1, -1, -1):
            if shore[i] is None: shore[i] = last
            else: last = shore[i]

        if any(s is not None for s in shore):
            sm = shore[:]
            for _ in range(2):
                sm = [sm[i] if i in (0, nb - 1) else (sm[i - 1] + sm[i] + sm[i + 1]) / 3.0
                      for i in range(nb)]
            edge = [(sm[i], z0 + BAND * i) for i in range(nb) if sm[i] is not None]
            if len(edge) >= 2:
                east = max(p[0] for p in edge) + 5000
                poly = edge + [(east, edge[-1][1] + BAND), (east, edge[0][1] - BAND)]
                water.append([c for pt in poly for c in pt])

# ---------- presets + ride anchors ----------
named = {}
for b in buildings:
    if b.get('n'):
        cur = named.get(b['n'])
        if not cur or b['h'] > cur['h']:
            named[b['n']] = b


def centroid(b):
    xs, zs = b['o'][0::2], b['o'][1::2]
    return sum(xs) / len(xs), sum(zs) / len(zs)


xs = [centroid(b)[0] for b in buildings]
zs = [centroid(b)[1] for b in buildings]
cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
extent = max(max(zs) - min(zs), (max(xs) - min(xs)) * 0.6)

presets = {'overview': {'label': 'Overview', 'tx': round(cx), 'tz': round(cz),
                        'azim': -0.5, 'elev': 0.9, 'size': round(extent * 1.05)}}

top = [n for n in labels][:3]
SZ = [900, 1200, 1500]
for i, n in enumerate(top):
    b = named.get(n)
    if not b:
        continue
    x, z = centroid(b)
    key = ''.join(ch for ch in n.lower() if ch.isalnum())[:10]
    presets[key] = {'label': n[:16], 'tx': round(x), 'tz': round(z),
                    'azim': -0.7 + 0.2 * i, 'elev': 0.5, 'size': SZ[i]}

# the ride: down the spine, south to north
spine_local = sorted([prj(*p) for p in spine_pts], key=lambda p: -p[1])
anchors = []
for i in range(4):
    p = spine_local[int((len(spine_local) - 1) * i / 3)]
    anchors.append({'tx': round(p[0]), 'tz': round(p[1]),
                    'azim': -0.9 + 0.5 * i / 3, 'elev': 0.46 + 0.1 * i / 3,
                    'size': [1600, 1300, 1100, 900][i]})

scene = {
    'meta': {'city': cfg['label'], 'spine': cfg['spine'],
             'center': [round(lat0, 6), round(lon0, 6)],
             'attribution': '© OpenStreetMap contributors'},
    'buildings': buildings, 'roads': roads, 'water': water,
    'presets': presets, 'anchors': anchors,
}
json.dump(scene, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)

from collections import Counter
print('%s: %d buildings %s' % (CITY, len(buildings), Counter(b['c'] for b in buildings)))
print('  roads:', len(roads), '| water:', len(water))
print('  labels:', labels[:8])
print('  presets:', list(presets))
print('  size: %.2f MB' % (os.path.getsize(OUT) / 1e6))
