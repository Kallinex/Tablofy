# UI/UX Brief — designing the Tablofy frontend

**Audience:** product designers (UI/UX) and frontend leads.
**Goal:** give you everything needed to design the _complete_ frontend from the
backend contract, without access to the code.

Read alongside:

- [`conventions.md`](./conventions.md) — how requests/responses actually behave.
- [`data-model.md`](./data-model.md) — entities + every enum (badges/filters).
- [`api-reference.md`](./api-reference.md) — the exact endpoints per screen.
- [`realtime.md`](./realtime.md) — live updates.

> Everything here is derived from the current backend. Where the backend does
> **not** yet support something the UX needs, it is listed under
> **"Known gaps"** — do not silently design around them; raise them.

---

## 1. Product in one paragraph

Tablofy is a **multi-tenant restaurant operations platform**. One tenant
(company) can own one or more **restaurants**, each with one or more **branches**.
A branch has **tables** organized into **floors / dining areas**. Staff take
**orders** (dine-in, takeaway, delivery), the **kitchen** works **tickets** by
**station**, and **cashiers** take **payments**. Behind it sits **inventory &
supply chain** (items, warehouses, purchasing, transfers, cycle counts),
**menu/recipes**, **CRM & marketing** (customers, loyalty, campaigns), and a deep
**analytics** layer. Every screen is **role-gated**.

---

## 2. Roles & navigation

### 2.1 Roles

`SUPER_ADMIN, OWNER, MANAGER, STAFF, KITCHEN, CASHIER, WAITER, VIEWER`

A user has exactly **one role** and belongs to one **tenant**. `SUPER_ADMIN` is
the only cross-tenant role.

### 2.2 Permission footprint per role

Derived from `role-permissions.ts`. `*` = everything.

| Permission        | SUPER_ADMIN | OWNER | MANAGER | STAFF | KITCHEN | CASHIER | WAITER | VIEWER |
| ----------------- | :---------: | :---: | :-----: | :---: | :-----: | :-----: | :----: | :----: |
| orders:read       |      ✓      |   ✓   |    ✓    |   ✓   |    ✓    |    ✓    |   ✓    |   ✓    |
| orders:write      |      ✓      |   ✓   |    ✓    |   ✓   |         |    ✓    |   ✓    |        |
| orders:delete     |      ✓      |   ✓   |         |       |         |         |        |        |
| inventory:read    |      ✓      |   ✓   |    ✓    |   ✓   |         |         |        |   ✓    |
| inventory:write   |      ✓      |   ✓   |    ✓    |       |         |         |        |        |
| customers:read    |      ✓      |   ✓   |    ✓    |   ✓   |         |    ✓    |   ✓    |        |
| customers:write   |      ✓      |   ✓   |    ✓    |       |         |         |        |        |
| gift-cards:manage |      ✓      |   ✓   |    ✓    |       |         |         |        |        |
| payments:manage   |      ✓      |   ✓   |    ✓    |       |         |    ✓    |        |        |
| users:manage      |      ✓      |   ✓   |         |       |         |         |        |        |
| reports:read      |      ✓      |   ✓   |    ✓    |       |         |         |        |   ✓    |
| analytics:read    |      ✓      |   ✓   |    ✓    |       |         |         |        |   ✓    |
| kitchen:manage    |      ✓      |   ✓   |    ✓    |       |    ✓    |         |        |        |
| settings:manage   |      ✓      |   ✓   |         |       |         |         |        |        |

> The UI must **hide or disable** actions a role can't perform (routes return
> `403` otherwise). Treat the tables in `api-reference.md` as the source of truth
> per endpoint: `Role:` and `Perm:` columns.

### 2.3 Suggested default landing & primary nav

| Role        | Default landing              | Primary nav (examples)                                             |
| ----------- | ---------------------------- | ------------------------------------------------------------------ |
| SUPER_ADMIN | Tenants admin                | Tenants, Subscriptions, Audit, Platform ops                        |
| OWNER       | Executive dashboard          | Everything                                                         |
| MANAGER     | Dashboard / Order list       | Orders, Kitchen, Menu, Inventory, Purchasing, Customers, Analytics |
| CASHIER     | POS / order screen           | Orders, Payments, Customers                                        |
| WAITER      | Floor/table view + new order | Orders, Tables, Customers                                          |
| KITCHEN     | **KDS** (full-screen)        | KDS only (plus order detail read)                                  |
| STAFF       | Orders / Inventory           | Orders, Customers, Inventory (read)                                |
| VIEWER      | Dashboards                   | Read-only analytics/reports/orders/inventory                       |

