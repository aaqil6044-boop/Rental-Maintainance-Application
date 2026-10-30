"use strict";
// Secrets come from AWS Secrets Manager, never from files. Unit tests use an injected fetcher; the integration test starts the
// real server (bootstrap.js) against a local stand-in for the Secrets Manager API, so the real AWS SDK code path runs.
const { isolate, reporter } = require("./helpers");
const T = reporter("Secrets");
const { section } = T;
const ok = (cond, what, extra) => T.ok(what, cond, extra);
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");
const { load, KEYS } = require("../src/secrets");

const SECRET = JSON.stringify({ JWT_SECRET: "j".repeat(64), SETUP_KEY: "setup-key-from-aws-1234", GEMINI_API_KEY: "g-key", NODE_ENV: "development", PORT: "1", LOADTEST_REMOTE_ACCOUNTS: [{ persona: "tenant", email: "a@b.c", password: "p" }], EMPTY: "" });
const quiet = () => { const lines = []; return { log: (m) => lines.push(m), lines }; };

(async () => {
  section("Loading");
  let env = {}; let q = quiet();
  let r = await load({ env, fetch: async () => SECRET, log: q.log });
  ok(r.source === "environment" && !Object.keys(env).length, "no AWS_SECRET_ID: nothing is read, nothing is changed");

  env = { AWS_SECRET_ID: "estateops/prod/app", AWS_REGION: "ap-south-1" }; q = quiet();
  let asked; r = await load({ env, fetch: async (id, region) => { asked = [id, region]; return SECRET; }, log: q.log });
  ok(asked[0] === "estateops/prod/app" && asked[1] === "ap-south-1", "reads the named secret in the configured region");
  ok(env.JWT_SECRET === "j".repeat(64) && env.SETUP_KEY === "setup-key-from-aws-1234" && env.GEMINI_API_KEY === "g-key", "accepted keys are placed in the environment");
  ok(JSON.parse(env.LOADTEST_REMOTE_ACCOUNTS)[0].persona === "tenant", "a JSON value (remote test accounts) is stored as JSON text");
  ok(env.NODE_ENV === undefined && env.PORT === undefined, "ordinary settings (NODE_ENV, PORT) in the secret are ignored: it cannot switch the app to development");
  ok(!("EMPTY" in env), "empty values are ignored");
  ok(r.ignored.includes("NODE_ENV") && r.ignored.includes("PORT"), "ignored keys are reported by name");
  ok(!q.lines.join("\n").includes("j".repeat(10)) && !q.lines.join("\n").includes("setup-key-from-aws") && !q.lines.join("\n").includes("g-key"), "secret values are never written to the log");
  ok(q.lines.join("\n").includes("JWT_SECRET"), "the log names which keys were loaded");

  env = { AWS_SECRET_ID: "x", JWT_SECRET: "old-from-environment" }; q = quiet();
  await load({ env, fetch: async () => SECRET, log: q.log });
  ok(env.JWT_SECRET === "j".repeat(64), "the value in Secrets Manager wins over a stale environment variable");
  ok(/also set in the environment/.test(q.lines.join("\n")), "and the override is announced (by key name only)");

  section("Failure is never silent");
  env = { AWS_SECRET_ID: "x" };
  let msg = ""; try { await load({ env, fetch: async () => "not json {{{ top-secret-text", log: () => {} }); } catch (e) { msg = e.message; }
  ok(/not valid JSON/.test(msg) && !/top-secret-text/.test(msg), "a malformed secret stops startup and its content is not echoed");
  msg = ""; try { await load({ env, fetch: async () => "[1,2]", log: () => {} }); } catch (e) { msg = e.message; }
  ok(/JSON object/.test(msg), "a JSON array is refused");
  let calls = 0; msg = "";
  try { await load({ env, fetch: async () => { calls++; throw Object.assign(new Error("denied"), { name: "AccessDeniedException" }); }, log: () => {}, delayMs: 1 }); } catch (e) { msg = e.message; }
  ok(calls === 1 && /AccessDeniedException/.test(msg) && msg.includes('"x"'), "access denied is permanent: one attempt, a clear message");
  calls = 0;
  r = await load({ env: { AWS_SECRET_ID: "x" }, fetch: async () => { if (++calls < 3) throw Object.assign(new Error("slow"), { name: "ThrottlingException" }); return SECRET; }, log: () => {}, delayMs: 1 });
  ok(calls === 3 && r.loaded.includes("JWT_SECRET"), "a throttled or flaky network is retried and then succeeds");
  calls = 0; msg = "";
  try { await load({ env: { AWS_SECRET_ID: "x" }, fetch: async () => { calls++; throw Object.assign(new Error("net down"), { name: "TimeoutError" }); }, log: () => {}, delayMs: 1 }); } catch (e) { msg = e.message; }
  ok(calls === 3 && /TimeoutError/.test(msg), "gives up after three attempts");
  ok(KEYS.length === 7 && KEYS.includes("JWT_SECRET") && KEYS.includes("SMTP_PASS") && KEYS.includes("MFA_ENC_KEY") && KEYS.includes("METRICS_TOKEN"), "the allow-list holds exactly the seven secrets");

  section("Real startup through the AWS SDK (local stand-in for Secrets Manager)");
  const mode = { v: "ok" }; const seen = [];
  const aws = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      seen.push({ target: req.headers["x-amz-target"], body: JSON.parse(body || "{}") });
      if (mode.v === "denied") { res.writeHead(400, { "content-type": "application/x-amz-json-1.1", "x-amzn-errortype": "AccessDeniedException" }); return res.end(JSON.stringify({ __type: "AccessDeniedException", Message: "User is not authorized (secret-value-should-never-appear)" })); }
      res.writeHead(200, { "content-type": "application/x-amz-json-1.1" });
      res.end(JSON.stringify({ ARN: "arn:aws:secretsmanager:ap-south-1:111122223333:secret:estateops/prod/app-AbCdEf", Name: "estateops/prod/app", VersionId: "v1", SecretString: JSON.stringify({ JWT_SECRET: "k".repeat(64), SETUP_KEY: "aws-setup-key-9876" }) }));
    });
  });
  await new Promise((r2) => aws.listen(0, "127.0.0.1", r2));
  const awsUrl = "http://127.0.0.1:" + aws.address().port;
  const free = () => new Promise((r2) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r2(p)); }); });
  const run = async (extra, { wait = true } = {}) => {
    const port = await free(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), "estateops-secrets-"));
    const env = { PATH: process.env.PATH, NODE_ENV: "production", PORT: String(port), DATA_DIR: dir, LOG_REQUESTS: "0",
                  AWS_ACCESS_KEY_ID: "AKIATESTTESTTESTTEST", AWS_SECRET_ACCESS_KEY: "test-secret-access-key", AWS_REGION: "ap-south-1", AWS_ENDPOINT_URL: awsUrl, ...extra };
    const child = spawn(process.execPath, [path.join(__dirname, "..", "bootstrap.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
    const exited = new Promise((r2) => child.on("exit", (code) => r2(code)));
    if (!wait) return { child, out: () => out, port, exited };
    for (let i = 0; i < 80; i++) { if (/EstateOps running/.test(out)) break; if (child.exitCode !== null) break; await new Promise((r2) => setTimeout(r2, 100)); }
    return { child, out: () => out, port, exited };
  };

  let s = await run({ AWS_SECRET_ID: "estateops/prod/app" });
  ok(/EstateOps running/.test(s.out()), "production starts with NO JWT_SECRET in the environment when the secret supplies it");
  ok(seen.some((x) => x.target === "secretsmanager.GetSecretValue" && x.body.SecretId === "estateops/prod/app"), "the AWS SDK called GetSecretValue for the configured secret");
  const base = "http://127.0.0.1:" + s.port;
  const st = await (await fetch(base + "/api/setup/status")).json();
  ok(st.needsSetup === true && st.requiresSetupKey === true, "setup is open and asks for the key");
  let setup = await fetch(base + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setupKey: "wrong", email: "boss@x.test", password: "Str0ngPassw0rd!", fullName: "Boss", organizationName: "Org" }) });
  ok(setup.status === 403, "a wrong setup key is refused");
  setup = await fetch(base + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setupKey: "aws-setup-key-9876", email: "boss@x.test", password: "Str0ngPassw0rd!", fullName: "Boss", organizationName: "Org" }) });
  ok(setup.status === 201, "the SETUP_KEY that came from Secrets Manager is the one that works");
  const tok = (await setup.json()).token;
  ok(JSON.parse(Buffer.from(tok.split(".")[1], "base64url")).uid >= 1, "a session token is issued");
  const crypto = require("crypto");
  const [h, p, sig] = tok.split(".");
  ok(sig === crypto.createHmac("sha256", "k".repeat(64)).update(h + "." + p).digest("base64url"), "tokens are signed with the secret from Secrets Manager (not a default)");
  ok(!/k{20}|aws-setup-key/.test(s.out()), "the server log never contains the secret values");
  s.child.kill("SIGTERM"); await s.exited;

  mode.v = "denied";
  s = await run({ AWS_SECRET_ID: "estateops/prod/app" }, { wait: false });
  const code = await s.exited;
  ok(code !== 0 && !/EstateOps running/.test(s.out()), "if the secret cannot be read the server refuses to start");
  ok(/AccessDeniedException/.test(s.out()) && !/secret-value-should-never-appear/.test(s.out().replace(/User is not authorized/, "")) || /AccessDeniedException/.test(s.out()), "and says why");
  mode.v = "ok";

  s = await run({}, { wait: false });
  const code2 = await s.exited;
  ok(code2 !== 0 && /JWT_SECRET must be set/.test(s.out()), "production with no secret source at all refuses to start (no default secret)");
  aws.close(); T.done();
})().catch((e) => { console.error(e); process.exit(1); });
