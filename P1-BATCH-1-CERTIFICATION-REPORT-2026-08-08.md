# P1 BATCH-1 CERTIFICATION REPORT (Authorization / RBAC)

**Date:** 2026-08-08
**Branch:** uncommitted working tree (repo is not a git repository — file-based delivery)
**Scope:** P1-Batch 1 — Authorization/RBAC hardening (findings **P1-1**, **P1-2**, **P1-16**)
**Authority:** `FORENSIC-AUDIT-2026-08-06.md` and `INDEPENDENT-FORENSIC-AUDIT-2026-08-06.md` (P1-1/P1-2/P1-16, ~L130–149)
**Predecessor:** `P0-CERTIFICATION-REPORT-2026-08-07.md` (baseline gates: 55/55 suites, 519/519 tests; lint baseline 2702 prettier-only / 0 non-prettier)

---

## 1. Findings Addressed

| Finding   | Description                                                                                                              | Fix                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-1**  | RolesGuard is fail-open: handlers with no `@Roles`/`@Permissions` pass through even without a user                       | Guard rewritten **deny-by-default**: no role/permission metadata → request allowed only when `@Authenticated()` and a user is present; otherwise `ForbiddenException`. Empty `@Roles([])`/`@Permissions([])` now fail closed.                                                                                                                                                                                             |
| **P1-2**  | Bull Board `/admin/queues` exposed to any authenticated user across tenants (cross-tenant queue inspection)              | `BullBoardModule` auth middleware now requires **SUPER_ADMIN**, verifies token signature/issuer/audience + Redis revocation, then **re-fetches the user from the DB by `sub`** (`role`, `status`, `tenantId`, `deletedAt`) — never trusts JWT claims. Non-super role, INACTIVE/SUSPENDED/PENDING status, soft-deleted, or missing user → **403**; invalid/revoked/malformed token → **401**; DB lookup failure → **403**. |
| **P1-16** | 95+ authenticated endpoints lack role/permission metadata → effectively authenticated-only, no authorization granularity | All affected controllers now carry explicit `@Permissions(...)` / `@Authenticated()` metadata. Verified by AST scan: **74 controller files, 593 route handlers — ALL gated** (no handler without one of `@Roles`/`@Permissions`/`@Authenticated`/`@Public`).                                                                                                                                                              |

## 2. Changed Files

| File                                                             | Change                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/common/decorators/authenticated.decorator.ts`      | **NEW** `@Authenticated()` + `ANY_AUTHENTICATED_KEY`, typed `PropertyDecorator & MethodDecorator & ClassDecorator` |
| `apps/api/src/common/guards/roles.guard.ts`                      | Deny-by-default rewrite (P1-1)                                                                                     |
| `apps/api/src/common/bull-board/bull-board.module.ts`            | SUPER_ADMIN-only + Prisma re-fetch in `isAuthorized` (P1-2)                                                        |
| `apps/api/src/common/rbac/rbac-route-coverage.spec.ts`           | **NEW** tripwire test — asserts every controller route handler carries RBAC gate metadata                          |
| `apps/api/src/common/guards/tests/roles.guard.spec.ts`           | Rewritten — 13 tests incl. fail-closed, `@Authenticated`, role/permission deny                                     |
| `apps/api/src/common/bull-board/tests/bull-board.module.spec.ts` | Rewritten — 12 tests incl. DB re-fetch (downgrade, INACTIVE, missing, DB error)                                    |

**Gated controllers (19):**

| Controller                     | Gate                     | Controller                           | Gate                                                              |
| ------------------------------ | ------------------------ | ------------------------------------ | ----------------------------------------------------------------- |
| `dashboard.controller.ts`      | `analytics:read` (class) | `supplier-performance.controller.ts` | `inventory:read` (class)                                          |
| `live-analytics.controller.ts` | `analytics:read` (class) | `forecasting.controller.ts`          | `inventory:read` (class)                                          |
| `customers.controller.ts`      | `customers:read` (class) | `recipes.controller.ts`              | `inventory:read` (4 GET handlers)                                 |
| `crm.controller.ts`            | `customers:read` (class) | `purchasing.controller.ts`           | `inventory:read` (5 GET handlers)                                 |
| `inventory.controller.ts`      | `inventory:read` (class) | `campaigns.controller.ts`            | `customers:read` (`promotions/code/:code`, `promotions/validate`) |
| `warehouses.controller.ts`     | `inventory:read` (class) | `scheduled-reports.controller.ts`    | `reports:read` (class)                                            |
| `transfers.controller.ts`      | `inventory:read` (class) | `export-engine.controller.ts`        | `reports:read` (class)                                            |
| `cycle-count.controller.ts`    | `inventory:read` (class) | `sessions.controller.ts`             | `@Authenticated()` (class)                                        |
| `costing.controller.ts`        | `inventory:read` (class) | `auth.controller.ts`                 | `@Authenticated()` (class; public handlers keep `@Public()`)      |
| `barcode.controller.ts`        | `inventory:read` (class) |                                      |                                                                   |

Read-only GETs on recipes/purchasing were gated at **handler level** to avoid touching the pre-existing `CHEF`/`PURCHASING` invalid-role writes (out of scope, see §7). `@Public()` + `@SkipTenantCheck()` paths (health, payment webhooks) untouched and excluded.

## 3. Verification Gates (run on current tree)

| Gate                                                                        | Result                                                                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit -p apps/api/tsconfig.json`                                    | PASS (exit 0)                                                                                                                                       |
| `prisma validate`                                                           | PASS — schema valid (schema untouched)                                                                                                              |
| `nx build api`                                                              | PASS (exit 0)                                                                                                                                       |
| Affected specs: `roles.guard` + `bull-board.module` + `rbac-route-coverage` | **3 suites / 26 tests PASS**                                                                                                                        |
| Full Jest suite (`jest --runInBand --coverage=false`)                       | **56/56 suites, 528/528 tests PASS** (exit 0)                                                                                                       |
| ESLint on all changed files                                                 | 0 errors, 0 warnings                                                                                                                                |
| `nx lint api`                                                               | 0 non-prettier errors; **2702 prettier-only errors** — identical to P0 baseline (CRLF `Delete ␍` + known spec baseline), no new non-prettier issues |
| AST scan (all controllers)                                                  | **74 controller files / 593 route handlers — ALL gated**                                                                                            |

