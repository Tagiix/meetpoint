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
