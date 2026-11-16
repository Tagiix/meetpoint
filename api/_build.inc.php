<?php
// Build id of the deployed app: a short hash of the names, sizes and modification times of everything the page loads.
// It changes whenever any of those files is updated, on any server, with no build step.
function build_id() {
    $root = dirname(__DIR__);
    $files = array_merge([$root . '/index.php'], glob($root . '/assets/*') ?: [], glob($root . '/data/*.json') ?: []);
    sort($files);
    $sig = '';
    foreach ($files as $f) { $sig .= basename($f) . ':' . filesize($f) . ':' . filemtime($f) . ';'; }
    return substr(md5($sig), 0, 10);
}
