<?php
// Event store: one organizer creates an event, everybody adds their own position.
// One file per event in data/events/. Secrets are stored hashed.
// Files are named <id>.php and start with a line that makes PHP stop immediately, so requesting one
// over the web returns an empty 404 on ANY web server (nginx, Apache, php -S), without needing a deny rule.
//
//   GET  meetup.php                          -> {"ok":true} when the store is writable (health check)
//   GET  meetup.php?id=ID[&rev=N]             -> event (or {"unchanged":true} if rev matches)
//   POST {action:"create", title, options}   -> {id, adminKey}
//   POST {action:"join",   id, p}            -> {pid, token}
//   POST {action:"update", id, pid, token, p}  (adminKey instead of token also works: the organizer edits anyone)
//   POST {action:"leave",  id, pid, token}     (same)
//   p = {name, addr, lat, lon, modes, weight, ret: {addr, lat, lon} | null}   ret = where they go back to
//   POST {action:"options", id, adminKey, title?, options}
//   POST {action:"delete", id, adminKey}
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const MAX_PEOPLE = 10, MAX_EVENTS = 500, KEEP_DAYS = 90;
const GUARD = "<?php http_response_code(404); exit; ?>\n";
$dir = __DIR__ . '/../data/events';
if (!is_dir($dir)) { mkdir($dir, 0755, true); }

function out($data, $code = 200) { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }
function fail($code, $msg) { out(['error' => $msg], $code); }
function valid_id($id) { return is_string($id) && preg_match('/^[a-z0-9]{8}$/', $id) === 1; }
function secret() { return bin2hex(random_bytes(8)); }
function h($s) { return hash('sha256', (string)$s); }
function path_of($id) { global $dir; return "$dir/$id.php"; }
function unguard($raw) { return strncmp($raw, GUARD, strlen(GUARD)) === 0 ? substr($raw, strlen(GUARD)) : $raw; }
function read_event($id) { return json_decode(unguard((string)file_get_contents(path_of($id))), true); }

function clean_pos($p) {
    if (!is_array($p) || !isset($p['lat'], $p['lon']) || !is_numeric($p['lat']) || !is_numeric($p['lon'])) { fail(400, 'bad position'); }
    $lat = (float)$p['lat']; $lon = (float)$p['lon'];
    if ($lat < 47.9 || $lat > 49.5 || $lon < 1.2 || $lon > 3.9) { fail(400, 'position outside Île-de-France'); }
    return ['addr' => mb_substr((string)($p['addr'] ?? ''), 0, 120), 'lat' => $lat, 'lon' => $lon];
}
// A person has a start position and, optionally, a different position for the way back ('ret', null = same place).
function clean_person($p) {
    $pos = clean_pos($p);
    $m = isset($p['modes']) && is_array($p['modes']) ? $p['modes'] : [];
    return $pos + [
        'name' => trim(mb_substr((string)($p['name'] ?? ''), 0, 40)) ?: 'Guest',
        'ret' => isset($p['ret']) && is_array($p['ret']) ? clean_pos($p['ret']) : null,
        'weight' => max(1, min(3, (int)($p['weight'] ?? 1))),
        'modes' => ['walk' => !empty($m['walk']), 'transit' => !empty($m['transit']), 'bike' => !empty($m['bike']), 'car' => !empty($m['car'])],
    ];
}
// What may be a meeting point: station, r (restaurant), c (café), b (bar), park, culture, sights. At least one; old events used where = stations | places.
function clean_meet($o) {
    $kinds = ['station', 'r', 'c', 'b', 'park', 'culture', 'sights'];
    if (isset($o['meet']) && is_array($o['meet'])) { $m = array_values(array_intersect($kinds, $o['meet'])); return $m ?: ['station']; }
    return ($o['where'] ?? '') === 'places' ? ['r', 'c', 'b', 'park'] : ['station'];
}
function clean_options($o) {
    $o = is_array($o) ? $o : [];
    return [
        'objective' => in_array($o['objective'] ?? '', ['max', 'sum', 'balanced'], true) ? $o['objective'] : 'max',
        'profile' => (int)($o['profile'] ?? 0) === 1 ? 1 : 0,
        'meet' => clean_meet($o),
        'maxmin' => max(0, min(180, (int)($o['maxmin'] ?? 0))),
        'buses' => !empty($o['buses']),
    ];
}
function public_view($e) {
    $e['people'] = array_map(function ($p) { unset($p['hash']); return $p; }, $e['people']);
    unset($e['adminHash']);
    return $e;
}

