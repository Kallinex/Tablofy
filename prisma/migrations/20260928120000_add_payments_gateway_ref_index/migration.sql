-- Index for the inbound payment-webhook lookup path.
--
-- PaymentWebhooksController -> PaymentsService.handleGatewayWebhook resolves a
-- provider event to a local payment with findFirst({ gatewayRef }), three times
-- (applyWebhookSucceeded / applyWebhookFailed / applyWebhookRefunded). There was
-- no index on "gatewayRef" at all, so every inbound webhook from Stripe/Paymob
-- forced a sequential scan of the payments table, which grows without bound.
--
-- This index is deliberately NON-unique. Payment has no provider column and is
-- soft-deleted, so a unique constraint would be a design change rather than a
-- cleanup: providers scope references per account, and webhooks carry no tenant
-- context, so uniqueness must not be assumed before a provider column exists.
-- See scripts/audit-gatewayref.js for the precheck.

-- CreateIndex
CREATE INDEX "payments_gatewayRef_idx" ON "payments"("gatewayRef");
