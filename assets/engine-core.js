/* The solving engine, with no DOM: loads the transit graphs, builds the networks, solves, rebuilds itineraries.
   It runs inside a Web Worker (assets/solve-worker.js) so a 250 ms solve never freezes the page, or on the page's own thread as a
   fallback (assets/engine.js), or in node (tests). Depends on assets/solver.js (MP).
   loadJson(name) -> Promise of data/<name>.json. */
(function (root) {
  "use strict";
  function createCore(loadJson) {
    let base = null, bus = null, placeList = null;
    const nets = {}, kept = new Map();                 // networks by profile+buses; the last few solves, by sequence number, for itineraries
    async function network(o) {
      const key = o.profile + (o.buses ? "b" : "r");
      if (nets[key]) return nets[key];
      base = base || await loadJson("graph");
      let g = base;
      if (o.buses) { bus = bus || await loadJson("graph-bus"); g = root.MP.mergeGraph(base, bus); }
      return (nets[key] = new root.MP.Network(g, o.profile));
    }
    /* candidate meeting places that are not stops: named restaurants, cafés, bars and parks (the same data the map draws) */
    async function places() {
      if (placeList) return placeList;
      const [pois, green] = await Promise.all([loadJson("pois"), loadJson("green")]);
      const list = [];
      for (const kind of ["r", "c", "b"]) for (const p of pois[kind] || []) if (p[2]) list.push({ name: p[2], lat: p[0], lon: p[1], kind });
      for (const g of green.names || []) list.push({ name: g[0], lat: g[1], lon: g[2], kind: "park" });
      return (placeList = list);
    }
    return {
      /* people: [{lat, lon, modes, weight, ret}], opts: {objective, maxMinutes, top, where: "stations" | "places"}.
         Returns {top, relaxed}: the heavy per-candidate table stays here. */
      async solve(seq, o, people, opts) {
        const net = await network(o), where = opts.where === "places";
        const res = root.MP.solve(net, people, Object.assign({}, opts, { places: where ? await places() : null }));
        kept.set(seq, { net, res });
        for (const k of kept.keys()) if (k <= seq - 3) kept.delete(k);
        return { top: res.top, relaxed: res.relaxed };
      },
      /* legs for every person to station c, for the solve numbered seq: {out: [legs per person], back: [legs per person] | null} */
      itineraries(seq, c) {
        const k = kept.get(seq); if (!k) throw new Error("stale");
        const { net, res } = k, legs = (r) => (res.cands ? root.MP.itineraryPlace(net, r, res.cands, c) : root.MP.itinerary(net, r, c));
        const anyBack = res.back.some((b, i) => b !== res.per[i]);
        return { out: res.per.map(legs), back: anyBack ? res.back.map((b) => root.MP.reverseLegs(legs(b))) : null };
      },
      warm(o) { return network(o).then(() => true); },
      warmPlaces() { return places().then(() => true); },
    };
  }
  const api = { createCore };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MPEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
