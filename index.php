<?php
// The page is PHP only to stamp every asset URL with the build id: after an update the URLs differ, so a browser can never
// show old scripts or data from its cache, whatever the server's cache headers are. The open page also polls api/build.php.
require __DIR__ . '/api/_build.inc.php';
$v = build_id();
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meet Point</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<link rel="stylesheet" href="assets/style.css?v=<?= $v ?>">
</head>
<body>
<div id="app">
  <aside id="panel">
    <header class="brand">
      <div class="logo">◎</div>
      <div><h1>Meet Point</h1><p>Find the fairest place to meet in Île-de-France</p></div>
    </header>
    <div id="notice" class="msg" hidden></div>
    <div id="view"></div>
    <footer>
      <span>Metro, RER, train and tram, plus buses when enabled. Times are estimates from average timetables, not live.</span>
      <span>Data: Île-de-France Mobilités, OpenStreetMap contributors (ODbL), adresse.data.gouv.fr.</span>
      <span>The page updates itself when a new version is installed. <button id="hard-reload" class="link" title="Re-download every file of the app and its map data, then reload. Your events and organizer keys are kept.">Reload everything</button> if something still looks broken.</span>
    </footer>
  </aside>

  <main id="stage">
    <div id="map"></div>
    <canvas id="flow"></canvas>
    <div id="legend" class="float" hidden></div>
    <div id="player" class="float" hidden>
      <button id="play" class="btn primary" aria-label="Play or pause">❚❚</button>
      <input id="seek" type="range" min="0" max="1000" value="0" aria-label="Time">
      <span id="clock">0 min</span>
      <select id="dir" class="select" aria-label="Direction" hidden><option value="out">Going</option><option value="back">Coming back</option></select>
      <select id="speed" class="select" aria-label="Speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select>
    </div>
  </main>
</div>
<script>window.MP_BUILD = "<?= $v ?>";</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script src="assets/solver.js?v=<?= $v ?>"></script>
<script src="assets/flow.js?v=<?= $v ?>"></script>
<script src="assets/basemap.js?v=<?= $v ?>"></script>
<script src="assets/api.js?v=<?= $v ?>"></script>
<script src="assets/app.js?v=<?= $v ?>"></script>
</body>
</html>
