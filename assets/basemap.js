/* Abstract basemap: no tiles. Draws parks, water, roads, rail lines in their official colours,
   optional bus lines, stations and town names on a canvas under the Leaflet panes.
   Needs the Leaflet map to use zoomAnimation:false (the canvas redraws on every move). */
(function (root) {
  "use strict";
  const merc = (lat, lon) => [(lon + 180) / 360, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2];
  const project = merc;

  class Basemap {
    constructor(map) {
      this.map = map;
      this.layers = { green: [], water: [], roads: [], bus: [], rail: [] };
      this.tiers = [[], [], [], []];                      // roads by importance, 0 = motorway
      this.stations = []; this.places = [];
      this.show = { roads: true, bus: false, food: true };
      this.poisRaw = null; this.pois = []; this.cells = []; this.parkNames = [];
      const cv = this.cv = document.createElement("canvas");
      Object.assign(cv.style, { position: "absolute", left: "0", top: "0", zIndex: 1, pointerEvents: "none", willChange: "transform" });
      map.getContainer().prepend(cv);
      this.ctx = cv.getContext("2d");
      this.cur = null; this.raf = 0;
      // Smooth panning: the canvas is bigger than the view (PAD on each side) and is only moved by the
      // browser while dragging. The map is repainted once the move ends, or when the zoom changes.
      map.on("move", () => this.follow());
      map.on("moveend", () => this.settle());
      map.on("zoomend viewreset resize", () => this.schedule());
      addEventListener("resize", () => this.schedule());
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.schedule());
    }
    schedule() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
    /* after a drag: repaint only if more than half of the margin is used, so short drags never repaint at all */
    settle() {
      const c = this.cur; if (!c) return this.schedule();
      const b = this.map.getPixelBounds(), dx = c.ox - Math.round(b.min.x), dy = c.oy - Math.round(b.min.y);
      if (this.map.getZoom() !== c.z || Math.abs(dx) > c.padx / 2 || Math.abs(dy) > c.pady / 2) this.schedule();
    }
    /* while panning: slide the already painted canvas; repaint only if its margin is used up */
    follow() {
      const c = this.cur; if (!c) return this.schedule();
      const b = this.map.getPixelBounds(), dx = c.ox - Math.round(b.min.x), dy = c.oy - Math.round(b.min.y);
      if (this.map.getZoom() !== c.z || Math.abs(dx) > c.padx - 8 || Math.abs(dy) > c.pady - 8) return this.schedule();
      this.cv.style.transform = `translate3d(${dx}px,${dy}px,0)`;
    }

    /* flats: array of [lat, lon, lat, lon, ...]; style.fill=true draws them as filled polygons */
    addLines(layer, flats, style) {
      for (const raw of flats) {
        const it = Object.assign({ rings: [raw] }, style); this.build(it); this.layers[layer].push(it);
        if (layer === "roads") this.tiers[it.tier].push(it);
      }
    }
    /* polygons: array of [outerFlat, holeFlat, ...]; filled with the even-odd rule so holes (islands, ponds) stay empty */
    addPolys(layer, polys, style) {
      for (let rings of polys) { if (typeof rings[0] === "number") rings = [rings]; const it = Object.assign({ rings, fill: true }, style); this.build(it); this.layers[layer].push(it); }
    }
    build(it) {
      let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
      it.parts = it.rings.map((raw, r) => {
        const n = raw.length / 2, out = [];
        const push = (la, lo) => {
          const [x, y] = project(la, lo); out.push(x, y);
          if (r === 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }   // holes lie inside the outer ring
        };
        for (let i = 0; i < n; i++) {
          push(raw[2 * i], raw[2 * i + 1]);
        }
        return Float32Array.from(out);
      });
      it.bb = [x0, y0, x1, y1];
    }
    setStations(graph) {
      const R = graph.railCount || graph.stations.length, deg = new Map();
      for (const ln of graph.lnodes) if (ln[0] < R) { (deg.get(ln[0]) || deg.set(ln[0], new Set()).get(ln[0])).add(ln[1]); }
      this.stationsRaw = graph.stations.slice(0, R).map((s, i) => ({ lat: s[2], lon: s[3], name: s[1], deg: deg.has(i) ? deg.get(i).size : 1 }));
      this.rebuildPoints(); this.draw();
    }
    setPlaces(list) { this.placesRaw = list; this.rebuildPoints(); this.draw(); }
    setParkNames(list) { this.parkRaw = list; this.rebuildPoints(); this.draw(); }
    /* pois: {r: [[lat, lon, name]], c: [...], b: [...]} restaurants, cafés, bars */
    setPois(pois) {
      this.poisRaw = [];
      for (const t of ["r", "c", "b"]) for (const p of pois[t] || []) this.poisRaw.push({ lat: p[0], lon: p[1], name: p[2], t });
      this.rebuildPoints(); this.draw();
    }
    /* places to eat or drink within r metres of a point, nearest first */
    nearby(lat, lon, r) {
      const out = [];
      for (const p of this.poisRaw || []) {
        const d = Math.hypot((p.lat - lat) * 111320, (p.lon - lon) * 73000);
        if (d <= r && p.name) out.push({ name: p.name, t: p.t, d });
      }
      return out.sort((a, b) => a.d - b.d);
    }
    rebuildPoints() {
      this.stations = (this.stationsRaw || []).map((s) => { const [x, y] = project(s.lat, s.lon); return { x, y, name: s.name, deg: s.deg }; }).sort((a, b) => b.deg - a.deg);
      this.places = (this.placesRaw || []).map((p) => { const [x, y] = project(p[1], p[2]); return { x, y, name: p[0], kind: p[3] }; });
      this.parkNames = (this.parkRaw || []).map((p) => { const [x, y] = project(p[1], p[2]); return { x, y, name: p[0], a: p[3] }; });
      // food density: ~250 m cells, so zoomed-out views still say where the places to eat are
      const cells = new Map();
      for (const p of this.poisRaw || []) { const k = Math.round(p.lat * 400) + "," + Math.round(p.lon * 270); const c = cells.get(k) || cells.set(k, { n: 0, la: Math.round(p.lat * 400) / 400, lo: Math.round(p.lon * 270) / 270 }).get(k); c.n++; }
      this.cells = [...cells.values()].map((c) => { const [x, y] = project(c.la, c.lo); return { x, y, n: c.n, lv: Math.min(5, Math.floor(c.n / 2)) }; });
      this.pois = (this.poisRaw || []).map((p) => { const [x, y] = project(p.lat, p.lon); return { x, y, name: p.name, t: p.t }; });
    }
    colors() {
      const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
      return { bg: v("--map-bg"), water: v("--map-water"), green: v("--map-green"), greenInk: v("--map-green-ink"), food: v("--map-food"), poi: { r: v("--poi-r"), c: v("--poi-c"), b: v("--poi-b") }, road: v("--map-road"), roadCase: v("--map-road-case"), roadMajor: v("--map-road-major"), bus: v("--map-bus"), ink: v("--ink"), muted: v("--muted") };
    }

    draw() {
      const map = this.map, size = map.getSize(), d = devicePixelRatio || 1, cv = this.cv;
      const padx = Math.round(size.x * 0.2), pady = Math.round(size.y * 0.2), W = size.x + 2 * padx, H = size.y + 2 * pady;
      const z = map.getZoom(), S = 256 * Math.pow(2, z), b = map.getPixelBounds();
      const ox0 = Math.round(b.min.x), oy0 = Math.round(b.min.y), ox = ox0 - padx, oy = oy0 - pady;
      this.cur = { z, ox: ox0, oy: oy0, padx, pady };
      if (cv.width !== Math.round(W * d) || cv.height !== Math.round(H * d)) { cv.width = Math.round(W * d); cv.height = Math.round(H * d); }
      Object.assign(cv.style, { width: W + "px", height: H + "px", left: -padx + "px", top: -pady + "px", transform: "translate3d(0,0,0)" });
      const ctx = this.ctx, c = this.colors(); ctx.setTransform(d, 0, 0, d, 0, 0);
      map.getContainer().style.background = c.bg;           // what shows at the edge while a fast drag outruns the margin
      ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
      const view = [ox / S, oy / S, (ox + W) / S, (oy + H) / S], size2 = { x: W, y: H };
      const k = Math.min(2.2, Math.max(0.55, 0.55 + (z - 9) * 0.2));     // line width scale with zoom
      ctx.lineCap = "round"; ctx.lineJoin = "round";

      const visible = (it, minPx) => !(it.bb[2] < view[0] || it.bb[0] > view[2] || it.bb[3] < view[1] || it.bb[1] > view[3]) &&
        !(minPx && (it.bb[2] - it.bb[0]) * S < minPx && (it.bb[3] - it.bb[1]) * S < minPx);
      const addPath = (it, close) => {
        for (const p of it.parts) {
          let lx = 1e9, ly = 1e9;
          for (let i = 0; i < p.length; i += 2) {
            const x = p[i] * S - ox, y = p[i + 1] * S - oy;
            if (i && i < p.length - 2 && Math.abs(x - lx) + Math.abs(y - ly) < 1.5) continue;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); lx = x; ly = y;
          }
          if (close) ctx.closePath();
        }
      };
      const fills = (items, color, minArea) => {
        ctx.fillStyle = color;
        for (const it of items) {
          if (!visible(it) || (minArea && (it.bb[2] - it.bb[0]) * S < minArea)) continue;
          ctx.beginPath(); addPath(it, true); ctx.fill("evenodd");
        }
      };
      // one path and one stroke for a whole group of lines of the same style: thousands of strokes were the cost
      const stroke = (items, color, w, minPx) => {
        ctx.beginPath();
        for (const it of items) if (visible(it, minPx)) addPath(it);
        ctx.strokeStyle = color; ctx.lineWidth = w * k; ctx.stroke();
      };
      const each = (items, filter) => {                    // lines with their own colour (rail): one stroke per line
        for (const it of items) { if (!visible(it) || !filter(it)) continue; ctx.beginPath(); addPath(it); ctx.strokeStyle = it.color; ctx.lineWidth = it.w * k; ctx.stroke(); }
      };

      fills(this.layers.green, c.green, 3);
      fills(this.layers.water.filter((i) => i.fill), c.water, 2);
      stroke(this.layers.water.filter((i) => !i.fill), c.water, 5);
      if (this.show.roads) {
        const T = this.tiers;
        if (z >= 14) stroke(T[3], c.road, 0.9, 3);
        if (z >= 12.5) stroke(T[2], c.road, 1.1, 3);
        ctx.lineJoin = "bevel"; ctx.lineCap = "butt";      // round joins and caps are the slow part of stroking
        if (z >= 12) stroke(T[1].concat(T[0]), c.roadCase, 4.2);   // outline only when zoomed in enough to see it
        stroke(T[0], c.roadMajor, 2.6);
        if (z >= 9.5) stroke(T[1], c.roadMajor, 1.5);
        ctx.lineJoin = "round"; ctx.lineCap = "round";
      }
      if (this.show.bus && z >= 10) stroke(this.layers.bus, c.bus, 1);
      for (const m of [3, 0, 2, 1]) each(this.layers.rail, (it) => it.mode === m);

      if (this.show.food) this.food(ctx, c, z, S, ox, oy, view, size2);
      this.labels(ctx, c, z, S, ox, oy, view, size2);
    }

    food(ctx, c, z, S, ox, oy, view, size) {
      const inView = (p) => p.x >= view[0] && p.x <= view[2] && p.y >= view[1] && p.y <= view[3];
      if (z < 14.5) {                                     // soft density glow: drawn at 1/4 size, then scaled up so it blurs
        const sz = size, q = 6, w = Math.ceil(sz.x / q), h = Math.ceil(sz.y / q);
        const off = this.off || (this.off = document.createElement("canvas")); off.width = w; off.height = h;
        const o = off.getContext("2d"), mpp = 156543 * 0.658 / Math.pow(2, z), rad = Math.max(1.5, 330 / mpp / q);
        o.fillStyle = c.food;
        for (let lv = 0; lv < 6; lv++) {                   // cells grouped by density level: 6 fills instead of thousands
          o.globalAlpha = 0.08 + 0.4 * (1 - Math.exp(-(lv + 0.5) * 2 / 10)); o.beginPath();
          for (const cell of this.cells) {
            if (cell.lv !== lv || !inView(cell)) continue;
            const x = (cell.x * S - ox) / q, y = (cell.y * S - oy) / q; o.moveTo(x + rad, y); o.arc(x, y, rad, 0, 7);
          }
          o.fill();
        }
        ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "low";
        ctx.globalAlpha = Math.max(0.06, 0.26 - Math.max(0, z - 11.5) * 0.12);
        ctx.drawImage(off, 0, 0, w * q, h * q); ctx.restore();
        return;
      }
      const r = z >= 16 ? 3.6 : 2.6;
      for (const p of this.pois) {
        if (!inView(p)) continue;
        ctx.beginPath(); ctx.arc(p.x * S - ox, p.y * S - oy, r, 0, 7);
        ctx.fillStyle = c.poi[p.t]; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = c.bg; ctx.stroke();
      }
    }

    labels(ctx, c, z, S, ox, oy, view, size) {
      const boxes = [], halo = (t, x, y, color) => { ctx.lineWidth = 3.5; ctx.strokeStyle = c.bg; ctx.strokeText(t, x, y); ctx.fillStyle = color; ctx.fillText(t, x, y); };
      const free = (box) => !boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]);
      ctx.textBaseline = "middle"; ctx.textAlign = "left";
      // towns first: big muted names, they give the map its orientation
      for (const p of this.places) {
        if (p.x < view[0] || p.x > view[2] || p.y < view[1] || p.y > view[3]) continue;
        const city = p.kind === "city"; if (!city && z < 10.5) continue; if (!city && z > 14) continue;
        ctx.font = (city ? "700 14px" : "600 12px") + " Inter, system-ui, sans-serif";
        const x = p.x * S - ox, y = p.y * S - oy, w = ctx.measureText(p.name).width, box = [x - w / 2 - 3, y - 8, x + w / 2 + 3, y + 8];
        if (!free(box)) continue; boxes.push(box);
        ctx.textAlign = "center"; halo(city ? p.name.toUpperCase() : p.name, x, y, c.muted); ctx.textAlign = "left";
      }
      // parks and forests
      ctx.font = "italic 600 11.5px Inter, system-ui, sans-serif"; ctx.textAlign = "center";
      for (const p of this.parkNames) {
        if (p.x < view[0] || p.x > view[2] || p.y < view[1] || p.y > view[3]) continue;
        if (z < (p.a >= 1 ? 11.5 : p.a >= 0.35 ? 13 : 14.5)) continue;
        const x = p.x * S - ox, y = p.y * S - oy, w = ctx.measureText(p.name).width, box = [x - w / 2 - 3, y - 8, x + w / 2 + 3, y + 8];
        if (!free(box)) continue; boxes.push(box); halo(p.name, x, y, c.greenInk);
      }
      ctx.textAlign = "left";
      // names of places to eat, once zoomed right in
      if (this.show.food && z >= 16) {
        ctx.font = "500 10.5px Inter, system-ui, sans-serif";
        for (const p of this.pois) {
          if (!p.name || p.x < view[0] || p.x > view[2] || p.y < view[1] || p.y > view[3]) continue;
          const x = p.x * S - ox + 6, y = p.y * S - oy, w = ctx.measureText(p.name).width, box = [x - 2, y - 7, x + w + 2, y + 7];
          if (!free(box)) continue; boxes.push(box); halo(p.name, x, y, c.muted);
        }
      }
      // stations
      const showAll = z >= 12, r = Math.min(5.5, 2.2 + (z - 10) * 0.55);
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      for (const s of this.stations) {
        if (s.x < view[0] || s.x > view[2] || s.y < view[1] || s.y > view[3]) continue;
        if (!showAll && s.deg < 3) continue;
        if (z < 10.5 && s.deg < 4) continue;
        const x = s.x * S - ox, y = s.y * S - oy, big = s.deg >= 3;
        ctx.beginPath(); ctx.arc(x, y, big ? r + 1.2 : r, 0, 7);
        ctx.fillStyle = c.bg; ctx.fill(); ctx.lineWidth = big ? 2.2 : 1.6; ctx.strokeStyle = c.ink; ctx.stroke();
        const want = z >= 14 || (z >= 13 && s.deg >= 2) || (z >= 12 && s.deg >= 3);
        if (!want) continue;
        const w = ctx.measureText(s.name).width, bx = x + r + 4, box = [bx - 2, y - 7, bx + w + 2, y + 7];
        if (!free(box)) continue; boxes.push(box); halo(s.name, bx, y, c.ink);
      }
    }
  }
  root.Basemap = Basemap;
})(window);
