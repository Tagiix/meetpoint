# Troubleshooting

Always start with `tools/smoke_test.sh <base-url>`. Its first FAIL line is usually the answer.

| Symptom | Cause | Fix |
|---|---|---|
| Notice "Can't reach the event server (...)" at the top of the panel | The page is not served by PHP, the request is blocked, or `data/events/` is not writable. The text in brackets says which: `HTTP 404` = file missing, "the server did not answer with JSON" = PHP is not running (the web server is returning the PHP source or a different page), "data/events/ is not writable" = permissions, "NetworkError" / "Failed to fetch" = the request was blocked before it left the browser | Serve with PHP (`php -S 127.0.0.1:8765 -t .`). Fix permissions (docs/DEPLOY.md step 2). For "NetworkError": disable ad-blocker extensions or tracking protection for the site (some filter lists block URLs that look like trackers) |
| Plain `python3 -m http.server` or opening `index.html` as a file | No PHP, so events cannot work | Use PHP |
| Create works but the next page says "Event not found" | Events were written somewhere else than where they are read (two copies of the app, or a different document root) | Use one install; check `data/events/` of that install |
| `smoke_test.sh`: "event file is readable over the web" | A web server is serving PHP files as text (PHP not enabled for that path) | Enable PHP for `/data/` too, or add `location ^~ /data/events/ { deny all; }` |
| Map shows rail lines on a blank background | `data/roads*.json`, `water.json`, `green.json`, `places.json` or `pois.json` are missing (not deployed) | Restore them from the repo; see docs/DATA.md |
| "Prefer places with restaurants" slider disabled, "(data not built yet)" | `data/restaurants.json` missing | Restore from the repo, or rebuild with `tools/build_osm.py` |
| Turning on buses says "Could not load the bus network" | `data/graph-bus.json` is missing, or it was built for another `graph.json` | Restore both files from the same commit, or rebuild: `tools/build_graph.py` then `tools/build_bus.py` |
| Everything loads slowly | JSON not compressed | Enable gzip/deflate for `application/json` (Apache: the repo `.htaccess` does it; nginx: see docs/DEPLOY.md) |
| Address search finds nothing, "Locating…" lasts a few seconds | api-adresse.data.gouv.fr is slow or unreachable from the browser | Wait; the app gives up after 4–5 s and uses "Dropped pin". Positions can also be placed by clicking the map |
| No street routes, animation uses straight lines for walk/bike/car | routing.openstreetmap.de unreachable or rate-limited | Harmless: estimates are still used. Self-host OSRM for heavy use |
| "Use my location" does nothing | Not HTTPS, or permission denied | Use HTTPS (localhost also works) |
| Map is blank and the console shows errors from `leaflet` | CDN blocked | Self-host Leaflet (docs/DEPLOY.md) |
| Times look off for a train line | The timetable snapshot is old or the line uses average waits | Refresh the data (docs/DATA.md). Times are estimates by design |
| Browser console: `MouseEvent.mozPressure is deprecated` | Leaflet 1.9 with Firefox | Harmless |

## Reading the logs

- PHP errors: your web server's error log (Apache `error.log`, nginx `error.log`, php-fpm log). The app itself writes no logs.
- Local `php -S` prints every request to its terminal; a request line for `api/meetup.php` with a non-200 status shows the failure.
- Browser: open the developer console and the Network tab; failed requests to `api/meetup.php` show the HTTP status.
