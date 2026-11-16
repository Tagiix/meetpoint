# Development log

The project was built in a single working session on 2026-11-16 (with Claude Code). This is the decision trail: what was chosen, what failed, why.

## Goal
Several people give their position and how they travel near Paris; the app finds the best meeting point. Constraints from the owner: HTML/JS/PHP,
a **basic personal server**, up to 10 people, several transport modes (RER, metro, bus, bike, car, walking), several objectives (minimize total time,
minimize the longest trip, restaurants nearby), a nice flow animation, and the **event model**: one person creates an event, many people add their own position.

## Decisions
- **Routing runs in the browser.** A basic PHP host cannot run a routing engine (OpenTripPlanner needs Java and GBs of RAM; a PHP Dijkstra per request would be slow).
  Instead, offline scripts compress the IDFM GTFS timetables into a 140 KB graph; JavaScript runs one Dijkstra per person (about 10 ms for 10 people).
- **Rail by default, buses optional.** Buses (1,967 lines, 15,000 stop areas) add 3.5 MB and ~250 ms per solve, so they load only when ticked.
- **Candidates are stations.** Reachable and meaningful; a grid of arbitrary points would need street-level routing.
- **Average waits, not live times.** Boarding costs half the typical headway for a weekday or Saturday off-peak window. Honest about it in the UI.
- **Walk, bike and car legs are estimated, then refined** with OSRM street routes for the selected result only (≤ 20 calls), which also gives the geometry for the animation.
- **Walking is an explicit mode, on by default** (owner's request). Transit users still walk to stations.
- **Events, not a shared link.** Organizer key and per-entry tokens, all hashed server-side; no accounts. First version had a plain "share link" session store; replaced.
- **Abstract map drawn from open data, no tiles.** See "CARTO" below. The owner wanted a minimalist but informative map: roads, rail, parks, restaurants and cafés.
- **One design system** (`assets/style.css` tokens + components) after the first UI looked inconsistent.

## Problems met and how they were fixed
1. **CARTO tiles showed "API KEY REQUIRED".** The free basemap now needs a key from browsers. Replaced by our own canvas basemap, which also removed the dependency on any tile service.
2. **Overpass API unusable** (502/504, 406 for default user agents). Abandoned for bulk data; used the Geofabrik Île-de-France extract (`tools/build_osm.py`, pyosmium). Restaurant counts now come from the same pass.
   (A request that put the owner's email in the User-Agent was correctly blocked by the agent's safety layer: never put personal data in third-party requests.)
3. **Parks and lakes were invisible**: Douglas-Peucker simplification collapses a closed ring because its endpoints coincide. Fixed with `dp_ring`. Then **islands in the Seine were filled** because inner rings (holes) were dropped; polygons now carry holes and are drawn with the even-odd rule.
4. **Restaurant density looked horrible.** Stacked translucent circles saturated Paris, then a grid of squares looked blocky. Final: counts drawn at ¼ resolution and scaled up (soft glow), faint, fading out as individual dots appear.
5. **Lens view built then removed.** A Paris-centred fisheye (inspired by stations.delaven.net) was implemented and worked, but the owner asked to remove it; it is gone from the code. It is in git history if wanted.
6. **"Create event" greyed out in the owner's Zen (Firefox) browser** with "NetworkError when attempting to fetch resource": the request was cancelled client-side, consistent with a content blocker matching tracker-like URLs.
   Mitigations: endpoint renamed `event.php` → `meetup.php`, health check changed from `?ping=1` to a bare request, the button is never disabled, and the real error is shown. Not reproduced in Chromium (Firefox would not launch in the dev sandbox), so the root cause on the owner's machine is unconfirmed.
7. **Security finding by the smoke test**: event files under `data/events/*.json` were readable over the web on servers that ignore `.htaccess` (`php -S`, nginx). Events are now stored as `<id>.php` with a guard line, safe on every server.
8. Live updates skipped while a form had focus, so a stale focus froze the organizer's view. Polling now updates everything except the field being edited.

## Round 3 (after the first public release)
- **Smoother map.** Profiling (headless Chromium, forced readback) showed roads, not restaurants, dominated the repaint cost: the whole canvas was repainted on every `move` event
  with one stroke per road. Now: oversized canvas slid while dragging, repaint on zoom or when the margin is used, roads batched per style, cheap joins/caps, no road outline below zoom 12,
  cheaper restaurant glow. Restaurants stay (cost about 15 ms of a repaint at low zoom), toggle in the legend. All routing was already client side.
- **Removed the restaurant preference** from scoring (UI, option, `restaurants.json`, build step): only measurable times.
- **"Balanced" was broken for two people**: mean + ½·range equals the max exactly when n = 2, so Fairest and Balanced always agreed (198/200 random pairs). Now the root-mean-square.
- **Round trips**: optional different address for the way back; scores use both directions (max over both, sum and RMS over both). The animation has a Going / Coming back selector.
- **Organizer can edit anyone's entry**, addresses are editable in the edit panel, stations can be picked by clicking (snap) or by autocomplete (rail, bus stops).
- **Route visibility**: planned routes are dotted with a white halo, the travelled part is thick and solid (walking stays dotted).
- Tests: solver tests cover the scores and the way back; the e2e test covers organizer editing, station search and the way back.

## Not done / ideas
- Meeting points other than stations (squares, parks, restaurants themselves).
- Live traffic and real-time departures; PRIM/Navitia API integration for exact journeys.
- Activity filter (parks, culture, cinemas) beyond food and drink; French interface.
- Rate limiting; event expiry is only 90 days after last write.
- A licence file for the repository.
- Confirm the "Create" issue is gone in Zen/Firefox; run the e2e test in Firefox (`playwright install firefox` worked, but headless launch failed in the sandbox).
