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
      <div class="grow"><h1>Meet Point</h1><p data-i18n="Find the fairest place to meet in Île-de-France">Find the fairest place to meet in Île-de-France</p></div>
      <div id="lang" class="langsw" role="group" data-i18n-aria="Language" aria-label="Language"><button type="button" data-lang="en">EN</button><button type="button" data-lang="fr">FR</button></div>
    </header>
    <div id="notice" class="msg" hidden></div>
    <div id="view"></div>
    <footer>
      <span data-i18n="Metro, RER, train and tram, plus buses when enabled. Times are estimates from average timetables, not live.">Metro, RER, train and tram, plus buses when enabled. Times are estimates from average timetables, not live.</span>
      <span data-i18n="Data: Île-de-France Mobilités, OpenStreetMap contributors (ODbL), adresse.data.gouv.fr.">Data: Île-de-France Mobilités, OpenStreetMap contributors (ODbL), adresse.data.gouv.fr.</span>
      <span><span data-i18n="The page updates itself when a new version is installed.">The page updates itself when a new version is installed.</span> <button id="hard-reload" class="link" data-i18n="Reload everything" data-i18n-title="Re-download every file of the app and its map data, then reload. Your events and organizer keys are kept." title="Re-download every file of the app and its map data, then reload. Your events and organizer keys are kept.">Reload everything</button> <span data-i18n="if something still looks broken.">if something still looks broken.</span></span>
    </footer>
  </aside>

  <main id="stage">
    <div id="map"></div>
    <canvas id="flow"></canvas>
    <div id="legend" class="float" hidden></div>
    <div id="player" class="float" hidden>
      <button id="play" class="btn primary" data-i18n-aria="Play or pause" aria-label="Play or pause">❚❚</button>
      <input id="seek" type="range" min="0" max="1000" value="0" data-i18n-aria="Time" aria-label="Time">
      <span id="clock">0 min</span>
      <select id="dir" class="select" data-i18n-aria="Direction" aria-label="Direction" hidden><option value="out" data-i18n="Going">Going</option><option value="back" data-i18n="Coming back">Coming back</option></select>
      <select id="speed" class="select" data-i18n-aria="Speed" aria-label="Speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select>
    </div>
  </main>
</div>
<script>window.MP_BUILD = "<?= $v ?>";</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script src="assets/i18n.js?v=<?= $v ?>"></script>
<script src="assets/solver.js?v=<?= $v ?>"></script>
<script src="assets/engine-core.js?v=<?= $v ?>"></script>
<script src="assets/engine.js?v=<?= $v ?>"></script>
<script src="assets/flow.js?v=<?= $v ?>"></script>
<script src="assets/basemap.js?v=<?= $v ?>"></script>
<script src="assets/api.js?v=<?= $v ?>"></script>
<script src="assets/app.js?v=<?= $v ?>"></script>
</body>
</html>
