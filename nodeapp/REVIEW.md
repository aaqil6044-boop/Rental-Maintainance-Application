# EstateOps full review: gaps and configuration

Review date: 30 October 2026. This follows the security audit ([SECURITY.md](SECURITY.md)) and looks at everything else needed to run the application for real: correctness, data safety, operations, scalability and configuration.

## 1. Gaps found and fixed

| # | Severity | Gap | Fix |
|---|---|---|---|
| G-1 | High | **No backup tool.** The only advice was "use sqlite3 .backup" by hand. A lost disk meant lost tenant data. | `npm run backup`: a consistent copy of the database and uploads, safe while the app runs, verified with SQLite's integrity check, with a manifest and automatic pruning (keeps 14). Tested against the live database. |
| G-2 | High | **Dates shown in the server's time zone.** In a container (UTC) every Indian user would see times 5½ hours early, and "overdue" would flip at the wrong hour. | `TIMEZONE` setting (default: the server's zone, as before). All dates and the overdue test use it. Tested for UTC, Asia/Kolkata and America/New_York including daylight saving. |
| G-3 | Medium | **Random connection errors behind a load balancer.** Node closes idle connections after 5 s; an AWS load balancer keeps them for 60 s and then sends a request down a dead connection. | Keep-alive set to 65 s (`HTTP_KEEPALIVE_MS`). |
| G-4 | Medium | **Stopping the server dropped running requests** and left the database file open. | On stop (`SIGTERM`/`Ctrl+C`) the server refuses new connections, lets running requests finish (up to `SHUTDOWN_TIMEOUT_MS`), closes the database and exits 0. Tested: a sign-in in progress still gets its answer. |
| G-5 | Medium | **A bug that escaped every handler** left the process running in an unknown state. | Uncaught errors are logged and the process exits so the platform restarts a clean one. |
| G-6 | Medium | **Missing database indexes.** Every request list joins requests to units, and the request page reads history, comments and expenses by request, all by full table scan. Fine with 100 rows, slow with 100,000. | Migration 6 adds seven indexes. Tested that the history lookup uses an index. |
| G-7 | Medium | **Due date accepted any text** (`not-a-date` was stored and shown). | Must be a real `YYYY-MM-DD` date, otherwise 400. |
| G-8 | Low | **No automated checks on code changes.** | GitHub Actions workflow: tests, unit tests, `npm audit`, Docker build on every push. (Written but not run from here; it runs the first time you push to GitHub.) |
| G-9 | Low | Node version declared as 18, but the launch config files need 20.6. | `engines` now `>=20.6`. |
| G-10 | Low | README out of date (backup, secrets, config). | Updated. |

## 2. Settings moved out of the code

These were fixed numbers inside the application. They are now settings with the **same defaults** (nothing changes unless you set them), read from the environment or a `config/*.env` file. A value that is not a number or is out of range **stops startup and names the variable**.

