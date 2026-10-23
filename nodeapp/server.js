"use strict";
const express = require("express");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const config = require("./src/config");
const db = require("./src/db");
const routes = require("./src/routes");
const openapi = require("./src/openapi");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY) || false);

/* ---- security headers; CORS only when a separate front-end origin is configured ---- */
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" });
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

/* ---- one log line per API call: no bodies, no tokens ---- */
if (process.env.LOG_REQUESTS !== "0" && process.env.NODE_ENV !== "test") {
  app.use("/api", (req, res, next) => {
    const t = Date.now();
    res.on("finish", () => console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} ${Date.now() - t}ms`));
    next();
  });
}

app.use(express.json({ limit: "100kb" }));
app.use("/api", routes);

/* ---- API documentation. Swagger UI is bundled, so /docs works offline. ---- */
app.get("/openapi.json", (req, res) => res.json(openapi));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, {
  customSiteTitle: "EstateOps API",
  swaggerOptions: { persistAuthorization: true, docExpansion: "list", tryItOutEnabled: true },
}));

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
  if (config.seedDev) {
    const seeded = require("./src/seed")();
    if (seeded) console.log("[seed] DEVELOPMENT sample data created (never enabled in production).");
  }
  if (!config.production && !process.env.JWT_SECRET) console.log("[warn] JWT_SECRET is not set: using the development secret. Set it before deploying.");
  return app.listen(port, () => {
    console.log(`EstateOps running at http://localhost:${port}`);
    console.log(`API documentation at  http://localhost:${port}/docs`);
    const U = require("./src/store");
    if (U.countAccounts() === 0) console.log("No accounts yet: open the site and create the first manager account.");
  });
}

if (require.main === module) start();
module.exports = app;
module.exports.start = start;
