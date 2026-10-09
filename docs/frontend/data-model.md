# Data Model & Enums

Entities and status enums the UI renders. Field lists are the fields the API
actually returns/selections expose (DTOs and Prisma models). Money flows as
JSON numbers unless explicitly noted.

## Core entities

### Tenant & Identity

| Entity                | Key fields                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tenant**            | `id, name, slug, description, phone, email, address, city, country, timezone, currency, locale, logoUrl, status (TenantStatus), metadata, createdAt, updatedAt, deletedAt` |
| **User**              | `id, email, firstName, lastName, phone, role (UserRole), status (UserStatus), avatarUrl, emailVerified, tenantId, lastLoginAt, preferences, createdAt, updatedAt`          |
| **Session**           | `id, userId, userAgent, ipAddress, lastActiveAt, expiresAt, createdAt, updatedAt, deletedAt`                                                                               |
| **Invitation**        | `id, email, role, status (InvitationStatus), expiresAt, createdAt` (+ one-time plaintext `token` on create)                                                                |
| **ApiKey**            | `id, name, keyPrefix, keyLastChars, scopes[], isActive, expiresAt, lastUsedAt, rateLimitPerMin, createdAt, updatedAt` (+ one-time raw `key` on create/rotate)              |
| **Subscription**      | `id, tenantId, plan (PlanType), status (SubscriptionStatus), …` (+ `usage` object)                                                                                         |
| **AuditLog**          | `id, action, resource, resourceId, userId, tenantId, oldValues, newValues, ipAddress, userAgent, createdAt`                                                                |
| **ConsentRecord**     | user/customer consent by `type (ConsentType)`, `granted`, `consentDate`, `revokedAt`                                                                                       |
| **CookiePreference**  | `necessary, functional, analytics, marketing, thirdParty`                                                                                                                  |
| **DataExportRequest** | `id, status, format, requestType, filePath, fileSize, expiresAt, errorMessage, createdAt`                                                                                  |
| **BackupRecord**      | `id, type (BackupRecordType), status (BackupRecordStatus), filePath, fileSize, checksum, retentionDays, expiresAt, completedAt, errorMessage, createdAt`                   |

### Restaurants, Branches, Space

| Entity                | Key fields                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Restaurant**        | `id, tenantId, name, slug, description, phone, email, address, city, country, timezone, currency, logoUrl, metadata, isActive, deletedAt, timestamps`            |
| **Branch**            | `id, restaurantId, tenantId, name, slug, type (BranchType), phone, email, address, city, country, latitude, longitude, timezone, isActive, metadata, timestamps` |
| **Floor**             | `id, restaurantId, branchId, tenantId, name, level (int), description, isActive, timestamps` — **no geometry fields**                                            |
| **DiningArea**        | `id, branchId, floorId, tenantId, name, capacity, section, isActive, timestamps` — **no geometry fields**                                                        |
| **Table**             | `id, branchId, diningAreaId, tenantId, number, seats, status (TableStatus), qrCode, isActive, metadata, timestamps` — **no x/y/position**                        |
| **BusinessHours**     | `id, restaurantId, dayOfWeek (DayOfWeek), openTime "HH:MM", closeTime, isClosed`                                                                                 |
| **BusinessException** | `id, restaurantId, date, openTime, closeTime, isClosed, reason`                                                                                                  |
| **TaxRate**           | `id, restaurantId, name, rate (number), isActive`                                                                                                                |
| **ServiceCharge**     | `id, restaurantId, name, rate, isActive`                                                                                                                         |
| **Unit**              | `id, tenantId, name, abbreviation, type (UnitType)`                                                                                                              |

> **Floor-plan warning:** the `Floor`, `DiningArea`, and `Table` models expose
> **no** position/shape/rotation fields. A free-form `metadata` JSON exists on
> `Table` only. If the UX includes a drag-and-drop floor plan, the geometry has
> **no current backend persistence** — flag this to the backend team before
> designing it. See `ui-ux-brief.md` → "Known gaps".

### Menu & Catalog

