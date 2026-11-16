#!/usr/bin/env python3
"""Build data/graph-bus.json: bus add-on for the rail graph (optional in the app).

Usage: python3 -I tools/build_bus.py <extracted-gtfs-dir> [out.json]
Needs data/graph.json (build_graph.py) first: bus stops and lines are indexed
after the rail ones, and the file records the rail sizes it was built against.
"""
import csv, json, math, os, statistics, sys, datetime
from collections import defaultdict

WINDOW = (10 * 3600, 19 * 3600)
SAMPLES = 25                                   # ride-time samples kept per edge
WALK_SPEED, DETOUR = 1.2, 1.3
src = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "data", "graph-bus.json")
rd = lambda n: csv.DictReader(open(os.path.join(src, n), encoding="utf-8-sig"))
base = json.load(open(os.path.join(HERE, "..", "data", "graph.json"), encoding="utf-8"))
NS, NL, NLN = len(base["stations"]), len(base["lines"]), len(base["lnodes"])
rail_ids = {s[0]: i for i, s in enumerate(base["stations"])}
dates = [datetime.date.fromisoformat(d) for d in base["profileDates"]]

def hms(s):
    h, m, sec = s.split(":"); return int(h) * 3600 + int(m) * 60 + int(sec)

routes = {r["route_id"]: r for r in rd("routes.txt") if r["route_type"] == "3"}
print("bus routes:", len(routes))
cal = list(rd("calendar.txt")); exc = list(rd("calendar_dates.txt"))
active = []
for d in dates:
    ds, wd = d.strftime("%Y%m%d"), d.weekday()
    on = {c["service_id"] for c in cal if c["start_date"] <= ds <= c["end_date"] and c[("monday","tuesday","wednesday","thursday","friday","saturday","sunday")[wd]] == "1"}
    for e in exc:
        if e["date"] == ds: (on.add if e["exception_type"] == "1" else on.discard)(e["service_id"])
    active.append(on)
trips = {}
for t in rd("trips.txt"):
    if t["route_id"] in routes:
        fl = tuple(t["service_id"] in a for a in active)
        if any(fl): trips[t["trip_id"]] = (t["route_id"], t["direction_id"] or "0", fl)
print("bus trips:", len(trips))

stops, parent_of = {}, {}
for s in rd("stops.txt"):
    stops[s["stop_id"]] = s
    if s["location_type"] == "1": parent_of[s["stop_id"]] = s["stop_id"]
    elif s["location_type"] == "0": parent_of[s["stop_id"]] = s["parent_station"] or s["stop_id"]

lkey, lnodes = {}, []
def ln(p, r, d):
    k = (p, r, d)
    if k not in lkey: lkey[k] = len(lnodes); lnodes.append(k)
    return lkey[k]
rides = defaultdict(list); dep = defaultdict(lambda: [0, 0])

def flush(tid, rows):
    info = trips.get(tid)
    if not info or len(rows) < 2: return
    route, d, fl = info; rows.sort(key=lambda r: r[0]); prev = None
    for _, stop, arr, dp in rows:
        p = parent_of.get(stop)
        if p is None: continue
        if prev and prev[0] != p:
            v = rides[(ln(prev[0], route, d), ln(p, route, d))]
            if len(v) < SAMPLES: v.append(arr - prev[1])
        if prev is None or prev[0] != p:
            prev = (p, dp)
            if WINDOW[0] <= dp < WINDOW[1]:
                a = ln(p, route, d)
                for i in (0, 1):
                    if fl[i]: dep[a][i] += 1

cur, rows = None, []
with open(os.path.join(src, "stop_times.txt"), encoding="utf-8-sig", newline="") as f:
    r = csv.reader(f); hdr = next(r); ix = {h: i for i, h in enumerate(hdr)}
    it, ia, idp, iss, isq = ix["trip_id"], ix["arrival_time"], ix["departure_time"], ix["stop_id"], ix["stop_sequence"]
    for row in r:
        tid = row[it]
        if tid != cur:
            if cur is not None: flush(cur, rows)
            cur, rows = tid, []
        if tid in trips and row[ia]:
            rows.append((int(row[isq]), row[iss], hms(row[ia]), hms(row[idp] or row[ia])))
    flush(cur, rows)
print("bus line nodes:", len(lnodes), "ride edges:", len(rides))

def wait(a, i):
    n = dep[a][i]
    if n == 0: return -1
    return round(min(max((WINDOW[1] - WINDOW[0]) / n / 2, 60), 900) + 30)

# keep only nodes that matter: at least one boardable profile or part of a ride edge
used_parents = sorted({p for p, _, _ in lnodes})
sidx = {p: NS + i for i, p in enumerate(used_parents)}          # global station index
line_ids = sorted({r for _, r, _ in lnodes}); lidx = {r: NL + i for i, r in enumerate(line_ids)}
stations = []
for p in used_parents:
    s = stops[p]
    stations.append([p, s["stop_name"], round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5), -1])
lines = [[routes[r]["route_short_name"], "#" + (routes[r]["route_color"] or "888888"), 3] for r in line_ids]
lout = [[sidx[p], lidx[r], int(d), wait(i, 0), wait(i, 1)] for i, (p, r, d) in enumerate(lnodes)]
for l in lout: l[0] = l[0]                                          # already global
rout = [[NLN + a, NLN + b, round(statistics.median(v))] for (a, b), v in rides.items() if statistics.median(v) > 0]

# walking links: bus<->bus within 150 m, bus<->rail within 300 m
def dist_m(a, b):
    dy = (a[0] - b[0]) * 111320; dx = (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0])); return math.hypot(dx, dy)
allpts = [(s[2], s[3]) for s in base["stations"]] + [(s[2], s[3]) for s in stations]
grid = defaultdict(list)
for i, (la, lo) in enumerate(allpts): grid[(int(la * 400), int(lo * 280))].append(i)
walks = []
for k in range(NS, len(allpts)):
    la, lo = allpts[k]; gx, gy = int(la * 400), int(lo * 280)
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            for j in grid.get((gx + dx, gy + dy), []):
                if j >= k and j >= NS: continue                    # each bus pair once
                d = dist_m(allpts[k], allpts[j]); lim = 300 if j < NS else 150
                if d <= lim: walks.append([j, k, round(60 + d * DETOUR / WALK_SPEED)])
print("bus stops:", len(stations), "walk links:", len(walks))
json.dump({"baseStations": NS, "baseLines": NL, "baseLnodes": NLN, "stations": stations, "lines": lines,
           "lnodes": lout, "rides": rout, "walks": walks}, open(out, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
print("wrote", out, os.path.getsize(out) // 1024, "KB")
