(function () {
  "use strict";
  const COLORS = ["#e8541e", "#2a7de1", "#2e9e5b", "#a24bd6", "#d9a400", "#e0457b", "#119da4", "#7a5c3e", "#4b5bd6", "#8a9a1f"];
  const MODES = [["walk", "Walk"], ["transit", "Transit"], ["bike", "Bike"], ["car", "Car"]];
  const OBJECTIVES = [
    ["max", "Fairest", "Nobody travels far: minimizes the longest trip (going or coming back)."],
    ["sum", "Fastest overall", "Least total travel time for the whole group."],
    ["balanced", "Balanced", "Minimizes the root-mean-square of the trip times: a compromise that punishes long trips."],
  ];
  const IDF = /^(75|77|78|91|92|93|94|95)/;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const DEFAULT_OPTS = { objective: "max", meet: ["station"], profile: 0, maxmin: 0, buses: false };
  // what may be a meeting point; several can be ticked together
  const MEET = [["station", "Stations"], ["r", "Restaurants"], ["c", "Cafés"], ["b", "Bars"], ["park", "Parks"], ["culture", "Culture"], ["sights", "Sights"]];
  const meetOf = (o) => (o.meet && o.meet.length ? o.meet : o.where === "places" ? ["r", "c", "b", "park"] : ["station"]);   // old events had where = stations | places
  const DEFAULT_MODES = { walk: true, transit: true, bike: false, car: false };

  /* ---------- state ---------- */
  const S = { voter: null, api: true, ev: null, admin: null, mine: {}, draftOpts: Object.assign({}, DEFAULT_OPTS), title: "", draft: blankDraft(), editing: null, picking: null };            // picking: which address field the next map click fills (see addrField)
  let graphBase = null, result = null, busWarm = false, selected = 0, token = 0, lastSig = "", pollTimer = null;
  let markers = [], draftMarkers = [], dirn = "out", curRoutes = null, targetMarker = null, solveTimer = null, optTimer = null, sugg = [], suggTimer = null;

  function blankDraft() { return { name: "", addr: "", lat: null, lon: null, modes: Object.assign({}, DEFAULT_MODES), retOn: false, ret: { addr: "", lat: null, lon: null } }; }

  /* ---------- local storage (per-browser secrets: organizer key and own entries) ---------- */
  function store() { try { const v = JSON.parse(localStorage.getItem("meetpoint:v2")); return v && typeof v === "object" && v.events && typeof v.events === "object" ? v : { events: {} }; } catch (e) { return { events: {} }; } }
  function putStore(s) { try { localStorage.setItem("meetpoint:v2", JSON.stringify(s)); } catch (e) {} }
  function storageOk() { try { localStorage.setItem("meetpoint:t", "1"); const ok = localStorage.getItem("meetpoint:t") === "1"; localStorage.removeItem("meetpoint:t"); return ok; } catch (e) { return false; } }
  function getLocal(id) { return store().events[id] || { title: "", admin: null, mine: {} }; }
  function setLocal(id, patch) { const s = store(); s.events[id] = Object.assign(getLocal(id), patch); putStore(s); }

  /* ---------- map ---------- */
  const map = L.map("map", { zoomControl: true, zoomSnap: 0.5, minZoom: 9, maxZoom: 17, maxBounds: [[47.8, 1.1], [49.7, 4.0]] }).setView([48.8566, 2.3522], 11);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution("Data © Île-de-France Mobilités, OpenStreetMap contributors");
  const base = new Basemap(map);
  window.__meetpointMap = map; window.__meetpointBase = base;                         // handy for debugging and screenshots
  const flow = new Flow(map, $("flow"), { onTick });
  map.on("click", (e) => {
    if (!S.picking) return;
    const ak = S.picking, st = snapStation(e.containerPoint); setPicking(null);
    if (st) setPos(ak, st[2], st[3], st[1] + " (station)"); else setPos(ak, e.latlng.lat, e.latlng.lng, "");
  });

  /* a click within 16 px of a metro/RER/train/tram station picks that station */
  function snapStation(pt) {
    if (!graphBase) return null;
    let best = null, bd = 16;
    for (let i = 0; i < (graphBase.railCount || graphBase.stations.length); i++) {
      const st = graphBase.stations[i], q = map.latLngToContainerPoint([st[2], st[3]]), d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }
  /* station search: rail stations, plus bus stops once the bus data is loaded */
  const plain = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’'‘`´-]+/g, " ").replace(/\s+/g, " ").trim();
  function stationMatches(q) {
    const n = plain(q), nsp = n.replace(/ /g, ""), out = [], seen = new Set();
    const R = graphBase ? (graphBase.railCount || graphBase.stations.length) : 0;
    const all = graphBase ? graphBase.stations.slice(0, R).map((st) => [st, "rail"]).concat(graphBus ? graphBus.stations.map((st) => [st, "bus"]) : []) : [];
    for (const [st, kind] of all) {
      const nm = plain(st[1]); if (!nm.includes(n) && !nm.replace(/ /g, "").includes(nsp)) continue;   // also "gare de lest" for "Gare de l'Est"
      const key = kind + nm + Math.round(st[2] * 200) + Math.round(st[3] * 200); if (seen.has(key)) continue; seen.add(key);
      out.push({ st, kind, rank: (nm.startsWith(n) ? 0 : 1) + (kind === "bus" ? 2 : 0) });
    }
    return out.sort((a, b) => a.rank - b.rank || a.st[1].length - b.st[1].length);
  }
  const MODE_W = { 0: 2.2, 1: 3.6, 2: 3.4, 3: 2 };
  const BUILD = window.MP_BUILD || "";                  // stamped into the page by index.php
  const dataUrl = (name) => `data/${name}.json` + (BUILD ? "?v=" + BUILD : "");   // new build = new URL = never an old cached file
  const getJson = (name) => fetch(dataUrl(name)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  /* Everything the map needs is fetched once, when the page opens. The first picture needs only the core files; the rest
     (secondary and tertiary roads, bus lines, the bus network for routing) arrives behind it without blocking anything. */
  const later = () => new Promise((r) => setTimeout(r, 0));
  async function addChunked(layer, flats, style) {       // build thousands of lines in slices so the page keeps responding
    for (let i = 0; i < flats.length; i += 1500) { base.addLines(layer, flats.slice(i, i + 1500), style); await later(); }
  }
  async function loadBasemap() {
    const [rail, roads, water, green, places, pois, culture] = await Promise.all(["rail-lines", "roads", "water", "green", "places", "pois", "culture"].map(getJson));
    if (culture) culturePlaces = ["culture", "sights"].flatMap((k) => (culture[k] || []).map((p) => ({ name: p[2], lat: p[0], lon: p[1], kind: k, sub: p[3] })));
    if (green) { base.addPolys("green", green.polys, {}); base.setParkNames(green.names || []); }
    if (pois) base.setPois(pois);
    if (water) { base.addPolys("water", water.areas || [], {}); base.addLines("water", water.rivers || [], {}); }
    if (roads) { base.addLines("roads", roads.secondary || [], { tier: 2 }); base.addLines("roads", roads.primary || [], { tier: 1 }); base.addLines("roads", roads.motorway || [], { tier: 0 }); }
    if (rail) for (const l of rail) base.addLines("rail", l.p, { color: l.c, w: MODE_W[l.m], mode: l.m });
    if (places) base.setPlaces(places);
    base.draw();
    const [detail, bus] = await Promise.all([getJson("roads-detail"), getJson("bus-lines")]);   // downloads run together, building one after the other
    if (detail) { await addChunked("roads", detail.secondary || [], { tier: 2 }); await addChunked("roads", detail.tertiary || [], { tier: 3 }); base.draw(); }
    if (bus) { for (const l of bus) base.addLines("bus", l.p, {}); await later(); base.draw(); }
    ensureBusGraph().catch(() => {});                    // for the station search
    engine.warmPlaces().catch(() => {});
    engine.warm({ profile: 0, buses: true }).then(() => (busWarm = true)).catch(() => {});    // the worker builds the bus network now, so turning buses on later is instant
  }
  let graphBus = null;
  async function ensureBusGraph() { return graphBus || (graphBus = await (await fetch(dataUrl("graph-bus"))).json()); }

  function renderLegend() {
    const el = $("legend"); el.hidden = false;
    el.innerHTML = `<div class="k"><span class="sw" style="background:linear-gradient(90deg,#ffbe00,#0055c8,#eb2132,#84653d)"></span>Metro, RER, train, tram</div>
      <label><input type="checkbox" id="lg-roads" ${base.show.roads ? "checked" : ""}> Roads</label>
      <label><input type="checkbox" id="lg-food" ${base.show.food ? "checked" : ""}> Restaurants <span class="dots"><i style="background:var(--poi-r)"></i><i style="background:var(--poi-c)"></i><i style="background:var(--poi-b)"></i></span></label>
      <label><input type="checkbox" id="lg-bus" ${base.show.bus ? "checked" : ""}> Bus lines</label>`;
    $("lg-food").onchange = (e) => { base.show.food = e.target.checked; base.draw(); };
    $("lg-roads").onchange = (e) => { base.show.roads = e.target.checked; base.draw(); };
    $("lg-bus").onchange = (e) => { base.show.bus = e.target.checked; base.draw(); };
  }

  /* what a result row points at: a station, or a place (café, restaurant, bar, park) */
  const KIND = { station: "Station", r: "Restaurant", c: "Café", b: "Bar", park: "Park", culture: "Culture", sights: "Sight" };
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  function nearestStation(lat, lon) {
    let best = null, bd = Infinity;
    for (let i = 0; i < (graphBase.railCount || graphBase.stations.length); i++) { const st = graphBase.stations[i], d = Math.hypot((st[2] - lat) * 111, (st[3] - lon) * 73); if (d < bd) { bd = d; best = st; } }
    return best;
  }
  function targetOf(r) {
    if (r.place && r.place.kind !== "station") { const near = nearestStation(r.place.lat, r.place.lon), what = r.place.sub ? cap(r.place.sub) : KIND[r.place.kind] || "Place"; return { name: r.place.name, lat: r.place.lat, lon: r.place.lon, sub: `${what}${near ? " · near " + near[1] : ""}` }; }
    if (r.place) return { name: r.place.name, lat: r.place.lat, lon: r.place.lon, sub: "" };
    const st = graphBase.stations[r.c]; return { name: st[1], lat: st[2], lon: st[3], sub: "" };
  }
  function targetPoint() { const t = targetOf(result.top[selected]); return [t.lat, t.lon]; }
  function fitView() {
    const pts = (S.ev ? S.ev.people.flatMap((p) => (hasRet(p) ? [[p.lat, p.lon], [p.ret.lat, p.ret.lon]] : [[p.lat, p.lon]])) : []);
    if (result) pts.push(targetPoint());
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25));
    else map.setView([48.8566, 2.3522], 11);
  }

  /* ---------- small helpers ---------- */
  function notice(text, kind) {
    const n = $("notice"); n.hidden = !text; n.textContent = text || ""; n.className = "msg" + (kind ? " " + kind : "");
    clearTimeout(notice.t); if (text && kind === "ok") notice.t = setTimeout(() => (n.hidden = true), 6000);
  }
  async function copyText(text, codeEl) {
    try { await navigator.clipboard.writeText(text); notice("Link copied.", "ok"); }
    catch (e) {
      if (codeEl) { const r = document.createRange(); r.selectNodeContents(codeEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      notice("Select the link and copy it (Cmd/Ctrl+C).", "warn");
    }
  }
  const inviteUrl = () => location.origin + location.pathname + "?e=" + S.ev.id;
  const organizerUrl = () => inviteUrl() + "&k=" + S.admin;
  const isMine = (p) => !!S.mine[p.id];
  const canEdit = (p) => isMine(p) || !!S.admin;                    // the organizer may edit anybody
  const hasRet = (p) => !!p.ret && (Math.abs(p.ret.lat - p.lat) > 1e-5 || Math.abs(p.ret.lon - p.lon) > 1e-5);
  const addrOf = (q) => q.addr || q.lat.toFixed(4) + ", " + q.lon.toFixed(4);

  /* ---------- options form (shared by "create" and the organizer's event view) ---------- */
  function optionsHTML(o, editable) {
    const dis = editable ? "" : " disabled";
    const obj = OBJECTIVES.find((x) => x[0] === o.objective) || OBJECTIVES[0];
    return `<div class="stack">
      <div class="field"><label>Optimize for</label>
        <div class="seg ${editable ? "edit" : ""}">${OBJECTIVES.map(([v, l, t]) => `<button type="button" data-opt="objective" data-v="${v}" title="${esc(t)}" class="${o.objective === v ? "on" : ""}"${dis}>${l}</button>`).join("")}</div>
        <p class="small muted">${obj[2]}</p></div>
      <div class="field"><label>Meet at</label>
        <div class="chips">${MEET.map(([k, l]) => `<button type="button" class="chip ${meetOf(o).includes(k) ? "on" : ""}" data-meet="${k}" aria-pressed="${meetOf(o).includes(k)}"${dis}>${l}</button>`).join("")}</div>
        <p class="small muted">${meetOf(o).length === 1 && meetOf(o)[0] === "station" ? "A metro, RER, train or tram station." : "Tick any mix. Stations are the quickest for public transport; other places add a walk from the nearest stop (up to 15 min), while people on foot, by bike or by car go straight there. Results are at least 500 m apart."}</p></div>
      <div class="field"><label>Day</label>
        <div class="seg ${editable ? "edit" : ""}">${[["0", "Weekday"], ["1", "Weekend"]].map(([v, l]) => `<button type="button" data-opt="profile" data-v="${v}" class="${String(o.profile) === v ? "on" : ""}"${dis}>${l}</button>`).join("")}</div></div>
      <label class="switch"><span>Include buses in trips<br><span class="small muted">Loads more data, a bit slower</span></span><input type="checkbox" data-opt="buses" ${o.buses ? "checked" : ""}${dis}></label>
      <div class="field"><label>Longest trip allowed: <span class="muted">${o.maxmin ? o.maxmin + " min" : "no limit"}</span></label>
        <input type="range" data-opt="maxmin" min="0" max="120" step="5" value="${o.maxmin}"${dis}></div>
    </div>`;
  }
  function readOpt(target, o) {
    const k = target.dataset.opt; if (!k) return false;
    if (target.type === "checkbox") o[k] = target.checked;
    else if (target.type === "range") o[k] = +target.value;
    else if (target.dataset.v !== undefined) o[k] = k === "profile" ? +target.dataset.v : target.dataset.v;
    return true;
  }

  /* ---------- views ---------- */
  function showHome() {
    clearTimeout(pollTimer); S.ev = null; S.admin = null; S.mine = {}; S.editing = null; S.draft = blankDraft();
    document.title = "Meet Point"; clearResult(); renderMarkers(); renderDraftMarkers();
    $("view").innerHTML = `
      <section><h2>Plan a meet-up</h2>
        <div class="card stack">
          <div class="field"><label for="f-title">Event name</label><input id="f-title" class="input" maxlength="80" placeholder="Friday dinner" value="${esc(S.title)}"></div>
          <div id="home-opts">${optionsHTML(S.draftOpts, true)}</div>
          <button id="create" class="btn primary block">Create event</button>
        </div>
        ${S.api ? '<p class="small muted">You get a link to send around. Everyone who opens it adds their own position, and the best meeting point updates live.</p>' : ""}
      </section>
      <div id="home-events">${homeEvents()}</div>`;
    syncStoredEvents();
  }
  /* "Your events": what this browser remembers (titles and keys live in localStorage) */
  function homeEvents() {
    const evs = Object.entries(store().events).filter(([, e]) => e.title);
    return evs.length ? `<section><h2>Your events</h2><ul class="stack" style="gap:8px">${evs.map(([id, e]) => `<li><button class="btn block" data-open="${id}" style="justify-content:space-between"><span>${esc(e.title)}</span><span class="muted small">${e.admin ? "organizer" : "guest"}</span></button></li>`).join("")}</ul></section>` : "";
  }
  /* ask the server about every remembered event: forget the ones that no longer exist, refresh the titles (also names events added by an import link) */
  async function syncStoredEvents() {
    const st = store(); let changed = false;
    await Promise.all(Object.keys(st.events).map(async (id) => {
      try { const e = await Api.get(id); if (st.events[id].title !== e.title) { st.events[id].title = e.title; changed = true; } }
      catch (err) { if (/not found/.test(err.message)) { delete st.events[id]; changed = true; } }          // other errors (offline...): keep it
    }));
    if (!changed) return;
    putStore(st); const box = $("home-events"); if (box && !S.ev) box.innerHTML = homeEvents();
  }

  function showEvent() {
    document.title = S.ev.title + " · Meet Point";
    $("view").innerHTML = `
      <section id="v-head"></section>
      <section id="v-phase"></section>
      <section id="v-people-sec"><h2>People <span id="count" class="muted"></span></h2><ul id="people"></ul></section>
      <section id="v-results" hidden><h2>Best meeting points</h2><div id="cards"></div><div id="places"></div></section>
      <section id="v-add"></section>
      <section id="v-opts"><h2>Settings</h2><div class="card" id="opts-body"></div></section>
      ${S.admin ? '<section><button id="del" class="btn danger sm" style="align-self:flex-start">Delete this event</button></section>' : ""}`;
    renderHead(); renderPeople(); renderAdd(); renderOpts(); renderPhase();
    idle = 0; nextPoll();
  }
  function renderHead() {
    $("v-head").innerHTML = `
      <button class="btn ghost sm" id="home" style="align-self:flex-start;margin-left:-10px">← All events</button>
      ${S.admin ? `<input id="ev-title" class="input" style="font-weight:700;font-size:18px;height:46px" maxlength="80" value="${esc(S.ev.title)}" aria-label="Event name">` : `<h2 style="font-size:22px;letter-spacing:-.01em;text-transform:none;color:var(--ink)">${esc(S.ev.title)}</h2>`}
      <div class="card invite">
        <b>Invite people</b>
        <p class="small muted">Send this link. Everyone who opens it adds their own position.</p>
        <code id="inv-url">${esc(inviteUrl())}</code>
        <div class="row"><button class="btn primary sm" id="copy-inv">Copy invite link</button>${S.admin ? '<button class="btn sm" id="copy-adm" title="Open this on another device to stay organizer. Keep it private.">Copy organizer link</button>' : ""}</div>
      </div>`;
  }
  /* An address with its three ways of being set: typing (suggestions), picking on the map, and (optionally) the device location.
     ak says which position it edits: "d" new person, "dr" new person's way back, "p:<id>" a person, "r:<id>" a person's way back. */
  function addrField(ak, label, pos, draft) {
    const set = pos.lat !== null && pos.lat !== undefined;
    return `<div class="field"><label>${label}</label>
      <div class="searchbox" data-ak="${ak}"><input class="input" data-addr="${ak}" autocomplete="off" placeholder="Type an address in Île-de-France…" value="${esc(pos.addr || "")}"><ul class="suggest" hidden></ul></div>
      <div class="searchbox" data-ak="${ak}"><input class="input" data-stn="${ak}" autocomplete="off" placeholder="Or a station: metro, RER, bus…"><ul class="suggest" hidden></ul></div>
      <div class="row"><button type="button" class="btn sm" data-pick="${ak}" title="Click anywhere, or on a station to snap to it">${S.picking === ak ? "Click the map or a station…" : "Pick on map"}</button>${draft ? `<button type="button" class="btn sm" data-geo="${ak}">Use my location</button>` : ""}</div>
      ${draft && set ? `<div class="placed"><span class="dot"></span><span class="grow">${esc(pos.addr || "Pin placed")}</span></div>` : ""}</div>`;
  }
  const modeChips = (modes, attr) => `<div class="chips">${MODES.map(([k, l]) => `<button type="button" class="chip ${modes[k] ? "on" : ""}" data-${attr}="${k}" aria-pressed="${!!modes[k]}">${l}</button>`).join("")}</div>`;
  function editHTML(p) {
    return `<div class="more">
      <div class="field"><label>Name</label><input class="input" data-f="name" maxlength="40" value="${esc(p.name)}"></div>
      ${addrField("p:" + p.id, "Starts from", p)}
      <label class="switch"><span>Different address for the way back</span><input type="checkbox" data-retsw ${p.ret ? "checked" : ""}></label>
      ${p.ret ? addrField("r:" + p.id, "Goes back to", p.ret) : ""}
      <div class="field"><label>Travels by</label>${modeChips(p.modes, "m")}</div>
      <div class="field"><label>Weight in "Fastest overall" and "Balanced"</label><select class="select" data-f="weight">${[1, 2, 3].map((w) => `<option value="${w}"${p.weight === w ? " selected" : ""}>×${w}</option>`).join("")}</select></div>
      <p class="small muted">You can also drag the pins on the map.</p>
      <button class="btn danger sm" data-act="leave" style="align-self:flex-start">Remove this entry</button>
    </div>`;
  }
  function renderPeople() {
    const ps = S.ev.people;
    $("count").textContent = `${ps.length}/10`;
    $("people").innerHTML = ps.length ? ps.map((p, i) => {
      const mine = isMine(p), can = canEdit(p), open = S.editing === p.id;
      return `<li class="card person" data-pid="${p.id}">
        <span class="dot" style="background:${COLORS[i]}"></span>
        <div class="nm"><span>${esc(p.name)}</span>${mine ? '<span class="you">you</span>' : ""}</div>
        <div class="acts row">${can && phase() === "open" ? `<button class="btn sm" data-act="edit">${open ? "Done" : "Edit"}</button>` : ""}${S.admin && !mine && !open && phase() === "open" ? '<button class="btn ghost sm" data-act="remove" title="Remove this person">Remove</button>' : ""}</div>
        <div class="ad">${esc(addrOf(p))}</div>
        ${hasRet(p) ? `<div class="ad back">↩ ${esc(addrOf(p.ret))}</div>` : ""}
        ${open ? editHTML(p) : `<div class="chips" style="grid-column:2/-1;margin-top:6px">${MODES.filter(([k]) => p.modes[k]).map(([, l]) => `<span class="chip static">${l}</span>`).join("")}</div>`}
      </li>`;
    }).join("") : '<li class="empty">Nobody yet. Add the first position below.</li>';
    renderMarkers();
  }
  let addKey = "";
  const addState = () => phase() + (S.ev.people.length >= 10) + ":" + Object.keys(S.mine).some((pid) => S.ev.people.some((p) => p.id === pid));
  function renderAddIfNeeded() {                        // the add form only depends on these two facts, so typing in it is never interrupted
    if (addState() !== addKey) renderAdd();
  }
  const canAdd = () => { const d = S.draft; return d.lat !== null && !!d.name.trim() && (!d.retOn || d.ret.lat !== null); };
  function renderAdd() {
    addKey = addState();
    const d = S.draft, hasMine = Object.keys(S.mine).some((pid) => S.ev.people.some((p) => p.id === pid));
    if (phase() !== "open") { $("v-add").innerHTML = ""; return; }
    if (S.ev.people.length >= 10) { $("v-add").innerHTML = '<div class="msg">This event is full (10 people).</div>'; return; }
    $("v-add").innerHTML = `<h2>${hasMine ? "Add someone else" : "Add your position"}</h2>
      <div class="card stack">
        <div class="field"><label for="d-name">${hasMine ? "Their name" : "Your name"}</label><input id="d-name" class="input" maxlength="40" placeholder="${hasMine ? "Name" : "Your name"}" value="${esc(d.name)}"></div>
        ${addrField("d", d.retOn ? "Starts from" : "Where from", d, true)}
        <label class="switch"><span>Different address for the way back</span><input type="checkbox" data-dretsw ${d.retOn ? "checked" : ""}></label>
        ${d.retOn ? addrField("dr", "Goes back to", d.ret, true) : ""}
        <div class="field"><label>Travels by</label>${modeChips(d.modes, "dm")}</div>
        <button id="d-add" class="btn primary block"${canAdd() ? "" : " disabled"}>Add to the event</button>
      </div>`;
  }
  function renderOpts() {
    $("opts-body").innerHTML = optionsHTML(S.ev.options, !!S.admin && phase() === "open") + (S.admin ? "" : '<p class="small muted" style="margin-top:10px">Only the organizer can change these.</p>');
  }

  /* ---------- markers ---------- */
  function pinIcon(label, color, cls) {
    const n = /\bret\b/.test(cls || "") ? 22 : 28;
    return L.divIcon({ className: "", iconSize: [n, n], iconAnchor: [n / 2, n], html: `<div class="pin ${cls || ""}" style="background:${color}"><span>${label}</span></div>` });
  }
  function renderMarkers() {
    markers.forEach((m) => m.remove()); markers = [];
    (S.ev ? S.ev.people : []).forEach((p, i) => {
      const can = canEdit(p);
      const m = L.marker([p.lat, p.lon], { draggable: can, icon: pinIcon(i + 1, COLORS[i], isMine(p) ? "mine" : ""), title: p.name }).addTo(map);
      m.bindTooltip(p.name, { direction: "top", offset: [0, -26] });
      if (can) m.on("dragend", (e) => { const ll = e.target.getLatLng(); setPos("p:" + p.id, ll.lat, ll.lng, "", true); });
      markers.push(m);
      if (hasRet(p)) {                                  // smaller pin for where they go back to
        const r = L.marker([p.ret.lat, p.ret.lon], { draggable: can, icon: pinIcon("↩", COLORS[i], "ret"), title: p.name + " (way back)" }).addTo(map);
        r.bindTooltip(p.name + " · way back", { direction: "top", offset: [0, -20] });
        if (can) r.on("dragend", (e) => { const ll = e.target.getLatLng(); setPos("r:" + p.id, ll.lat, ll.lng, "", true); });
        markers.push(r);
      }
    });
  }
  function renderDraftMarkers() {
    draftMarkers.forEach((m) => m.remove()); draftMarkers = [];
    const d = S.draft;
    for (const [ak, pos, label] of [["d", d, "+"], ["dr", d.retOn ? d.ret : null, "↩"]]) {
      if (!pos || pos.lat === null) continue;
      const m = L.marker([pos.lat, pos.lon], { draggable: true, icon: pinIcon(label, "var(--card)", "draft" + (ak === "dr" ? " ret" : "")) }).addTo(map);
      m.on("dragend", (e) => { const ll = e.target.getLatLng(); setPos(ak, ll.lat, ll.lng, "", true); });
      draftMarkers.push(m);
    }
  }

  /* ---------- address search, reverse geocoding ---------- */
  async function reverse(lat, lon) {
    try { const r = await (await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`, { signal: AbortSignal.timeout(4000) })).json(); return r.features[0] ? r.features[0].properties.label : "Dropped pin"; }
    catch (e) { return "Dropped pin"; }
  }
  function refOf(ak) {
    const [k, pid] = ak.split(":");
    if (k === "d") return { o: S.draft };
    if (k === "dr") return { o: S.draft.ret };
    const p = S.ev && S.ev.people.find((x) => x.id === pid); if (!p) return null;
    return { o: k === "p" ? p : p.ret, p };
  }
  /* set the position behind an address field; addr "" means look the address up from the coordinates */
  async function setPos(ak, lat, lon, addr, keepView) {
    const r = refOf(ak); if (!r || !r.o) return;
    const done = () => (r.p ? (renderPeople(), savePerson(r.p)) : (renderAdd(), renderDraftMarkers()));
    Object.assign(r.o, { lat, lon, addr: addr || "Locating…" }); done();
    if (!keepView) map.panTo([lat, lon]);
    if (!addr) { const a = await reverse(lat, lon); if (r.o.lat === lat && r.o.lon === lon) { r.o.addr = a; done(); } }
  }
  function setPicking(ak) {
    const was = S.picking; S.picking = ak; document.body.classList.toggle("picking", !!ak);
    if (S.ev && was !== ak) { renderAdd(); renderPeople(); }
  }
  /* Suggestion dropdown. Each entry: {label, tag, lat, lon, addr}. Stations are matched here, instantly, ignoring case, accents and
     apostrophes; addresses come from the national address service. Keyboard: Up/Down, Tab/Shift+Tab, Enter picks (the first one if none is
     highlighted), Escape closes. */
  const stationItem = (m) => ({ label: m.st[1], tag: m.kind === "bus" ? "bus stop" : "station", lat: m.st[2], lon: m.st[3], addr: m.st[1] + (m.kind === "bus" ? " (bus stop)" : " (station)") });
  function showSuggestions(box, items) {
    box._items = items; box._active = -1;
    box.innerHTML = items.map((it, i) => `<li data-i="${i}">${esc(it.label)}${it.tag ? ` <span class="muted small">${it.tag}</span>` : ""}</li>`).join(""); box.hidden = !items.length;
  }
  function highlight(box, k) {
    box._active = k;
    [...box.children].forEach((li, i) => { li.classList.toggle("on", i === k); if (i === k) li.scrollIntoView({ block: "nearest" }); });
  }
  function pickSuggestion(box, it) { box.hidden = true; setPos(box.closest(".searchbox").dataset.ak, it.lat, it.lon, it.addr); }
  function suggest(q, box, stationsOnly) {
    clearTimeout(suggTimer); box._q = q;
    const stations = q.length >= 2 ? stationMatches(q).slice(0, stationsOnly ? 6 : 3).map(stationItem) : [];
    if (stationsOnly || q.length < 3) return showSuggestions(box, stations);
    showSuggestions(box, stations);                       // stations appear at once, addresses follow
    suggTimer = setTimeout(async () => {
      try {
        const r = await (await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=6&lat=48.85&lon=2.35`, { signal: AbortSignal.timeout(5000) })).json();
        if (box._q !== q) return;                         // the text changed meanwhile
        const addrs = r.features.filter((f) => IDF.test(f.properties.postcode || "")).slice(0, 5).map((f) => ({ label: f.properties.label, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], addr: f.properties.label }));
        showSuggestions(box, stations.concat(addrs));
      } catch (e) { /* the stations already shown stay */ }
    }, 220);
  }

  /* ---------- actions on the event ---------- */
  async function addPerson() {
    const d = S.draft, pos = (q) => ({ addr: q.addr, lat: q.lat, lon: q.lon });
    try {
      const r = await Api.post({ action: "join", id: S.ev.id, p: Object.assign(pos(d), { name: d.name.trim(), modes: d.modes, weight: 1, ret: d.retOn ? pos(d.ret) : null }) });
      S.mine[r.pid] = r.token; setLocal(S.ev.id, { mine: S.mine });
      S.draft = Object.assign(blankDraft(), { modes: d.modes }); renderDraftMarkers();
      await refresh(); notice("Added.", "ok");
    } catch (e) { notice("Could not add: " + e.message, "warn"); }
  }
  async function savePerson(p) {                        // the owner's token or the organizer's key is accepted
    try { await Api.post({ action: "update", id: S.ev.id, pid: p.id, token: S.mine[p.id], adminKey: S.admin, p }); }
    catch (e) { notice("Could not save: " + e.message, "warn"); }
    scheduleSolve();
  }
  async function removePerson(p) {
    try {
      await Api.post({ action: "leave", id: S.ev.id, pid: p.id, token: S.mine[p.id], adminKey: S.admin });
      delete S.mine[p.id]; setLocal(S.ev.id, { mine: S.mine }); if (S.editing === p.id) S.editing = null; await refresh();
    } catch (e) { notice("Could not remove: " + e.message, "warn"); }
  }
  function saveOptionsSoon() {
    clearTimeout(optTimer);
    optTimer = setTimeout(() => { optTimer = null; Api.post({ action: "options", id: S.ev.id, adminKey: S.admin, title: S.ev.title, options: S.ev.options }).catch((e) => notice("Could not save settings: " + e.message, "warn")); }, 500);
  }

  /* ---------- loading and polling ---------- */
  async function openEvent(id) {
    try { S.ev = await Api.get(id); } catch (e) { S.ev = null; showHome(); return notice("Event not found. It may have been deleted.", "warn"); }
    const loc = getLocal(id); S.admin = loc.admin; S.mine = loc.mine || {}; S.editing = null; S.draft = blankDraft();
    setLocal(id, { title: S.ev.title }); notice("");
    showEvent(); renderDraftMarkers(); lastSig = ""; scheduleSolve(true);
    fitView();
  }
  async function refresh() {
    S.ev = await Api.get(S.ev.id);
    S.mine = Object.fromEntries(Object.entries(S.mine).filter(([pid]) => S.ev.people.some((p) => p.id === pid)));
    renderPeople(); renderAdd(); renderOpts(); renderHead(); renderPhase(); if (phase() === "voting") renderCards(); scheduleSolve();
  }
  /* The server is asked for changes every 10 s, then every 20 s and 40 s while nothing happens; any click or edit goes back to 10 s.
     Hidden tabs do not poll at all and catch up the moment they are shown again. */
  let idle = 0;
  function nextPoll() { clearTimeout(pollTimer); pollTimer = setTimeout(poll, idle < 6 ? 10000 : idle < 18 ? 20000 : 40000); }
  async function poll() {
    if (!S.ev || document.hidden) return;
    if (optTimer) return nextPoll();
    const focus = document.activeElement, inside = (sel) => focus && focus.closest && focus.closest(sel);
    try {
      const e = await Api.get(S.ev.id, S.ev.rev); if (e.unchanged) { idle++; return nextPoll(); }
      idle = 0;
      S.ev = e; S.mine = Object.fromEntries(Object.entries(S.mine).filter(([pid]) => e.people.some((p) => p.id === pid)));
      if (!inside(".more")) renderPeople();            // keep the edit panel alone while someone types in it
      if (!inside("#opts-body")) renderOpts();
      renderAddIfNeeded(); renderPhase(); if (phase() === "voting") renderCards(); scheduleSolve();
    } catch (err) { if (/not found/.test(err.message)) { notice("This event was deleted.", "warn"); return showHome(); } }
    nextPoll();
  }
  document.addEventListener("visibilitychange", () => { if (S.ev && !document.hidden) { idle = 0; clearTimeout(pollTimer); poll(); } });
  document.addEventListener("pointerdown", () => { idle = 0; });

  /* ---------- solving and results ---------- */
  // Solving runs in a Web Worker (assets/engine.js): the page never freezes, whatever the size of the network. Same code on the page thread if no worker.
  const engine = new Engine({ build: BUILD, dataBase: new URL("data/", location.href).href });
  window.__meetpointEngine = engine;
  function scheduleSolve(force) { clearTimeout(solveTimer); solveTimer = setTimeout(() => solveNow(force), 150); }
  async function solveNow(force) {
    if (!S.ev || !graphBase) return;
    const o = S.ev.options, ps = S.ev.people;
    const sig = JSON.stringify([ps.map((p) => [p.lat, p.lon, hasRet(p) ? p.ret : null, p.modes, p.weight]), o]);
    if (sig === lastSig && !force) return; lastSig = sig;
    const sec = $("v-results"); if (!sec) return; sec.hidden = false;
    if (ps.length < 2) { clearResult(); renderPhase(); $("cards").innerHTML = '<div class="empty">Add at least two people to see the best meeting point.</div>'; return; }
    const people = ps.map((p) => Object.assign({}, p, { ret: hasRet(p) ? p.ret : null }));
    if (o.buses && !busWarm) notice("Loading the bus network…");
    let r;
    try { r = await engine.solve({ profile: o.profile, buses: o.buses }, people, { objective: o.objective, maxMinutes: o.maxmin, top: 5, meet: meetOf(o) }); }
    catch (e) { return notice("Could not compute the meeting point (" + e.message + ")." + (o.buses ? " Turn buses off or run tools/build_bus.py." : ""), "warn"); }
    if (o.buses && !busWarm) { busWarm = true; notice(""); }
    if (!r) return;                                      // a newer request replaced this one
    const keep = result && result.top[selected] ? result.top[selected].c : null;
    result = { top: r.top, relaxed: r.relaxed, people, seq: r.seq };
    result.top.forEach((x) => (x.est = { times: x.times.slice(), back: x.back.slice(), max: x.max, sum: x.sum }));   // the solver's own numbers, kept for the ballot
    if (!result.top.length) { clearResult(); $("cards").innerHTML = '<div class="empty">No meeting point is reachable for everyone. Check that each person can reach the rail network with a mode they ticked.</div>'; return; }
    const same = result.top.findIndex((r) => r.c === keep);
    result.relaxedLimit = result.relaxed ? o.maxmin : 0;
    renderCards(); renderPhase(); select(same >= 0 ? same : 0);
  }
  function clearResult() {
    result = null; token++; $("player").hidden = true; flow.setRoutes([], null); flow.pause();
    if (targetMarker) { targetMarker.remove(); targetMarker = null; }
    const p = $("places"); if (p) p.innerHTML = "";
  }
  /* ---------- the vote ---------- */
  const phase = () => (S.ev && S.ev.phase) || "open";                 // open: people register; voting: everybody picks one of the best 5
  const votesOf = () => (S.ev && S.ev.votes) || {};
  const votable = () => S.ev.people.filter((p) => S.admin || S.mine[p.id]);       // the entries this browser may vote for
  const voter = () => { const v = votable(); return v.find((p) => p.id === S.voter) || v[0] || null; };
  const posKey = (lat, lon) => lat.toFixed(4) + "," + lon.toFixed(4);

  let culturePlaces = [];                                              // data/culture.json: museums, theatres, sights...
  const metres = (a, b, c, d) => Math.hypot((c - a) * 111320, (d - b) * 73000);
  /* what to do around a point: places to eat or drink, culture and sights, parks (all from the local data: instant) */
  function around(lat, lon) {
    const near = base.nearby(lat, lon, 350), label = { r: "Restaurant", c: "Café", b: "Bar" };
    const food = [...near.filter((p) => p.t === "r").slice(0, 3), ...near.filter((p) => p.t === "c").slice(0, 2), ...near.filter((p) => p.t === "b").slice(0, 1)].map((p) => ({ name: p.name, what: label[p.t], d: p.d }));
    const cult = culturePlaces.map((p) => ({ name: p.name, what: cap(p.sub || p.kind), d: metres(lat, lon, p.lat, p.lon) })).filter((p) => p.d <= 700).sort((x, y) => x.d - y.d);
    const parks = (base.parkRaw || []).map((p) => ({ name: p[0], what: "Park", d: metres(lat, lon, p[1], p[2]) })).filter((p) => p.d <= 600).sort((x, y) => x.d - y.d);
    return { eat: near.length, food, cult, parks };
  }
  function aroundHTML(lat, lon, open) {
    const a = around(lat, lon), line = (p) => `<li><b>${esc(p.name)}</b> · ${esc(p.what)} · ${Math.round(p.d / 10) * 10} m</li>`;
    const summary = `${a.eat} to eat or drink · ${a.cult.length} culture and sights · ${a.parks.length} parks nearby`;
    if (!open) return `<div class="small muted">${summary}</div>`;
    const items = [...a.food, ...a.cult.slice(0, 3), ...a.parks.slice(0, 2)];
    return `<div class="around"><div class="small muted">${summary}</div>${items.length ? `<ul>${items.map(line).join("")}</ul>` : ""}</div>`;
  }

  /* the panel below the people: organizer controls, and the voting header */
  function renderPhase() {
    const ph = phase(), el = $("v-phase"); if (!el) return;
    ["v-people-sec", "v-add", "v-opts"].forEach((id) => { const e = $(id); if (e) e.hidden = ph === "voting"; });   // while voting the panel is the vote
    const inv = document.querySelector("#v-head .invite"); if (inv) inv.hidden = ph === "voting";
    if (ph === "voting") {
      const voted = Object.keys(votesOf()).length, n = S.ev.people.length, mine = votable(), v = voter();
      el.innerHTML = `<h2>Vote for the meeting place</h2>
        <div class="card stack">
          <p class="small muted">Registration is closed. Pick the option you prefer: ${voted} of ${n} have voted.</p>
          ${mine.length > 1 ? `<div class="field"><label>Voting as</label><select id="voter" class="select">${mine.map((p) => `<option value="${p.id}"${v && v.id === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>` : ""}
          ${!mine.length ? '<p class="small muted">You are not in this event, so you can only watch the vote.</p>' : ""}
          ${S.admin ? '<button id="reopen" class="btn sm" style="align-self:flex-start" title="Back to registration. The votes are dropped.">← Reopen registration</button>' : ""}
        </div>`;
    } else if (S.admin) {
      el.innerHTML = `<div class="card stack">
        <b>Everybody is in?</b>
        <p class="small muted">Registration closes and everyone votes for one of the best 5 places. You can reopen it later.</p>
        <button id="close-reg" class="btn primary" ${S.ev.people.length >= 2 && result && result.top.length ? "" : "disabled"}>Everyone is registered: start the vote</button></div>`;
    } else el.innerHTML = '<p class="small muted">The organizer starts the vote once everybody has joined.</p>';
    const h = document.querySelector("#v-results h2"); if (h) h.textContent = ph === "voting" ? "The top 5 places" : "Best meeting points";
  }
  async function closeRegistration() {
    if (!result || !result.top.length) return notice("No meeting point yet.", "warn");
    if (!confirm("Close registration and start the vote? Nobody can join or change their position until you reopen it.")) return;
    const ballot = result.top.slice(0, 5).map((r) => { const t = targetOf(r), e = r.est || r; return { name: t.name, lat: t.lat, lon: t.lon, kind: r.place ? r.place.kind : "station", sub: (r.place && r.place.sub) || "", times: e.times, back: e.back, max: e.max, sum: e.sum }; });
    try { await Api.post({ action: "close", id: S.ev.id, adminKey: S.admin, ballot }); S.editing = null; await refresh(); }
    catch (e) { notice("Could not start the vote: " + e.message, "warn"); }
  }
  async function reopenRegistration() {
    if (!confirm("Go back to registration? The votes are dropped.")) return;
    try { await Api.post({ action: "reopen", id: S.ev.id, adminKey: S.admin }); await refresh(); } catch (e) { notice("Could not reopen: " + e.message, "warn"); }
  }
  async function castVote(b) {
    const p = voter(); if (!p) return;
    const cur = votesOf()[p.id];
    try { await Api.post({ action: "vote", id: S.ev.id, pid: p.id, token: S.mine[p.id], adminKey: S.admin, choice: cur === b ? null : b }); await refresh(); }
    catch (e) { notice("Could not vote: " + e.message, "warn"); }
  }
  /* the ballot is the list everybody was given; numbers come from this browser's own result when it is the same place (street-refined), else from the snapshot */
  function renderBallot() {
    const B = S.ev.ballot || [], votes = votesOf(), me = voter(), mine = me ? votes[me.id] : undefined;
    const counts = B.map((_, i) => Object.values(votes).filter((c) => c === i).length), lead = Math.max(0, ...counts);
    $("cards").innerHTML = B.map((b, i) => {
      const li = result ? result.top.findIndex((r) => { const t = targetOf(r); return posKey(t.lat, t.lon) === posKey(b.lat, b.lon); }) : -1, r = li >= 0 ? result.top[li] : b;
      const near = nearestStation(b.lat, b.lon), what = b.kind === "station" ? "" : (b.sub ? cap(b.sub) : KIND[b.kind] || "Place");
      const sub = b.kind === "station" ? "" : `${what}${near ? " · near " + near[1] : ""}`, sel = li >= 0 && li === selected;
      const voters = S.ev.people.map((p, pi) => (votes[p.id] === i ? `<span class="vdot" style="background:${COLORS[pi]}" title="${esc(p.name)}"></span>` : "")).join("");
      return `<div class="card res ${sel ? "on" : ""} ${mine === i ? "voted" : ""}" data-k="${li}" data-b="${i}" role="button" tabindex="0">
        <div class="t"><b>${esc(b.name)}</b><span class="rank">#${i + 1}</span></div>${sub ? `<div class="small muted" style="margin:-4px 0 6px">${esc(sub)}</div>` : ""}
        <div class="times">${S.ev.people.map((p, pi) => `
          <span style="color:${COLORS[pi]}">●</span><span class="bar" title="${esc(p.name)}"><i style="width:${Math.min(100, Math.max(r.times[pi] || 0, r.back[pi] || 0) / (r.max || 1) * 100)}%;background:${COLORS[pi]}"></i></span><span>${Math.round(r.times[pi])} min${S.ev.people[pi].ret && r.back && r.back[pi] ? ` · ↩ ${Math.round(r.back[pi])}` : ""}</span>`).join("")}</div>
        <div class="meta">Longest ${Math.round(r.max)} min · average ${Math.round(r.sum / ((r.times.length + r.back.length) || 1))} min</div>
        ${aroundHTML(b.lat, b.lon, sel)}
        <div class="votes ${counts[i] && counts[i] === lead ? "lead" : ""}"><span class="vcount">${counts[i]} vote${counts[i] === 1 ? "" : "s"}${counts[i] && counts[i] === lead ? " · leading" : ""}</span><span class="vdots">${voters}</span>
          ${me ? `<button class="btn sm ${mine === i ? "primary" : ""}" data-vote="${i}">${mine === i ? "✓ Your vote" : "Vote"}</button>` : ""}</div>
      </div>`;
    }).join("");
  }
  function renderCards() {
    if (phase() === "voting" && S.ev.ballot) return renderBallot();
    if (!result) return;
    const relaxedLimit = result.relaxedLimit;
    $("cards").innerHTML = (relaxedLimit ? `<div class="msg warn">Nobody could stay under ${relaxedLimit} min. Showing the closest options.</div>` : "") +
      result.top.map((r, k) => `
      <div class="card res ${k === selected ? "on" : ""}" data-k="${k}" role="button" tabindex="0">
        <div class="t"><b>${esc(targetOf(r).name)}</b><span class="rank">#${k + 1}</span></div>${targetOf(r).sub ? `<div class="small muted" style="margin:-4px 0 6px">${esc(targetOf(r).sub)}</div>` : ""}
        <div class="times">${S.ev.people.map((p, i) => `
          <span style="color:${COLORS[i]}">●</span><span class="bar" title="${esc(p.name)}"><i style="width:${Math.min(100, Math.max(r.times[i], r.back[i]) / (r.max || 1) * 100)}%;background:${COLORS[i]}"></i></span><span data-t="${k}-${i}">${Math.round(r.times[i])} min${result.people[i].ret ? ` · ↩ ${Math.round(r.back[i])}` : ""}</span>`).join("")}</div>
        <div class="meta">Longest ${Math.round(r.max)} min · average ${Math.round(r.sum / (r.times.length + r.back.length))} min</div>
      </div>`).join("");
  }

  /* ---------- selection, routes, animation ---------- */
  async function select(k, zoomIn) {
    selected = k; const my = ++token, r = result.top[k], tg = targetOf(r), people = result.people;
    document.querySelectorAll("#cards .res").forEach((el) => el.classList.toggle("on", +el.dataset.k === k));
    let iti; try { iti = await engine.itineraries(result.seq, r.c); } catch (e) { return; }   // the engine rebuilds the legs
    if (my !== token) return;
    const anyBack = !!iti.back;
    const route = (p, i, legs) => ({ name: p.name, color: COLORS[i], legs });
    const out = people.map((p, i) => route(p, i, iti.out[i]));
    const back = anyBack ? people.map((p, i) => route(p, i, iti.back[i])) : null;
    if (!anyBack) dirn = "out";
    $("dir").hidden = !anyBack; $("dir").value = dirn;
    curRoutes = { out, back };
    const target = [tg.lat, tg.lon];
    if (targetMarker) targetMarker.remove();
    targetMarker = L.marker(target, { icon: L.divIcon({ className: "", html: '<div class="target">★</div>', iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 1000 }).addTo(map).bindTooltip(tg.name, { direction: "top", offset: [0, -18] });
    if (phase() === "voting" && zoomIn) map.flyTo(target, 15, { duration: 0.6 }); else fitView();      // voting: a click zooms to the place; the routes still lead there
    $("player").hidden = false; flow.setRoutes(curRoutes[dirn], target);   // shown paused: the animation starts on Play, not by itself
    if (phase() === "voting") { const bx = $("places"); if (bx) bx.innerHTML = ""; } else loadPlaces([0, tg.name, tg.lat, tg.lon]);
    await new Promise((r) => setTimeout(r, 500)); if (my !== token) return;      // skip the lookups while someone is clicking through the cards
    await refine(out.concat(back || []), my);          // real street geometry for walk/bike/car legs
    if (my !== token) return;
    const wasPlaying = flow.playing, t = flow.t / (flow.T || 1);
    flow.setRoutes(curRoutes[dirn], target); flow.seek(t); if (wasPlaying) flow.play();
    // street routes change the estimates: update the card so its numbers match the animation
    const mins = (rts) => rts.map((rt) => rt.legs.reduce((s, l) => s + (l.wait || 0) + l.sec, 0) / 60);
    r.times = mins(out); r.back = back ? mins(back) : r.times.slice();
    r.max = Math.max(...r.times, ...r.back); r.sum = r.times.concat(r.back).reduce((a, b) => a + b, 0);
    renderCards();
  }
  const streets = new Map();                           // street routes already fetched, by mode and end points
  const legKey = (leg) => leg.mode + ":" + leg.coords[0].map((x) => x.toFixed(5)) + ">" + leg.coords[leg.coords.length - 1].map((x) => x.toFixed(5));
  const OSRM = { walk: "routed-foot", bike: "routed-bike", car: "routed-car" };
  async function refine(routes, my) {
    const jobs = [];
    for (const rt of routes) for (const leg of rt.legs) if (OSRM[leg.mode] && leg.label === leg.mode) {
      const hit = streets.get(legKey(leg));                // same trip seen before: no request
      if (hit) { leg.coords = hit.coords.slice(); leg.sec = hit.sec; } else jobs.push(leg);
    }
    let next = 0;
    const worker = async () => {
      while (next < jobs.length && my === token) {
        const leg = jobs[next++], [a, b] = leg.coords;
        try {
          const j = await (await fetch(`https://routing.openstreetmap.de/${OSRM[leg.mode]}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`)).json(), rte = j.routes && j.routes[0];
          if (rte) {
            const key = legKey(leg);
            leg.coords = rte.geometry.coordinates.map((c) => [c[1], c[0]]); leg.sec = rte.duration + (leg.mode === "bike" ? 180 : leg.mode === "car" ? 480 : 0);
            streets.set(key, { coords: leg.coords.slice(), sec: leg.sec });
          }
        } catch (e) { /* keep the straight-line estimate */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }
  function onTick(t, T, playing) {
    $("clock").textContent = Math.floor(t / 60) + " min"; $("seek").value = T ? Math.round(t / T * 1000) : 0; $("play").textContent = playing ? "❚❚" : "▶";
  }
  $("play").onclick = () => (flow.playing ? flow.pause() : flow.play());
  $("seek").oninput = () => { flow.pause(); flow.seek($("seek").value / 1000); };
  $("dir").onchange = () => { dirn = $("dir").value; if (!curRoutes) return; flow.setRoutes(curRoutes[dirn] || curRoutes.out, [0, 0]); };
  $("speed").onchange = () => { flow.speed = +$("speed").value; };

  function loadPlaces(st) {                              // from the local OpenStreetMap data: no network, instant
    const box = $("places"); if (!box) return;
    const near = base.nearby(st[2], st[3], 350), label = { r: "Restaurant", c: "Café", b: "Bar" };
    const items = [...near.filter((p) => p.t === "r").slice(0, 5), ...near.filter((p) => p.t === "c").slice(0, 3), ...near.filter((p) => p.t === "b").slice(0, 2)];
    box.innerHTML = items.length ? `<h3>Around ${esc(st[1])}: ${near.length} places to eat or drink</h3><ul>${items.map((p) => `<li><b>${esc(p.name)}</b> · ${label[p.t]} · ${Math.round(p.d / 10) * 10} m</li>`).join("")}</ul>` : "";
  }

  /* ---------- events from the panel (delegated, so re-rendering never loses handlers) ---------- */
  const view = $("view");
  view.addEventListener("click", async (e) => {
    const t = e.target.closest("button, li, .res"); if (!t) return;
    if (t.id === "create") return createEvent();
    if (t.dataset.open) return go(t.dataset.open);
    if (t.id === "home") return go(null);
    if (t.id === "copy-inv") return copyText(inviteUrl(), $("inv-url"));
    if (t.id === "copy-adm") return copyText(organizerUrl(), $("inv-url"));
    if (t.id === "del") { if (confirm("Delete this event for everyone?")) { await Api.post({ action: "delete", id: S.ev.id, adminKey: S.admin }).catch(() => {}); const s = store(); delete s.events[S.ev.id]; putStore(s); go(null); } return; }
    if (t.dataset.pick) return setPicking(S.picking === t.dataset.pick ? null : t.dataset.pick);
    if (t.dataset.geo) return geolocate(t.dataset.geo);
    if (t.id === "d-add") return addPerson();
    if (t.dataset.dm) { S.draft.modes[t.dataset.dm] = !S.draft.modes[t.dataset.dm]; return renderAdd(); }
    if (t.closest(".suggest") && t.dataset.i !== undefined) { const box = t.closest(".suggest"); return pickSuggestion(box, box._items[+t.dataset.i]); }
    if (t.dataset.vote !== undefined) return castVote(+t.dataset.vote);
    if (t.id === "close-reg") return closeRegistration();
    if (t.id === "reopen") return reopenRegistration();
    if (t.classList.contains("res")) {
      if (t.dataset.b !== undefined && +t.dataset.k < 0) { const b = S.ev.ballot[+t.dataset.b]; return map.flyTo([b.lat, b.lon], 15, { duration: 0.6 }); }   // not in this browser's result: just go there
      if (t.dataset.b !== undefined && +t.dataset.k === selected && result) { const tg = targetPoint(); return map.flyTo(tg, map.getZoom() >= 14.5 ? 12.5 : 15, { duration: 0.6 }); }   // a second click zooms back out
      return select(+t.dataset.k, true);
    }
    const li = t.closest(".person"); const p = li && S.ev.people.find((x) => x.id === li.dataset.pid);
    if (p && t.dataset.act === "edit") { S.editing = S.editing === p.id ? null : p.id; return renderPeople(); }
    if (p && (t.dataset.act === "remove" || t.dataset.act === "leave")) return removePerson(p);
    if (p && t.dataset.m) { p.modes[t.dataset.m] = !p.modes[t.dataset.m]; renderPeople(); return savePerson(p); }
    if (t.dataset.meet) {                              // ticking what may be a meeting point (at least one stays on)
      const o = S.ev ? S.ev.options : S.draftOpts; if (S.ev && !S.admin) return;
      const set = new Set(meetOf(o)); set.has(t.dataset.meet) ? set.delete(t.dataset.meet) : set.add(t.dataset.meet);
      if (!set.size) return; delete o.where; o.meet = MEET.map(([k]) => k).filter((k) => set.has(k));
      return S.ev ? (renderOpts(), saveOptionsSoon(), scheduleSolve()) : (document.getElementById("home-opts").innerHTML = optionsHTML(S.draftOpts, true));
    }
    if (t.dataset.opt) {                               // option buttons (organizer or home form)
      const o = S.ev ? S.ev.options : S.draftOpts; if (S.ev && !S.admin) return;
      readOpt(t, o); return S.ev ? (renderOpts(), saveOptionsSoon(), scheduleSolve()) : (document.getElementById("home-opts").innerHTML = optionsHTML(S.draftOpts, true));
    }
  });
  view.addEventListener("focusin", async (e) => {         // bus stops are a big file: only fetched when someone starts a station search
    if (e.target.dataset && e.target.dataset.stn !== undefined && !graphBus) { try { await ensureBusGraph(); } catch (err) { /* rail stations still work */ } }
  });
  view.addEventListener("keydown", (e) => {              // keyboard use of the suggestion dropdowns
    const t = e.target; if (t.dataset.addr === undefined && t.dataset.stn === undefined) return;
    const box = t.parentNode.querySelector(".suggest"), n = box._items ? box._items.length : 0;
    if (box.hidden || !n) return;
    const back = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey), fwd = e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey), a = box._active;
    if (fwd && !(e.key === "Tab" && a === n - 1)) { e.preventDefault(); highlight(box, (a + 1) % n); }      // Tab leaves the field after the last entry
    else if (back && !(e.key === "Tab" && a <= 0)) { e.preventDefault(); highlight(box, a <= 0 ? n - 1 : a - 1); }
    else if (e.key === "Enter") { e.preventDefault(); pickSuggestion(box, box._items[a >= 0 ? a : 0]); }
    else if (e.key === "Escape") { box.hidden = true; }
    else if (e.key === "Tab") box.hidden = true;
  });
  view.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "f-title") S.title = t.value;
    else if (t.id === "d-name") { S.draft.name = t.value; const b = $("d-add"); if (b) b.disabled = !canAdd(); }
    else if (t.dataset.stn !== undefined) suggest(t.value.trim(), t.parentNode.querySelector(".suggest"), true);
    else if (t.dataset.addr !== undefined) suggest(t.value.trim(), t.parentNode.querySelector(".suggest"));
    else if (t.id === "ev-title" && S.admin) { S.ev.title = t.value; saveOptionsSoon(); }
    else if (t.dataset.opt && t.type === "range") {      // live label while dragging, apply on release
      const o = S.ev ? S.ev.options : S.draftOpts; readOpt(t, o);
      const lab = t.closest(".field").querySelector("label span.muted"); if (lab && t.dataset.opt === "maxmin") lab.textContent = o.maxmin ? o.maxmin + " min" : "no limit";
    }
  });
  view.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "voter") { S.voter = t.value; return renderBallot(); }
    if (t.dataset.retsw !== undefined) {                 // way back to a different address, for an existing person
      const p = S.ev.people.find((x) => x.id === t.closest(".person").dataset.pid); if (!p) return;
      p.ret = t.checked ? { addr: p.addr, lat: p.lat, lon: p.lon } : null; renderPeople(); savePerson(p);
    } else if (t.dataset.dretsw !== undefined) { S.draft.retOn = t.checked; renderAdd(); renderDraftMarkers(); }
    else if (t.dataset.opt) {
      const o = S.ev ? S.ev.options : S.draftOpts; if (S.ev && !S.admin) return;
      readOpt(t, o); if (S.ev) { saveOptionsSoon(); scheduleSolve(); renderOpts(); }
    } else if (t.dataset.f) {
      const li = t.closest(".person"), p = S.ev.people.find((x) => x.id === li.dataset.pid); if (!p) return;
      p[t.dataset.f] = t.dataset.f === "weight" ? +t.value : t.value.trim() || p.name; savePerson(p); renderPeople();
    }
  });

  function geolocate(ak) {
    if (!navigator.geolocation) return notice("Location is not available in this browser.", "warn");
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: la, longitude: lo } = pos.coords;
      if (la < 47.9 || la > 49.5 || lo < 1.2 || lo > 3.9) return notice("Your location is outside Île-de-France.", "warn");
      setPos(ak, la, lo, "");
    }, () => notice("Could not get your location. Type an address instead.", "warn"), { timeout: 8000 });
  }
  async function createEvent() {
    const title = ($("f-title").value || "").trim() || "Meet-up";
    try {
      const r = await Api.post({ action: "create", title, options: S.draftOpts });
      setLocal(r.id, { title, admin: r.adminKey, mine: {} }); S.title = ""; go(r.id);
    } catch (e) { notice("Could not create the event: " + (e.message || e) + (S.api ? "" : ". The event server (api/meetup.php) is not reachable."), "warn"); }
  }
  function go(id) { history.pushState(null, "", id ? "?e=" + id : location.pathname); route(); }
  addEventListener("popstate", route);
  async function route() {
    notice(""); setPicking(null);
    const q = new URLSearchParams(location.search), id = q.get("e");
    if (id && q.get("k")) { setLocal(id, { admin: q.get("k") }); history.replaceState(null, "", "?e=" + id); }
    if (q.get("import")) {                                // ?import=id.key,id.key: remember several events as organizer (see tools/seed_events.py)
      let n = 0;
      for (const part of q.get("import").split(",")) { const [eid, k] = part.split("."); if (/^[a-z0-9]{8}$/.test(eid) && k) { setLocal(eid, { admin: k, title: getLocal(eid).title || "Event " + eid }); n++; } }   // placeholder title: listed at once, the real one follows
      history.replaceState(null, "", location.pathname);
      setTimeout(() => { const left = Object.keys(store().events).length; notice(storageOk() ? `Remembered ${n} event${n === 1 ? "" : "s"} in this browser (${left} in the list).` : "This browser blocks site storage, so it cannot remember events. Allow cookies and site data for this address.", storageOk() ? "ok" : "warn"); }, 0);
    }
    return id ? openEvent(id) : showHome();
  }
  document.addEventListener("click", (e) => document.querySelectorAll(".suggest").forEach((b) => { if (!b.parentNode.contains(e.target)) b.hidden = true; }));

  /* ---------- full reload: fetch every file past the browser cache, then reload ---------- */
  const DATA_FILES = ["graph", "graph-bus", "rail-lines", "bus-lines", "roads", "roads-detail", "water", "green", "places", "pois"];
  async function hardReload() {
    notice("Re-downloading everything…");
    const urls = [location.pathname, "index.html"].concat(
      [...document.querySelectorAll("script[src], link[rel=stylesheet]")].map((el) => el.src || el.href).filter((u) => u.startsWith(location.origin)),
      DATA_FILES.map(dataUrl));
    // cache:"reload" asks the server for a fresh copy and replaces what the browser had stored
    await Promise.all(urls.map((u) => fetch(u, { cache: "reload" }).catch(() => null)));
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) { /* no Cache Storage here */ }
    location.reload();                                  // localStorage (organizer keys, own entries) is deliberately left alone
  }
  $("hard-reload").onclick = hardReload;

  /* ---------- updates: the page reloads itself when the server has a new build ---------- */
  async function checkUpdate() {
    if (!BUILD || document.hidden) return;
    try {
      const j = await (await fetch("api/build.php", { cache: "no-store" })).json();
      if (!j.build || j.build === BUILD) return;
      let tried = null; try { tried = sessionStorage.getItem("meetpoint:reloaded"); } catch (e) {}
      if (tried === j.build) return notice('A new version is installed, but this browser still shows the old one. Use "Reload everything" below.', "warn");   // never loop
      const f = document.activeElement, typing = f && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) && f.closest("#view");
      if (typing || (S.draft && (S.draft.name || S.draft.lat !== null))) {          // do not throw away what someone is filling in
        notice("A new version is available. Finish what you are doing, then ", "warn");
        const b = document.createElement("button"); b.className = "link"; b.textContent = "reload"; b.onclick = () => location.reload(); $("notice").append(b); return;
      }
      try { sessionStorage.setItem("meetpoint:reloaded", j.build); } catch (e) {}
      location.reload();
    } catch (e) { /* offline or server busy: try again later */ }
  }
  setInterval(checkUpdate, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
  window.__meetpointCheckUpdate = checkUpdate;           // for the tests

  /* ---------- boot ---------- */
  (async function () {
    base.setStations({ stations: [], lnodes: [] });
    loadBasemap(); renderLegend();
    const ping = await Api.ping(); S.api = ping.ok;
    try {
      graphBase = await fetch(dataUrl("graph")).then((r) => r.json()); base.setStations(graphBase);
    } catch (e) { notice("Could not load data/graph.json. Run tools/build_graph.py first.", "warn"); }
    await route();
    if (!storageOk()) notice("This browser blocks site storage, so it cannot remember your events or your organizer key. Allow cookies and site data for this address.", "warn");
    if (!S.api) notice(`Can't reach the event server (${ping.why}). Serve this folder with PHP (see README). If it is running, a content blocker may be blocking api/meetup.php.`, "warn");
  })();
})();