| Group | Settings (default) |
|---|---|
| Time | `TIMEZONE` (server's zone) |
| Sign-in | `BCRYPT_ROUNDS` (10) · `PASSWORD_MIN_LENGTH` (8) · `LOGIN_MAX_FAILURES` (8) · `LOGIN_LOCKOUT_MIN` (15) · `RESET_LINK_HOURS` (24) |
| Abuse limits | `RL_WINDOW_MIN` (15) · `RL_REGISTER_MAX` (20) · `RL_REGISTER_WINDOW_MIN` (60) · `RL_LOGIN_MAX` (60) · `RL_SETUP_MAX` (10) · `RL_TOKEN_MAX` (30) · `RL_PASSWORD_MAX` (8) |
| Size and paging | `BODY_LIMIT` (100kb) · `MAX_ATTACHMENTS` (10) · `PAGE_SIZE_DEFAULT` (100) · `PAGE_SIZE_MAX` (200) · `MAX_AMOUNT` (10,000,000) |
| Server | `HTTP_KEEPALIVE_MS` (65000) · `SHUTDOWN_TIMEOUT_MS` (10000) |
| Cache | `CACHE_TTL_SCALE` (1) |
| Insights | `INSIGHTS_WINDOW_DAYS` (90) · `INSIGHTS_RECURRING_MIN` (2) · `INSIGHTS_COST_FACTOR` (2) |
| Backup | `BACKUP_DIR` (backups) · `BACKUP_KEEP` (14) |

Already settings before this review: `NODE_ENV`, `PORT`, `DATA_DIR`, `UPLOAD_DIR`, `JWT_TTL`, `INVITE_TTL_DAYS`, `MAX_UPLOAD_BYTES`, `TRUST_PROXY`, `CORS_ORIGIN`, `RATE_LIMIT`, `SELF_REGISTRATION`, `DOCS`, `CACHE`, `CACHE_MAX_ENTRIES`, `LOG_REQUESTS`, the Gemini and load-test settings. Full list with meanings: `.env.example` and [config/README.md](config/README.md). Secrets stay out of files (AWS Secrets Manager, see [AWS-SECRETS.md](AWS-SECRETS.md)).

**Deliberately left in code.** The request statuses and the allowed moves between them, roles, categories, priorities, field length limits and upload types. The database, every screen and the tests depend on them, so changing one is a change to the application, not a setting. If you need your own categories later, that is a small feature (store them in the database), not a config line.

## 3. Gaps that remain (need your decision or a larger piece of work)

> **Update, 30 October 2026 — "fix everything".** R-1, R-2, R-4 to R-11 are now done; the table below is kept for the record with what was built. Only R-3 (PostgreSQL) and R-12 (a first real AWS/GitHub run) remain, and neither can be done from here. Details in section 6.

| # | Severity | Gap | What to do |
|---|---|---|---|
| ~~R-1~~ **done** | High for real use | **No email.** Invitations and password-reset links are shown to the manager, who must send them by hand. There is no "forgot my password" for users. | Add email delivery (Amazon SES or SMTP) for invitations, resets and notifications. This is the most useful next feature. |
| ~~R-2~~ **done** | Medium | **Tenant sign-up can be abused** (a stranger registers a tenant's email before the manager links it). | Set `SELF_REGISTRATION=0` and use invitations, or add email verification. |
| R-3 | Medium | **One machine only.** SQLite cannot be shared by several servers, so there is no failover or multi-instance scaling on AWS. | Move to PostgreSQL (Amazon RDS) when you need more than one server. The code isolates database access in `store.js`, but it is a real migration. |
| ~~R-4~~ **done** | Medium | **Personal-data duties.** No way to export or delete a person's data, and no retention rule for old requests, audit entries and uploads. Indian (DPDP) and EU rules expect both. | Add export and delete/anonymize actions and a retention setting. |
| ~~R-5~~ **done** | Medium | **Thin monitoring.** Logs are plain text with no request ID, there is no metrics endpoint and no error alerting. | Structured JSON logs with a request ID, a `/metrics` endpoint, alerts on 5xx and on bursts of 401/429. |
| ~~R-6~~ **done** | Low | Signing out on one device signs out every device. | Per-session tokens instead of one counter per account. |
| ~~R-7~~ **done** | Low | No malware scanning of uploads (type is verified by content, but a PDF can still carry harmful content). | Add a scanner (ClamAV or an S3 scanning service) before wider use. |
| ~~R-8~~ **done** | Low | Two managers acting at the same instant in different server processes could both pass a status check (inside one process this cannot happen). Only relevant if you run several processes on one database. | Make the status update conditional (`WHERE status = ?`). |
| ~~R-9~~ **done** | Low | No second factor (MFA); 12-hour sessions with no idle timeout. | Add MFA for managers. |
| ~~R-10~~ **done** | Low | Pages load fonts from Google. | Self-host the fonts. |
| ~~R-11~~ **done** | Low | The newer load-test routes (data check, trends, regression, known-good, HTML export) have behaviour tests but are not in the OpenAPI contract test. | Add them to `tests/spec.test.js`. |
| R-12 | Info | The AWS secret loader and the CI workflow have not been run against a real AWS account / GitHub. | First start in staging; first push to GitHub. |

## 4. What was checked and is sound

Role and organization isolation, SQL queries (all parameterized), validation of every input field, the request lifecycle rules (only allowed moves, who may make them), expense approval limits and the "recorder cannot approve" rule, the audit log, attachment handling, response caching (never shows another user's or stale data), the load-testing tool's safety limits, and 0 known dependency vulnerabilities.

## 6. What "fix everything" delivered

| Was | Now |
|---|---|
| R-1 No email | Invitations, manager-issued resets and address confirmations are emailed (SMTP or Amazon SES). Without a mail server every message is written to `data/outbox/*.json`, so development and tests send nothing. A mail failure never fails the request: the manager still gets the link, and the answer says `emailed: false`. **Self-service "forgot password"** on the sign-in page: single-use, time-limited link, the same answer for a known and an unknown address, 3 per address per hour. |
| R-2 Sign-up abuse | A public sign-up must confirm the email address before a manager can link them to a home by email (`REQUIRE_EMAIL_VERIFICATION`, on by default in production with email configured). Invited, manager-created and existing accounts count as confirmed. |
| R-4 Personal data | **Download my data** (everything held about the person, as JSON) and **erase my account** (password plus the word DELETE); a manager can erase someone who has left, after deactivating them. Name, email, phone, free text, notifications, sessions and recovery codes go; maintenance history stays as "Deleted user". The last administrator must hand over first. `npm run retention` applies `RETENTION_REQUEST_DAYS` and `RETENTION_AUDIT_DAYS` (unset = keep for ever); `--dry-run` shows what would go. |
| R-5 Thin monitoring | A request id on every answer (`X-Request-Id`, or a sane one the proxy sent), JSON logs in production with that id, and `/metrics` in Prometheus format behind `METRICS_TOKEN` (absent = the endpoint does not exist): requests by route pattern and status class, latency histogram, 5xx, sign-in failures, 429s, in-flight requests, uptime and memory. Route labels are patterns, never raw ids, so the metric count stays bounded. |
| R-6 One sign-out for all devices | Each sign-in is its own session. Signing out ends that device only; Account → *Where you are signed in* lists them (device, address, last activity) and can end any one; *Sign out everywhere*, a password change and deactivation end all. At most 20 live sessions per account. |
| R-7 No malware scanning | Optional ClamAV (clamd) scan of every upload before it is written to disk. Configured but unreachable = the upload is refused (`SCAN_FAIL_OPEN=1` to accept instead). Tested against a stand-in scanner: clean, infected, unclear answer, timeout and unreachable. |
| R-8 Two managers at the same instant | Status, assignment, expense approval, quotation and AI-suggestion decisions only apply if the record still looks as it did when the person loaded it; otherwise 409 "reload and try again". |
| R-9 No MFA, no idle timeout | Two-factor sign-in with an authenticator app (RFC 6238, checked against the published test vectors), ten single-use recovery codes, the key stored encrypted, replayed codes refused, wrong codes limited. Optional per person; `MFA_REQUIRED_FOR_MANAGERS=1` makes it compulsory for managers. A manager can reset it for a lost phone. `SESSION_IDLE_MIN` (120 minutes in production) signs out after inactivity. |
| R-10 Google fonts | The three fonts are served by the application (`public/fonts`, SIL Open Font License). No page contacts a third party, and the content policy no longer permits it. A browser test fails if any request leaves the site. |
| R-11 Load-test routes not in the contract test | Added: data check, trends, regression, known-good, HTML and CSV export, including the content types. |

**Also fixed along the way:** a button whose submit failed kept saying "Working…" for ever (every form on the page was affected).

## 7. Still not possible from here

- **R-3 PostgreSQL.** This is a rewrite of the data layer (about 90 queries, SQLite-specific types and transactions) plus a migration of live data, and it cannot be tested from here against Amazon RDS. It is only needed when you must run more than one server. Say the word and it can be planned as a piece of work in its own right.
- **R-12 First real run.** The AWS secret loader and the GitHub Actions workflow are written and unit-tested, but have never run against a real AWS account or GitHub. They will be exercised the first time you start in staging and the first time you push.
- **Still your decision:** `SELF_REGISTRATION=0` (invitation-only tenants). With email confirmation now in place this is less pressing, but it remains the strongest setting.

## 5. Tests

All suites pass: API 291 · migrations 18 · seed 11 · API contract 369 · cache 54 · security 53 · AWS secrets 28 · operations 40 · **hardening 27 (new)** · **email 40 (new)** · **sessions and two-factor 82 (new)** · **personal data 40 (new)** · load-test API 119 · unit 51 · load-test engine · scale-out 8 · autoscaling 12 · browser suite including **8 new sign-in security tests**.
