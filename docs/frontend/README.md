# Tablofy — Frontend & UX Design Pack

This folder is the contract between the **backend API** and the **UI/UX + frontend**
team. Everything here is derived from the actual NestJS source under
`apps/api/src` and the Prisma schema, not from assumptions. Use it to design and
build the complete frontend.

> Scope: this is a multi-tenant, role-based restaurant operations platform
> (POS, Kitchen Display, Inventory & Supply Chain, CRM & Marketing, Analytics).
> There are **73 controllers** across **61 feature modules** and **70+ data
> models**.

## Read in this order

| #   | Document                                 | Audience  | What it answers                                                                                                                         |
| --- | ---------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [`conventions.md`](./conventions.md)     | Everyone  | Base URL, auth, tenant scoping, response/error shape, pagination, roles & permissions, rate limits, uploads, downloads. **Read first.** |
| 2   | [`data-model.md`](./data-model.md)       | UX + FE   | Entities, fields, relations and **every status enum** (for badges/filters).                                                             |
| 3   | [`realtime.md`](./realtime.md)           | FE        | All Socket.IO namespaces and exact event names/payloads per screen.                                                                     |
| 4   | [`api-reference.md`](./api-reference.md) | FE        | Full endpoint catalog grouped by product area.                                                                                          |
| 5   | [`ui-ux-brief.md`](./ui-ux-brief.md)     | **UI/UX** | Screens, flows, role-based navigation, state machines, dashboard KPIs, edge cases.                                                      |

If you only have time to open one file before wireframing, open
[`ui-ux-brief.md`](./ui-ux-brief.md). If you are wiring the app, open
[`conventions.md`](./conventions.md) + [`api-reference.md`](./api-reference.md).

## The 60-second orientation

- **Base URL:** `https://<host>/api/v1`
- **Auth:** JWT access token (`Authorization: Bearer <token>`), refresh token
  rotation. Access token lives ~15 min, refresh ~7 days.
- **Tenancy:** every user belongs to one tenant; the backend scopes all data by
  the tenant in the token. The UI never sends a tenant id for normal calls.
- **Roles:** `SUPER_ADMIN`, `OWNER`, `MANAGER`, `STAFF`, `KITCHEN`, `CASHIER`,
  `WAITER`, `VIEWER`. Each role sees a different navigation and can call a
  different subset of endpoints.
- **No success envelope:** a single resource is the entity itself; a list is
  `{ data, meta }`. (An `{ success, data, timestamp }` interceptor exists but is
  **not registered** — see [`conventions.md`](./conventions.md).)
- **Every error** is `{ statusCode, message, error, timestamp, path, correlationId, requestId }`.
- **Lists are almost always paginated** as `{ data, meta: { total, page, limit, totalPages, ... } }`.
- **Realtime** is Socket.IO (13 namespaces), scoped to a per-tenant room, JWT
  authenticated on connect. See [`realtime.md`](./realtime.md).

## Product areas (modules) at a glance

| Area                     | Modules                                                                                                                                                           | Primary roles                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Identity & Access        | auth, users, sessions, invitations, api-keys, tenants, subscriptions, audit-logs, privacy, backup                                                                 | SUPER_ADMIN, OWNER, MANAGER              |
| Org & Settings           | restaurants, branches, branch-settings, restaurant-settings, business-hours, business-exceptions, floors, dining-areas, tables, tax-rates, service-charges, units | OWNER, MANAGER                           |
| Menu & Catalog           | menu, product-variants, product-ingredients, modifier-groups, modifiers, allergens, nutrition, recipes                                                            | OWNER, MANAGER                           |
| Orders & Kitchen         | orders, kds, payments                                                                                                                                             | OWNER, MANAGER, CASHIER, WAITER, KITCHEN |
| Inventory & Supply Chain | inventory, suppliers, purchasing, costing, cycle-counts, forecasting, inventory-analytics, transfers                                                              | OWNER, MANAGER                           |
| CRM & Marketing          | customers, crm, crm-analytics, customer-analytics, campaigns                                                                                                      | OWNER, MANAGER, STAFF                    |
| Analytics & Reporting    | dashboard, executive-dashboard, financial-analytics, sales-analytics, live-analytics, kitchen-analytics, forecasting-dashboard, export-engine, scheduled-reports  | OWNER, MANAGER                           |

## Ground rules for the design team

1. **Assume role-based UI.** Do not design a single flat navigation. See the
   role/permission matrix in `conventions.md` and the per-role nav in
   `ui-ux-brief.md`.
2. **Design for empty, loading and error states.** List endpoints can return
   `data: []` with `meta.total = 0`; dashboards can return zeroed objects.
3. **Money is decimal-as-string** in a few places (branch coordinates, some
   costs) and numbers elsewhere. Treat monetary fields as numbers unless the
   field description says "decimal string".
4. **Statuses are enums with a fixed, known set of values.** Use
   `data-model.md` to build badge/color systems; never invent new statuses.
5. **Realtime is additive.** A screen must still be correct using REST only;
   Socket.IO is used to live-update without a manual refresh.