/* read-modify-write under an exclusive lock; $fn gets the event array and returns the response */
function with_event($id, $fn) {
    if (!valid_id($id) || !is_file(path_of($id))) { fail(404, 'event not found'); }
    $f = fopen(path_of($id), 'c+');
    flock($f, LOCK_EX);
    $e = json_decode(unguard((string)stream_get_contents($f)), true);
    if (!is_array($e)) { flock($f, LOCK_UN); fclose($f); fail(500, 'corrupt event'); }
    $res = $fn($e);                                   // may call fail()/out() itself
    $e['rev'] = ($e['rev'] ?? 0) + 1; $e['updated'] = time();
    ftruncate($f, 0); rewind($f); fwrite($f, GUARD . json_encode($e, JSON_UNESCAPED_UNICODE)); fflush($f);
    flock($f, LOCK_UN); fclose($f);
    out($res);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $id = $_GET['id'] ?? '';
    if ($id === '') { out(['ok' => is_writable($dir)]); }      // no query string at all: blockers match "ping" URLs
    if (!valid_id($id) || !is_file(path_of($id))) { fail(404, 'event not found'); }
    $e = read_event($id);
    if (isset($_GET['rev']) && (int)$_GET['rev'] === ($e['rev'] ?? 0)) { out(['unchanged' => true]); }
    out(public_view($e));
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { fail(405, 'method'); }

$raw = file_get_contents('php://input', false, null, 0, 20001);
if ($raw === false || strlen($raw) > 20000) { fail(413, 'too large'); }
$in = json_decode($raw, true);
if (!is_array($in)) { fail(400, 'bad json'); }
$action = $in['action'] ?? '';
$id = $in['id'] ?? '';

if ($action === 'create') {
    $files = glob("$dir/*.php") ?: [];
    foreach ($files as $old) { if (time() - filemtime($old) > KEEP_DAYS * 86400) { @unlink($old); } }
    if (count($files) >= MAX_EVENTS) { fail(429, 'too many events on this server'); }
    do { $id = substr(bin2hex(random_bytes(6)), 0, 8); } while (is_file(path_of($id)));
    $admin = secret();
    $e = ['id' => $id, 'title' => trim(mb_substr((string)($in['title'] ?? ''), 0, 80)) ?: 'Meet-up',
          'options' => clean_options($in['options'] ?? []), 'people' => [], 'adminHash' => h($admin),
          'created' => time(), 'updated' => time(), 'rev' => 1];
    file_put_contents(path_of($id), GUARD . json_encode($e, JSON_UNESCAPED_UNICODE), LOCK_EX);
    out(['id' => $id, 'adminKey' => $admin]);
}

$is_admin = fn($e) => isset($in['adminKey']) && hash_equals($e['adminHash'], h($in['adminKey']));

switch ($action) {
    case 'join':
        with_event($id, function (&$e) use ($in) {
            if (count($e['people']) >= MAX_PEOPLE) { fail(409, 'this event is full'); }
            $p = clean_person($in['p'] ?? null);
            $pid = substr(bin2hex(random_bytes(4)), 0, 6); $tok = secret();
            $p['id'] = $pid; $p['hash'] = h($tok); $e['people'][] = $p;
            return ['pid' => $pid, 'token' => $tok];
        });
    case 'update':
    case 'leave':
        with_event($id, function (&$e) use ($in, $action, $is_admin) {
            foreach ($e['people'] as $i => $q) {
                if ($q['id'] !== ($in['pid'] ?? '')) { continue; }
                $ok = (isset($in['token']) && hash_equals($q['hash'], h($in['token']))) || $is_admin($e);   // the organizer may edit or remove anyone
                if (!$ok) { fail(403, 'not your entry'); }
                if ($action === 'leave') { array_splice($e['people'], $i, 1); return ['ok' => true]; }
                $p = clean_person($in['p'] ?? null); $p['id'] = $q['id']; $p['hash'] = $q['hash'];
                $e['people'][$i] = $p; return ['ok' => true];
            }
            fail(404, 'person not found');
        });
    case 'options':
        with_event($id, function (&$e) use ($in, $is_admin) {
            if (!$is_admin($e)) { fail(403, 'organizer only'); }
            if (isset($in['title'])) { $e['title'] = trim(mb_substr((string)$in['title'], 0, 80)) ?: $e['title']; }
            $e['options'] = clean_options($in['options'] ?? []);
            return ['ok' => true];
        });
    case 'delete':
        if (!valid_id($id) || !is_file(path_of($id))) { fail(404, 'event not found'); }
        $e = read_event($id);
        if (!$is_admin($e)) { fail(403, 'organizer only'); }
        unlink(path_of($id)); out(['ok' => true]);
    default:
        fail(400, 'unknown action');
}
