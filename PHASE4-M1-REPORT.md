# PHASE 4 MILESTONE 1: Enterprise Customer Management & Loyalty Platform

## 1. Overview

Phase 4 M1 delivers a comprehensive Enterprise Customer Management & Loyalty Platform for the Tablofy SaaS restaurant management system. The platform adds full customer lifecycle management, multi-tier loyalty program with points, digital wallets, referral tracking, customer segmentation, analytics, and marketing-list export capabilities. The module is multi-tenant with tenant-isolated data, real-time Socket.IO events, BullMQ background job processing, and role-based access control across 45 API endpoints.

## 2. Schema Additions

### 8 New Enums

| Enum | Values |
|------|--------|
| `CustomerStatus` | ACTIVE, INACTIVE, BLOCKED |
| `MembershipTier` | BRONZE, SILVER, GOLD, PLATINUM, DIAMOND |
| `RewardType` | COUPON, DISCOUNT, FREE_PRODUCT, FREE_DRINK, BIRTHDAY, ANNIVERSARY, REFERRAL, PROMOTIONAL |
| `RewardStatus` | ACTIVE, REDEEMED, EXPIRED, CANCELLED |
| `WalletTransactionType` | RECHARGE, SPEND, REFUND, ADJUSTMENT |
| `LoyaltyTransactionType` | EARNED, REDEEMED, EXPIRED, ADJUSTED |
| `ReferralStatus` | PENDING, REWARDED, EXPIRED |
| `SegmentType` | VIP, INACTIVE, HIGH_SPENDER, FREQUENT_VISITOR, NEW_CUSTOMER, LOST_CUSTOMER, CUSTOM |

### 16 New Models

| Model | Key Fields |
|-------|------------|
| `Customer` | id, tenantId, restaurantId, email, phone, firstName, lastName, status (CustomerStatus), tags (String[]), version (concurrency control), soft-delete support |
| `CustomerAddress` | id, customerId, label, address, city, state, zipCode, country, isDefault, latitude, longitude |
| `CustomerPreference` | id, customerId, key, value (unique per customer+key) |
| `VisitHistory` | id, customerId, restaurantId, branchId, orderId, visitedAt, totalSpent, itemsCount |
| `LoyaltyProgram` | id, tenantId (unique), pointsPerCurrency, currencyPerPoint, minPointsRedeem, pointsExpireDays, welcomeBonusPoints, referrerPoints, referredPoints, birthdayPoints, anniversaryPoints |
| `LoyaltyTier` | id, programId, tier (MembershipTier), minPoints, maxPoints, multiplier, discountPercent, priorityService, freeDelivery, birthdayReward, anniversaryReward |
| `LoyaltyPointsTransaction` | id, customerId, points, type (LoyaltyTransactionType), balanceAfter, expiresAt, referenceId, referenceType, metadata |
| `Membership` | id, customerId, tenantId (unique pair), tier (MembershipTier), points, lifetimePoints, totalVisits, totalSpent, joinedAt, lastActivityAt, tierUpgradedAt |
| `MembershipHistory` | id, customerId, fromTier, toTier, reason, pointsAtTime, changedAt |
| `Reward` | id, customerId, type (RewardType), status (RewardStatus), title, code, discountPercent, discountAmount, freeProductName, minOrderAmount, issuedAt, redeemedAt, expiredAt |
| `Wallet` | id, customerId, tenantId (unique pair), balance (Decimal), currency (Currency), isActive, version (concurrency control) |
| `WalletTransaction` | id, walletId, customerId, type (WalletTransactionType), amount, balanceBefore, balanceAfter, referenceId, referenceType, currency |
| `Referral` | id, referrerId, referredId, code (unique), status (ReferralStatus), rewardPoints, rewardGiven, referredAt |
| `CustomerSegment` | id, tenantId, name (unique per tenant), type (SegmentType), rules (JSON), isDynamic, isActive |
| `CustomerSegmentAssignment` | id, customerId, segmentId (unique pair), expiresAt |
| `CustomerAnalytics` | id, customerId (unique), lifetimeValue, averageOrderValue, visitFrequency, totalVisits, totalSpend, totalOrders, favoriteProductId, rewardUsageCount, rewardPointsEarned, rewardPointsRedeemed, daysSinceLastVisit, computedAt |

