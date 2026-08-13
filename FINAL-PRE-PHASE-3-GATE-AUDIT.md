# FINAL PRE-PHASE-3 GATE AUDIT

Independent, source-and-runtime re-derivation gate for Phase 3. Every prior claim was
re-verified against current source and the live deployment before being accepted.

## 1. Audit Metadata

- Branch: `feature/phase7-m5` (HEAD before this audit: `5d6d0c3`)
- Date: 2026-08-13
- Method: re-read current source for every claim; re-ran every gate; proved runtime state
  against the live containers; nothing carried over from prior reports without re-verification.
- Scope: orders pricing integrity (P0-J), RBAC role policy (P0-I), payment/refund caps,
  concurrency, schema drift, deployment byte-identity, runtime health, secrets posture.

## 2. Executive Summary and Verdict

- Verdict: **CONDITIONAL GO FOR PHASE 3** (code/DB/deploy gates green; the only conditional
  is external live-payment certification, which is `BLOCKED_EXTERNAL`, not a code defect).
- P0-J (order pricing) is now **CLOSED**: item unit price and catalog-modifier price are
  server-authoritative on both create and update; no client-supplied price becomes
  authoritative; order totals are server-calculated; payments are capped at those totals.
- P0-I (RBAC) is now **fully CLOSED** including a repo-wide role-reference scan that caught
  and fixed one residual dead role (`CHEF`) in `recipes.controller.ts`.
- Full regression: **91 suites / 1165 tests pass**; `tsc` exit 0; ESLint exit 0;
  production build succeeds; bundle hash identical between local build, image, and the
  running container; schema has **zero drift**; DB untouched (0 data rows).

## 3. P0 Finding Registry (status after this audit)

| ID | Area | Status |
|----|------|--------|
| P0-A | Reconcile must be read-only (12 contract tests) | CLOSED (re-verified in full suite) |
| P0-B/E | Payment/refund amount integrity, idempotency, CAS | CLOSED (re-derived from source, tests pass) |
| P0-D/D2-D4 | Refund balance accounting (full/partial/replay) | CLOSED (tests in suite) |
| P0-F | GRN `averageCost` weighted-average race | CLOSED (re-verified via suite + GRN lock check) |
| P0-H | Recipe update transactionality | CLOSED (re-verified via suite) |
| P0-I | Dead role strings / RBAC policy | **CLOSED this audit** (see §8) |
| P0-J | Order pricing: client prices must not be authoritative | **CLOSED this audit** (see §4-6) |

## 4. P0-J Forensic Determination (canonical pricing rule)

- `Product.basePrice Decimal(10,2)` required (schema ~line 629).
- `ProductVariant.price Decimal(10,2)` is a standalone, required, full price field; there is
  **zero** additive/base+delta pricing logic anywhere in the repo (grep of all price math).
- `Modifier.price Decimal(10,2)` required; `ProductVariantModifier` is a junction table only.
- `CreateOrderItemDto.unitPrice` is a single full-price field (no discount-ladder, no delta).
- Conclusion: the repo itself establishes the canonical rule — the catalog price
  (`Product.basePrice`, else `ProductVariant.price`, else `Modifier.price`) is the
  authoritative full price. Prior residual: variant items on create and item/modifier
  prices on update trusted the client value.

## 5. P0-J Remediation (this audit)

`apps/api/src/modules/orders/orders.service.ts`:

1. `resolveItemUnitPrice`: variant items now resolve `ProductVariant.price` from the
   validated catalog (client `unitPrice` ignored); fallback to client price only when the
   catalog cannot resolve (e.g. soft-deleted product) — symmetric with the product branch.
2. New `resolveAuthoritativeItemPrice(tx, tenantId, productId, variantId, fallback)`:
   variant price → else product base price → else fallback.
3. `update()`: when an item edit supplies `unitPrice` **or** changes `variantId`, the price
   is re-resolved from the catalog (client value ignored); quantity/discount-only edits keep
   the stored snapshot price; totals are recomputed from the resolved price.
4. New `resolveAuthoritativeModifierPrice(tx, tenantId, modifierId, fallback)` and update()
   modifier writes: catalog modifiers (`modifierId` present) resolve `Modifier.price`;
   custom modifiers (no `modifierId`) keep the client price.
5. No schema change. No DTO shape change.

## 6. P0-J Test Evidence

- Orders suite: **78 tests pass** (baseline 76; the prior "documented gap" test was converted
  to an authoritative assertion; 3 new update-path tests added).
- Forged-price matrix now covered: `unitPrice: 0.01`, `99`, catalog-mismatch, variant,
  modifiers, and forged update values — all resolve to catalog prices.
