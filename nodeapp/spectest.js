"use strict";
// Cross-check: every path documented in the spec must exist in the Express router, and vice versa.
const openapi = require("./src/openapi");
const routes = require("./src/routes");

const norm = (p) => p.replace(/\{(\w+)\}/g, ":$1");
const documented = new Set();
for (const [p, ops] of Object.entries(openapi.paths)) {
  for (const m of Object.keys(ops)) documented.add(m.toUpperCase() + " " + norm(p));
}

const implemented = new Set();
for (const layer of routes.stack) {
  if (!layer.route) continue;
  const path = layer.route.path;
  for (const m of Object.keys(layer.route.methods)) {
    implemented.add(m.toUpperCase() + " /api" + (path === "/" ? "" : path));
  }
}
implemented.add("GET /health");

const docOnly = [...documented].filter((x) => !implemented.has(x)).sort();
const implOnly = [...implemented].filter((x) => !documented.has(x)).sort();

console.log("documented operations:", documented.size);
console.log("implemented endpoints:", implemented.size);
console.log("\ndocumented but NOT implemented:", docOnly.length ? docOnly : "none");
console.log("implemented but NOT documented:", implOnly.length ? implOnly : "none");
process.exit(docOnly.length + implOnly.length ? 1 : 0);
