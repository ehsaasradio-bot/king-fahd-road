#!/usr/bin/env python3
"""Fetch an Overpass query over a tiled bbox, rotating mirrors and retrying."""
import json, sys, time, urllib.parse, urllib.request

MIRRORS = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
]
UA = 'kfr-3d-map/1.0 (ehsaasradio@gmail.com)'


def run(ql, tries=6):
    last = ''
    for i in range(tries):
        url = MIRRORS[i % len(MIRRORS)]
        try:
            data = urllib.parse.urlencode({'data': ql}).encode()
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=200) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            last = f'{type(e).__name__}: {e}'
            print(f'   retry {i+1}/{tries} ({url.split("/")[2]}): {last[:60]}', flush=True)
            time.sleep(6)
    raise RuntimeError(f'all retries failed: {last}')


def fetch_tiled(body_tmpl, s, w, n, e, rows, cols, out):
    """body_tmpl uses {bbox}; results are merged and de-duplicated by (type,id)."""
    seen, elements = set(), []
    for r in range(rows):
        for c in range(cols):
            s0 = s + (n - s) * r / rows
            n0 = s + (n - s) * (r + 1) / rows
            w0 = w + (e - w) * c / cols
            e0 = w + (e - w) * (c + 1) / cols
            bbox = f'{s0:.5f},{w0:.5f},{n0:.5f},{e0:.5f}'
            print(f'tile {r*cols+c+1}/{rows*cols}  {bbox}', flush=True)
            d = run(body_tmpl.format(bbox=bbox))
            got = 0
            for el in d.get('elements', []):
                k = (el.get('type'), el.get('id'))
                if k not in seen:
                    seen.add(k)
                    elements.append(el)
                    got += 1
            print(f'   +{got} (total {len(elements)})', flush=True)
    json.dump({'elements': elements}, open(out, 'w'))
    print(f'wrote {out}: {len(elements)} elements', flush=True)
    return elements


if __name__ == '__main__':
    which = sys.argv[1]
    S, W, N, E = 21.47, 39.10, 21.58, 39.19

    if which == 'buildings':
        tmpl = ('[out:json][timeout:180][maxsize:536870912][bbox:{bbox}];'
                'wr["building"];out geom qt;')
        fetch_tiled(tmpl, S, W, N, E, 6, 3, 'jed_buildings_all.json')

    elif which == 'roads':
        tmpl = ('[out:json][timeout:300][bbox:{bbox}];'
                'way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|'
                'primary_link|secondary|tertiary)$"];out geom qt;')
        fetch_tiled(tmpl, S, W, N, E, 2, 1, 'jed_roads.json')

    elif which == 'coast':
        tmpl = ('[out:json][timeout:300][bbox:{bbox}];'
                '(way["natural"="coastline"];way["natural"="water"];'
                'way["waterway"="riverbank"];);out geom qt;')
        fetch_tiled(tmpl, S - 0.03, W - 0.03, N + 0.03, E, 2, 1, 'jed_coast.json')