| Entity                                    | Key fields                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MenuCategory**                          | `id, restaurantId, name, description, sortOrder, isActive`                                                                                                                             |
| **Product**                               | `id, restaurantId, name, description, menuCategoryId, sku, basePrice, costPrice, taxRate, isFeatured, sortOrder, isActive, metadata`                                                   |
| **ProductVariant**                        | `id, productId, name, price, sku, sortOrder, isActive` (+ optional `VariantGroup`)                                                                                                     |
| **VariantGroup**                          | `id, productId, name, type (VariantType), minSelection, maxSelection, isRequired, sortOrder`                                                                                           |
| **ProductImage**                          | `id, productId, url, sortOrder, isPrimary`                                                                                                                                             |
| **ProductAvailability**                   | `id, productId, dayOfWeek (DayOfWeek), startTime, endTime`                                                                                                                             |
| **ModifierGroup**                         | `id, restaurantId, name, description, minSelection, maxSelection, isRequired, sortOrder, isActive`                                                                                     |
| **Modifier**                              | `id, modifierGroupId, name, price, sortOrder, isActive`                                                                                                                                |
| **ProductTag** / **ProductTagAssignment** | tags attach to products                                                                                                                                                                |
| **Allergen**                              | `id, restaurantId, name, slug, description, iconUrl, isActive`                                                                                                                         |
| **NutritionalInfo**                       | `productId, calories, protein, carbs, fat, fiber, sugar, sodium, metadata`                                                                                                             |
| **Ingredient**                            | `id, tenantId, name, description, unit, costPerUnit, stockLevel, minStock, isActive`                                                                                                   |
| **Recipe** / **RecipeItem**               | recipe (`name, productId?, yield, servingUnit, preparationTime, cookingTime, instructions, version, isActive`) + items (`inventoryItemId, quantity, unit, wastePercentage, sortOrder`) |

### Orders & Kitchen

| Entity                    | Key fields                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Order**                 | `id, restaurantId, branchId, tableId?, orderType (OrderType), source, status (OrderStatus), items[], statusHistory[], notes[], subtotal, discountType (DiscountType), discountAmount, taxAmount, serviceChargeAmount, deliveryFee, total, paidAmount, orderNumber, customerName/Phone/Email, deliveryAddress, createdAt, updatedAt` |
| **OrderItem**             | `id, orderId, productId, variantId?, productName, variantName, sku, quantity, unitPrice, discount, preparationNotes, kitchenStatus (KitchenStatus), isVoided, modifiers[]`                                                                                                                                                          |
| **OrderItemModifier**     | `id, orderItemId, modifierId?, name, quantity, price`                                                                                                                                                                                                                                                                               |
| **OrderStatusHistory**    | `id, orderId, fromStatus, toStatus, reason, changedBy, createdAt`                                                                                                                                                                                                                                                                   |
| **OrderNote**             | `id, orderId, type (NoteType), content, createdBy, createdAt`                                                                                                                                                                                                                                                                       |
| **KitchenTicket**         | `id, orderId, stationId?, ticketNumber, status (KitchenStatus), items[], createdAt, completedAt`                                                                                                                                                                                                                                    |
| **KitchenTicketItem**     | `id, ticketId, orderItemId, stationId?, status (TicketItemStatus), startedAt, completedAt`                                                                                                                                                                                                                                          |
| **KitchenStation**        | `id, restaurantId, name, slug, description, color, icon, displayOrder, isActive`                                                                                                                                                                                                                                                    |
| **Payment**               | `id, orderId, tenantId, method (PaymentMethod), status (PaymentStatus), amount, tip, reference, gatewayRef, clientSecret?, processedAt, refundedAt, refundReason, idempotencyKey, createdAt`                                                                                                                                        |
| **PaymentWebhookReceipt** | `id, provider, eventId, status (PaymentWebhookReceiptStatus)` (replay protection)                                                                                                                                                                                                                                                   |
| **GiftCard**              | `id, tenantId, code, initialBalance, currentBalance, currency, status (GiftCardStatus), issueType (GiftCardIssueType), recipientName/Email/Phone, message, expiresAt, issuedAt, redeemedAt`                                                                                                                                         |
| **GiftCardTransaction**   | `id, giftCardId, type (GiftCardTransactionType), amount, balanceBefore, balanceAfter, referenceId, description, createdAt`                                                                                                                                                                                                          |

The **Order lifecycle** and **payment flow** are state machines — see
`ui-ux-brief.md` for the exact allowed transitions.

### Inventory & Supply Chain

