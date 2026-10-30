"use strict";
// File store for performance reports: one folder per run with report.json and report.html. History = the folders on disk.
//   performance/reports/20261024-153000-smoke/report.json
//   performance/baselines/known-good.json         the reference a team has agreed is good (see `baseline set`)
const fs = require("fs"), path = require("path");
const RG = require("../../src/loadtest/regression");

const root = path.join(__dirname, "..");
const defaultDir = () => path.join(root, "reports");
const baselineFile = () => path.join(root, "baselines", "known-good.json");
const slug = (s) => String(s || "run").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "run";
const stampOf = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; } }

/** All stored reports, oldest first. Unreadable folders are skipped. */
function list(dir = defaultDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{8}-\d{6}/.test(d.name)).map((d) => d.name).sort()
    .map((name) => { const r = readJson(path.join(dir, name, "report.json")); return r && r.summary ? { ...r, id: r.id || name, _dir: path.join(dir, name) } : null; }).filter(Boolean);
}

/** A report from a folder name, a path to a folder or report.json, "latest", or a number counting back from the latest (1 = latest). */
function resolve(ref, dir = defaultDir()) {
  const all = list(dir); const r = String(ref == null ? "latest" : ref);
  if (r === "latest") return all[all.length - 1] || null;
  if (/^\d+$/.test(r) && all.length >= Number(r) && r.length < 4) return all[all.length - Number(r)];
  const byName = all.find((x) => path.basename(x._dir) === r || x.id === r); if (byName) return byName;
  for (const cand of [r, path.join(r, "report.json"), path.join(dir, r), path.join(dir, r, "report.json")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) { const j = readJson(cand); if (j && j.summary) return { ...j, id: j.id || path.basename(path.dirname(cand)), _dir: path.dirname(cand) }; }
  }
  return null;
}
function save(report, html, dir = defaultDir()) {
  const id = `${stampOf()}-${slug(report.name)}`; const folder = path.join(dir, id);
  fs.mkdirSync(folder, { recursive: true });
  const full = { ...report, id };
  fs.writeFileSync(path.join(folder, "report.json"), JSON.stringify(full));
  if (html) fs.writeFileSync(path.join(folder, "report.html"), html);
  return { id, folder, json: path.join(folder, "report.json"), html: path.join(folder, "report.html") };
}
function knownGood() { const r = readJson(baselineFile()); return r && r.summary ? { ...r, knownGood: true } : null; }
function setKnownGood(report) {
  fs.mkdirSync(path.dirname(baselineFile()), { recursive: true });
  const { _dir, comparison, ...rest } = report; fs.writeFileSync(baselineFile(), JSON.stringify({ ...rest, knownGood: true }));
  return baselineFile();
}
/**
 * Choose the baseline for `current`: "previous" = the latest earlier report measured under comparable conditions (falling back to the latest
 * earlier report, which will then be flagged INCONCLUSIVE), "known-good", or any report reference / path.
 */
function pickBaseline(current, spec, dir = defaultDir()) {
  const all = list(dir).filter((r) => r.id !== current.id && (!current._dir || r._dir !== current._dir));
  const earlier = all.filter((r) => (r.startedAt || r.id) <= (current.startedAt || "￿"));
  const how = String(spec || "previous");
  if (how === "previous") {
    const comp = earlier.filter((r) => RG.comparability(r, current).comparable);
    const base = comp[comp.length - 1] || earlier[earlier.length - 1];
    return base ? { base, how, history: comp.filter((r) => r !== base) } : { reason: "There is no earlier report to compare with yet. Run the same test again after your next change." };
  }
  if (how === "known-good") { const k = knownGood(); return k ? { base: k, how, history: all.filter((r) => RG.comparability(k, r).comparable) } : { reason: "No known-good baseline is set. Create one with: npm run loadtest:compare -- baseline set <report>" }; }
  const b = resolve(how, dir); return b ? { base: b, how: "selected", history: all.filter((r) => r !== b && RG.comparability(b, current).comparable) } : { reason: `Baseline "${how}" was not found.` };
}
module.exports = { defaultDir, baselineFile, list, resolve, save, knownGood, setKnownGood, pickBaseline, stampOf, slug };
