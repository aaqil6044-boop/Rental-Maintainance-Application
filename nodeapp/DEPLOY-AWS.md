# Deploying EstateOps on AWS

Written 30 October 2026, after the security audit ([SECURITY.md](SECURITY.md)) and the full review ([REVIEW.md](REVIEW.md)).

## The one thing that shapes everything

EstateOps stores its data in **SQLite**, a single file on a disk. SQLite cannot be shared by two servers,
so this application runs on **exactly one machine**. That is a real limit, not a setting:

- No auto-scaling group with two or more instances. Set the desired count to **1**.
- No rolling deployment with two tasks alive at once. Use "stop the old one, then start the new one".
- A failure of that one machine is downtime until it is replaced (minutes, if you follow step 7).

One machine handles a lot — the load tests in this project push thousands of requests a minute through
it — so this is a reasonable way to start. When you need more than one server, the data layer has to move
to PostgreSQL (Amazon RDS). That is a separate piece of work, not a configuration change.

## Choose one of two shapes

| | **A. EC2 + EBS** (simplest) | **B. ECS Fargate + EFS** |
|---|---|---|
| Compute | One `t3.small` or larger | One task, 0.5 vCPU / 1 GB or larger |
| Data | An EBS volume mounted at `/data` | An EFS file system mounted at `/data` |
| Updates | `git pull`/copy, `npm ci --omit=dev`, restart the service | Push an image, update the service |
| Watch out for | Nothing unusual | **EFS is slower than EBS for SQLite.** Test it with your own load before committing. One task only. |

If you are unsure, take **A**. It is less moving parts, and SQLite is happiest on a local disk.

## Steps

### 1. Secrets

Put these in **AWS Secrets Manager** as one secret (for example `estateops/prod/app`), never in a file or a
task-definition environment variable. Full instructions, IAM policy and PowerShell commands: [AWS-SECRETS.md](AWS-SECRETS.md).

| Key | Needed |
|---|---|
| `JWT_SECRET` | Always. 48 random bytes. |
| `SETUP_KEY` | For the first start only. **Remove it from the secret once your manager account exists.** |
| `SMTP_PASS` | If you send email (you should). |
| `METRICS_TOKEN` | If you scrape `/metrics`. 16+ characters. |
| `MFA_ENC_KEY` | Optional. Leave it out and the authenticator keys are encrypted with `JWT_SECRET`. If you set it, **never change it** while anyone has two-factor on. |
| `GEMINI_API_KEY` | Only if you want AI triage. Leave it out to keep all request text on your own server. |

The application reads the secret at startup with the **IAM role** of the instance or task, and **refuses to
start** if it cannot read it. No access keys anywhere.

### 2. Settings

Everything that is not a secret goes in the environment (EC2: a systemd unit or an env file; ECS: the task
definition). Start from `config/production.env.example`. The ones that matter most:

```
NODE_ENV=production
PORT=8080
DATA_DIR=/data
TIMEZONE=Asia/Kolkata          # otherwise every date shows in UTC
TRUST_PROXY=1                  # ONLY because there is a load balancer in front
APP_URL=https://estateops.yourdomain.com
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SMTP_USER=...                  # Amazon SES SMTP credentials
MAIL_FROM=EstateOps <no-reply@yourdomain.com>
LOG_FORMAT=json
SESSION_IDLE_MIN=120
AWS_SECRET_ID=estateops/prod/app
AWS_REGION=ap-south-1
```

Decide two things before you start:

- `SELF_REGISTRATION=0` — tenants join only by invitation. The safest setting. Leave it at `1` and anyone can
  create a tenant account; they still see nothing until a manager links them, and they must now confirm their
  email address before that link can be made.
- `MFA_REQUIRED_FOR_MANAGERS=1` — every manager must set up an authenticator app before using the application.
  Recommended once your managers have their phones ready.

Leave `DOCS` and `LOADTEST_ENABLED` unset: both are off in production by default.

### 3. Email (Amazon SES)

1. Verify your sending domain in SES and add the DKIM records it gives you.
2. Request production access (a new SES account is sandboxed and can only send to verified addresses).
3. Create SMTP credentials; the password goes in Secrets Manager as `SMTP_PASS`.