| Entity                                                    | Key fields                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **InventoryItem**                                         | `id, name, description, sku, barcode, internalCode, categoryId, unitId, locationId, currentQuantity, reservedQuantity, minStock, maxStock, reorderLevel, unitCost, averageCost, lastCost, isActive, isPurchasable, isManufactured, image, metadata` |
| **InventoryCategory / InventoryUnit / InventoryLocation** | categories (`name, parentId, sortOrder`), units (`name, abbreviation, type InventoryUnitType`), locations (`name, branchId, type InventoryLocationType`)                                                                                            |
| **InventoryBatch**                                        | `id, inventoryItemId, batchNumber?, quantity, unitCost, expiryDate?`                                                                                                                                                                                |
| **StockAdjustment**                                       | `id, inventoryItemId, branchId?, type (AdjustmentType), reason (AdjustmentReason), quantity, unitCost, totalCost, referenceNumber, notes, status (StockAdjustmentStatus)`                                                                           |
| **StockMovement**                                         | `id, inventoryItemId, type (StockMovementType), quantity, unitCost, referenceType, referenceId, createdAt`                                                                                                                                          |
| **WasteEntry**                                            | `inventoryItemId, type (WasteType), quantity, unitCost, totalCost, notes`                                                                                                                                                                           |
| **InventoryCount**                                        | `inventoryItemId, type (InventoryCountType), status (InventoryCountStatus), …`                                                                                                                                                                      |
| **Supplier**                                              | `id, tenantId, name, contactName, email, phone, address, isActive, metadata`                                                                                                                                                                        |
| **PurchaseOrder** / **PurchaseOrderItem**                 | PO (`supplierDetailId, branchId, status (PurchaseOrderStatus), expectedDate, supplierReference, subtotal, taxAmount, total, notes`) + items (`inventoryItemId, description, quantity, unitPrice, receivedQuantity, sortOrder`)                      |
| **GoodsReceipt** / **GoodsReceiptItem**                   | GRN (`purchaseOrderId, branchId, status (GoodsReceiptStatus), receivedDate, notes`) + items (`inventoryItemId, quantityReceived, unitCost, batchNumber, expiryDate`)                                                                                |
| **BranchTransfer** / **BranchTransferItem**               | transfer (`fromBranchId, toBranchId, status (TransferStatus), transferNumber, notes`) + items (`inventoryItemId, quantity, receivedQuantity`)                                                                                                       |
| **CycleCount** / **CycleCountItem**                       | count (`warehouseId?, countDate, scheduledDate, status (CycleCountStatus), countType`) + items (`inventoryItemId, expectedQuantity, actualQuantity, status (CycleCountItemStatus)`)                                                                 |
| **Warehouse** / **WarehouseZone** / **StorageBin**        | warehouse (`name, code, type (WarehouseType), status (WarehouseStatus), capacity, capacityUnit`)                                                                                                                                                    |
| **InventoryForecast**                                     | `inventoryItemId, forecastDate, forecastQuantity, method (ForecastMethod), period (ConsumptionPeriod)`                                                                                                                                              |
| **ReorderSuggestion**                                     | `inventoryItemId, suggestedQuantity, status (ReorderStatus), priority, notes`                                                                                                                                                                       |
| **InventoryValuation**                                    | `inventoryItemId, valuationDate, method (ValuationMethod), unitCost, totalValue, quantity`                                                                                                                                                          |
| **Barcode**                                               | `id, inventoryItemId, barcode, qrCode, type (BarcodeType), isPrimary, labelTemplate`                                                                                                                                                                |

### CRM & Customers

