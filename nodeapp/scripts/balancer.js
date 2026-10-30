"use strict";
// A small HTTP load balancer for running several EstateOps instances behind one address. It exists so scale-out can be
// tested honestly in a development environment; in production use nginx, HAProxy or a cloud balancer with the same ideas.
//
//   node scripts/balancer.js --listen 9000 --backends 127.0.0.1:8081,127.0.0.1:8082 [--strategy round-robin|least-connections|ip-hash]
//
// - strategies: round-robin (default), least-connections, ip-hash (the same client address always lands on the same backend)
// - active health checks: GET /health every 2 s; an unhealthy backend gets no traffic until it passes again
// - passive failover: a connection error marks the backend down immediately and an idempotent request (GET/HEAD) is retried once elsewhere
// - adds X-Forwarded-For / X-Forwarded-Proto (start the app with TRUST_PROXY=1 so it sees the real client address)
// - pinned paths (default /api/loadtests): the in-memory run of a load test lives in one instance, so those requests always go to the oldest live instance
// - pinned paths (default /api/loadtests): the in-memory run of a load test lives in one instance, so those requests always go to the oldest live instance
// - GET /__lb returns live counters (per-backend requests, active, failures, healthy)
const http = require("http");

function parseArgs(argv) {
  const o = { listen: 9000, backends: [], strategy: "round-robin", checkMs: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--listen") { o.listen = Number(v); i++; }
    else if (k === "--backends") { o.backends = String(v).split(",").map((x) => x.trim()).filter(Boolean); i++; }
    else if (k === "--strategy") { o.strategy = v; i++; }
    else if (k === "--check-ms") { o.checkMs = Number(v); i++; }
  }
  return o;
}