Migration file: `prisma/migrations/20260729160541_phase4_m1_customers/migration.sql`

## 3. Module Architecture

### Module Structure (`customers.module.ts`)

- **Imports**: `AuditLogsModule`, `CommonModule`
- **Providers**: `CustomersService`, `CustomersGateway`, `CustomersProcessor`
- **Controllers**: `CustomersController`
- **Exports**: `CustomersService`, `CustomersGateway`
- **DTOs**: 18 files in `apps/api/src/modules/customers/dto/`

### Service Methods by Feature Area (`customers.service.ts` - 1402 lines, 47 public methods + 5 private helpers)

#### CRUD (6 methods)
`create`, `findAll` (paginated, filterable, searchable, cached), `findById` (cached with full relation include), `update` (version increment, audit, cache invalidation, real-time broadcast), `softDelete`, `restore`

#### Addresses (3 methods)
`createAddress`, `updateAddress`, `deleteAddress` -- all handle `isDefault` toggling

#### Preferences (2 methods)
`setPreference` (upsert by customerId+key), `deletePreference`

#### Loyalty Points (5 methods)
`earnPoints` (tier multiplier applied, auto-expiry, auto tier-upgrade check), `redeemPoints` (insufficient points guard), `adjustPoints` (admin correction), `getPointHistory` (paginated), `getPointsBalance` (cached)

#### Membership (4 methods)
`getMembership`, `upgradeMembership` (records history, broadcasts event), `getMembershipHistory`, `getAvailableTiers`

#### Rewards (4 methods)
`createReward`, `redeemReward` (active/expiry validation), `cancelReward`, `getCustomerRewards` (optional status filter)

#### Wallet (5 methods)
`getWallet`, `rechargeWallet`, `spendWallet` (insufficient balance guard), `refundWallet`, `getWalletTransactions` (paginated) -- all with version increment concurrency control

#### Referrals (3 methods)
`createReferral` (unique code guard), `completeReferral` (awards referrer+referred points from LoyaltyProgram config), `getReferralStats` (total/rewarded/pending counts + points earned)

#### Segments (8 methods)
`createSegment`, `updateSegment`, `deleteSegment` (cascades assignments), `listSegments` (cached with `_count`), `assignCustomerToSegment`, `removeCustomerFromSegment`, `bulkAssignSegment` (batch upsert with per-item error tolerance)

#### Analytics & Visit History (4 methods)
`getCustomerAnalytics` (returns defaults if none exists), `recomputeAnalytics` (aggregates visits, orders, points, rewards into CustomerAnalytics), `recordVisit` (creates VisitHistory + increments membership totals), `getVisitHistory` (paginated)

#### Marketing & Export (3 methods)
`getEmailList` (active customers with non-null email, optional segment filter), `getSmsList` (active customers with non-null phone, optional segment filter), `exportCustomers` (JSON or CSV format, optional segment filter)

#### Private Helpers (5 methods)
`ensureMembership` (auto-creates BRONZE membership), `ensureWallet` (auto-creates wallet), `getTierConfig`, `calculateExpiry`, `checkTierUpgrade` (automatic tier promotion based on points)

## 4. API Endpoints

All endpoints are prefixed with `/api/v1/customers`. Controller: `customers.controller.ts` (491 lines, 45 endpoints).

