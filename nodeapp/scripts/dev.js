"use strict";
// Development launcher: sample data on, development secret allowed. Never use in production.
// It always runs in development mode. A NODE_ENV=production (or JWT_SECRET / SETUP_KEY) left over in your shell from a
// production test would otherwise win over config/local.env and silently start an empty production-mode server.
if (process.env.NODE_ENV && process.env.NODE_ENV !== "development") {
  console.log(`[dev] ignoring NODE_ENV=${process.env.NODE_ENV} from your shell: this launcher always runs in development mode. Use "npm start" for production.`);
}
process.env.NODE_ENV = "development";
process.env.SEED_DEV = "1";
require("../server").start();