| Entity                                                                  | Key fields                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer**                                                            | `id, firstName, lastName, email, phone, avatarUrl, gender, dateOfBirth, anniversary, language, notes, status (CustomerStatus), preferredBranchId, preferredTableId, tags[], source, restaurantId`                                        |
| **CustomerAddress**                                                     | `label, address, city, state, zipCode, country, isDefault, latitude, longitude`                                                                                                                                                          |
| **CustomerPreference**                                                  | `key, value`                                                                                                                                                                                                                             |
| **VisitHistory**                                                        | visit records per customer                                                                                                                                                                                                               |
| **LoyaltyProgram / LoyaltyTier / LoyaltyPointsTransaction**             | programs/tiers (`name, minPoints, …`); transactions (`points, type (LoyaltyTransactionType), balanceAfter, description, referenceId/Type, expiresAt`)                                                                                    |
| **Membership / MembershipHistory**                                      | membership (`customerId, tier (MembershipTier), points, lifetimePoints`); history (`fromTier, toTier, reason`)                                                                                                                           |
| **Reward**                                                              | `id, customerId, type (RewardType), title, description, code, discountPercent, discountAmount, freeProductId/Name, minOrderAmount, status (RewardStatus), expiredAt`                                                                     |
| **Wallet / WalletTransaction**                                          | wallet (`customerId, balance, currency`); transactions (`type (WalletTransactionType), amount, balanceBefore, balanceAfter, description`)                                                                                                |
| **Referral**                                                            | `code, referredId/Email/Phone, status (ReferralStatus), rewardPoints`                                                                                                                                                                    |
| **CustomerSegment / CustomerSegmentAssignment**                         | segment (`name, type (SegmentType), description, rules, isDynamic, isActive`)                                                                                                                                                            |
| **CustomerAnalytics**                                                   | `lifetimeValue, averageOrderValue, visitFrequency, totalVisits, totalSpend, totalOrders, lastVisitAt, lastOrderAt, rewardUsageCount, rewardPointsEarned, rewardPointsRedeemed, daysSinceLastVisit`                                       |
| **CrmTimelineEntry**                                                    | `customerId, type (TimelineEventType), title, description, metadata, referenceId/Type, createdAt`                                                                                                                                        |
| **CommunicationTemplate / CommunicationLog**                            | template (`name, channel (CommunicationChannel), subject, body, variables[]`); log (`channel, recipient, customerId, status (CommunicationStatus), sentAt, deliveredAt, openedAt, clickedAt`)                                            |
| **EventRule / EventLog**                                                | rule (`name, event, condition, action, isActive`)                                                                                                                                                                                        |
| **Campaign / CampaignRecipient / CampaignAnalytics / CampaignApproval** | campaign (`name, type (CampaignType), status (CampaignStatus), startsAt, endsAt, budget`); analytics (`sentCount, deliveredCount, openedCount, clickedCount, conversionCount, revenueGenerated`) ; approval (`status APPROVED/REJECTED`) |
| **Promotion / PromotionUsage**                                          | promotion (`name, type (PromotionType), status (PromotionStatus), value, maxDiscount, minOrderAmount, code, usageLimit, usedCount, startsAt, endsAt`)                                                                                    |

### Reporting

| Entity                                    | Key fields                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ReportExport**                          | `id, type (ReportType), format (ReportFormat), status (ReportExportStatus), periodStart, periodEnd, filePath, fileSize, errorMessage, createdAt` |
| **ScheduledReport**                       | `id, name, type (ReportType), format (ReportFormat), schedule (cron), recipients[], config, isActive, lastRunAt`                                 |
| **WebhookRegistration / WebhookDelivery** | registration (`url, events[], isActive, secret`); delivery (`event, status (WebhookDeliveryStatus), attempts, lastAttemptAt, responseStatus`)    |

## Complete enum catalog

Use these exact values for badges, filters, dropdowns and status colors.
Everything below is from `prisma/schema.prisma`.

### Identity & plan

- **UserRole** = `SUPER_ADMIN, OWNER, MANAGER, STAFF, KITCHEN, CASHIER, WAITER, VIEWER`
- **UserStatus** = `ACTIVE, INACTIVE, SUSPENDED, PENDING`
- **PlanType** = `FREE, BASIC, STANDARD, PREMIUM, ENTERPRISE`
- **SubscriptionStatus** = `ACTIVE, PAST_DUE, CANCELED, TRIALING, PAUSED`
- **Currency** = `USD, EUR, GBP, EGP, SAR, AED`
- **InvitationStatus** = `PENDING, ACCEPTED, REJECTED, EXPIRED`
- **VerificationType** = `EMAIL_VERIFICATION, PASSWORD_RESET`
- **TenantStatus** = `ACTIVE, TRIALING, PAST_DUE, CANCELED, SUSPENDED`

### Space & settings

- **TableStatus** = `AVAILABLE, OCCUPIED, RESERVED, OUT_OF_SERVICE`
- **BranchType** = `MAIN, BRANCH, FRANCHISE`
- **DayOfWeek** = `MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY`
- **UnitType** = `WEIGHT, VOLUME, COUNT, LENGTH`
- **VariantType** = `SINGLE, MULTIPLE`

### Orders, kitchen & payments

