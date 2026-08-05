#!/usr/bin/env python3
"""Fetch buildings / roads / coast for a city, tiled, with mirror rotation.

    python3 fetch_city.py dammam
    python3 fetch_city.py makkah
"""
import sys, json
sys.path.insert(0, '.')
from fetch_tiles import fetch_tiled

CITIES = {
    'dammam': {
        # King Saud St and the Gulf corniche
        'bbox': (26.38, 50.03, 26.49, 50.15),
        'tiles': (5, 3),
        'coast': True,
    },
    'makkah': {
        # Ibrahim Al Khalil Road, running past the Haram
        'bbox': (21.385, 39.795, 21.455, 39.860),
        'tiles': (5, 3),
        'coast': False,
    },
}

name = sys.argv[1]
what = sys.argv[2] if len(sys.argv) > 2 else 'all'
cfg = CITIES[name]
S, W, N, E = cfg['bbox']
rows, cols = cfg['tiles']

if what in ('all', 'buildings'):
    tmpl = ('[out:json][timeout:180][maxsize:536870912][bbox:{bbox}];'
            'wr["building"];out geom qt;')
    fetch_tiled(tmpl, S, W, N, E, rows, cols, '%s_buildings.json' % name)

if what in ('all', 'roads'):
    tmpl = ('[out:json][timeout:240][bbox:{bbox}];'
            'way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|'
            'primary_link|secondary|tertiary)$"];out geom qt;')
    fetch_tiled(tmpl, S, W, N, E, 2, 1, '%s_roads.json' % name)

if what in ('all', 'coast') and cfg['coast']:
    tmpl = ('[out:json][timeout:240][bbox:{bbox}];'
            '(way["natural"="coastline"];way["natural"="water"];);out geom qt;')
    fetch_tiled(tmpl, S - 0.03, W - 0.03, N + 0.03, E + 0.02, 2, 2, '%s_coast.json' % name)
