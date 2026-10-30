# EstateOps security audit and go-live checklist

Audit date: 29 October 2026. Scope: the whole application (server, API, pages, uploads, configuration, container, dependencies, load-test module).

**Method.** Code review of every route and the data layer · about 100 automated attack probes against a running copy (development and production mode) · a browser test that stores script payloads in every free-text field and opens every screen as all four roles · `npm audit` · a regression suite (`npm run test:security`, 53 checks) so the fixes below stay fixed.

**Verdict.** No critical or high-severity defect was found. Data isolation between organizations and between roles held under every attack tried. Fourteen low and medium weaknesses were found and fixed. Four items need a decision from you before launch (section 3). The go-live checklist is in section 4.

---

## 1. What was attacked and held

| Area | Result |
|---|---|
| Anonymous access | All 69 non-public endpoints refuse a request with no token. |
| Organization isolation | More than 20 attempts by a manager of organization B against organization A (read, change, assign, comment, expense, approve, deactivate, reset password, upload, list) were all refused. Lists, dashboard, audit log and team list contained no foreign rows. |
| Roles | Tenants, technicians and vendors are refused on every manager page; a manager who is not an admin cannot add managers, reset or deactivate an admin, edit the organization, or use load testing. Self-registration ignores any `role`, `orgId` or `orgAdmin` sent; profile update cannot escalate. |
| Tokens | `alg: none`, wrong secret, and the development secret are refused. Tokens die on logout, deactivation and password change. In production the server refuses to start without a 32+ character secret. |
| SQL injection | Every query is parameterized. Injection strings in search, filters and login are inert; objects and arrays in place of strings are refused. |
| Cross-site scripting | Payloads in 20+ fields (names, organization, property, unit, vendor, request title and description, comments, notes, expenses, completion notes, file names, invitation page, login redirect) did not run on any screen for any role. All output is escaped. |
| Uploads | Type is decided from the file's bytes: HTML, SVG, and an executable disguised as PDF are refused; a PNG carrying script is served as `image/png` with `nosniff`; file names cannot carry a path; size and per-request count limits hold. |
| File exposure | `/package.json`, `/server.js`, `/.env`, `/src/*`, `/data/*`, `/.git`, `/node_modules`, traversal tricks: none downloadable. |
| Passwords and secrets | bcrypt hashes, never returned by any endpoint. No hard-coded secrets. Invitation and reset tokens are 256-bit random values stored only as hashes. Setup is single-use and needs `SETUP_KEY` in production. |
| Dependencies | `npm audit --omit=dev`: 0 known vulnerabilities. |
| Load-test module | Admin-only, off in production by default, absolute ceilings in code, remote targets need an allow-list plus typed confirmation, fixture accounts get random passwords and are deactivated afterwards. |

