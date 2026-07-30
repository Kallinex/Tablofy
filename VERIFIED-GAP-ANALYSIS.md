# VERIFIED GAP ANALYSIS — Tablofy Backend v5.3.0

**Method:** For every claim/gap/recommendation from the previous audit, search the entire repository and report exact evidence. No assumptions.

---

## VERIFICATION SUMMARY

| Previous Claim | Verified? | Corrected Finding |
|---------------|:---------:|-------------------|
| Zero unit tests | ✅ **CORRECT** | 0 spec/test files anywhere |
| No Jest config | ✅ **CORRECT** | No jest.config.* anywhere |
| @nestjs/testing unused | ✅ **CORRECT** | Installed as dep, zero imports |
| No nx test target | ✅ **CORRECT** | No "test" in project.json |
| CI runs 7/14 scripts | ✅ **CORRECT** | Only phase2a, m4, m5, m6, m7, m8, m9 |
| Prisma CLI in prod Docker | ✅ **CORRECT** | `COPY --from=builder ...prisma` at line 42 |
| JWT secrets hardcoded in CI | ✅ **CORRECT** | Plaintext at ci.yml:92-93 |
| DB ports exposed in prod | ✅ **CORRECT** | 5432:5432, 6379:6379 in docker-compose.prod.yml |
| No Docker resource limits | ✅ **CORRECT** | No deploy.resources.limits in any compose |
| enableImplicitConversion:true | ✅ **CORRECT** | main.ts:76-78 |
| OrdersService 1,356 lines | ❌ **INCORRECT** | Actually **1,530 lines** (underestimated) |
| CustomersService 1,402 lines | ❌ **INCORRECT** | Actually **1,511 lines** (underestimated) |
| Rate limit keys include query params | ✅ **CORRECT** | `request.url` at plan-throttle.guard.ts:62 |
| CacheService uses blocking KEYS | ✅ **CORRECT** | cache.service.ts:40, :49 |
| Optimistic locking duplicated 7x | ❌ **INCORRECT** | **6x** in orders.service.ts only |
| 10 empty module directories | ❌ **INCORRECT** | **6** empty dirs (kitchen/, notifications/, reports/, settings/, staff/, subscriptions/) |
| TransformResponseInterceptor dead code | ✅ **CORRECT** | Never imported or registered |
| CI uses fragile sleep 10 | ✅ **CORRECT** | ci.yml:78 |
| No cursor-based pagination | ✅ **CORRECT** | Zero cursor usage; all skip/take |
| PlanLimitsService throws generic Error | ✅ **CORRECT** | `throw new Error(...)` at plan-limits.service.ts:76 |
| Sequential order number generation | ✅ **CORRECT** | orders.service.ts:1488-1495 |
| Settings DTOs use Record<string,unknown> | ✅ **CORRECT** | restaurant-settings and branch-settings DTOs |
| @OnEvent handlers not wrapped | ✅ **CORRECT** | 2 of 5 unguarded (recipes.processor.ts:21, usage-tracking.service.ts:18) |
| No GraphQL federation | ✅ **CORRECT** | No @nestjs/graphql or graphql deps |
| No TS project references | ❌ **INCORRECT** | References declared in tsconfig.json but missing `composite: true` |

---

## CATEGORIES

**A = Already implemented | B = Partially implemented | C = Missing but essential | D = Missing but optional | E = Not recommended**

---

### 1. OFFLINE MODE

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Service Worker | **NOT FOUND** anywhere | ❌ Missing |
| localStorage / IndexedDB | **NOT FOUND** anywhere | ❌ Missing |
| Cache-first strategies | **NOT FOUND** anywhere | ❌ Missing |
| Offline queue | **NOT FOUND** anywhere | ❌ Missing |
| `offline` in any source file | Only in audit reports describing it as missing | ❌ Missing |

**Classification: C (Missing but essential)** — POS systems MUST work during internet outages. Every competitor (Toast, Square, Oracle) has offline mode. Without it, the platform cannot be used as a primary POS.

---

### 2. POS TERMINAL / HARDWARE INTEGRATION

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Print processor | `queues/print.processor.ts` — stub only, `// In production, integrate with thermal printer/ESC-POS driver` comment | ⚠️ Stub exists |
| Barcode gateway | `barcodes/barcode.gateway.ts` — WebSocket for barcode events | ✅ Exists |
| ESC/POS driver | **NOT FOUND** anywhere | ❌ Missing |
| Thermal printer | **NOT FOUND** anywhere | ❌ Missing |
| Cash drawer | **NOT FOUND** anywhere | ❌ Missing |
| Card reader / payment terminal | **NOT FOUND** anywhere | ❌ Missing |
| Receipt printing engine | Receipt settings exist in restaurant/branch settings DTOs, but no actual receipt rendering/printing | ⚠️ Settings exist |
| POS module | No module named "pos" or "POS" | ❌ Missing |
| `source: "POS"` | `Order.source` default value in schema.prisma and orders.service.ts | ✅ Field exists |

**Classification: B (Partially implemented)** — Print processor stub exists, barcode gateway exists, receipt settings exist. But no actual hardware drivers, no ESC/POS, no POS terminal module, no cash drawer, no payment terminal integration.

---

