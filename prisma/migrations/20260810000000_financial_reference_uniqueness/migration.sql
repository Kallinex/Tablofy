-- PRE-CHECK (manual, requires DB access): ensure no duplicate
-- (tenantId, referenceType, referenceId) rows exist in wallet_transactions
-- and loyalty_points_transactions before applying, otherwise this migration fails.
-- Example pre-check:
--   SELECT tenantId, referenceType, referenceId, COUNT(*)
--   FROM wallet_transactions WHERE referenceId IS NOT NULL
--   GROUP BY 1,2,3 HAVING COUNT(*) > 1;

-- DropIndex
DROP INDEX "wallet_transactions_referenceType_referenceId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_tenantId_referenceType_referenceId_key" ON "public"."wallet_transactions"("tenantId", "referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_points_transactions_tenantId_referenceType_referenceId_key" ON "public"."loyalty_points_transactions"("tenantId", "referenceType", "referenceId");
