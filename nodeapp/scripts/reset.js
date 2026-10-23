"use strict";
// Deletes the local database and uploaded files. Refuses to run without --yes.
const fs = require("fs");
const config = require("../src/config");
if (process.argv.includes("--yes")) {
  fs.rmSync(config.dataDir, { recursive: true, force: true });
  console.log(`Removed ${config.dataDir}`);
} else {
  console.log(`This permanently deletes ${config.dataDir} (database and uploads).\nRun again with --yes to confirm.`);
}