### 3. PCI COMPLIANCE

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| PCI attestation | **NOT FOUND** anywhere | ❌ Missing |
| Tokenization service | **NOT FOUND** anywhere | ❌ Missing |
| Plaintext card storage | `Payment` model stores `gatewayRef` (string) and `gatewayData` (Json) — NO PAN, CVV, or card number fields | ✅ No card data stored |
| `pci` / `PCI` in source code | Only in audit reports | ❌ Missing |
| SAQ documentation | **NOT FOUND** anywhere | ❌ Missing |

**Classification: C (Missing but essential)** — The Payment model does NOT store plaintext card data (good). But for a restaurant POS processing payments, PCI compliance is legally required. No tokenization, no SAQ, no attestation.

---

### 4. SOC 2

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Audit logging | `AuditLog` model (schema.prisma lines 366-391), `AuditLogsService`, `AuditLogsController`, `AuditLogInterceptor` (global), 64+ modules logging CRUD actions, 365-day retention with archival | ✅ Fully implemented |
| SOC 2 attestation | **NOT FOUND** — no SOC 2 report, no formal controls documentation | ❌ Missing |
| Access review controls | **NOT FOUND** beyond RBAC | ❌ Missing |
| Change management | **NOT FOUND** beyond git history | ❌ Missing |

**Classification: B (Partially implemented)** — Full audit trail infrastructure exists and is enterprise-grade. SOC 2 attestation itself is missing but that's an organizational/compliance process, not code.

---

### 5. GDPR / CCPA

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| `dataRetentionUntil` field | `Tenant` model schema.prisma line 204 | ✅ Field exists |
| Export engine | `ExportEngineModule` for report exports (CSV/Excel/JSON) | ✅ Exists for reports |
| Right-to-erasure API | **NOT FOUND** — customer hard-delete doesn't exist (soft-delete only) | ❌ Missing |
| Data portability API | **NOT FOUND** — ExportEngine is for reports, not personal data | ❌ Missing |
| Consent management | **NOT FOUND** anywhere | ❌ Missing |
| Retention enforcement | `dataRetentionUntil` field exists but no scheduler/handler enforces it | ⚠️ Field only |

**Classification: B (Partially implemented)** — `dataRetentionUntil` field on Tenant, `ExportEngineModule` for exports. But no right-to-erasure, no data portability (GDPR Article 20), no consent management, no retention enforcement logic.

---

### 6. GIFT CARDS

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| `GIFT_CARD` in PaymentMethod enum | schema.prisma line 101: `GIFT_CARD` is a value | ✅ Enum exists |
| Gift card module | **NOT FOUND** anywhere | ❌ Missing |
| Gift card issuance | **NOT FOUND** anywhere | ❌ Missing |
| Gift card redemption | **NOT FOUND** anywhere | ❌ Missing |
| Gift card balance tracking | **NOT FOUND** anywhere | ❌ Missing |
| `GIFT_CARD` in RewardType | RewardType enum has COUPON, DISCOUNT, FREE_PRODUCT, etc. — NO gift card | ❌ Missing |

**Classification: B (Partially implemented)** — `GIFT_CARD` is in `PaymentMethod` enum, so schema-level support exists. But no module, no issuance, no redemption, no balance tracking. A major revenue driver for restaurants.

---

### 7. ONLINE ORDERING

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| `TAKEAWAY` / `DELIVERY` in OrderType | schema.prisma line 114 ✅ | ✅ Enum values exist |
| `deliveryAddress` on Order | schema.prisma line 929 ✅ | ✅ Field exists |
| `deliveryFee` on Order | schema.prisma line 928 ✅ | ✅ Field exists |
| Storefront API | **NOT FOUND** anywhere | ❌ Missing |
| Customer-facing ordering | Orders are created via internal API only (no public ordering endpoints) | ❌ Missing |
| Takeaway-specific logic | **NOT FOUND** — types exist but no specific processing | ❌ Missing |

**Classification: B (Partially implemented)** — Order model supports takeaway/delivery at the schema level, but there is NO customer-facing online ordering system. No storefront API, no cart system, no public menu endpoints for customers.

---

### 8. DELIVERY INTEGRATION

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| DoorDash integration | **NOT FOUND** anywhere | ❌ Missing |
| Uber Eats integration | **NOT FOUND** anywhere | ❌ Missing |
| Grubhub integration | **NOT FOUND** anywhere | ❌ Missing |
| Delivery service module | **NOT FOUND** anywhere | ❌ Missing |
| `deliveryFee` / `deliveryAddress` | On Order model — covers the data storage only | ⚠️ Data fields exist |

**Classification: C (Missing but essential)** — In a restaurant platform, DoorDash/Uber Eats integrations are table stakes. Every major competitor has them. The data model supports storing delivery info but there's zero integration code.

---

### 9. THIRD-PARTY INTEGRATIONS / MARKETPLACE

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| QuickBooks integration | **NOT FOUND** anywhere | ❌ Missing |
| Xero integration | **NOT FOUND** anywhere | ❌ Missing |
| Stripe integration | **NOT FOUND** — not in package.json, not imported anywhere | ❌ Missing |
| Square integration | **NOT FOUND** anywhere | ❌ Missing |
| Integration module | No module/service named "integration" | ❌ Missing |
| Webhook system | **NOT FOUND** — zero webhook code | ❌ Missing |
| API key management | **NOT FOUND** — no API key auth mechanism | ❌ Missing |
| `gatewayRef` on Payment | schema.prisma line 1095 — field exists but no gateway integration code | ⚠️ Field only |

