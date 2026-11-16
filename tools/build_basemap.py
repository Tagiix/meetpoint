#!/usr/bin/env python3
"""Build the abstract-basemap line layers from IDFM line traces (geojson exports).
Usage: python3 -I tools/build_basemap.py <rail.json> <bus.json>
Writes data/rail-lines.json and data/bus-lines.json.
Each line: {"c": "#hex", "n": name, "m": mode, "p": [[lat, lon, lat, lon, ...], ...]}"""
import json, math, os, sys

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

def dp(pts, eps):                                  # Douglas-Peucker on [lon, lat], iterative
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop(); (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay; n = math.hypot(dx, dy) or 1e-12; k, dmax = -1, 0
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / n
            if d > dmax: k, dmax = i, d
        if dmax > eps and k > 0: keep[k] = True; stack += [(a, k), (k, b)]
    return [p for p, f in zip(pts, keep) if f]

def flat(line, eps, nd):
    pts = dp(line, eps)
    return [round(v, nd) for p in pts for v in (p[1], p[0])]

def lines(path, props, eps, nd, minpts=4):
    out = []
    for f in json.load(open(path))["features"]:
        g = f["geometry"]; parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        p = [flat(l, eps, nd) for l in parts if len(l) > 1]
        p = [x for x in p if len(x) >= minpts]
        if p: out.append({**props(f["properties"]), "p": p})
    return out

def rail_props(pr):
    mode = (pr.get("mode") or "").upper(); res = (pr.get("res_com") or "").upper()
    m = 1 if mode == "METRO" else 0 if "TRAM" in mode else 2 if (mode == "RER" or res.startswith("RER")) else 3
    return {"c": "#" + (pr.get("colourweb_hexa") or "888888").lstrip("#"), "n": pr.get("res_com") or "", "m": m}

rail = lines(sys.argv[1], rail_props, 0.00004, 5)
bus = lines(sys.argv[2], lambda pr: {"c": pr.get("linecolor") or "#888888", "n": pr.get("lineshortn") or ""}, 0.0004, 4)
for name, data in (("rail-lines.json", rail), ("bus-lines.json", bus)):
    path = os.path.join(DATA, name); json.dump(data, open(path, "w"), separators=(",", ":"), ensure_ascii=False)
    print(name, len(data), "lines", os.path.getsize(path) // 1024, "KB")
import collections; print(collections.Counter(l["m"] for l in rail))
