# P1 BATCH-2 CERTIFICATION REPORT (SSRF / Network Security)

**Date:** 2026-08-08
**Branch:** uncommitted working tree (git repo initialized; changes not committed — delivery requires explicit approval)
**Scope:** P1-Batch 2 — SSRF / network security (finding **P1-3**)
**Authority:** `FORENSIC-AUDIT-2026-08-06.md` (P1-3, ~L150–156) and `INDEPENDENT-FORENSIC-AUDIT-2026-08-06.md`
**Predecessor:** `P0-CERTIFICATION-REPORT-2026-08-07.md` and `P1-BATCH-1-CERTIFICATION-REPORT-2026-08-08.md`

---

## 1. Finding Addressed

| Finding  | Description                                                                                                                                                                                                                                                                                                                         | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-3** | Webhook registration accepts any `https://` URL and `webhook-processor.ts` delivers to it via `axios.post(url, …, { headers, validateStatus: () => true })` with tenant-controlled headers merged in. A tenant-supplied webhook URL can reach internal services (metadata, Redis, Postgres, BullMQ/Redis, Docker/WSL hosts) — SSRF. | Delivery-time **and** registration-time SSRF guard. New `SsrfModule` provides `SsrfClientService`; `webhook-processor.ts` now delivers through `ssrfClient.postJson()` (URL validated, all resolved IPs must be public, socket lookup pinned against DNS rebinding, every redirect re-validated); `webhooks.service.ts` rejects blocked URLs at create/update (`400 Webhook URL is not allowed: …`); tenant-supplied headers are sanitized (hop-by-hop/forged/platform headers stripped). |

**Verification against current code (2026-08-08):** all three confirmed still present before the fix — `webhook-processor.ts:69` raw `axios.post`, `create-webhook.dto.ts:19` https-only DTO check, `webhooks.service.ts` create/update path. Webhooks are the **only** tenant-controlled outbound HTTP sites in the codebase (Stripe/Paymob providers use operator env config `STRIPE_API_BASE`/`PAYMOB_API_BASE` — not tenant input, deliberately not gated).

## 2. Changed / New Files