**Classification: C (Missing but essential)** — No webhook system, no payment gateway integration (Stripe), no accounting integration (QuickBooks/Xero), no API key management for third-party access. This blocks ecosystem growth.

---

### 10. MOBILE APPS

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| React Native code | **NOT FOUND** anywhere | ❌ Missing |
| Flutter code | **NOT FOUND** anywhere | ❌ Missing |
| iOS directory | **NOT FOUND** anywhere | ❌ Missing |
| Android directory | **NOT FOUND** anywhere | ❌ Missing |
| `mobile` in any source | **NOT FOUND** anywhere | ❌ Missing |

**Classification: D (Missing but optional)** — Mobile apps are important but are a frontend concern. The backend APIs exist to support mobile. Building mobile apps is a separate product track. Not a backend gap per se.

---

### 11. MULTI-LANGUAGE / i18n

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| `Tenant.locale` | schema.prisma line 198: `locale String @default("en")` | ✅ Field exists |
| `Customer.language` | schema.prisma line 1497: `language String @default("en")` | ✅ Field exists |
| Translation files | **NOT FOUND** anywhere | ❌ Missing |
| i18n service | **NOT FOUND** anywhere | ❌ Missing |
| Locale middleware | **NOT FOUND** anywhere | ❌ Missing |
| Localized responses | API always returns English — no Accept-Language handling | ❌ Missing |

**Classification: B (Partially implemented)** — Locale/language fields exist on Tenant and Customer models but there's zero i18n infrastructure. No translation service, no locale middleware, no localized responses.

---

### 12. PAYROLL INTEGRATION

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Payroll module | **NOT FOUND** anywhere | ❌ Missing |
| Payroll integration code | **NOT FOUND** anywhere | ❌ Missing |
| Employee wage data | **NOT FOUND** on User model or anywhere | ❌ Missing |

**Classification: D (Missing but optional)** — Payroll is often handled by specialized providers (Gusto, ADP, Paychex). While Toast provides it, most restaurant POS platforms integrate with third-party payroll rather than building it in-house.

---

### 13. ACCOUNTING INTEGRATION

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| QuickBooks integration | **NOT FOUND** anywhere | ❌ Missing |
| Xero integration | **NOT FOUND** anywhere | ❌ Missing |
| Accounting export | ExportEngine generates CSV/Excel/JSON but not in accounting format | ⚠️ Generic export exists |

**Classification: C (Missing but essential)** — Restaurants NEED accounting integration. QuickBooks and Xero are the industry standard. ExportEngine can export data but not in any accounting-compatible format (QBX, Xero CSV import).

---

### 14. EMPLOYEE MANAGEMENT

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| `staff/` module directory | **EXISTS** but completely **empty** (0 files) | ⚠️ Empty directory |
| Employee scheduling | **NOT FOUND** anywhere | ❌ Missing |
| Timesheets | **NOT FOUND** anywhere | ❌ Missing |
| Clock-in/out | **NOT FOUND** anywhere | ❌ Missing |
| `User` model | Has role (STAFF, KITCHEN, CASHIER, WAITER) but no employee fields (no wage, hire date, manager, department) | ⚠️ Basic user only |
| Employee performance analytics | Kitchen-analytics and sales-analytics have employee performance endpoints | ✅ Analytics exist |

**Classification: B (Partially implemented)** — `staff/` module directory exists but is empty. User model has role-based differentiation. Employee performance analytics exist. But no scheduling, timesheets, clock-in/out, wage management.

---

### 15. SELF-SERVICE KIOSK

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Kiosk module | **NOT FOUND** anywhere | ❌ Missing |
| Kiosk API | **NOT FOUND** anywhere | ❌ Missing |
| `kiosk` in any source | **NOT FOUND** anywhere | ❌ Missing |

**Classification: D (Missing but optional)** — Kiosk mode is valuable but typically a frontend concern. The backend APIs for ordering exist. A kiosk would consume the same order API.

---

### 16. DEVELOPER PORTAL / API KEYS

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| API key model | **NOT FOUND** in schema.prisma | ❌ Missing |
| API key auth guard | **NOT FOUND** anywhere | ❌ Missing |
| API key generation | **NOT FOUND** anywhere | ❌ Missing |
| Developer portal | **NOT FOUND** anywhere | ❌ Missing |
| Rate limit visibility | PlanThrottleGuard sets X-RateLimit headers | ✅ Headers exist |
| Swagger docs | All endpoints documented with @nestjs/swagger | ✅ Full Swagger |

**Classification: C (Missing but essential)** — No API key authentication means every integration must use user JWT tokens (impersonation, rotation issues). No developer portal means no self-service integration. This blocks the platform's ability to become a platform for third-party developers.

---

### 17. UNIT / INTEGRATION TESTING

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| spec/test files | **ZERO** across entire repo | ❌ Missing |
| Jest config | **NONE** anywhere | ❌ Missing |
| @nestjs/testing usage | Installed at package.json:23 but **NEVER imported** | ❌ Unused |
| Nx test target | **NOT PRESENT** in project.json | ❌ Missing |
| Test docs | **NONE** in README or docs/ | ❌ Missing |
| Verify scripts | 14 hand-rolled E2E scripts (~535-615 assertions) | ✅ E2E only |

