# API Reference (endpoint catalog)

Auto-extracted from the NestJS controllers under `apps/api/src/modules`
(source of truth). **601 routes across 73 controllers.**

> Prefix every path below with **`/api/v1`**. Example: the row `GET /orders`
> means `GET https://<host>/api/v1/orders`.

## Legend

- **Access** column: `Public` (no token); `Role: …` (any listed role);
  `Perm: …` (role must hold the permissions); `Any authenticated`; or `—`
  (no explicit role/permission — still requires a valid token).
- `_(cross-tenant)_` = route uses `@SkipTenantCheck()` (mainly SUPER_ADMIN).
- Paths contain `:params` you fill from previously fetched objects.

## Contents

1. [Identity & Access](#1-identity-access)
2. [Platform & Operations](#2-platform-operations)
3. [Organisation & Settings](#3-organisation-settings)
4. [Menu & Catalog](#4-menu-catalog)
5. [Orders, Payments & Kitchen](#5-orders-payments-kitchen)
6. [Recipes](#6-recipes)
7. [Inventory & Supply Chain](#7-inventory-supply-chain)
8. [CRM & Marketing](#8-crm-marketing)
9. [Analytics & Reporting](#9-analytics-reporting)

---

## 1. Identity & Access

### Auth

| Method | Path (`/api/v1` + …)        | Access            | Notes                                                                |
| ------ | --------------------------- | ----------------- | -------------------------------------------------------------------- |
| `POST` | `/auth/register`            | Public            | Register a new user account _(cross-tenant)_                         |
| `POST` | `/auth/login`               | Public            | Login with email and password _(cross-tenant)_ → `200`               |
| `POST` | `/auth/refresh`             | Public            | Refresh access token _(cross-tenant)_ → `200`                        |
| `POST` | `/auth/logout`              | Any authenticated | Logout current session _(cross-tenant)_ → `200`                      |
| `POST` | `/auth/logout-all`          | Any authenticated | Logout all devices _(cross-tenant)_ → `200`                          |
| `POST` | `/auth/forgot-password`     | Public            | Request password reset email _(cross-tenant)_ → `200`                |
| `POST` | `/auth/reset-password`      | Public            | Reset password with token _(cross-tenant)_ → `200`                   |
| `POST` | `/auth/change-password`     | Any authenticated | Change password (requires current password) _(cross-tenant)_ → `200` |
| `GET`  | `/auth/verify-email/:token` | Public            | Verify email address _(cross-tenant)_                                |
| `POST` | `/auth/resend-verification` | Any authenticated | Resend email verification _(cross-tenant)_ → `200`                   |
| `GET`  | `/auth/2fa/status`          | Any authenticated | Get two-factor authentication status _(cross-tenant)_                |
| `POST` | `/auth/2fa/setup`           | Any authenticated | Generate a two-factor authentication secret _(cross-tenant)_ → `200` |
| `POST` | `/auth/2fa/enable`          | Any authenticated | Enable two-factor authentication _(cross-tenant)_ → `200`            |
| `POST` | `/auth/2fa/disable`         | Any authenticated | Disable two-factor authentication _(cross-tenant)_ → `200`           |

### SSO

| Method   | Path (`/api/v1` + …)                    | Access               | Notes                                                                    |
| -------- | --------------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| `POST`   | `/auth/sso/connections`                 | Role: OWNER, MANAGER | Create the tenant OIDC SSO connection _(cross-tenant)_                   |
| `GET`    | `/auth/sso/connections`                 | Role: OWNER, MANAGER | List SSO connections for the tenant _(cross-tenant)_                     |
| `GET`    | `/auth/sso/connections/:id`             | Role: OWNER, MANAGER | Get an SSO connection _(cross-tenant)_                                   |
| `PATCH`  | `/auth/sso/connections/:id`             | Role: OWNER, MANAGER | Update an SSO connection _(cross-tenant)_                                |
| `DELETE` | `/auth/sso/connections/:id`             | Role: OWNER          | Delete an SSO connection _(cross-tenant)_                                |
| `GET`    | `/auth/sso/discover`                    | Public               | Check whether an email domain has SSO enabled _(cross-tenant)_           |
| `GET`    | `/auth/sso/callback`                    | Public               | OIDC redirect callback (IdP -> Tablofy) _(cross-tenant)_                 |
| `POST`   | `/auth/sso/exchange`                    | Public               | Exchange a one-time SSO code for Tablofy tokens _(cross-tenant)_ → `200` |
| `GET`    | `/auth/sso/:connectionId/authorize`     | Public               | Start the OIDC or SAML authorization flow _(cross-tenant)_               |
| `POST`   | `/auth/sso/saml/acs`                    | Public               | SAML assertion consumer service (IdP -> Tablofy) _(cross-tenant)_        |
| `GET`    | `/auth/sso/:connectionId/saml/metadata` | Public               | Service provider metadata XML for a SAML connection _(cross-tenant)_     |

### Users

| Method   | Path (`/api/v1` + …) | Access               | Notes                           |
| -------- | -------------------- | -------------------- | ------------------------------- |
| `POST`   | `/users`             | Role: OWNER, MANAGER | Create a new user in the tenant |
| `GET`    | `/users`             | Role: OWNER, MANAGER |                                 |
| `GET`    | `/users/:id`         | Role: OWNER, MANAGER |                                 |
| `PUT`    | `/users/:id`         | Role: OWNER, MANAGER |                                 |
| `DELETE` | `/users/:id`         | Role: OWNER, MANAGER | → `200`                         |
| `POST`   | `/users/:id/restore` | Role: OWNER, MANAGER | → `200`                         |

### Sessions

| Method   | Path (`/api/v1` + …)   | Access            | Notes   |
| -------- | ---------------------- | ----------------- | ------- |
| `GET`    | `/sessions`            | Any authenticated |         |
| `DELETE` | `/sessions/:id`        | Any authenticated | → `200` |
| `POST`   | `/sessions/revoke-all` | Any authenticated | → `200` |

### Invitations

| Method | Path (`/api/v1` + …)        | Access               | Notes                    |
| ------ | --------------------------- | -------------------- | ------------------------ |
| `POST` | `/invitations`              | Role: OWNER, MANAGER |                          |
| `GET`  | `/invitations`              | Role: OWNER, MANAGER |                          |
| `GET`  | `/invitations/token/:token` | Public               | _(cross-tenant)_         |
| `POST` | `/invitations/accept`       | Public               | _(cross-tenant)_ → `200` |
| `POST` | `/invitations/:id/revoke`   | Role: OWNER, MANAGER | → `200`                  |

### API Keys

| Method   | Path (`/api/v1` + …)   | Access               | Notes                  |
| -------- | ---------------------- | -------------------- | ---------------------- |
| `POST`   | `/api-keys`            | Role: OWNER          | Create API key         |
| `GET`    | `/api-keys`            | Role: OWNER, MANAGER | List API keys          |
| `GET`    | `/api-keys/:id`        | Role: OWNER, MANAGER | Get API key            |
| `PUT`    | `/api-keys/:id`        | Role: OWNER          | Update API key         |
| `DELETE` | `/api-keys/:id`        | Role: OWNER          | Delete API key → `204` |
| `POST`   | `/api-keys/:id/rotate` | Role: OWNER          | Rotate API key         |

### Tenants

| Method   | Path (`/api/v1` + …)   | Access            | Notes                                |
| -------- | ---------------------- | ----------------- | ------------------------------------ |
| `POST`   | `/tenants`             | Role: SUPER_ADMIN | Create a new tenant _(cross-tenant)_ |
| `GET`    | `/tenants`             | Role: SUPER_ADMIN | _(cross-tenant)_                     |
| `GET`    | `/tenants/:id`         | Role: SUPER_ADMIN | _(cross-tenant)_                     |
| `PUT`    | `/tenants/:id`         | Role: SUPER_ADMIN | _(cross-tenant)_                     |
| `DELETE` | `/tenants/:id`         | Role: SUPER_ADMIN | _(cross-tenant)_ → `200`             |
| `POST`   | `/tenants/:id/restore` | Role: SUPER_ADMIN | _(cross-tenant)_                     |

### Subscriptions

| Method | Path (`/api/v1` + …)         | Access                              | Notes                                          |
| ------ | ---------------------------- | ----------------------------------- | ---------------------------------------------- |
| `GET`  | `/subscriptions/plans`       | Role: OWNER, MANAGER                | List available subscription plans              |
| `GET`  | `/subscriptions/current`     | Role: OWNER, MANAGER                | Get the current tenant subscription with usage |
| `POST` | `/subscriptions/change-plan` | Role: OWNER · Perm: settings:manage | Change the tenant subscription plan → `200`    |
| `POST` | `/subscriptions/cancel`      | Role: OWNER · Perm: settings:manage | Cancel the tenant subscription → `200`         |
| `POST` | `/subscriptions/reactivate`  | Role: OWNER · Perm: settings:manage | Reactivate a canceled subscription → `200`     |

---

## 2. Platform & Operations

### Backup

| Method | Path (`/api/v1` + …)  | Access      | Notes                   |
| ------ | --------------------- | ----------- | ----------------------- |
| `POST` | `/backup`             | Role: OWNER | Create a new backup     |
| `GET`  | `/backup`             | Role: OWNER | List backups            |
| `GET`  | `/backup/:id`         | Role: OWNER | Get backup by ID        |
| `POST` | `/backup/:id/verify`  | Role: OWNER | Verify backup integrity |
| `POST` | `/backup/:id/restore` | Role: OWNER | Restore from backup     |

### Audit Logs

| Method | Path (`/api/v1` + …) | Access               | Notes                              |
| ------ | -------------------- | -------------------- | ---------------------------------- |
| `GET`  | `/audit-logs`        | Role: OWNER, MANAGER | List audit logs for current tenant |

### Privacy

| Method | Path (`/api/v1` + …)          | Access               | Notes                                          |
| ------ | ----------------------------- | -------------------- | ---------------------------------------------- |
| `POST` | `/privacy/consent`            | Role: OWNER, MANAGER | Record user consent                            |
| `POST` | `/privacy/consent/:id/revoke` | Role: OWNER, MANAGER | Revoke user consent                            |
| `GET`  | `/privacy/consent`            | Role: OWNER, MANAGER | Get consent records                            |
| `POST` | `/privacy/cookies`            | Role: OWNER, MANAGER | Save cookie preferences                        |
| `GET`  | `/privacy/cookies`            | Role: OWNER, MANAGER | Get cookie preferences                         |
| `POST` | `/privacy/export`             | Role: OWNER, MANAGER | Request data export                            |
| `GET`  | `/privacy/export`             | Role: OWNER, MANAGER | Get my export requests                         |
| `GET`  | `/privacy/export/:id`         | Role: OWNER, MANAGER | Get export status                              |
| `POST` | `/privacy/anonymize`          | Role: OWNER, MANAGER | Anonymize my user data (GDPR right to erasure) |

### Webhooks

| Method   | Path (`/api/v1` + …)          | Access               | Notes                       |
| -------- | ----------------------------- | -------------------- | --------------------------- |
| `POST`   | `/webhooks`                   | Role: OWNER, MANAGER | Create webhook registration |
| `GET`    | `/webhooks`                   | Role: OWNER, MANAGER | List webhooks               |
| `GET`    | `/webhooks/:id`               | Role: OWNER, MANAGER | Get webhook                 |
| `PUT`    | `/webhooks/:id`               | Role: OWNER, MANAGER | Update webhook              |
| `DELETE` | `/webhooks/:id`               | Role: OWNER, MANAGER | Delete webhook → `204`      |
| `POST`   | `/webhooks/:id/rotate-secret` | Role: OWNER          | Rotate webhook secret       |
| `GET`    | `/webhooks/:id/deliveries`    | Role: OWNER, MANAGER | List deliveries             |

### Queues

| Method | Path (`/api/v1` + …)  | Access               | Notes           |
| ------ | --------------------- | -------------------- | --------------- |
| `GET`  | `/queues/:name/stats` | Role: OWNER, MANAGER | Get queue stats |

### Usage

| Method | Path (`/api/v1` + …)                                         | Access                       | Notes                                  |
| ------ | ------------------------------------------------------------ | ---------------------------- | -------------------------------------- |
| `GET`  | `/restaurants/:restaurantId/usage/orders/count`              | Role: OWNER, MANAGER, VIEWER | Get total order count for a restaurant |
| `GET`  | `/restaurants/:restaurantId/usage/products/:productId/count` | Role: OWNER, MANAGER, VIEWER | Get order count for a specific product |
| `GET`  | `/restaurants/:restaurantId/usage/products/top`              | Role: OWNER, MANAGER, VIEWER | Get top ordered products               |
| `GET`  | `/restaurants/:restaurantId/usage/orders/daily`              | Role: OWNER, MANAGER, VIEWER | Get daily order counts                 |

---

## 3. Organisation & Settings

### Restaurants

| Method   | Path (`/api/v1` + …)       | Access                              | Notes                                     |
| -------- | -------------------------- | ----------------------------------- | ----------------------------------------- |
| `POST`   | `/restaurants`             | Role: OWNER, MANAGER                | Create a new restaurant                   |
| `GET`    | `/restaurants`             | Role: OWNER, MANAGER, STAFF, VIEWER | List all restaurants for the tenant       |
| `GET`    | `/restaurants/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a restaurant by ID                    |
| `PUT`    | `/restaurants/:id`         | Role: OWNER, MANAGER                | Update a restaurant                       |
| `DELETE` | `/restaurants/:id`         | Role: OWNER                         | Soft delete a restaurant → `200`          |
| `POST`   | `/restaurants/:id/restore` | Role: OWNER                         | Restore a soft-deleted restaurant → `200` |

### Branches

| Method   | Path (`/api/v1` + …)                              | Access                              | Notes                                 |
| -------- | ------------------------------------------------- | ----------------------------------- | ------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/branches`             | Role: OWNER, MANAGER                | Create a new branch for a restaurant  |
| `GET`    | `/restaurants/:restaurantId/branches`             | Role: OWNER, MANAGER, STAFF, VIEWER | List all branches for a restaurant    |
| `GET`    | `/restaurants/:restaurantId/branches/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a branch by ID                    |
| `PUT`    | `/restaurants/:restaurantId/branches/:id`         | Role: OWNER, MANAGER                | Update a branch                       |
| `DELETE` | `/restaurants/:restaurantId/branches/:id`         | Role: OWNER                         | Soft delete a branch → `200`          |
| `POST`   | `/restaurants/:restaurantId/branches/:id/restore` | Role: OWNER                         | Restore a soft-deleted branch → `200` |

### Branch Settings

| Method | Path (`/api/v1` + …)                                     | Access                              | Notes                                         |
| ------ | -------------------------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `GET`  | `/restaurants/:restaurantId/branches/:branchId/settings` | Role: OWNER, MANAGER, STAFF, VIEWER | Get branch settings (metadata)                |
| `PUT`  | `/restaurants/:restaurantId/branches/:branchId/settings` | Role: OWNER, MANAGER                | Update branch settings (merges into metadata) |

### Restaurant Settings

| Method | Path (`/api/v1` + …)                  | Access                              | Notes                                             |
| ------ | ------------------------------------- | ----------------------------------- | ------------------------------------------------- |
| `GET`  | `/restaurants/:restaurantId/settings` | Role: OWNER, MANAGER, STAFF, VIEWER | Get restaurant settings (metadata)                |
| `PUT`  | `/restaurants/:restaurantId/settings` | Role: OWNER, MANAGER                | Update restaurant settings (merges into metadata) |

### Business Hours

| Method   | Path (`/api/v1` + …)                            | Access                              | Notes                                    |
| -------- | ----------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/business-hours`     | Role: OWNER, MANAGER                | Set business hours for a day (upsert)    |
| `GET`    | `/restaurants/:restaurantId/business-hours`     | Role: OWNER, MANAGER, STAFF, VIEWER | List all business hours for a restaurant |
| `GET`    | `/restaurants/:restaurantId/business-hours/:id` | Role: OWNER, MANAGER, STAFF, VIEWER | Get business hours by ID                 |
| `PUT`    | `/restaurants/:restaurantId/business-hours/:id` | Role: OWNER, MANAGER                | Update business hours                    |
| `DELETE` | `/restaurants/:restaurantId/business-hours/:id` | Role: OWNER                         | Delete business hours for a day → `200`  |

### Business Exceptions

| Method   | Path (`/api/v1` + …)                                 | Access                              | Notes                                                      |
| -------- | ---------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/business-exceptions`     | Role: OWNER, MANAGER                | Create a business exception (holiday/special hours)        |
| `GET`    | `/restaurants/:restaurantId/business-exceptions`     | Role: OWNER, MANAGER, STAFF, VIEWER | List business exceptions (optionally filter by date range) |
| `GET`    | `/restaurants/:restaurantId/business-exceptions/:id` | Role: OWNER, MANAGER, STAFF, VIEWER | Get a business exception by ID                             |
| `PUT`    | `/restaurants/:restaurantId/business-exceptions/:id` | Role: OWNER, MANAGER                | Update a business exception                                |
| `DELETE` | `/restaurants/:restaurantId/business-exceptions/:id` | Role: OWNER                         | Delete a business exception → `200`                        |

### Floors

| Method   | Path (`/api/v1` + …)                                               | Access                              | Notes                                |
| -------- | ------------------------------------------------------------------ | ----------------------------------- | ------------------------------------ |
| `POST`   | `/restaurants/:restaurantId/branches/:branchId/floors`             | Role: OWNER, MANAGER                | Create a new floor for a branch      |
| `GET`    | `/restaurants/:restaurantId/branches/:branchId/floors`             | Role: OWNER, MANAGER, STAFF, VIEWER | List all floors for a branch         |
| `GET`    | `/restaurants/:restaurantId/branches/:branchId/floors/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a floor by ID                    |
| `PUT`    | `/restaurants/:restaurantId/branches/:branchId/floors/:id`         | Role: OWNER, MANAGER                | Update a floor                       |
| `DELETE` | `/restaurants/:restaurantId/branches/:branchId/floors/:id`         | Role: OWNER                         | Soft delete a floor → `200`          |
| `POST`   | `/restaurants/:restaurantId/branches/:branchId/floors/:id/restore` | Role: OWNER                         | Restore a soft-deleted floor → `200` |

### Dining Areas

| Method   | Path (`/api/v1` + …)                                              | Access                              | Notes                                      |
| -------- | ----------------------------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| `POST`   | `/restaurants/:restaurantId/branches/:branchId/areas`             | Role: OWNER, MANAGER                | Create a new dining area for a branch      |
| `GET`    | `/restaurants/:restaurantId/branches/:branchId/areas`             | Role: OWNER, MANAGER, STAFF, VIEWER | List all dining areas for a branch         |
| `GET`    | `/restaurants/:restaurantId/branches/:branchId/areas/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a dining area by ID                    |
| `PUT`    | `/restaurants/:restaurantId/branches/:branchId/areas/:id`         | Role: OWNER, MANAGER                | Update a dining area                       |
| `DELETE` | `/restaurants/:restaurantId/branches/:branchId/areas/:id`         | Role: OWNER                         | Soft delete a dining area → `200`          |
| `POST`   | `/restaurants/:restaurantId/branches/:branchId/areas/:id/restore` | Role: OWNER                         | Restore a soft-deleted dining area → `200` |

### Tables

| Method   | Path (`/api/v1` + …)                                                     | Access                              | Notes                                                               |
| -------- | ------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/branches/:branchId/tables`                   | Role: OWNER, MANAGER                | Create a new table for a branch                                     |
| `GET`    | `/restaurants/:restaurantId/branches/:branchId/tables`                   | Role: OWNER, MANAGER, STAFF, VIEWER | List all tables for a branch                                        |
| `GET`    | `/restaurants/:restaurantId/branches/:branchId/tables/:id`               | Role: OWNER, MANAGER, STAFF, VIEWER | Get a table by ID                                                   |
| `PUT`    | `/restaurants/:restaurantId/branches/:branchId/tables/:id`               | Role: OWNER, MANAGER                | Update a table                                                      |
| `PUT`    | `/restaurants/:restaurantId/branches/:branchId/tables/:id/status`        | Role: OWNER, MANAGER, STAFF         | Update table status (AVAILABLE, OCCUPIED, RESERVED, OUT_OF_SERVICE) |
| `POST`   | `/restaurants/:restaurantId/branches/:branchId/tables/:id/qr-regenerate` | Role: OWNER, MANAGER                | Regenerate QR code for a table → `200`                              |
| `DELETE` | `/restaurants/:restaurantId/branches/:branchId/tables/:id`               | Role: OWNER                         | Soft delete a table → `200`                                         |
| `POST`   | `/restaurants/:restaurantId/branches/:branchId/tables/:id/restore`       | Role: OWNER                         | Restore a soft-deleted table → `200`                                |

### Tax Rates

| Method   | Path (`/api/v1` + …)                               | Access                              | Notes                                   |
| -------- | -------------------------------------------------- | ----------------------------------- | --------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/tax-rates`             | Role: OWNER, MANAGER                | Create a tax rate                       |
| `GET`    | `/restaurants/:restaurantId/tax-rates`             | Role: OWNER, MANAGER, STAFF, VIEWER | List tax rates                          |
| `GET`    | `/restaurants/:restaurantId/tax-rates/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a tax rate by ID                    |
| `PUT`    | `/restaurants/:restaurantId/tax-rates/:id`         | Role: OWNER, MANAGER                | Update a tax rate                       |
| `DELETE` | `/restaurants/:restaurantId/tax-rates/:id`         | Role: OWNER                         | Soft delete a tax rate → `200`          |
| `POST`   | `/restaurants/:restaurantId/tax-rates/:id/restore` | Role: OWNER                         | Restore a soft-deleted tax rate → `200` |

### Service Charges

| Method   | Path (`/api/v1` + …)                                     | Access                              | Notes                                         |
| -------- | -------------------------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/service-charges`             | Role: OWNER, MANAGER                | Create a service charge                       |
| `GET`    | `/restaurants/:restaurantId/service-charges`             | Role: OWNER, MANAGER, STAFF, VIEWER | List service charges                          |
| `GET`    | `/restaurants/:restaurantId/service-charges/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a service charge by ID                    |
| `PUT`    | `/restaurants/:restaurantId/service-charges/:id`         | Role: OWNER, MANAGER                | Update a service charge                       |
| `DELETE` | `/restaurants/:restaurantId/service-charges/:id`         | Role: OWNER                         | Soft delete a service charge → `200`          |
| `POST`   | `/restaurants/:restaurantId/service-charges/:id/restore` | Role: OWNER                         | Restore a soft-deleted service charge → `200` |

### Units

| Method   | Path (`/api/v1` + …) | Access                              | Notes                               |
| -------- | -------------------- | ----------------------------------- | ----------------------------------- |
| `POST`   | `/units`             | Role: OWNER, MANAGER                | Create a unit of measurement        |
| `GET`    | `/units`             | Role: OWNER, MANAGER, STAFF, VIEWER | List units of measurement           |
| `GET`    | `/units/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a unit by ID                    |
| `PUT`    | `/units/:id`         | Role: OWNER, MANAGER                | Update a unit                       |
| `DELETE` | `/units/:id`         | Role: OWNER                         | Soft delete a unit → `200`          |
| `POST`   | `/units/:id/restore` | Role: OWNER                         | Restore a soft-deleted unit → `200` |

---

## 4. Menu & Catalog

### Menu

| Method   | Path (`/api/v1` + …)                                              | Access                              | Notes                                          |
| -------- | ----------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/menu-categories`                      | Role: OWNER, MANAGER                | Create a new menu category for a restaurant    |
| `GET`    | `/restaurants/:restaurantId/menu-categories`                      | Role: OWNER, MANAGER, STAFF, VIEWER | List all menu categories for a restaurant      |
| `GET`    | `/restaurants/:restaurantId/menu-categories/:id`                  | Role: OWNER, MANAGER, STAFF, VIEWER | Get a menu category by ID                      |
| `PUT`    | `/restaurants/:restaurantId/menu-categories/:id`                  | Role: OWNER, MANAGER                | Update a menu category                         |
| `DELETE` | `/restaurants/:restaurantId/menu-categories/:id`                  | Role: OWNER                         | Soft delete a menu category → `200`            |
| `POST`   | `/restaurants/:restaurantId/menu-categories/:id/restore`          | Role: OWNER                         | Restore a soft-deleted menu category → `200`   |
| `POST`   | `/restaurants/:restaurantId/products/:productId/availability`     | Role: OWNER, MANAGER                | Add availability schedule to a product         |
| `GET`    | `/restaurants/:restaurantId/products/:productId/availability`     | Role: OWNER, MANAGER, STAFF, VIEWER | List availability schedules for a product      |
| `GET`    | `/restaurants/:restaurantId/products/:productId/availability/:id` | Role: OWNER, MANAGER, STAFF, VIEWER | Get a product availability by ID               |
| `PUT`    | `/restaurants/:restaurantId/products/:productId/availability/:id` | Role: OWNER, MANAGER                | Update a product availability schedule         |
| `DELETE` | `/restaurants/:restaurantId/products/:productId/availability/:id` | Role: OWNER, MANAGER                | Delete a product availability schedule → `200` |
| `POST`   | `/restaurants/:restaurantId/products/:productId/images`           | Role: OWNER, MANAGER                | Add an image to a product                      |
| `POST`   | `/restaurants/:restaurantId/products/:productId/images/upload`    | Role: OWNER, MANAGER                | Upload an image file for a product             |
| `GET`    | `/restaurants/:restaurantId/products/:productId/images`           | Role: OWNER, MANAGER, STAFF, VIEWER | List all images for a product                  |
| `GET`    | `/restaurants/:restaurantId/products/:productId/images/:id`       | Role: OWNER, MANAGER, STAFF, VIEWER | Get a product image by ID                      |
| `PUT`    | `/restaurants/:restaurantId/products/:productId/images/:id`       | Role: OWNER, MANAGER                | Update a product image                         |
| `DELETE` | `/restaurants/:restaurantId/products/:productId/images/:id`       | Role: OWNER, MANAGER                | Delete a product image → `200`                 |
| `POST`   | `/restaurants/:restaurantId/products`                             | Role: OWNER, MANAGER                | Create a new product for a restaurant          |
| `GET`    | `/restaurants/:restaurantId/products`                             | Role: OWNER, MANAGER, STAFF, VIEWER | List all products for a restaurant             |
| `GET`    | `/restaurants/:restaurantId/products/:id`                         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a product by ID                            |
| `PUT`    | `/restaurants/:restaurantId/products/:id`                         | Role: OWNER, MANAGER                | Update a product                               |
| `DELETE` | `/restaurants/:restaurantId/products/:id`                         | Role: OWNER                         | Soft delete a product → `200`                  |
| `POST`   | `/restaurants/:restaurantId/products/:id/restore`                 | Role: OWNER                         | Restore a soft-deleted product → `200`         |

### Product Variants

| Method   | Path (`/api/v1` + …)                                                  | Access                              | Notes                                          |
| -------- | --------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/products/:productId/variants`             | Role: OWNER, MANAGER                | Create a new variant for a product             |
| `GET`    | `/restaurants/:restaurantId/products/:productId/variants`             | Role: OWNER, MANAGER, STAFF, VIEWER | List all variants for a product                |
| `GET`    | `/restaurants/:restaurantId/products/:productId/variants/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a product variant by ID                    |
| `PUT`    | `/restaurants/:restaurantId/products/:productId/variants/:id`         | Role: OWNER, MANAGER                | Update a product variant                       |
| `DELETE` | `/restaurants/:restaurantId/products/:productId/variants/:id`         | Role: OWNER                         | Soft delete a product variant → `200`          |
| `POST`   | `/restaurants/:restaurantId/products/:productId/variants/:id/restore` | Role: OWNER                         | Restore a soft-deleted product variant → `200` |

### Variant Groups

| Method   | Path (`/api/v1` + …)                                    | Access                              | Notes                                        |
| -------- | ------------------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/variant-groups`             | Role: OWNER, MANAGER                | Create a new variant group for a restaurant  |
| `GET`    | `/restaurants/:restaurantId/variant-groups`             | Role: OWNER, MANAGER, STAFF, VIEWER | List all variant groups for a restaurant     |
| `GET`    | `/restaurants/:restaurantId/variant-groups/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a variant group by ID                    |
| `PUT`    | `/restaurants/:restaurantId/variant-groups/:id`         | Role: OWNER, MANAGER                | Update a variant group                       |
| `DELETE` | `/restaurants/:restaurantId/variant-groups/:id`         | Role: OWNER                         | Soft delete a variant group → `200`          |
| `POST`   | `/restaurants/:restaurantId/variant-groups/:id/restore` | Role: OWNER                         | Restore a soft-deleted variant group → `200` |

### Product Ingredients

| Method   | Path (`/api/v1` + …)                                                     | Access                              | Notes                                       |
| -------- | ------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/product-ingredients`                         | Role: OWNER, MANAGER                | Link an ingredient to a product             |
| `GET`    | `/restaurants/:restaurantId/product-ingredients/product/:productId`      | Role: OWNER, MANAGER, STAFF, VIEWER | List ingredients for a product              |
| `GET`    | `/restaurants/:restaurantId/product-ingredients/product/:productId/cost` | Role: OWNER, MANAGER, VIEWER        | Calculate total cost per unit for a product |
| `GET`    | `/restaurants/:restaurantId/product-ingredients/:id`                     | Role: OWNER, MANAGER, STAFF, VIEWER | Get a product-ingredient link by ID         |
| `PUT`    | `/restaurants/:restaurantId/product-ingredients/:id`                     | Role: OWNER, MANAGER                | Update a product-ingredient link            |
| `DELETE` | `/restaurants/:restaurantId/product-ingredients/:id`                     | Role: OWNER, MANAGER                | Remove an ingredient from a product → `200` |

### Modifier Groups

| Method   | Path (`/api/v1` + …)                                     | Access                              | Notes                                         |
| -------- | -------------------------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/modifier-groups`             | Role: OWNER, MANAGER                | Create a new modifier group for a restaurant  |
| `GET`    | `/restaurants/:restaurantId/modifier-groups`             | Role: OWNER, MANAGER, STAFF, VIEWER | List all modifier groups for a restaurant     |
| `GET`    | `/restaurants/:restaurantId/modifier-groups/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a modifier group by ID                    |
| `PUT`    | `/restaurants/:restaurantId/modifier-groups/:id`         | Role: OWNER, MANAGER                | Update a modifier group                       |
| `DELETE` | `/restaurants/:restaurantId/modifier-groups/:id`         | Role: OWNER                         | Soft delete a modifier group → `200`          |
| `POST`   | `/restaurants/:restaurantId/modifier-groups/:id/restore` | Role: OWNER                         | Restore a soft-deleted modifier group → `200` |

### Modifiers

| Method   | Path (`/api/v1` + …)                                                                | Access                              | Notes                                     |
| -------- | ----------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/modifier-groups/:modifierGroupId/modifiers`             | Role: OWNER, MANAGER                | Create a new modifier in a modifier group |
| `GET`    | `/restaurants/:restaurantId/modifier-groups/:modifierGroupId/modifiers`             | Role: OWNER, MANAGER, STAFF, VIEWER | List all modifiers in a modifier group    |
| `GET`    | `/restaurants/:restaurantId/modifier-groups/:modifierGroupId/modifiers/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a modifier by ID                      |
| `PUT`    | `/restaurants/:restaurantId/modifier-groups/:modifierGroupId/modifiers/:id`         | Role: OWNER, MANAGER                | Update a modifier                         |
| `DELETE` | `/restaurants/:restaurantId/modifier-groups/:modifierGroupId/modifiers/:id`         | Role: OWNER                         | Soft delete a modifier → `200`            |
| `POST`   | `/restaurants/:restaurantId/modifier-groups/:modifierGroupId/modifiers/:id/restore` | Role: OWNER                         | Restore a soft-deleted modifier → `200`   |

### Allergens

| Method   | Path (`/api/v1` + …)                                                   | Access                              | Notes                                     |
| -------- | ---------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------- |
| `GET`    | `/restaurants/:restaurantId/products/:productId/allergens`             | Role: OWNER, MANAGER, STAFF, VIEWER | List all allergens assigned to a product  |
| `POST`   | `/restaurants/:restaurantId/products/:productId/allergens`             | Role: OWNER, MANAGER                | Assign allergens to a product → `201`     |
| `DELETE` | `/restaurants/:restaurantId/products/:productId/allergens/:allergenId` | Role: OWNER, MANAGER                | Remove an allergen from a product → `200` |
| `POST`   | `/restaurants/:restaurantId/allergens`                                 | Role: OWNER, MANAGER                | Create a new allergen                     |
| `GET`    | `/restaurants/:restaurantId/allergens`                                 | Role: OWNER, MANAGER, STAFF, VIEWER | List all allergens for a restaurant       |
| `GET`    | `/restaurants/:restaurantId/allergens/:id`                             | Role: OWNER, MANAGER, STAFF, VIEWER | Get an allergen by ID                     |
| `PUT`    | `/restaurants/:restaurantId/allergens/:id`                             | Role: OWNER, MANAGER                | Update an allergen                        |
| `DELETE` | `/restaurants/:restaurantId/allergens/:id`                             | Role: OWNER                         | Soft delete an allergen → `200`           |
| `POST`   | `/restaurants/:restaurantId/allergens/:id/restore`                     | Role: OWNER                         | Restore a soft-deleted allergen → `200`   |

### Nutrition

| Method   | Path (`/api/v1` + …)                                       | Access                              | Notes                                                    |
| -------- | ---------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/products/:productId/nutrition` | Role: OWNER, MANAGER                | Create or update nutritional info for a product (upsert) |
| `GET`    | `/restaurants/:restaurantId/products/:productId/nutrition` | Role: OWNER, MANAGER, STAFF, VIEWER | Get nutritional info for a product                       |
| `PUT`    | `/restaurants/:restaurantId/products/:productId/nutrition` | Role: OWNER, MANAGER                | Update nutritional info for a product                    |
| `DELETE` | `/restaurants/:restaurantId/products/:productId/nutrition` | Role: OWNER                         | Soft delete nutritional info for a product → `200`       |

### Tags

| Method   | Path (`/api/v1` + …)                                         | Access                              | Notes                                      |
| -------- | ------------------------------------------------------------ | ----------------------------------- | ------------------------------------------ |
| `GET`    | `/restaurants/:restaurantId/products/:productId/tags`        | Role: OWNER, MANAGER, STAFF, VIEWER | List all tags assigned to a product        |
| `POST`   | `/restaurants/:restaurantId/products/:productId/tags`        | Role: OWNER, MANAGER                | Assign tags to a product → `201`           |
| `DELETE` | `/restaurants/:restaurantId/products/:productId/tags/:tagId` | Role: OWNER, MANAGER                | Remove a tag from a product → `200`        |
| `POST`   | `/restaurants/:restaurantId/tags`                            | Role: OWNER, MANAGER                | Create a new product tag                   |
| `GET`    | `/restaurants/:restaurantId/tags`                            | Role: OWNER, MANAGER, STAFF, VIEWER | List all product tags for a restaurant     |
| `GET`    | `/restaurants/:restaurantId/tags/:id`                        | Role: OWNER, MANAGER, STAFF, VIEWER | Get a product tag by ID                    |
| `PUT`    | `/restaurants/:restaurantId/tags/:id`                        | Role: OWNER, MANAGER                | Update a product tag                       |
| `DELETE` | `/restaurants/:restaurantId/tags/:id`                        | Role: OWNER                         | Soft delete a product tag → `200`          |
| `POST`   | `/restaurants/:restaurantId/tags/:id/restore`                | Role: OWNER                         | Restore a soft-deleted product tag → `200` |

### Ingredients

| Method   | Path (`/api/v1` + …)       | Access                              | Notes                                     |
| -------- | -------------------------- | ----------------------------------- | ----------------------------------------- |
| `POST`   | `/ingredients`             | Role: OWNER, MANAGER                | Create an ingredient                      |
| `GET`    | `/ingredients`             | Role: OWNER, MANAGER, STAFF, VIEWER | List ingredients                          |
| `GET`    | `/ingredients/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get an ingredient by ID                   |
| `PUT`    | `/ingredients/:id`         | Role: OWNER, MANAGER                | Update an ingredient                      |
| `DELETE` | `/ingredients/:id`         | Role: OWNER                         | Soft delete an ingredient → `200`         |
| `POST`   | `/ingredients/:id/restore` | Role: OWNER                         | Restore a soft-deleted ingredient → `200` |

---

## 5. Orders, Payments & Kitchen

### Orders

| Method   | Path (`/api/v1` + …)                                                     | Access                                                        | Notes                                           |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/orders`                                      | Role: OWNER, MANAGER, CASHIER, WAITER                         | Create a new order                              |
| `GET`    | `/restaurants/:restaurantId/orders`                                      | Role: OWNER, MANAGER, CASHIER, WAITER, KITCHEN, STAFF, VIEWER | List all orders for a restaurant                |
| `GET`    | `/restaurants/:restaurantId/orders/:id`                                  | Role: OWNER, MANAGER, CASHIER, WAITER, KITCHEN, STAFF, VIEWER | Get an order by ID                              |
| `PUT`    | `/restaurants/:restaurantId/orders/:id`                                  | Role: OWNER, MANAGER, CASHIER, WAITER                         | Update order items or details                   |
| `POST`   | `/restaurants/:restaurantId/orders/:id/status`                           | Role: OWNER, MANAGER, CASHIER, KITCHEN                        | Change order status (state machine) → `200`     |
| `POST`   | `/restaurants/:restaurantId/orders/:id/discount`                         | Role: OWNER, MANAGER                                          | Apply discount to order → `200`                 |
| `DELETE` | `/restaurants/:restaurantId/orders/:id/discount`                         | Role: OWNER, MANAGER                                          | Remove discount from order → `200`              |
| `POST`   | `/restaurants/:restaurantId/orders/:id/payments`                         | Role: OWNER, MANAGER, CASHIER                                 | Add payment to order → `201`                    |
| `POST`   | `/restaurants/:restaurantId/orders/:id/payments/:paymentId/refund`       | Role: OWNER, MANAGER                                          | Refund a payment → `200`                        |
| `POST`   | `/restaurants/:restaurantId/orders/:id/notes`                            | Role: OWNER, MANAGER, CASHIER, WAITER, KITCHEN                | Add a note to an order → `201`                  |
| `POST`   | `/restaurants/:restaurantId/orders/:id/split`                            | Role: OWNER, MANAGER, CASHIER                                 | Split order into two orders → `200`             |
| `POST`   | `/restaurants/:restaurantId/orders/:id/merge`                            | Role: OWNER, MANAGER, CASHIER                                 | Merge another order into this order → `200`     |
| `POST`   | `/restaurants/:restaurantId/orders/:id/move-table`                       | Role: OWNER, MANAGER, CASHIER, WAITER                         | Move order to a different table → `200`         |
| `POST`   | `/restaurants/:restaurantId/orders/:id/duplicate`                        | Role: OWNER, MANAGER, CASHIER, WAITER                         | Duplicate an order → `201`                      |
| `POST`   | `/restaurants/:restaurantId/orders/:id/service-charge`                   | Role: OWNER, MANAGER                                          | Apply service charge to order → `200`           |
| `POST`   | `/restaurants/:restaurantId/orders/:id/tax-rate`                         | Role: OWNER, MANAGER                                          | Apply tax rate to order → `200`                 |
| `POST`   | `/restaurants/:restaurantId/orders/:id/items/:itemId/void`               | Role: OWNER, MANAGER, CASHIER, WAITER                         | Void an order item → `200`                      |
| `POST`   | `/restaurants/:restaurantId/orders/:id/items/:itemId/kitchen-status`     | Role: KITCHEN, OWNER, MANAGER                                 | Update kitchen status for an order item → `200` |
| `GET`    | `/restaurants/:restaurantId/orders/:id/kitchen-tickets`                  | Role: KITCHEN, OWNER, MANAGER, STAFF                          | List kitchen tickets for an order               |
| `POST`   | `/restaurants/:restaurantId/orders/:id/kitchen-tickets/:ticketId/status` | Role: KITCHEN, OWNER, MANAGER                                 | Update kitchen ticket status → `200`            |
| `DELETE` | `/restaurants/:restaurantId/orders/:id`                                  | Role: OWNER · Perm: orders:delete                             | Soft delete an order → `200`                    |
| `POST`   | `/restaurants/:restaurantId/orders/:id/restore`                          | Role: OWNER · Perm: orders:delete                             | Restore a soft-deleted order → `200`            |

### Kitchen Display (KDS)

| Method   | Path (`/api/v1` + …)                                       | Access                                        | Notes                                               |
| -------- | ---------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| `POST`   | `/restaurants/:restaurantId/kds/stations`                  | Role: OWNER, MANAGER                          | Create a kitchen station                            |
| `GET`    | `/restaurants/:restaurantId/kds/stations`                  | Role: OWNER, MANAGER, STAFF, KITCHEN, CASHIER | List all kitchen stations                           |
| `GET`    | `/restaurants/:restaurantId/kds/stations/:id`              | Role: OWNER, MANAGER, STAFF, KITCHEN, CASHIER | Get kitchen station by ID                           |
| `PUT`    | `/restaurants/:restaurantId/kds/stations/:id`              | Role: OWNER, MANAGER                          | Update a kitchen station                            |
| `DELETE` | `/restaurants/:restaurantId/kds/stations/:id`              | Role: OWNER, MANAGER                          | Soft-delete a kitchen station                       |
| `POST`   | `/restaurants/:restaurantId/kds/assign-product`            | Role: OWNER, MANAGER                          | Assign a product to a kitchen station → `200`       |
| `DELETE` | `/restaurants/:restaurantId/kds/assign-product/:productId` | Role: OWNER, MANAGER                          | Unassign a product from its kitchen station → `200` |
| `GET`    | `/restaurants/:restaurantId/kds/ticket-items`              | Role: OWNER, MANAGER, STAFF, KITCHEN, CASHIER | List kitchen ticket items with optional filters     |
| `PUT`    | `/restaurants/:restaurantId/kds/ticket-items/:id/status`   | Role: OWNER, MANAGER, STAFF, KITCHEN          | Update a ticket item status                         |
| `GET`    | `/restaurants/:restaurantId/kds/dashboard`                 | Role: OWNER, MANAGER, STAFF, KITCHEN, CASHIER | Get KDS dashboard with all station queues           |
| `GET`    | `/restaurants/:restaurantId/kds/station-queue/:stationId`  | Role: OWNER, MANAGER, STAFF, KITCHEN, CASHIER | Get queue for a specific kitchen station            |

### Payments

| Method | Path (`/api/v1` + …)                                             | Access                        | Notes                                      |
| ------ | ---------------------------------------------------------------- | ----------------------------- | ------------------------------------------ |
| `POST` | `/webhooks/stripe`                                               | Public                        | _(cross-tenant)_ → `200`                   |
| `POST` | `/webhooks/paymob`                                               | Public                        | _(cross-tenant)_ → `200`                   |
| `POST` | `/restaurants/:restaurantId/payments`                            | Role: OWNER, MANAGER, CASHIER | Process a payment against an order → `201` |
| `GET`  | `/restaurants/:restaurantId/payments`                            | Role: OWNER, MANAGER, CASHIER | List payments with filters                 |
| `GET`  | `/restaurants/:restaurantId/payments/reconcile`                  | Role: OWNER, MANAGER          | Reconciliation report                      |
| `GET`  | `/restaurants/:restaurantId/payments/providers/:tenantId/status` | Role: OWNER                   | Payment provider health check              |
| `GET`  | `/restaurants/:restaurantId/payments/:id`                        | Role: OWNER, MANAGER, CASHIER | Get payment details                        |
| `POST` | `/restaurants/:restaurantId/payments/:paymentId/refund`          | Role: OWNER, MANAGER          | Full refund of a payment → `200`           |
| `POST` | `/restaurants/:restaurantId/payments/:paymentId/partial-refund`  | Role: OWNER, MANAGER          | Partial refund of a payment → `200`        |
| `POST` | `/restaurants/:restaurantId/payments/:paymentId/void`            | Role: OWNER, MANAGER          | Void a pending payment → `200`             |
| `POST` | `/restaurants/:restaurantId/payments/split`                      | Role: OWNER, MANAGER, CASHIER | Split payment across methods → `201`       |

---

## 6. Recipes

### Recipes

| Method   | Path (`/api/v1` + …)               | Access                        | Notes                                          |
| -------- | ---------------------------------- | ----------------------------- | ---------------------------------------------- |
| `POST`   | `/recipes`                         | Role: OWNER, MANAGER, KITCHEN | Create recipe                                  |
| `GET`    | `/recipes`                         | Perm: inventory:read          | List recipes                                   |
| `GET`    | `/recipes/:id`                     | Perm: inventory:read          | Get recipe by ID                               |
| `PUT`    | `/recipes/:id`                     | Role: OWNER, MANAGER, KITCHEN | Update recipe                                  |
| `DELETE` | `/recipes/:id`                     | Role: OWNER, MANAGER          | Soft delete recipe → `204`                     |
| `GET`    | `/recipes/:id/cost`                | Perm: inventory:read          | Get recipe cost breakdown                      |
| `POST`   | `/recipes/:recipeId/items`         | Role: OWNER, MANAGER, KITCHEN | Add item to recipe                             |
| `PUT`    | `/recipes/items/:id`               | Role: OWNER, MANAGER, KITCHEN | Update recipe item                             |
| `DELETE` | `/recipes/items/:id`               | Role: OWNER, MANAGER, KITCHEN | Remove recipe item → `204`                     |
| `POST`   | `/recipes/deduct-order/:orderId`   | Role: OWNER, MANAGER          | Manually trigger inventory deduction for order |
| `POST`   | `/recipes/rollback-order/:orderId` | Role: OWNER, MANAGER          | Rollback inventory deduction for order         |
| `GET`    | `/recipes/deduction/:orderId`      | Perm: inventory:read          | Get deduction report for order                 |

---

## 7. Inventory & Supply Chain

### Inventory

| Method   | Path (`/api/v1` + …)                 | Access                                      | Notes   |
| -------- | ------------------------------------ | ------------------------------------------- | ------- |
| `POST`   | `/inventory/items`                   | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/inventory/items`                   | Perm: inventory:read                        |         |
| `GET`    | `/inventory/items/:id`               | Perm: inventory:read                        |         |
| `PUT`    | `/inventory/items/:id`               | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `DELETE` | `/inventory/items/:id`               | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |
| `POST`   | `/inventory/items/:id/restore`       | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `POST`   | `/inventory/categories`              | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/inventory/categories`              | Perm: inventory:read                        |         |
| `PUT`    | `/inventory/categories/:id`          | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `DELETE` | `/inventory/categories/:id`          | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |
| `POST`   | `/inventory/units`                   | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/inventory/units`                   | Perm: inventory:read                        |         |
| `PUT`    | `/inventory/units/:id`               | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `DELETE` | `/inventory/units/:id`               | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |
| `POST`   | `/inventory/locations`               | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/inventory/locations`               | Perm: inventory:read                        |         |
| `PUT`    | `/inventory/locations/:id`           | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `DELETE` | `/inventory/locations/:id`           | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |
| `POST`   | `/inventory/adjustments`             | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/inventory/adjustments`             | Perm: inventory:read                        |         |
| `POST`   | `/inventory/adjustments/:id/approve` | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `POST`   | `/inventory/waste`                   | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/inventory/waste`                   | Perm: inventory:read                        |         |
| `POST`   | `/inventory/counts`                  | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/inventory/counts`                  | Perm: inventory:read                        |         |
| `POST`   | `/inventory/batches`                 | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/inventory/items/:itemId/batches`   | Perm: inventory:read                        |         |
| `GET`    | `/inventory/expiring`                | Perm: inventory:read                        |         |
| `GET`    | `/inventory/low-stock`               | Perm: inventory:read                        |         |
| `GET`    | `/inventory/critical-stock`          | Perm: inventory:read                        |         |
| `GET`    | `/inventory/out-of-stock`            | Perm: inventory:read                        |         |

### Warehouses

| Method   | Path (`/api/v1` + …)                 | Access                                      | Notes   |
| -------- | ------------------------------------ | ------------------------------------------- | ------- |
| `POST`   | `/warehouses`                        | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/warehouses`                        | Perm: inventory:read                        |         |
| `GET`    | `/warehouses/:id`                    | Perm: inventory:read                        |         |
| `PUT`    | `/warehouses/:id`                    | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `DELETE` | `/warehouses/:id`                    | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |
| `POST`   | `/warehouses/:id/restore`            | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `POST`   | `/warehouses/:id/set-default`        | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/warehouses/:id/stats`              | Perm: inventory:read                        |         |
| `POST`   | `/warehouses/:id/zones`              | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/warehouses/:id/zones`              | Perm: inventory:read                        |         |
| `PUT`    | `/warehouses/zones/:id`              | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `DELETE` | `/warehouses/zones/:id`              | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |
| `POST`   | `/warehouses/:id/bins`               | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/warehouses/:id/bins`               | Perm: inventory:read                        |         |
| `PUT`    | `/warehouses/bins/:id`               | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `DELETE` | `/warehouses/bins/:id`               | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |
| `POST`   | `/warehouses/:id/branches`           | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/warehouses/:id/branches`           | Perm: inventory:read                        |         |
| `DELETE` | `/warehouses/:id/branches/:branchId` | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |

### Purchasing

| Method   | Path (`/api/v1` + …)           | Access                        | Notes                                  |
| -------- | ------------------------------ | ----------------------------- | -------------------------------------- |
| `POST`   | `/purchase-orders`             | Role: OWNER, MANAGER          | Create purchase order                  |
| `GET`    | `/purchase-orders`             | Perm: inventory:read          | List purchase orders                   |
| `GET`    | `/purchase-orders/stats`       | Perm: inventory:read          | Get purchase order statistics          |
| `GET`    | `/purchase-orders/:id`         | Perm: inventory:read          | Get purchase order by ID               |
| `PUT`    | `/purchase-orders/:id`         | Role: OWNER, MANAGER          | Update purchase order                  |
| `DELETE` | `/purchase-orders/:id`         | Role: OWNER, MANAGER          | Soft delete purchase order → `204`     |
| `POST`   | `/purchase-orders/:id/submit`  | Role: OWNER, MANAGER          | Submit purchase order for approval     |
| `POST`   | `/purchase-orders/:id/approve` | Role: OWNER, MANAGER          | Approve or reject purchase order       |
| `POST`   | `/purchase-orders/:id/order`   | Role: OWNER, MANAGER          | Place order with supplier              |
| `POST`   | `/purchase-orders/:id/receive` | Role: OWNER, MANAGER          | Mark purchase order as received        |
| `POST`   | `/purchase-orders/:id/close`   | Role: OWNER, MANAGER          | Close purchase order                   |
| `POST`   | `/purchase-orders/:id/cancel`  | Role: OWNER, MANAGER          | Cancel purchase order                  |
| `POST`   | `/goods-receipts`              | Role: OWNER, MANAGER, CASHIER | Create goods receipt                   |
| `GET`    | `/goods-receipts`              | Perm: inventory:read          | List goods receipts                    |
| `GET`    | `/goods-receipts/:id`          | Perm: inventory:read          | Get goods receipt by ID                |
| `PUT`    | `/goods-receipts/:id`          | Role: OWNER, MANAGER          | Update goods receipt                   |
| `POST`   | `/goods-receipts/:id/cancel`   | Role: OWNER, MANAGER          | Cancel goods receipt and reverse stock |

### Suppliers

| Method   | Path (`/api/v1` + …)     | Access                              | Notes                                   |
| -------- | ------------------------ | ----------------------------------- | --------------------------------------- |
| `POST`   | `/suppliers`             | Role: OWNER, MANAGER                | Create a supplier                       |
| `GET`    | `/suppliers`             | Role: OWNER, MANAGER, STAFF, VIEWER | List suppliers                          |
| `GET`    | `/suppliers/:id`         | Role: OWNER, MANAGER, STAFF, VIEWER | Get a supplier by ID                    |
| `PUT`    | `/suppliers/:id`         | Role: OWNER, MANAGER                | Update a supplier                       |
| `DELETE` | `/suppliers/:id`         | Role: OWNER                         | Soft delete a supplier → `200`          |
| `POST`   | `/suppliers/:id/restore` | Role: OWNER                         | Restore a soft-deleted supplier → `200` |

### Supplier Performance

| Method | Path (`/api/v1` + …)                         | Access                                      | Notes |
| ------ | -------------------------------------------- | ------------------------------------------- | ----- |
| `POST` | `/supplier-performance`                      | Role: OWNER, MANAGER · Perm: inventory:read |       |
| `GET`  | `/supplier-performance`                      | Perm: inventory:read                        |       |
| `GET`  | `/supplier-performance/ranking`              | Perm: inventory:read                        |       |
| `GET`  | `/supplier-performance/:id`                  | Perm: inventory:read                        |       |
| `GET`  | `/supplier-performance/supplier/:supplierId` | Perm: inventory:read                        |       |

### Barcodes

| Method   | Path (`/api/v1` + …)          | Access                                      | Notes   |
| -------- | ----------------------------- | ------------------------------------------- | ------- |
| `POST`   | `/barcodes`                   | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/barcodes/lookup/:code`      | Perm: inventory:read                        |         |
| `GET`    | `/barcodes/lookup/qr/:qrCode` | Perm: inventory:read                        |         |
| `GET`    | `/barcodes/item/:itemId`      | Perm: inventory:read                        |         |
| `DELETE` | `/barcodes/:id`               | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |
| `POST`   | `/barcodes/:id/primary`       | Role: OWNER, MANAGER · Perm: inventory:read |         |

### Costing

| Method | Path (`/api/v1` + …)              | Access                                      | Notes |
| ------ | --------------------------------- | ------------------------------------------- | ----- |
| `POST` | `/costing/valuation`              | Role: OWNER, MANAGER · Perm: inventory:read |       |
| `GET`  | `/costing/valuation/:id`          | Perm: inventory:read                        |       |
| `GET`  | `/costing/valuation/item/:itemId` | Perm: inventory:read                        |       |
| `POST` | `/costing/valuation/batch`        | Role: OWNER, MANAGER · Perm: inventory:read |       |

### Transfers

| Method   | Path (`/api/v1` + …)            | Access                                      | Notes                                          |
| -------- | ------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| `POST`   | `/transfers`                    | Role: OWNER, MANAGER · Perm: inventory:read | Create a branch transfer                       |
| `GET`    | `/transfers`                    | Perm: inventory:read                        | List branch transfers                          |
| `GET`    | `/transfers/:id`                | Perm: inventory:read                        | Get transfer by ID                             |
| `PUT`    | `/transfers/:id`                | Role: OWNER, MANAGER · Perm: inventory:read | Update draft transfer                          |
| `DELETE` | `/transfers/:id`                | Role: OWNER, MANAGER · Perm: inventory:read | Soft delete draft transfer → `204`             |
| `POST`   | `/transfers/:id/submit`         | Role: OWNER, MANAGER · Perm: inventory:read | Submit draft transfer for approval             |
| `POST`   | `/transfers/:id/approve`        | Role: OWNER, MANAGER · Perm: inventory:read | Approve pending transfer                       |
| `POST`   | `/transfers/:id/start`          | Role: OWNER, MANAGER · Perm: inventory:read | Dispatch approved transfer (deducts inventory) |
| `POST`   | `/transfers/:id/receive`        | Role: OWNER, MANAGER · Perm: inventory:read | Receive transfer items (adds to inventory)     |
| `POST`   | `/transfers/:id/cancel`         | Role: OWNER, MANAGER · Perm: inventory:read | Cancel a transfer                              |
| `GET`    | `/stock-movements`              | Perm: inventory:read                        | List stock movements                           |
| `GET`    | `/stock-movements/:id`          | Perm: inventory:read                        | Get stock movement by ID                       |
| `GET`    | `/stock-movements/item/:itemId` | Perm: inventory:read                        | Get stock movement history for an item         |

### Cycle Counts

| Method   | Path (`/api/v1` + …)                   | Access                                      | Notes   |
| -------- | -------------------------------------- | ------------------------------------------- | ------- |
| `POST`   | `/cycle-counts`                        | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/cycle-counts`                        | Perm: inventory:read                        |         |
| `GET`    | `/cycle-counts/:id`                    | Perm: inventory:read                        |         |
| `PUT`    | `/cycle-counts/:id`                    | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `DELETE` | `/cycle-counts/:id`                    | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |
| `POST`   | `/cycle-counts/:id/start`              | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `POST`   | `/cycle-counts/:id/complete`           | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `POST`   | `/cycle-counts/:id/reconcile`          | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `POST`   | `/cycle-counts/:id/item/:itemId/count` | Role: OWNER, MANAGER · Perm: inventory:read |         |
| `GET`    | `/cycle-counts/:id/items`              | Perm: inventory:read                        |         |
| `POST`   | `/cycle-counts/:id/cancel`             | Role: OWNER, MANAGER · Perm: inventory:read | → `204` |

---

## 8. CRM & Marketing

### Customers

| Method   | Path (`/api/v1` + …)                                | Access                                                      | Notes                                |
| -------- | --------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| `POST`   | `/customers`                                        | Role: OWNER, MANAGER, STAFF, CASHIER · Perm: customers:read | Create customer                      |
| `GET`    | `/customers`                                        | Perm: customers:read                                        | List customers                       |
| `GET`    | `/customers/tiers`                                  | Perm: customers:read                                        | Get available loyalty tiers          |
| `GET`    | `/customers/segments`                               | Perm: customers:read                                        | List all segments                    |
| `GET`    | `/customers/:id`                                    | Perm: customers:read                                        | Get customer by ID                   |
| `PATCH`  | `/customers/:id`                                    | Role: OWNER, MANAGER, STAFF · Perm: customers:read          | Update customer                      |
| `DELETE` | `/customers/:id`                                    | Role: OWNER, MANAGER · Perm: customers:read                 | Soft delete customer → `204`         |
| `POST`   | `/customers/:id/restore`                            | Role: OWNER, MANAGER · Perm: customers:read                 | Restore soft-deleted customer        |
| `POST`   | `/customers/:id/addresses`                          | Role: OWNER, MANAGER, STAFF · Perm: customers:read          | Create customer address              |
| `PUT`    | `/customers/addresses/:addressId`                   | Role: OWNER, MANAGER, STAFF · Perm: customers:read          | Update customer address              |
| `DELETE` | `/customers/addresses/:addressId`                   | Role: OWNER, MANAGER, STAFF · Perm: customers:read          | Delete customer address → `204`      |
| `POST`   | `/customers/:id/preferences`                        | Role: OWNER, MANAGER, STAFF · Perm: customers:read          | Set customer preference              |
| `DELETE` | `/customers/:id/preferences/:key`                   | Role: OWNER, MANAGER, STAFF · Perm: customers:read          | Delete customer preference → `204`   |
| `POST`   | `/customers/:id/loyalty/earn`                       | Role: OWNER, MANAGER, CASHIER · Perm: customers:read        | Earn loyalty points                  |
| `POST`   | `/customers/:id/loyalty/redeem`                     | Role: OWNER, MANAGER, CASHIER · Perm: customers:read        | Redeem loyalty points                |
| `POST`   | `/customers/:id/loyalty/adjust`                     | Role: OWNER, MANAGER · Perm: customers:read                 | Adjust loyalty points (admin)        |
| `GET`    | `/customers/:id/loyalty/balance`                    | Perm: customers:read                                        | Get points balance                   |
| `GET`    | `/customers/:id/loyalty/history`                    | Perm: customers:read                                        | Get point transaction history        |
| `GET`    | `/customers/:id/membership`                         | Perm: customers:read                                        | Get customer membership              |
| `PUT`    | `/customers/:id/membership/upgrade`                 | Role: OWNER, MANAGER · Perm: customers:read                 | Upgrade/downgrade membership tier    |
| `GET`    | `/customers/:id/membership/history`                 | Perm: customers:read                                        | Get membership change history        |
| `POST`   | `/customers/:id/rewards`                            | Role: OWNER, MANAGER · Perm: customers:read                 | Create reward for customer           |
| `POST`   | `/customers/rewards/:rewardId/redeem`               | Role: OWNER, MANAGER, CASHIER · Perm: customers:read        | Redeem a reward                      |
| `POST`   | `/customers/rewards/:rewardId/cancel`               | Role: OWNER, MANAGER · Perm: customers:read                 | Cancel a reward                      |
| `GET`    | `/customers/:id/rewards`                            | Perm: customers:read                                        | Get customer rewards                 |
| `GET`    | `/customers/:id/wallet`                             | Perm: customers:read                                        | Get customer wallet                  |
| `POST`   | `/customers/:id/wallet/recharge`                    | Role: OWNER, MANAGER, CASHIER · Perm: customers:read        | Recharge wallet                      |
| `POST`   | `/customers/:id/wallet/spend`                       | Role: OWNER, MANAGER, CASHIER · Perm: customers:read        | Spend from wallet                    |
| `POST`   | `/customers/:id/wallet/refund`                      | Role: OWNER, MANAGER · Perm: customers:read                 | Refund to wallet                     |
| `GET`    | `/customers/:id/wallet/transactions`                | Perm: customers:read                                        | Get wallet transactions              |
| `POST`   | `/customers/:id/referrals`                          | Role: OWNER, MANAGER, STAFF · Perm: customers:read          | Create referral                      |
| `POST`   | `/customers/referrals/:referralId/complete`         | Role: OWNER, MANAGER · Perm: customers:read                 | Complete referral and award points   |
| `GET`    | `/customers/:id/referrals/stats`                    | Perm: customers:read                                        | Get referral statistics              |
| `POST`   | `/customers/segments`                               | Role: OWNER, MANAGER · Perm: customers:read                 | Create customer segment              |
| `PUT`    | `/customers/segments/:segmentId`                    | Role: OWNER, MANAGER · Perm: customers:read                 | Update segment                       |
| `DELETE` | `/customers/segments/:segmentId`                    | Role: OWNER, MANAGER · Perm: customers:read                 | Delete segment → `204`               |
| `POST`   | `/customers/segments/:segmentId/assign/:customerId` | Role: OWNER, MANAGER · Perm: customers:read                 | Assign customer to segment           |
| `DELETE` | `/customers/segments/:segmentId/assign/:customerId` | Role: OWNER, MANAGER · Perm: customers:read                 | Remove customer from segment → `204` |
| `POST`   | `/customers/segments/:segmentId/bulk-assign`        | Role: OWNER, MANAGER · Perm: customers:read                 | Bulk assign customers to segment     |
| `GET`    | `/customers/:id/analytics`                          | Perm: customers:read                                        | Get customer analytics               |
| `POST`   | `/customers/:id/analytics/recompute`                | Role: OWNER, MANAGER · Perm: customers:read                 | Recompute customer analytics         |
| `GET`    | `/customers/:id/visits`                             | Perm: customers:read                                        | Get visit history                    |
| `GET`    | `/customers/marketing/email-list`                   | Role: OWNER, MANAGER · Perm: customers:read                 | Get email list for marketing         |
| `GET`    | `/customers/marketing/sms-list`                     | Role: OWNER, MANAGER · Perm: customers:read                 | Get SMS list for marketing           |
| `GET`    | `/customers/marketing/export`                       | Role: OWNER, MANAGER · Perm: customers:read                 | Export customers                     |

### CRM

| Method   | Path (`/api/v1` + …)                  | Access                                             | Notes |
| -------- | ------------------------------------- | -------------------------------------------------- | ----- |
| `POST`   | `/crm/customers/:customerId/timeline` | Role: OWNER, MANAGER, STAFF · Perm: customers:read |       |
| `GET`    | `/crm/customers/:customerId/timeline` | Perm: customers:read                               |       |
| `POST`   | `/crm/templates`                      | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `GET`    | `/crm/templates`                      | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `GET`    | `/crm/templates/:id`                  | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `PUT`    | `/crm/templates/:id`                  | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `DELETE` | `/crm/templates/:id`                  | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `POST`   | `/crm/communications`                 | Role: OWNER, MANAGER, STAFF · Perm: customers:read |       |
| `GET`    | `/crm/communications`                 | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `PUT`    | `/crm/communications/:id/status`      | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `POST`   | `/crm/event-rules`                    | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `GET`    | `/crm/event-rules`                    | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `GET`    | `/crm/event-rules/:id`                | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `PUT`    | `/crm/event-rules/:id`                | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `DELETE` | `/crm/event-rules/:id`                | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `GET`    | `/crm/event-logs`                     | Role: OWNER, MANAGER · Perm: customers:read        |       |
| `GET`    | `/crm/analytics`                      | Role: OWNER, MANAGER · Perm: customers:read        |       |

### Campaigns

| Method   | Path (`/api/v1` + …)       | Access                        | Notes |
| -------- | -------------------------- | ----------------------------- | ----- |
| `POST`   | `/campaigns`               | Role: OWNER, MANAGER          |       |
| `GET`    | `/campaigns`               | Role: OWNER, MANAGER          |       |
| `GET`    | `/campaigns/stats`         | Role: OWNER, MANAGER          |       |
| `GET`    | `/campaigns/:id`           | Role: OWNER, MANAGER          |       |
| `PUT`    | `/campaigns/:id`           | Role: OWNER, MANAGER          |       |
| `DELETE` | `/campaigns/:id`           | Role: OWNER, MANAGER          |       |
| `POST`   | `/campaigns/:id/execute`   | Role: OWNER, MANAGER          |       |
| `POST`   | `/campaigns/:id/pause`     | Role: OWNER, MANAGER          |       |
| `POST`   | `/campaigns/:id/clone`     | Role: OWNER, MANAGER          |       |
| `POST`   | `/campaigns/:id/approve`   | Role: OWNER, MANAGER          |       |
| `GET`    | `/campaigns/:id/analytics` | Role: OWNER, MANAGER          |       |
| `POST`   | `/promotions`              | Role: OWNER, MANAGER          |       |
| `GET`    | `/promotions`              | Role: OWNER, MANAGER, STAFF   |       |
| `GET`    | `/promotions/stats`        | Role: OWNER, MANAGER          |       |
| `GET`    | `/promotions/code/:code`   | Perm: customers:read          |       |
| `GET`    | `/promotions/:id`          | Role: OWNER, MANAGER, STAFF   |       |
| `PUT`    | `/promotions/:id`          | Role: OWNER, MANAGER          |       |
| `DELETE` | `/promotions/:id`          | Role: OWNER, MANAGER          |       |
| `POST`   | `/promotions/validate`     | Perm: customers:read          |       |
| `POST`   | `/promotions/use`          | Role: OWNER, MANAGER, CASHIER |       |

### Gift Cards

| Method | Path (`/api/v1` + …)           | Access                      | Notes                      |
| ------ | ------------------------------ | --------------------------- | -------------------------- |
| `POST` | `/gift-cards`                  | Role: OWNER, MANAGER        | Issue a new gift card      |
| `GET`  | `/gift-cards`                  | Role: OWNER, MANAGER        | List gift cards            |
| `GET`  | `/gift-cards/:id`              | Role: OWNER, MANAGER        | Get gift card by ID        |
| `GET`  | `/gift-cards/code/:code`       | Role: OWNER, MANAGER        | Get gift card by code      |
| `POST` | `/gift-cards/:id/recharge`     | Role: OWNER, MANAGER        | Recharge a gift card       |
| `POST` | `/gift-cards/:id/redeem`       | Role: OWNER, MANAGER, STAFF | Redeem from a gift card    |
| `GET`  | `/gift-cards/:id/transactions` | Role: OWNER, MANAGER        | Get gift card transactions |
| `POST` | `/gift-cards/:id/deactivate`   | Role: OWNER, MANAGER        | Deactivate a gift card     |

---

## 9. Analytics & Reporting

### Dashboard

| Method | Path (`/api/v1` + …)              | Access               | Notes |
| ------ | --------------------------------- | -------------------- | ----- |
| `GET`  | `/dashboard/inventory-summary`    | Perm: analytics:read |       |
| `GET`  | `/dashboard/warehouse-summary`    | Perm: analytics:read |       |
| `GET`  | `/dashboard/movement-summary`     | Perm: analytics:read |       |
| `GET`  | `/dashboard/turnover-rate`        | Perm: analytics:read |       |
| `GET`  | `/dashboard/supplier-performance` | Perm: analytics:read |       |
| `GET`  | `/dashboard/reorder-alert`        | Perm: analytics:read |       |
| `GET`  | `/dashboard/valuation-summary`    | Perm: analytics:read |       |

### Executive Dashboard

| Method | Path (`/api/v1` + …)                  | Access               | Notes |
| ------ | ------------------------------------- | -------------------- | ----- |
| `GET`  | `/executive-dashboard/kpi`            | Role: OWNER, MANAGER |       |
| `GET`  | `/executive-dashboard/top-products`   | Role: OWNER, MANAGER |       |
| `GET`  | `/executive-dashboard/top-categories` | Role: OWNER, MANAGER |       |
| `GET`  | `/executive-dashboard/top-branches`   | Role: OWNER, MANAGER |       |
| `GET`  | `/executive-dashboard/top-employees`  | Role: OWNER, MANAGER |       |
| `GET`  | `/executive-dashboard/top-customers`  | Role: OWNER, MANAGER |       |
| `GET`  | `/executive-dashboard/sales-trend`    | Role: OWNER, MANAGER |       |

### Live Analytics

| Method | Path (`/api/v1` + …)                | Access               | Notes |
| ------ | ----------------------------------- | -------------------- | ----- |
| `GET`  | `/live-analytics/kpi`               | Perm: analytics:read |       |
| `GET`  | `/live-analytics/sales`             | Perm: analytics:read |       |
| `GET`  | `/live-analytics/inventory-alerts`  | Perm: analytics:read |       |
| `GET`  | `/live-analytics/kitchen-alerts`    | Perm: analytics:read |       |
| `GET`  | `/live-analytics/customer-activity` | Perm: analytics:read |       |
| `GET`  | `/live-analytics/dashboard`         | Perm: analytics:read |       |

### Sales Analytics

| Method | Path (`/api/v1` + …)                    | Access               | Notes |
| ------ | --------------------------------------- | -------------------- | ----- |
| `GET`  | `/sales-analytics/overview`             | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/revenue-comparison`   | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/by-branch`            | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/by-product`           | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/by-category`          | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/employee-performance` | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/payment-methods`      | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/order-channels`       | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/discounts`            | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/service-charges`      | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/taxes`                | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/peak-hours`           | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/peak-days`            | Role: OWNER, MANAGER |       |
| `GET`  | `/sales-analytics/conversion`           | Role: OWNER, MANAGER |       |

### Financial Analytics

| Method | Path (`/api/v1` + …)                            | Access               | Notes |
| ------ | ----------------------------------------------- | -------------------- | ----- |
| `GET`  | `/financial-analytics/overview`                 | Role: OWNER, MANAGER |       |
| `GET`  | `/financial-analytics/revenue`                  | Role: OWNER, MANAGER |       |
| `GET`  | `/financial-analytics/cogs`                     | Role: OWNER, MANAGER |       |
| `GET`  | `/financial-analytics/profitability/branches`   | Role: OWNER, MANAGER |       |
| `GET`  | `/financial-analytics/profitability/categories` | Role: OWNER, MANAGER |       |
| `GET`  | `/financial-analytics/profitability/products`   | Role: OWNER, MANAGER |       |
| `GET`  | `/financial-analytics/taxes`                    | Role: OWNER, MANAGER |       |
| `GET`  | `/financial-analytics/discounts`                | Role: OWNER, MANAGER |       |
| `GET`  | `/financial-analytics/refunds`                  | Role: OWNER, MANAGER |       |
| `GET`  | `/financial-analytics/service-charges`          | Role: OWNER, MANAGER |       |

### Inventory Analytics

| Method | Path (`/api/v1` + …)                     | Access               | Notes |
| ------ | ---------------------------------------- | -------------------- | ----- |
| `GET`  | `/inventory-analytics/valuation`         | Role: OWNER, MANAGER |       |
| `GET`  | `/inventory-analytics/turnover`          | Role: OWNER, MANAGER |       |
| `GET`  | `/inventory-analytics/dead-stock`        | Role: OWNER, MANAGER |       |
| `GET`  | `/inventory-analytics/classification`    | Role: OWNER, MANAGER |       |
| `GET`  | `/inventory-analytics/waste`             | Role: OWNER, MANAGER |       |
| `GET`  | `/inventory-analytics/shrinkage`         | Role: OWNER, MANAGER |       |
| `GET`  | `/inventory-analytics/consumption`       | Role: OWNER, MANAGER |       |
| `GET`  | `/inventory-analytics/recipe-usage`      | Role: OWNER, MANAGER |       |
| `GET`  | `/inventory-analytics/forecast-accuracy` | Role: OWNER, MANAGER |       |
| `GET`  | `/inventory-analytics/stock-aging`       | Role: OWNER, MANAGER |       |

### Customer Analytics

| Method | Path (`/api/v1` + …)                  | Access               | Notes |
| ------ | ------------------------------------- | -------------------- | ----- |
| `GET`  | `/customer-analytics/overview`        | Role: OWNER, MANAGER |       |
| `GET`  | `/customer-analytics/retention`       | Role: OWNER, MANAGER |       |
| `GET`  | `/customer-analytics/churn`           | Role: OWNER, MANAGER |       |
| `GET`  | `/customer-analytics/lifetime-value`  | Role: OWNER, MANAGER |       |
| `GET`  | `/customer-analytics/average-spend`   | Role: OWNER, MANAGER |       |
| `GET`  | `/customer-analytics/visit-frequency` | Role: OWNER, MANAGER |       |
| `GET`  | `/customer-analytics/rfm`             | Role: OWNER, MANAGER |       |
| `GET`  | `/customer-analytics/rewards`         | Role: OWNER, MANAGER |       |
| `GET`  | `/customer-analytics/wallet`          | Role: OWNER, MANAGER |       |
| `GET`  | `/customer-analytics/referrals`       | Role: OWNER, MANAGER |       |
| `GET`  | `/customer-analytics/memberships`     | Role: OWNER, MANAGER |       |

### CRM Analytics

| Method | Path (`/api/v1` + …)           | Access               | Notes |
| ------ | ------------------------------ | -------------------- | ----- |
| `GET`  | `/crm-analytics/overview`      | Role: OWNER, MANAGER |       |
| `GET`  | `/crm-analytics/campaigns/:id` | Role: OWNER, MANAGER |       |
| `GET`  | `/crm-analytics/campaign-roi`  | Role: OWNER, MANAGER |       |
| `GET`  | `/crm-analytics/promotions`    | Role: OWNER, MANAGER |       |
| `GET`  | `/crm-analytics/coupons`       | Role: OWNER, MANAGER |       |
| `GET`  | `/crm-analytics/conversion`    | Role: OWNER, MANAGER |       |
| `GET`  | `/crm-analytics/engagement`    | Role: OWNER, MANAGER |       |
| `GET`  | `/crm-analytics/automation`    | Role: OWNER, MANAGER |       |

### Kitchen Analytics

| Method | Path (`/api/v1` + …)                     | Access               | Notes |
| ------ | ---------------------------------------- | -------------------- | ----- |
| `GET`  | `/kitchen-analytics/overview`            | Role: OWNER, MANAGER |       |
| `GET`  | `/kitchen-analytics/stations/:stationId` | Role: OWNER, MANAGER |       |
| `GET`  | `/kitchen-analytics/queue`               | Role: OWNER, MANAGER |       |
| `GET`  | `/kitchen-analytics/delays`              | Role: OWNER, MANAGER |       |
| `GET`  | `/kitchen-analytics/efficiency`          | Role: OWNER, MANAGER |       |
| `GET`  | `/kitchen-analytics/bottlenecks`         | Role: OWNER, MANAGER |       |

### Supplier Analytics

| Method | Path (`/api/v1` + …)                  | Access               | Notes |
| ------ | ------------------------------------- | -------------------- | ----- |
| `GET`  | `/supplier-analytics/overview`        | Role: OWNER, MANAGER |       |
| `GET`  | `/supplier-analytics/scorecards`      | Role: OWNER, MANAGER |       |
| `GET`  | `/supplier-analytics/delivery`        | Role: OWNER, MANAGER |       |
| `GET`  | `/supplier-analytics/lead-time`       | Role: OWNER, MANAGER |       |
| `GET`  | `/supplier-analytics/fill-rate`       | Role: OWNER, MANAGER |       |
| `GET`  | `/supplier-analytics/price-variance`  | Role: OWNER, MANAGER |       |
| `GET`  | `/supplier-analytics/quality`         | Role: OWNER, MANAGER |       |
| `GET`  | `/supplier-analytics/purchase-trends` | Role: OWNER, MANAGER |       |
| `GET`  | `/supplier-analytics/ranking`         | Role: OWNER, MANAGER |       |

### Forecasting

| Method | Path (`/api/v1` + …)                          | Access                                      | Notes |
| ------ | --------------------------------------------- | ------------------------------------------- | ----- |
| `POST` | `/forecasts`                                  | Role: OWNER, MANAGER · Perm: inventory:read |       |
| `GET`  | `/forecasts/item/:itemId`                     | Perm: inventory:read                        |       |
| `GET`  | `/forecasts/recommendations`                  | Perm: inventory:read                        |       |
| `POST` | `/forecasts/reorder-suggestions`              | Role: OWNER, MANAGER · Perm: inventory:read |       |
| `GET`  | `/forecasts/reorder-suggestions`              | Perm: inventory:read                        |       |
| `GET`  | `/forecasts/reorder-suggestions/:id`          | Perm: inventory:read                        |       |
| `PUT`  | `/forecasts/reorder-suggestions/:id/approve`  | Role: OWNER, MANAGER · Perm: inventory:read |       |
| `PUT`  | `/forecasts/reorder-suggestions/:id/complete` | Role: OWNER, MANAGER · Perm: inventory:read |       |

### Forecasting Dashboard

| Method | Path (`/api/v1` + …)                 | Access               | Notes |
| ------ | ------------------------------------ | -------------------- | ----- |
| `GET`  | `/forecasting-dashboard/sales`       | Role: OWNER, MANAGER |       |
| `GET`  | `/forecasting-dashboard/revenue`     | Role: OWNER, MANAGER |       |
| `GET`  | `/forecasting-dashboard/demand`      | Role: OWNER, MANAGER |       |
| `GET`  | `/forecasting-dashboard/inventory`   | Role: OWNER, MANAGER |       |
| `GET`  | `/forecasting-dashboard/customers`   | Role: OWNER, MANAGER |       |
| `GET`  | `/forecasting-dashboard/trends`      | Role: OWNER, MANAGER |       |
| `GET`  | `/forecasting-dashboard/seasonality` | Role: OWNER, MANAGER |       |
| `GET`  | `/forecasting-dashboard/growth`      | Role: OWNER, MANAGER |       |

### Scheduled Reports

| Method   | Path (`/api/v1` + …)             | Access                                    | Notes   |
| -------- | -------------------------------- | ----------------------------------------- | ------- |
| `POST`   | `/scheduled-reports`             | Role: OWNER, MANAGER · Perm: reports:read | → `201` |
| `GET`    | `/scheduled-reports`             | Perm: reports:read                        |         |
| `GET`    | `/scheduled-reports/:id`         | Perm: reports:read                        |         |
| `PATCH`  | `/scheduled-reports/:id`         | Role: OWNER, MANAGER · Perm: reports:read |         |
| `DELETE` | `/scheduled-reports/:id`         | Role: OWNER, MANAGER · Perm: reports:read | → `204` |
| `POST`   | `/scheduled-reports/:id/trigger` | Role: OWNER, MANAGER · Perm: reports:read | → `202` |

### Export Engine

| Method | Path (`/api/v1` + …)                  | Access                                    | Notes   |
| ------ | ------------------------------------- | ----------------------------------------- | ------- |
| `POST` | `/export-engine/generate`             | Role: OWNER, MANAGER · Perm: reports:read | → `201` |
| `GET`  | `/export-engine/exports`              | Perm: reports:read                        |         |
| `GET`  | `/export-engine/exports/:id`          | Perm: reports:read                        |         |
| `GET`  | `/export-engine/exports/:id/download` | Perm: reports:read                        |         |
| `POST` | `/export-engine/dashboard-snapshot`   | Role: OWNER, MANAGER · Perm: reports:read | → `200` |