### Customer CRUD

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/customers` | OWNER, MANAGER, STAFF, CASHIER | Create customer with auto membership+wallet creation |
| GET | `/api/v1/customers` | Authenticated | List customers (paginated, filterable: status, branch, source, search, tag, minVisits) |
| GET | `/api/v1/customers/tiers` | Authenticated | Get available loyalty tiers |
| GET | `/api/v1/customers/segments` | Authenticated | List all segments |
| GET | `/api/v1/customers/:id` | Authenticated | Get customer by ID (full relations) |
| PATCH | `/api/v1/customers/:id` | OWNER, MANAGER, STAFF | Update customer |
| DELETE | `/api/v1/customers/:id` | OWNER, MANAGER | Soft delete customer |
| POST | `/api/v1/customers/:id/restore` | OWNER, MANAGER | Restore soft-deleted customer |

### Addresses

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/customers/:id/addresses` | OWNER, MANAGER, STAFF | Create customer address |
| PUT | `/api/v1/customers/addresses/:addressId` | OWNER, MANAGER, STAFF | Update customer address |
| DELETE | `/api/v1/customers/addresses/:addressId` | OWNER, MANAGER, STAFF | Delete customer address |

### Preferences

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/customers/:id/preferences` | OWNER, MANAGER, STAFF | Set customer preference (upsert) |
| DELETE | `/api/v1/customers/:id/preferences/:key` | OWNER, MANAGER, STAFF | Delete customer preference |

### Loyalty Points

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/customers/:id/loyalty/earn` | OWNER, MANAGER, CASHIER | Earn loyalty points (tier multiplier applied) |
| POST | `/api/v1/customers/:id/loyalty/redeem` | OWNER, MANAGER, CASHIER | Redeem loyalty points |
| POST | `/api/v1/customers/:id/loyalty/adjust` | OWNER, MANAGER | Adjust loyalty points (admin) |
| GET | `/api/v1/customers/:id/loyalty/balance` | Authenticated | Get points balance |
| GET | `/api/v1/customers/:id/loyalty/history` | Authenticated | Get point transaction history (paginated) |

### Membership

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| GET | `/api/v1/customers/:id/membership` | Authenticated | Get customer membership |
| PUT | `/api/v1/customers/:id/membership/upgrade` | OWNER, MANAGER | Upgrade/downgrade membership tier |
| GET | `/api/v1/customers/:id/membership/history` | Authenticated | Get membership change history |

### Rewards

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/customers/:id/rewards` | OWNER, MANAGER | Create reward for customer |
| POST | `/api/v1/customers/rewards/:rewardId/redeem` | OWNER, MANAGER, CASHIER | Redeem a reward |
| POST | `/api/v1/customers/rewards/:rewardId/cancel` | OWNER, MANAGER | Cancel a reward |
| GET | `/api/v1/customers/:id/rewards` | Authenticated | Get customer rewards (optional status filter) |

### Wallet

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| GET | `/api/v1/customers/:id/wallet` | Authenticated | Get customer wallet |
| POST | `/api/v1/customers/:id/wallet/recharge` | OWNER, MANAGER, CASHIER | Recharge wallet |
| POST | `/api/v1/customers/:id/wallet/spend` | OWNER, MANAGER, CASHIER | Spend from wallet |
| POST | `/api/v1/customers/:id/wallet/refund` | OWNER, MANAGER | Refund to wallet |
| GET | `/api/v1/customers/:id/wallet/transactions` | Authenticated | Get wallet transactions (paginated) |

### Referrals

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/customers/:id/referrals` | OWNER, MANAGER, STAFF | Create referral |
| POST | `/api/v1/customers/referrals/:referralId/complete` | OWNER, MANAGER | Complete referral and award points |
| GET | `/api/v1/customers/:id/referrals/stats` | Authenticated | Get referral statistics |