**Classification: C (Missing but essential)** — No safety net for refactoring. All 69 modules with 449+ TypeScript files have zero isolated verification. The 14 E2E scripts test only happy paths and run against a live DB+Redis. No unit tests, no integration tests, no mocking, no coverage.

---

### 18. CI RUNS 7/14 SCRIPTS

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Scripts in CI | phase2a, m4, m5, m6, m7, m8, m9 (7 scripts) | ✅ In CI |
| Scripts NOT in CI | m2, m3, m5-crm, orders-m1, phase5-m1, phase5-m2, phase5-m3 (7 scripts) | ❌ Missing from CI |
| `sleep 10` | ci.yml:78 — fragile fixed wait | ❌ Fragile |

**Classification: C (Missing but essential)** — Phase 5 inventory/warehouse and Phase 5 M3 analytics have NO CI coverage. A regression could merge undetected.

---

### 19. PRISMA CLI IN PROD DOCKER IMAGE

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| prisma in dependencies | package.json:77 — under `dependencies` not `devDependencies` | ✅ Confirmed |
| Dockerfile copies prisma | docker/Dockerfile:42 — `COPY --from=builder ...prisma` | ✅ Confirmed |
| Image size impact | Adds ~150MB+ unnecessarily to production image | ❌ Waste |

**Classification: C (Missing but essential)** — Bloated production images = slower deploys, larger attack surface, higher cost. Fix: move prisma to devDependencies, generate client in build stage only.

---

### 20. CI HARDCODED SECRETS

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| JWT_SECRET in CI | ci.yml:92 — plaintext string | ❌ Hardcoded |
| JWT_REFRESH_SECRET in CI | ci.yml:93 — plaintext string | ❌ Hardcoded |
| GitHub Secrets usage | **ZERO** `${{ secrets.XXX }}` references | ❌ Not used |

**Classification: C (Missing but essential)** — Secrets in CI logs are a security incident waiting to happen. Every CI run exposes these strings.

---

### 21. PROD PORTS EXPOSED

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| postgres ports | docker-compose.prod.yml:12-13 — `5432:5432` | ❌ Exposed |
| redis ports | docker-compose.prod.yml:28-29 — `6379:6379` | ❌ Exposed |

**Classification: C (Missing but essential)** — Exposing databases to the host network is a security risk. Containers on the same Docker network communicate without port mapping.

---

### 22. NO DOCKER RESOURCE LIMITS

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| deploy.resources.limits | **NOT FOUND** in any compose file | ❌ Missing |
| mem_limit / cpus | **NOT FOUND** in any compose file | ❌ Missing |

**Classification: D (Missing but optional)** — Important for production stability but often handled by orchestration (k8s, Nomad) rather than Docker Compose.

---

### 23. NO MONITORING / ALERTING

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Sentry | **NOT FOUND** anywhere | ❌ Missing |
| Prometheus | **NOT FOUND** anywhere | ❌ Missing |
| Grafana | **NOT FOUND** anywhere | ❌ Missing |
| OpenTelemetry | **NOT FOUND** anywhere | ❌ Missing |
| Health endpoint | `GET /api/v1/health` — DB + Redis + memory | ✅ Exists |

**Classification: C (Missing but essential)** — Running in production with no error tracking, no metrics, no dashboards is risky. Health endpoint exists but there's no alerting when health checks fail.

---

### 24. NO CD PIPELINE

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| CD workflow | **NOT FOUND** — no deploy*.yml, release*.yml, cd*.yml | ❌ Missing |
| Staging environment | **NOT FOUND** — no docker-compose.staging.yml | ❌ Missing |
| Deployment docs | `docs/deployment-guide.md` — manual steps only | ⚠️ Manual instructions |

**Classification: C (Missing but essential)** — Manual deployment = human error, no rollback automation, no staging validation, long deployment cycles.

---

### 25. ORDERSERVICE 1,530 LINES

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Actual line count | orders.service.ts — **1,530 lines** | ❌ Monolithic |
| SRP violation | Handles: CRUD, state machine, payments, discounts, split/merge, notes, tax, service charges, kitchen tickets, optimistic locking, order number generation | ❌ Single Responsibility |

**Classification: C (Missing but essential)** — A 1,530-line service is a maintenance nightmare. Cannot unit test, cannot reason about, cannot safely modify.

---

### 26. CUSTOMERSERVICE 1,511 LINES

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Actual line count | customers.service.ts — **1,511 lines** | ❌ Monolithic |
| SRP violation | Handles: CRUD, addresses, preferences, loyalty points, membership, wallet, rewards, referrals, segments, analytics, marketing | ❌ Single Responsibility |

**Classification: C (Missing but essential)** — Same problem as OrdersService.

---

### 27. CACHE USES BLOCKING KEYS

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| `KEYS` command | cache.service.ts:40, :49 — `client.keys()` | ❌ Blocking |
| `SCAN` command | **NOT USED** anywhere | ❌ Should use SCAN |

**Classification: C (Missing but essential)** — `KEYS` blocks Redis for the duration of the scan. On production Redis with millions of keys, this can cause timeouts. This WILL become a problem at scale.

---

### 28. RATE LIMIT KEYS INCLUDE QUERY PARAMS

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Key construction | plan-throttle.guard.ts:62 — `${keyPrefix}:${request.url}` | ❌ Includes query params |
| Impact | `?page=1` and `?page=2` get separate counters | ❌ Defeats rate limiting |

