const assert = require("assert");
const fs = require("fs"), path = require("path");
const MP = require("../assets/solver.js");
const g = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/graph.json"), "utf8"));
const net = new MP.Network(g, 0);
const find = (n) => g.stations.findIndex(s => s[1] === n);
const T = { walk: false, transit: true, bike: false, car: false };
const at = (n) => ({ name: n, lat: g.stations[find(n)][2], lon: g.stations[find(n)][3], modes: T, weight: 1 });

// sanity: known rail trips (minutes, with wait) should be in a realistic range
const ldef = MP.personTimes(net, at("La Défense"));
const toStation = (n) => { const i = g.stations.findIndex(s => s[1] === n); return ldef.sec[i] / 60; };
for (const [n, lo, hi] of [["Gare de Lyon", 10, 40], ["Gare du Nord", 15, 40], ["Versailles Château Rive Gauche", 25, 60], ["Massy - Palaiseau", 25, 75]]) {
  const t = toStation(n);
  console.log(`La Défense -> ${n}: ${t.toFixed(1)} min`);
  if (isFinite(t)) assert(t >= lo && t <= hi, `${n} out of range`);
}
// 2 people: meeting should be between them
const res = MP.solve(net, [at("La Défense"), at("Gare de Lyon")], { objective: "max" });
console.log(res.top.map(r => `${g.stations[r.c][1]} ${r.times.map(x => x.toFixed(0))}`));
assert(res.top.length > 0);
const it = MP.itinerary(net, res.per[0], res.top[0].c);
console.log(it.map(l => `${l.mode}${l.label !== l.mode ? " " + l.label : ""} ${Math.round(l.sec / 60)}m`).join(" > "));
// 10 people performance
const names = ["La Défense", "Gare de Lyon", "Gare du Nord", "Saint-Lazare", "Nation", "Bastille", "Massy - Palaiseau", "Saint-Denis", "Créteil - Préfecture", "Versailles Château Rive Gauche"];
const ppl = names.map(n => find(n) >= 0 ? at(n) : null).filter(Boolean);
console.time("solve " + ppl.length); MP.solve(net, ppl, { objective: "sum" }); console.timeEnd("solve " + ppl.length);
console.log("ok");

// ---- bus add-on ----
const bus = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/graph-bus.json"), "utf8"));
const gb = MP.mergeGraph(g, bus), netb = new MP.Network(gb, 0);
assert.strictEqual(netb.R, g.stations.length);
// somebody in a rail-less area (Fontenay-en-Parisis-ish) should only be reachable by transit with buses
const remote = { name: "R", lat: 49.0, lon: 2.55, modes: { walk: false, transit: true, bike: false, car: false }, weight: 1 };
const city = at("Gare du Nord");
const r1 = MP.solve(net, [remote, city], { objective: "max" }), r2 = MP.solve(netb, [remote, city], { objective: "max" });
console.log("without buses:", r1.top.length ? r1.top[0].max.toFixed(0) + " min" : "unreachable", "| with buses:", r2.top.length ? r2.top[0].max.toFixed(0) + " min" : "unreachable");
console.time("solve 10 + buses"); MP.solve(netb, ppl, { objective: "sum" }); console.timeEnd("solve 10 + buses");
const it2 = MP.itinerary(netb, r2.per[0], r2.top[0].c);
console.log(it2.map(l => `${l.mode}${l.label !== l.mode ? " " + l.label : ""} ${Math.round(l.sec / 60)}m${l.wait ? "(+" + Math.round(l.wait / 60) + " wait)" : ""}`).join(" > "));
const total = it2.reduce((s, l) => s + (l.wait || 0) + l.sec, 0);
assert(Math.abs(total - r2.per[0].sec[r2.top[0].c]) < 1, "legs add up to the solver time");
console.log("bus ok");

// ---- scoring is checkable by hand ----
const pair = [at("La Défense"), at("Gare de Lyon"), at("Massy - Palaiseau")];
for (const obj of ["max", "sum", "balanced"]) {
  const r = MP.solve(net, pair, { objective: obj, top: 5 });
  const best = r.rows.reduce((m, x) => (x.score < m.score ? x : m));
  assert.strictEqual(r.top[0].score, best.score, obj + ": top[0] has the lowest score over all stations");
}
const rr = MP.solve(net, pair, { objective: "balanced", top: 1 }).top[0];
assert(Math.abs(rr.score - Math.sqrt(rr.times.concat(rr.back).reduce((s, x) => s + x * x, 0) / 6)) < 1e-9, "balanced is the root-mean-square");
const two = [at("La Défense"), at("Gare de Lyon")];
const mx = MP.solve(net, two, { objective: "max", top: 1 }).top[0], bl = MP.solve(net, two, { objective: "balanced", top: 1 }).top[0];
assert(mx.max <= bl.max + 1e-9 && bl.sum <= mx.sum + 1e-9, "balanced trades some fairness for total time");

