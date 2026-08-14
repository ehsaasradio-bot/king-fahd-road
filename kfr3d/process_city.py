#!/usr/bin/env python3
"""Turn raw Overpass JSON for a city into a compact local-metre scene.

    python3 process_city.py dammam
    python3 process_city.py makkah
"""
import json, math, hashlib, sys, os

CITIES = {
    'madinah': {
        'label': 'Madinah',
        'spine': "Al-Masjid an-Nabawi",
        'spine_keys': (),
        'coast': False,
        'focus': (24.46865, 39.61117, "Prophet's Mosque"),   # lat, lon, name
        'radius': 2400,
        'overrides': {"Prophet's Mosque": 42.0},
        'ride': [],
    },
    'makkah2': {
        'label': 'Makkah',
        'spine': 'Al-Masjid al-Haram',
        'spine_keys': (),
        'coast': False,
        'rename': {'Great Mosque of Mecca': 'Al-Masjid al-Haram'},
        'focus': (21.42470, 39.82400, 'Al-Masjid al-Haram'),
        'land': (21.422487, 39.826206, 'Kaaba'),
        'radius': 2400,
        'overrides': {'Al-Masjid al-Haram': 45.0, 'Kaaba': 13.1,
                      'The Clock Towers': 601.0, 'Abraj Al Bait': 601.0},
        'ride': [],
    },
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
if not spine_pts and not cfg.get('focus'):
    print('!! spine not found, centring on all roads')
    for e in rj:
        for g in (e.get('geometry') or [])[:4]:
            if g:
                spine_pts.append((g['lon'], g['lat']))
if not spine_pts:
    spine_pts = [(lon, lat) for lat, lon in [(cfg['focus'][0], cfg['focus'][1])]] \
        if cfg.get('focus') else spine_pts

FOCUS = cfg.get('focus')
if FOCUS:
    lat0, lon0 = FOCUS[0], FOCUS[1]      # the mosque is the origin
else:
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
    n = t.get('name:en') or t.get('name') or ''
    return cfg.get('rename', {}).get(n, n)


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
    """Join multipolygon member ways into closed rings.

    Walks from each free end through an endpoint index. The old pairwise scan
    could close a sub-loop early and then throw the leftover chain away — on
    Al-Masjid al-Haram that quietly deleted the half of the mosque the Kaaba
    stands in.
    """
    segs = [list(map(tuple, p)) for p in parts if len(p) >= 2]
    ends = {}
    for i, s in enumerate(segs):
        if s[0] == s[-1]:
            continue                      # already a ring
        ends.setdefault(s[0], []).append(i)
        ends.setdefault(s[-1], []).append(i)
    used = [False] * len(segs)
    rings = []
    for i, s in enumerate(segs):
        if used[i]:
            continue
        used[i] = True
        if s[0] == s[-1]:
            rings.append(s)
            continue
        cur = list(s)
        while cur[0] != cur[-1]:
            nxt = [j for j in ends.get(cur[-1], ()) if not used[j]]
            if not nxt:
                break
            j = nxt[0]
            used[j] = True
            t2 = segs[j]
            cur += (t2[1:] if t2[0] == cur[-1] else list(reversed(t2))[1:])
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
    return rings


def ring_contains(ring, pt):
    px, pz = pt
    n, c = len(ring), False
    for i in range(n):
        j = (i - 1) % n
        if ((ring[i][1] > pz) != (ring[j][1] > pz)) and (
                px < (ring[j][0] - ring[i][0]) * (pz - ring[i][1])
                / (ring[j][1] - ring[i][1] + 1e-12) + ring[i][0]):
            c = not c
    return c


# Some subjects are mapped without a building tag — the Grand Mosque is a bare
# relation — so a focus city can name extra elements to fold in.
import os as _os
_extra = '%s_mosque.json' % CITY
if _os.path.exists(_extra):
    _n = 0
    _have = set((e.get('type'), e.get('id')) for e in bj)
    for e in json.load(open(_extra))['elements']:
        if (e.get('type'), e.get('id')) in _have:
            continue                      # already came back with the buildings
        t = dict(e.get('tags') or {})
        t.setdefault('building', 'mosque')
        e['tags'] = t
        bj.append(e)
        _n += 1
    print('  folded in %d extra element(s) from %s' % (_n, _extra))

# Tiles overlap, so the same way can arrive several times. Left in, it draws
# twice and shows up twice in the landmark list.
_seen, _dedup = set(), []
for e in bj:
    k = (e.get('type'), e.get('id'))
    if k[1] is not None and k in _seen:
        continue
    _seen.add(k)
    _dedup.append(e)
if len(_dedup) != len(bj):
    print('  dropped %d duplicate element(s)' % (len(bj) - len(_dedup)))
bj = _dedup

# ---------- buildings ----------
buildings = []
for e in bj:
    t = e.get('tags', {})
    geom = e.get('geometry')
    if e.get('type') == 'way':
        if not geom:
            continue
        outer_ll = [[(g['lon'], g['lat']) for g in geom if g]]
        inner_ll = []
    else:
        outer_ll = [[(g['lon'], g['lat']) for g in m.get('geometry') or [] if g]
                    for m in e.get('members', []) if m.get('role') == 'outer']
        inner_ll = [[(g['lon'], g['lat']) for g in m.get('geometry') or [] if g]
                    for m in e.get('members', []) if m.get('role') == 'inner']
        # keep two-node members: they are legitimate links in a ring, and
        # dropping them snaps the chain and loses everything past the gap
        outer_ll = [o for o in outer_ll if len(o) >= 2]
        if not outer_ll:
            continue
        outer_ll = stitch(outer_ll) or outer_ll
        inner_ll = stitch([i for i in inner_ll if len(i) >= 2])

    outers = [r for r in (simplify([prj(*p) for p in r]) for r in outer_ll) if len(r) >= 3]
    inners = [r for r in (simplify([prj(*p) for p in r]) for r in inner_ll) if len(r) >= 3]
    if not outers:
        continue

    # A multipolygon can hold several disjoint outer rings — Al-Masjid al-Haram
    # is three. Keeping only the largest threw away the half holding the Kaaba,
    # so each outer ring becomes its own part and takes the holes it contains.
    outers.sort(key=lambda r: -abs(ring_area(r + [r[0]])))
    name = bname(t)
    key = e.get('id') or name or len(buildings)
    for oi, outer in enumerate(outers):
        area = abs(ring_area(outer + [outer[0]]))
        if area < 25:
            continue
        holes = [h for h in inners if ring_contains(outer, h[0])]
        if ring_area(outer + [outer[0]]) < 0:
            outer = outer[::-1]
        holes = [h[::-1] if ring_area(h + [h[0]]) > 0 else h for h in holes]
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
RAD = cfg.get('radius')
if cfg.get('focus') and RAD:
    # radial city: keep what stands around the mosque, drop the rest
    before = len(buildings)
    kept = []
    for b in buildings:
        xs, zs = b['o'][0::2], b['o'][1::2]
        cx0, cz0 = sum(xs) / len(xs), sum(zs) / len(zs)
        if cx0 * cx0 + cz0 * cz0 <= RAD * RAD:
            kept.append(b)
    buildings = kept
    print('  radius %dm: %d -> %d buildings' % (RAD, before, len(buildings)))

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
# a focus city's subject leads its own list, however tall the hotels around it
# are — otherwise the mosque the whole page is about carries no chip
_lead = [n for n in ((cfg.get('focus') or (0, 0, None))[2],
                     (cfg.get('land') or (0, 0, None))[2]) if n]
labels = _lead + [n for n in labels if n not in _lead]
labels = labels[:14]
LANDPT = prj(cfg['land'][1], cfg['land'][0]) if cfg.get('land') else None


def _chip_rank(b):
    # biggest part wins — and deliberately not the part holding the landing
    # point, or the mosque's chip would sit on top of the Kaaba at the close
    return -foot(b)


_chipped = set()
for b in sorted(buildings, key=_chip_rank):
    n = b.get('n')
    if n in labels and n not in _chipped:   # one chip per name, on its best part
        b['lb'] = 1
        _chipped.add(n)


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

# The ride. A focus city has no spine to travel: the mosque is the subject, so
# the camera circles inward onto it instead of running along a road.
if cfg.get('focus'):
    NAME = cfg['focus'][2]
    mb = named.get(NAME)
    if mb:
        mx0, mz0 = centroid(mb)
    else:
        mx0, mz0 = 0.0, 0.0          # the mosque is the projection origin
        print('  !! %s not found by name, using the origin' % NAME)

    # Where the drone finally sets down. The Kaaba is not the centroid of the
    # mosque — the expansions pull that half a kilometre away — so the descent
    # has to drift onto it rather than just zoom in on the middle.
    LAND = cfg.get('land')
    if LAND:
        lx, lz = LANDPT
        lb_ = named.get(LAND[2])
        if lb_:
            lx, lz = centroid(lb_)
        # the mosque part the landing point actually stands in is the subject
        for b in buildings:
            if b.get('n') == NAME:
                ring = list(zip(b['o'][0::2], b['o'][1::2]))
                if ring_contains(ring, (lx, lz)):
                    mx0, mz0 = centroid(b)
                    break
        print('  landing on %s at (%d, %d)' % (LAND[2], lx, lz))
    else:
        lx, lz = mx0, mz0

    presets = {
        'mosque':   {'label': cfg['spine'][:16], 'tx': round(mx0), 'tz': round(mz0),
                     'azim': -0.6, 'elev': 0.55, 'size': 420},
        'approach': {'label': 'Approach', 'tx': round(mx0), 'tz': round(mz0),
                     'azim': -0.2, 'elev': 0.45, 'size': 1100},
        'overview': {'label': 'The City', 'tx': round(mx0), 'tz': round(mz0),
                     'azim': -0.9, 'elev': 0.95, 'size': round(RAD * 2.1)},
    }

    # A spiral descent: wide and high, turning as it drops and closes in. The
    # closing frame has to hold the whole complex — these mosques are several
    # hundred metres across, so stopping at 330m only showed a slab.
    # The fourth column is how far the aim has slid from the mosque as a whole
    # onto the landing point, so the fall reads as a drone settling.
    SPIRAL = [
        (RAD * 2.0, 0.95, -1.25, 0.00),
        (RAD * 1.3, 0.80, -0.85, 0.08),
        (1250, 0.64, -0.45, 0.34),
        (780, 0.52, -0.10, 0.70),
    ]
    if LAND:
        # A drone descent instead of a circling approach: the camera stays high
        # and steep the whole way down, because Makkah's towers stand right on
        # the mosque and a low angle just buries it behind the Clock Tower. The
        # arc is held on the side the towers are not on.
        SPIRAL = [
            (RAD * 2.0, 0.90, -2.75, 0.00),
            (RAD * 1.25, 0.91, -2.50, 0.15),
            (1300, 0.90, -2.15, 0.50),
            (700, 0.90, -1.86, 0.85),
            (620, 0.92, -1.58, 0.98),     # the whole complex, held for a beat
            (240, 0.86, -1.46, 1.00),     # down onto the Kaaba
        ]
    anchors = []
    for size, elev, azim, k in SPIRAL:
        anchors.append({'tx': round(mx0 + (lx - mx0) * k), 'tz': round(mz0 + (lz - mz0) * k),
                        'azim': azim, 'elev': elev, 'size': round(size)})
else:
    # The ride: down the spine, south to north — but only across the stretch that
    # actually has a city on it. Spines run far past the mapped area, and the thin
    # ends would open the story on empty desert, so rank each point by how much
    # city surrounds it and keep the dense run.
    DCELL = 200.0
    _dgrid = {}
    for _b in buildings:
        _xs, _zs = _b['o'][0::2], _b['o'][1::2]
        _k = (int((sum(_xs) / len(_xs)) // DCELL), int((sum(_zs) / len(_zs)) // DCELL))
        _dgrid[_k] = _dgrid.get(_k, 0) + 1


    def _density(p):
        gx, gz = int(p[0] // DCELL), int(p[1] // DCELL)
        n = 0
        for a in range(gx - 3, gx + 4):
            for b in range(gz - 3, gz + 4):
                n += _dgrid.get((a, b), 0)
        return n


    _pts = [(p, _density(p)) for p in (prj(*q) for q in spine_pts)]
    _live = [d for _, d in _pts if d > 0]
    _floor = max(8, (sorted(_live)[len(_live) // 2] * 0.35) if _live else 0)
    spine_local = [p for p, d in _pts if d >= _floor]
    if len(spine_local) < 4:
        spine_local = [p for p, _ in _pts]
        print('  !! spine has little city on it, using it whole')
    else:
        print('  ride spans %d of %d spine points (density floor %d)'
              % (len(spine_local), len(_pts), _floor))
    spine_local = sorted(spine_local, key=lambda p: -p[1])
    anchors = []
    for i in range(4):
        p = spine_local[int((len(spine_local) - 1) * i / 3)]
        anchors.append({'tx': round(p[0]), 'tz': round(p[1]),
                        'azim': -0.9 + 0.5 * i / 3, 'elev': 0.46 + 0.1 * i / 3,
                        'size': [1600, 1300, 1100, 900][i]})

for i, a in enumerate(anchors):
    r = a['size'] * 0.6
    n = sum(1 for b in buildings
            if abs(sum(b['o'][0::2]) / (len(b['o']) // 2) - a['tx']) < r
            and abs(sum(b['o'][1::2]) / (len(b['o']) // 2) - a['tz']) < r)
    print('  anchor %d: %d buildings in frame' % (i + 1, n))

scene = {
    'meta': {'city': cfg['label'], 'spine': cfg['spine'],
             'focus': (cfg['focus'][2] if cfg.get('focus') else None),
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