> The nav is **not** identical per role. Build it from the permission matrix so a
> server-side role change reflects automatically.

---

## 3. App shell & global patterns

- **Context selector (top bar):** the backend scopes almost everything to a
  **restaurant** (`/restaurants/:restaurantId/...`) and often a **branch**
  (`/branches/:branchId/...`). Design a persistent Restaurant + Branch switcher;
  store the selection and put those ids into the paths. (Normal list calls are
  tenant-scoped automatically and need no id.)
- **Auth state:** access token ~15 min, refresh ~7 days, **refresh token
  rotation**. Handle `401` by attempting `POST /auth/refresh` once, then retry;
  on failure, log out. (See `conventions.md`.)
- **Language / direction:** backend ships **`en` and `ar`** locales. Design
  **RTL** for Arabic from day one (mirror navigation, icons, charts order).
- **Permission-aware UI:** hide/disable actions per role. Never rely on hiding
  alone — the API returns `403`.
- **Money & quantities:** treat monetary fields as **numbers**; show the tenant
  **currency** (`USD, EUR, GBP, EGP, SAR, AED`). Round consistently (2 dp).
- **Dates/times:** times like business hours are `"HH:MM"` strings; everything
  else is ISO. Respect the branch/restaurant **timezone** when rendering
  "today", shifts and reports.
- **IDs:** treat all ids as **opaque strings** (UUIDs); never display them.

### 3.1 Realtime vs REST rules

- A screen must be **correct with REST alone**; Socket.IO only removes the need
  to refresh. Always fetch initial state via REST, then subscribe.
- **Order status and table status are NOT realtime** (see "Known gaps"). Use
  optimistic updates / re-fetch.
- `/crm` and `/campaigns` namespaces connect but currently push nothing.

---

## 4. Information architecture (navigation map)

Mirror the backend sections (`api-reference.md`):

1. **Identity & Access** — Auth/2FA/SSO, Users, Sessions, Invitations, API Keys,
   Tenants, Subscriptions.
2. **Platform & Ops** — Backup, Audit Logs, Privacy/Consent/Data Export,
   Webhooks, Queues, Usage.
3. **Organisation & Settings** — Restaurants, Branches, Branch/Restaurant
   Settings, Business Hours & Exceptions, Floors, Dining Areas, Tables, Tax
   Rates, Service Charges, Units.
4. **Menu & Catalog** — Menu categories, Products, Variants/Variant groups,
   Product ingredients, Modifier groups/Modifiers, Allergens, Nutrition, Tags,
   Ingredients.
5. **Orders, Payments & Kitchen** — Orders, KDS, Payments.
6. **Recipes** — Recipes, cost breakdown, deduction reports.
7. **Inventory & Supply Chain** — Inventory, Warehouses, Purchasing, Suppliers,
   Supplier Performance, Barcodes, Costing, Transfers, Cycle Counts.
8. **CRM & Marketing** — Customers (loyalty, membership, wallet, rewards,
   referrals, segments), CRM timeline/communications, Campaigns & Promotions,
   Gift Cards.
9. **Analytics & Reporting** — Dashboard, Executive, Live, Sales, Financial,
   Inventory, Customer, CRM, Kitchen, Supplier, Forecasting, Scheduled Reports,
   Export.

---

## 5. Screen catalog (what to design)

For each area: the screens, the endpoints to wire, and the edge cases that
matter. Endpoint methods/paths are in [`api-reference.md`](./api-reference.md).

### 5.1 POS / Orders (highest priority)

- **Order list** — filter by status/type/branch/date; quick stats. `GET
/restaurants/:restaurantId/orders`.
- **New order / order builder** — pick type (DINE_IN / TAKEAWAY / DELIVERY),
  table (dine-in), products with variants + modifier groups (respect
  `min/maxSelection`, `isRequired`), quantities, per-item notes, apply
  discount/tax/service charge. `POST .../orders`, `.../orders/:id/discount`,
  `.../service-charge`, `.../tax-rate`.
- **Order detail** — items, `statusHistory` timeline, notes (GENERAL / KITCHEN /
  CUSTOMER / WAITER), payments, kitchen tickets. Actions: change status, split,
  merge, move table, duplicate, void item, refund. `POST .../orders/:id/status`,
  `.../split`, `.../merge`, `.../move-table`, `.../items/:itemId/void`.
- **Payment / checkout** — split across methods, refund/partial refund, void.
  `POST .../orders/:id/payments`, `.../payments/split`,
  `.../payments/:paymentId/refund|partial-refund|void`.
- **Reconciliation** — `GET .../payments/reconcile`.

