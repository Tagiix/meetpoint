(function () {
  "use strict";
  const COLORS = ["#e8541e", "#2a7de1", "#2e9e5b", "#a24bd6", "#d9a400", "#e0457b", "#119da4", "#7a5c3e", "#4b5bd6", "#8a9a1f"];
  const MODES = [["walk", "Walk"], ["transit", "Transit"], ["bike", "Bike"], ["car", "Car"]];
  const OBJECTIVES = [
    ["max", "Fairest", "Nobody travels far: minimizes the longest trip."],
    ["sum", "Fastest overall", "Least total travel time for the whole group."],
    ["balanced", "Balanced", "Short total time, penalizing big gaps between people."],
  ];
  const IDF = /^(75|77|78|91|92|93|94|95)/;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const DEFAULT_OPTS = { objective: "max", profile: 0, maxmin: 0, restw: 0, buses: false };
  const DEFAULT_MODES = { walk: true, transit: true, bike: false, car: false };

  /* ---------- state ---------- */
  const S = { api: true, ev: null, admin: null, mine: {}, draftOpts: Object.assign({}, DEFAULT_OPTS), title: "", draft: blankDraft(), editing: null, picking: false };
  let graphBase = null, graphBus = null, restaurants = null, nets = {}, result = null, selected = 0, token = 0, lastSig = "", pollTimer = null;
  let markers = [], draftMarker = null, targetMarker = null, solveTimer = null, optTimer = null, sugg = [], suggTimer = null;

  function blankDraft() { return { name: "", addr: "", lat: null, lon: null, modes: Object.assign({}, DEFAULT_MODES) }; }

  /* ---------- local storage (per-browser secrets: organizer key and own entries) ---------- */
  function store() { try { return JSON.parse(localStorage.getItem("meetpoint:v2")) || { events: {} }; } catch (e) { return { events: {} }; } }
  function putStore(s) { try { localStorage.setItem("meetpoint:v2", JSON.stringify(s)); } catch (e) {} }
  function getLocal(id) { return store().events[id] || { title: "", admin: null, mine: {} }; }
  function setLocal(id, patch) { const s = store(); s.events[id] = Object.assign(getLocal(id), patch); putStore(s); }

  /* ---------- map ---------- */
  const map = L.map("map", { zoomControl: true, zoomAnimation: false, zoomSnap: 0.5, minZoom: 9, maxZoom: 17, maxBounds: [[47.8, 1.1], [49.7, 4.0]] }).setView([48.8566, 2.3522], 11);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution("Data © Île-de-France Mobilités, OpenStreetMap contributors");
  const base = new Basemap(map);
  window.__meetpointMap = map; window.__meetpointBase = base;                         // handy for debugging and screenshots
  const flow = new Flow(map, $("flow"), { onTick });
  map.on("click", (e) => {
    if (!S.picking) return;
    setPicking(false); setDraftPosition(e.latlng.lat, e.latlng.lng, "");
  });

  const MODE_W = { 0: 2.2, 1: 3.6, 2: 3.4, 3: 2 };
  const getJson = (name) => fetch(`data/${name}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  async function loadBasemap() {
    const [rail, roads, water, green, places, pois] = await Promise.all(["rail-lines", "roads", "water", "green", "places", "pois"].map(getJson));
    if (green) { base.addPolys("green", green.polys, {}); base.setParkNames(green.names || []); }
    if (pois) base.setPois(pois);
    if (water) { base.addPolys("water", water.areas || [], {}); base.addLines("water", water.rivers || [], {}); }
    if (roads) { base.addLines("roads", roads.secondary || [], { tier: 2 }); base.addLines("roads", roads.primary || [], { tier: 1 }); base.addLines("roads", roads.motorway || [], { tier: 0 }); }
    if (rail) for (const l of rail) base.addLines("rail", l.p, { color: l.c, w: MODE_W[l.m], mode: l.m });
    if (places) base.setPlaces(places);
    base.draw();
    if (map.getZoom() >= 12) ensureDetailRoads();
  }
  let detailLoaded = false;                              // secondary and tertiary roads: bigger file, only needed zoomed in
  async function ensureDetailRoads() {
    if (detailLoaded) return; detailLoaded = true;
    const r = await getJson("roads-detail");
    if (r) { base.addLines("roads", r.secondary || [], { tier: 2 }); base.addLines("roads", r.tertiary || [], { tier: 3 }); base.draw(); }
  }
  map.on("zoomend", () => { if (map.getZoom() >= 12) ensureDetailRoads(); });
  let busLoaded = false;
  async function ensureBusLines() {
    if (busLoaded) return; busLoaded = true;
    try { for (const l of await (await fetch("data/bus-lines.json")).json()) base.addLines("bus", l.p, {}); } catch (e) { busLoaded = false; }
  }

  function renderLegend() {
    const el = $("legend"); el.hidden = false;
    el.innerHTML = `<div class="k"><span class="sw" style="background:linear-gradient(90deg,#ffbe00,#0055c8,#eb2132,#84653d)"></span>Metro, RER, train, tram</div>
      <label><input type="checkbox" id="lg-roads" ${base.show.roads ? "checked" : ""}> Roads</label>
      <label><input type="checkbox" id="lg-food" ${base.show.food ? "checked" : ""}> Restaurants <span class="dots"><i style="background:var(--poi-r)"></i><i style="background:var(--poi-c)"></i><i style="background:var(--poi-b)"></i></span></label>
      <label><input type="checkbox" id="lg-bus" ${base.show.bus ? "checked" : ""}> Bus lines</label>`;
    $("lg-food").onchange = (e) => { base.show.food = e.target.checked; base.draw(); };
    $("lg-roads").onchange = (e) => { base.show.roads = e.target.checked; base.draw(); };
    $("lg-bus").onchange = async (e) => { base.show.bus = e.target.checked; if (e.target.checked) await ensureBusLines(); base.draw(); };
  }

  function targetPoint() { const st = result.net.graph.stations[result.top[selected].c]; return [st[2], st[3]]; }
  function fitView() {
    const pts = (S.ev ? S.ev.people.map((p) => [p.lat, p.lon]) : []);
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

  /* ---------- options form (shared by "create" and the organizer's event view) ---------- */
  function optionsHTML(o, editable) {
    const dis = editable ? "" : " disabled";
    const obj = OBJECTIVES.find((x) => x[0] === o.objective) || OBJECTIVES[0];
    return `<div class="stack">
      <div class="field"><label>Optimize for</label>
        <div class="seg ${editable ? "edit" : ""}">${OBJECTIVES.map(([v, l, t]) => `<button type="button" data-opt="objective" data-v="${v}" title="${esc(t)}" class="${o.objective === v ? "on" : ""}"${dis}>${l}</button>`).join("")}</div>
        <p class="small muted">${obj[2]}</p></div>
      <div class="field"><label>Day</label>
        <div class="seg ${editable ? "edit" : ""}">${[["0", "Weekday"], ["1", "Weekend"]].map(([v, l]) => `<button type="button" data-opt="profile" data-v="${v}" class="${String(o.profile) === v ? "on" : ""}"${dis}>${l}</button>`).join("")}</div></div>
      <label class="switch"><span>Include buses in trips<br><span class="small muted">Loads more data, a bit slower</span></span><input type="checkbox" data-opt="buses" ${o.buses ? "checked" : ""}${dis}></label>
      <div class="field"><label>Longest trip allowed: <span class="muted">${o.maxmin ? o.maxmin + " min" : "no limit"}</span></label>
        <input type="range" data-opt="maxmin" min="0" max="120" step="5" value="${o.maxmin}"${dis}></div>
      <div class="field"><label>Prefer places with restaurants${restaurants ? "" : ' <span class="muted">(data not built yet)</span>'}</label>
        <input type="range" data-opt="restw" min="0" max="1" step="0.25" value="${o.restw}"${restaurants && editable ? "" : " disabled"}></div>
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
    clearInterval(pollTimer); S.ev = null; S.admin = null; S.mine = {}; S.editing = null; S.draft = blankDraft();
    document.title = "Meet Point"; clearResult(); renderMarkers(); renderDraftMarker();
    const evs = Object.entries(store().events).filter(([, e]) => e.title);
    $("view").innerHTML = `
      <section><h2>Plan a meet-up</h2>
        <div class="card stack">
          <div class="field"><label for="f-title">Event name</label><input id="f-title" class="input" maxlength="80" placeholder="Friday dinner" value="${esc(S.title)}"></div>
          <div id="home-opts">${optionsHTML(S.draftOpts, true)}</div>
          <button id="create" class="btn primary block">Create event</button>
        </div>
        ${S.api ? '<p class="small muted">You get a link to send around. Everyone who opens it adds their own position, and the best meeting point updates live.</p>' : ""}
      </section>
      ${evs.length ? `<section><h2>Your events</h2><ul class="stack" style="gap:8px">${evs.map(([id, e]) => `<li><button class="btn block" data-open="${id}" style="justify-content:space-between"><span>${esc(e.title)}</span><span class="muted small">${e.admin ? "organizer" : "guest"}</span></button></li>`).join("")}</ul></section>` : ""}`;
  }

  function showEvent() {
    document.title = S.ev.title + " · Meet Point";
    $("view").innerHTML = `
      <section id="v-head"></section>
      <section id="v-people-sec"><h2>People <span id="count" class="muted"></span></h2><ul id="people"></ul></section>
      <section id="v-results" hidden><h2>Best meeting points</h2><div id="cards"></div><div id="places"></div></section>
      <section id="v-add"></section>
      <section id="v-opts"><h2>Settings</h2><div class="card" id="opts-body"></div></section>
      ${S.admin ? '<section><button id="del" class="btn danger sm" style="align-self:flex-start">Delete this event</button></section>' : ""}`;
    renderHead(); renderPeople(); renderAdd(); renderOpts();
    clearInterval(pollTimer); pollTimer = setInterval(poll, 10000);
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
  function renderPeople() {
    const ps = S.ev.people;
    $("count").textContent = `${ps.length}/10`;
    $("people").innerHTML = ps.length ? ps.map((p, i) => {
      const mine = isMine(p), open = S.editing === p.id;
      return `<li class="card person" data-pid="${p.id}">
        <span class="dot" style="background:${COLORS[i]}"></span>
        <div class="nm"><span>${esc(p.name)}</span>${mine ? '<span class="you">you</span>' : ""}</div>
        <div class="acts row">${mine ? `<button class="btn sm" data-act="edit">${open ? "Done" : "Edit"}</button>` : ""}${S.admin && !mine ? '<button class="btn ghost sm" data-act="remove" title="Remove this person">Remove</button>' : ""}</div>
        <div class="ad">${esc(p.addr || p.lat.toFixed(4) + ", " + p.lon.toFixed(4))}</div>
        ${open ? `<div class="more">
          <div class="field"><label>Name</label><input class="input" data-f="name" maxlength="40" value="${esc(p.name)}"></div>
          <div class="field"><label>Travels by</label><div class="chips">${MODES.map(([k, l]) => `<button type="button" class="chip ${p.modes[k] ? "on" : ""}" data-m="${k}" aria-pressed="${!!p.modes[k]}">${l}</button>`).join("")}</div></div>
          <div class="field"><label>Weight in "Fastest overall" and "Balanced"</label><select class="select" data-f="weight">${[1, 2, 3].map((w) => `<option value="${w}"${p.weight === w ? " selected" : ""}>×${w}</option>`).join("")}</select></div>
          <p class="small muted">Drag the numbered pin on the map to move this position.</p>
          <button class="btn danger sm" data-act="leave" style="align-self:flex-start">Remove this entry</button>
        </div>` : `<div class="chips" style="grid-column:2/-1;margin-top:6px">${MODES.filter(([k]) => p.modes[k]).map(([, l]) => `<span class="chip static">${l}</span>`).join("")}</div>`}
      </li>`;
    }).join("") : '<li class="empty">Nobody yet. Add the first position below.</li>';
    renderMarkers();
  }
  let addKey = "";
  const addState = () => (S.ev.people.length >= 10) + ":" + Object.keys(S.mine).some((pid) => S.ev.people.some((p) => p.id === pid));
  function renderAddIfNeeded() {                        // the add form only depends on these two facts, so typing in it is never interrupted
    if (addState() !== addKey) renderAdd();
  }
  function renderAdd() {
    addKey = addState();
    const d = S.draft, hasMine = Object.keys(S.mine).some((pid) => S.ev.people.some((p) => p.id === pid));
    if (S.ev.people.length >= 10) { $("v-add").innerHTML = '<div class="msg">This event is full (10 people).</div>'; return; }
    $("v-add").innerHTML = `<h2>${hasMine ? "Add someone else" : "Add your position"}</h2>
      <div class="card stack">
        <div class="field"><label for="d-name">${hasMine ? "Their name" : "Your name"}</label><input id="d-name" class="input" maxlength="40" placeholder="${hasMine ? "Name" : "Your name"}" value="${esc(d.name)}"></div>
        <div class="field"><label for="d-addr">Where from</label>
          <div class="searchbox"><input id="d-addr" class="input" autocomplete="off" placeholder="Type an address in Île-de-France…"><ul id="suggest" hidden></ul></div>
          <div class="row"><button type="button" class="btn sm" id="d-pick">${S.picking ? "Click on the map…" : "Pick on map"}</button><button type="button" class="btn sm" id="d-geo">Use my location</button></div>
          ${d.lat !== null ? `<div class="placed"><span class="dot"></span><span class="grow">${esc(d.addr || "Pin placed")}</span></div>` : ""}</div>
        <div class="field"><label>Travels by</label><div class="chips">${MODES.map(([k, l]) => `<button type="button" class="chip ${d.modes[k] ? "on" : ""}" data-dm="${k}" aria-pressed="${!!d.modes[k]}">${l}</button>`).join("")}</div></div>
        <button id="d-add" class="btn primary block"${d.lat !== null && d.name.trim() ? "" : " disabled"}>Add to the event</button>
      </div>`;
  }
  function renderOpts() {
    $("opts-body").innerHTML = optionsHTML(S.ev.options, !!S.admin) + (S.admin ? "" : '<p class="small muted" style="margin-top:10px">Only the organizer can change these.</p>');
  }

  /* ---------- markers ---------- */
  function pinIcon(label, color, cls) {
    return L.divIcon({ className: "", iconSize: [28, 28], iconAnchor: [14, 28], html: `<div class="pin ${cls || ""}" style="background:${color}"><span>${label}</span></div>` });
  }
  function renderMarkers() {
    markers.forEach((m) => m.remove());
    markers = (S.ev ? S.ev.people : []).map((p, i) => {
      const mine = isMine(p);
      const m = L.marker([p.lat, p.lon], { draggable: mine, icon: pinIcon(i + 1, COLORS[i], mine ? "mine" : ""), title: p.name }).addTo(map);
      m.bindTooltip(p.name, { direction: "top", offset: [0, -26] });
      if (mine) m.on("dragend", (e) => { const ll = e.target.getLatLng(); movePerson(p, ll.lat, ll.lng); });
      return m;
    });
  }
  function renderDraftMarker() {
    if (draftMarker) { draftMarker.remove(); draftMarker = null; }
    const d = S.draft; if (d.lat === null) return;
    draftMarker = L.marker([d.lat, d.lon], { draggable: true, icon: pinIcon("+", "var(--card)", "draft") }).addTo(map);
    draftMarker.on("dragend", (e) => { const ll = e.target.getLatLng(); setDraftPosition(ll.lat, ll.lng, "", true); });
  }

  /* ---------- address search, reverse geocoding ---------- */
  async function reverse(lat, lon) {
    try { const r = await (await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`, { signal: AbortSignal.timeout(4000) })).json(); return r.features[0] ? r.features[0].properties.label : "Dropped pin"; }
    catch (e) { return "Dropped pin"; }
  }
  async function setDraftPosition(lat, lon, addr, keepView) {
    Object.assign(S.draft, { lat, lon, addr: addr || "Locating…" }); renderAdd(); renderDraftMarker();
    if (!keepView) map.panTo([lat, lon]);
    if (!addr) { const a = await reverse(lat, lon); if (S.draft.lat === lat) { S.draft.addr = a; renderAdd(); } }
  }
  function setPicking(on) { S.picking = on; document.body.classList.toggle("picking", on); if (S.ev) renderAdd(); }
  function suggest(q) {
    clearTimeout(suggTimer);
    if (q.length < 3) return ($("suggest").hidden = true);
    suggTimer = setTimeout(async () => {
      try {
        const r = await (await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=6&lat=48.85&lon=2.35`, { signal: AbortSignal.timeout(5000) })).json();
        sugg = r.features.filter((f) => IDF.test(f.properties.postcode || "")).slice(0, 5);
        const box = $("suggest"); if (!box) return;
        box.innerHTML = sugg.map((f, i) => `<li data-i="${i}">${esc(f.properties.label)}</li>`).join(""); box.hidden = !sugg.length;
      } catch (e) { const b = $("suggest"); if (b) b.hidden = true; }
    }, 220);
  }

  /* ---------- actions on the event ---------- */
  async function addPerson() {
    const d = S.draft;
    try {
      const r = await Api.post({ action: "join", id: S.ev.id, p: { name: d.name.trim(), addr: d.addr, lat: d.lat, lon: d.lon, modes: d.modes, weight: 1 } });
      S.mine[r.pid] = r.token; setLocal(S.ev.id, { mine: S.mine });
      S.draft = Object.assign(blankDraft(), { modes: d.modes }); renderDraftMarker();
      await refresh(); notice("Added.", "ok");
    } catch (e) { notice("Could not add: " + e.message, "warn"); }
  }
  async function savePerson(p) {
    try { await Api.post({ action: "update", id: S.ev.id, pid: p.id, token: S.mine[p.id], p }); }
    catch (e) { notice("Could not save: " + e.message, "warn"); }
    scheduleSolve();
  }
  async function movePerson(p, lat, lon) {
    p.lat = lat; p.lon = lon; p.addr = "Locating…"; renderPeople(); savePerson(p);
    p.addr = await reverse(lat, lon); renderPeople(); savePerson(p);
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
    showEvent(); renderDraftMarker(); lastSig = ""; scheduleSolve(true);
    fitView();
  }
  async function refresh() {
    S.ev = await Api.get(S.ev.id);
    S.mine = Object.fromEntries(Object.entries(S.mine).filter(([pid]) => S.ev.people.some((p) => p.id === pid)));
    renderPeople(); renderAdd(); renderOpts(); renderHead(); scheduleSolve();
  }
  async function poll() {
    if (!S.ev || document.hidden || optTimer) return;
    const focus = document.activeElement, inside = (sel) => focus && focus.closest && focus.closest(sel);
    try {
      const e = await Api.get(S.ev.id, S.ev.rev); if (e.unchanged) return;
      S.ev = e; S.mine = Object.fromEntries(Object.entries(S.mine).filter(([pid]) => e.people.some((p) => p.id === pid)));
      if (!inside(".more")) renderPeople();            // keep the edit panel alone while someone types in it
      if (!inside("#opts-body")) renderOpts();
      renderAddIfNeeded(); scheduleSolve();
    } catch (err) { if (/not found/.test(err.message)) { notice("This event was deleted.", "warn"); showHome(); } }
  }

  /* ---------- solving and results ---------- */
  async function getNet(o) {
    const key = o.profile + (o.buses ? "b" : "r");
    if (nets[key]) return nets[key];
    let g = graphBase;
    if (o.buses) {
      if (!graphBus) { notice("Loading the bus network…"); graphBus = await (await fetch("data/graph-bus.json")).json(); notice(""); }
      g = MP.mergeGraph(graphBase, graphBus);
    }
    return (nets[key] = new MP.Network(g, o.profile));
  }
  function scheduleSolve(force) { clearTimeout(solveTimer); solveTimer = setTimeout(() => solveNow(force), 150); }
  async function solveNow(force) {
    if (!S.ev || !graphBase) return;
    const o = S.ev.options, ps = S.ev.people;
    const sig = JSON.stringify([ps.map((p) => [p.lat, p.lon, p.modes, p.weight]), o]);
    if (sig === lastSig && !force) return; lastSig = sig;
    const sec = $("v-results"); if (!sec) return; sec.hidden = false;
    if (ps.length < 2) { clearResult(); $("cards").innerHTML = '<div class="empty">Add at least two people to see the best meeting point.</div>'; return; }
    let net; try { net = await getNet(o); } catch (e) { return notice("Could not load the bus network. Turn buses off or run tools/build_bus.py.", "warn"); }
    const keep = result && result.top[selected] ? result.top[selected].c : null;
    result = MP.solve(net, ps, { objective: o.objective, maxMinutes: o.maxmin, restaurantWeight: o.restw, restaurants, top: 3 });
    result.net = net;
    if (!result.top.length) { clearResult(); $("cards").innerHTML = '<div class="empty">No meeting point is reachable for everyone. Check that each person can reach the rail network with a mode they ticked.</div>'; return; }
    const same = result.top.findIndex((r) => r.c === keep);
    result.relaxedLimit = result.relaxed ? o.maxmin : 0;
    renderCards(); select(same >= 0 ? same : 0);
  }
  function clearResult() {
    result = null; token++; $("player").hidden = true; flow.setRoutes([], null); flow.pause();
    if (targetMarker) { targetMarker.remove(); targetMarker = null; }
    const p = $("places"); if (p) p.innerHTML = "";
  }
  function renderCards() {
    const relaxedLimit = result.relaxedLimit;
    const st = result.net.graph.stations;
    $("cards").innerHTML = (relaxedLimit ? `<div class="msg warn">Nobody could stay under ${relaxedLimit} min. Showing the closest options.</div>` : "") +
      result.top.map((r, k) => `
      <div class="card res ${k === selected ? "on" : ""}" data-k="${k}" role="button" tabindex="0">
        <div class="t"><b>${esc(st[r.c][1])}</b><span class="rank">#${k + 1}</span></div>
        <div class="times">${S.ev.people.map((p, i) => `
          <span style="color:${COLORS[i]}">●</span><span class="bar" title="${esc(p.name)}"><i style="width:${Math.min(100, r.times[i] / (r.max || 1) * 100)}%;background:${COLORS[i]}"></i></span><span data-t="${k}-${i}">${Math.round(r.times[i])} min</span>`).join("")}</div>
        <div class="meta">Longest ${Math.round(r.max)} min · average ${Math.round(r.sum / r.times.length)} min${restaurants ? ` · ${r.rest} places to eat nearby` : ""}</div>
      </div>`).join("");
  }

  /* ---------- selection, routes, animation ---------- */
  async function select(k) {
    selected = k; const my = ++token, r = result.top[k], st = result.net.graph.stations[r.c], ps = S.ev.people;
    document.querySelectorAll("#cards .res").forEach((el) => el.classList.toggle("on", +el.dataset.k === k));
    const routes = ps.map((p, i) => ({ name: p.name, color: COLORS[i], legs: MP.itinerary(result.net, result.per[i], r.c) }));
    const target = [st[2], st[3]];
    if (targetMarker) targetMarker.remove();
    targetMarker = L.marker(target, { icon: L.divIcon({ className: "", html: '<div class="target">★</div>', iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 1000 }).addTo(map).bindTooltip(st[1], { direction: "top", offset: [0, -18] });
    fitView();
    $("player").hidden = false; flow.setRoutes(routes, target); flow.play();
    loadPlaces(st);
    await refine(routes, my);                          // real street geometry for walk/bike/car legs
    if (my !== token) return;
    const wasPlaying = flow.playing, t = flow.t / (flow.T || 1);
    flow.setRoutes(routes, target); flow.seek(t); if (wasPlaying) flow.play();
    // street routes change the estimates: update the card so its numbers match the animation
    r.times = routes.map((rt) => rt.legs.reduce((s, l) => s + (l.wait || 0) + l.sec, 0) / 60);
    r.max = Math.max(...r.times); r.sum = r.times.reduce((a, b) => a + b, 0);
    renderCards();
  }
  const OSRM = { walk: "routed-foot", bike: "routed-bike", car: "routed-car" };
  async function refine(routes, my) {
    const jobs = [];
    for (const rt of routes) for (const leg of rt.legs) if (OSRM[leg.mode] && leg.label === leg.mode) jobs.push(leg);
    let next = 0;
    const worker = async () => {
      while (next < jobs.length && my === token) {
        const leg = jobs[next++], [a, b] = leg.coords;
        try {
          const j = await (await fetch(`https://routing.openstreetmap.de/${OSRM[leg.mode]}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`)).json(), rte = j.routes && j.routes[0];
          if (rte) { leg.coords = rte.geometry.coordinates.map((c) => [c[1], c[0]]); leg.sec = rte.duration + (leg.mode === "bike" ? 180 : leg.mode === "car" ? 480 : 0); }
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
    if (t.id === "d-pick") return setPicking(!S.picking);
    if (t.id === "d-geo") return geolocate();
    if (t.id === "d-add") return addPerson();
    if (t.dataset.dm) { S.draft.modes[t.dataset.dm] = !S.draft.modes[t.dataset.dm]; return renderAdd(); }
    if (t.closest("#suggest") && t.dataset.i !== undefined) {
      const f = sugg[+t.dataset.i]; $("suggest").hidden = true;
      return setDraftPosition(f.geometry.coordinates[1], f.geometry.coordinates[0], f.properties.label);
    }
    if (t.classList.contains("res")) return select(+t.dataset.k);
    const li = t.closest(".person"); const p = li && S.ev.people.find((x) => x.id === li.dataset.pid);
    if (p && t.dataset.act === "edit") { S.editing = S.editing === p.id ? null : p.id; return renderPeople(); }
    if (p && (t.dataset.act === "remove" || t.dataset.act === "leave")) return removePerson(p);
    if (p && t.dataset.m) { p.modes[t.dataset.m] = !p.modes[t.dataset.m]; renderPeople(); return savePerson(p); }
    if (t.dataset.opt) {                               // option buttons (organizer or home form)
      const o = S.ev ? S.ev.options : S.draftOpts; if (S.ev && !S.admin) return;
      readOpt(t, o); return S.ev ? (renderOpts(), saveOptionsSoon(), scheduleSolve()) : (document.getElementById("home-opts").innerHTML = optionsHTML(S.draftOpts, true));
    }
  });
  view.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "f-title") S.title = t.value;
    else if (t.id === "d-name") { S.draft.name = t.value; const b = $("d-add"); if (b) b.disabled = !(S.draft.lat !== null && t.value.trim()); }
    else if (t.id === "d-addr") suggest(t.value.trim());
    else if (t.id === "ev-title" && S.admin) { S.ev.title = t.value; saveOptionsSoon(); }
    else if (t.dataset.opt && t.type === "range") {      // live label while dragging, apply on release
      const o = S.ev ? S.ev.options : S.draftOpts; readOpt(t, o);
      const lab = t.closest(".field").querySelector("label span.muted"); if (lab && t.dataset.opt === "maxmin") lab.textContent = o.maxmin ? o.maxmin + " min" : "no limit";
    }
  });
  view.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.opt) {
      const o = S.ev ? S.ev.options : S.draftOpts; if (S.ev && !S.admin) return;
      readOpt(t, o); if (S.ev) { saveOptionsSoon(); scheduleSolve(); renderOpts(); }
    } else if (t.dataset.f) {
      const li = t.closest(".person"), p = S.ev.people.find((x) => x.id === li.dataset.pid); if (!p) return;
      p[t.dataset.f] = t.dataset.f === "weight" ? +t.value : t.value.trim() || p.name; savePerson(p); renderPeople();
    }
  });

  function geolocate() {
    if (!navigator.geolocation) return notice("Location is not available in this browser.", "warn");
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: la, longitude: lo } = pos.coords;
      if (la < 47.9 || la > 49.5 || lo < 1.2 || lo > 3.9) return notice("Your location is outside Île-de-France.", "warn");
      setDraftPosition(la, lo, "");
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
    notice(""); setPicking(false);
    const q = new URLSearchParams(location.search), id = q.get("e");
    if (id && q.get("k")) { setLocal(id, { admin: q.get("k") }); history.replaceState(null, "", "?e=" + id); }
    return id ? openEvent(id) : showHome();
  }
  document.addEventListener("click", (e) => { const b = $("suggest"); if (b && !b.contains(e.target) && e.target.id !== "d-addr") b.hidden = true; });

  /* ---------- boot ---------- */
  (async function () {
    base.setStations({ stations: [], lnodes: [] });
    loadBasemap(); renderLegend();
    const ping = await Api.ping(); S.api = ping.ok;
    try {
      const [g, rest] = await Promise.all([fetch("data/graph.json").then((r) => r.json()), fetch("data/restaurants.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
      graphBase = g; base.setStations(g);
      if (rest) restaurants = Int32Array.from(g.stations, (s) => rest[s[0]] || 0);
    } catch (e) { notice("Could not load data/graph.json. Run tools/build_graph.py first.", "warn"); }
    await route();
    if (!S.api) notice(`Can't reach the event server (${ping.why}). Serve this folder with PHP (see README). If it is running, a content blocker may be blocking api/meetup.php.`, "warn");
  })();
})();