**Classification: D (Missing but optional)** — Inefficient but not breaking. Attackers can still be rate-limited by path. Fix is low effort and low risk.

---

### 29. EMPTY MODULE DIRECTORIES

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Empty directories found | **6**: kitchen/, notifications/, reports/, settings/, staff/, subscriptions/ | ❌ Dead directories |

**Classification: D (Missing but optional)** — Dead directories cause no runtime issues but confuse developers. Cleanup is trivial.

---

### 30. SEQUENTIAL ORDER NUMBER GENERATION

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Method | orders.service.ts:1488-1495 — `SELECT MAX(orderNumber) + 1` | ❌ Race condition |
| Impact | Two concurrent requests can get same order number outside a transaction | ❌ Data integrity risk |

**Classification: C (Missing but essential)** — Race condition on order number generation can cause unique constraint violations in production under load.

---

### 31. PLANLIMITS THROWS GENERIC ERROR

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Error type | plan-limits.service.ts:76 — `throw new Error(...)` | ❌ Not an HttpException |
| Impact | Falls through to global exception filter; returns 500 instead of 403/402 | ❌ Wrong status code |

**Classification: D (Missing but optional)** — Returns HTTP 500 (Internal Server Error) when it should return 402 (Payment Required) or 403 (Forbidden). Confusing for API consumers but not blocking.

---

### 32. CIA SLEEP 10 [Duplicate — same as #18]

---

### 33. @ONEVENT HANDLERS UNGUARDED

| Aspect | Evidence | Verdict |
|--------|----------|---------|
| Unguarded handlers | recipes.processor.ts:21 (`onOrderCompleted`), usage-tracking.service.ts:18 (`trackOrderCreated`) | ❌ 2 of 5 unguarded |
| Impact | Silent failures — unhandled promise rejections are swallowed | ❌ No error visibility |

**Classification: D (Missing but optional)** — Edge case. In production, error tracking (Sentry) would catch these. More of a robustness concern than a blocker.

---

## CLASSIFICATION TABLE (ALL ITEMS)

| # | Feature / Gap | Category | Evidence Summary |
|:-:|--------------|:--------:|------------------|
| F01 | Offline mode | **C** | Critical for POS; every competitor has it |
| F02 | POS hardware integration | **B** | Print stub + barcode gateway exist; no drivers |
| F03 | PCI compliance | **C** | No card data stored (good); no attestation/tokenization |
| F04 | SOC 2 | **B** | Full audit trail exists; no attestation |
| F05 | GDPR / CCPA | **B** | dataRetention field + export engine; no erasure/portability |
| F06 | Gift cards | **B** | PaymentMethod enum has GIFT_CARD; no module |
| F07 | Online ordering | **B** | OrderType + delivery fields; no storefront |
| F08 | Delivery integration | **C** | DoorDash/Uber Eats = table stakes for restaurants |
| F09 | Third-party integrations | **C** | No webhooks, no Stripe, no QBO, no API keys |
| F10 | Mobile apps | **D** | Frontend concern; backend APIs suffice |
| F11 | Multi-language / i18n | **D** | Field exists; no i18n infrastructure |
| F12 | Payroll integration | **D** | Typically handled by 3rd-party specialized providers |
| F13 | Accounting integration | **C** | QuickBooks/Xero are industry standard for restaurants |
| F14 | Employee management | **B** | staff/ dir exists (empty); user roles + analytics only |
| F15 | Self-service kiosk | **D** | Frontend concern; order APIs already exist |
| F16 | Developer portal / API keys | **C** | Blocks ecosystem growth; no 3rd-party auth |
| F17 | Unit / integration tests | **C** | 0 tests across 449 files; no safety net |
| F18 | CI missing 7 verify scripts | **C** | Phase 5 inventory/warehouse/analytics untested in CI |
| F19 | Prisma CLI in prod Docker | **C** | +150MB image; security surface area |
| F20 | CI hardcoded secrets | **C** | Security incident risk |
| F21 | Prod ports exposed | **C** | Database ports on host network |
| F22 | No Docker resource limits | **D** | Ops concern; handled by orchestrator |
| F23 | No monitoring/alerting | **C** | Blind in production; health endpoint can't alert |
| F24 | No CD pipeline | **C** | Manual deploys = risk |
| F25 | OrdersService 1,530 lines | **C** | Unmaintainable; blocks safe refactoring |
| F26 | CustomersService 1,511 lines | **C** | Same as above |
| F27 | Cache uses blocking KEYS | **C** | WILL cause Redis timeouts at scale |
| F28 | Rate limit keys include query params | **D** | Inefficient but not breaking |
| F29 | Empty module directories | **D** | Confusing but harmless |
| F30 | Sequential order numbers | **C** | Race condition at scale |
| F31 | PlanLimits throws generic Error | **D** | Wrong status code but not blocking |
| F32 | CI sleep 10 | **C** | Flaky CI; breaks on slow runners |
| F33 | @OnEvent handlers unguarded | **D** | Edge case; Sentry would catch |
| F34 | Settings DTOs Record<string,unknown> | **D** | Type safety debt; not blocking |
| F35 | No GraphQL federation | **D** | REST works fine; federation is future concern |
| F36 | enableImplicitConversion:true | **D** | Technical debt but not activity harmful |
| F37 | No staging environment | **C** | Testing changes in prod-equivalent env is essential |
| F38 | No database backup automation | **C** | No backups = data loss risk |
| F39 | No logging aggregation (ELK/Loki) | **C** | Cannot search logs across services |
| F40 | No APM / distributed tracing | **D** | Nice-to-have for performance debugging |

