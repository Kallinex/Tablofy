# Pre-Production Launch Checklist

Status of every launch-critical item, and what stands between this repository
and a real deployment.

Legend: **[PROVEN]** verified by an executed check · **[MOCK]** only verified
against fakes · **[UNVERIFIED]** never executed anywhere

---

## 1. Automated gates — all executable, all passing

| Gate             | Command                            | Result                                                                                                                                                                      |
| ---------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format           | `npm run format:check`             | **[PROVEN]** exit 0, repo-wide                                                                                                                                              |
| Lint             | `npx nx lint api --skip-nx-cache`  | **[PROVEN]** exit 0, type-aware                                                                                                                                             |
| Type check       | `npx tsc --noEmit` (in `apps/api`) | **[PROVEN]** exit 0                                                                                                                                                         |
| Build            | `npx nx build api --skip-nx-cache` | **[PROVEN]** webpack success                                                                                                                                                |
| Tests + coverage | `npm run test:coverage`            | **[PROVEN]** 216 suites / 4707 tests, thresholds enforced                                                                                                                   |
| Dependency audit | `npm audit`                        | **[PROVEN]** production tree **0** vulnerabilities (`--omit=dev`). Dev toolchain reports 31 (7 high, 24 moderate) — see §6 for why none of them can ship or be fixed today. |

Coverage is measured, not assumed: 96.56% statements, 73.41% branches,
99.82% functions, 97.79% lines. Branch coverage is the weak number and is
discussed in section 5.

## 2. Code paths that only exist as fakes

This is the honest part. Each row is a code path that will run in production
and has **never** been executed against the real thing.

| Path                        | Where                                   | Why it is not proven                                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe API calls            | `payments/providers/stripe.provider.ts` | **[MOCK]** needs live `sk_live_*`. No real charge, refund or dispute has been made.                                                                                                                                                                               |
| Stripe webhook authenticity | `stripe.provider.ts:345`                | **[PROVEN]** _signature math is verified_ against a locally computed HMAC with a real 300s timestamp check and `timingSafeEqual`. **[UNVERIFIED]** that Stripe's own signing behaviour matches, because no real `Stripe-Signature` header has ever been received. |
| Paymob API calls            | `payments/providers/paymob.provider.ts` | **[MOCK]** needs live API key + merchant account.                                                                                                                                                                                                                 |
| OIDC login                  | `modules/sso`                           | **[MOCK]** needs a real issuer. No discovery document fetched, no code exchange, no token refresh.                                                                                                                                                                |
| SAML login                  | `modules/sso`                           | **[MOCK]** needs a real IdP metadata XML. No ACS POST has been processed.                                                                                                                                                                                         |
| SMTP delivery               | `modules/queues/email.processor.ts`     | **[MOCK]** `sendMail()` has never reached a mail server. No message has been delivered.                                                                                                                                                                           |
| Database migrations         | `prisma/migrations`                     | **[PROVEN]** replay against a local Postgres 16. **[UNVERIFIED]** against a production-sized dataset, so no proof of migration time or lock behaviour on real volume.                                                                                             |
| Redis failover              | `redis/redis.service.ts`                | **[PROVEN]** cluster-wide `SCAN` against every master is unit-tested. **[UNVERIFIED]** actual Sentinel failover, since no Sentinel deployment exists.                                                                                                             |
| OTLP span export            | `common/telemetry`                      | **[PROVEN]** config parsing and startup ordering. **[UNVERIFIED]** a single span has never reached a collector.                                                                                                                                                   |

The common thread: these are not bugs, they are **unknowns**. Each is a
one-line change away from working, and each is also where a production
incident would originate.

## 3. Infrastructure that has never been built

