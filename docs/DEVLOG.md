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
- **Candidates are stations by default** (reachable and meaningful; a grid of arbitrary points would need street-level routing). Since round 5 the organizer can also allow named places (restaurants, cafés, bars, parks, culture, sights), always reached through a stop plus a walk or directly by foot, bike or car.
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

## Round 4: speed
- Measured first (headless Chromium, forced canvas readback). Replaced the single big canvas by cached tiles (`GridLayer`): drag worst frame 50 → 33 ms (0 dropped frames over cached tiles),
  zoom first frame 43–71 → 13–26 ms with Leaflet's zoom animation back, tiles fill in within ~110 ms without blocking.
- Everything loads at start (~0.3 s to a map, ~0.6 s to complete on localhost). The animation no longer starts by itself. OSRM lookups are debounced and cached, polling backs off.
- "Reload everything" button (footer): refetches the app and data past the browser cache; `.htaccess` makes scripts and styles revalidate on every load.
- Web research (web.dev, OpenLayers, canvas map write-ups) agreed: pre-render and blit, keep work under 50 ms per task, use workers only for tasks above ~20 ms. Our biggest remaining task is
  solving with buses (~250 ms); a worker would help there, not done yet.
- **Automatic updates.** `index.php` stamps every asset and data URL with a build id (hash of file sizes and mtimes, `api/_build.inc.php`); the open page asks `api/build.php` every minute and when the
  tab is shown again, and reloads itself on a change (it waits, with a "reload" link, if someone is typing or has a half-filled form; a sessionStorage guard prevents reload loops). No build step, any PHP server.
- **Address dropdown**: stations (rail, and bus stops once loaded) are matched locally and shown instantly above the address results, ignoring case, accents, apostrophes and spaces; keyboard: arrows, Tab/Shift+Tab, Enter (first entry if none highlighted), Escape.
- **"Far east" results (user report)**: not reproducible on a fresh load (about 1,500 random western groups gave none); the owner confirmed they were caused by stale cached files from before an update. Prevented by the auto-update (versioned URLs).
- **Solving in a Web Worker** (branch `feature/web-worker`). `assets/engine-core.js` (graphs, networks, solve, itineraries; no DOM) runs in `assets/solve-worker.js`; `assets/engine.js` is the page-side client
  (newest request wins while one is running; same code on the page thread if the worker cannot start). The heavy per-station table never leaves the worker, only the top 3 and, on selection, the legs.
  Measured with 10 people, switching buses on: worst frame gap 17 ms with the worker against 217 ms on the page thread (the old behaviour); identical results.

## Round 5: meeting places other than stations (branch `feature/any-place`)
- Event option `meet` (a list; the first version was `where = stations | places`, still read for old events): any mix of `station`, `r` restaurants, `c` cafés, `b` bars (pubs included), `park`, `culture` (museums, galleries, theatres, cinemas, arts centres, libraries, music venues) and `sights` (attractions as buildings or sites, viewpoints, castles, monuments, ruins, forts). About 26,000 named places plus `data/culture.json` (`tools/build_culture.py`, ~3,200 culture + ~1,400 sights). The UI is a row of chips; at least one stays on.
- Stations and places can be candidates together; stations of one hub and anything within 500 m of a kept result are skipped.
- Time to a place for one person = min(direct trip by walk/bike/car, arrival at a stop within 900 m of the place (500 m for bus stops) + the walk). Same scoring for every objective and for the way back;
  results are at least 500 m apart. `solver.js`: `stopsNear`, `placeCandidates`, `placeSeconds`, `itineraryPlace`; the place list lives in the engine (worker), so it is never sent on each solve.
- What "any place" adds (corrected): for ONE person on public transport a place is a stop plus a walk, so it never beats the stop. For a GROUP it can, because different people may get off at different stops near the place, whereas a station candidate puts everyone on the same stop; and people on foot, bike or car need no stop at all. Measured on random groups of 3 (rail only): best place beat best station in 5/120 transit-only cases (up to 2.2 min) and 57/120 mixed-mode cases (up to 8.8 min). The combined candidate set (stations + places) was never worse than either alone. Both are exact minima over their own candidate set (brute force), so a station-only answer being better than a places-only answer in some groups is not a defect.
  turning the answer into an actual place to sit down. On a 10-person sample the best station was 31 min, the best place 33 min (rail only).