Without `SMTP_HOST` the application writes every message to `/data/outbox/*.json` instead of sending it.
Nothing breaks — invitation and reset links are still shown to the manager to pass on by hand — but tenants
cannot reset their own passwords.

### 4. The network

- An **Application Load Balancer** terminating HTTPS with an ACM certificate; HTTP redirected to HTTPS.
- Target group to port **8080**, health check path **`/health`**.
- The instance's security group accepts port 8080 **only from the load balancer**.
- The ALB's idle timeout is 60 s; the application already keeps connections for 65 s, so there is nothing to tune.
- Add rate limits on the ALB (a WAF rule) for `/api/auth/*` and `/api/setup`. The application's own limits are
  per process and are a second line of defence, not the first.

### 5. First start

1. Start the service. Check the log: it should say it read the secret and that the database migrated.
2. Open the site. The setup screen appears. Enter the organization name, your name, email, password and the **setup key**.
3. **Remove `SETUP_KEY` from the secret** and restart. Setup closes itself once an account exists, but there is no reason to leave the key lying around.
4. Set up two-factor sign-in for your own account straight away (Account → Two-factor sign-in) and save the recovery codes.

### 6. Backups

This is the step people skip and regret.

```
npm run backup        # database + uploads, verified, safe while the app is running; keeps the newest 14
```

Schedule it (cron or a systemd timer), then **copy the result off the machine** — an S3 bucket with versioning
and a lifecycle rule. A backup on the same disk as the database is not a backup.

Test a restore once, now, while nothing is wrong: stop the app, copy `estateops.db` and `uploads/` from a
backup into `DATA_DIR`, start it.

If you must not keep records for ever, set `RETENTION_REQUEST_DAYS` / `RETENTION_AUDIT_DAYS` and schedule
`npm run retention` (it has a `--dry-run`).

### 7. Being able to replace the machine

Because there is only one, know in advance how you would rebuild it:

- EC2: keep the EBS volume separate from the root volume, snapshot it daily (Data Lifecycle Manager). To
  recover, start a new instance and attach the volume — or the newest snapshot.
- ECS: EFS survives the task, so recovery is "start the task again".

Write the five commands down somewhere you can reach from a phone.

### 8. Watching it

- Logs are one JSON line per API call, with a request id that is also returned as `X-Request-Id`. Ship them to
  CloudWatch Logs.
- Set `METRICS_TOKEN` and point Prometheus or the CloudWatch agent at `/metrics` (Prometheus format, needs
  `Authorization: Bearer <token>`).
- Alarms worth having on day one: `estateops_server_errors_total` rising, a burst of
  `estateops_auth_failures_total` (password guessing), `estateops_rate_limited_total` (someone hammering the
  sign-in), the ALB's unhealthy-host count, and **disk space on `/data`**.

### 9. Optional: malware scanning of uploads

Run ClamAV (`clamd`) on the same instance or as a sidecar and set `SCAN_CLAMD_HOST` / `SCAN_CLAMD_PORT`. Every
upload is then scanned before it is written to disk. If the scanner is configured but unreachable, uploads are
**refused** — that is deliberate; `SCAN_FAIL_OPEN=1` reverses it if you prefer availability.

## Before you announce the address

Work through section 4 of [SECURITY.md](SECURITY.md). The short version:

- [ ] `NODE_ENV=production`, secrets in Secrets Manager, `SETUP_KEY` removed after first start
- [ ] HTTPS everywhere; port 8080 reachable only from the load balancer
- [ ] `TRUST_PROXY=1` **only** because there is a proxy in front
- [ ] `TIMEZONE` set
- [ ] Backups scheduled, copied off the machine, and one restore tested
- [ ] Email verified and sending; `APP_URL` correct, so links in emails point at your site
- [ ] Two-factor on for every manager account
- [ ] Logs and metrics going somewhere a person will look
- [ ] Disk-space alarm on `/data`

## What this deployment cannot do

- **Run on more than one machine**, so no failover and no horizontal scaling (SQLite). Moving to PostgreSQL on
  Amazon RDS is the answer when you need it.
- **Survive the loss of its disk** without a restore from backup.
- It has not yet been run against a real AWS account from here: the secret loader and the GitHub Actions
  workflow are written and tested in isolation, so allow time on the first staging start for IAM permissions
  (`secretsmanager:GetSecretValue` on that one secret) to be right.
