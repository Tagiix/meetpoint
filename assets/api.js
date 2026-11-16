/* Client for api/meetup.php */
(function (root) {
  "use strict";
  async function parse(r) {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }
  root.Api = {
    /* {ok, why}: why says what went wrong, so the page can show it */
    ping: async () => {
      try {
        const r = await fetch("api/meetup.php");
        if (!r.ok) return { ok: false, why: "HTTP " + r.status };
        const j = await r.json().catch(() => null);
        if (!j) return { ok: false, why: "the server did not answer with JSON: is PHP running?" };
        return j.ok === true ? { ok: true } : { ok: false, why: "data/events/ is not writable" };
      } catch (e) { return { ok: false, why: e.message || "request failed" }; }
    },
    get: (id, rev) => fetch("api/meetup.php?id=" + encodeURIComponent(id) + (rev ? "&rev=" + rev : "")).then(parse),
    post: (body) => fetch("api/meetup.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(parse),
  };
})(window);
