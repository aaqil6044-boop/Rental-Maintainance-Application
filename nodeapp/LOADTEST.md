# Load testing

A built-in, admin-only load-testing tool. It simulates tenants, managers and technicians using the real EstateOps API, ramps users up and down, measures response times exactly, and judges the result against thresholds you set.

Open it from the sidebar (**Load testing**, organization admins only) or at `/loadtest.html`.

## Quick start

```
npm start                       # or: npm run dev   (sample data)
# sign in as an organization admin, open Load testing, press Smoke, then Start test
```

No extra install: the generator is part of the app (Node 22, no new dependencies).

## How it works

```
Browser (loadtest.html)  --JWT-->  /api/loadtests/*  (admin-only routes, same Express app)
                                        |
                                  run manager  (state machine, one run at a time, saved in SQLite: loadtest_runs)
                                        | fork + IPC
                                  generator process (src/loadtest/worker.js + engine.js)
                                        | HTTP, bounded number of virtual users
                                  the target's /api/...   (this server, or a configured target)
```

* The generator is a **separate process** so its own CPU use does not distort the server's latency, and so that it can be killed instantly.
* Virtual users are async loops, capped at `min(maxUsers, server cap)`. A controller adjusts the count every 200 ms to follow the plan. Nothing can create requests beyond that cap.
* If the web server stops or restarts, the generator stops with it (its IPC channel closes).

## Command-line run with a saved report and regression check

```
cd nodeapp
npm run loadtest                                   # 60 s, 2 -> 20 users, 20 s ramp-up, 10 s ramp-down, sample data
npm run loadtest -- --duration 5m --users 50 --start 5 --ramp-up 2m --ramp-down 1m
npm run loadtest -- --tenant 70 --manager 20 --technician 10 --randomization 80 --seed 7
npm run loadtest -- --url http://localhost:8080 --email admin@you.com --password "..."   # an already-running server
```

Other options: `--name`, `--think-min`, `--think-max`, `--pacing`, `--max-p95 800`, `--max-error 1`, `--no-open`.

It starts a throw-away server with sample data (unless you pass `--url`), runs the test through the same engine as the dashboard, then writes `report/EstateOps-loadtest-report.html` (and a timestamped copy), saves the run in `report/history/`, and opens the report.

**Comparison with the previous run.** The report compares with the most recent saved run that had identical settings (if none, with the latest run, marked "indicative only"). A metric is flagged **worse** only if it moved by more than normal noise: p95 ≥10% and ≥20 ms; p99 ≥15% and ≥30 ms (only judged with 300+ requests in both runs); median and average ≥15% and ≥10 ms; throughput ≥10%; error rate ≥0.5 points; per-endpoint p95 ≥20% and ≥20 ms with 30+ requests in both. Overall verdict: DEGRADED / IMPROVED / NO SIGNIFICANT CHANGE. The default seed is 1, so repeated runs send the same traffic mix.

Exit code: 0 ok, 1 thresholds failed or degraded versus an identical-settings run, 2 could not run. Run the same command before and after a change to see its effect.

## Settings

| Setting | Meaning |
|---|---|
| Total duration | **Includes** ramp-up and ramp-down. Steady state = total − ramp-up − ramp-down. Ramps longer than the total are rejected. |
| Starting / maximum users | Users at second 0 → users during steady state. Linear ramp-up; linear ramp-down to 0. |
| Pacing | Average pause after a scenario run. |
| Think time (min–max) | Pause between actions inside a scenario. |
| Timeout | Slower than this = timeout = failure. |
| Randomization 0–100 | 0: weighted round-robin and mid-point think time. 100: random weighted choice, shuffled action order, full-range think time. Always within valid workflows. |
| Seed | Same seed → same choices (verified by test on the exact request sequence). Empty → different each run. |
| Fresh sign-ins % | Share of scenario runs that start with a login. |
| Optional-action chance % | Base probability of optional steps (comment, second request, expense). |
| User-type and scenario weights | Split between tenants/managers/technicians; frequency of each scenario. 0 disables. |
| Include writes / cap on records / delete afterwards | Control test data (see below). |
| Thresholds | Max error rate, max p95, max p99, min throughput. Empty = not checked. |

