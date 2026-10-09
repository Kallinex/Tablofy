# Realtime (Socket.IO)

Tablofy pushes live updates over **Socket.IO**. REST remains the source of
truth; realtime is used to update a screen without a manual refresh.

## Connecting

- **URL:** the same host as the API (e.g. `wss://<host>`); namespace is appended
  (e.g. `wss://<host>/kitchen`). Use the Socket.IO client (`socket.io-client`),
  not a raw WebSocket.
- **Auth:** send the JWT **access token** on connect, either way:
  - `io(url, { auth: { token: '<accessToken>' } })`, or
  - an `Authorization: Bearer <accessToken>` header.
- The server validates the token (issuer `tablofy`, audience `tablofy-api`),
  the user is `ACTIVE`, and the tenant is `ACTIVE` with an `ACTIVE`
  subscription. Invalid/expired clients are **disconnected** — re-authenticate
  with a fresh access token and reconnect.
- On connect the server joins the socket to the room **`tenant:<tenantId>`**.
  Every broadcast is tenant-scoped, so a client only receives its own tenant's
  data.
- `SUPER_ADMIN` may pass `?tenantId=<id>` on the connection query to observe a
  specific tenant; normal users can only join their own tenant.

### Token expiry

Access tokens are short-lived (~15 min). When the socket disconnects due to an
expired token, refresh via `POST /auth/refresh` and reconnect with the new
token. Design the client to reconnect automatically.

## Namespaces and events

Events are namespaced by feature. Subscribe only to what a screen needs.
Payloads are the same shapes the REST endpoints return unless noted.

### `/kitchen` — Kitchen Display System

Critical for the KDS and any live kitchen view.

| Event                                 | Payload                                                                                                                                | When                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `ticket.created`                      | full `KitchenTicket` incl. `items[]` (`orderItem { productName, variantName, quantity, preparationNotes }`, `station { name, color }`) | An order is confirmed and tickets are created |
| `item.status.changed`                 | updated `KitchenTicketItem` + `stationName`                                                                                            | A ticket item changes status                  |
| `station.created` / `station.updated` | the `KitchenStation`                                                                                                                   | Station CRUD                                  |
| `station.deleted`                     | `{ id }`                                                                                                                               | Station removed                               |

> The KDS gateway is server-push only (no client messages). Order-status and
> table-status changes are **not** broadcast here — see the note at the bottom.

## Namespaces and events (continued)

### `/live-analytics`

- `kpi-update` — live KPI snapshot; payload is `Record<string, unknown>` (the
  same KPI data the `/live-analytics/*` REST routes return). Use it to refresh a
  live dashboard without polling.

### `/customers` (namespace `/customers`)

Events: `customer.created`, `customer.updated`, `customer.deleted`,
`customer.restored`, `loyalty.earned`, `loyalty.redeemed`,
`membership.changed` (`{ customerId, fromTier, toTier }`),
`reward.redeemed` (`{ rewardId, customerId }`),
`wallet.updated` (`{ customerId, balance }`).

### `/crm` and `/campaigns` — connected but currently silent

Both namespaces authenticate clients and their client can emit
`joinTenant` / `leaveTenant`, **but the services emit only internal
`EventEmitter` events** (`crm.timeline.added`, `crm.communication.sent`,
`campaign.created`, `campaign.updated`, `campaign.executed`, `promotion.used`)
and there is no listener forwarding them to the gateway. In other words, **no
live event is actually pushed to the browser on these two namespaces today.**
Design these screens to refresh after mutations / on focus; do not subscribe to
events expecting them to arrive. (Flagged as an integration gap.)

### `/inventory`

Events: `item.created`, `item.updated`, `item.deleted`, `item.restored`,
`category.created`, `category.updated`, `category.deleted`, `unit.created`,
`unit.updated`, `unit.deleted`, `location.created`, `location.updated`,
`location.deleted`, `adjustment.created`, `adjustment.approved`,
`waste.created`, `count.created`, `batch.created`.

### `/warehouses`

Events: `warehouse.created`, `warehouse.updated`, `warehouse.deleted`,
`warehouse.restored`, `zone.created`, `zone.updated`, `zone.deleted`,
`bin.created`, `bin.updated`, `bin.deleted`.

### `/purchasing`

Events: `purchase.created`, `purchase.updated`, `purchase.deleted`,
`purchase.submitted`, `purchase.approved`, `purchase.rejected`,
`purchase.ordered`, `purchase.received`, `purchase.closed`,
`purchase.cancelled`, `goods.received`, `goods.updated`, `goods.cancelled`.

### `/transfers`

Events: `transfer.created`, `transfer.updated`, `transfer.deleted`,
`transfer.submitted`, `transfer.approved`, `transfer.started`,
`transfer.received`, `transfer.cancelled`.

### `/cycle-counts`

Events: `cycle-count.created`, `cycle-count.updated`, `cycle-count.deleted`,
`cycle-count.started`, `cycle-count.completed`, `cycle-count.reconciled`,
`cycle-count.item.counted`, `cycle-count.cancelled`.

### `/forecasting`

Events: `forecast.created`, `reorder.suggestions_generated`,
`reorder.suggestion_approved`, `reorder.suggestion_completed`.

### `/recipes`

Events: `recipe.created`, `recipe.updated`, `recipe.deleted`,
`inventory.deducted`, `deduction.rolled_back`.

### `/barcodes`

Events: `barcode.created`, `barcode.updated`, `barcode.deleted`.

## Room convention (all namespaces)

Every gateway broadcasts only to the room `tenant:<tenantId>`. There is no
per-branch or per-user room. If a screen must show only the current branch, filter
client-side on the payload's `branchId`.

## What is **not** realtime

Order status changes and table status changes are **not** pushed over Socket.IO.
They are emitted as internal events and forwarded as **outbound webhooks**
(server-to-server), not to the browser. Consequences for the UI:

- After mutations like `POST /orders/:id/status` or
  `PUT /tables/:id/status`, **optimistically update** locally and/or re-fetch.
- If a POS/KDS screen must reflect other terminals' order/table changes live,
  the backend needs a broadcast added, or the UI must poll. Flag this as an
  integration gap — do not assume a live order feed exists.

## Recommended client pattern

1. Connect lazily when entering a screen that benefits from live updates; send
   the token from the auth store.
2. Subscribe to only the events that screen needs, and ignore events whose
   payload does not match the currently displayed filters/ids.
3. On `disconnect`, show a subtle "reconnecting…" indicator; the API token
   refresh flow is separate.
4. Always reconcile with a REST fetch on initial mount — never rely on a socket
   event to load initial state.