## 2. Weaknesses found and fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| S-1 | Medium | Sign-up had no limit: 60 accounts were created in 5.5 s, each costing a password hash (CPU exhaustion, database spam). | Sign-up is limited to 20 per hour per address. |
| S-2 | Medium | Password spraying (one guess against many emails) was not limited; only repeated guesses for one email were. | 60 failed sign-ins per 15 minutes per address. Successful sign-ins never count, so offices behind one address are not locked out. |
| S-3 | Medium | A stolen token could guess the current password through *change password* without limit. | 8 failures per 15 minutes per account. |
| S-4 | Medium | The first-run setup key could be guessed without limit (30 tries in a row). | 10 failures per 15 minutes per address. |
| S-5 | Medium | Sign-in answered in 3 ms for an unknown email and 85 ms for a known one: anyone could list which emails have accounts. | Unknown emails now pay for the same password check (113 ms vs 107 ms measured). |
| S-6 | Medium | No Content-Security-Policy, so a future script-injection bug would run freely and could read the stored session. | Pages may run only their own scripts (no inline script, no `eval`), connect only to this site, cannot be framed or embed plugins. Inline scripts moved to `login.js` and `accept.js`. |
| S-7 | Low | Account data in API answers could be kept by a browser or shared proxy. | `Cache-Control: no-store` on every API answer. |
| S-8 | Low | Passwords such as `12345678` were accepted. | New passwords are checked against common passwords, repeated or consecutive patterns, and the person's own email name. Existing accounts are unaffected until they change password. |
| S-9 | Low | The interactive API documentation was public in production, a full map of the API. | `/docs` and `/openapi.json` are off in production unless `DOCS=1`. |
| S-10 | Low | Downloaded attachments had no sandboxing policy (a PDF opens inline). | Served with `Content-Security-Policy: sandbox`, `Cross-Origin-Resource-Policy: same-origin`. |
| S-11 | Low | A server error carrying a database `code` would have returned the raw database message to the client. | Only messages the application wrote are shown for server errors; the code is no longer returned. |
| S-12 | Low | The container ran as root. | Runs as the unprivileged `node` user; only `/data` is writable. |
| S-13 | Low | The token algorithm was not pinned on verification. | Pinned to HS256 for issue and verify. |
| S-14 | Low | The failed-sign-in table could grow without bound under a flood of made-up emails. | Swept and capped. |

## 2b. Added after the audit (30 October 2026)

| Area | What it does |
|---|---|
| Two-factor sign-in | Optional for anyone, compulsory for managers with `MFA_REQUIRED_FOR_MANAGERS=1`. Authenticator app (TOTP, RFC 6238, verified against the published test vectors), ten single-use recovery codes, the stored key encrypted with AES-256-GCM, a used code refused if replayed, eight wrong codes locking the account for 15 minutes. A manager can switch it off for someone who lost their phone. |
| One session per device | The token now names its own session. Signing out ends that device only; *Sign out everywhere*, a password change or deactivation ends all of them. Account → *Where you are signed in* lists them with device, address and last activity. At most 20 live sessions per account. |
| Idle timeout | `SESSION_IDLE_MIN` (120 minutes in production) signs a session out after inactivity, with a clear message. |
| Self-service password reset | Emailed, single-use, time-limited link; the answer is the same for a known and an unknown address, so it cannot be used to find out who is registered. Limited to 3 per address per hour. |
| Email confirmation | A public sign-up must confirm the address before a manager can link them to a home by email (`REQUIRE_EMAIL_VERIFICATION`, on by default in production with email configured). This closes the pre-registration weakness in item 1 below. |
| Malware scanning of uploads | Optional ClamAV scan before the file is written to disk. If a scanner is configured but unreachable, the upload is refused. |
| Lost-update protection | Status, assignment, expense-approval and quotation changes now only apply if the record still looks as it did when the person loaded it; otherwise 409 and "reload and try again". |
| Monitoring | A request id on every answer (`X-Request-Id`), structured JSON logs, and `/metrics` (Prometheus) behind `METRICS_TOKEN` with counters for 5xx, 401 on sign-in, and 429. |
| Personal data | Each person can download everything held about them and erase their account; a manager can erase someone who has left; `npm run retention` applies retention periods. |
| Fonts | Self-hosted. No page contacts Google any more, and the policy no longer allows it. |

## 3. Decisions for you before launch

1. **Sign-up and tenant linking (Medium, design).** Anyone can sign up as a tenant, and a manager can link a tenant to a unit by typing their email. No one verifies that a sign-up owns the email. If a stranger registers `jane@example.com` first, the manager who then links "Jane" gives the stranger access to her unit's requests. **Recommended:** set `SELF_REGISTRATION=0` and onboard tenants by invitation (the invitation link proves the email). The login page hides the Sign up tab automatically. Otherwise add email verification before using the link-by-email feature.
2. **Session storage (Low–Medium, accepted).** The sign-in token lives in the browser's `localStorage`. No script injection exists today and the new policy blocks injected scripts, so this is acceptable. Moving to an `HttpOnly` cookie would remove the exposure but needs CSRF protection and is a larger change.
3. **Sign-up reveals whether an email is registered (Low, accepted).** Hiding it would break the "this email already has an account" message and there is no email delivery to carry the alternative. The sign-up limit makes bulk checking impractical.
4. ~~No second factor, no email sending, 12-hour sessions with no idle timeout.~~ **Done** (section 2b): two-factor sign-in, email delivery, self-service reset and an idle timeout are in. Decide whether to set `MFA_REQUIRED_FOR_MANAGERS=1`.

