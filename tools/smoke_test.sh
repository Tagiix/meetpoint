#!/usr/bin/env bash
# Smoke test of a running Meet Point install: static files, PHP, and the whole event API.
# Usage: tools/smoke_test.sh [base-url]      default http://127.0.0.1:8765
# Exit code 0 = everything passed. Leaves no data behind (it deletes the event it creates).
set -u
BASE="${1:-http://127.0.0.1:8765}"; BASE="${BASE%/}"
fail=0
ok()   { printf '  PASS  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }
warn() { printf '  warn  %s\n' "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
post() { curl -s --max-time 20 -X POST "$BASE/api/meetup.php" -H 'Content-Type: application/json' -d "$1"; }
field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }

echo "Meet Point smoke test against $BASE"
echo "[static files]"
[ "$(code "$BASE/")" = 200 ] && ok "index page" || bad "index page (is the web server running and pointing at this folder?)"
curl -s --max-time 20 "$BASE/" | grep -q 'assets/app.js?v=' && ok "index.php stamps asset URLs with the build id" || bad "index.php is not being run as PHP (asset URLs have no ?v=): is index.php the directory index?"
curl -s --max-time 20 "$BASE/api/build.php" | grep -q '"build":"' && ok "api/build.php (update check)" || bad "api/build.php does not answer"
for f in assets/app.js assets/solver.js assets/basemap.js assets/flow.js assets/api.js assets/style.css data/graph.json data/rail-lines.json; do
  [ "$(code "$BASE/$f")" = 200 ] && ok "$f" || bad "$f is missing or not served"
done
for f in data/graph-bus.json data/bus-lines.json data/roads.json data/roads-detail.json data/water.json data/green.json data/places.json data/pois.json data/culture.json; do
  [ "$(code "$BASE/$f")" = 200 ] && ok "$f" || warn "$f missing: optional, the map or a feature will be reduced (see docs/DATA.md)"
done

echo "[PHP and event API]"
h=$(curl -s --max-time 20 "$BASE/api/meetup.php")
case "$h" in *'"ok":true'*) ok "health check: $h";; *) bad "health check returned: ${h:-nothing} (PHP not running, or data/events/ not writable)";; esac
c=$(post '{"action":"create","title":"smoke test","options":{"objective":"max"}}')
id=$(printf '%s' "$c" | field id); ak=$(printf '%s' "$c" | field adminKey)
[ -n "$id" ] && ok "create event ($id)" || { bad "create event: $c"; echo "FAILED"; exit 1; }
j=$(post "{\"action\":\"join\",\"id\":\"$id\",\"p\":{\"name\":\"A\",\"lat\":48.85,\"lon\":2.35,\"modes\":{\"transit\":true}}}")
pid=$(printf '%s' "$j" | field pid); tok=$(printf '%s' "$j" | field token)
[ -n "$pid" ] && ok "join" || bad "join: $j"
post "{\"action\":\"join\",\"id\":\"$id\",\"p\":{\"name\":\"B\",\"lat\":48.9,\"lon\":2.3,\"modes\":{\"car\":true}}}" >/dev/null
g=$(curl -s --max-time 20 "$BASE/api/meetup.php?id=$id")
[ "$(printf '%s' "$g" | grep -o '"lat"' | wc -l | tr -d ' ')" = 2 ] && ok "read back 2 people" || bad "read back: $g"
case "$g" in *adminHash*|*'"hash"'*) bad "response leaks secret hashes";; *) ok "no secrets in the public view";; esac
r=$(post "{\"action\":\"update\",\"id\":\"$id\",\"pid\":\"$pid\",\"token\":\"wrong\",\"p\":{\"name\":\"X\",\"lat\":48.8,\"lon\":2.3}}")
case "$r" in *error*) ok "wrong token is refused";; *) bad "wrong token accepted: $r";; esac
r=$(post "{\"action\":\"options\",\"id\":\"$id\",\"adminKey\":\"wrong\",\"options\":{}}")
case "$r" in *error*) ok "non-organizer cannot change settings";; *) bad "settings changed without organizer key: $r";; esac
r=$(post "{\"action\":\"join\",\"id\":\"$id\",\"p\":{\"name\":\"Far\",\"lat\":43,\"lon\":5}}")
case "$r" in *error*) ok "position outside Île-de-France refused";; *) bad "far position accepted: $r";; esac
echo "[security]"
body=$(curl -s --max-time 20 "$BASE/data/events/$id.php")
case "$body" in *people*|*adminHash*|*'"lat"'*) bad "event file is readable over the web: $BASE/data/events/$id.php (see docs/DEPLOY.md)";; *) ok "event file is not readable over the web";; esac
for f in "$id.json" ".htaccess"; do
  s=$(code "$BASE/data/events/$f"); [ "$s" = 200 ] && [ "$f" = "$id.json" ] && bad "data/events/$f is served" || true
done
r=$(post "{\"action\":\"delete\",\"id\":\"$id\",\"adminKey\":\"$ak\"}")
case "$r" in *'"ok":true'*) ok "organizer deletes the event";; *) bad "delete: $r";; esac
[ "$(code "$BASE/api/meetup.php?id=$id")" = 404 ] && ok "deleted event is gone" || bad "event still readable after delete"


[ $fail = 0 ] && echo "ALL PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
