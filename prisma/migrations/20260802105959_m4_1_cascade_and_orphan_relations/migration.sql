-- DropForeignKey
ALTER TABLE "public"."analytics_dashboards" DROP CONSTRAINT "analytics_dashboards_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."api_keys" DROP CONSTRAINT "api_keys_createdById_fkey";

-- DropForeignKey
ALTER TABLE "public"."api_keys" DROP CONSTRAINT "api_keys_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."backup_records" DROP CONSTRAINT "backup_records_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."consent_records" DROP CONSTRAINT "consent_records_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."consent_records" DROP CONSTRAINT "consent_records_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."cookie_preferences" DROP CONSTRAINT "cookie_preferences_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."customers" DROP CONSTRAINT "customers_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."data_export_requests" DROP CONSTRAINT "data_export_requests_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."data_export_requests" DROP CONSTRAINT "data_export_requests_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."gift_card_transactions" DROP CONSTRAINT "gift_card_transactions_giftCardId_fkey";

-- DropForeignKey
ALTER TABLE "public"."gift_card_transactions" DROP CONSTRAINT "gift_card_transactions_performedById_fkey";

-- DropForeignKey
ALTER TABLE "public"."gift_cards" DROP CONSTRAINT "gift_cards_issuedById_fkey";

-- DropForeignKey
ALTER TABLE "public"."gift_cards" DROP CONSTRAINT "gift_cards_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."invitations" DROP CONSTRAINT "invitations_invitedBy_fkey";

-- DropForeignKey
ALTER TABLE "public"."report_exports" DROP CONSTRAINT "report_exports_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."scheduled_reports" DROP CONSTRAINT "scheduled_reports_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "public"."webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_webhookId_fkey";

-- DropForeignKey
ALTER TABLE "public"."webhook_registrations" DROP CONSTRAINT "webhook_registrations_tenantId_fkey";

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."membership_history" ADD CONSTRAINT "membership_history_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."membership_history" ADD CONSTRAINT "membership_history_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_logs" ADD CONSTRAINT "event_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_logs" ADD CONSTRAINT "event_logs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "public"."event_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scheduled_reports" ADD CONSTRAINT "scheduled_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."report_exports" ADD CONSTRAINT "report_exports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analytics_dashboards" ADD CONSTRAINT "analytics_dashboards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."webhook_registrations" ADD CONSTRAINT "webhook_registrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "public"."webhook_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."gift_cards" ADD CONSTRAINT "gift_cards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."gift_cards" ADD CONSTRAINT "gift_cards_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "public"."gift_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consent_records" ADD CONSTRAINT "consent_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cookie_preferences" ADD CONSTRAINT "cookie_preferences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."data_export_requests" ADD CONSTRAINT "data_export_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."data_export_requests" ADD CONSTRAINT "data_export_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."backup_records" ADD CONSTRAINT "backup_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
