# Architecture

## Data flow
    browser ── GET index.html, assets/*, data/*.json ──► static files
    browser ── POST/GET api/meetup.php ──────────────► PHP: events as files in data/events/
    browser ── address search ──► api-adresse.data.gouv.fr         (geocoding)
    browser ── street geometry ─► routing.openstreetmap.de (OSRM)  (walk/bike/car route shapes)

All routing and scoring happen in the browser. The server never computes a route.

## The routing model (`assets/solver.js`, data in `data/graph*.json`)
Built offline from the IDFM GTFS timetables (`tools/build_graph.py`):
- **Station nodes**: GTFS parent stations with rail service (996 stations, 59 lines: metro, RER, Transilien/TER, tram, funicular).
- **Line nodes**: one per (station, line, direction). Boarding a line from a station costs half the average headway
  (clamped 1–15 min, plus 30 s), measured in the 10:00–19:00 window for a typical weekday and Saturday. If a line does not run in that window
  on that day type it cannot be boarded. Alighting is free.
- **Ride edges** between consecutive stops: median in-vehicle time.
- **Walk edges** between stations up to 350 m apart (and GTFS transfers up to 800 m), with a 90–120 s base.
- Optional **bus layer** (`graph-bus.json`, `tools/build_bus.py`): bus stop areas, lines and walk links, indexed after the rail ones.

Per person (`personTimes`): direct trip time to every rail station for each ticked mode (walk 4.5 km/h × 1.3 detour, bike 15 km/h + 3 min,
car with a distance-based speed model + 8 min parking) and a multi-source Dijkstra for transit starting at every station reachable
on foot (≤ 2.2 km) or by bike (≤ 6.5 km; buses: 1.2 km and 3 km). The person's time to a station is the minimum.
A person with only "transit" ticked still walks to stations; "walk" controls direct walking trips.

`solve()` scores every rail station: `max` (fairness), `sum` (weighted mean), `balanced` (mean + ½ spread); subtracts a bonus
for restaurants nearby (up to 10 min-equivalent, saturating at 25 places); excludes stations over the user's longest-trip limit
(if nobody qualifies it shows the closest and says so); keeps the best station per hub (same-name stations within 700 m).
Ten people solve in about 10 ms (rail) and 250 ms (with buses).

For the selected result `itinerary()` rebuilds each person's legs (access, wait, rides, transfers). `app.js` then replaces walk/bike/car legs
with OSRM street geometry and durations, and updates the card numbers so they match the animation.

## The abstract map (`assets/basemap.js`)
A canvas below Leaflet's panes; Leaflet only provides pan/zoom, markers and the projection (it has no tile layer). Layers, in draw order:
green areas, water polygons (even-odd, so islands are holes), rivers, roads (4 tiers, secondary/tertiary load lazily from `roads-detail.json` at zoom ≥ 12),
optional bus lines, rail lines by mode, restaurant glow (zoom < 14.5, drawn at ¼ resolution and scaled up to blur) or dots (zoom ≥ 14.5, names at ≥ 16),
town and park names, stations and their labels (collision-avoided). Points are stored as mercator floats (`Float32Array`) and culled by bounding box.
`zoomAnimation` is off so the canvas can redraw on every move.

## Events (`api/meetup.php`)
One file per event: `data/events/<id>.php` = a guard line + JSON `{id, title, options, people[], adminHash, created, updated, rev}`.
Each person: `{id, name, addr, lat, lon, weight, modes, hash}`. Reads and writes take an exclusive file lock (read-modify-write).
`rev` increments on every change; clients poll `GET ?id=..&rev=N` every 10 s and get `{"unchanged":true}` when nothing moved.

| Request | Auth | Effect |
|---|---|---|
| `GET meetup.php` | none | health check `{"ok":true}` (store writable) |
| `GET meetup.php?id=ID[&rev=N]` | knowing the id | public view of the event |
| `POST {action:"create", title, options}` | none | returns `{id, adminKey}` |
| `POST {action:"join", id, p}` | knowing the id | adds a position, returns `{pid, token}` |
| `POST {action:"update", id, pid, token, p}` | that entry's token | edit own entry |
| `POST {action:"leave", id, pid, token \| adminKey}` | entry token or organizer | remove an entry |
| `POST {action:"options", id, adminKey, title?, options}` | organizer | settings and title |
| `POST {action:"delete", id, adminKey}` | organizer | delete the event |

Per-browser secrets (organizer key, entry tokens) are kept in `localStorage` under `meetpoint:v2`.

## Front-end state (`assets/app.js`)
`S` holds the current event, the organizer key, own entry tokens, the add-form draft and UI flags. Views are rendered into `#view` as HTML strings with
delegated listeners (so re-rendering never loses handlers). Solving is debounced and keyed by a signature of people and options; the selected result
survives re-solves when its station is still ranked.