- **OrderStatus** = `DRAFT, PENDING, CONFIRMED, IN_PREPARATION, READY, SERVED, COMPLETED, CANCELLED, REFUNDED, VOIDED`
- **OrderType** = `DINE_IN, TAKEAWAY, DELIVERY`
- **KitchenStatus** = `PENDING, PREPARING, READY, SERVED, CANCELLED`
- **TicketItemStatus** = `PENDING, QUEUED, PREPARING, READY, SERVED, CANCELLED`
- **NoteType** = `GENERAL, KITCHEN, CUSTOMER, WAITER`
- **DiscountType** = `PERCENTAGE, FIXED`
- **PaymentMethod** = `CASH, CREDIT_CARD, DEBIT_CARD, MOBILE_PAYMENT, BANK_TRANSFER, WALLET, GIFT_CARD`
- **PaymentStatus** = `PENDING, COMPLETED, FAILED, REFUNDED, PARTIALLY_REFUNDED`
- **PaymentWebhookReceiptStatus** = `PROCESSING, PROCESSED, FAILED`
- **GiftCardStatus** = `ACTIVE, REDEEMED, EXPIRED, DEACTIVATED`
- **GiftCardIssueType** = `MANUAL, SYSTEM, BULK`
- **GiftCardTransactionType** = `ISSUE, RECHARGE, REDEEM, REFUND, VOID`

### CRM & marketing

- **CustomerStatus** = `ACTIVE, INACTIVE, BLOCKED`
- **MembershipTier** = `BRONZE, SILVER, GOLD, PLATINUM, DIAMOND`
- **RewardType** = `COUPON, DISCOUNT, FREE_PRODUCT, FREE_DRINK, BIRTHDAY, ANNIVERSARY, REFERRAL, PROMOTIONAL`
- **RewardStatus** = `ACTIVE, REDEEMED, EXPIRED, CANCELLED`
- **WalletTransactionType** = `RECHARGE, SPEND, REFUND, ADJUSTMENT`
- **LoyaltyTransactionType** = `EARNED, REDEEMED, EXPIRED, ADJUSTED`
- **ReferralStatus** = `PENDING, REWARDED, EXPIRED`
- **SegmentType** = `VIP, INACTIVE, HIGH_SPENDER, FREQUENT_VISITOR, NEW_CUSTOMER, LOST_CUSTOMER, CUSTOM`
- **TimelineEventType** = `ORDER_CREATED, PAYMENT_COMPLETED, REFUND_ISSUED, REWARD_REDEEMED, WALLET_CHANGED, MEMBERSHIP_CHANGED, REFERRAL_COMPLETED, CAMPAIGN_SENT, POINTS_EARNED, POINTS_REDEEMED, PROMOTION_USED, NOTE_ADDED, SUPPORT_INTERACTION, SYSTEM_EVENT`
- **CommunicationChannel** = `EMAIL, SMS, PUSH, WHATSAPP`
- **CommunicationStatus** = `PENDING, SENT, DELIVERED, FAILED, BOUNCED, OPENED, CLICKED`
- **CampaignStatus** = `DRAFT, ACTIVE, PAUSED, COMPLETED, CANCELLED`
- **CampaignType** = `EMAIL, SMS, PUSH, WHATSAPP`
- **PromotionType** = `PERCENTAGE, FIXED, BUY_X_GET_Y, FREE_DELIVERY, HAPPY_HOUR`
- **PromotionStatus** = `ACTIVE, INACTIVE, EXPIRED, SCHEDULED`

### Inventory & supply chain

