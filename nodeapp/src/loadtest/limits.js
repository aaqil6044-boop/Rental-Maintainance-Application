"use strict";
// Effective safety limits = what the administrator configured, clamped to absolute ceilings in code.
// A typo such as LOADTEST_MAX_VUS=100000 cannot turn the feature into a denial-of-service tool.
const config = require("../config");
const CEILING = { maxUsers: 1000, maxDurationSec: 7200, maxRequests: 5000000, maxCreates: 20000 };
const { DEFAULT_LIMITS } = require("./config");

function limits() {
  const c = config.loadtest;
  return {
    ...DEFAULT_LIMITS,
    maxUsers: Math.min(c.maxUsers, CEILING.maxUsers),
    maxDurationSec: Math.min(c.maxDurationSec, CEILING.maxDurationSec),
    maxRequests: Math.min(c.maxRequests, CEILING.maxRequests),
    maxCreates: Math.min(c.maxCreates, CEILING.maxCreates),
  };
}
module.exports = { limits, CEILING };
