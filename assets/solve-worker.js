/* Web Worker: hosts the solving engine off the page's thread. Messages in: {id, type, ...}; out: {id, ok, result | error}.
   Loaded with ?v=<build id>, which it passes on to the scripts and data it fetches so nothing stale is ever used. */
"use strict";
const v = new URL(self.location.href).searchParams.get("v") || "";
importScripts("solver.js?v=" + v, "engine-core.js?v=" + v);
let core = null;
self.onmessage = async (e) => {
  const m = e.data;
  try {
    let result;
    if (m.type === "init") {
      core = MPEngine.createCore((name) => fetch(m.dataBase + name + ".json" + (v ? "?v=" + v : "")).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status + " for " + name); return r.json(); }));
      result = true;
    } else if (m.type === "solve") result = await core.solve(m.seq, m.o, m.people, m.opts);
    else if (m.type === "itineraries") result = core.itineraries(m.seq, m.c);
    else if (m.type === "warm") result = await core.warm(m.o);
    else throw new Error("unknown message " + m.type);
    self.postMessage({ id: m.id, ok: true, result });
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
};
