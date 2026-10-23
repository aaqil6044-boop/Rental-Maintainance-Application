"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

/** Every test run gets its own database and upload folder. Production data is never touched. */
function isolate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "estateops-test-"));
  process.env.DATA_DIR = dir;
  process.env.NODE_ENV = "test";
  delete process.env.SEED_DEV;
  delete process.env.GEMINI_API_KEY;
  return dir;
}

function reporter(title) {
  let pass = 0, fail = 0;
  const ok = (what, cond, extra) => {
    if (cond) { pass++; console.log("  PASS  " + what); }
    else { fail++; console.log("  FAIL  " + what + (extra !== undefined ? "   [" + JSON.stringify(extra) + "]" : "")); }
    return !!cond;
  };
  const section = (s) => console.log(`\n== ${s} ==`);
  const done = () => {
    console.log(`\n${title}: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  };
  return { ok, section, done, counts: () => ({ pass, fail }) };
}

module.exports = { isolate, reporter };