- **StockMovementType** = `PURCHASE, CONSUMPTION, TRANSFER_IN, TRANSFER_OUT, WASTE, ADJUSTMENT, RETURN, MANUAL`
- **PurchaseOrderStatus** = `DRAFT, PENDING_APPROVAL, APPROVED, ORDERED, PARTIALLY_RECEIVED, RECEIVED, CLOSED, CANCELLED`
- **GoodsReceiptStatus** = `PENDING, COMPLETED, CANCELLED`
- **TransferStatus** = `DRAFT, PENDING, APPROVED, IN_TRANSIT, RECEIVED, CANCELLED`
- **AdjustmentType** = `INCREASE, DECREASE`
- **AdjustmentReason** = `SPOILAGE, DAMAGE, CYCLE_COUNT, PHYSICAL_COUNT, MANUAL, RETURN, OTHER`
- **StockAdjustmentStatus** = `PENDING, APPROVED, REJECTED`
- **WasteType** = `SPOILAGE, KITCHEN_WASTE, EXPIRED, DAMAGED, EMPLOYEE_MISTAKE, OTHER`
- **InventoryLocationType** = `STORAGE, FRIDGE, FREEZER, SHELF, DRY_STORAGE, COLD_STORAGE, OTHER`
- **InventoryUnitType** = `VOLUME, WEIGHT, UNIT, LENGTH`
- **InventoryCountType / CountType** = `CYCLE, PHYSICAL, SPOT` (schema `CycleCountType` also has `FULL`)
- **InventoryCountStatus** = `DRAFT, IN_PROGRESS, COMPLETED, CANCELLED, VERIFIED, PENDING`
- **StockAdjustmentStatus** = `PENDING, APPROVED, REJECTED`
- **WarehouseType** = `CENTRAL, BRANCH, TRANSIT, VIRTUAL`
- **WarehouseStatus** = `ACTIVE, INACTIVE, MAINTENANCE`
- **WarehouseZoneType** = `STORAGE, PICKING, RECEIVING, SHIPPING, RETURNS, QUARANTINE`
- **StorageBinType** = `RACK, SHELF, BIN, PALLET, DRAWER`
- **StorageBinStatus** = `AVAILABLE, OCCUPIED, RESERVED, MAINTENANCE`
- **BarcodeType** = `EAN13, UPC, CODE128, QR, DATAMATRIX`
- **ForecastMethod** = `MOVING_AVERAGE, LINEAR_REGRESSION, SEASONAL, EXPONENTIAL_SMOOTHING`
- **ConsumptionPeriod** = `DAILY, WEEKLY, MONTHLY`
- **ReorderStatus** = `PENDING, APPROVED, ORDERED, CANCELLED, COMPLETED`
- **CycleCountStatus** = `SCHEDULED, IN_PROGRESS, BLIND, COMPLETED, APPROVED, RECONCILED`
- **CycleCountItemStatus** = `PENDING, COUNTED, VERIFIED, DISCREPANCY, RESOLVED`
- **CycleCountType** = `FULL, CYCLE, PHYSICAL, SPOT`
- **ValuationMethod** = `FIFO, WEIGHTED_AVERAGE, MOVING_AVERAGE`
- **SupplierStatus** = `ACTIVE, INACTIVE, SUSPENDED, PENDING`
- **ExpirationAlertType** = `WARNING, CRITICAL, EXPIRED`

### Reporting, notifications, privacy

- **ReportType** = `SALES, INVENTORY, KITCHEN, FINANCIAL, CUSTOM`
- **ReportFormat** = `CSV, EXCEL, PDF`
- **ExportFormat** = `JSON, CSV, EXCEL, PDF`
- **ReportExportStatus** = `PENDING, PROCESSING, COMPLETED, FAILED`
- **ReportStatus** = `PENDING, GENERATED, FAILED`
- **ApprovalStatus** = `PENDING, APPROVED, REJECTED`
- **NotificationType** = `ORDER, PAYMENT, RESERVATION, CUSTOMER, CAMPAIGN, INVENTORY, SYSTEM, ALERT, BILLING, SECURITY, LOW_STOCK, EXPIRY, BIRTHDAY, REFERRAL, MEMBERSHIP, GENERAL`
- **WebhookEventType** = order lifecycle + inventory + table events (see `realtime.md`)
- **WebhookDeliveryStatus** = `PENDING, SENT, FAILED, RETRYING, DELIVERED, DEAD_LETTER`
- **BackupRecordType** = `FULL, INCREMENTAL, MANUAL, AUTOMATED`
- **BackupRecordStatus** = `PENDING, IN_PROGRESS, COMPLETED, FAILED, EXPIRED`
- **ConsentType** = `MARKETING_EMAIL, SMS, PUSH_NOTIFICATIONS, DATA_PROCESSING, THIRD_PARTY_SHARING`

### Analytics-local enums (defined in modules, not Prisma)

- **GroupByPeriod** (sales-analytics `groupBy`) = `HOURLY, DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY`
- **ReportType** (scheduled-reports) = `SALES, INVENTORY, KITCHEN, FINANCIAL, CUSTOM`
- **ExportType** (export-engine) = `CSV, EXCEL, PDF`
- Reorder recommendation status (computed) = `OUT_OF_STOCK, NEEDS_REORDER, OK`
- Inventory projection status (forecasting dashboard) = `HEALTHY, LOW, CRITICAL, OUT_OF_STOCK`
