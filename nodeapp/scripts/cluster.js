"use strict";
// Scale-out on one machine: a primary process that prepares the database ONCE (migrations, optional sample data,
// interrupted-load-test recovery) and then forks N workers that share the listening port. The operating system
// spreads connections across the workers, so every CPU core can serve requests.
//
//   WORKERS=4 PORT=8080 node scripts/cluster.js        (WORKERS defaults to the number of CPU cores)
//
// What is shared: the SQLite database (WAL mode lets many processes read while one writes; better-sqlite3 waits up to
// 5 s for a competing writer) and the uploads folder. What is NOT shared: the in-memory sign-in throttle, so the
// per-address limit applies per worker. A worker that dies is replaced. SIGTERM drains all workers.
const cluster = require("cluster");
const os = require("os");

const WORKERS = Math.max(1, Number(process.env.WORKERS) || os.availableParallelism?.() || os.cpus().length);

if (cluster.isPrimary) {
  require("../src/secrets").load().then(primary).catch((e) => { console.error("[startup] " + e.message); process.exit(1); });
} else {
  require("../server").start();
}

function primary() {
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  const app = require("../server");                     // loads the database module, which migrates
  const config = require("../src/config");
  if (config.seedDev) require("../src/seed")();
  require("../src/loadtest/manager").recover();
  void app;
  const port = Number(process.env.PORT) || 8080;
  let stopping = false;
  const spawn = () => cluster.fork({ EO_SECONDARY: "1", PORT: String(port) });
  for (let i = 0; i < WORKERS; i++) spawn();
  cluster.on("exit", (w, code, sig) => {
    if (stopping) return;
    console.log(`[cluster] worker ${w.process.pid} exited (${sig || code}); starting a replacement`);
    spawn();
  });
  const stop = () => { stopping = true; for (const id in cluster.workers) cluster.workers[id].process.kill("SIGTERM"); setTimeout(() => process.exit(0), 1500).unref(); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  console.log(`[cluster] primary ${process.pid} started ${WORKERS} worker(s) on port ${port}`);
}