## Scenarios (all use real, documented endpoints)

| Scenario | User | Writes? | Endpoints |
|---|---|---|---|
| open dashboard | tenant | no | GET /dashboard, /notifications |
| browse and open a request | tenant | no | GET /maintenance-requests, /maintenance-requests/{id} |
| report an issue | tenant | **creates** | GET /units/reportable, POST /maintenance-requests, optional POST …/comments |
| overview and request queue | manager | no | GET /dashboard, /maintenance-requests, …/{id} |
| search and page | manager | no | GET /maintenance-requests?q=&status=&limit=&offset= |
| reporting pages | manager | no | GET /insights, /properties, /team, /audit |
| triage load-test requests | manager | **updates** | GET … then POST …/assign, …/status |
| my jobs | technician | no | GET /maintenance-requests, /dashboard |
| work an assigned test job | technician | **updates / creates** | POST …/status, …/comments, …/expenses |

The manager and technician write scenarios only look at requests whose title carries this run's tag (`[LOADTEST r<id>]`). Statuses that can race between users accept the application's normal "not allowed now" reply as a valid outcome, not a failure.

## Metrics

* **Target users**: what the plan asks for at this second. **Active users**: virtual users actually running (measured). They can differ (spawn lag, wind-down); both are shown.
* **Requests**: every HTTP request sent by scenarios (sign-in setup is excluded). **Succeeded/Failed**: a request fails on a non-expected status, a timeout, a connection error, or an unexpected redirect (redirects are never followed).
* **Throughput (req/s)**: requests completed per second; "average" over the run, "current" over the last 5 s.
* **Latency**: time from sending a request to receiving the full response body, in ms. min, average, and **exact nearest-rank** p50/p90/p95/p99 computed from every recorded sample (not estimated from averages). pXX = XX% of requests were faster than this.
* **Error rate** = failed ÷ requests × 100. **Timeouts** and **connection errors** are counted separately.
* **Iterations** = completed scenario runs. Scenario timings include think time.
* **Server resources** (local target only): CPU % of one core, RSS and heap memory, event-loop lag, database and WAL size, sampled each second from the server process. They are the *server's*, not the generator's. The generator's own CPU/memory is shown separately as client-side. For remote targets the dashboard says they are unavailable.

## Verdicts

* **Completed** means the profile ran to its end. It does **not** mean it passed.
* **Passed / Failed** is decided by your thresholds on the final numbers. With no thresholds there is no verdict.
* A run you **stop** or **cancel** ends as *Cancelled* with an **Inconclusive** verdict (it did not finish the plan). Partial results are kept.
* A run that trips the safety auto-stop ends as *Failed* with a *Failed* verdict. A run that cannot sign in or crashes ends as *Failed* with no verdict.
* Warnings list limitations (shared machine, no seed, short steady state, few samples, record cap reached).

## Safety and authentication

* Only an **authenticated organization admin** can view or control tests; everyone else gets 401/403. Runs are visible only inside the admin's organization (other organizations get 404). Every start, stop, emergency stop and cleanup is written to the audit log with who did it; the run records who started it.
* **Targets**: the browser sends a *name*, never a URL. `local` is this server, found from the request's own socket. Others come only from `LOADTEST_TARGETS`, are validated (http/https only, no path, no credentials, link-local/metadata addresses blocked), need `LOADTEST_ALLOW_REMOTE=1`, credentials from `LOADTEST_REMOTE_ACCOUNTS`, and the admin must **type the target name** to confirm. Redirects are not followed; only `/api/` paths are ever requested.
* **Limits** (`LOADTEST_MAX_VUS`, `…_MAX_DURATION_SEC`, `…_MAX_REQUESTS`, `…_MAX_CREATES`) are enforced on the server and clamped to absolute ceilings in code (1000 users, 2 h, 5 M requests). One run at a time (second start → 409).
* **Automatic stop**: a run ends itself if more than `LOADTEST_ABORT_ERROR_PCT` (50%) of requests fail after 200 requests, or when the request budget is spent. **Emergency stop** (top-right, or `POST /api/loadtests/stop-all`) kills the generator immediately.
* **Browser refresh or close** does not stop a test (it runs on the server and ends at its planned duration or at a limit). Reopening the page re-attaches to it. **Server restart**: the generator dies with the server, and on boot any run still marked running is set to *Failed – interrupted*.
* **Secrets**: test-account passwords are generated fresh per run, kept in memory, and sent to the generator over IPC only. They are never stored, logged, exported or shown. Error messages are redacted (tokens, emails, passwords, long hex).

