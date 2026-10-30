# Launch configuration files

Each file is a list of `NAME=value` lines. Pick one when you start the app:

| Command | File | Use |
|---|---|---|
| `npm run start:local` | `config/local.env` | Development with sample data |
| `npm run start:prod` | `config/production.env` (copy of `production.env.example`) | Production-like, empty database |
| `node --env-file=config/staging.env bootstrap.js` | any file you name | Anything else |

**Override at launch.** A variable already set in your shell wins over the file:
```powershell
$env:PORT="9000"; $env:SELF_REGISTRATION="0"; npm run start:local
```

**Secrets never go in these files.** `JWT_SECRET`, `SETUP_KEY`, `GEMINI_API_KEY` come from AWS Secrets Manager (set `AWS_SECRET_ID` and `AWS_REGION` in the file) or from your shell. `config/*.env` is git-ignored except `local.env` and the `.example` files.

All variables and their meaning: see `.env.example`.

## What can be set

Everything below is optional. A missing line keeps the default; a value that is not a number or is out of range **stops the app at startup and names the variable**, so a typo is never silently ignored. `.env.example` lists every variable with its default and meaning.

| Group | Variables |
|---|---|
| Mode and data | `NODE_ENV`, `PORT`, `DATA_DIR`, `UPLOAD_DIR`, `TIMEZONE`, `TRUST_PROXY` |
| Sign-up and sign-in | `SELF_REGISTRATION`, `PASSWORD_MIN_LENGTH`, `BCRYPT_ROUNDS`, `LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_MIN`, `JWT_TTL`, `INVITE_TTL_DAYS`, `RESET_LINK_HOURS` |
| Abuse limits | `RATE_LIMIT`, `RL_WINDOW_MIN`, `RL_REGISTER_MAX`, `RL_REGISTER_WINDOW_MIN`, `RL_LOGIN_MAX`, `RL_SETUP_MAX`, `RL_TOKEN_MAX`, `RL_PASSWORD_MAX` |
| Size and paging | `BODY_LIMIT`, `MAX_UPLOAD_BYTES`, `MAX_ATTACHMENTS`, `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX`, `MAX_AMOUNT` |
| Server behaviour | `HTTP_KEEPALIVE_MS`, `SHUTDOWN_TIMEOUT_MS`, `LOG_REQUESTS`, `LOG_FORMAT`, `METRICS_TOKEN`, `DOCS` |
| Email | `MAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `MAIL_FROM`, `APP_URL`, `REQUIRE_EMAIL_VERIFICATION`, `VERIFY_LINK_HOURS`, `RL_FORGOT_MAX`, `RL_FORGOT_EMAIL_MAX` |
| Sessions and two-factor | `SESSION_IDLE_MIN`, `MAX_SESSIONS`, `MFA_REQUIRED_FOR_MANAGERS`, `RL_MFA_MAX` |
| Upload scanning | `SCAN_CLAMD_HOST`, `SCAN_CLAMD_PORT`, `SCAN_TIMEOUT_MS`, `SCAN_FAIL_OPEN` |
| Retention | `RETENTION_REQUEST_DAYS`, `RETENTION_AUDIT_DAYS` |
| Caching | `CACHE`, `CACHE_MAX_ENTRIES`, `CACHE_TTL_SCALE` |
| Insights | `INSIGHTS_WINDOW_DAYS`, `INSIGHTS_RECURRING_MIN`, `INSIGHTS_COST_FACTOR` |
| Load testing | `LOADTEST_ENABLED`, `LOADTEST_MAX_VUS`, `LOADTEST_MAX_DURATION_SEC`, `LOADTEST_MAX_REQUESTS`, `LOADTEST_MAX_CREATES`, `LOADTEST_TARGETS`, `LOADTEST_ALLOW_REMOTE` |
| AI | `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS` |
| Secrets (never in these files) | `JWT_SECRET`, `SETUP_KEY`, `GEMINI_API_KEY`, `SMTP_PASS`, `MFA_ENC_KEY`, `METRICS_TOKEN`, `LOADTEST_REMOTE_ACCOUNTS`; or `AWS_SECRET_ID` + `AWS_REGION` |

**Deliberately left in code:** the request statuses, the allowed moves between them, the roles, categories and priorities, field length limits, and the allowed upload types. The database, the screens and the tests all depend on them, so changing them is a change to the application, not a setting.

## Backups

```powershell
npm run backup                              # writes backups\estateops-<time>\ (database + uploads), verified
node scripts/backup.js --out D:\safe --keep 30
```
Safe while the app is running. Restore: stop the app, copy `estateops.db` and `uploads\` back into the data folder.