function create({ backends, strategy = "round-robin", checkMs = 2000, timeoutMs = 30000, dynamic = false, pin = ["/api/loadtests"] }) {
  if (!backends.length && !dynamic) throw new Error("At least one backend is required.");
  if (!["round-robin", "least-connections", "ip-hash"].includes(strategy)) throw new Error(`Unknown strategy "${strategy}".`);
  const mk = (b) => { const [host, port] = b.split(":"); return { name: b, host, port: Number(port), healthy: true, draining: false, active: 0, requests: 0, failures: 0, retried: 0, lat: [] }; };
  const pool = backends.map(mk);
  let rr = 0;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 512, timeout: 2000 })   // idle sockets are closed after 2 s, BEFORE the app's own 5 s keep-alive limit, so we never reuse a socket the app already closed;

  function pick(req, exclude) {
    let live = pool.filter((b) => b.healthy && !b.draining && b !== exclude);
    // Panic mode: if every backend looks unhealthy (e.g. one busy process missed a health check while hashing passwords),
    // sending traffic anyway beats answering 503 to everybody. Only a pool with nothing usable at all returns null.
    if (!live.length && !exclude) live = pool.filter((b) => !b.draining);
    if (!live.length) return null;
    // Requests that depend on in-memory state of ONE process (a running load test lives in the instance that started it) always go to the oldest live instance.
    if (pin.some((pfx) => req.url.startsWith(pfx))) return live[0];
    if (strategy === "least-connections") return live.reduce((a, b) => (b.active < a.active ? b : a));
    if (strategy === "ip-hash") {
      let h = 0; for (const c of String(req.socket.remoteAddress || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return live[h % live.length];
    }
    return live[rr++ % live.length];
  }

  function forward(req, res, body, backend, tried) {
    backend.active++; backend.requests++; const t0 = Date.now();
    const headers = { ...req.headers, "x-forwarded-for": [req.headers["x-forwarded-for"], req.socket.remoteAddress].filter(Boolean).join(", "), "x-forwarded-proto": "http", "x-forwarded-host": req.headers.host };
    const up = http.request({ host: backend.host, port: backend.port, method: req.method, path: req.url, headers, agent, timeout: timeoutMs }, (r) => {
      res.writeHead(r.statusCode, { ...r.headers, "x-served-by": backend.name });
      r.pipe(res); r.on("end", () => { backend.active--; backend.lat.push([Date.now(), Date.now() - t0]); if (backend.lat.length > 4000) backend.lat.splice(0, 2000); });
    });
    up.on("timeout", () => up.destroy(new Error("timeout")));
    up.on("error", (e) => {
      backend.active--;
      // A reused keep-alive socket that the app had just closed resets before any byte is sent: not a dead backend. Retry once on the same one.
      if (up.reusedSocket && (e.code === "ECONNRESET" || e.code === "EPIPE") && !tried && !res.headersSent) { backend.retried++; return forward(req, res, body, backend, true); }
      backend.failures++; backend.healthy = false;           // passive check: stop sending traffic now
      const idempotent = req.method === "GET" || req.method === "HEAD";
      const next = idempotent && !tried ? pick(req, backend) : null;
      if (next && !res.headersSent) { backend.retried++; return forward(req, res, body, next, true); }
      if (!res.headersSent) { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ status: 502, message: "The service is temporarily unavailable." })); }
      else res.destroy();
    });
    if (body && body.length) up.write(body);
    up.end();
  }

  const server = http.createServer((req, res) => {
    if (req.url === "/__lb") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ strategy, backends: pool.map(({ name, healthy, draining, active, requests, failures, retried }) => ({ name, healthy, draining, active, requests, failures, retried })) }));
    }
    const chunks = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const b = pick(req);
      if (!b) { res.writeHead(503, { "content-type": "application/json" }); return res.end(JSON.stringify({ status: 503, message: "No healthy backend is available." })); }
      forward(req, res, Buffer.concat(chunks), b, false);
    });
  });

  async function check(b) {
    await new Promise((resolve) => {
      // two misses in a row before a backend is taken out (one slow answer from a busy process is not a dead process); one success restores it
      const miss = () => { b.misses = (b.misses || 0) + 1; if (b.misses >= 2) b.healthy = false; resolve(); };
      const r = http.get({ host: b.host, port: b.port, path: "/health", timeout: 3000, agent: false }, (x) => { x.resume(); if (x.statusCode === 200) { b.misses = 0; b.healthy = true; resolve(); } else miss(); });
      r.on("error", miss); r.on("timeout", () => r.destroy());
    });
  }
  const timer = setInterval(() => pool.forEach(check), checkMs); timer.unref();
  /** Live load figures over the last `windowMs`: what the autoscaler uses to see that the break point has been reached. */
  function stats(windowMs = 5000) {
    const now = Date.now(), live = pool.filter((b) => b.healthy && !b.draining);
    const all = []; pool.forEach((b) => { const recent = b.lat.filter((x) => now - x[0] <= windowMs); b._recent = recent; recent.forEach((x) => all.push(x[1])); });
    all.sort((a, b) => a - b);
    return { instances: live.length, inflight: live.reduce((a, b) => a + b.active, 0), inflightPerInstance: live.length ? live.reduce((a, b) => a + b.active, 0) / live.length : 0,
      rps: all.length / (windowMs / 1000), p95Ms: all.length ? all[Math.min(all.length - 1, Math.ceil(all.length * 0.95) - 1)] : 0, samples: all.length };
  }
  const addBackend = (name) => { if (!pool.some((b) => b.name === name)) pool.push(mk(name)); return pool.find((b) => b.name === name); };
  /** Stop sending new requests, wait for in-flight ones, then remove. */
  async function drain(name, maxMs = 15000) {
    const b = pool.find((x) => x.name === name); if (!b) return; b.draining = true;
    const t = Date.now(); while (b.active > 0 && Date.now() - t < maxMs) await new Promise((r) => setTimeout(r, 100));
    const i = pool.indexOf(b); if (i >= 0) pool.splice(i, 1);
  }
  return { server, pool, stats, addBackend, drain, check: () => Promise.all(pool.map(check)), close: () => { clearInterval(timer); agent.destroy(); return new Promise((r) => { server.close(r); server.closeAllConnections && server.closeAllConnections(); }); } };
}

module.exports = { create, parseArgs };

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  const lb = create(o);
  lb.server.listen(o.listen, () => console.log(`[balancer] ${o.strategy} on :${o.listen} -> ${o.backends.join(", ")}`));
}