| File                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/common/ssrf/ip-blocklist.ts`                      | **NEW** — dependency-free CIDR blocklist: IPv4 (0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4) and IPv6 (::/128, ::1/128, ::/96, ::ffff:0:0/96, 64:ff9b::/96, 100::/64, 2001:db8::/32, 2002::/16, 3fff::/20, fc00::/7, fe80::/10, fec0::/10, ff00::/8). `isPublicAddress()` is deny-by-default for non-literal input.                                                                                                                                  |
| `apps/api/src/common/ssrf/ssrf-guard.ts`                        | **NEW** — `assertSafeOutboundUrl()`: parse+normalize URL, reject disallowed protocols (default `https:`), embedded credentials, empty/oversized URLs (>2000), forbidden hostnames/TLDs (`.local`, `.internal`, `.localhost`, Docker/WSL/metadata/redis/postgres names, `.test`/`.invalid`/`.example`/`.onion`…), numeric/IPv4 representation normalization (`2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1` → `127.0.0.1`), full A+AAAA resolution requiring **every** address public; returns pinned `SafeUrl { url, hostname, port, addresses }`. |
| `apps/api/src/common/ssrf/ssrf-client.service.ts`               | **NEW** — `SsrfClientService`: `assertUrlSafe()`, `postJson()` with `maxRedirects: 0` + manual redirect loop re-validating every hop (limit → `SsrfBlockedError`), and per-protocol `http`/`https.Agent` with a custom `lookup` pinned to the validated public addresses (blocks DNS rebinding between validation and connect).                                                                                                                                                                                                                       |
| `apps/api/src/common/ssrf/ssrf.module.ts`                       | **NEW** — provides/exports `SsrfClientService`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/api/src/common/ssrf/ssrf-guard.spec.ts`                   | **NEW** — 93 tests (blocklist ranges, numeric normalization, blocked literals/encodings, DNS→private/mixed/link-local, unresolvable, protocols, credentials, forbidden hosts, public allow, trailing-dot normalization, http-when-explicitly-permitted).                                                                                                                                                                                                                                                                                              |
| `apps/api/src/common/ssrf/ssrf-client.service.spec.ts`          | **NEW** — 9 tests proving blocked URLs **never reach the HTTP client**, redirect re-validation, redirect cap, config passthrough, and pinned socket lookup.                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/api/src/modules/webhooks/webhook-processor.ts`            | Modified — replaced `axios.post` with `ssrfClient.postJson()`; added `sanitizeUserHeaders()` (strips `host`, `content-length/type`, `transfer-encoding`, `connection`, `keep-alive`, `upgrade`, `te`, `trailer`, `proxy-*`, `via`, `forwarded`, `x-forwarded-*`, `x-original-*`, `x-real-*`, `x-client-*`, `x-webhook-*`); `SsrfBlockedError` fails the delivery fast (`{ delivered: false, ssrfBlocked: true }`, **no retry enqueued**).                                                                                                             |
| `apps/api/src/modules/webhooks/webhooks.service.ts`             | Modified — `assertSafeWebhookUrl()` runs at top of `create()` and in `update()` when `url` changes; blocked → `BadRequestException('Webhook URL is not allowed: …')`.                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/api/src/modules/webhooks/webhooks.module.ts`              | Modified — imports `SsrfModule`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/api/src/modules/webhooks/tests/webhook-processor.spec.ts` | **NEW** — 10 tests (2xx delivered, non-2xx failed without retry, SSRF-block fails fast **without** retry, transient error retries, inactive/missing guards, header sanitization, exact-signature, decrypted secret).                                                                                                                                                                                                                                                                                                                                  |
| `apps/api/src/modules/webhooks/tests/webhooks.service.spec.ts`  | **NEW** — 5 tests (create/update reject blocked URLs before persisting, update skips SSRF when URL unchanged, public accepted, non-SSRF errors rethrown).                                                                                                                                                                                                                                                                                                                                                                                             |

**Net footprint:** 3 files modified (89 insertions / 5 deletions) + 8 new files. No Prisma schema/migration changes. `create-webhook.dto.ts` unchanged (https-only DTO contract retained as transport-level validation).

## 3. Verification Gates (run on current tree)

| Gate                                     | Result                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit -p apps/api/tsconfig.json` | PASS (exit 0)                                                                                                                                      |
| `prisma validate`                        | PASS — schema valid                                                                                                                                |
| `prisma migrate status` (prod DB)        | PASS — 18 migrations, schema up to date (no migration changes)                                                                                     |
| New SSRF + webhook specs                 | **4 suites / 117 tests PASS**                                                                                                                      |
| Full Jest suite                          | **60/60 suites, 645/645 tests PASS** (exit 0) — Batch-1 baseline was 56/56 & 528/528; +4 suites / +117 tests from this batch, **zero regressions** |
| `nx build api --skip-nx-cache`           | PASS (exit 0, webpack compiled)                                                                                                                    |
| ESLint on all changed/new files          | 0 errors, 0 warnings (all auto-fixed; no non-prettier issues)                                                                                      |

## 4. Docker / Live Runtime Verification

Container `tablofy-api` rebuilt from the current tree and **healthy** (env: `JWT_SECRET`/`JWT_REFRESH_SECRET` from repo `.env` + `METRICS_AUTH_TOKEN`, `WEBHOOK_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`). `.dockerignore` excludes `.env`/`.env.*` — no secrets in the image.

**Endpoint matrix:**

| Endpoint                                                                                          | Result                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `/api/v1/health`                                                                                  | **200** ✅                                        |
| `/docs`                                                                                           | **200** ✅                                        |
| `/api/v1/metrics` (no token / correct token)                                                      | **401 → 200** ✅                                  |
| Bull Board `/admin/queues` (no token / garbage token / STAFF JWT / SUPER_ADMIN JWT, real DB rows) | **401 / 401 / 403 / 200** ✅ (P1-2 matrix intact) |

**Live webhook create/update (real OWNER JWT + subscription + tenant):**

| Case                                           | Result                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| POST `https://169.254.169.254/`                | **400** — `Webhook URL is not allowed: Address "169.254.169.254" is not allowed for outbound requests` ✅ |
| POST `https://127.0.0.1/hook`                  | **400** ✅                                                                                                |
| POST `https://localhost/hook`                  | **400** ✅                                                                                                |
| POST `https://[::1]/hook`                      | **400** ✅                                                                                                |
| PUT (update URL to `https://169.254.169.254/`) | **400** — same SSRF message ✅                                                                            |
| POST `https://example.com/hook` (public)       | **201** ✅ (real registration persisted, then cleaned up)                                                 |

**Live delivery path (DB-seeded registration + BullMQ `webhook-delivery` job in the running stack):**