| Item                    | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker image            | **[PROVEN]** built end to end after fixing three real build/boot defects (see §8). Image runs as `nestjs`, carries the Prisma CLI, and holds both migrations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Container boot + health | **[PROVEN]** container reaches `running`/Docker `healthy` against a real Postgres 16 and Redis 7. `GET /api/v1/health` returns `200` with `database`, `redis`, `memory_rss`, `bullmq` (22 queues) and `disk` all `up`. The Dockerfile's own `HEALTHCHECK` passes.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Migration on boot       | **[PROVEN]** `prisma migrate deploy` inside the image applied both migrations to a real Postgres.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Trivy image scan        | **[PROVEN]** scanned the built image: **0 HIGH and 0 CRITICAL across every target** (Alpine base, `package.json`, all of `node_modules`). See §8 for how this was reached.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Image in a registry     | **[UNVERIFIED]** publishing is deliberately restricted to `main` and `v*` tags, and no image has been pushed yet. The same workflow now builds **and Trivy-scans** the image on every `feature/**` push, so the gate runs pre-merge; only the push to the registry waits for `main`.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Backup + restore drill  | **[PROVEN]** a real `pg_dump -Fc` of a seeded database (129 tables, 18 MB) was restored into a fresh, empty Postgres 16 and verified: table/index/FK/CHECK/sequence/view/trigger counts, per-table row counts, a data fingerprint and a schema fingerprint are all **byte-identical**. A first pass flagged a differing constraint fingerprint; on inspection the only delta was the relation-OID embedded in Prisma's generated `*_not_null` constraint _names_ — a positional semantic fingerprint over `(table, column, attnotnull)` plus every `pg_get_constraintdef` is identical. The harness is `scripts/backup-drill-verify.sh`. Not yet done against a production-sized dataset. |
| Load / soak testing     | **[PROVEN]** `scripts/load-test.js` drove **87,287 requests over 5 minutes at 64 concurrent workers** against the containerised production image (Postgres 16 + Redis 7, all queues live): **100% HTTP 200, 0 failures, 0 dead-letter jobs, ~291 req/s**, p50 169 ms / p95 564 ms / p99 727 ms. Measured RSS peak ~490 MiB. This run is what exposed the health-probe memory ceiling in §8.                                                                                                                                                                                                                                                                                               |

**The Docker image is no longer the unknown.** It builds, boots, reports healthy
against real datastores, scans clean at HIGH/CRITICAL, backs up and restores
byte-identically, and survives a five-minute soak at 64-way concurrency without a
single failed request. What remains unproven is a _production-shaped_ run: real
gateway credentials, a production-sized dataset, and an image in a registry.

## 4. Before you launch — ordered by cost of discovering the problem late

1. **One real Stripe test charge + live webhook delivery.** Proves the payment
   path end to end, including signature acceptance of a genuine header.
2. **One real OIDC login** against the actual identity provider. SSO failures
   lock out every tenant user at once, so this is the highest-blast-radius mock.
3. **One real SMTP send.** Confirms credentials, TLS negotiation and SPF/DKIM.
4. **Apply migrations to a production-shaped database copy.** Confirms runtime
   and lock behaviour before touching production.
5. **Redis failover drill** on a staging Sentinel or Cluster deployment.
6. **Restore-from-backup rehearsal at production size.** The mechanics are now
   proven against a seeded 18 MB database (§3); repeat against a
   production-sized copy to measure restore time and disk headroom.
7. **Point an OTLP collector at staging** and confirm spans arrive.

Steps 1–3 need credentials and accounts that do not exist in this environment.
They cannot be automated from here and are the reason this document exists.

## 5. Reading the coverage number honestly

73.41% branch coverage looks alarming without context, and reassuring with it.

The uncovered branches break down by file kind (measured from
`coverage-final.json`, counting every Istanbul branch point):

| Kind            | Uncovered / total | Covered   |
| --------------- | ----------------- | --------- |
| Controllers     | 1872 / 4552       | 58.9%     |
| Services        | 1659 / 7962       | 79.2%     |
| Everything else | 426 / 2373        | 82.0%     |
| **All source**  | **3957 / 14887**  | **73.4%** |

The controller gap is **not testable logic**. Every uncovered point sits on a
`constructor(private readonly x: X)` parameter property or a decorated handler
argument such as `@Body() dto` / `@CurrentUser() user`. These are `cond-expr` and
`binary-expr` nodes emitted by TypeScript's decorator and parameter-property
downleveling — Istanbul instruments them but no input can ever take the other
side. They account for 1872 of the 3957 uncovered branches, 12.6% of all
branches in the codebase.

Setting those compiler artifacts aside, the **testable** branch coverage is
**79.8%** (8250 of 10335 non-controller branches), and the remaining **2085 real
branches** sit in business-logic services: `payments.service` (124),
`orders.service` (100), then the analytics, inventory, CRM and warehouse
services. Reaching 100% there is a multi-week effort, and for much of it the
branches are Prisma error-handling paths whose correctness is better proved by
one real integration run than by 200 mocks. The honest floor is not 80% — it is
"the ~2000 real branches in business-logic services", and driving all of them
from mocks would inflate the number without proving production behaviour.