---

## CATEGORY C RANKING — Missing but Essential

Ranked by: Business Impact × Enterprise Value × Technical Complexity × Dependencies × ROI

### RANK 1: Unit / Integration Tests (F17)
| Factor | Assessment |
|--------|------------|
| Business Impact | **10/10** — Without tests, every change risks regression. Blocks hiring, slows velocity, kills quality |
| Enterprise Value | **10/10** — Enterprise customers require tested software; no SOC 2 without tests |
| Technical Complexity | **3/10** — Low complexity. Jest + @nestjs/testing + supertest are well-documented patterns |
| Dependencies | **None** — No infrastructure dependencies. Runs standalone |
| ROI | **Highest** of any item. Every hour invested saves 10+ hours of debugging later |
| **Weighted Score** | **9.2/10** |

### RANK 2: CD Pipeline + Staging Environment (F24 + F37)
| Factor | Assessment |
|--------|------------|
| Business Impact | **9/10** — Manual deploys cause downtime, rollback chaos, developer fear |
| Enterprise Value | **9/10** — Enterprise requires documented, repeatable, auditable deployment process |
| Technical Complexity | **4/10** — GitHub Actions deploy + docker-compose staging is straightforward |
| Dependencies | Requires: Docker registry, staging server |
| ROI | **High** — Automates away the most common production incident cause (human error) |
| **Weighted Score** | **8.5/10** |

### RANK 3: Monitoring / Alerting (F23)
| Factor | Assessment |
|--------|------------|
| Business Impact | **9/10** — Without monitoring, you don't know you're down until customers call |
| Enterprise Value | **9/10** — Required for any SLA, SOC 2, or production contract |
| Technical Complexity | **3/10** — Sentry (errors) + Prometheus/Grafana (metrics) + health endpoint wiring |
| Dependencies | Requires: Sentry account, Grafana infra |
| ROI | **High** — First alert pays for itself ten times over |
| **Weighted Score** | **8.3/10** |

### RANK 4: CI Missing Scripts + sleep 10 (F18 + F32)
| Factor | Assessment |
|--------|------------|
| Business Impact | **8/10** — Phase 5 inventory/warehouse changes have zero CI coverage |
| Enterprise Value | **8/10** — CI is a basic quality gate |
| Technical Complexity | **2/10** — Add 7 more `node verify-*.js` lines; replace sleep with health poll |
| Dependencies | None |
| ROI | **Very high** — Low effort, immediate safety improvement |
| **Weighted Score** | **8.2/10** |

### RANK 5: OrdersService 1,530 lines Refactor (F25)
| Factor | Assessment |
|--------|------------|
| Business Impact | **8/10** — Largest file in codebase; changes to orders are high-risk |
| Enterprise Value | **7/10** — Maintainability directly impacts ability to deliver enterprise features |
| Technical Complexity | **7/10** — Must split without breaking state machine; needs unit tests first |
| Dependencies | Requires: Unit test framework (Rank 1) |
| ROI | **High** — Enables safe addition of order features |
| **Weighted Score** | **7.8/10** |

### RANK 6: CustomersService 1,511 lines Refactor (F26)
| Factor | Assessment |
|--------|------------|
| Business Impact | **7/10** — Customer/loyalty module is feature-rich but monolithic |
| Enterprise Value | **7/10** — Same as OrdersService |
| Technical Complexity | **7/10** — Must preserve all customer + loyalty + wallet behavior |
| Dependencies | Requires: Unit test framework (Rank 1) |
| ROI | **High** — Enables CRM feature growth |
| **Weighted Score** | **7.6/10** |

### RANK 7: Offline Mode (F01)
| Factor | Assessment |
|--------|------------|
| Business Impact | **9/10** — POS without offline = unusable during internet outages |
| Enterprise Value | **8/10** — Required for primary POS use case |
| Technical Complexity | **9/10** — Local-first architecture, conflict resolution, sync engine are hard |
| Dependencies | Requires: IndexedDB/localStorage client, sync protocol, conflict resolver |
| ROI | **Medium** — High implementation cost; immediate business value but only if used as primary POS |
| **Weighted Score** | **7.5/10** |

### RANK 8: No Database Backup Automation (F38)
| Factor | Assessment |
|--------|------------|
| Business Impact | **10/10** — No backup = permanent data loss risk |
| Enterprise Value | **10/10** — Non-negotiable for any production system |
| Technical Complexity | **2/10** — pg_dump cron job + S3 upload |
| Dependencies | Requires: S3 bucket, cron host |
| ROI | **Maximum** — Zero effort vs losing all tenant data |
| **Weighted Score** | **7.5/10** |

### RANK 9: Logging Aggregation (F39)
| Factor | Assessment |
|--------|------------|
| Business Impact | **7/10** — Cannot debug production issues across services |
| Enterprise Value | **8/10** — Required for SOC 2, incident response |
| Technical Complexity | **4/10** — Loki + Promtail or ELK stack |
| Dependencies | Requires: Storage infrastructure |
| ROI | **High** — Debugging without logs is 10x slower |
| **Weighted Score** | **7.3/10** |