### Segments

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/customers/segments` | OWNER, MANAGER | Create customer segment |
| PUT | `/api/v1/customers/segments/:segmentId` | OWNER, MANAGER | Update segment |
| DELETE | `/api/v1/customers/segments/:segmentId` | OWNER, MANAGER | Delete segment |
| POST | `/api/v1/customers/segments/:segmentId/assign/:customerId` | OWNER, MANAGER | Assign customer to segment |
| DELETE | `/api/v1/customers/segments/:segmentId/assign/:customerId` | OWNER, MANAGER | Remove customer from segment |
| POST | `/api/v1/customers/segments/:segmentId/bulk-assign` | OWNER, MANAGER | Bulk assign customers to segment |

### Analytics

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| GET | `/api/v1/customers/:id/analytics` | Authenticated | Get customer analytics |
| POST | `/api/v1/customers/:id/analytics/recompute` | OWNER, MANAGER | Recompute customer analytics |

### Visit History

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| GET | `/api/v1/customers/:id/visits` | Authenticated | Get visit history (paginated) |

### Marketing & Export

| Method | Route | RBAC | Description |
|--------|-------|------|-------------|
| GET | `/api/v1/customers/marketing/email-list` | OWNER, MANAGER | Get email list for marketing (optional segment filter) |
| GET | `/api/v1/customers/marketing/sms-list` | OWNER, MANAGER | Get SMS list for marketing (optional segment filter) |
| GET | `/api/v1/customers/marketing/export` | OWNER, MANAGER | Export customers (JSON or CSV, optional segment filter) |

## 5. Real-time Events (Socket.IO)

- **Namespace**: `/customers`
- **Room Isolation**: All events are scoped to `tenant:${tenantId}` rooms via `server.to(\`tenant:${tenantId}\`)`

### Broadcast Methods

| Method | Events Emitted | Data Payload |
|--------|---------------|--------------|
| `broadcastCustomerUpdate` | `customer.created`, `customer.updated`, `customer.deleted`, `customer.restored` | Full customer object / `{ id }` |
| `broadcastLoyaltyUpdate` | `loyalty.earned`, `loyalty.redeemed` | `{ customerId, points, balance }` |
| `broadcastMembershipUpdate` | `membership.changed` | `{ customerId, fromTier, toTier }` |
| `broadcastRewardUpdate` | `reward.redeemed` | `{ rewardId, customerId }` |
| `broadcastWalletUpdate` | `wallet.updated` | `{ customerId, balance }` |

### Room Management

- **`joinTenantRoom(client, tenantId)`**: Clients join `tenant:${tenantId}` room for isolated event delivery
- Built-in lifecycle hooks: `handleConnection`, `handleDisconnect`

## 6. Background Jobs (BullMQ)

### Queue & Worker Registration

All workers are registered in `CustomersProcessor` (`customers.processor.ts`) via `QueueService.registerWorker`:

| Queue Name | Handler | Description |
|------------|---------|-------------|
| `reward-processing` | `handleRewardProcessing` | Processes reward creation, validation, and distribution |
| `point-expiration` | `handlePointExpiration` | Handles loyalty point expiry based on `LoyaltyProgram.pointsExpireDays` |
| `membership-upgrade` | `handleMembershipUpgrade` | Processes deferred membership tier upgrades and notifications |
| `marketing-jobs` | `handleMarketingJob` | Processes marketing campaign list generation and export jobs |
| `notification-jobs` | `handleNotificationJob` | Sends customer notifications (earned points, rewards, membership changes) |

Each handler receives a `BullMQ Job<QueueJobData>` containing `{ tenantId, userId, payload }` and returns `{ processed: true }`.

## 7. Security & RBAC

### Role-Based Access Control Decorators

Roles applied via the `@Roles()` decorator on controller endpoints. The module uses 4 distinct roles:

| Role | Access Level |
|------|-------------|
| `OWNER` | Full access -- all restricted endpoints |
| `MANAGER` | Full access -- all restricted endpoints (same scope as OWNER) |
| `STAFF` | CRUD (create, update), addresses, preferences, referrals |
| `CASHIER` | Customer creation, loyalty earn/redeem, wallet recharge/spend, reward redeem |

### Endpoint Security Summary

- **No RBAC decorator (authenticated only)**: All `GET` endpoints -- `findAll`, `findOne`, `tiers`, `segments` list, `membership`, `membership history`, `rewards`, `wallet`, `wallet transactions`, `loyalty balance`, `loyalty history`, `visits`, `analytics`, `referral stats`
- **OWNER + MANAGER only**: `softDelete`, `restore`, `adjustPoints`, `upgradeMembership`, `createReward`, `cancelReward`, `refundWallet`, `completeReferral`, segment management (all), `recomputeAnalytics`, marketing endpoints
- **OWNER + MANAGER + STAFF**: `update`, addresses CRUD, preferences CRUD, `createReferral`
- **OWNER + MANAGER + CASHIER**: `create`, `earnPoints`, `redeemPoints`, `rechargeWallet`, `spendWallet`, `redeemReward`
- **OWNER + MANAGER + STAFF + CASHIER**: `create` customer

### Additional Security Features

- **Multi-tenant data isolation**: All queries include `tenantId` in WHERE clauses
- **Concurrency control**: `version` field on Customer and Wallet models with `{ increment: 1 }`
- **Soft delete**: Customers use `deletedAt` with `deletedAt: null` filter on all active queries
- **Audit logging**: All mutating operations log to `AuditLogsService` with action name, resource type, user ID, and old/new values
- **Cache isolation**: Cache keys are prefixed/per-tenant via `cacheService`
- **Input validation**: Through class-validator decorators on all 18 DTOs

## 8. Testing Results

- **Total tests**: 132
- **Passed**: 132
- **Failed**: 0
- **Pass rate**: 100%

### Test Structure (`verify-m4.js`)

The integration test suite exercises the full API surface against a live server:

| Test Section | Tests | Endpoints Covered |
|-------------|-------|------------------|
| SETUP | 3 | POST /auth/register, POST /restaurants |
| CUSTOMER CRUD | 19 | POST GET PATCH GET GET (search) GET (profile) POST (second) |
| ADDRESSES | 6 | POST PUT DELETE addresses |
| PREFERENCES | 3 | POST DELETE preferences |
| LOYALTY POINTS | 12 | POST earn (x2), GET balance, POST redeem, POST adjust, GET history, POST insufficient |
| MEMBERSHIP | 10 | GET membership, PUT upgrade, GET history, GET tiers |
| REWARDS | 9 | POST rewards (x3), GET list, POST redeem |
| WALLET | 12 | GET wallet, POST recharge/spend/refund, GET transactions, POST insufficient |
| REFERRALS | 7 | POST referral, GET stats, POST complete |
| VISIT HISTORY | 2 | GET visits |
| ANALYTICS | 4 | GET analytics, POST recompute |
| SEGMENTS | 12 | POST create, PUT update, GET list, POST assign, DELETE assign, POST bulk-assign, DELETE segment |
| MARKETING | 9 | GET email-list, GET sms-list, GET export JSON, GET export CSV |
| SOFT DELETE & RESTORE | 4 | DELETE, GET 404, POST restore, GET restored |
| VALIDATION | 7 | POST empty firstName, too long, invalid email, zero points, negative recharge, invalid reward type, empty segment name |
| AUTH / RBAC | 3 | GET no-auth, POST no-auth, POST recharge (STAFF) |
| TENANT ISOLATION | 7 | POST register second tenant, GET second tenant list + isolation checks |
| PAGINATION | 2 | GET paginated list |
| AUDIT | 2 | GET audit-logs |
| SWAGGER | 1 | GET /docs |

All assertions use the `P()` helper (HTTP status check) and `C()` helper (boolean condition), with descriptive test names and immediate failure reporting.

## 9. Build Status

- **Build command**: `npx nx build api`
- **Result**: success (0 errors, 0 warnings)
