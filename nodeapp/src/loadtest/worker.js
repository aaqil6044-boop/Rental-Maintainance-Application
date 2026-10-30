"use strict";
// Child process that generates the load. It is separate from the web server on purpose: the generator's
// own CPU and garbage collection must not distort the latency of the server being measured.
// Credentials arrive over IPC (never argv or environment) and are never written anywhere.
const { Engine, SetupError } = require("./engine");

let engine = null, started = false;
const send = (m) => { if (process.connected) try { process.send(m); } catch (e) { /* parent gone */ } };

process.on("message", async (msg) => {
  if (!msg) return;
  if (msg.type === "stop") { if (engine) engine.stop(msg.mode === "now" ? "now" : "graceful", msg.reason); return; }
  if (msg.type !== "start" || started) return;
  started = true;
  try {
    engine = new Engine({ ...msg.options, onSnapshot: (data) => send({ type: "snapshot", data }) });
    const out = await engine.run();
    send({ type: "done", result: out });
  } catch (e) {
    send({ type: "failed", setup: e instanceof SetupError, message: String((e && e.message) || e).slice(0, 500) });
  }
  setTimeout(() => process.exit(0), 100);
});

// Policy: if the web server goes away (crash, restart, kill) the generator stops immediately. No orphaned load.
process.on("disconnect", () => { if (engine) engine.stop("now", "Controller disconnected"); setTimeout(() => process.exit(0), 1500).unref(); });
process.on("uncaughtException", (e) => { send({ type: "failed", setup: false, message: "Generator crashed: " + String(e && e.message).slice(0, 300) }); setTimeout(() => process.exit(1), 50); });
send({ type: "ready" });
