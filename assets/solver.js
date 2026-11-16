/* Meeting-point solver: transit graph routing + multi-person scoring.
   Pure functions, no DOM: runs in the browser (window.MP) and in node (tests). */
(function (root) {
  "use strict";

  const PARIS = [48.8534, 2.3488];
  const SPEED = { walk: 1.25, bike: 4.2 };           // m/s
  const DETOUR = { walk: 1.3, bike: 1.25, car: 1.35 };
  const BIKE_FIXED = 180, CAR_FIXED = 480;            // lock-up / parking, seconds
  const MAX_WALK_ACCESS_M = 2200, MAX_BIKE_ACCESS_M = 6500;
  const MAX_WALK_BUS_M = 1200, MAX_BIKE_BUS_M = 3000;   // tighter access limits for bus stops

  function hav(a, b) {                                // metres
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function carSpeed(a, b) {                           // m/s, rough Île-de-France model
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = hav(mid, PARIS);
    return (d < 6000 ? 16 : d < 15000 ? 26 : 38) / 3.6;
  }

  function directSeconds(mode, a, b) {
    const d = hav(a, b);
    if (mode === "walk") return d * DETOUR.walk / SPEED.walk;
    if (mode === "bike") return BIKE_FIXED + d * DETOUR.bike / SPEED.bike;
    if (mode === "car") return CAR_FIXED + d * DETOUR.car / carSpeed(a, b);
    return Infinity;
  }

  class MinHeap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
      if (n) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1; if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lk; v[i] = lv;
      }
      return top;
    }
  }

  /* Edge kinds: 0 board, 1 alight, 2 ride, 3 walk */
  class Network {
    constructor(graph, profile) {
      this.graph = graph; this.profile = profile || 0;
      const S = graph.stations.length, L = graph.lnodes.length;
      this.S = S; this.N = S + L;
      this.R = graph.railCount || S;                   // stations [0,R) are rail = meeting candidates
      this.adj = Array.from({ length: this.N }, () => []);
      graph.lnodes.forEach((ln, k) => {
        const w = ln[3 + this.profile];
        if (w >= 0) this.adj[ln[0]].push([S + k, w, 0]);
        this.adj[S + k].push([ln[0], 0, 1]);
      });
      for (const [a, b, s] of graph.rides) this.adj[S + a].push([S + b, s, 2]);
      for (const [a, b, s] of graph.walks) { this.adj[a].push([b, s, 3]); this.adj[b].push([a, s, 3]); }
    }

    /* init: Map stationIndex -> seconds. Returns {dist, prev, prevKind, origin}. */
    dijkstra(init) {
      const N = this.N, dist = new Float64Array(N).fill(Infinity);
      const prev = new Int32Array(N).fill(-1), prevKind = new Int8Array(N).fill(-1);
      const origin = new Int32Array(N).fill(-1);
      const h = new MinHeap();
      for (const [s, t] of init) { dist[s] = t; origin[s] = s; h.push(t, s); }
      const done = new Uint8Array(N);
      while (h.size) {
        const u = h.pop(); if (done[u]) continue; done[u] = 1;
        for (const [v, w, kind] of this.adj[u]) {
          const nd = dist[u] + w;
          if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevKind[v] = kind; origin[v] = origin[u]; h.push(nd, v); }
        }
      }
      return { dist, prev, prevKind, origin };
    }
  }

  /* person: {name, lat, lon, modes:{walk,transit,bike,car}, weight}
     Returns {sec: Float64Array(S), how: Int8Array(S) (0 none,1 walk,2 bike,3 car,4 transit), tr, accessMode: Map} */
  function personTimes(net, person) {
    const st = net.graph.stations, S = net.S, p = [person.lat, person.lon];
    const m = person.modes;
    const sec = new Float64Array(S).fill(Infinity), how = new Int8Array(S);
    const HOW = { walk: 1, bike: 2, car: 3 };
    const direct = ["walk", "bike", "car"].filter(x => m[x]);
    if (!direct.length && !m.transit) direct.push("walk");  // nothing ticked: fall back to walking
    for (let i = 0; i < net.R; i++) {
      const q = [st[i][2], st[i][3]];
      for (const mode of direct) {
        const t = directSeconds(mode, p, q);
        if (t < sec[i]) { sec[i] = t; how[i] = HOW[mode]; }
      }
    }
    let tr = null; const access = new Map();           // station -> {sec, mode}
    if (m.transit) {
      for (let i = 0; i < S; i++) {
        const q = [st[i][2], st[i][3]], d = hav(p, q), bus = i >= net.R;
        let best = null;
        if (d <= (bus ? MAX_WALK_BUS_M : MAX_WALK_ACCESS_M)) best = { sec: d * DETOUR.walk / SPEED.walk, mode: "walk" };
        if (m.bike && d <= (bus ? MAX_BIKE_BUS_M : MAX_BIKE_ACCESS_M)) {
          const t = directSeconds("bike", p, q);
          if (!best || t < best.sec) best = { sec: t, mode: "bike" };
        }
        if (best) access.set(i, best);
      }
      const init = new Map([...access].map(([i, a]) => [i, a.sec]));
      tr = net.dijkstra(init);
      for (let i = 0; i < net.R; i++) if (tr.dist[i] < sec[i]) { sec[i] = tr.dist[i]; how[i] = 4; }
    }
    return { sec, how, tr, access, person };
  }

  /* Scores over the list of trip times t (minutes, one entry per person and direction) with weights w.
     Lower is better. All three are generalized means, so they can be checked by hand:
       sum      weighted mean (L1)         fastest for the group in total
       balanced root-mean-square (L2)      between the two: long trips cost more than short ones
       max      longest trip (L-infinity)  fairest; the mean is a tiny tie-break among equal longest trips */
  const AGG = {
    sum: (t, w) => t.reduce((s, x, i) => s + x * w[i], 0) / w.reduce((a, b) => a + b, 0),
    max: (t) => Math.max(...t) + 1e-4 * t.reduce((a, b) => a + b, 0) / t.length,
    balanced: (t, w) => Math.sqrt(t.reduce((s, x, i) => s + x * x * w[i], 0) / w.reduce((a, b) => a + b, 0)),
  };

  /* A person may come back to a different place: person.ret = {lat, lon} (absent = same as the start).
     Both directions count as separate trips in every score, so a person who returns to the same
     address simply counts twice (max and balanced are unchanged, sum is doubled for everybody alike).
     The way back is timed as the way there from that address (the network is symmetric enough).
     opts: {objective, maxMinutes, top} */
  function solve(net, people, opts) {
    opts = Object.assign({ objective: "max", maxMinutes: 0, top: 3 }, opts);
    const per = people.map(p => personTimes(net, p));
    const back = people.map((p, i) => p.ret ? personTimes(net, Object.assign({}, p, { lat: p.ret.lat, lon: p.ret.lon })) : per[i]);
    const w = people.map(p => p.weight || 1), ww = w.concat(w), st = net.graph.stations;
    const rows = [];
    for (let c = 0; c < net.R; c++) {
      const out = per.map(r => r.sec[c] / 60), ret = back.map(r => r.sec[c] / 60), t = out.concat(ret);
      if (t.some(x => !isFinite(x))) continue;
      const max = Math.max(...t);
      rows.push({ c, hub: st[c][4], score: AGG[opts.objective](t, ww), times: out, back: ret, sum: t.reduce((a, b) => a + b, 0), max, over: opts.maxMinutes > 0 && max > opts.maxMinutes });
    }
    let pool = rows.filter(r => !r.over), relaxed = false;
    if (!pool.length) { pool = rows; relaxed = true; }
    pool.sort((a, b) => a.score - b.score);
    const seen = new Set(), top = [];
    for (const r of pool) { if (seen.has(r.hub)) continue; seen.add(r.hub); top.push(r); if (top.length >= opts.top) break; }
    return { top, relaxed, per, back, rows };
  }

  /* Itinerary for one person to station c: list of legs
     {mode, label, color, coords:[[lat,lon]..], sec, wait?} */
  function itinerary(net, res, c) {
    const st = net.graph.stations, g = net.graph, S = net.S, p = res.person;
    const here = [p.lat, p.lon], there = [st[c][2], st[c][3]];
    const NAME = { 1: "walk", 2: "bike", 3: "car" };
    if (res.how[c] !== 4) {
      return [{ mode: NAME[res.how[c]], label: NAME[res.how[c]], color: null, coords: [here, there], sec: res.sec[c] }];
    }
    const tr = res.tr, chain = [];
    for (let u = c; u !== -1; u = tr.prev[u]) chain.push(u);
    chain.reverse();                                   // node path, first is an access station
    const legs = [], first = chain[0], acc = res.access.get(first);
    legs.push({ mode: acc.mode, label: acc.mode, color: null, coords: [here, [st[first][2], st[first][3]]], sec: acc.sec });
    let i = 1;
    const sc = (n) => [st[n][2], st[n][3]];
    while (i < chain.length) {
      const u = chain[i - 1], v = chain[i], kind = tr.prevKind[v];
      if (kind === 3) {
        legs.push({ mode: "walk", label: "correspondance", color: null, coords: [sc(u), sc(v)], sec: tr.dist[v] - tr.dist[u] });
        i++;
      } else if (kind === 0) {
        const ln = g.lnodes[v - S], line = g.lines[ln[1]];
        const coords = [sc(ln[0])]; let j = i + 1, t0 = tr.dist[u], tEnd = tr.dist[v];
        const wait = tr.dist[v] - tr.dist[u];
        while (j < chain.length && tr.prevKind[chain[j]] === 2) { coords.push(sc(g.lnodes[chain[j] - S][0])); tEnd = tr.dist[chain[j]]; j++; }
        legs.push({ mode: line[2] === 1 ? "metro" : line[2] === 0 ? "tram" : line[2] === 3 ? "bus" : "train", label: line[0], color: line[1], coords, sec: tEnd - t0 - wait, wait });
        i = j;
      } else i++;                                      // alight: zero cost, no leg
    }
    return legs;
  }

  /* The same itinerary read the other way: from the meeting point to where the person is going. */
  function reverseLegs(legs) {
    return legs.slice().reverse().map(l => Object.assign({}, l, { coords: l.coords.slice().reverse() }));
  }

  /* Append the optional bus add-on (data/graph-bus.json) to the rail graph. */
  function mergeGraph(base, bus) {
    if (bus.baseStations !== base.stations.length || bus.baseLines !== base.lines.length || bus.baseLnodes !== base.lnodes.length)
      throw new Error("graph-bus.json was built for a different graph.json: rebuild it");
    return Object.assign({}, base, {
      railCount: base.stations.length,
      stations: base.stations.concat(bus.stations), lines: base.lines.concat(bus.lines),
      lnodes: base.lnodes.concat(bus.lnodes), rides: base.rides.concat(bus.rides), walks: base.walks.concat(bus.walks),
    });
  }

  const api = { mergeGraph, Network, hav, directSeconds, personTimes, solve, itinerary, reverseLegs, AGG };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MP = api;
})(typeof window !== "undefined" ? window : globalThis);
