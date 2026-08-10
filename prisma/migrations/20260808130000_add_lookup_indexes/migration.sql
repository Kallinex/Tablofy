-- CreateIndex
CREATE INDEX "orders_customerPhone_idx" ON "public"."orders"("customerPhone");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "public"."customers"("phone");

-- CreateIndex
CREATE INDEX "consumption_records_tenantId_inventoryItemId_date_idx" ON "public"."consumption_records"("tenantId", "inventoryItemId", "date");

-- CreateIndex
CREATE INDEX "wallet_transactions_referenceType_referenceId_idx" ON "public"."wallet_transactions"("referenceType", "referenceId");