- Tests: brute force over all stops (no grid) for the 3 objectives, legs add up including the final walk, spacing, drivers get one direct leg. Solve time with all places and 10 people: ~50 ms (rail), 590 ms with buses (in the worker).

## Round 6: the vote (branch `feature/voting`)
- Phases of an event: `open` (people register) <-> `voting`. The organizer's button "Everyone is registered: start the vote" snapshots the top 5 (names, positions, per-person times, longest, sum) into the event as the ballot,
  locks registration (join, edit, leave, settings are refused by the server) and starts the vote. "Reopen registration" goes back and drops the ballot and votes.
- The vote is deliberately only visual (user's call): each registered person picks one option (or takes it back), the cards show the count, a dot per voter in their colour and "leading". No winner announcement step.
  The organizer may vote for anyone; a person votes with their own token. Votes are public to the people of the event.
- While voting, the left panel is the vote: the top 5 with stats, what is around each (restaurants, cafés, bars within 350 m, culture and sights within 700 m, parks within 600 m, from local data),
  a click selects it and zooms the map there (a second click zooms back out), the organizer keeps the "Reopen registration" control; people, add form, settings and invite are hidden.
- Results are now the top 5 everywhere (they were 3).
- API: `close`, `vote`, `reopen` (see api/meetup.php); smoke test covers phases, permissions and locks; e2e runs organizer + guest through the whole vote.
- **"Your events" list**: it is the browser's own memory (localStorage), so deleted events stayed listed and events created on the server were unknown to it. The home page now asks the server about every remembered event, forgets the ones that no longer exist and refreshes titles; `?import=id.key,id.key` remembers several events as organizer in one click.
- `tools/seed_events.py [base-url]` creates five sample events (random but repeatable) and prints organizer and guest links plus one import link.
- Import and storage diagnostics (owner reported the import link showing nothing in Zen while a fresh Zen profile driven over its debugging port worked): the page now says "Remembered N events in this browser (M in the list)" after an import, imported events get a placeholder title so they are listed at once, a storage self-test warns when the browser blocks site storage, and `store()` tolerates damaged saved data. Verified in real Zen (headless, fresh profile) with empty, stale and invalid saved state.
  Confirmed working in the owner's Zen after the last of these changes (the exact cause on their profile was never pinned down: imported events used to stay hidden until the server lookup had given them a title). The page now also states when it removes remembered events and why.

## Round 7: French interface (branch `feature/french`)
- `assets/i18n.js`: the English sentence is the key, the French dictionary (about 190 entries) is next to it; a sentence without French shows in English and is listed in `I18n.missing`, which the e2e test requires to be empty after a tour of the pages.
  Placeholders `{name}`, plural helper `trn` (French counts 0 and 1 as singular). The language is the browser's unless EN | FR was clicked (kept in localStorage; switching reloads the page, nothing else is lost).
- Fixed page text uses `data-i18n*` attributes (index.php); app text goes through `tr()`. Addresses are stored in English markers ("Dropped pin", "(station)") and shown translated (`dispAddr`), so an event reads correctly in either language;
  server error messages are translated on the client; culture types come from OpenStreetMap in English and are translated for display (museum -> musée).
- Not translated: the docs (English), the place names and addresses (they are data).
- To add a language: copy the French dictionary in `assets/i18n.js`, translate the values, and add the language code to the switch.

## Not done / ideas
- Live traffic and real-time departures: **decided against** (2026-11-17). It needs the transport authority's API key (so a server-side proxy), rate-limit handling and per-person queries that cannot be precomputed, which breaks the "basic server, everything in the browser" design; the timetable model is already within a few minutes.
- More activity types or another language (the dictionary in `assets/i18n.js` makes a language a translation job, see round 7).
- Rate limiting; event expiry is only 90 days after last write.
- A licence file for the repository.
- Create in Zen/Firefox: confirmed working by the owner (2026-11-17). Not yet run in automated Firefox tests (headless Firefox will not launch in the dev sandbox: "Could not find profile folder").