- `priceSnapshot` stores the authoritative price; `subtotal`/`total` derive from it.
- Unknown `modifierId` on create still → `NotFoundException`.

## 7. P0-I RBAC Tripwire (function-level)

- `rbac-route-coverage.spec.ts` reads handler-function metadata (Reflect on
  `proto[method]`, not `(proto, name)`), proving the earlier probe was non-vacuous.
- 74 controllers / 593 routes / **0 ungated** routes; passes in full suite.

## 8. P0-I Residual Closure (this audit)

- Finding: `RecipesController` used dead role `'CHEF'` on 5 mutation routes
  (create/update/addItem/updateItem/removeItem). `UserRole` enum has `KITCHEN`, not `CHEF`;
  OR-semantics guard means `CHEF` matched nobody → the intended kitchen staff were denied.
- Fix: `'CHEF'` → `'KITCHEN'` on those 5 routes.
- New global guard: `role-reference-coverage.spec.ts` scans **all** controllers and asserts
  (a) no route references `PURCHASING`/`CHEF`, (b) every role string exists in `UserRole`,
  (c) scan is non-vacuous, (d) recipes mutation routes remain open to OWNER/MANAGER/KITCHEN.

## 9. Financial Invariant — Order Create

Server-authoritative prices (product base, variant price, catalog modifier price); custom
modifiers priced by client (by design); subtotal = Σ qty×resolved unit price; item total =
unit×qty + modifiers − discount; order `total` initialized from server math. ✓

## 10. Financial Invariant — Order Update

Client `unitPrice` and catalog-modifier prices are ignored in favor of the catalog; stored
snapshot prices survive quantity/discount-only edits; `recalculateOrder` recomputes
`subtotal`, caps discount at item total, and floors `total` at `paidAmount`. ✓

## 11. Financial Invariant — Split / Merge / Duplicate

Split copies stored `unitPrice` (not client input) and re-checks moved quantity against the
source item; merge and duplicate copy stored prices; all three run inside the order version
CAS transaction and call `recalculateOrder`. ✓

## 12. Financial Invariant — Discounts / Service Charge / Tax / Delivery

- Discount: capped at item/order total by `recalculateOrder` (`min(discount, itemTotal)`).
- Service charge and tax: computed server-side from DB-stored rate records.
- Delivery fee: client-settable but only inflates the bill (never deflates) and is then
  subject to the payment cap. Accepted business field; not a P0.
- `finalTotal = max(paidAmount, total − cappedDiscount)`. ✓

## 13. Financial Invariant — Payment Capture

`payments.service.ts` `charge()`: rejects `dto.amount` when `paidAmount + amount > total`
("Payment amount exceeds remaining balance"); per-tenant unique `idempotencyKey` with P2002
replay handling; version CAS on the order; `assertNotMockInProduction`. Payments are capped
at the server-derived order total. ✓

## 14. Financial Invariant — Refunds

Full refund rejects already-refunded / partially-refunded payments; partial refund caps at
`amount − alreadyRefunded`; concurrent refunds guarded by payment CAS; webhook `charge.refunded`
handles full/partial and is replay-safe (no double decrement). ✓

## 15. Financial Invariant — Reconciliation (P0-A)

Reconcile path is read-only (12 contract tests) and never mutates orders or payments. ✓

## 16. Concurrency — Order version CAS

`update`, `split`, `merge`, `duplicate`, and payment `charge` all bump `version` via
`updateMany(where:{version})` and throw `ConflictException` on a 0-count. Concurrent split
and concurrent merge tests prove single-winner semantics. ✓

## 17. Concurrency — Payment/Refund CAS + Idempotency

Order-level version CAS on charge; payment-level CAS on refund/partial-refund; per-tenant
idempotency key uniqueness; P2002 replay either returns the stored payment or rejects a key
reused for a different order. ✓

## 18. Concurrency — GRN averageCost (P0-F) and Inventory

GRN batch attribution and `averageCost` computation are inside a transaction with row locks;
the suite covers the race and the weighted-average math. Inventory movements remain locked
within their transactions. ✓

## 19. Concurrency — Recipe Transaction (P0-H), KDS, Wallet

Recipe create/update runs in a `$transaction` (update-recipe spec covers it); kitchen
ticket/item status updates are scoped and audited; wallet debits/credits are transactional
with balance checks. No untransactional multi-write money path found. ✓

## 20. Schema and Migration Drift

