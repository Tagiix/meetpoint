#!/usr/bin/env python3
"""Create a few sample events on a running Meet Point server, for trying the app by hand.
Usage:  python3 tools/seed_events.py [base-url]        default http://127.0.0.1:8765
Prints an organizer link and a guest link for each event, and ONE import link: open it in your browser to remember all of them as organizer
(the "Your events" list lives in the browser, so events created on the server are unknown to it until a link is opened).
The positions are random but repeatable (fixed seed). Delete events from the app, or remove files in data/events/."""
import json, os, random, sys, urllib.request
ROOT = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765").rstrip("/")
B = ROOT + "/api/meetup.php"
def post(d):
    r = urllib.request.Request(B, json.dumps(d).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r, timeout=20))
g = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "graph.json")))
R = g.get("railCount") or len(g["stations"]); st = g["stations"][:R]
random.seed(2026)
NAMES = ["Alice", "Bruno", "Camille", "Dina", "Émile", "Farah", "Gaspard", "Hana", "Inès", "Jules"]
def near(s):  # a point a few hundred metres from a station
    return round(s[2] + random.uniform(-.004, .004), 5), round(s[3] + random.uniform(-.005, .005), 5)
def person(i, s, modes, ret=None, label=None):
    la, lo = near(s)
    p = {"name": NAMES[i], "addr": label or f"près de {s[1]}", "lat": la, "lon": lo, "modes": modes, "weight": 1}
    if ret:
        rl, ro = near(ret); p["ret"] = {"addr": f"près de {ret[1]}", "lat": rl, "lon": ro}
    return p
T = {"walk": True, "transit": True, "bike": False, "car": False}
by = lambda name: next(s for s in st if s[1] == name)
pick = lambda n: random.sample(st, n)
EVENTS = [
 ("Friday dinner (stations, 4 people)", {"objective": "max", "meet": ["station"], "profile": 0, "maxmin": 0, "buses": False}, lambda: [person(i, s, T) for i, s in enumerate(pick(4))]),
 ("Weekend culture (museums, cinemas, sights)", {"objective": "balanced", "meet": ["culture", "sights"], "profile": 1, "maxmin": 60, "buses": False}, lambda: [person(i, s, T) for i, s in enumerate(pick(3))]),
 ("Coffee near the centre (cafés and bars)", {"objective": "sum", "meet": ["c", "b"], "profile": 0, "maxmin": 0, "buses": False}, lambda: [person(i, s, T) for i, s in enumerate([by("Gare de Lyon"), by("La Défense"), by("Gare du Nord")])]),
 ("Big group of 10 (everything allowed)", {"objective": "max", "meet": ["station", "r", "c", "b", "park", "culture", "sights"], "profile": 0, "maxmin": 0, "buses": False}, lambda: [person(i, s, T) for i, s in enumerate(pick(10))]),
 ("Mixed transport and different way home", {"objective": "max", "meet": ["station", "park"], "profile": 0, "maxmin": 0, "buses": False}, lambda: [
     person(0, by("Versailles Château Rive Gauche"), {**T, "bike": True}),
     person(1, by("Saint-Denis"), {"walk": False, "transit": False, "bike": False, "car": True}),
     person(2, by("Nation"), T, ret=by("Massy - Palaiseau")),
     person(3, by("Créteil - Préfecture"), {**T, "bike": True}, ret=by("Gare du Nord"))]),
]
out = []
for title, opts, mk in EVENTS:
    r = post({"action": "create", "title": title, "options": opts}); ps = mk()
    for p in ps: post({"action": "join", "id": r["id"], "p": p})
    out.append((title, r["id"], r["adminKey"], len(ps)))
for t, i, k, n in out:
    print(f"{t} | {n} people\n   organizer: {ROOT}/?e={i}&k={k}\n   guest:     {ROOT}/?e={i}")
print("\nImport all of them as organizer, in one click:\n" + f"{ROOT}/?import=" + ",".join(f"{i}.{k}" for _, i, k, _ in out))
