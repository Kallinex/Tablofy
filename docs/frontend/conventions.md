# API Conventions

Cross-cutting rules that apply to **every** endpoint. Read this before touching
`api-reference.md`.

## 1. Base URL and versioning

- Global prefix: `/api` (configurable via `API_PREFIX`).
- URI versioning: `/v1` (default). All routes are therefore
  **`<host>/api/v1/<path>`**.
- No controller overrides the version, so every endpoint in this pack is `/api/v1/...`.
- WebSocket gateways are **not** versioned (they use plain Socket.IO namespaces,
  e.g. `/kitchen`).

3. **Swagger / OpenAPI** is available at `/docs` (non-production, or in
   production only when `SWAGGER_ENABLED=true` behind HTTP Basic auth). The JSON
   is at `/docs-json`. Use it to generate a typed client.
4. **Static uploads** are served from `/uploads/<...>` (not under `/api`).

## Authentication

### Token model

- Login/register return `{ user, tokens: { accessToken, refreshToken } }`.
- Send the access token on every request: `Authorization: Bearer <accessToken>`.
- Access token TTL default **15 minutes** (`JWT_EXPIRATION`), refresh token TTL
  default **7 days** (`JWT_REFRESH_EXPIRATION`).
- Refresh by calling `POST /api/v1/auth/refresh` with `{ refreshToken }`.
  **Note:** the refresh response returns tokens twice — flat
  `{ accessToken, refreshToken }` **and** nested `{ tokens: { ... } }`. Read the
  flat fields (or handle both) to be safe.

### Endpoints that do **not** require a token (`@Public()`)

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`,
  `POST /auth/forgot-password`, `POST /auth/reset-password`,
  `GET /auth/verify-email/:token`
- `GET /invitations/token/:token`, `POST /invitations/accept`
- `POST /webhooks/stripe`, `POST /webhooks/paymob`

Everything else requires a valid Bearer token.

### Two-factor authentication

`GET /auth/2fa/status` → `{ enabled }`; `POST /auth/2fa/setup` → `{ secret, otpauthUrl }`
(render the otpauth URL as a QR code); `POST /auth/2fa/enable|disable` with a
6-digit `{ code }`.

### Authorization layers (applied globally, in this order)

1. `JwtAuthGuard` — validates the token unless the route is `@Public()`.
2. `RolesGuard` — enforces `@Roles(...)` and `@Permissions(...)` metadata
   (see the matrix below). If a route declares neither, it is denied unless it
   is `@Authenticated()`.
3. `TenantGuard` — ensures the token's tenant is active and, if the URL contains
   a `:tenantId` param, that it matches the token's tenant.
4. `PlanThrottleGuard` + `ThrottlerGuard` — rate limiting (see below).

### Authenticated principal

The token resolves to `{ id, email, role, tenantId }` on the server. The UI does
not need to send any of these; they are implied.

## Multi-tenancy

- A user belongs to exactly one `tenantId`.
- All list/read/write queries are automatically scoped to that tenant.
- Cross-tenant resources live under a path param (e.g.
  `/restaurants/:restaurantId/branches/:branchId/floors`). The UI should treat
  these ids as opaque strings from previously fetched objects.
- `SUPER_ADMIN` is the only cross-tenant role; it accesses `/tenants` directly
  (those routes use `@SkipTenantCheck()`).

## Response shapes

> **Important:** there is **no global success envelope**. A type
> `ApiResponse<T> = { success, data, timestamp }` and a
> `TransformResponseInterceptor` exist in the codebase, but the interceptor is
> **not registered** (only `AuditLogInterceptor` and
> `PerformanceMonitorInterceptor` are global). Controllers return their values
> **directly**. Build the client against the shapes below, not against
> `{ success, data }`.

**Success**

- **Single resource** → the entity object itself, e.g.
  `GET /api/v1/customers/:id` returns the customer JSON at the top level.
- **List** → the paginated object:
  ```json
  { "data": [ ... ], "meta": { "total": 123, "page": 1, "limit": 20,
    "totalPages": 7, "hasNext": true, "hasPrevious": false } }
  ```
- **Mutations** → usually the created/updated entity; some action endpoints
  return a small object (e.g. `{ id }`, a status flag), and deletes may return
  `204 No Content` (empty body). Check the per-endpoint notes in
  `api-reference.md`.

**Error** — the global `HttpExceptionFilter` returns:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2026-10-09T12:00:00.000Z",
  "path": "/api/v1/users",
  "correlationId": "…",
  "requestId": "…"
}
```

- `message` may be a **string or a string array** (class-validator returns an
  array of messages). Design form error display to handle both.
- `X-Correlation-Id` and `X-Request-ID` are echoed back as headers; show the
  correlation id in error toasts for support.

Common status codes: `400` validation, `401` unauthenticated/expired token,
`403` insufficient role/permission, `404` not found, `409` conflict (unique
constraint, invalid state transition), `429` rate limited, `500` server error.

## Pagination, filtering & sorting

Standard list envelope:

```json
{
  "data": [ ... ],
  "meta": { "total": 123, "page": 1, "limit": 20, "totalPages": 7 }
}
```

- Defaults: `page=1`, `limit=20`, max `limit=100`.
- Common query params: `page`, `limit`, `search`, `sortBy`, `sortOrder` (`asc`|`desc`).
  Not every endpoint supports all of them — see `api-reference.md`.
