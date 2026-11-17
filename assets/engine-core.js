/* The solving engine, with no DOM: loads the transit graphs, builds the networks, solves, rebuilds itineraries.
   It runs inside a Web Worker (assets/solve-worker.js) so a 250 ms solve never freezes the page, or on the page's own thread as a
   fallback (assets/engine.js), or in node (tests). Depends on assets/solver.js (MP).
   loadJson(name) -> Promise of data/<name>.json. */
(function (root) {
  "use strict";
  function createCore(loadJson) {
    let base = null, bus = null;
    const nets = {}, kept = new Map();                 // networks by profile+buses; the last few solves, by sequence number, for itineraries
    async function network(o) {
      const key = o.profile + (o.buses ? "b" : "r");
      if (nets[key]) return nets[key];
      base = base || await loadJson("graph");
      let g = base;
      if (o.buses) { bus = bus || await loadJson("graph-bus"); g = root.MP.mergeGraph(base, bus); }
      return (nets[key] = new root.MP.Network(g, o.profile));
    }
    return {
      /* people: [{lat, lon, modes, weight, ret}], opts: {objective, maxMinutes, top}. Returns {top, relaxed}: the heavy per-station table stays here. */
      async solve(seq, o, people, opts) {
        const net = await network(o), res = root.MP.solve(net, people, opts);
        kept.set(seq, { net, res });
        for (const k of kept.keys()) if (k <= seq - 3) kept.delete(k);
        return { top: res.top, relaxed: res.relaxed };
      },
      /* legs for every person to station c, for the solve numbered seq: {out: [legs per person], back: [legs per person] | null} */
      itineraries(seq, c) {
        const k = kept.get(seq); if (!k) throw new Error("stale");
        const { net, res } = k, out = res.per.map((r) => root.MP.itinerary(net, r, c));
        const anyBack = res.back.some((b, i) => b !== res.per[i]);
        return { out, back: anyBack ? res.back.map((b) => root.MP.reverseLegs(root.MP.itinerary(net, b, c))) : null };
      },
      warm(o) { return network(o).then(() => true); },
    };
  }
  const api = { createCore };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MPEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