**Coverage thresholds are pinned.** Every threshold in `apps/api/jest.config.ts`
sits just below its measured value. This replaced a set of thresholds that had
drifted to absurdity — `customer-analytics.service` was gated at
`branches: 5` while actually at 80%, and `current-user.decorator` at
`branches: 0`. A near-total regression in those files would have passed CI
silently. That is fixed; do not lower them again.

## 6. Security posture

| Control                        | Status                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency vulnerabilities     | **[PROVEN]** production tree (`--omit=dev`) is **0**, and the built image is 0 from Trivy too. The dev toolchain still reports 31 (7 high, 24 moderate) — all below, none shippable.                                                                                                                                                  |
| SSRF on tenant-controlled URLs | **[PROVEN]** DNS pinning, manual redirect re-validation, `maxRedirects: 0`. Verified against a live local server, including a defeated prototype-pollution socket hijack.                                                                                                                                                             |
| Webhook signature verification | **[PROVEN]** HMAC-SHA256, `timingSafeEqual`, 300s tolerance, multi-secret rotation.                                                                                                                                                                                                                                                   |
| Multi-tenant isolation         | **[PROVEN]** enforced by `SkipTenant`/tenant guards on every query path, with decorator-level tests.                                                                                                                                                                                                                                  |
| Rate limiting                  | **[PROVEN]** configurable limits.                                                                                                                                                                                                                                                                                                     |
| Secrets in images              | **[PROVEN]** builder stage copies only build inputs.                                                                                                                                                                                                                                                                                  |
| Dependency pinning             | **[PROVEN]** `overrides` keyed on `minimatch` major, semver-valid.                                                                                                                                                                                                                                                                    |
| Image vulnerability scan       | **[PROVEN]** Trivy on the built image: **0 HIGH, 0 CRITICAL** across the Alpine base and every Node.js package target.                                                                                                                                                                                                                |
| Boot-time secret enforcement   | **[PROVEN]** the image refuses to start without `JWT_SECRET`, `JWT_REFRESH_SECRET`, `WEBHOOK_ENCRYPTION_KEY`, production `REDIS_PASSWORD` and `METRICS_AUTH_TOKEN`; `PAYMENTS_MODE` cannot be `mock`/`test` under production and `live` demands a real `sk_live_*` key. Each guard was observed firing during a real container start. |

**Never tested:** authorisation against a real IdP. Role mapping
(`OWNER`/`MANAGER`) is unit-tested with fabricated claims; whether an Azure AD
group claim maps to the right Tablofy role is **[UNVERIFIED]**.

## 7. Current recommendation

Do not launch on this basis.

The image builds, boots, is healthy, scans clean at HIGH/CRITICAL, backs up and
restores byte-identically, and sustains 64-way concurrency for five minutes
without a failed request; the production dependency tree is clean, and the
codebase is measurably clean, fully gated and type-checked. But **every
third-party integration is still a mock**, and mocks cannot reveal an
integration failure. The payment, identity and email paths have never touched
their real counterparts.

Section 4 lists the steps that convert those unknowns into facts. The image and
scan questions are now answered; the credential-gated ones are not, and only the
account holder can supply those credentials.

## 8. Defects found by actually running the image

Static review had called the image "not known to build". Building and scanning
it found four real defects that no amount of reading would have surfaced.

| #   | Defect                                                                                                                                                                                                            | Effect                                                                                                | Fix                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | `postinstall` runs `prisma generate`, but the `deps` stage copied only `package.json`/`package-lock.json`, so the schema was absent                                                                               | `npm ci` failed; **image never built**                                                                | Copy `prisma.config.ts` + `prisma/schema.prisma` into the `deps` stage           |
| 2   | The `builder` stage copied `package.json` but not `package-lock.json`, which webpack reads for its cache key                                                                                                      | `nx build api` failed with `ENOENT ... package-lock.json`                                             | Copy the lockfile into the builder stage                                         |
| 3   | `env.validation.ts` declared `REDIS_URL`, `JWT_EXPIRATION`, `JWT_REFRESH_EXPIRATION`, `THROTTLE_TTL` and `THROTTLE_LIMIT` as **required**, although every one of them has a working default in its config factory | **Container refused to boot** with a wall of validation errors, despite a correct minimal environment | Mark them `@IsOptional()`, matching the defaults that already existed            |
| 4   | npm was shipped in the runtime image even though no code path calls `npm`/`npx` at runtime                                                                                                                        | **Trivy reported 11 HIGH**, and all of them were npm's own bundled dependencies, not ours             | Delete npm from the runner stage; invoke Prisma via `./node_modules/.bin/prisma` |