Edge cases: order is a **state machine** (see §6); a `409` means an invalid
transition or a concurrent edit — show a clear "reload" affordance.

### 5.2 Kitchen Display (KDS)

- **KDS board** — columns by station; tickets with elapsed timers; color by
  status; bump/advance item status. `GET .../kds/dashboard`,
  `GET .../kds/station-queue/:stationId`,
  `PUT .../kds/ticket-items/:id/status`. **Live** via `/kitchen`
  (`ticket.created`, `item.status.changed`).
- **Station admin** — CRUD stations, assign products to stations. `.../kds/stations`.

Edge cases: design for **no-auth-loss** during a shift (token refresh +
reconnect); large text, high contrast, touch targets for a busy kitchen;
offline-tolerant UI (queue actions, show "reconnecting").

### 5.3 Tables & floor space

- **Tables list / table status board** — status board (AVAILABLE / OCCUPIED /
  RESERVED / OUT_OF_SERVICE), QR regeneration. `GET
.../tables`, `PUT .../tables/:id/status`, `POST .../tables/:id/qr-regenerate`.
- **Floors & dining areas** CRUD. `.../floors`, `.../dining-areas`.
- ⚠️ **No geometry** on Floor/DiningArea/Table — see "Known gaps" before
  designing a drag-and-drop floor plan.

### 5.4 Menu & catalog

- **Menu categories** (sortable), **Products** (price/cost, featured, active,
  images, availability windows per day), **Variants** & **Variant groups**
  (`SINGLE`/`MULTIPLE`, min/max), **Modifier groups/Modifiers**, **Allergens**
  (with icon), **Nutrition**, **Tags**, **Ingredients**.
- Product image upload is the **only** upload endpoint:
  `POST /restaurants/:restaurantId/products/:productId/images/upload` (field
  `file`, jpeg/png/webp/gif ≤ 5 MB), served from `/uploads/...`.

### 5.5 Inventory & supply chain

- **Inventory items** — list with low/critical/out-of-stock filters, expiring
  batches; categories/units/locations CRUD; adjustments (with approval),
  waste, counts, batches. `GET /inventory/low-stock|critical-stock|out-of-stock|expiring`.
- **Warehouses** — warehouses, zones, bins, branch links; occupancy.
- **Purchasing** — purchase orders (DRAFT→…→CLOSED) with submit/approve/order/
  receive/close/cancel; goods receipts. `.../purchase-orders`, `.../goods-receipts`.
- **Suppliers** (+ performance) CRUD.
- **Transfers** — branch-to-branch (DRAFT→PENDING→APPROVED→IN_TRANSIT→RECEIVED);
  stock movements history. `.../transfers`, `.../stock-movements`.
- **Cycle counts** — schedule/start/count items/reconcile. `.../cycle-counts`.
- **Barcodes** — CRUD; **Costing** views.

### 5.6 CRM & marketing

- **Customers** — profile, addresses, preferences, timeline, segments
  (VIP/HIGH_SPENDER/…), notes. Loyalty (points ledger, tiers), Membership,
  Wallet (recharge/spend/refund), Rewards, Referrals.
- **CRM inbox** — timeline entries + communication logs (EMAIL/SMS/PUSH/
  WHATSAPP) with delivery/open/click states.
- **Campaigns** — list/editor (EMAIL/SMS/PUSH/WHATSAPP), execute/pause/clone/
  approve, per-campaign analytics. **Promotions** — code, type
  (PERCENTAGE/FIXED/BUY_X_GET_Y/FREE_DELIVERY/HAPPY_HOUR), validate/use.
- **Gift cards** — issue/recharge/redeem/refund/void, transaction history.

### 5.7 Analytics & reporting

- **Live dashboard**, **Executive**, **Sales**, **Financial**, **Inventory**,
  **Customer**, **CRM**, **Kitchen**, **Supplier**, **Forecasting**, plus
  **Scheduled Reports** and **Export** (CSV/EXCEL/PDF). See §8 for KPIs.

### 5.8 Admin & settings

- Auth: login, register, forgot/reset, verify, 2FA (QR from `otpauthUrl`), SSO.
- Users, invitations (token-based accept), sessions, API keys (secret shown
  once), tenants & subscriptions, audit logs, privacy/consent/data export,
  backup, webhooks, queues, usage.

---

## 6. Cross-cutting UX requirements

- **Loading / empty / error** for every list and dashboard. Lists return
  `{ data, meta }`; empty is `data: []`. Dashboards can return **zeroed objects**.
