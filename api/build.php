<?php
// {"build": "<id>"}: the open page asks this now and then and reloads itself when the id changed (see index.php and app.js).
require __DIR__ . '/_build.inc.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode(['build' => build_id()]);