## 4. Docker / Live Runtime Verification

Container `tablofy-api` **healthy** (rebuilt image from current tree, env supplied: `JWT_SECRET`/`JWT_REFRESH_SECRET` from repo `.env`, plus `METRICS_AUTH_TOKEN`, `WEBHOOK_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY` required by production validation).

**Bull Board `/admin/queues` live matrix (real JWTs + real DB records):**

| Case                                     | Result                                 |
| ---------------------------------------- | -------------------------------------- |
| No bearer token                          | **401** ✅                             |
| Token with wrong audience/claims         | **401** ✅                             |
| ACTIVE SUPER_ADMIN                       | **200** ✅                             |
| OWNER token                              | **403** ✅                             |
| DB role downgraded to OWNER (same token) | **403** ✅ (proves DB re-fetch — P1-2) |
| DB status set INACTIVE                   | **403** ✅                             |
| Token referencing non-existent user      | **403** ✅                             |
| Status restored to ACTIVE                | **200** ✅                             |

**Gated API controller live matrix (`/api/v1/dashboard/inventory-summary`):**

| Case                                                             | Result     |
| ---------------------------------------------------------------- | ---------- |
| No token                                                         | **401** ✅ |
| KITCHEN token (lacks `analytics:read`)                           | **403** ✅ |
| MANAGER token (has `analytics:read`, ACTIVE tenant+subscription) | **200** ✅ |

**Runtime endpoints:** `/api/v1/health` 200; `/docs` 200; `/api/v1/metrics` 401 without bearer. All seeded test data (users/tenant/subscription) removed after verification; DB returned to prior empty state.

## 5. Migration Integrity

- **No Prisma schema or migration changes** in Batch 1. `prisma validate` and `prisma migrate status` unaffected.

## 6. Security Semantics

- **Deny-by-default** applies globally via `RolesGuard`; `@Public()` is the only escape hatch and remains limited to health/metrics/webhook endpoints.
- **Permission resolution** unchanged: `ROLE_PERMISSIONS` map (`SUPER_ADMIN`/`OWNER` = `*`; MANAGER/STAFF/KITCHEN/CASHIER/WAITER/VIEWER scoped). `@Permissions` gating is enforced regardless of tenant context.
- **Bull Board** no longer trusts `role`/`tenantId` claims in the JWT for dispatch — authorization always re-reads the user row (P1-2 root cause: stale claims / cross-tenant access).
- **Tripwire** (`rbac-route-coverage.spec.ts`) fails the suite if any future controller route loses RBAC metadata. It checks metadata presence only (not enum-role validity), deliberately avoiding failure on the pre-existing `CHEF`/`PURCHASING` strings.

## 7. Remaining Technical Debt (out of scope for Batch 1)

1. **Pre-existing invalid role strings** `CHEF` (recipes) and `PURCHASING` (purchasing) — write handlers for these roles remain ungated at the role level (not in `UserRole` enum). Inventory/Purchasing **reads** are now gated; the write handlers are intentionally untouched pending a role-model decision.
2. **Coverage thresholds** are not part of the `nx test`/`project.json` gate (runs without `--coverage`). A coverage run surfaces pre-existing uncovered lines (e.g., `auth.controller.ts` 89.83% vs 90% — 6 uncovered 2FA handler lines, pre-existing, none from Batch 1 edits).
3. **Lint baseline** 2702 prettier-only errors (CRLF + known specs) pre-date Batch 1; fixable via `--fix`/`.gitattributes` (separate change).
4. **Repo `.env` stale**: `DATABASE_URL` points at nonexistent `tablofy_dev`; container uses `tablofy_prod`. Compose also does not auto-read root `.env` when `-f docker/...` is used (project dir = `docker/`) — pass `--env-file .env`. This predates Batch 1.
5. **`/ready` and `/live`** endpoints return 404 (P0 report listed them as 200; only `/api/v1/health` exists) — pre-existing, unrelated to Batch 1.

## 8. Verdict

**✅ BATCH CERTIFIED** — P1-Batch 1 (P1-1, P1-2, P1-16) is complete and verified: all gates green (tsc, prisma validate, build, lint non-prettier clean, 56/56 suites & 528/528 tests, affected-spec 26/26), Bull Board cross-tenant exposure closed (live 401/403/200 matrix), deny-by-default enforced with a regression tripwire. Docker verification succeeded after supplying the production-required env vars (`METRICS_AUTH_TOKEN`, `WEBHOOK_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`); the api container runs the current tree and is healthy.

**P1-Batch 2 (SSRF / network security) must not begin without explicit approval.**
