#!/usr/bin/env python3
"""Build data/graph.json (rail network graph for the meeting-point solver)
from the IDFM GTFS feed.

Usage: python3 -I tools/build_graph.py <extracted-gtfs-dir> [out.json]

Graph model (see assets/solver.js):
  - station nodes: GTFS parent stations that have rail service
  - line nodes: (station, route, direction); boarding costs half a headway
  - ride edges between consecutive line nodes (median in-vehicle time)
  - walking edges between nearby stations (transfers)
Only metro, tram, RER/Transilien/TER, funicular and cable: buses are not in v1.
"""
import csv, json, math, statistics, sys, unicodedata, datetime, os
from collections import defaultdict

RAIL_TYPES = {"0", "1", "2", "6", "7"}
WINDOW = (10 * 3600, 19 * 3600)           # off-peak window used for headways
WALK_MAX_M = 350                          # max straight distance for a transfer walk
WALK_SPEED = 1.2                          # m/s, applied to detoured distance
DETOUR = 1.3

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "data", "graph.json")
rd = lambda n: csv.DictReader(open(os.path.join(src, n), encoding="utf-8-sig"))

def hms(s):
    h, m, sec = s.split(":")
    return int(h) * 3600 + int(m) * 60 + int(sec)

# --- routes -------------------------------------------------------------
routes = {r["route_id"]: r for r in rd("routes.txt") if r["route_type"] in RAIL_TYPES}
print("rail routes:", len(routes))

# --- services active on a typical weekday and Saturday ---------------------
cal = list(rd("calendar.txt"))
start = min(c["start_date"] for c in cal); end = max(c["end_date"] for c in cal)
d0 = max(datetime.datetime.strptime(start, "%Y%m%d").date(), datetime.date.today())
def first(weekday):
    d = d0
    while d.weekday() != weekday: d += datetime.timedelta(days=1)
    return d
profile_dates = [first(2), first(5)]      # Wednesday, Saturday
profiles = ["weekday", "weekend"]
print("profile dates:", profile_dates)
active = []
for d in profile_dates:
    ds = d.strftime("%Y%m%d"); wd = d.weekday()
    on = set()
    for c in cal:
        if c["start_date"] <= ds <= c["end_date"] and c[("monday","tuesday","wednesday","thursday","friday","saturday","sunday")[wd]] == "1":
            on.add(c["service_id"])
    for e in rd("calendar_dates.txt"):
        if e["date"] == ds:
            (on.add if e["exception_type"] == "1" else on.discard)(e["service_id"])
    active.append(on)

trips = {}   # trip_id -> (route_id, dir, (in weekday, in weekend))
for t in rd("trips.txt"):
    if t["route_id"] in routes:
        flags = tuple(t["service_id"] in a for a in active)
        if any(flags):
            trips[t["trip_id"]] = (t["route_id"], t["direction_id"] or "0", flags)
print("rail trips on profile days:", len(trips))

# --- stops -> parent stations ----------------------------------------------
stops = {}
parent_of = {}
for s in rd("stops.txt"):
    stops[s["stop_id"]] = s
    if s["location_type"] == "1":
        parent_of[s["stop_id"]] = s["stop_id"]
    elif s["location_type"] == "0":
        parent_of[s["stop_id"]] = s["parent_station"] or s["stop_id"]

# --- scan stop_times --------------------------------------------------------
ride_times = defaultdict(list)            # (lnA, lnB) -> [seconds]
dep_count = defaultdict(lambda: [0, 0])   # lnA -> per profile departures in window
lnode_key = {}                            # (parent, route, dir) -> index
lnodes = []                               # (parent, route, dir)
def ln(p, r, d):
    k = (p, r, d)
    if k not in lnode_key:
        lnode_key[k] = len(lnodes); lnodes.append(k)
    return lnode_key[k]

def flush(tid, rows):
    info = trips.get(tid)
    if not info or len(rows) < 2: return
    route, d, flags = info
    rows.sort(key=lambda r: r[0])
    prev = None
    for _, stop, arr, dep in rows:
        p = parent_of.get(stop)
        if p is None: continue
        if prev and prev[0] != p:
            a, b = ln(prev[0], route, d), ln(p, route, d)
            ride_times[(a, b)].append(arr - prev[1])
        if prev is None or prev[0] != p:
            prev = (p, dep)
            if WINDOW[0] <= dep < WINDOW[1]:
                a = ln(p, route, d)
                for i in (0, 1):
                    if flags[i]: dep_count[a][i] += 1

