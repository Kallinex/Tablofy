# AUDIT — EXECUTIVE SUMMARY

**Project:** Tablofy backend · **Date:** 2026-08-28 · **Type:** final comprehensive, independent, READ-ONLY
**Head:** `16d70e5` (detached) · **Release verdict:** **NO-GO**

_For project leads. Companion detail: `FINAL-COMPREHENSIVE-PROJECT-STATUS-AUDIT.md`._

---

## The one-line answer

The deployment is real, healthy, and verifiable (running code == built image == source, byte-for-byte,
all 1229 tests green), but the codebase contains open P1-level defects in security, payments, and the
analytics data pipeline — so by the audit rules the project is **not release-ready yet**.

---

## What is DONE (and proven)

- **Provable deployment integrity:** local production bundle = Docker image bundle = running container
  bundle, byte-for-byte — SHA-256 `7D150B897031E07193BBC26C3749F40BB882B3F555728CD54187BE1213859806`, 2 603 079 B.
- **Runtime health:** `/health`, `/health/live`, `/health/ready` all **200**; PostgreSQL, Redis, BullMQ all up;
  API container healthy, 0 restarts; PG and Redis were **not** recreated and hold no data loss.
- **P1 cleanup-processor DI remediation is live** (`ExportStorageService` exported; 4-param processor).
- **Quality gates:** 97/97 Jest suites, 1229/1229 tests (zero skipped), TypeScript 0, ESLint 0,
  nx build pass (deterministic), Prisma validate/status (24/24)/diff all clean.
- **Security fundamentals are genuinely strong:** JWT with issuer/audience/jti, bcrypt cost 12, account
  lockout, token-reuse detection, password-reset tokens hashed, **SSRF protection with DNS pinning**,
  **webhook HMAC verification via `timingSafeEqual`**, tenant-id scoping on every query sample,
  strict env validation, Redis **AUTH enforced**, no secrets in logs.
- **Real business logic exists and is wired** across orders (with optimistic locking), payments
  (idempotency key + split payments), purchasing/GRN (batch attribution + race fix), recipes/consumption,
  KDS, receipts engine, scheduled reports, dashboard/analytics (real DB queries), exports, webhooks.
  Roughly **33 of 70** audited capabilities are fully DONE.

## What is PARTIAL (29 of 70)

Payments/refunds (several correctness gaps — see below), Paymob, costing, menu (CRUD only), KDS printing,
loyalty (disabled by default feature flag), subscriptions (no entitlement enforcement), inventory (no
batch-level deduction, no warehouse link), analytics/forecasting (starved inputs), backup (JSON subset,
partial restore), privacy export (dead end), security hardening, rate limiting, logging, idempotency,
race-condition coverage, production environment limits, tests, documentation.

## What is NOT DONE (4 of 70)

1. **Frontend** — no UI exists at all (`apps/` has only `api`). API-only backend.
2. **`ConsumptionRecord`** (the analytics/forecasting feed table) — **never written anywhere.** Order
   completion records stock movements, but the table that forecasting, COGS/financial analytics, and
   inventory analytics query is permanently empty. This makes several "working" dashboards structurally wrong.
3. **Missing queue producers** — 11 background queues have workers but no producer, so their features
   never run (see below).
4. **Release readiness** — blocked by the P1/P2 items above.

## What is BLOCKED_EXTERNAL (2 of 70)

- **Email delivery:** code is fully wired (nodemailer → queue → retry → dead-letter), but there are no
  live SMTP credentials, so email jobs currently fail. Not a code blocker — an environment one.
- **Live Stripe / Paymob certification:** all payment code paths are verified in test/mock mode with
  correct signature verification, but no live gateway credentials or rounds-trips exist.

## What is DEFERRED

Nothing is formally deferred; unused scaffolding (print queue, forecasting auto-generation, supplier-KPI
automation, wallet/loyalty behind a disabled flag) is either dormant or partially wired and needs a
decision rather than deferral.

## What still needs action — the blockers

**P1 (do these first, any one blocks release):**

1. **Analytics pipeline is empty.** Wire order-line deduction to also write `ConsumptionRecord` (the
   table already exists). Otherwise forecasting and cost/financial analytics show nothing meaningful.
2. **Payment can be lost after capture.** If a gateway capture succeeds but the local finalize hits a
   conflict, the payment stays "Pending" forever — there is no automatic reconcile sweep. Add a
   scheduled reconcile.
3. **Orders can be "Completed" with no payment.** The state transition allows SERVED→COMPLETED with
   `paidAmount = 0`. Either require payment proof or an explicit offline-cash flag (and stop kitchen role
   from completing).
4. **Refresh tokens are stored in plaintext** in the DB. Hash them (SHA-256) and look up by hash.

**P2 (high-value fixes after P1):**

- Make `voidPayment` use the same CAS pattern as everything else (it currently doesn't).
- Decide on the **11 dormant queue workers** (print, forecasting, warehouse/supplier/costing analytics,
  CRM/scheduled notifications, inventory sync/alerts/expiry/waste): either wire real producers and real
  side effects, or delete them — several processors just log "processed" and do nothing.
- Register the existing `TenantBodyGuard` (body/query tenantId check) — today it's dead code.
- Fix rate-limit keying (it uses the full URL, so extra query parameters bypass the per-URL limit).
- Add inbound-gateway-webhook retries; use idempotency keys on Paymob refunds/voids; add an inbound
  webhook event-id ledger.
- Enforce subscription/entitlement status instead of treating plans as a pure rate limit.
- Make the privacy data-export actually process (currently requests stay pending forever).

## What should be done next

1. Fix the 4 P1 items (detail and file/line references are in the scorecard section of the main report).
2. Then the P2 list (dormant queues decision is the largest).
3. Then commit the working tree (28 tracked diffs + 17 untracked files) so production is reproducible from Git.
4. Re-run the full audit gates (all are one-command).
5. Re-certify live gateways/SMTP only once live keys are available (BLOCKED_EXTERNAL, not a code blocker).

## What must NOT be touched (guardrails, verified intact this audit)

- **PostgreSQL and Redis containers** — never recreate; no destructive SQL; no migration churn
  (24/24 up to date; live diff = none).
- **`/health` parity and the provenance chain** — keep local==image==running until a brand new release is built.
- **No commits/pushes/deploys/new features** from audit work — none were performed.
- **Don't ship with `PAYMENTS_MODE=test` expectations** — note Paymob currently maps "test" to its mock
  provider, so a "test" deployment can report success without a real gateway.

## Final verdict

# NO-GO

Release-ready infrastructure, verifiable deployment, and a strong security baseline — but four open P1
defects touch security, payment correctness, and the analytics data pipeline, so we cannot call it
CONDITIONAL GO until those are cleared (this is codefix + retest work, not external-credential work).

_Independent read-only audit. No fixes, commits, pushes, deployments, or new features performed._
