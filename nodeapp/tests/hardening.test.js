"use strict";
// Hardening: conditional updates (no lost updates), malware scan of uploads, request IDs/structured logs/metrics.
const { isolate, reporter } = require("./helpers");
const dir = isolate();
const T = reporter("Hardening");
const { section } = T;
const ok = (cond, what, extra) => T.ok(what, cond, extra);
const net = require("net");

// A fake clamd: replies FOUND when the stream contains the EICAR marker, OK otherwise; "mode" can break it.
function fakeClamd(state) {
  return net.createServer((s) => {
    const chunks = []; s.on("data", (d) => { chunks.push(d); });
    s.on("error", () => {});
    const finish = () => {
      if (state.mode === "hang") return;
      if (state.mode === "garbage") return s.end("stream: ERROR\0");
      const all = Buffer.concat(chunks);
      if (all.includes("EICAR-TEST")) s.end("stream: Eicar-Test-Signature FOUND\0"); else s.end("stream: OK\0");
    };
    let timer; s.on("data", () => { clearTimeout(timer); timer = setTimeout(() => { if (Buffer.concat(chunks).slice(-4).equals(Buffer.alloc(4))) finish(); }, 30); });
  });
}

(async () => {
  const state = { mode: "ok" };
  const clam = fakeClamd(state);
  await new Promise((r) => clam.listen(0, "127.0.0.1", r));
  process.env.SCAN_CLAMD_HOST = "127.0.0.1"; process.env.SCAN_CLAMD_PORT = String(clam.address().port); process.env.SCAN_TIMEOUT_MS = "800";
  process.env.METRICS_TOKEN = "metrics-token-123456";
  const app = require("../server");
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body, headers } = {}) => {
    const h = { ...(headers || {}) }; if (token) h.Authorization = `Bearer ${token}`;
    let b; if (body instanceof FormData) b = body; else if (body) { h["Content-Type"] = "application/json"; b = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers: h, body: b });
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json, text, headers: r.headers };
  };

  require("../src/seed")();
  const lg = await call("POST", "/api/auth/login", { body: { email: "tenant@estateops.test", password: "password123" } });
  const admin = lg.json && lg.json.token;
  ok(!!admin, "tenant signs in");
  const list = await call("GET", "/api/maintenance-requests", { token: admin });
  const unitId = list.json[0].unitId;
  const mk = await call("POST", "/api/maintenance-requests", { token: admin, body: { unitId, title: "Leaking tap", description: "Drip", category: "PLUMBING", priority: "MEDIUM" } });
  ok(mk.status === 201, `request created (${mk.status})`, mk.json);
  const id = mk.json.id;

  section("Conditional updates: the second of two competing changes is refused");
  const S = require("../src/store");
  const r0 = S.findRequest(id);
  const first = S.updateRequestStatus(id, "TRIAGED", null, r0.status);
  const second = S.updateRequestStatus(id, "CANCELLED", null, r0.status);   // still believes the status is the old one
  ok(first && first.status === "TRIAGED", "first change applied");
  ok(second === null, "second change from a stale view is refused (returns null)");
  ok(S.findRequest(id).status === "TRIAGED", "the row still has the first change");
  ok(S.updateAssignment(id, { status: "ASSIGNED", expectedStatus: r0.status }) === null, "stale assignment refused");

  section("Upload malware scan");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("harmless data".repeat(10))]);
  const up = async (buf, name = "a.png") => { const f = new FormData(); f.append("file", new Blob([buf]), name); return call("POST", `/api/maintenance-requests/${id}/attachments`, { token: admin, body: f }); };
  let r = await up(png); ok(r.status === 201, `clean file accepted (${r.status})`);
  r = await up(Buffer.concat([png, Buffer.from("EICAR-TEST-STRING")])); ok(r.status === 422 && r.json.code === "MALWARE", `infected file refused with 422 (${r.status})`);
  ok(S.db.prepare("SELECT COUNT(*) n FROM attachments WHERE request_id = ?").get(id).n === 1, "the infected file was not stored");
  const files = require("fs").readdirSync(require("../src/config").uploadDir).length; ok(files === 1, "and nothing was written to disk");
  r = await up(Buffer.from("<html>not an image</html>"), "x.png"); ok(r.status === 400, "wrong type still refused before scanning");
  state.mode = "garbage"; r = await up(png); ok(r.status === 503 && r.json.code === "SCANNER_DOWN", `unclear scanner answer refuses the upload (${r.status})`);
  state.mode = "hang"; r = await up(png); ok(r.status === 503, `scanner timeout refuses the upload (${r.status})`);
  clam.close(); r = await up(png); ok(r.status === 503, `scanner unreachable refuses the upload (${r.status})`);
  ok(!/ECONN|127\.0\.0\.1/.test(r.text), "no internal details in the error");

  section("Request IDs, structured logs and metrics");
  r = await call("GET", "/health"); ok(/^[\w-]{8,64}$/.test(r.headers.get("x-request-id") || ""), "every answer carries X-Request-Id");
  r = await call("GET", "/health", { headers: { "X-Request-Id": "abc-123-trace" } }); ok(r.headers.get("x-request-id") === "abc-123-trace", "a sane incoming X-Request-Id is kept");
  r = await call("GET", "/health", { headers: { "X-Request-Id": "bad id <script>x" } }); ok(/^[\w-]{8,64}$/.test(r.headers.get("x-request-id")), "a hostile X-Request-Id is replaced");
  r = await call("GET", "/metrics"); ok(r.status === 401 || r.status === 404, `/metrics refuses without the token (${r.status})`);
  r = await call("GET", "/metrics", { headers: { Authorization: "Bearer wrong" } }); ok(r.status === 401, "/metrics refuses a wrong token");
  r = await call("GET", "/metrics", { token: "metrics-token-123456" });
  ok(r.status === 200 && /^text\/plain/.test(r.headers.get("content-type")), "/metrics answers with the token");
  ok(/estateops_http_requests_total\{[^}]*status="2xx"[^}]*\} \d+/.test(r.text), "request counter by status class");
  ok(/estateops_http_request_duration_seconds_(bucket|sum|count)/.test(r.text), "latency histogram");
  ok(/estateops_uptime_seconds \d+/.test(r.text) && /estateops_process_resident_memory_bytes \d+/.test(r.text), "process gauges");
  ok(/estateops_auth_failures_total \d+/.test(r.text), "auth failure counter");
  ok(!/Bearer|password|@rose\.test/.test(r.text), "no secrets or personal data in metrics");
  ok(!/\/maintenance-requests\/\d+/.test(r.text), "route labels use patterns, not raw ids (bounded cardinality)");

  server.close();
  T.done();
})().catch((e) => { console.error(e); process.exit(1); });