- **Pagination** is `page` + `limit` (max 100) with `{ total, page, limit,
totalPages, hasNext, hasPrevious }`. Some child collections are **unpaginated
  arrays** (product images/variants/ingredients, business hours, inventory
  categories/units/locations, cycle-count items) — don't design pagers for them.
- **Filters/sort:** common `search`, `sortBy` (default `createdAt`), `sortOrder`
  (`asc|desc`). Not all endpoints support all — check `api-reference.md`.
- **Errors:** `{ statusCode, message, error, timestamp, path, correlationId,
requestId }`; `message` may be a **string or array** (show field-level errors).
  Show `correlationId` in support toasts.
- **Rate limits:** `429` on limits (plan-based and per-route; e.g. login 30/min,
  password reset 3/min). Debounce retries, show countdown/backoff.
- **Conflicts:** `409` (unique constraints, concurrent edits, invalid state
  transitions). Design "reload latest" and optimistic-concurrency messaging.
- **Soft delete + restore:** many resources support restore endpoints — expose
  an "archived/restore" view where relevant (orders, tables, inventory items,
  customers, warehouses, purchase orders...).
- **No global success envelope** — single responses are the entity itself;
  lists are `{ data, meta }`. (See `conventions.md`.)

---

## 7. Core state machines (design these explicitly)

Use these exact enums (from `data-model.md`).

### Order status — `OrderStatus`

`DRAFT → PENDING → CONFIRMED → IN_PREPARATION → READY → SERVED → COMPLETED`,
plus terminal `CANCELLED`, `REFUNDED`, `VOIDED`. Transition via
`POST .../orders/:id/status` (server enforces; invalid → `409`). Render the
`statusHistory` as a vertical timeline.

### Kitchen ticket / item

- Ticket `KitchenStatus`: `PENDING, PREPARING, READY, SERVED, CANCELLED`
- Ticket item `TicketItemStatus`: `PENDING, QUEUED, PREPARING, READY, SERVED,
CANCELLED`. Advance via `PUT .../kds/ticket-items/:id/status`. (Order item
  also carries `kitchenStatus`.)

### Table status (manual)

`AVAILABLE ⇄ OCCUPIED`, plus `RESERVED`, `OUT_OF_SERVICE`
(`PUT .../tables/:id/status`).

### Payment

`PENDING → COMPLETED`; failure `FAILED`; refunds `REFUNDED` /
`PARTIALLY_REFUNDED`. Methods: `CASH, CREDIT_CARD, DEBIT_CARD, MOBILE_PAYMENT,
BANK_TRANSFER, WALLET, GIFT_CARD`.

### Purchase order

`DRAFT → PENDING_APPROVAL → APPROVED → ORDERED → PARTIALLY_RECEIVED → RECEIVED →
CLOSED`; plus `CANCELLED`. Actions map 1:1 to `POST .../purchase-orders/:id/…`
(submit, approve, order, receive, close, cancel). Goods receipt:
`PENDING → COMPLETED | CANCELLED`.

### Transfer

`DRAFT → PENDING → APPROVED → IN_TRANSIT → RECEIVED`; plus `CANCELLED`. Map to
`.../transfers/:id/submit|approve|start|receive|cancel`.

### Cycle count

`SCHEDULED → IN_PROGRESS → BLIND → COMPLETED → APPROVED → RECONCILED`
(also `IN_PROGRESS`, `CANCELLED`). Item: `PENDING → QUEUED? → COUNTED → …`
(see `CycleCountItemStatus`).

### Campaign / promotion

Campaign `DRAFT → ACTIVE → PAUSED → COMPLETED | CANCELLED` (plus an
approval step). Promotion `SCHEDULED → ACTIVE → EXPIRED | INACTIVE`.

### Table/space & inventory statuses

`StockAdjustmentStatus = PENDING/APPROVED/REJECTED`;
`ReorderStatus = PENDING/APPROVED/ORDERED/CANCELLED/COMPLETED`;
`WarehouseStatus = ACTIVE/INACTIVE/MAINTENANCE`;
`StorageBinStatus = AVAILABLE/OCCUPIED/RESERVED/MAINTENANCE`. Full list in
`data-model.md`.

---

## 8. Dashboards & KPIs (widget-ready endpoints)

