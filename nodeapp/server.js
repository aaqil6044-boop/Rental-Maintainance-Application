"use strict";
const express = require("express");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const config = require("./src/config");
const db = require("./src/db");
const routes = require("./src/routes");
const openapi = require("./src/openapi");
const Obs = require("./src/observe");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY) || false);

/* ---- security headers; CORS only when a separate front-end origin is configured ---- */
// Pages run only our own scripts (no inline script, no eval), talk only to this origin, and cannot be framed.
const CSP_PAGES = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
                  "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
// The bundled Swagger UI needs inline styles and scripts, so /docs gets its own (still same-origin only) policy.
const CSP_DOCS = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
app.use(Obs.requestId);
app.use(Obs.metrics);
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "Content-Security-Policy": req.path.startsWith("/docs") ? CSP_DOCS : CSP_PAGES,
            "Cross-Origin-Resource-Policy": "same-origin" });
  if (req.path.startsWith("/api/") || req.path === "/health") res.set("Cache-Control", "no-store");   // account data must never sit in a browser or proxy cache
  if (config.production) res.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  if (config.corsOrigin) {
    res.set({ "Access-Control-Allow-Origin": config.corsOrigin, "Vary": "Origin",
              "Access-Control-Allow-Headers": "Authorization, Content-Type",
              "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
              "Access-Control-Expose-Headers": "X-Total-Count" });
    if (req.method === "OPTIONS") return res.status(204).end();
  }
  next();
});

/* ---- request ID, one structured log line per API call (no bodies, tokens or query strings), and metrics ---- */
app.get("/metrics", Obs.endpoint);
app.use(express.json({ limit: config.http.bodyLimit }));
app.use("/api", routes);

/* ---- API documentation. Swagger UI is bundled, so /docs works offline. ---- */
// Off in production unless DOCS=1: the documentation is a complete map of the API for anyone who finds it.
if (config.docs) {
  app.get("/openapi.json", (req, res) => res.json(openapi));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, {
    customSiteTitle: "EstateOps API",
    swaggerOptions: { persistAuthorization: true, docExpansion: "list", tryItOutEnabled: true },
  }));
}

/* ---- the interface and the API share one origin ---- */
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  try { db.prepare("SELECT 1").get(); res.json({ status: "UP", database: "UP" }); }
  catch (e) { res.status(503).json({ status: "DOWN", database: "DOWN" }); }
});

app.use((req, res) => res.status(404).json({ status: 404, message: "No such endpoint." }));
app.use((err, req, res, next) => {              // malformed JSON and anything raised outside the router
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ timestamp: new Date().toISOString(), status,
    message: status === 400 ? "The request body is not valid JSON." : status >= 500 ? "Something went wrong handling that request." : err.message });
});

function start(port = process.env.PORT || 8080) {
  if (db.appliedMigrations.length) console.log(`[db] applied migrations: ${db.appliedMigrations.join("; ")}`);
  const secondary = process.env.EO_SECONDARY === "1";   // a worker/instance started by the cluster launcher: the primary already migrated, seeded and recovered
  if (config.seedDev && !secondary) {
    const seeded = require("./src/seed")();
    if (seeded) console.log("[seed] DEVELOPMENT sample data created (never enabled in production).");
  }
  if (!config.production && !process.env.JWT_SECRET) console.log("[warn] JWT_SECRET is not set: using the development secret. Set it before deploying.");
  const interrupted = secondary ? 0 : require("./src/loadtest/manager").recover();   // a restart cannot resume a load test: mark it, never leave it "running"
  if (interrupted) console.log(`[loadtest] ${interrupted} load test(s) were interrupted by the restart and marked FAILED.`);
  const srv = app.listen(port, () => {
    console.log(`EstateOps running at http://localhost:${port}`);
    if (config.docs) console.log(`API documentation at  http://localhost:${port}/docs`);
    const U = require("./src/store");
    if (U.countAccounts() === 0) console.log("No accounts yet: open the site and create the first manager account.");
  });
  // Behind a load balancer (AWS ALB closes idle connections after 60 s) Node's own 5 s keep-alive would make it see random resets.
  srv.keepAliveTimeout = config.http.keepAliveMs;
  srv.headersTimeout = config.http.keepAliveMs + 1000;

  // Stopping: refuse new connections, let running requests finish (up to SHUTDOWN_TIMEOUT_MS), then close the database cleanly.
  let stopping = false;
  const stop = (why, code = 0) => {
    if (stopping) return; stopping = true;
    console.log(`[shutdown] ${why}: finishing running requests (up to ${config.http.shutdownMs} ms)`);
    const finish = () => {
      try { require("./src/loadtest/manager").shutdown(); } catch (e) { /* nothing running */ }
      try { db.close(); } catch (e) { /* already closed */ }
      process.exit(code);
    };
    srv.close(finish);
    if (srv.closeIdleConnections) srv.closeIdleConnections();
    setTimeout(() => { if (srv.closeAllConnections) srv.closeAllConnections(); finish(); }, config.http.shutdownMs).unref();
  };
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => stop(sig));
  // A bug that escapes every handler leaves the process in an unknown state: log it and exit so the platform restarts a clean one.
  process.on("uncaughtException", (e) => { console.error("[fatal] uncaught exception:", e); stop("uncaught exception", 1); });
  process.on("unhandledRejection", (e) => { console.error("[fatal] unhandled rejection:", e); stop("unhandled rejection", 1); });
  process.once("exit", () => { try { require("./src/loadtest/manager").shutdown(); } catch (e) { /* nothing running */ } });
  return srv;
}

if (require.main === module) start();
module.exports = app;
module.exports.start = start;
