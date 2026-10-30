# EstateOps response cache

Source: `src/cache.js`. Wired into the read routes in `src/routes.js`. Tests: `npm run test:cache` (54 checks).

## What is cached
| Data | Shared by | Time limit |
|---|---|---|
| organization, team, technicians, tenants, vendors, properties, units of a property, insights, audit log | every manager of the same organization | 30 s (insights 60 s) |
| request list, request detail, reportable units, dashboard | managers of one organization share one entry; tenants, technicians and vendors each get their own | 15 s |
| notifications | one entry per user | 10 s |
| setup status | everyone | 5 s |

**Never cached:** sign-in, `/auth/me`, attachments (files), and every write.
The dashboard's "unread notifications" number is recalculated for each person even on a cache hit.

## Why it cannot show wrong or stale data
* The key = organization + viewer (manager of org 3 / user 17) + full URL + a **version number**. Other organizations and other users never match.
* The cache runs after sign-in and the role check on each route, and only 200 answers are stored (refusals are never cached).
* Every successful write raises the organization's version before the response is sent, so you always read your own change and
  everyone else's old entries stop matching. Sign-in does not bump it. Writes with no signed-in user bump a global version.
* The version lives in the database (table `cache_versions`), so several instances or workers behind the balancer stay in step.
* Entries also expire after the time limits above, and `CACHE=off` turns it off completely.

## Seeing it work
Responses carry `X-Cache: HIT` or `X-Cache: MISS`.
```
npm run test:cache
```
Compare speed: `CACHE=off` vs default with the same load test (PowerShell: `$env:CACHE="off"`).

## Measured: cache off vs on (`npm run loadtest:cache`)
Same data, same requests, one run on a 2-core test machine (3,000 requests, 30 properties, 1,200 units; 300 calls per endpoint, 8 at a time).
Milliseconds per request, average:

| Endpoint | Off | On | Faster |
|---|---|---|---|
| manager dashboard | 388 | 11 | x35 |
| tenant dashboard | 379 | 8 | x47 |
| tenant request list | 112 | 6 | x19 |
| manager request list (filtered) | 78 | 6 | x13 |
| units reportable (manager) | 76 | 8 | x10 |
| manager request list | 96 | 11 | x9 |
| insights | 67 | 13 | x5 |
| small lists (team, vendors, technicians, organization, notifications) | 5 to 10 | 5 to 9 | about the same |

Average over all 18 endpoints: 71.5 ms → 7.3 ms (x9.8).

Mixed traffic (reads and writes together):

| Share of writes | Cache off | Cache on |
|---|---|---|
| 2% | 132 requests/s, read avg 61 ms | 339 requests/s, read avg 24 ms |
| 10% | 146 requests/s, read avg 56 ms | 143 requests/s, read avg 56 ms (hit rate 6%) |

Reading it: the cache pays off where the server does real work (dashboard, request lists, insights). Small queries gain nothing.
It helps a lot when most traffic is reads. When about one call in ten is a write, every write refreshes the organization's cache,
so entries are rarely reused and the gain disappears. The dashboard cost grows with the number of requests, so it is the first thing to optimise further.
Limits: one run, the load generator shares the machine with the server, and the cache-on server ran second (a warmer disk cache can flatter it slightly, far less than the x35 gap).