## 4. Go-live checklist

**Environment (see `.env.example`) and secrets (see `AWS-SECRETS.md`)**
- [ ] `NODE_ENV=production`
- [ ] Secrets in **AWS Secrets Manager**, not in files or task settings: `JWT_SECRET` (48 random bytes), `SETUP_KEY`, optional `GEMINI_API_KEY`. The app reads them at start with its IAM role (`AWS_SECRET_ID`, `AWS_REGION`) and refuses to start if it cannot
- [ ] IAM role limited to `secretsmanager:GetSecretValue` on that one secret; CloudTrail on
- [ ] `SETUP_KEY` used for first start, **removed from the secret after the first manager exists**
- [ ] `SELF_REGISTRATION=0` if you choose the recommendation above (or rely on `REQUIRE_EMAIL_VERIFICATION`, on by default in production with email configured)
- [ ] Email: `SMTP_HOST`, `SMTP_USER`, `MAIL_FROM`, `APP_URL`; `SMTP_PASS` in Secrets Manager
- [ ] `MFA_REQUIRED_FOR_MANAGERS=1` if managers must use an authenticator app
- [ ] `METRICS_TOKEN` (16+ characters, in Secrets Manager) if you scrape `/metrics`
- [ ] `SCAN_CLAMD_HOST` if uploads must be scanned for malware
- [ ] `TRUST_PROXY=1` **only** if a reverse proxy sets `X-Forwarded-For`; otherwise unset (a directly exposed app with this set lets clients fake their address and dodge the limits)
- [ ] Leave `DOCS`, `LOADTEST_ENABLED` unset (both off in production)

**Network**
- [ ] HTTPS terminated at the proxy with a valid certificate; HTTP redirected to HTTPS (the app sends HSTS in production)
- [ ] Only the proxy can reach port 8080; the SQLite file is not on a shared or public path
- [ ] Add the same limits on the proxy for `/api/auth/*` and `/api/setup` (the app's limits are per process)

**Data**
- [ ] Back up `DATA_DIR` (database plus `uploads`) on a schedule and test a restore
- [ ] `DATA_DIR` on a persistent volume with disk alerts
- [ ] Single host only: SQLite does not support several hosts (move to PostgreSQL to scale beyond one machine)

**Operations**
- [ ] Ship application logs (JSON, one line per call, with a request id) to monitoring and alert on bursts of 401/429 from `/api/auth/login` — or scrape `/metrics`
- [ ] Schedule `npm run retention` if you set a retention period
- [ ] Rebuild the image regularly and run `npm audit --omit=dev` in CI
- [ ] Change every sample password (`password123`) — sample data is never created in production, but check staging

**Privacy notes**
- Fonts are served by this application; no page contacts a third party.
- Export and erasure are built in (Account → *Your data*); set `RETENTION_REQUEST_DAYS` / `RETENTION_AUDIT_DAYS` if you must not keep records indefinitely.
- If `GEMINI_API_KEY` is set, request titles and descriptions (nothing else) are sent to Google for classification; leave it unset to keep all data on your server.

## 5. Limits of this audit

An automated and code-level review of this version. It is not a substitute for an independent penetration test, which is advisable before handling real tenant data at scale. Not covered: the hosting platform, the reverse proxy, DNS and email, physical security, and operational procedures.