A fifth inconsistency was fixed in the same pass: `WEBHOOK_ENCRYPTION_KEY` was
validated only under `NODE_ENV=production`, yet `webhook.config.ts` refuses to
boot without it in _every_ environment. Development and staging therefore died
inside the DI container with a stack trace instead of a clear message. Validation
now matches the runtime rule, and the redundant production-only branch is gone.

For defect 4 it is worth being precise, because it changes how you read the
scan: the vulnerable packages (`pacote`, `sigstore`, `ip-address`, `picomatch`,
`http-cache-semantics`, and one `brace-expansion` copy) all sit under
`/usr/local/lib/node_modules/npm`. The application's own five `brace-expansion`
copies are already at `1.1.21`, above the `1.1.17` fix. So the app tree was
never vulnerable — the package manager was. Removing npm dropped every target
to zero.

Two independent scanners are required, and both were needed to get this right.

- `npm audit` initially reported **0 vulnerabilities** while Trivy scored the
  same image at 11 HIGH. That 0 was wrong: it was served from a stale local npm
  cache. After `npm cache clean --force` the same command reported **39**
  (2 critical, 15 high, 22 moderate). Do not trust an audit count that has not
  been revalidated against the registry.
- The two tools cover different scopes. `npm audit --omit=dev` sees the
  production tree only; Trivy sees the built image including whatever the base
  image brings. Neither alone proves a clean artifact.

The advisory count has since been driven down rather than explained away:

| Scope                          | Before                       | Now                         |
| ------------------------------ | ---------------------------- | --------------------------- |
| Production tree (`--omit=dev`) | 1 critical                   | **0**                       |
| Trivy on the image (HIGH/CRIT) | 11 high                      | **0**                       |
| All dependencies (incl. dev)   | 39 (2 crit, 15 high, 22 mod) | 31 (0 crit, 7 high, 24 mod) |

What fixed them: a `proxy-addr` override to `^2.0.8` cleared the one critical
that actually shipped (GHSA-jqcg-44mw-7w3h, IP spoofing via `trust proxy` —
and this app sets `TRUST_PROXY`), plus `shell-quote`, `probe-image-size`,
`source-map-js`, `postcss-selector-parser` and `undici`. The Nx family was
raised to 23.3.0, taking 14 highs to 7. A second critical (`handlebars`
template injection, GHSA-q2c6-c6pm-g3gh) was then pinned forward to `^4.7.10`
with an `overrides` entry — it was dev/transitive only, but a critical is a
critical and the fix was a patch bump with no API change.

**The remaining 7 highs are unfixable today.** They all root at `braces`,
whose latest published release (`3.0.3`) _is_ the vulnerable one — there is no
patched version to upgrade to. They live under `webpack-dev-server` and
`@nx/web`, are devDependencies, are absent from the image, and are absent from
Trivy's result. They are a local-workstation concern (a dev server accepting
deeply nested patterns), not a deployment concern. Do not "fix" them with a
major `webpack-dev-server` upgrade the week before launch; re-check whether
upstream has published a `braces` release instead.

Regression tests cover defects 3 and 5, including the exact container-minimal
environment that failed to boot.

### 6. Self-inflicted 503s under load (found by the soak test)

The health endpoints return **503** once process RSS exceeds
`HEALTH_MEMORY_RSS_LIMIT_MB`, on the reasonable theory that a memory-bloated
instance should stop receiving traffic. The default was **512** in the compose
env and **300** in the config fallback. The five-minute, 64-worker soak peaked
at **~490 MiB** RSS — comfortably normal for a NestJS process under load — so
`/health` and its readiness probe began answering **503 in bursts while the
service was serving every request successfully**.

That is a self-inflicted outage: a load balancer or orchestrator that gates
traffic on `/health` would have _drained a perfectly healthy instance under the
exact high-load condition where its capacity is most needed_. The fix raises the
default to **768 MiB** (documenting the measured ~490 MiB peak as the
justification) in `docker/docker-compose.prod.yml`, `docker/.env.prod.example`,
`apps/api/src/config/app.config.ts` and the controller's fallback, with the
unit tests updated to match. Note the compose file sets **no container memory
limit** — the ceiling is a liveness signal only, not an enforced bound; that is
intentional and unchanged.

---

Last verified: 2026-10-09 · commit `82ac39b` · branch `feature/phase7-m5`