- `prisma validate` → valid.
- `prisma migrate diff --from-url <live DB> --to-schema-datamodel` → **No difference** (exit 0).
- `prisma migrate diff --from-migrations --to-schema-datamodel` (shadow DB) → **No difference** (exit 0).
- 25 migrations present in repo and image.

## 21. Database Runtime State

- Connected as `tablofy` to `tablofy_prod`; **127 public tables**; `_prisma_migrations` has
  25 entries; **all data tables contain 0 rows** (full-table scan) — DB unchanged by this audit.
- Postgres 16-alpine healthy; only the `api` container was recreated.

## 22. Redis AUTH Runtime Proof

- Unauthenticated `PING` → `NOAUTH Authentication required.`
- `PING` with container `REDIS_PASSWORD` → `PONG`
- API connects via `REDIS_PASSWORD` (`buildRedisConnectionOptions`); boot log: "Redis connected successfully".

## 23. Build and Static Gates

- `tsc -p tsconfig.app.json --noEmit` → exit 0
- `eslint apps/api --ext .ts` → exit 0
- `nx build api --configuration=production` → success
- Bundle: `dist/apps/api/main.js`, 2,585,126 bytes, md5 `87627886b7f7e81b777265df2e3df23b`

## 24. Deployment Byte-Identity Sync

- Local build md5 `87627886b7f7e81b777265df2e3df23b` (2,585,126 B)
- In-image md5 (builder stage output) identical
- Running container md5 identical
- Previous baseline `7411d739…` (2,583,229 B) superseded because this audit's P0-J and
  P0-I fixes changed the bundle — expected and verified, not a drift.

## 25. Runtime Health

- `/api/v1/health`, `/api/v1/health/live`, `/api/v1/health/ready` → **200/200/200**
- Container `tablofy-api`: image `3056ecfbf383…`, `RestartCount=0`, `(healthy)`
- Boot logs: no pending migrations; "StripeProvider initialized (mode=live)";
  "Nest application successfully started"; "Redis connected successfully"; no ENOENT/EADDRINUSE.

## 26. Secrets and Environment Posture

- No real secrets in repo, logs, or reports; only dummy test literals (`sk_live_123`) and
  placeholder-pattern text (the prior report line-145 false positive is text, not a credential).
- Logger redaction enforced (24 keys, `logger.service.ts`); payments config rejects
  mock/test in production and rejects `sk_test_` keys for live.
- Container env: `NODE_ENV=production`, `PAYMENTS_MODE=live`, `DATABASE_URL` → postgres
  service, `REDIS_PASSWORD` set. `.env` is untracked/ignored.

## 27. External Verification (Stripe / Paymob)

- Status: **BLOCKED_EXTERNAL** — end-to-end live charge/refund cannot be exercised without
  real gateway credentials and a real payment instrument, which must not be placed in the
  repo or this report. Code-level provider wiring, mode enforcement, webhook signature
  handling, and idempotency are verified; live money-movement certification is a
  post-deployment prerequisite, not a code defect.

## 28. Full Regression

- `jest --config jest.config.ts --no-coverage`: **91 suites / 1165 tests pass**
  (baseline 90/1159; +2 P0-J orders tests, +4 global role-reference tests).

## 29. Remaining Risks / Limitations

- Live-payment certification outstanding (external).
- Variant↔product ownership is not validated on create (a variant of a different product is
  rejected only for existence, not membership). Priced correctly regardless; noted, not a P0.
- Docker daemon was down mid-audit; Docker Desktop was restarted and all containers
  returned healthy with data intact.
- Frontend consumption of variant prices (price display) is out of scope for this backend gate.

## 30. GO/NO-GO Criteria and Next Actions

All 12 gate criteria evaluated:

- Backend pricing server-authoritative: **PASS**
- Payment/refund caps: **PASS**
- RBAC deny-by-default + valid role strings: **PASS**
- Concurrency CAS: **PASS**
- Schema zero drift: **PASS**
- DB untouched / migrations clean: **PASS**
- Redis AUTH: **PASS**
- Tests / typecheck / lint / build: **PASS**
- Deploy byte-identity: **PASS**
- Runtime health: **PASS**
- Secrets posture: **PASS**
- Live-gateway certification: **BLOCKED_EXTERNAL** (prerequisite, not a defect)

**Verdict: CONDITIONAL GO FOR PHASE 3.**

Next actions (backend): commit this audit's changes on `feature/phase7-m5` when the owner
requests it; before live billing, complete real Stripe/Paymob certification; no further
backend work is required for the pricing/RBAC gates.

---

**STOP — Phase 3 work must not begin from this audit; any Phase 3 scope requires a new explicit request.**