### RANK 10: Sequential Order Numbers (F30)
| Factor | Assessment |
|--------|------------|
| Business Impact | **6/10** — Race condition under concurrent load; causes 409 errors |
| Enterprise Value | **6/10** — Data integrity issue |
| Technical Complexity | **2/10** — Use database sequence or UUID + increment in transaction |
| Dependencies | None |
| ROI | **High** — Simple fix prevents production errors |
| **Weighted Score** | **7.0/10** |

### RANK 11: CacheService blocking KEYS (F27)
| Factor | Assessment |
|--------|------------|
| Business Impact | **7/10** — WILL cause Redis timeouts at production scale |
| Enterprise Value | **6/10** — Performance issue affects all tenants |
| Technical Complexity | **2/10** — Replace `KEYS` with `SCAN` iterator |
| Dependencies | None |
| ROI | **High** — Simple fix prevents a predictable scaling problem |
| **Weighted Score** | **6.8/10** |

### RANK 12: Delivery Integration (F08)
| Factor | Assessment |
|--------|------------|
| Business Impact | **8/10** — DoorDash/Uber Eats are how modern restaurants get orders |
| Enterprise Value | **7/10** — Required for online ordering ecosystem |
| Technical Complexity | **6/10** — Each provider has unique API; webhook handling for incoming orders |
| Dependencies | Requires: Online ordering (F07), Developer portal (F16) |
| ROI | **Medium** — High revenue impact but significant integration effort |
| **Weighted Score** | **6.5/10** |

### RANK 13: Prisma CLI in Prod Docker (F19)
| Factor | Assessment |
|--------|------------|
| Business Impact | **4/10** — Bloated image but doesn't affect functionality |
| Enterprise Value | **5/10** — Security best practice |
| Technical Complexity | **1/10** — Move prisma to devDependencies, adjust Dockerfile |
| Dependencies | None |
| ROI | **High** — Trivial fix, immediate improvement |
| **Weighted Score** | **6.5/10** |

### RANK 14: Third-Party Integrations / API Keys (F09 + F16)
| Factor | Assessment |
|--------|------------|
| Business Impact | **7/10** — Blocks ecosystem; no QBO = accounting pain for restaurant owners |
| Enterprise Value | **8/10** — Enterprise requires accounting integration |
| Technical Complexity | **7/10** — Webhook system, API key auth, each integration is unique |
| Dependencies | Requires: Developer portal, webhook infrastructure |
| ROI | **Medium** — High value per integration but significant build effort |
| **Weighted Score** | **6.3/10** |

### RANK 15: PCI Compliance (F03)
| Factor | Assessment |
|--------|------------|
| Business Impact | **9/10** — Legal requirement for payment processing |
| Enterprise Value | **9/10** — Non-negotiable |
| Technical Complexity | **7/10** — Tokenization, SAQ, independent assessment |
| Dependencies | Requires: Payment gateway integration |
| ROI | **Medium** — Required by law but is an organizational process as much as code |
| **Weighted Score** | **6.0/10** |

### RANK 16: Accounting Integration (F13)
| Factor | Assessment |
|--------|------------|
| Business Impact | **7/10** — QuickBooks is how restaurant owners track finances |
| Enterprise Value | **7/10** — High demand from enterprise customers |
| Technical Complexity | **5/10** — QuickBooks API is well-documented; Xero similar |
| Dependencies | Requires: Third-party integration infrastructure (F09) |
| ROI | **Medium** — High value per customer but depends on integration platform |
| **Weighted Score** | **5.8/10** |

### RANK 17: Prod Ports Exposed (F21)
| Factor | Assessment |
|--------|------------|
| Business Impact | **4/10** — Risk depends on firewall rules outside Docker |
| Enterprise Value | **5/10** — Security hardening |
| Technical Complexity | **1/10** — Remove lines from docker-compose.prod.yml |
| Dependencies | None |
| ROI | **High** — Trivial fix for security improvement |
| **Weighted Score** | **5.5/10** |

### RANK 18: CI Hardcoded Secrets (F20)
| Factor | Assessment |
|--------|------------|
| Business Impact | **5/10** — Test environment, but secrets in CI logs are visible to all repo collaborators |
| Enterprise Value | **6/10** — Security best practice |
| Technical Complexity | **1/10** — Use `${{ secrets.JWT_SECRET }}` |
| Dependencies | Requires: GitHub Secrets configured |
| ROI | **High** — Trivial fix for security |
| **Weighted Score** | **5.0/10** |

---

## FINAL PRIORITY TABLE

