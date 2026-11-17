/* Page-side client of the solving engine. Runs it in a Web Worker so solving never blocks the page; if a worker cannot start
   (blocked, unsupported, crashed) it quietly runs the same code on the page's thread instead.
     const engine = new Engine({build, dataBase});
     await engine.solve(options, people, {objective, maxMinutes, top})  -> {seq, top, relaxed} or null when a newer solve replaced it
     await engine.itineraries(seq, stationIndex)                          -> {out, back}
     engine.mode  "worker" | "page" */
(function (root) {
  "use strict";
  class Engine {
    constructor({ build, dataBase }) {
      this.build = build || ""; this.dataBase = dataBase; this.seq = 0; this.busy = false; this.waiting = null; this.calls = new Map(); this.nextId = 1;
      this.mode = "page"; this.worker = null; this.core = null;
      try {
        this.worker = new Worker("assets/solve-worker.js" + (this.build ? "?v=" + this.build : ""));
        this.worker.onmessage = (e) => { const c = this.calls.get(e.data.id); if (!c) return; this.calls.delete(e.data.id); e.data.ok ? c.resolve(e.data.result) : c.reject(new Error(e.data.error)); };
        this.worker.onerror = () => this.fallBack();
        this.mode = "worker";
        this.send({ type: "init", dataBase: this.dataBase }).catch(() => this.fallBack());
      } catch (e) { this.fallBack(); }
    }
    pageCore() {
      return this.core || (this.core = root.MPEngine.createCore((name) => fetch(this.dataBase + name + ".json" + (this.build ? "?v=" + this.build : "")).then((r) => r.json())));
    }
    fallBack() {                                         // the worker is unusable: answer everything from the page's own thread
      if (this.mode === "page") return;
      this.mode = "page"; if (this.worker) { this.worker.terminate(); this.worker = null; }
      for (const c of this.calls.values()) c.reject(new Error("worker failed"));
      this.calls.clear();
    }
    send(msg) {
      return new Promise((resolve, reject) => { const id = this.nextId++; this.calls.set(id, { resolve, reject }); this.worker.postMessage(Object.assign({ id }, msg)); });
    }
    async call(type, args) {
      if (this.mode === "worker") {
        try { return await this.send(Object.assign({ type }, args)); }
        catch (e) { if (this.mode === "worker") throw e; /* fell back meanwhile: run it here */ }
      }
      const core = this.pageCore();
      if (type === "solve") return core.solve(args.seq, args.o, args.people, args.opts);
      if (type === "itineraries") return core.itineraries(args.seq, args.c);
      if (type === "warm") return core.warm(args.o);
      if (type === "warmPlaces") return core.warmPlaces();
    }
    /* newest request wins: while one solve runs, only the latest waiting request is kept, older ones resolve to null */
    solve(o, people, opts) {
      return new Promise((resolve, reject) => {
        if (this.waiting) this.waiting.resolve(null);
        this.waiting = { o, people, opts, resolve, reject }; this.pump();
      });
    }
    pump() {
      if (this.busy || !this.waiting) return;
      const j = this.waiting; this.waiting = null; this.busy = true; const seq = ++this.seq;
      this.call("solve", { seq, o: j.o, people: j.people, opts: j.opts }).then((r) => j.resolve(Object.assign({ seq }, r)), j.reject).finally(() => { this.busy = false; this.pump(); });
    }
    itineraries(seq, c) { return this.call("itineraries", { seq, c }); }
    warm(o) { return this.call("warm", { o }); }
    warmPlaces() { return this.call("warmPlaces", {}); }
  }
  root.Engine = Engine;
})(window);
