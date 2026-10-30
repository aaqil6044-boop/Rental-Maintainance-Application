"use strict";
// The load balancer, tested against tiny in-process backends: distribution, strategies, failover, health recovery.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { create } = require("../../scripts/balancer");

const listen = (srv, port = 0) => new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv.address().port)));
function backend(name, { delay = 0 } = {}) {
  const hits = { n: 0, xff: [] };
  const srv = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200); return res.end("{}"); }
    hits.n++; hits.xff.push(req.headers["x-forwarded-for"]);
    let body = ""; req.on("data", (c) => body += c);
    req.on("end", () => setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ name, echo: body })); }, delay));
  });
  return { srv, hits, name };
}
const call = (port, method = "GET", path = "/x", body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port, method, path, agent: false }, (x) => { let b = ""; x.on("data", (c) => b += c); x.on("end", () => resolve({ status: x.statusCode, headers: x.headers, body: b ? JSON.parse(b) : null })); });
  r.on("error", reject); if (body) r.write(body); r.end();
});
async function setup(n, strategy, opts) {
  const bs = Array.from({ length: n }, (_, i) => backend("b" + i, opts));
  const ports = []; for (const b of bs) ports.push(await listen(b.srv));
  const lb = create({ backends: ports.map((p) => "127.0.0.1:" + p), strategy, checkMs: 100000 });
  const port = await listen(lb.server);
  return { bs, ports, lb, port, done: async () => { await lb.close(); bs.forEach((b) => b.srv.close()); } };
}

test("round-robin spreads requests evenly and tags the serving backend", async () => {
  const s = await setup(3, "round-robin");
  for (let i = 0; i < 30; i++) { const r = await call(s.port); assert.equal(r.status, 200); assert.match(r.headers["x-served-by"], /^127\.0\.0\.1:/); }
  assert.deepEqual(s.bs.map((b) => b.hits.n), [10, 10, 10]);
  assert.ok(s.bs[0].hits.xff[0], "the backend sees the client address in X-Forwarded-For");
  await s.done();
});

test("pinned paths always reach the same (oldest) backend while everything else is spread", async () => {
  const s = await setup(3, "round-robin");
  const pinned = new Set(), other = new Set();
  for (let i = 0; i < 12; i++) { pinned.add((await call(s.port, "GET", "/api/loadtests/5")).headers["x-served-by"]); other.add((await call(s.port, "GET", "/api/dashboard")).headers["x-served-by"]); }
  assert.equal(pinned.size, 1); assert.equal([...pinned][0], "127.0.0.1:" + s.ports[0]); assert.equal(other.size, 3);
  await s.done();
});

test("pinned paths always reach the same (oldest) backend while everything else is spread", async () => {
  const s = await setup(3, "round-robin");
  const pinned = new Set(), other = new Set();
  for (let i = 0; i < 12; i++) { pinned.add((await call(s.port, "GET", "/api/loadtests/5")).headers["x-served-by"]); other.add((await call(s.port, "GET", "/api/dashboard")).headers["x-served-by"]); }
  assert.equal(pinned.size, 1); assert.equal([...pinned][0], "127.0.0.1:" + s.ports[0]); assert.equal(other.size, 3);
  await s.done();
});

test("request bodies are forwarded intact", async () => {
  const s = await setup(2, "round-robin");
  const r = await call(s.port, "POST", "/api/echo", JSON.stringify({ a: 1 }));
  assert.equal(JSON.parse(r.body.echo).a, 1);
  await s.done();
});

test("least-connections avoids the busy backend", async () => {
  const s = await setup(2, "least-connections", { delay: 0 });
  s.bs[0].srv.removeAllListeners("request");
  s.bs[0].srv.on("request", (req, res) => { if (req.url === "/health") { res.writeHead(200); return res.end("{}"); } s.bs[0].hits.n++; setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"name":"slow"}'); }, 300); });
  try {
    const inflight = []; for (let i = 0; i < 8; i++) { inflight.push(call(s.port)); await new Promise((r) => setTimeout(r, 25)); }   // staggered, so the slow one is still busy when the next arrives
    await Promise.all(inflight);
    assert.ok(s.bs[1].hits.n > s.bs[0].hits.n, `fast backend should get more (fast ${s.bs[1].hits.n}, slow ${s.bs[0].hits.n})`);
  } finally { await s.done(); }
});

test("ip-hash always sends the same client to the same backend", async () => {
  const s = await setup(3, "ip-hash");
  const seen = new Set(); for (let i = 0; i < 12; i++) seen.add((await call(s.port)).headers["x-served-by"]);
  assert.equal(seen.size, 1);
  await s.done();
});

test("a dead backend is taken out immediately and GET requests are retried elsewhere with no client error", async () => {
  const s = await setup(3, "round-robin");
  s.bs[1].srv.close(); s.bs[1].srv.closeAllConnections?.();
  const results = []; for (let i = 0; i < 30; i++) results.push((await call(s.port)).status);
  assert.ok(results.every((x) => x === 200), "every GET succeeded despite one backend being down: " + results.join());
  const st = (await call(s.port, "GET", "/__lb")).body;
  assert.equal(st.backends[1].healthy, false);
  assert.ok(st.backends[1].failures >= 1);
  await s.done();
});

test("a failed POST is not retried (it could run twice) and the client gets 502", async () => {
  const s = await setup(2, "round-robin");
  s.bs[0].srv.close(); s.bs[0].srv.closeAllConnections?.();
  const codes = []; for (let i = 0; i < 4; i++) codes.push((await call(s.port, "POST", "/x", "{}")).status);
  assert.ok(codes.includes(502), "the POST that hit the dead backend is reported, not silently replayed: " + codes.join());
  assert.equal((await call(s.port, "POST", "/x", "{}")).status, 200, "after the failure, traffic goes to the healthy backend");
  await s.done();
});

test("when every backend looks unhealthy the balancer still tries them (panic mode) instead of failing everyone", async () => {
  const s = await setup(2, "round-robin");
  s.lb.pool.forEach((b) => b.healthy = false);
  assert.equal((await call(s.port)).status, 200);
  await s.done();
});

test("with no usable backend at all (all draining) the balancer answers 503", async () => {
  const s = await setup(2, "round-robin");
  s.lb.pool.forEach((b) => b.draining = true);
  assert.equal((await call(s.port)).status, 503);
  await s.done();
});

test("one missed health check does not remove a backend; two do; one success brings it back", async () => {
  const s = await setup(1, "round-robin");
  const srv = s.bs[0].srv; const port = s.ports[0];
  srv.close(); srv.closeAllConnections?.();
  await s.lb.check(); assert.equal(s.lb.pool[0].healthy, true, "still in after one miss");
  await s.lb.check(); assert.equal(s.lb.pool[0].healthy, false, "out after two misses");
  const again = http.createServer((q, r) => { r.writeHead(200); r.end("{}"); }); await listen(again, port);
  await s.lb.check(); assert.equal(s.lb.pool[0].healthy, true);
  again.close(); await s.lb.close();
});

test("the health check brings a recovered backend back", async () => {
  const s = await setup(2, "round-robin");
  s.lb.pool[0].healthy = false;
  await s.lb.check();
  assert.equal(s.lb.pool[0].healthy, true);
  await s.done();
});

test("configuration mistakes are refused", () => {
  assert.throws(() => create({ backends: [] }), /backend/);
  assert.throws(() => create({ backends: ["a:1"], strategy: "random" }), /Unknown strategy/);
});
