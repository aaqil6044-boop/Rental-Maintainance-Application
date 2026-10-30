"use strict";
// The ONLY places a load test may point at. The browser sends a target NAME; it can never send a URL.
//   local   -> this very server, found from the request's own socket (127.0.0.1:<port>), always allowed
//   others  -> LOADTEST_TARGETS="staging=https://staging.example.com", allowed only if LOADTEST_ALLOW_REMOTE=1
const config = require("../config");

const NAME = /^[a-z][a-z0-9_-]{1,30}$/;
const BLOCKED_HOSTS = [/^169\.254\./, /^0\./, /^metadata\.google\.internal$/i, /^fd00:ec2::254$/i, /^\[?::\]?$/, /^\[?fe80:/i];

function parse(raw = config.loadtest.targets) {
  const ok = [], rejected = [];
  for (const part of String(raw || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const eq = part.indexOf("="); const name = eq > 0 ? part.slice(0, eq).trim().toLowerCase() : "", url = eq > 0 ? part.slice(eq + 1).trim() : "";
    const why = (m) => rejected.push({ name: name || part.slice(0, 20), reason: m });
    if (!NAME.test(name)) { why("Name must be 2-31 lowercase letters, digits, - or _, starting with a letter."); continue; }
    if (name === "local") { why('"local" is reserved for this server.'); continue; }
    if (ok.some((t) => t.name === name)) { why("Duplicate name."); continue; }
    let u; try { u = new URL(url); } catch (e) { why("Not a valid URL."); continue; }
    if (!["http:", "https:"].includes(u.protocol)) { why("Only http and https are allowed."); continue; }
    if (u.username || u.password) { why("Credentials in the URL are not allowed."); continue; }
    if ((u.pathname && u.pathname !== "/") || u.search || u.hash) { why("Use only scheme://host[:port], with no path or query."); continue; }
    if (BLOCKED_HOSTS.some((r) => r.test(u.hostname))) { why("This address range is blocked (link-local, metadata or unspecified)."); continue; }
    ok.push({ name, origin: u.origin, host: u.host, scheme: u.protocol.slice(0, -1) });
  }
  return { targets: ok, rejected };
}

/** What the dashboard may show. No credentials, and only the host of a remote target. */
function describe() {
  const { targets, rejected } = parse();
  const remote = targets.map((t) => ({ name: t.name, kind: "remote", label: `${t.name} (${t.host})`, host: t.host, requiresConfirmation: true,
    available: config.loadtest.allowRemote && remoteAccounts().length > 0,
    reason: !config.loadtest.allowRemote ? "Remote testing is switched off. Set LOADTEST_ALLOW_REMOTE=1 to enable it."
      : remoteAccounts().length === 0 ? "No test accounts for remote targets. Set LOADTEST_REMOTE_ACCOUNTS." : null }));
  return { targets: [{ name: "local", kind: "local", label: "local (this server)", host: null, requiresConfirmation: false, available: true, reason: null }, ...remote], rejected };
}
const names = () => ["local", ...parse().targets.map((t) => t.name)];

/** Credentials for remote targets come from the environment only. Returns [] when absent or malformed. */
function remoteAccounts() {
  try {
    const list = JSON.parse(config.loadtest.remoteAccounts || "[]");
    return Array.isArray(list) ? list.filter((a) => a && ["tenant", "manager", "technician", "vendor", "admin"].includes(a.persona) && typeof a.email === "string" && typeof a.password === "string") : [];
  } catch (e) { return []; }
}

/**
 * Resolves a validated target name to a base URL, or throws {status, message}.
 * confirm must equal the target name for anything that is not local.
 */
function resolve(name, confirm, req) {
  if (name === "local") {
    const port = req && req.socket && req.socket.localPort;
    if (!port) throw Object.assign(new Error("Cannot determine this server's own address."), { status: 500 });
    return { name, kind: "local", baseUrl: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}` };
  }
  const t = parse().targets.find((x) => x.name === name);
  if (!t) throw Object.assign(new Error("That target is not configured."), { status: 400 });
  if (!config.loadtest.allowRemote) throw Object.assign(new Error("Testing against a remote target is switched off on this server (LOADTEST_ALLOW_REMOTE)."), { status: 403 });
  if (confirm !== t.name) throw Object.assign(new Error(`This is not a local target. Type the target name "${t.name}" to confirm you are authorised to load-test ${t.host}.`), { status: 400, field: "confirmTarget" });
  if (remoteAccounts().length === 0) throw Object.assign(new Error("No test accounts are configured for remote targets (LOADTEST_REMOTE_ACCOUNTS)."), { status: 400 });
  return { name, kind: "remote", baseUrl: t.origin, host: t.host };
}
module.exports = { parse, describe, names, resolve, remoteAccounts };
