-- CreateIndex
CREATE INDEX "allergens_tenantId_createdAt_idx" ON "public"."allergens"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_dashboards_tenantId_createdAt_idx" ON "public"."analytics_dashboards"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_createdAt_idx" ON "public"."api_keys"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "public"."audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "backup_records_tenantId_createdAt_idx" ON "public"."backup_records"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "barcodes_tenantId_createdAt_idx" ON "public"."barcodes"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "branch_transfer_items_tenantId_createdAt_idx" ON "public"."branch_transfer_items"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "branch_transfers_tenantId_createdAt_idx" ON "public"."branch_transfers"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "branches_tenantId_createdAt_idx" ON "public"."branches"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "business_exceptions_tenantId_createdAt_idx" ON "public"."business_exceptions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "campaign_approvals_tenantId_createdAt_idx" ON "public"."campaign_approvals"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "campaign_recipients_tenantId_createdAt_idx" ON "public"."campaign_recipients"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "campaign_templates_tenantId_createdAt_idx" ON "public"."campaign_templates"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "campaigns_tenantId_createdAt_idx" ON "public"."campaigns"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "communication_logs_tenantId_createdAt_idx" ON "public"."communication_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "communication_templates_tenantId_createdAt_idx" ON "public"."communication_templates"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "consent_records_tenantId_createdAt_idx" ON "public"."consent_records"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "consumption_records_tenantId_createdAt_idx" ON "public"."consumption_records"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "cookie_preferences_tenantId_createdAt_idx" ON "public"."cookie_preferences"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_timeline_entries_tenantId_createdAt_idx" ON "public"."crm_timeline_entries"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_addresses_tenantId_createdAt_idx" ON "public"."customer_addresses"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_preferences_tenantId_createdAt_idx" ON "public"."customer_preferences"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_segments_tenantId_createdAt_idx" ON "public"."customer_segments"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "cycle_counts_tenantId_createdAt_idx" ON "public"."cycle_counts"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "data_export_requests_tenantId_createdAt_idx" ON "public"."data_export_requests"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "dining_areas_tenantId_createdAt_idx" ON "public"."dining_areas"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "event_logs_tenantId_createdAt_idx" ON "public"."event_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "event_rules_tenantId_createdAt_idx" ON "public"."event_rules"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "expiration_alerts_tenantId_createdAt_idx" ON "public"."expiration_alerts"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_tenantId_createdAt_idx" ON "public"."feedback"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "floors_tenantId_createdAt_idx" ON "public"."floors"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "gift_card_transactions_tenantId_createdAt_idx" ON "public"."gift_card_transactions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "gift_cards_tenantId_createdAt_idx" ON "public"."gift_cards"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "goods_receipt_items_tenantId_createdAt_idx" ON "public"."goods_receipt_items"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "goods_receipts_tenantId_createdAt_idx" ON "public"."goods_receipts"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ingredients_tenantId_createdAt_idx" ON "public"."ingredients"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_batches_tenantId_createdAt_idx" ON "public"."inventory_batches"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_categories_tenantId_createdAt_idx" ON "public"."inventory_categories"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_counts_tenantId_createdAt_idx" ON "public"."inventory_counts"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_forecasts_tenantId_createdAt_idx" ON "public"."inventory_forecasts"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_items_tenantId_createdAt_idx" ON "public"."inventory_items"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_locations_tenantId_createdAt_idx" ON "public"."inventory_locations"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_units_tenantId_createdAt_idx" ON "public"."inventory_units"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_valuations_tenantId_createdAt_idx" ON "public"."inventory_valuations"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "invitations_tenantId_createdAt_idx" ON "public"."invitations"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "kitchen_stations_tenantId_createdAt_idx" ON "public"."kitchen_stations"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "kitchen_ticket_items_tenantId_createdAt_idx" ON "public"."kitchen_ticket_items"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "kitchen_tickets_tenantId_createdAt_idx" ON "public"."kitchen_tickets"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_points_transactions_tenantId_createdAt_idx" ON "public"."loyalty_points_transactions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_programs_tenantId_createdAt_idx" ON "public"."loyalty_programs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_tiers_tenantId_createdAt_idx" ON "public"."loyalty_tiers"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "membership_history_tenantId_createdAt_idx" ON "public"."membership_history"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "memberships_tenantId_createdAt_idx" ON "public"."memberships"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "menu_categories_tenantId_createdAt_idx" ON "public"."menu_categories"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "modifier_groups_tenantId_createdAt_idx" ON "public"."modifier_groups"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "modifiers_tenantId_createdAt_idx" ON "public"."modifiers"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_createdAt_idx" ON "public"."notifications"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "nutritional_info_tenantId_createdAt_idx" ON "public"."nutritional_info"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "order_items_tenantId_createdAt_idx" ON "public"."order_items"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "order_notes_tenantId_createdAt_idx" ON "public"."order_notes"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "order_status_history_tenantId_createdAt_idx" ON "public"."order_status_history"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_tenantId_createdAt_idx" ON "public"."orders"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_tenantId_createdAt_idx" ON "public"."payments"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "product_tags_tenantId_createdAt_idx" ON "public"."product_tags"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "product_variants_tenantId_createdAt_idx" ON "public"."product_variants"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "products_tenantId_createdAt_idx" ON "public"."products"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "promotions_tenantId_createdAt_idx" ON "public"."promotions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "purchase_order_approvals_tenantId_createdAt_idx" ON "public"."purchase_order_approvals"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "purchase_order_items_tenantId_createdAt_idx" ON "public"."purchase_order_items"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_createdAt_idx" ON "public"."purchase_orders"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "recipe_items_tenantId_createdAt_idx" ON "public"."recipe_items"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "recipes_tenantId_createdAt_idx" ON "public"."recipes"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "referrals_tenantId_createdAt_idx" ON "public"."referrals"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "reorder_suggestions_tenantId_createdAt_idx" ON "public"."reorder_suggestions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "report_exports_tenantId_createdAt_idx" ON "public"."report_exports"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "reports_tenantId_createdAt_idx" ON "public"."reports"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "restaurants_tenantId_createdAt_idx" ON "public"."restaurants"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "revoked_tokens_tenantId_createdAt_idx" ON "public"."revoked_tokens"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "rewards_tenantId_createdAt_idx" ON "public"."rewards"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "scheduled_reports_tenantId_createdAt_idx" ON "public"."scheduled_reports"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "service_charges_tenantId_createdAt_idx" ON "public"."service_charges"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_adjustments_tenantId_createdAt_idx" ON "public"."stock_adjustments"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_createdAt_idx" ON "public"."stock_movements"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "storage_bins_tenantId_createdAt_idx" ON "public"."storage_bins"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "subscriptions_tenantId_createdAt_idx" ON "public"."subscriptions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "supplier_contacts_tenantId_createdAt_idx" ON "public"."supplier_contacts"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "supplier_details_tenantId_createdAt_idx" ON "public"."supplier_details"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "supplier_documents_tenantId_createdAt_idx" ON "public"."supplier_documents"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "supplier_performance_metrics_tenantId_createdAt_idx" ON "public"."supplier_performance_metrics"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "suppliers_tenantId_createdAt_idx" ON "public"."suppliers"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "tables_tenantId_createdAt_idx" ON "public"."tables"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "tax_rates_tenantId_createdAt_idx" ON "public"."tax_rates"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "units_tenantId_createdAt_idx" ON "public"."units"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "users_tenantId_createdAt_idx" ON "public"."users"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "variant_groups_tenantId_createdAt_idx" ON "public"."variant_groups"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "visit_history_tenantId_createdAt_idx" ON "public"."visit_history"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_transactions_tenantId_createdAt_idx" ON "public"."wallet_transactions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "wallets_tenantId_createdAt_idx" ON "public"."wallets"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "warehouse_branches_tenantId_createdAt_idx" ON "public"."warehouse_branches"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "warehouse_zones_tenantId_createdAt_idx" ON "public"."warehouse_zones"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "warehouses_tenantId_createdAt_idx" ON "public"."warehouses"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "waste_entries_tenantId_createdAt_idx" ON "public"."waste_entries"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenantId_createdAt_idx" ON "public"."webhook_deliveries"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_registrations_tenantId_createdAt_idx" ON "public"."webhook_registrations"("tenantId", "createdAt");
