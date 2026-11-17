#!/usr/bin/env python3
"""Culture and sights as possible meeting places, from a Geofabrik OpenStreetMap extract.
Usage (needs `pip install osmium`):
    python3 tools/build_culture.py ile-de-france-latest.osm.pbf
Writes data/culture.json: {"culture": [[lat, lon, name, kind]], "sights": [[lat, lon, name, kind]]}, named places only.
  culture: museum, gallery, theatre, cinema, arts centre, library, music venue
  sights:  attraction, viewpoint, castle, monument, ruins, fort, archaeological site
Attractions count only as buildings or sites (areas). Buildings and areas are reduced to the average of their outline's points. Duplicates (same name within ~100 m) are dropped."""
import json, os, sys
import osmium

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
CULTURE = {("tourism", "museum"): "museum", ("tourism", "gallery"): "gallery", ("amenity", "theatre"): "theatre", ("amenity", "cinema"): "cinema",
           ("amenity", "arts_centre"): "arts centre", ("amenity", "library"): "library", ("amenity", "music_venue"): "music venue"}
SIGHTS = {("tourism", "attraction"): "attraction", ("tourism", "viewpoint"): "viewpoint", ("historic", "castle"): "castle", ("historic", "monument"): "monument",
          ("historic", "ruins"): "ruins", ("historic", "fort"): "fort", ("historic", "archaeological_site"): "archaeological site"}

def classify(t):
    for key in ("tourism", "amenity", "historic"):
        v = t.get(key)
        if (key, v) in CULTURE: return "culture", CULTURE[(key, v)]
    for key in ("tourism", "historic"):
        v = t.get(key)
        if (key, v) in SIGHTS: return "sights", SIGHTS[(key, v)]
    return None

out = {"culture": [], "sights": []}; seen = set()
def add(group, lat, lon, name, kind):
    k = (group, name.lower(), round(lat * 1000), round(lon * 1000))
    if k in seen: return
    seen.add(k); out[group].append([round(lat, 5), round(lon, 5), name[:40], kind])

fp = osmium.FileProcessor(sys.argv[1]).with_locations().with_areas().with_filter(osmium.filter.KeyFilter("tourism", "amenity", "historic"))
for o in fp:
    t = o.tags; name = t.get("name")
    if not name: continue
    c = classify(t)
    if not c: continue
    if o.is_node():
        if c[1] != "attraction": add(c[0], o.lat, o.lon, name, c[1])      # a lone point tagged attraction is usually a zoo animal or an artwork

    elif o.is_area():
        try:
            pts = [(x.lat, x.lon) for ring in o.outer_rings() for x in ring]
        except Exception: continue
        if pts: add(c[0], sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), name, c[1])
for g in out: out[g].sort(key=lambda r: (r[0], r[1]))
path = os.path.join(DATA, "culture.json"); json.dump(out, open(path, "w"), separators=(",", ":"), ensure_ascii=False)
print("culture.json", os.path.getsize(path) // 1024, "KB:", {g: len(v) for g, v in out.items()})