| Scenario                                     | Result                                                                                                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration URL `https://169.254.169.254/…` | Delivery marked with `errorMessage: Blocked by SSRF guard: Address "169.254.169.254" is not allowed for outbound requests`; **no retry enqueued** ✅                                                                                                                 |
| Registration URL `https://example.com/hook`  | Real outbound request executed — HTTP **405** response received from the public server (proves DNS+TLS+egress to legitimate hosts is preserved; example.com returns 405 for POST, so the delivery was marked failed-with-status rather than DELIVERED — expected) ✅ |

All seeded runtime data (tenant, users, subscription, webhooks, deliveries) removed after verification; DB returned to its prior state.

**Runtime DI discovery:** the first production build exposed that a constructor-injected optional `DnsResolver` param (erased type alias) broke Nest DI at boot (`UnknownDependenciesException`). Fixed with a parameterless constructor + `setResolver()`. Unit tests construct the service directly and did not catch this; the **runtime boot did** — confirming the Docker validation requirement was necessary. Container healthy after the fix.

## 5. Security Semantics

- **Fail closed at every layer:** DTO https-only (existing) → registration-time DNS+blocklist check (new) → delivery-time re-validation (new) → pinned socket lookup (new) → manual per-hop redirect validation (new) → header sanitization (new).
- **DNS rebinding:** `assertSafeOutboundUrl` resolves A+AAAA and requires _all_ addresses public; the axios agent `lookup` returns only the pinned addresses so reconnect/redirect can never re-resolve to a private IP.
- **Encoded/alternate IP forms** (decimal `2130706433`, hex `0x7f000001`, octal `0177.0.0.1`, shorthand `127.1`, IPv4-mapped IPv6 `::ffff:127.0.0.1`, NAT64/6to4/ULA/link-local ranges) are normalized and blocked.
- **SSRF blocks fail fast** (`SsrfBlockedError`, `ssrfBlocked: true`) and do **not** enqueue retries — a malicious/blocked target cannot drive queue churn; transient network errors still retry via `webhook-retry` as before.
- **No new env vars or config** introduced; Stripe/Paymob gateway calls (operator-configured `apiBase`) intentionally untouched — legitimate payment/health-check integrations preserved.

## 6. Migration Integrity

- **No schema or migration changes.** `prisma migrate status` against the running prod DB: 18 migrations, up to date.

## 7. Remaining Technical Debt / Deviations

1. **Stripe/Paymob outbound calls are not SSRF-gated** — intentional and documented: `apiBase` is operator env config (`STRIPE_API_BASE`/`PAYMOB_API_BASE`), not tenant/user input. If env is ever made tenant-configurable, they must be gated too.
2. **`prisma migrate status`** on the host required the prod `DATABASE_URL` (`tablofy_prod`); repo `.env` still points at the nonexistent `tablofy_dev`. Pre-existing config debt (Batch-1 §7.4).
3. **Positive delivery live-probe** used `example.com`, which returns 405 for POST — the run proved real egress and the guard's allow-path, but the delivery itself was marked failed-with-405. A full 2xx delivery over the wire was not exercised end-to-end (unit tests cover the 2xx mark-delivered path).
4. **Bull Board matrix** used freshly-seeded users because the Batch-1 seeded SUPER_ADMIN was deleted in cleanup.
5. **Pre-existing debts unchanged:** `/ready`+`/live` 404; `CHEF`/`PURCHASING` invalid-role write handlers; coverage thresholds not enforced; 2702 prettier-only repo lint baseline (all changed files are clean).

## 8. Verdict

**✅ BATCH CERTIFIED** — P1-Batch 2 (P1-3) is complete and verified: all gates green (tsc 0, prisma validate, migrate status up-to-date, `nx build` 0, eslint clean on changed files, **60/60 suites & 645/645 tests** — zero regressions from Batch 1), live Docker verification succeeded (health, docs, metrics, Bull Board 401/401/403/200, webhook create/update rejections with the SSRF message, delivery-time block with no retry, and preserved public egress), no new P0/P1 introduced, no demonstrated SSRF bypass across literal/encoded/DNS/rebinding/redirect vectors, tenant isolation/RBAC intact. The only runtime DI defect found was introduced and fixed within this batch (parameterless constructor + `setResolver`) and is covered by the healthy container plus unit tests.

**P1-Batch 3 must not begin without explicit approval. Nothing has been committed or pushed.**