- **Inconsistencies to design around:**
  - Some modules add `hasNext` / `hasPrevious` to `meta` (recipes, inventory,
    purchases, forecasting, customers, exports, scheduled-reports).
  - `backup`, `gift-cards` return `{ data, total, page, limit }` (**no**
    `totalPages`).
  - Several child collections are **not paginated** and return a plain array:
    product images, product availability, product ingredients, product allergen
    assignments, business hours/exceptions, inventory categories/units/locations,
    item batches, cycle-count items.
- Query params that need coercion are declared explicitly; `true`/`false`
  strings are the safe way to pass booleans (e.g. `?isActive=false`).

## Sorting

- Defaults: `sortBy=createdAt`, `sortOrder=desc`.
- Not all list endpoints accept `sortBy`; where they do, use the "sorting"
  notes in `api-reference.md`.

## Rate limiting

Two layers:

- Global throttler: **120 requests / 60 s** per client by default
  (`THROTTLE_TTL`, `THROTTLE_LIMIT`).
- Plan-based throttler (per 60 s window) — `FREE 30`, `BASIC 60`,
  `STANDARD 120`, `PREMIUM 300`, `ENTERPRISE 1000`. Unauthenticated requests
  get **100 / 60 s**; API keys get **600 / 60 s**. Exceeded requests get
  `429 { message: "Rate limit exceeded. Please try again later." }`.
- Auth-sensitive endpoints have tighter per-route throttles (per minute):
  `register` 20, `login` 30, `refresh` 60, `forgot-password` 3,
  `reset-password` 3, `change-password` 3, `verify-email` 5. Design
  retry/backoff UI accordingly.

## Uploads

Only **product images** currently support upload:

`POST /api/v1/restaurants/:restaurantId/products/:productId/images/upload`
(multipart/form-data, field name `file`).

- Allowed types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
- Max size: **5 MB** by default (`UPLOAD_MAX_IMAGE_SIZE_BYTES`). Multer rejects
  oversized bodies; the server also verifies the file signature (magic bytes),
  not just the client-declared MIME type.
- Response is a `ProductImage` whose URL is served from `/uploads/...`.
- Uploading or providing a URL via `POST .../images` also works for remote URLs.

## Downloads / streaming

- `GET /api/v1/export-engine/exports/:id/download` streams a generated
  CSV/Excel/PDF file (`Content-Disposition: attachment`).
- `GET /api/v1/customers/marketing/export` returns data inline (JSON array or a
  CSV **string**), not a file stream.

## Internationalization

The API ships locale catalogs at `apps/api/src/common/i18n/locales` (`en`, and
an additional locale). Some flows accept a language hint via request; error
`message` values are generally human-readable English strings today, so the UI
should map known `statusCode`/`error` values to localized copy rather than
displaying `message` verbatim where possible.

## Correlation & observability

- Every response carries `X-Correlation-Id` and `X-Request-ID`. Log them with
  errors and show the correlation id in support-facing error dialogs.
- `GET /health` and `GET /metrics` (Prometheus) exist for ops; not user-facing.

## Roles & permissions matrix

Roles: `SUPER_ADMIN`, `OWNER`, `MANAGER`, `STAFF`, `KITCHEN`, `CASHIER`,
`WAITER`, `VIEWER`.

- `SUPER_ADMIN` — cross-tenant platform admin (`/tenants` only). Not a normal
  restaurant user.
- `OWNER` — full access to their tenant.
- `MANAGER` — everything except destructive/owner-only actions
  (delete restaurant, change plan, manage API keys, delete tenant).
- `STAFF` / `CASHIER` / `WAITER` / `KITCHEN` — operational roles.
- `VIEWER` — read-only.

### Permission keys

`orders:read`, `orders:write`, `orders:delete`, `inventory:read`,
`inventory:write`, `customers:read`, `customers:write`, `gift-cards:manage`,
`payments:manage`, `users:manage`, `reports:read`, `analytics:read`,
`kitchen:manage`, `settings:manage`.

### Effective permissions by role

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
| reports:read      |      ✓      |   ✓   |    ✓    |       |         |         |        |   ✓    |
| analytics:read    |      ✓      |   ✓   |    ✓    |       |         |         |        |   ✓    |
| kitchen:manage    |      ✓      |   ✓   |    ✓    |       |    ✓    |         |        |        |
| settings:manage   |      ✓      |   ✓   |         |       |         |         |        |        |
| users:manage      |      ✓      |   ✓   |         |       |         |         |        |        |

> `OWNER` and `SUPER_ADMIN` hold the wildcard `*`. The UI should **hide or
> disable** actions the current role cannot perform, and still handle a `403`
> gracefully if it happens.

## CORS & headers

- CORS is enabled for configured origins with credentials; the SPA origin is
  allow-listed server-side.
- Security headers (Helmet), compression, and static `/uploads/` are configured
  globally. Do not rely on the API serving the SPA.

## Conventions cheat-sheet for the FE

- `DELETE` routes return `200` with `{ message }` in most modules; `api-keys`,
  `recipes`, `gift-cards(transactions)`, inventory items/categories, and
  `barcodes` return `204 No Content` — handle both (no body to parse).
- `PATCH` is used for a few updates (customers, scheduled-reports); `PUT`
  elsewhere.
- Plans/prices: `FREE 0`, `BASIC 29`, `STANDARD 99`, `PREMIUM 299`,
  `ENTERPRISE 999` (per `PlanCatalogEntry`).