| Dashboard   | Endpoints (all `GET`, prefixed `/api/v1`)                                                                                                                                                       | Suggested widgets                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------- | ------ | ----------- | ------- | ------------------------------- |
| Live        | `/live-analytics/kpi`, `/sales`, `/inventory-alerts`, `/kitchen-alerts`, `/customer-activity`, `/dashboard`                                                                                     | live tiles, alert feed, activity stream (realtime `kpi-update`) |
| Executive   | `/executive-dashboard/kpi`, `/top-products`, `/top-categories`, `/top-branches`, `/top-employees`, `/top-customers`, `/sales-trend`                                                             | KPI cards, leaderboards, trend chart                            |
| Sales       | `/sales-analytics/overview`, `/revenue-comparison`, `/by-branch                                                                                                                                 | by-product                                                      | by-category`, `/employee-performance`, `/payment-methods`, `/order-channels`, `/discounts`, `/service-charges`, `/taxes`, `/peak-hours`, `/peak-days`, `/conversion` | revenue trend, breakdowns, heatmaps (peak hours/days) |
| Financial   | `/financial-analytics/overview`, `/revenue`, `/cogs`, `/profitability/branches                                                                                                                  | categories                                                      | products`, `/taxes`, `/discounts`, `/refunds`, `/service-charges`                                                                                                    | P&L style, margin, profitability trees                |
| Inventory   | `/inventory-analytics/valuation`, `/turnover`, `/dead-stock`, `/classification`, `/waste`, `/shrinkage`, `/consumption`, `/recipe-usage`, `/forecast-accuracy`, `/stock-aging` + `/dashboard/*` | valuation, ABC classification, aging, waste                     |
| Customer    | `/customer-analytics/overview`, `/retention`, `/churn`, `/lifetime-value`, `/average-spend`, `/visit-frequency`, `/rfm`, `/rewards`, `/wallet`, `/referrals`, `/memberships`                    | retention/churn, LTV, RFM grid                                  |
| CRM         | `/crm-analytics/overview`, `/campaigns/:id`, `/campaign-roi`, `/promotions`, `/coupons`, `/conversion`, `/engagement`, `/automation`                                                            | funnel, ROI, engagement                                         |
| Kitchen     | `/kitchen-analytics/overview`, `/stations/:stationId`, `/queue`, `/delays`, `/efficiency`, `/bottlenecks`                                                                                       | prep-time, station load, bottleneck                             |
| Supplier    | `/supplier-analytics/overview`, `/scorecards`, `/delivery`, `/lead-time`, `/fill-rate`, `/price-variance`, `/quality`, `/purchase-spend`                                                        | scorecards, lead-time, fill rate                                |
| Forecasting | `/forecasting-dashboard/sales                                                                                                                                                                   | revenue                                                         | demand                                                                                                                                                               | inventory                                             | customers | trends | seasonality | growth` | forecast vs actual, seasonality |

Charts should degrade gracefully when a series is empty or all-zero.

---

## 9. Known gaps & cautions (raise these)

1. **Order & table status are not realtime.** No Socket.IO broadcast — use
   optimistic UI / polling. If a POS/KDS must reflect other terminals live,
   backend work is required.
2. **`/crm` and `/campaigns` sockets push nothing** (services emit internal
   events only). Connect is useless today; don't design event subscriptions.

- **No in-app notifications/notification-center endpoints** exist; "notifications"
  appear only as CRM communication logs and webhook deliveries. Don't design a
  bell/notification center expecting an API.
- **No floor-plan geometry** on `Floor`/`DiningArea`/`Table` (only a `metadata`
  JSON on Table). A drag-and-drop floor plan has no persistence today.
- **Only product images can be uploaded.** No generic file/media upload or
  document/import endpoints (CSV import etc.).
- **No search-across-everything endpoint**; search is per-list.
- **Reports/export are async** (create → `status` → download); design a job
  list with progress and expiry.
- **External integrations are not production-ready**: Stripe/Paymob, SMTP, SSO
  IdP, OTLP, backup storage need real credentials — design "provider not
  configured" states.

---

## 10. Suggested UX deliverables (checklist)

1. **Sitemap + role-based navigation** (one nav spec per role).
2. **App shell**: header (restaurant/branch switcher, search, user menu), RTL
   layout, responsive breakpoints (tablet-first for POS/KDS).
3. **Core flows**: POS order→pay, KDS bump, table lifecycle, purchase order,
   transfer, cycle count, campaign, loyalty/coupon.
4. **Component library**: status badges from the enum catalog, data table with
   pagination/filter/sort, empty/loading/error states, timeline, chart set.
5. **Forms**: field-level validation from array `message`, permission-gated
   actions, destructive-action confirmations.
6. **Dashboards**: one wireframe per dashboard in §8 using the listed endpoints.
7. **State diagrams**: ship the order/PO/transfer/cycle-count state machines as
   visual specs.
8. **A11y & i18n**: keyboard nav, focus states, contrast, RTL + `en`/`ar`.
