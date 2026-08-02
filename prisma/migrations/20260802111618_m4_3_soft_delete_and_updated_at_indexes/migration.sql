-- CreateIndex
CREATE INDEX "allergens_tenantId_deletedAt_idx" ON "public"."allergens"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "analytics_dashboards_tenantId_deletedAt_idx" ON "public"."analytics_dashboards"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_deletedAt_idx" ON "public"."api_keys"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_isArchived_idx" ON "public"."audit_logs"("createdAt", "isArchived");

-- CreateIndex
CREATE INDEX "branch_transfers_tenantId_deletedAt_idx" ON "public"."branch_transfers"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "branches_tenantId_deletedAt_idx" ON "public"."branches"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "campaigns_tenantId_deletedAt_idx" ON "public"."campaigns"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "communication_templates_tenantId_deletedAt_idx" ON "public"."communication_templates"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "cycle_counts_tenantId_deletedAt_idx" ON "public"."cycle_counts"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "dining_areas_tenantId_deletedAt_idx" ON "public"."dining_areas"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "event_rules_tenantId_deletedAt_idx" ON "public"."event_rules"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "floors_tenantId_deletedAt_idx" ON "public"."floors"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "gift_cards_tenantId_deletedAt_idx" ON "public"."gift_cards"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "goods_receipts_tenantId_deletedAt_idx" ON "public"."goods_receipts"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "ingredients_tenantId_deletedAt_idx" ON "public"."ingredients"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "inventory_categories_tenantId_deletedAt_idx" ON "public"."inventory_categories"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "inventory_items_tenantId_deletedAt_idx" ON "public"."inventory_items"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "inventory_locations_tenantId_deletedAt_idx" ON "public"."inventory_locations"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "inventory_units_tenantId_deletedAt_idx" ON "public"."inventory_units"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "kitchen_stations_tenantId_deletedAt_idx" ON "public"."kitchen_stations"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "menu_categories_tenantId_deletedAt_idx" ON "public"."menu_categories"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "modifier_groups_tenantId_deletedAt_idx" ON "public"."modifier_groups"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "modifiers_tenantId_deletedAt_idx" ON "public"."modifiers"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "nutritional_info_tenantId_deletedAt_idx" ON "public"."nutritional_info"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "orders_tenantId_branchId_createdAt_idx" ON "public"."orders"("tenantId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_tenantId_deletedAt_idx" ON "public"."orders"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "orders_tenantId_status_createdAt_idx" ON "public"."orders"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "product_tags_tenantId_deletedAt_idx" ON "public"."product_tags"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "product_variants_tenantId_deletedAt_idx" ON "public"."product_variants"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "products_tenantId_deletedAt_idx" ON "public"."products"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "promotions_tenantId_deletedAt_idx" ON "public"."promotions"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_deletedAt_idx" ON "public"."purchase_orders"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "recipes_tenantId_deletedAt_idx" ON "public"."recipes"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "report_exports_tenantId_deletedAt_idx" ON "public"."report_exports"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "restaurants_tenantId_deletedAt_idx" ON "public"."restaurants"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "scheduled_reports_tenantId_deletedAt_idx" ON "public"."scheduled_reports"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "service_charges_tenantId_deletedAt_idx" ON "public"."service_charges"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "stock_adjustments_tenantId_deletedAt_idx" ON "public"."stock_adjustments"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "storage_bins_tenantId_deletedAt_idx" ON "public"."storage_bins"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "suppliers_tenantId_deletedAt_idx" ON "public"."suppliers"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "tables_tenantId_deletedAt_idx" ON "public"."tables"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "tax_rates_tenantId_deletedAt_idx" ON "public"."tax_rates"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "units_tenantId_deletedAt_idx" ON "public"."units"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "users_tenantId_deletedAt_idx" ON "public"."users"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "variant_groups_tenantId_deletedAt_idx" ON "public"."variant_groups"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "warehouse_zones_tenantId_deletedAt_idx" ON "public"."warehouse_zones"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "warehouses_tenantId_deletedAt_idx" ON "public"."warehouses"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "waste_entries_tenantId_deletedAt_idx" ON "public"."waste_entries"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "webhook_registrations_tenantId_deletedAt_idx" ON "public"."webhook_registrations"("tenantId", "deletedAt");