// ---- way back to a different address ----
const same = MP.solve(net, two, { objective: "max", top: 1 }).top[0];
const sameRet = MP.solve(net, two.map(p => Object.assign({}, p, { ret: { lat: p.lat, lon: p.lon } })), { objective: "max", top: 1 }).top[0];
assert.strictEqual(same.c, sameRet.c); assert(Math.abs(same.max - sameRet.max) < 1e-9, "same return address changes nothing");
const far = Object.assign({}, two[0], { ret: { lat: g.stations[find("Massy - Palaiseau")][2], lon: g.stations[find("Massy - Palaiseau")][3] } });
const rf = MP.solve(net, [far, two[1]], { objective: "max", top: 1 });
const t0 = rf.top[0];
assert(t0.max >= Math.max(...t0.times, ...t0.back) - 1e-9 && Math.abs(t0.max - Math.max(...t0.times, ...t0.back)) < 1e-9, "max covers both directions");
assert(rf.rows.every(r => r.max >= t0.max - 1e-9), "no station beats the best on the longest of going and coming back");
const back = MP.reverseLegs(MP.itinerary(net, rf.back[0], t0.c));
const tot = back.reduce((s, l) => s + (l.wait || 0) + l.sec, 0);
assert(Math.abs(tot - rf.back[0].sec[t0.c]) < 1, "return legs add up");
console.log("scoring and way-back ok");

// ---- the minimizers really minimize: independent brute force over every station ----
// Recomputes each station's score from raw per-person times (never through solve()) for random groups,
// mixed modes, weights and way-back addresses, and demands the solver's best equals the true minimum.
{
  let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pt = () => { const s = g.stations[Math.floor(rnd() * net.R)]; return [s[2] + (rnd() - .5) * .01, s[3] + (rnd() - .5) * .012]; };
  const MODES = [{ walk: true, transit: true }, { walk: true, transit: true, bike: true }, { walk: true, transit: true, car: true }, { transit: true }, { walk: true }, { car: true }];
  const score = {
    sum: (t, w) => t.reduce((s, x, i) => s + x * w[i], 0) / w.reduce((a, b) => a + b, 0),
    max: (t) => Math.max(...t),
    balanced: (t, w) => Math.sqrt(t.reduce((s, x, i) => s + x * x * w[i], 0) / w.reduce((a, b) => a + b, 0)),
  };
  let checked = 0;
  for (let it = 0; it < 120; it++) {
    const k = 2 + Math.floor(rnd() * 4), ppl = [];
    for (let i = 0; i < k; i++) {
      const [la, lo] = pt(), r = pt();
      ppl.push({ lat: la, lon: lo, weight: 1 + Math.floor(rnd() * 3), modes: Object.assign({ walk: false, transit: false, bike: false, car: false }, MODES[Math.floor(rnd() * MODES.length)]), ret: rnd() < .3 ? { lat: r[0], lon: r[1] } : null });
    }
    const A = ppl.map(p => MP.personTimes(net, p)), B = ppl.map((p, i) => p.ret ? MP.personTimes(net, Object.assign({}, p, p.ret)) : A[i]);
    const w = ppl.map(p => p.weight).concat(ppl.map(p => p.weight));
    for (const obj of ["sum", "max", "balanced"]) {
      const r = MP.solve(net, ppl, { objective: obj, top: 1 });
      let best = Infinity;
      for (let c = 0; c < net.R; c++) {
        const t = A.map(x => x.sec[c] / 60).concat(B.map(x => x.sec[c] / 60));
        if (t.some(x => !isFinite(x))) continue;
        best = Math.min(best, score[obj](t, w));
      }
      if (!r.top.length) { assert.strictEqual(best, Infinity); continue; }
      checked++;
      // max adds a tiny tie-break, so compare on the real score of the chosen station
      const tc = A.map(x => x.sec[r.top[0].c] / 60).concat(B.map(x => x.sec[r.top[0].c] / 60));
      assert(Math.abs(score[obj](tc, w) - best) < (obj === "max" ? 1e-3 : 1e-9), `${obj} is not minimal: ${score[obj](tc, w)} vs ${best}`);
    }
  }
  console.log("brute-force minimality ok:", checked, "checks");
}

