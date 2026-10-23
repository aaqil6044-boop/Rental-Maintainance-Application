"use strict";
// Development launcher: sample data on, development secret allowed. Never use in production.
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.SEED_DEV = "1";
require("../server").start();