cur, rows, seen = None, [], set()
with open(os.path.join(src, "stop_times.txt"), encoding="utf-8-sig", newline="") as f:
    r = csv.reader(f); hdr = next(r)
    ix = {h: i for i, h in enumerate(hdr)}
    it, ia, idp, iss, isq = ix["trip_id"], ix["arrival_time"], ix["departure_time"], ix["stop_id"], ix["stop_sequence"]
    for row in r:
        tid = row[it]
        if tid != cur:
            if cur is not None: flush(cur, rows)
            cur, rows = tid, []
            if tid in seen: print("warning: non-contiguous trip", tid)
            seen.add(tid) if tid in trips else None
        if tid in trips and row[ia]:
            rows.append((int(row[isq]), row[iss], hms(row[ia]), hms(row[idp] or row[ia])))
    flush(cur, rows)
print("line nodes:", len(lnodes), "ride edges:", len(ride_times))

# --- stations ----------------------------------------------------------------
used = sorted({p for p, _, _ in lnodes})
sidx = {p: i for i, p in enumerate(used)}
def norm(n):
    n = unicodedata.normalize("NFD", n.lower())
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    for w in ("gare de ", "gare du ", "gare d'", "gare "): n = n.replace(w, "")
    return " ".join(n.replace("-", " ").replace("'", " ").split())
st = []
for p in used:
    s = stops[p]
    st.append([p, s["stop_name"], round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5)])

def dist_m(a, b):
    la = math.radians((a[2] + b[2]) / 2)
    dy = (a[2] - b[2]) * 111320; dx = (a[3] - b[3]) * 111320 * math.cos(la)
    return math.hypot(dx, dy)

# hubs: same normalized name within 700 m
parent = list(range(len(st)))
def find(x):
    while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
    return x
byname = defaultdict(list)
for i, s in enumerate(st): byname[norm(s[1])].append(i)
for ids in byname.values():
    for i in ids:
        for j in ids:
            if i < j and dist_m(st[i], st[j]) < 700: parent[find(i)] = find(j)
for i, s in enumerate(st): s.append(find(i))

# --- walking transfers --------------------------------------------------------
grid = defaultdict(list)
for i, s in enumerate(st): grid[(int(s[2] * 200), int(s[3] * 140))].append(i)
gtfs_tr = {}
for t in rd("transfers.txt"):
    a, b = parent_of.get(t["from_stop_id"]), parent_of.get(t["to_stop_id"])
    if a in sidx and b in sidx and a != b and t["min_transfer_time"]:
        k = (min(sidx[a], sidx[b]), max(sidx[a], sidx[b]))
        gtfs_tr[k] = min(gtfs_tr.get(k, 10**9), int(t["min_transfer_time"]))
walks = {}
for i, s in enumerate(st):
    gx, gy = int(s[2] * 200), int(s[3] * 140)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for j in grid.get((gx + dx, gy + dy), []):
                if j <= i: continue
                d = dist_m(s, st[j])
                if d <= WALK_MAX_M:
                    geo = 90 + d * DETOUR / WALK_SPEED
                    walks[(i, j)] = round(max(geo, gtfs_tr.get((i, j), 0)))
# interchange hubs (same name, up to 700 m) and explicit GTFS transfers up to 800 m
for (i, j), t in gtfs_tr.items():
    d = dist_m(st[i], st[j])
    if d <= 800: walks[(i, j)] = round(max(t, 90 + d * DETOUR / WALK_SPEED)) if (i, j) not in walks else walks[(i, j)]
for ids in byname.values():
    for i in ids:
        for j in ids:
            if i < j and (i, j) not in walks:
                d = dist_m(st[i], st[j])
                if d < 700: walks[(i, j)] = round(120 + d * DETOUR / WALK_SPEED)
print("stations:", len(st), "walk links:", len(walks))

# --- output ----------------------------------------------------------------------
line_ids = sorted({r for _, r, _ in lnodes})
lidx = {r: i for i, r in enumerate(line_ids)}
lines = [[routes[r]["route_short_name"], "#" + (routes[r]["route_color"] or "888888"), int(routes[r]["route_type"])] for r in line_ids]

def wait(a, i):
    n = dep_count[a][i]
    if n == 0: return -1
    head = (WINDOW[1] - WINDOW[0]) / n
    return round(min(max(head / 2, 60), 900) + 30)
lout = [[sidx[p], lidx[r], int(d), wait(i, 0), wait(i, 1)] for i, (p, r, d) in enumerate(lnodes)]
rides = [[a, b, round(statistics.median(v))] for (a, b), v in ride_times.items() if statistics.median(v) > 0]
data = {"profiles": profiles, "profileDates": [d.isoformat() for d in profile_dates],
        "stations": st, "lines": lines, "lnodes": lout, "rides": rides,
        "walks": [[i, j, w] for (i, j), w in walks.items()]}
json.dump(data, open(out, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
print("wrote", out, os.path.getsize(out) // 1024, "KB")