## Test data and cleanup

* Local runs use dedicated accounts `loadtest-<role>-<n>-o<org>@loadtest.invalid` and a fixture property `[LOADTEST] Fixture property` (units LT-01…LT-08). Between runs the accounts and property are **deactivated** and hidden from Team, Properties and report lists.
* Created records are titled `[LOADTEST r<id>] …` and capped per run (`maxCreates`). **Cleanup** deletes only requests that were reported by a load-test account **and** carry that tag, plus the notifications they caused (child rows cascade). A real person's request that merely copies the tag is never deleted (tested). It runs automatically unless you untick it, or on demand ("Delete this run's test records", or `POST /api/loadtests/cleanup`).
* Audit-log entries made by the fixture accounts are append-only and remain.
* Remote targets: records cannot be cleaned from here; remove them there.

## API

All under `/api/loadtests`, documented in Swagger (`/docs`, tag *Load testing*) and checked against the live responses by the docs test: `GET /config`, `POST /validate`, `POST /` (start), `GET /`, `GET /{id}`, `POST /{id}/stop` (`{"mode":"graceful"|"now"}`), `POST /stop-all`, `POST /{id}/cleanup`, `POST /cleanup`, `GET /{id}/export?format=json|csv&part=…`, `GET /compare?ids=1,2`.

CSV parts: summary, endpoints, scenarios, timeline, errors, thresholds. Cells starting with `= + - @` are prefixed so spreadsheets never run them.

## Tests

```
npm run test:loadtest     # unit + generator-vs-mock-service + API, ~1 min
npm test                  # whole backend suite (includes the load-test API test and the docs test)
npm run e2e:loadtest      # browser tests of the dashboard
```

* `tests/unit/loadtest.test.js`: validation, ramp profile, percentiles, thresholds, seeded RNG, weights, redaction, scenarios use only documented endpoints.
* `tests/loadtest/engine.test.js`: generator against a local mock service (concurrency cap measured by the mock, ramp, duration, graceful and immediate stop, timeouts, unavailable target, request budget, auto-stop, reproducibility, no secrets).
* `tests/loadtest.api.test.js`: auth, validation, target protection, lifecycle, overlap, a real small run, data isolation and cleanup safety, export correctness, compare, stop/emergency stop, restart policy, audit.
* `e2e/loadtest.spec.js`: the dashboard in a real browser.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Load testing is switched off" | Set `LOADTEST_ENABLED=1` (it is off by default in production). |
| "Not available / admins only" | Sign in as a manager with the organization-admin flag. |
| 409 "already running" | Only one run at a time. Stop it, or use Emergency stop. |
| Start returns field errors | The message names the setting; the total duration includes both ramps. |
| "Could not sign in test accounts" | Local: should not happen; check the audit log and database. Remote: check `LOADTEST_REMOTE_ACCOUNTS` and that those accounts exist there. |
| High error rate on a small machine | Reduce users; the generator and server share CPU on a local run. |
| Run shows Failed – interrupted | The server restarted during the run; partial results are kept. |
| Numbers differ between runs | Use the same seed, a steady state ≥ 30 s, and compare on the same machine. |

## Limitations

* The generator and the server share one machine for local runs, so absolute numbers are pessimistic and affected by other processes. Use them to compare runs, not as capacity promises.
* Single node: one run at a time; SQLite and one Node process are the system under test.
* Server CPU/memory are only measured for the local target.
* Scenarios cover the main user journeys, not every endpoint (no file uploads, invitations or account administration, which would create real accounts).
* Percentiles are exact over up to about 1 million samples per run; beyond that the oldest are kept and a warning is shown.
