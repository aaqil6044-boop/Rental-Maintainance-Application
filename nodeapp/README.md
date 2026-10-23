# EstateOps

Rental maintenance and property management: tenants report issues, managers triage and approve, technicians and vendors do the work.
Runtime: Node 18+ (22 recommended), Express, SQLite (better-sqlite3). The Java backend and old `frontend/` copies are **retired** and not used.

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
Invitation links are shown once to the manager to copy; email is not sent.

## Tests
`npm test` (API 291, migration 17, seed 11, docs-vs-routes 178; each uses a temp database) and `python3 tests/ui.test.py` (browser journey, needs Playwright + Chromium).

## Deploy
1. Set env from `.env.example`: `NODE_ENV=production`, `JWT_SECRET` (32+ chars), `SETUP_KEY`, `TRUST_PROXY=1`.
2. `npm ci --omit=dev && npm start`, or `docker build -t estateops . && docker run -p 8080:8080 -v estate-data:/data --env-file .env estateops`.
3. Put it behind a reverse proxy with HTTPS (Caddy/nginx). Open the site, create the first manager with the setup key, then remove nothing - setup closes itself once an account exists.
4. Monitor `/health`.
5. Backup: stop the app or use `sqlite3 data/estateops.db ".backup backup.db"`, and copy `data/uploads`. Restore by putting both back. Test a restore before relying on it.
6. Run `npm audit` periodically.

## Not included
Email delivery, payment processing (expenses/invoices are records only), multi-server scaling (SQLite is single node), currency other than INR.
