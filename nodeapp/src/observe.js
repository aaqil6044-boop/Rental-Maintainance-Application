"use strict";
// Request IDs, structured logs and Prometheus-style metrics. No bodies, tokens or query strings are ever logged or labelled.
const crypto = require("crypto");
const config = require("./config");

const started = Date.now();
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const counts = new Map();            // `${method}|${route}|${class}` -> n
const hist = new Map();              // `${route}` -> { b: number[], sum, n }
let authFailures = 0, rateLimited = 0, serverErrors = 0, inflight = 0;

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;
function requestId(req, res, next) {
  const given = req.get("x-request-id");
  req.id = given && SAFE_ID.test(given) ? given : crypto.randomBytes(8).toString("hex");
  res.set("X-Request-Id", req.id);
  next();
}

/** A bounded label: the route pattern (/api/maintenance-requests/:id), never the raw URL. */
function routeLabel(req) {
  if (req.route && req.route.path) return (req.baseUrl || "") + (typeof req.route.path === "string" ? req.route.path : "");
  if (req.path === "/health" || req.path === "/metrics") return req.path;
  return req.path.startsWith("/api/") ? "/api/(unmatched)" : "(static)";
}

function metrics(req, res, next) {
  const t = process.hrtime.bigint(); inflight++;
  res.on("finish", () => {
    inflight--;
    const sec = Number(process.hrtime.bigint() - t) / 1e9, route = routeLabel(req), cls = `${Math.floor(res.statusCode / 100)}xx`;
    const k = `${req.method}|${route}|${cls}`; counts.set(k, (counts.get(k) || 0) + 1);
    let h = hist.get(route); if (!h) { h = { b: BUCKETS.map(() => 0), sum: 0, n: 0 }; hist.set(route, h); }
    BUCKETS.forEach((le, i) => { if (sec <= le) h.b[i]++; }); h.sum += sec; h.n++;
    if (res.statusCode === 401 && route.startsWith("/api/auth")) authFailures++;
    if (res.statusCode === 429) rateLimited++;
    if (res.statusCode >= 500) serverErrors++;
    if (config.log.requests && (req.path.startsWith("/api") || res.statusCode >= 500)) log(req, res, sec, route);
  });
  next();
}

function log(req, res, sec, route) {
  const ms = Math.round(sec * 1000);
  if (config.log.json) {
    console.log(JSON.stringify({ time: new Date().toISOString(), level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      msg: "request", id: req.id, method: req.method, path: req.originalUrl.split("?")[0], route, status: res.statusCode, ms,
      user: req.account ? req.account.id : undefined, ip: req.ip }));
  } else {
    console.log(`${new Date().toISOString()} ${req.id} ${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} ${ms}ms`);
  }
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
function render() {
  const out = [];
  out.push("# HELP estateops_http_requests_total HTTP requests by method, route pattern and status class.", "# TYPE estateops_http_requests_total counter");
  for (const [k, n] of counts) { const [m, r, c] = k.split("|"); out.push(`estateops_http_requests_total{method="${m}",route="${esc(r)}",status="${c}"} ${n}`); }
  out.push("# HELP estateops_http_request_duration_seconds Request latency by route pattern.", "# TYPE estateops_http_request_duration_seconds histogram");
  for (const [r, h] of hist) {
    BUCKETS.forEach((le, i) => out.push(`estateops_http_request_duration_seconds_bucket{route="${esc(r)}",le="${le}"} ${h.b[i]}`));
    out.push(`estateops_http_request_duration_seconds_bucket{route="${esc(r)}",le="+Inf"} ${h.n}`,
             `estateops_http_request_duration_seconds_sum{route="${esc(r)}"} ${h.sum.toFixed(6)}`,
             `estateops_http_request_duration_seconds_count{route="${esc(r)}"} ${h.n}`);
  }
  const g = (name, help, type, v) => out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${v}`);
  g("estateops_auth_failures_total", "Failed sign-ins and other 401 answers on /api/auth.", "counter", authFailures);
  g("estateops_rate_limited_total", "Requests refused with 429.", "counter", rateLimited);
  g("estateops_server_errors_total", "Responses with status 500 or above.", "counter", serverErrors);
  g("estateops_http_requests_in_flight", "Requests being handled now.", "gauge", inflight);
  g("estateops_uptime_seconds", "Seconds since the process started.", "gauge", Math.floor((Date.now() - started) / 1000));
  g("estateops_process_resident_memory_bytes", "Resident memory.", "gauge", process.memoryUsage().rss);
  g("estateops_nodejs_heap_used_bytes", "Heap in use.", "gauge", process.memoryUsage().heapUsed);
  return out.join("\n") + "\n";
}

/** GET /metrics. Does not exist (404) unless METRICS_TOKEN is set; then requires `Authorization: Bearer <token>`. Compared in constant time. */
function endpoint(req, res, next) {
  if (!config.metricsToken) return next();
  const given = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = crypto.createHash("sha256").update(given).digest(), b = crypto.createHash("sha256").update(config.metricsToken).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).set("WWW-Authenticate", "Bearer").json({ status: 401, message: "A valid metrics token is required." });
  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8").send(render());
}
module.exports = { requestId, metrics, endpoint, render };
