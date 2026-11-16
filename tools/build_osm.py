#!/usr/bin/env python3
"""Build the context layers of the abstract basemap from a Geofabrik OpenStreetMap extract.
Usage (needs `pip install osmium`):
    python3 tools/build_osm.py ile-de-france-latest.osm.pbf
Download: https://download.geofabrik.de/europe/france/ile-de-france-latest.osm.pbf
Writes data/roads.json (motorway..primary), roads-detail.json (secondary, tertiary), water.json,
green.json (parks and forests, with names), places.json (towns), pois.json (restaurants, cafés, bars: shown on the map, never used for scoring)."""
import json, math, os, sys
from collections import defaultdict
import osmium

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
KM2 = 1e6
ROAD_TIER = {"motorway": 0, "trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3}
ROAD_EPS = {0: 0.00015, 1: 0.00012, 2: 0.0001, 3: 0.0001}
FOOD = {"restaurant": "r", "cafe": "c", "bar": "b", "pub": "b"}

def dp(pts, eps):                                  # Douglas-Peucker on (lat, lon), iterative
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop(); (ay, ax), (by, bx) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay; n = math.hypot(dx, dy) or 1e-12; k, dmax = -1, 0
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][1] - ax) - dx * (pts[i][0] - ay)) / n
            if d > dmax: k, dmax = i, d
        if dmax > eps and k > 0: keep[k] = True; stack += [(a, k), (k, b)]
    return [p for p, f in zip(pts, keep) if f]

def dp_ring(pts, eps):                              # a closed ring has identical ends: split it at the farthest point first
    if len(pts) < 5: return pts
    far = max(range(1, len(pts) - 1), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    return dp(pts[:far + 1], eps)[:-1] + dp(pts[far:], eps)

def flat(pts): return [round(v, 5) for p in pts for v in p]

def area_km2(pts):                                  # shoelace, local metres
    s = 0.0
    for (y0, x0), (y1, x1) in zip(pts, pts[1:] + pts[:1]): s += (x0 * 73000) * (y1 * 111320) - (x1 * 73000) * (y0 * 111320)
    return abs(s) / 2 / KM2

roads = {"motorway": [], "primary": [], "secondary": [], "tertiary": []}; rivers = []; water = []; green = []; green_names = []; places = []
pois = {"r": [], "c": [], "b": []}; food = []
names = {0: "motorway", 1: "primary", 2: "secondary", 3: "tertiary"}

fp = osmium.FileProcessor(sys.argv[1]).with_locations().with_areas()
n = 0
for o in fp:
    n += 1
    if n % 2_000_000 == 0: print(f"{n // 1_000_000}M objects, roads {sum(map(len, roads.values()))}, water {len(water)}, green {len(green)}", flush=True)
    t = o.tags
    if o.is_node():
        pl = t.get("place")
        if pl in ("city", "town") and t.get("name"):
            places.append([t["name"], round(o.lat, 4), round(o.lon, 4), pl])
        elif t.get("amenity") in FOOD:
            food.append((o.lat, o.lon)); pois[FOOD[t["amenity"]]].append([round(o.lat, 5), round(o.lon, 5), (t.get("name") or "")[:40]])
    elif o.is_way():
        hw = t.get("highway")
        if hw in ROAD_TIER:
            tier = ROAD_TIER[hw]
            try: pts = [(x.lat, x.lon) for x in o.nodes]
            except Exception: continue
            if len(pts) > 1: roads[names[tier]].append(flat(dp(pts, ROAD_EPS[tier])))
        elif t.get("waterway") == "river":
            try: pts = [(x.lat, x.lon) for x in o.nodes]
            except Exception: continue
            if len(pts) > 1: rivers.append(flat(dp(pts, 0.0001)))
    elif o.is_area():
        nat, lu, le, wa = t.get("natural"), t.get("landuse"), t.get("leisure"), t.get("water")
        kind = "water" if (nat == "water" or t.get("waterway") == "riverbank") else "green" if (nat == "wood" or lu == "forest" or le in ("park", "nature_reserve")) else None
        if not kind: continue
        for ring in o.outer_rings():
            try: pts = [(x.lat, x.lon) for x in ring]
            except Exception: continue
            if len(pts) < 4: continue
            a = area_km2(pts)
            if kind == "water" and a < 0.02: continue
            if kind == "green" and a < (0.05 if le == "park" else 0.3): continue
            eps = 0.00008 if kind == "water" else 0.00015
            rings = [flat(dp_ring(pts, eps))]                     # polygon = [outer, hole, hole...] (islands, ponds)
            for inner in o.inner_rings(ring):
                try: hp = [(x.lat, x.lon) for x in inner]
                except Exception: continue
                if len(hp) >= 4 and area_km2(hp) >= 0.002: rings.append(flat(dp_ring(hp, eps)))
            if kind == "water": water.append(rings)
            else:
                green.append(rings)
                if t.get("name") and a >= 0.12:
                    green_names.append([t["name"][:40], round(sum(p[0] for p in pts) / len(pts), 4), round(sum(p[1] for p in pts) / len(pts), 4), round(a, 2)])

def dump(name, obj):
    path = os.path.join(DATA, name); json.dump(obj, open(path, "w"), separators=(",", ":"), ensure_ascii=False)
    print(name, os.path.getsize(path) // 1024, "KB")
dump("roads.json", {k: roads[k] for k in ("motorway", "primary")})
dump("roads-detail.json", {k: roads[k] for k in ("secondary", "tertiary")})
dump("water.json", {"rivers": rivers, "areas": water}); dump("green.json", {"polys": green, "names": green_names})
dump("places.json", places); dump("pois.json", pois)

print("food places:", len(food))
