# EstateOps

Rental maintenance and property management: tenants report issues, managers triage and approve, technicians and vendors do the work.
Runtime: Node 20.6+ (22 recommended), Express, SQLite (better-sqlite3). The Java backend and old `frontend/` copies are **retired** and not used.

## Run
```
cd nodeapp
npm install
npm run dev        # sample data, http://localhost:8080  (Windows: start.bat)
npm start          # empty database - first-run screen creates your manager (Windows: run-fresh.bat)
```
Sample logins (dev only, password `password123`): manager@, tech@, tech2@, tenant@, tenant2@, vendor@ `estateops.test`.
API docs: `/docs` (Swagger UI), `/openapi.json`. Health: `/health`.

## Roles and onboarding
| Role | How they join |
|---|---|
| Manager | First one: setup screen (or `npm run create-admin -- --email you@x.com --name "You" --org "Your Co"`). More managers: invitation. |
| Tenant | Sign up on the login page, then a manager links them to a unit (or invites them). Tenants cannot pick a unit. |
| Technician | Invitation from a manager. |
| Vendor | Manager adds the vendor company (starts Pending), activates it, then invites its staff. |
Invitation and password-reset links are emailed when email is configured, and are also shown once to the manager to pass on by hand. Without a mail server every message is written to `data/outbox/*.json` instead, so nothing leaves the machine.

**Signing in.** Password, plus an optional second step: each person can turn on two-factor sign-in (an authenticator app) under Account, and `MFA_REQUIRED_FOR_MANAGERS=1` makes it compulsory for managers. Each sign-in is its own session, so Account → *Where you are signed in* lists the devices and can end any one of them. A forgotten password is handled by the person themselves on the sign-in page.

## Your data
Each person can download everything held about them (Account → *Your data*) and erase their account; a manager can erase a deactivated person's details. Maintenance history stays, shown as "Deleted user". `npm run retention` removes closed requests and audit entries older than `RETENTION_REQUEST_DAYS` / `RETENTION_AUDIT_DAYS` (unset = keep for ever).

## Tests
`npm test` runs every API, contract, security, email, session, privacy and operations suite on temporary databases; `npm run e2e` drives the application in a real browser. Individual suites: `npm run test:security`, `test:email`, `test:sessions`, `test:privacy`, `test:hardening`, `test:ops`, `test:cache`, `test:secrets`, `test:unit`, `test:scale`.

## Deploy
1. Secrets (`JWT_SECRET` 32+ characters, `SETUP_KEY`, optional `GEMINI_API_KEY`) go in **AWS Secrets Manager** (see [AWS-SECRETS.md](AWS-SECRETS.md)) or, for a local test, in your shell. Everything else is a plain setting: copy `config/production.env.example` to `config/production.env` and edit ([config/README.md](config/README.md) lists every setting).
2. Start: `npm run start:prod` (reads `config/production.env`), or `npm ci --omit=dev && npm start` with the variables set, or `docker build -t estateops . && docker run -p 8080:8080 -v estate-data:/data --env-file .env estateops`. Needs Node 20.6 or newer.
3. Put it behind a reverse proxy with HTTPS. Open the site, create the first manager with the setup key, then remove `SETUP_KEY`. Setup closes itself once an account exists.
4. Monitor `/health`. Set `TIMEZONE` (for example `Asia/Kolkata`) so dates show in your zone, not the container's.
5. **Backup:** `npm run backup` (database and uploads, verified, safe while running; keeps the newest 14). Schedule it, copy the result off the machine, and test a restore: stop the app, copy `estateops.db` and `uploads/` back into the data folder.
6. Run `npm audit` periodically (the CI workflow in `.github/workflows/ci.yml` does it on every push).
7. **Email:** set `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` (Amazon SES works), `MAIL_FROM` and `APP_URL` so invitation, reset and confirmation links point at your site.
8. **Monitoring:** logs are one JSON line per API call with a request id (also returned as `X-Request-Id`). Set `METRICS_TOKEN` to expose `/metrics` (Prometheus format) and alert on `estateops_server_errors_total`, `estateops_auth_failures_total` and `estateops_rate_limited_total`.
9. **Uploads:** point `SCAN_CLAMD_HOST` at a ClamAV daemon to scan every upload for malware (uploads are refused if the scanner is unreachable).

Before going live read [SECURITY.md](SECURITY.md) (audit and checklist) and [DEPLOY-AWS.md](DEPLOY-AWS.md) (step-by-step AWS deployment; note that SQLite means **one machine only**).

## Not included
Payment processing (expenses and invoices are records only), multi-server scaling (SQLite is single node — PostgreSQL would be needed), currency other than INR, push or SMS notifications.

## Load testing

An admin-only load-testing tool is built in (sidebar → Load testing). Setup, settings, metrics, safety limits and troubleshooting are in [LOADTEST.md](LOADTEST.md).
