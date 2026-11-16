/* Flow animation: everybody travels to the meeting point on a shared clock.
   Canvas overlay on a Leaflet map. Usage:
     const f = new Flow(map, canvas, {onTick(t, T, playing)});
     f.setRoutes([{color, name, legs:[{mode,color,coords,sec,wait}]}], [lat,lon]); f.play();
     Each person ends at the last point of their last leg, so the way back can end at different places. */
(function (root) {
  "use strict";
  const MODE_COLOR = { walk: "#8793a0", bike: "#2e9e5b", car: "#60666d" };

  function plen(c) {                                   // cumulative planar-ish lengths (deg, scaled)
    const out = [0];
    for (let i = 1; i < c.length; i++) {
      const dy = c[i][0] - c[i - 1][0], dx = (c[i][1] - c[i - 1][1]) * Math.cos(c[i][0] * Math.PI / 180);
      out.push(out[i - 1] + Math.hypot(dx, dy));
    }
    return out;
  }

  class Flow {
    constructor(map, canvas, opts) {
      this.map = map; this.cv = canvas; this.ctx = canvas.getContext("2d");
      this.opts = opts || {}; this.routes = []; this.target = null;
      this.t = 0; this.T = 0; this.speed = 1; this.playing = false; this.last = 0;
      const redraw = () => { this.resize(); this.draw(); };
      map.on("move zoom resize", redraw);
      addEventListener("resize", redraw);
      this.resize();
    }
    resize() {
      const r = this.cv.getBoundingClientRect(), d = devicePixelRatio || 1;
      if (this.cv.width !== Math.round(r.width * d) || this.cv.height !== Math.round(r.height * d)) {   // reallocating on every map move would stutter panning
        this.cv.width = Math.round(r.width * d); this.cv.height = Math.round(r.height * d);
      }
      this.ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    setRoutes(routes, target) {
      this.target = target;
      this.routes = routes.map(r => {
        const segs = []; let tt = 0;
        for (const leg of r.legs) {
          if (leg.wait > 0) { segs.push({ t0: tt, t1: tt + leg.wait, leg, wait: true }); tt += leg.wait; }
          const pts = leg.coords;
          segs.push({ t0: tt, t1: tt + Math.max(leg.sec, 1), leg, pts, cum: plen(pts) }); tt += Math.max(leg.sec, 1);
        }
        const last = r.legs[r.legs.length - 1];
        return { color: r.color, name: r.name, segs, T: tt, end: last ? last.coords[last.coords.length - 1] : target };   // where this person ends up
      });
      this.T = Math.max(0, ...this.routes.map(r => r.T));
      this.t = 0; this.draw(); this.notify();
    }
    notify() { this.opts.onTick && this.opts.onTick(this.t, this.T, this.playing); }
    play() { if (this.t >= this.T) this.t = 0; this.playing = true; this.last = performance.now(); this.loop(); this.notify(); }
    pause() { this.playing = false; this.notify(); }
    seek(f) { this.t = f * this.T; this.draw(); this.notify(); }
    loop() {
      if (!this.playing) return;
      requestAnimationFrame((now) => {
        // whole animation lasts ~14 s at 1×, however long the trips are
        this.t += (now - this.last) / 1000 * (this.T / 14) * this.speed; this.last = now;
        if (this.t >= this.T) { this.t = this.T; this.playing = false; }
        this.draw(); this.notify(); this.loop();
      });
    }
    pt(ll) { const p = this.map.latLngToContainerPoint(ll); return [p.x, p.y]; }

    /* position along one segment at time t, plus the points travelled so far */
    along(seg, t) {
      const c = seg.pts || seg.leg.coords;
      if (seg.wait) return { pos: c[0], pts: [c[0]] };
      const f = Math.min(1, Math.max(0, (t - seg.t0) / (seg.t1 - seg.t0))), tot = seg.cum[seg.cum.length - 1] || 1;
      const want = f * tot, pts = [c[0]];
      for (let i = 1; i < c.length; i++) {
        if (seg.cum[i] >= want) {
          const k = (want - seg.cum[i - 1]) / ((seg.cum[i] - seg.cum[i - 1]) || 1);
          const pos = [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * k, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * k];
          pts.push(pos); return { pos, pts };
        }
        pts.push(c[i]);
      }
      return { pos: c[c.length - 1], pts };
    }

    legColor(leg, own) { return leg.color || MODE_COLOR[leg.mode] || own; }

    draw() {
      const ctx = this.ctx, r = this.cv.getBoundingClientRect();
      ctx.clearRect(0, 0, r.width, r.height);
      if (!this.routes.length) return;
      const t = this.t, now = performance.now();
      ctx.lineCap = "round"; ctx.lineJoin = "round";

      for (const rt of this.routes) {
        // full route, faint
        for (const s of rt.segs) {
          if (s.wait) continue;
          this.stroke(s.pts, this.legColor(s.leg, rt.color), 5, 0.85, [0.1, 9], 9);          // planned route: dotted, with a halo so it reads on any map colour
        }
      }
      for (const rt of this.routes) {
        let head = null, waiting = false;
        for (const s of rt.segs) {
          if (t < s.t0) break;
          const a = this.along(s, Math.min(t, s.t1));
          if (!s.wait) this.stroke(a.pts, this.legColor(s.leg, rt.color), 7, 1, s.leg.mode === "walk" ? [0.1, 11] : null, 11);   // travelled part: solid (dotted for walking)
          head = a.pos; waiting = s.wait && t < s.t1;
        }
        if (!head) head = rt.segs[0].leg.coords[0];
        const arrived = t >= rt.T, p = this.pt(arrived ? rt.end : head);
        if (waiting) {                                  // pulsing ring while waiting for the train
          const k = (now % 1200) / 1200;
          ctx.strokeStyle = rt.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p[0], p[1], 8 + 14 * k, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        }
        if (arrived && t - rt.T < 1.5 * this.T / 14) {  // arrival burst
          const k = (t - rt.T) / (1.5 * this.T / 14);
          ctx.strokeStyle = rt.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(p[0], p[1], 10 + 30 * k, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        }
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, 7); ctx.fill();
        ctx.fillStyle = rt.color; ctx.beginPath(); ctx.arc(p[0], p[1], 6.5, 0, 7); ctx.fill();
        if (arrived) {
          ctx.font = "600 12px system-ui,sans-serif"; const txt = Math.round(rt.T / 60) + " min";
          const w = ctx.measureText(txt).width + 10;
          const off = this.routes.indexOf(rt) % 2 ? 16 : -16;
          ctx.fillStyle = rt.color; ctx.fillRect(p[0] + 12, p[1] + off - 9, w, 18);
          ctx.fillStyle = "#fff"; ctx.fillText(txt, p[0] + 17, p[1] + off + 4);
        }
      }
    }
    /* halo: width of a white outline drawn first (0 = none) */
    stroke(ll, color, w, alpha, dash, halo) {
      if (ll.length < 2) return;
      const ctx = this.ctx; ctx.beginPath();
      ll.forEach((q, i) => { const p = this.pt(q); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      if (halo) { ctx.strokeStyle = "#fff"; ctx.lineWidth = halo; ctx.globalAlpha = 0.75 * alpha; ctx.setLineDash(dash || []); ctx.stroke(); }
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.globalAlpha = alpha; ctx.setLineDash(dash || []); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }
  root.Flow = Flow;
})(window);
