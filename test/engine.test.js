// The engine (assets/engine-core.js) must give exactly what calling the solver directly gives.
const assert = require("assert"), fs = require("fs"), path = require("path");
const MP = require("../assets/solver.js");
globalThis.MP = MP;                                   // in the browser and in the worker MP is a global; engine-core reads it from there
const { createCore } = require("../assets/engine-core.js");
const data = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "../data", n + ".json"), "utf8"));
(async () => {
  const core = createCore(async (n) => data(n));
  const g = data("graph"), find = (n) => g.stations.findIndex((s) => s[1] === n);
  const T = { walk: true, transit: true, bike: false, car: false };
  const at = (n, extra) => Object.assign({ name: n, lat: g.stations[find(n)][2], lon: g.stations[find(n)][3], modes: T, weight: 1, ret: null }, extra);
  const people = [at("La Défense"), at("Gare de Lyon", { ret: { lat: g.stations[find("Massy - Palaiseau")][2], lon: g.stations[find("Massy - Palaiseau")][3] } }), at("Saint-Denis")];
  const opts = { objective: "sum", maxMinutes: 0, top: 3 };
  for (const buses of [false, true]) {
    const o = { profile: 0, buses };
    const direct = MP.solve(new MP.Network(buses ? MP.mergeGraph(g, data("graph-bus")) : g, 0), people, opts);
    const r = await core.solve(1, o, people, opts);
    assert.deepStrictEqual(r.top, direct.top, `top results are identical (buses ${buses})`);
    const c = r.top[0].c, iti = core.itineraries(1, c);
    assert.strictEqual(iti.out.length, 3); assert(iti.back && iti.back.length === 3, "a way-back address gives return legs");
    const net = new MP.Network(buses ? MP.mergeGraph(g, data("graph-bus")) : g, 0);
    iti.out.forEach((legs, i) => assert(Math.abs(legs.reduce((s, l) => s + (l.wait || 0) + l.sec, 0) - direct.per[i].sec[c]) < 1, "out legs add up"));
    iti.back.forEach((legs, i) => assert(Math.abs(legs.reduce((s, l) => s + (l.wait || 0) + l.sec, 0) - direct.back[i].sec[c]) < 1, "return legs add up"));
  }
  const noRet = await core.solve(2, { profile: 0, buses: false }, people.map((p) => Object.assign({}, p, { ret: null })), opts);
  assert.strictEqual(core.itineraries(2, noRet.top[0].c).back, null, "no way-back address, no return legs");
  for (let s = 3; s <= 6; s++) await core.solve(s, { profile: 0, buses: false }, people, opts);
  assert.throws(() => core.itineraries(1, 0), /stale/, "old solves are forgotten");
  console.log("engine ok");
})().catch((e) => { console.error(e); process.exit(1); });
