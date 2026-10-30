"use strict";
// Secrets live in AWS Secrets Manager, not in files, images or task settings.
//
// When AWS_SECRET_ID is set, the secret (a JSON object of KEY: value) is read ONCE at startup, before the configuration is
// built, and the allow-listed keys below are placed in process.env. Credentials come from the AWS default chain (the IAM role
// of the ECS task / EC2 instance / App Runner service); no access keys are ever stored with the application.
// If the secret cannot be read the process stops: it never falls back to a development secret.
//
// Only keys in KEYS are accepted. Everything else (NODE_ENV, PORT, DATA_DIR ...) is ordinary configuration, not a secret.
// Values are never logged, and never appear in error messages.
const KEYS = ["JWT_SECRET", "SETUP_KEY", "GEMINI_API_KEY", "SMTP_PASS", "MFA_ENC_KEY", "METRICS_TOKEN", "LOADTEST_REMOTE_ACCOUNTS"];
const PERMANENT = new Set(["AccessDeniedException", "ResourceNotFoundException", "InvalidRequestException", "InvalidParameterException", "DecryptionFailure"]);

/** Default fetcher: AWS SDK v3, installed as an optional dependency. */
async function sdkFetch(secretId, region) {
  let sdk;
  try { sdk = require("@aws-sdk/client-secrets-manager"); }
  catch { throw Object.assign(new Error("AWS_SECRET_ID is set but @aws-sdk/client-secrets-manager is not installed. Run: npm install"), { name: "SdkMissing" }); }
  const client = new sdk.SecretsManagerClient(region ? { region } : {});
  try {
    const out = await client.send(new sdk.GetSecretValueCommand({ SecretId: secretId }));
    if (out.SecretString != null) return out.SecretString;
    return out.SecretBinary ? Buffer.from(out.SecretBinary).toString("utf8") : "";
  } finally { if (client.destroy) client.destroy(); }
}

function parse(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('the secret is not valid JSON. Store it as {"JWT_SECRET": "...", "SETUP_KEY": "..."}'); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error('the secret must be a JSON object such as {"JWT_SECRET": "..."}');
  return data;
}

async function load({ env = process.env, fetch = sdkFetch, log = console.log, retries = 3, delayMs = 400 } = {}) {
  const id = env.AWS_SECRET_ID;
  if (!id) return { source: "environment", loaded: [], ignored: [] };
  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || undefined;

  let text, last;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { text = await fetch(id, region); last = null; break; }
    catch (e) {
      last = e;
      if (PERMANENT.has(e && e.name) || e.name === "SdkMissing" || attempt === retries) break;
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  if (last) throw new Error(`Could not read the secret "${id}" from AWS Secrets Manager (${last.name || "Error"}: ${String(last.message).slice(0, 200)}).`);

  let data;
  try { data = parse(text); } catch (e) { throw new Error(`The secret "${id}" ${e.message}.`); }
  const loaded = [], ignored = [], replaced = [];
  for (const [k, v] of Object.entries(data)) {
    const value = v !== null && typeof v === "object" ? JSON.stringify(v) : (v == null ? "" : String(v));
    if (!KEYS.includes(k) || value === "") { ignored.push(k); continue; }
    if (env[k] && env[k] !== value) replaced.push(k);
    env[k] = value; loaded.push(k);
  }
  log(`[secrets] loaded ${loaded.length ? loaded.join(", ") : "nothing"} from AWS Secrets Manager (${id}).`);
  if (replaced.length) log(`[secrets] ${replaced.join(", ")} was also set in the environment; the value from Secrets Manager is used.`);
  if (ignored.length) log(`[secrets] ignored keys that are not accepted secrets: ${ignored.join(", ")}.`);
  return { source: "aws-secrets-manager", loaded, ignored };
}

module.exports = { load, KEYS };
