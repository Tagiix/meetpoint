# Data: sources, licences, rebuilding

All files in `data/` are **generated and committed**, so a fresh clone works with no build. Refresh only to update timetables or the map.

| File | Size | What | Source | Built by |
|---|---|---|---|---|
| `graph.json` | 140 KB | rail routing graph (stations, lines, rides, waits, walks) | IDFM GTFS | `tools/build_graph.py` |
| `graph-bus.json` | 3.5 MB | bus add-on (stops, lines, rides, walks); optional | IDFM GTFS | `tools/build_bus.py` |
| `rail-lines.json` | 320 KB | rail line drawings with official colours | IDFM dataset `traces-du-reseau-ferre-idf` | `tools/build_basemap.py` |
| `bus-lines.json` | 4 MB | bus line drawings; optional, loaded on demand | IDFM dataset `traces-des-lignes-regulieres-de-bus-en-ile-de-france` | `tools/build_basemap.py` |
| `roads.json`, `roads-detail.json` | 1.2 MB, 2.7 MB | motorway to primary; secondary and tertiary | OpenStreetMap | `tools/build_osm.py` |
| `water.json`, `green.json` | 0.8 MB, 2.5 MB | rivers, water polygons; parks and forests with names | OpenStreetMap | `tools/build_osm.py` |
| `places.json`, `pois.json` | 10 KB, 0.8 MB | town names; ~24,000 restaurants, cafés and bars | OpenStreetMap | `tools/build_osm.py` |
| `restaurants.json` | 15 KB | places to eat within 300 m of each station | OpenStreetMap | `tools/build_osm.py` |
| `events/` | — | runtime event store, **not** in git | — | `api/meetup.php` |

The app works with only `graph.json` and `rail-lines.json`; the OpenStreetMap files and `*-bus*` files add map detail and features.

## Licences and attribution
- **OpenStreetMap** data: © OpenStreetMap contributors, ODbL. The map shows this attribution; keep it.
- **Île-de-France Mobilités** open data (timetables and line traces): published on data.iledefrance-mobilites.fr under the licence stated on each dataset page. Check it before any public or commercial use, and keep the attribution (shown in the map corner).
- **adresse.data.gouv.fr** (Base Adresse Nationale): open licence (Etalab); used live from the browser.
- **OSRM** demo server at routing.openstreetmap.de: usage policy applies, light use only.
- The repository itself has **no licence file yet**: add one before inviting outside contributions.

## Refreshing the data

Timetables change every few weeks. The GTFS feed starts and ends on given dates (`calendar.txt`); the graph uses a typical Wednesday and Saturday
inside it (`profileDates` in `graph.json`).

    # timetables (112 MB download)
    curl -O https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip && unzip IDFM-gtfs.zip -d gtfs
    python3 -I tools/build_graph.py gtfs              # data/graph.json
    python3 -I tools/build_bus.py gtfs                # data/graph-bus.json (always rebuild together with graph.json)

    # line drawings (geojson exports from the IDFM open data portal)
    BASE=https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets
    curl -o rail.json "$BASE/traces-du-reseau-ferre-idf/exports/geojson"
    curl -o bus.json  "$BASE/traces-des-lignes-regulieres-de-bus-en-ile-de-france/exports/geojson"
    # (the exports may be gzip-compressed: `gunzip -c rail.json > r && mv r rail.json` if the first byte is 0x1f 0x8b)
    python3 -I tools/build_basemap.py rail.json bus.json

    # OpenStreetMap context layers (350 MB extract, a few minutes)
    python3 -m venv .venv && . .venv/bin/activate && pip install -r tools/requirements.txt
    curl -LO https://download.geofabrik.de/europe/france/ile-de-france-latest.osm.pbf
    python tools/build_osm.py ile-de-france-latest.osm.pbf

Then `node test/solver.test.js`, `tools/smoke_test.sh`, look at the map, and commit the changed `data/*.json`.
Do not use the Overpass API for this (it is regularly overloaded); the Geofabrik extract is reliable.
`tools/build_osm.py` takes about 5 minutes and about 2 GB of RAM.
