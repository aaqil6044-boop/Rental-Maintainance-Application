# Secrets in AWS Secrets Manager

EstateOps keeps **no secret in code, in the image, in `.env` files or in plain task settings**. Seven values are secrets; everything else is ordinary configuration.

| Secret (key in the AWS secret) | What it protects |
|---|---|
| `JWT_SECRET` | Signs every sign-in token. Anyone holding it can act as any user. |
| `SETUP_KEY` | Lets the first administrator be created. Delete it from the secret once the first manager exists. |
| `GEMINI_API_KEY` | Optional AI triage (billing key). |
| `SMTP_PASS` | Optional: the password for the mail server (Amazon SES SMTP credentials). |
| `MFA_ENC_KEY` | Optional: encrypts the stored authenticator keys. Defaults to `JWT_SECRET`. If you set it, never change it while anyone has two-factor sign-in on, or they will be locked out of their authenticator app (recovery codes still work). |
| `METRICS_TOKEN` | Optional: the bearer token for `/metrics`. At least 16 characters. |
| `LOADTEST_REMOTE_ACCOUNTS` | Optional: test-account passwords for remote load tests. |

Ordinary configuration (`NODE_ENV`, `PORT`, `DATA_DIR`, `TRUST_PROXY`, `SELF_REGISTRATION`, ...) stays in the task/service settings. A secret that contains these is ignored on purpose, so the secret store can never switch the app to development mode.

## How it works

`node bootstrap.js` (this is `npm start` and the container's command) reads **one** secret named by `AWS_SECRET_ID` before the app starts, then runs the server.

- Credentials come from the **IAM role** of the task, instance or service. No access keys are stored anywhere.
- The secret is read once, at start. Values are never logged.
- **If the secret cannot be read, the server does not start.** It never falls back to a default key. Transient errors are retried 3 times; "access denied" and "not found" stop at once with a clear message.
- A value in Secrets Manager wins over a leftover environment variable of the same name (the log says so, by name only).
- `node server.js` and `npm run dev` (development) never contact AWS.

## 1. Create the secret (once)

PowerShell (`aws configure` done, or SSO login active). Change the region and name if you like:

```powershell
$jwt   = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
$setup = node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
@{ JWT_SECRET = $jwt; SETUP_KEY = $setup } | ConvertTo-Json | Set-Content -Encoding ascii secret.json
aws secretsmanager create-secret --name estateops/prod/app --description "EstateOps secrets" --secret-string file://secret.json --region ap-south-1
Remove-Item secret.json
```

Add the optional keys the same way (`GEMINI_API_KEY`, `SMTP_PASS`, `MFA_ENC_KEY`, `METRICS_TOKEN`). Later changes: `aws secretsmanager put-secret-value --secret-id estateops/prod/app --secret-string file://secret.json`, then **restart** the service (values are read at start).

## 2. Let the app read it (IAM)

Attach this to the **task role** (ECS), **instance profile** (EC2) or **instance role** (App Runner), not to a user:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "arn:aws:secretsmanager:ap-south-1:<ACCOUNT_ID>:secret:estateops/prod/app-*"
  }]
}
```

If the secret uses your own KMS key, also allow `kms:Decrypt` on that key. Nothing else is needed: the role cannot list, change or delete secrets.

## 3. Point the app at it

Set these as normal environment variables (none of them is secret):

```
NODE_ENV=production
AWS_SECRET_ID=estateops/prod/app
AWS_REGION=ap-south-1
TRUST_PROXY=1            # only behind a load balancer / proxy
DATA_DIR=/data           # persistent volume
```

**ECS / Fargate (task definition, container section)**

```json
"environment": [
  {"name": "NODE_ENV",      "value": "production"},
  {"name": "AWS_SECRET_ID", "value": "estateops/prod/app"},
  {"name": "AWS_REGION",    "value": "ap-south-1"},
  {"name": "TRUST_PROXY",   "value": "1"}
]
```
with `taskRoleArn` set to the role from step 2.

### Alternative with no code path at all: let ECS inject the values

ECS can inject individual keys as environment variables, using the **execution role** (it needs `secretsmanager:GetSecretValue` too). Then leave `AWS_SECRET_ID` unset; the app just sees ordinary variables:

```json
"secrets": [
  {"name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:ap-south-1:<ACCOUNT_ID>:secret:estateops/prod/app:JWT_SECRET::"},
  {"name": "SETUP_KEY",  "valueFrom": "arn:aws:secretsmanager:ap-south-1:<ACCOUNT_ID>:secret:estateops/prod/app:SETUP_KEY::"}
]
```
App Runner offers the same through "runtime environment secrets". Use whichever your platform supports; both keep the values out of the image and the task settings. Use the built-in loader (`AWS_SECRET_ID`) on EC2, ECS without the `secrets` block, or anywhere else with an IAM role.

## Operating it

- **Rotating `JWT_SECRET`** signs every user out (their tokens no longer verify). Do it on a schedule you can announce, or after any suspected leak, then restart.
- **Remove `SETUP_KEY`** from the secret after the first manager exists.
- **Never** put the secret in the image, a `.env` committed to git, task-definition `environment`, or CI logs. `.env` is already in `.gitignore` and `.dockerignore`.
- Turn on CloudTrail: every `GetSecretValue` is recorded, so reads of the secret are auditable.

## Running on AWS: one thing to know

EstateOps stores data in **SQLite on one host**. On AWS that means exactly **one** running task/instance with the data folder on a persistent volume (EBS on EC2; EFS on Fargate, which works but is slower and relies on file locking), plus backups of that volume. Do not set the service to more than one instance. To run several instances, the database must move to PostgreSQL (for example Amazon RDS) first.

## Tested

`npm run test:secrets` (28 checks) starts the real server through the real AWS SDK against a local stand-in for Secrets Manager and proves: production starts with no `JWT_SECRET` in the environment, the key and setup key from the secret are the ones in force, tokens are signed with the secret's key, a failed read stops startup, values never reach the log, and production with no secret source refuses to start. It has **not** been run against a live AWS account from here: do the first start in a staging account and watch for `[secrets] loaded JWT_SECRET, SETUP_KEY ...` in the log.
