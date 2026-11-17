# Guide for AI agents

Read this first if you are an agent asked to **deploy**, **debug** or **change** Meet Point. Humans: see README.md.

## What this is
A vanilla HTML/JS/PHP app (no framework, no bundler, no database). The browser does all routing
(`assets/solver.js`) on pre-built JSON data in `data/`. PHP (`api/meetup.php`) only stores events as files.

## Deploy in five commands
    php -v && php -m | grep -i mbstring            # PHP >= 7.4 with mbstring
    git clone <repo> <dir> && cd <dir>             # the built data is in the repo
    chown -R <php-user> data/events && chmod 775 data/events
    # configure the web server (docs/DEPLOY.md has Apache and nginx), reload it
    tools/smoke_test.sh <base-url>                 # must end with ALL PASSED

Do not build data to deploy. Do not run `tools/build_*.py` unless asked to refresh data.

## Run and test locally
    php -S 127.0.0.1:8765 -t .                         # dev server (PHP_CLI_SERVER_WORKERS=4 for parallel requests)
    node test/solver.test.js                           # routing/scoring, expects "ok" and "bus ok"
    tools/smoke_test.sh http://127.0.0.1:8765          # expects ALL PASSED
    cd test/e2e && npm install && npm run install-browser && BASE=http://127.0.0.1:8765 npm test   # real browser

Verify UI changes in a browser (the e2e test or Playwright screenshots). Syntax checks alone do not catch rendering bugs.
Node: `node --check assets/*.js`. PHP: `php -l api/meetup.php`.

## Layout
| Path | Role |
|---|---|
| `assets/engine-core.js`, `assets/solve-worker.js`, `assets/engine.js` | the solving engine (no DOM), the Web Worker hosting it, and the page-side client with a page-thread fallback |
| `tools/seed_events.py` | creates sample events on a running server and prints organizer/guest links and one `?import=` link |
| `index.php` | single page shell (PHP only to stamp `?v=<build id>` on every asset URL); scripts in order: Leaflet (CDN), solver, flow, basemap, api, app |
| `api/build.php`, `api/_build.inc.php` | build id = hash of file sizes and mtimes; the open page polls it every minute and reloads itself on a change |
| `assets/solver.js` | pure functions (browser and node): graph routing (Dijkstra per person), multi-person scoring, itinerary legs |
| `assets/basemap.js` | cached canvas tiles (Leaflet GridLayer): parks, water, roads, rail, bus, restaurant dots/glow; plus a label/station overlay |
| `assets/flow.js` | travel animation canvas (shared clock, waiting rings, arrival pulses) |
| `assets/app.js` | all UI state and rendering, event polling, address search, OSRM street routes |
| `assets/api.js` | client for `api/meetup.php` |
| `assets/style.css` | the only stylesheet: design tokens at the top, light and dark |
| `api/meetup.php` | event store (create/join/update/leave/options/delete), files in `data/events/` |
| `data/*.json` | generated data, committed (see docs/DATA.md) |
| `tools/` | data builders (Python), `smoke_test.sh` |
| `test/` | `solver.test.js` (node), `e2e/` (Playwright) |
| `docs/` | DEPLOY, ARCHITECTURE, DATA, TROUBLESHOOTING, DEVLOG |

## Invariants — do not break these
1. **No secrets in responses.** `public_view()` strips `hash` and `adminHash`. The smoke test checks it.
2. **Event files must not be web-readable.** They are `<id>.php` beginning with a `GUARD` line. Never store events as `.json` or in a public path.
3. **Ownership checks live in PHP**, not in the UI: only the entry's token or the organizer key may change an entry; only the organizer key changes options or deletes.
4. **Meeting candidates are rail stations only** (`graph.stations[0..railCount)`); bus stops are access/transfer nodes. `solver.js` relies on `Network.R`.
5. **`graph-bus.json` is tied to `graph.json`** (it stores their sizes and `mergeGraph` throws on mismatch). Rebuild both together.
6. **Keep the app free of API keys and tile services.** The map is drawn from `data/`. (CARTO tiles started demanding a key in 2026; see DEVLOG.)
7. **Relative URLs only** so subfolder installs work.
8. **Avoid tracker-looking URLs.** Ad blockers cancel requests whose URL looks like analytics (`event.php`, `?ping=`, `/track`). The endpoint is `meetup.php`, and the health check has no query string.

## Conventions
- Comments explain why, not what. English UI strings are inline in `app.js`.
- One design system: use the CSS variables and the `.btn/.input/.select/.seg/.chip/.card/.field/.switch` components. Do not add one-off styles.
- Re-render rules in `app.js`: delegated listeners on `#view`; polling must never re-render a form the user is typing in (`renderAddIfNeeded`, `inside(...)` checks).
- Python tools use only the standard library, except `build_osm.py` (needs `osmium`, see `tools/requirements.txt`).

## Gotchas learned the hard way (details in docs/DEVLOG.md)
- Overpass (the public OSM query API) is frequently overloaded: do not depend on it. Use the Geofabrik extract with `tools/build_osm.py`.
- Douglas-Peucker on a closed ring collapses it (identical endpoints): `dp_ring` splits it first. Polygons carry holes (islands); draw with even-odd.
- `php -S` ignores `.htaccess`; nginx too. Security must not rely on them.
- zsh does not expand a glob with no match and aborts the command: quote or use `find`.
- Headless Firefox did not start in the sandbox used during development; Chromium via Playwright did.

## Typical tasks
- *Change scoring*: `AGG` and `solve()` in `solver.js`, add a unit check in `test/solver.test.js`, surface the option in `optionsHTML()` and in `clean_options()` (PHP) so it is persisted.
- *New event setting*: add to `DEFAULT_OPTS` and `optionsHTML` (app.js), `clean_options` (PHP), README mention.
- *Refresh timetables*: docs/DATA.md.
