# Pre-Production Launch Checklist

Status of every launch-critical item, and what stands between this repository
and a real deployment.

Legend: **[PROVEN]** verified by an executed check · **[MOCK]** only verified
against fakes · **[UNVERIFIED]** never executed anywhere

---

## 1. Automated gates — all executable, all passing

| Gate             | Command                            | Result                                                    |
| ---------------- | ---------------------------------- | --------------------------------------------------------- |
| Format           | `npm run format:check`             | **[PROVEN]** exit 0, repo-wide                            |
| Lint             | `npx nx lint api --skip-nx-cache`  | **[PROVEN]** exit 0, type-aware                           |
| Type check       | `npx tsc --noEmit` (in `apps/api`) | **[PROVEN]** exit 0                                       |
| Build            | `npx nx build api --skip-nx-cache` | **[PROVEN]** webpack success                              |
| Tests + coverage | `npm run test:coverage`            | **[PROVEN]** 216 suites / 4702 tests, thresholds enforced |
| Dependency audit | `npm audit`                        | **[PROVEN]** 0 vulnerabilities                            |

Coverage is measured, not assumed: 96.56% statements, 73.42% branches,
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

| Item                   | Status                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Docker image           | **[UNVERIFIED]** never built — the daemon is unavailable in the dev environment. We do not currently know that the image builds. |
| Trivy image scan       | **[UNVERIFIED]** wired in `docker-publish.yml`, never executed.                                                                  |
| Image in a registry    | **[UNVERIFIED]** `docker-publish.yml` only runs on `main`; this branch has produced no image.                                    |
| Backup + restore drill | **[UNVERIFIED]** no restore has been performed from a real backup.                                                               |
| Load / soak testing    | **[UNVERIFIED]** no test above single-request volume.                                                                            |

**The Docker image is the single largest unknown.** Everything else can be
verified incrementally; if the image does not build, nothing ships. Build it
first.

## 4. Before you launch — ordered by cost of discovering the problem late

1. **Build the image and run Trivy.** Cheapest step, answers the largest unknown.
2. **One real Stripe test charge + live webhook delivery.** Proves the payment
   path end to end, including signature acceptance of a genuine header.
3. **One real OIDC login** against the actual identity provider. SSO failures
   lock out every tenant user at once, so this is the highest-blast-radius mock.
4. **One real SMTP send.** Confirms credentials, TLS negotiation and SPF/DKIM.
5. **Apply migrations to a production-shaped database copy.** Confirms runtime
   and lock behaviour before touching production.
6. **Redis failover drill** on a staging Sentinel or Cluster deployment.
7. **Restore-from-backup rehearsal.** An untested backup is a hypothesis.
8. **Point an OTLP collector at staging** and confirm spans arrive.

Steps 2–4 need credentials and accounts that do not exist in this environment.
They cannot be automated from here and are the reason this document exists.

## 5. Reading the coverage number honestly

73.42% branch coverage looks alarming without context, and reassuring with it.

Of the 3957 uncovered branches, **1856 (46.9%) are decorator lines** —
`@IsOptional()`, `@Body()`, `@CurrentUser()` — generated by `class-validator`
and Nest. They contain no testable logic; a test cannot meaningfully "cover"
them.

That leaves **2101 real logic branches**, concentrated in business-logic
services: `payments.service` (122), `orders.service` (100), then the analytics,
inventory, CRM and warehouse services. Reaching 100% there is a multi-week
effort, and for much of it the branches are Prisma error-handling paths whose
correctness is better proved by one real integration run than by 200 mocks.

**Coverage thresholds are pinned.** Every threshold in `apps/api/jest.config.ts`
sits just below its measured value. This replaced a set of thresholds that had
drifted to absurdity — `customer-analytics.service` was gated at
`branches: 5` while actually at 80%, and `current-user.decorator` at
`branches: 0`. A near-total regression in those files would have passed CI
silently. That is fixed; do not lower them again.

## 6. Security posture

| Control                        | Status                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency vulnerabilities     | **[PROVEN]** `npm audit` = 0. CI gate tightened to `--audit-level=moderate`.                                                                                              |
| SSRF on tenant-controlled URLs | **[PROVEN]** DNS pinning, manual redirect re-validation, `maxRedirects: 0`. Verified against a live local server, including a defeated prototype-pollution socket hijack. |
| Webhook signature verification | **[PROVEN]** HMAC-SHA256, `timingSafeEqual`, 300s tolerance, multi-secret rotation.                                                                                       |
| Multi-tenant isolation         | **[PROVEN]** enforced by `SkipTenant`/tenant guards on every query path, with decorator-level tests.                                                                      |
| Rate limiting                  | **[PROVEN]** configurable limits.                                                                                                                                         |
| Secrets in images              | **[PROVEN]** builder stage copies only build inputs.                                                                                                                      |
| Dependency pinning             | **[PROVEN]** `overrides` keyed on `minimatch` major, semver-valid.                                                                                                        |

**Never tested:** authorisation against a real IdP. Role mapping
(`OWNER`/`MANAGER`) is unit-tested with fabricated claims; whether an Azure AD
group claim maps to the right Tablofy role is **[UNVERIFIED]**.

## 7. Current recommendation

Do not launch on this basis.

Not because the code is in poor shape — it is measurably clean, fully gated,
type-checked, and free of known dependency vulnerabilities. But because
**every third-party integration is a mock**, and mocks cannot reveal an
integration failure. The payment, identity and email paths have never touched
their real counterparts.

Section 4 lists the eight steps that convert those unknowns into facts. The
first is build the image. That is a single command and it retires the biggest
unknown on this page.

---

Last verified: 2026-10-02 · commit `948b0c8` · branch `feature/phase7-m5`
