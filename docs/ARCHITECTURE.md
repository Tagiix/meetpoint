# Architecture

## Data flow
    browser ── GET index.php (stamps ?v=<build> on every asset URL), assets/*, data/*.json ──► files
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

`solve()` scores every rail station over the list of trip times (one per person and direction, so each person counts twice; the way back uses the person's `ret`
address when set, timed like the way there from that address, and counts as a duplicate of the way there otherwise). Scores are generalized means, checkable by hand:
`max` (longest trip, mean as tie-break), `sum` (weighted mean), `balanced` (weighted root-mean-square). Nothing but travel time enters a score.
Stations over the user's longest-trip limit are excluded
(if nobody qualifies it shows the closest and says so); keeps the best station per hub (same-name stations within 700 m).
Ten people solve in about 10 ms (rail) and 250 ms (with buses).

For the selected result `itinerary()` rebuilds each person's legs (access, wait, rides, transfers). `app.js` then replaces walk/bike/car legs
with OSRM street geometry and durations, and updates the card numbers so they match the animation.

## The abstract map (`assets/basemap.js`)
No map service: a Leaflet `GridLayer` whose tiles are canvases painted from our own data. Each 256 px tile is painted once (newest request first, a few ms per slice so the page stays
responsive) and kept in a 100-tile cache, so panning and zooming only move and scale finished tiles and Leaflet's zoom animation works. Layers in draw order: green areas,
water polygons (even-odd, so islands are holes), rivers, roads (4 tiers, one path and one stroke per style), optional bus lines, rail lines by mode, restaurant glow
(zoom < 14.5, 1/4 resolution scaled up to blur; tile edges line up because 256 is a multiple of 4) or dots (zoom ≥ 14.5).
Town, park and station names are not in the tiles (names must not be cut at tile edges): they are drawn on one overlay canvas in its own pane, 25 % larger than the view, repainted
when a move ends or the zoom changes and hidden by Leaflet during zoom animations. Changing data or a legend switch calls `draw()`, which invalidates every tile (coalesced).
Points are mercator floats (`Float32Array`) culled by bounding box.

**Everything is loaded once at page start** (`loadBasemap` in `app.js`): core layers first so the first picture appears at once, then secondary and tertiary roads, bus lines and the bus
network, built in slices. Nothing is requested while using the map. The only network calls afterwards are the event API (polling with back-off: 10 s, then 20 s and 40 s while nothing changes, none in a hidden tab),
the address search, and OSRM street routes for the selected result (debounced 0.5 s, cached by trip).

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
| `POST {action:"update", id, pid, token \| adminKey, p}` | entry token or organizer | edit an entry (`p.ret` = way-back address or null) |
| `POST {action:"leave", id, pid, token \| adminKey}` | entry token or organizer | remove an entry |
| `POST {action:"options", id, adminKey, title?, options}` | organizer | settings and title |
| `POST {action:"delete", id, adminKey}` | organizer | delete the event |

Per-browser secrets (organizer key, entry tokens) are kept in `localStorage` under `meetpoint:v2`.

## Front-end state (`assets/app.js`)
`S` holds the current event, the organizer key, own entry tokens, the add-form draft and UI flags. Views are rendered into `#view` as HTML strings with
delegated listeners (so re-rendering never loses handlers). Solving is debounced and keyed by a signature of people and options; the selected result
survives re-solves when its station is still ranked.