| Rank | Feature / Gap | Category | Business Impact | Complexity | Dependencies | Recommended Milestone |
|:----:|:--------------|:--------:|:--------------:|:----------:|:------------:|:---------------------|
| 1 | Unit / Integration Tests (F17) | **C** | 10/10 | 3/10 | None | **Phase 6 M1 — Critical** |
| 2 | CD Pipeline + Staging (F24+F37) | **C** | 9/10 | 4/10 | Docker registry, staging server | **Phase 6 M1** |
| 3 | Monitoring / Alerting (F23) | **C** | 9/10 | 3/10 | Sentry account, Grafana infra | **Phase 6 M1** |
| 4 | CI coverage + sleep removal (F18+F32) | **C** | 8/10 | 2/10 | None | **Phase 6 M1** |
| 5 | OrdersService refactor (F25) | **C** | 8/10 | 7/10 | Unit tests (Rank 1) | **Phase 6 M2** |
| 6 | CustomersService refactor (F26) | **C** | 7/10 | 7/10 | Unit tests (Rank 1) | **Phase 6 M2** |
| 7 | Offline mode (F01) | **C** | 9/10 | 9/10 | IndexedDB, sync protocol | **Phase 6 M4** |
| 8 | Database backup (F38) | **C** | 10/10 | 2/10 | S3 bucket, cron host | **Phase 6 M1** |
| 9 | Logging aggregation (F39) | **C** | 7/10 | 4/10 | Storage infra | **Phase 6 M2** |
| 10 | Sequential order numbers (F30) | **C** | 6/10 | 2/10 | None | **Phase 6 M1** |
| 11 | Cache blocking KEYS (F27) | **C** | 7/10 | 2/10 | None | **Phase 6 M1** |
| 12 | Delivery integration (F08) | **C** | 8/10 | 6/10 | Online ordering, webhooks | **Phase 6 M4** |
| 13 | Prisma CLI in prod Docker (F19) | **C** | 4/10 | 1/10 | None | **Phase 6 M1** |
| 14 | Third-party integrations + API keys (F09+F16) | **C** | 7/10 | 7/10 | Webhook infra | **Phase 6 M3** |
| 15 | PCI compliance (F03) | **C** | 9/10 | 7/10 | Payment gateway | **Phase 6 M3** |
| 16 | Accounting integration (F13) | **C** | 7/10 | 5/10 | Integration infra (Rank 14) | **Phase 6 M4** |
| 17 | Prod ports exposed (F21) | **C** | 4/10 | 1/10 | None | **Phase 6 M1** |
| 18 | CI hardcoded secrets (F20) | **C** | 5/10 | 1/10 | GitHub Secrets config | **Phase 6 M1** |

### Category B Items (Partially Implemented — Not Blocking)

| Feature | What Exists | What's Missing | Action |
|---------|-------------|----------------|--------|
| POS hardware (F02) | Print stub, barcode gateway, receipt settings | ESC/POS, thermal printer, cash drawer, card terminal | **Phase 6 M5** |
| SOC 2 (F04) | Full audit trail, 365-day retention, archival | Attestation, access review, change management docs | **Org process** |
| GDPR/CCPA (F05) | dataRetentionUntil field, ExportEngine | Right-to-erasure, data portability, consent, retention enforcement | **Phase 6 M4** |
| Gift cards (F06) | GIFT_CARD in PaymentMethod enum | Module, issuance, redemption, balance | **Phase 6 M4** |
| Online ordering (F07) | OrderType TAKEAWAY/DELIVERY, delivery fields | Storefront API, cart, public menu endpoints | **Phase 6 M4** |
| Employee mgmt (F14) | Empty staff/ dir, user roles, performance analytics | Scheduling, timesheets, clock-in/out | **Phase 6 M5** |
| Multi-language (F11) | Tenant.locale, Customer.language fields | i18n infrastructure, translation files, locale middleware | **Phase 6 M5** |

### Category D Items (Optional — No Action Required)

| Feature | Rationale |
|---------|-----------|
| Mobile apps (F10) | Backend APIs support mobile already; frontend is separate project |
| Payroll (F12) | Handled by Gusto/ADP integrations; not core POS |
| Self-service kiosk (F15) | Frontend concern; order APIs exist |
| Docker resource limits (F22) | Handled by orchestrator in production |
| Rate limit keys include query params (F28) | Inefficient but not breaking; low priority |
| Empty module directories (F29) | Cosmetic; clean up during other refactoring |
| PlanLimits throws generic Error (F31) | Wrong status code (500 vs 403) but not activity blocking |
| @OnEvent unguarded (F33) | Edge case; caught by Sentry once monitoring exists |
| Settings DTOs Record<unknown> (F34) | Type safety debt; not activity harmful |
| No GraphQL (F35) | REST works fine; GraphQL is future consideration |
| enableImplicitConversion (F36) | Type coercion risk but existing code works around it |
| No APM (F40) | Nice-to-have; not essential for MVP |

---

## KEY CORRECTIONS TO ORIGINAL AUDIT

The previous audit report contained the following inaccuracies that are now corrected:

| Previous Claim | Correction | Impact |
|---------------|------------|--------|
| OrdersService: 1,356 lines | **1,530 lines** (+174) | Worse than reported |
| CustomersService: 1,402 lines | **1,511 lines** (+109) | Worse than reported |
| 10 empty module directories | **6 empty directories** | Overstated by 4 |
| Optimistic locking duplicated 7x | **6 occurrences** (orders.service.ts only) | Overstated by 1 |
| No TypeScript project references | **References exist** but missing `composite: true` | Overstated; partially configured |
| "No CD pipeline" → Category C | **Confirmed** | Correct |
| "No monitoring" → Category C | **Confirmed** | Correct |
| "No unit tests" → Category C | **Confirmed** | Correct |

---

*Generated: 2026-07-30 08:15 UTC+2*  
*Method: Full source code search for every claim — Grep, Glob, and file reads across entire repository*
