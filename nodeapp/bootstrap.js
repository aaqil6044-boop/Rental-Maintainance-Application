"use strict";
// Production entry point: fetch secrets (when AWS_SECRET_ID is set), then start the server.
// `node server.js` still works for development; it never contacts AWS.
require("./src/secrets").load()
  .then(() => require("./server").start())
  .catch((e) => { console.error("[startup] " + e.message); process.exit(1); });