// ---- meeting at places other than stations ----
{
  const pois = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/pois.json"), "utf8"));
  let seed = 17; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const places = [];
  for (const kind of ["r", "c", "b"]) for (const p of pois[kind]) if (p[2] && rnd() < 0.08) places.push({ name: p[2], lat: p[0], lon: p[1], kind });
  const pt = () => { const s = g.stations[Math.floor(rnd() * net.R)]; return [s[2] + (rnd() - .5) * .01, s[3] + (rnd() - .5) * .012]; };
  const MODES = [{ walk: true, transit: true }, { transit: true }, { walk: true, transit: true, bike: true }, { car: true }, { walk: true }, { bike: true, transit: true }];
  let checked = 0;
  for (let it = 0; it < 25; it++) {
    const k = 2 + Math.floor(rnd() * 3), ppl = [];
    for (let i = 0; i < k; i++) { const [la, lo] = pt(), r = pt(); ppl.push({ lat: la, lon: lo, weight: 1 + Math.floor(rnd() * 3), modes: Object.assign({ walk: false, transit: false, bike: false, car: false }, MODES[Math.floor(rnd() * MODES.length)]), ret: rnd() < .3 ? { lat: r[0], lon: r[1] } : null }); }
    for (const obj of ["max", "sum", "balanced"]) {
      const res = MP.solve(net, ppl, { objective: obj, top: 3, places }), score = { sum: MP.AGG.sum, max: (t) => Math.max(...t), balanced: MP.AGG.balanced }[obj];
      // independent time of one person to one place: direct trip, or arrive at ANY stop within the walking limit (all stops looped, no grid) and walk
      const time = (r, x) => {
        let best = Infinity;
        for (const m of r.direct) best = Math.min(best, MP.directSeconds(m, [r.person.lat, r.person.lon], [x.lat, x.lon]));
        if (r.tr) g.stations.forEach((s, i) => { const d = MP.hav([x.lat, x.lon], [s[2], s[3]]); if (d <= 900 && r.tr.dist[i] < Infinity) best = Math.min(best, r.tr.dist[i] + d * 1.3 / 1.25); });
        return best / 60;
      };
      const w = ppl.map(p => p.weight), ww = w.concat(w);
      let best = Infinity;
      places.forEach((x) => { const t = res.per.map(r => time(r, x)).concat(res.back.map(r => time(r, x))); if (t.every(isFinite)) best = Math.min(best, score(t, ww)); });
      if (!res.top.length) { assert.strictEqual(best, Infinity); continue; }
      checked++;
      const x = places[res.top[0].c], t = res.per.map(r => time(r, x)).concat(res.back.map(r => time(r, x)));
      assert(Math.abs(score(t, ww) - best) < (obj === "max" ? 1e-3 : 1e-9), `${obj}: best place is not minimal`);
      // the legs rebuilt for the winner add up to the time, including the final walk
      res.per.forEach((r, i) => { const legs = MP.itineraryPlace(net, r, res.cands, res.top[0].c); assert(Math.abs(legs.reduce((s, l) => s + (l.wait || 0) + l.sec, 0) / 60 - res.top[0].times[i]) < 0.02, "place legs add up"); });
      // kept results are at least 500 m apart
      res.top.forEach((a, i) => res.top.slice(i + 1).forEach(b => assert(MP.hav([a.place.lat, a.place.lon], [b.place.lat, b.place.lon]) >= 500, "places spaced out")));
    }
  }
  // a car driver goes straight to the place: no stop involved
  const drv = [{ lat: 48.85, lon: 2.30, weight: 1, modes: { car: true, walk: false, transit: false, bike: false }, ret: null }, { lat: 48.88, lon: 2.40, weight: 1, modes: { car: true, walk: false, transit: false, bike: false }, ret: null }];
  const rd = MP.solve(net, drv, { objective: "max", top: 1, places });
  assert(MP.itineraryPlace(net, rd.per[0], rd.cands, rd.top[0].c).length === 1, "drivers get a single direct leg");
  console.log("any-place scoring ok:", checked, "checks over", places.length, "places");
}
