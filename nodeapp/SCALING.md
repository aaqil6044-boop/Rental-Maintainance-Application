# EstateOps – break point, scaling and load balancing

## What the stress test found (measured, 2-core sandbox, generator on the same machine)

| Step | Users | Req/s | p50 | p95 |
|---|---|---|---|---|
| 1 | 24 | 157 | 12 ms | 149 ms |
| 2 | 43 | 213 | 50 ms | 270 ms |
| 3 | 63 | 236 | 106 ms | 386 ms |
| 4 | 82 | 242 | 176 ms | 556 ms |
| 6 | 120 | 226 | 357 ms | 851 ms |

**Break point: about 235 requests/s, reached at roughly 45–60 users.** Beyond it, throughput stays flat (it even falls)
and the only thing that grows is latency (p50 12 → 357 ms) – requests queue. Errors stayed ≈ 0%, so this is a
**capacity** limit, not a bug. Cause: one Node process = one CPU core, and every sign-in ran bcrypt **synchronously**
(~380 ms average for `POST /api/auth/login`, 1,500 sign-ins in the run), freezing every other request while it ran.
Your own numbers will differ; the *shape* (flat throughput, rising latency) is what marks the break point.

## The small fix
`src/auth.js` gains `verifyAsync` (bcrypt's non-blocking compare); `POST /api/auth/login` and `change-password` use it.
Same hashes, same 401/429 behaviour, but the event loop keeps serving other requests during a sign-in.

## Scaling out
| Mode | Command | Use |
|---|---|---|
| One process | `npm start` | default |
| Worker cluster | `WORKERS=4 PORT=8080 npm run start:cluster` | uses every core on one server |
| Several instances + balancer | start N instances on different ports, then `npm run balancer -- --listen 9000 --backends 127.0.0.1:8081,127.0.0.1:8082` | several app servers |

The cluster/launcher migrates and seeds once; extra instances start with `EO_SECONDARY=1` so they never re-seed or
mark a running load test as interrupted. Start instances behind a proxy with `TRUST_PROXY=1`.

**Balancer** (`scripts/balancer.js`): round-robin, least-connections or ip-hash; health checks every 2 s; a connection error
removes a backend immediately and retries idempotent GET/HEAD once on another; POSTs are never replayed (could run twice);
`X-Forwarded-For`; counters at `GET /__lb`. In production use nginx/HAProxy/a cloud balancer with the same settings.

## Automatic scale-up at the break point (`scripts/autoscale.js`)
```
npm run autoscale                                  # balancer on :9000, 1 to 4 instances
node scripts/autoscale.js --listen 9000 --min 1 --max 4 --up-inflight 6 --up-p95 800 --up-sustain 3 --cooldown 10 --down-idle 30
```
It starts with the minimum (1) instance. The break point is detected from the balancer's own measurements: **in-flight
requests per instance ≥ 6** (requests queue behind a busy process) **or p95 ≥ 800 ms**, sustained for 3 seconds. Then it
starts another instance, waits until `/health` answers, and adds it to the balancer; a 10 s cool-down lets it take its
share before the next decision. When load stays low for 30 s the newest instance is **drained** (no new traffic, in-flight
requests finish) and stopped. Never above `--max`, never below `--min`; events are logged. The real test
(`tests/autoscale.test.js`) saturates one instance with 24 concurrent sign-ins: the second instance started after 2 s,
served traffic, 0 of 131 requests failed, and it was stopped again after the load ended.

## Known limits of scale-out (be honest with yourself)
* **SQLite is one file.** Many processes can read at once; writes serialize. Fine for a few instances on ONE host sharing a disk.
  For instances on different hosts, move to PostgreSQL (the store layer is the only place to change).
* The sign-in throttle (8 failures / 15 min) is per process, so with N workers the real limit is up to 8×N. Use ip-hash or a shared store if that matters.
* Uploads must be on shared storage when instances are on different hosts.
* The load-test dashboard keeps its running test in memory: start tests from one instance (or use the CLI).

## Commands (Windows terminal, project folder `nodeapp`)
```
npm run test:scale                      # balancer unit tests + real 2-instance/cluster integration test (~30 s)
npm run loadtest:breakpoint             # find the break point (2.5 min); read "By load stage" in the report
npm run loadtest:scale -- --workers 3   # 1 process vs cluster vs balanced vs AUTOSCALE (starts 1, adds instances at the break point) (~8 min)
npm run autoscale                       # run the autoscaling balancer yourself on :9000
```
`loadtest:scale` prints a table (req/s, latency, errors per topology, balancer distribution, and a mid-test instance kill)
and saves `performance/reports/scale-*.json`. On a laptop the generator shares CPU with the servers, so compare the
topologies with each other; the gain grows with the number of free cores.
