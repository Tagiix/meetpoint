# Meet Point

Find the fairest place to meet in Île-de-France. One person creates an **event** and sends a link;
everyone who opens it adds their own position and how they travel (walk, transit, bike, car, optionally
buses). The best meeting stations update live and an animation shows everybody travelling there.

- Optimizes for the **fairest** meeting point (shortest longest trip), the **fastest overall** (least total time) or **balanced** (root-mean-square of trip times). Only measurable travel times are used.
- Each person can give a different address for the way back; both directions count as trips. Addresses can be typed, picked on the map (click a station to snap to it) or searched as a metro/RER/bus station.
- The organizer can edit or remove anybody's entry.
- Optional limits: longest acceptable trip, weekday or weekend timetables.
- Abstract map built from open data: rail lines in official colours, roads, the Seine, parks, towns, and every
  restaurant, café and bar. No map tile service, no API keys.
- Runs on a **basic PHP server**: no database, no build step, no Node on the server. The routing runs in the browser.

## Quick start (local)

Requirements: PHP 7.4+ with the `mbstring` extension. Nothing else.

    git clone <this repo> meetpoint && cd meetpoint
    php -S 127.0.0.1:8765 -t .            # then open http://127.0.0.1:8765
    tools/smoke_test.sh                   # checks the install end to end (optional)

The repository already contains the built map and timetable data (`data/*.json`, about 18 MB), so there is
nothing to download or build to run it.

## Documentation

| For | File |
|---|---|
| Putting it on a server (Apache, nginx, subfolder, HTTPS, backups) | [docs/DEPLOY.md](docs/DEPLOY.md) |
| AI agents working on or deploying this repo | [AGENTS.md](AGENTS.md) |
| How it works: files, data flow, the routing model, the event API | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Where the data comes from, licences, how to refresh it | [docs/DATA.md](docs/DATA.md) |
| Something does not work | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |
| Decisions, dead ends and history | [docs/DEVLOG.md](docs/DEVLOG.md) |

## Tests

    node test/solver.test.js              # routing and scoring (node only, no dependencies)
    tools/smoke_test.sh [base-url]        # static files, PHP, the whole event API, security checks
    cd test/e2e && npm install && npm run install-browser && BASE=http://127.0.0.1:8765 npm test   # real browser, two users

## Known limits

Meeting points are stations only. Times are estimates from average timetables (average waits, no real-time
data). Bus line drawings are rough (IDFM's traces are partly straight between stops). English interface only.
No user accounts: anyone with an event link can add themselves; only the organizer's private link can change
settings. Data licences and attribution: see [docs/DATA.md](docs/DATA.md).
