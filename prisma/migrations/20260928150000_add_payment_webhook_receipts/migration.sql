-- Inbound payment-webhook replay ledger.
--
-- The payment mutations themselves are compare-and-set protected (claim the
-- PENDING row, claim the order version), so a replayed event can no longer
-- double-credit an order. What was still missing was a durable record of which
-- provider event ids have been seen: a replay produced noisy duplicate work, a
-- partial failure looked identical to success, and there was no way to answer
-- "did we already process evt_123?" during an incident.
--
-- The unique (provider, eventId) is the idempotency barrier. A receipt is
-- inserted with status PROCESSING *before* the payment mutation and flipped to
-- PROCESSED after; if processing throws, the row is marked FAILED so the
-- provider's retry re-opens it instead of being silently dropped.
--
-- This migration only creates a new table and its enum, so it is additive and
-- cannot lock or rewrite the payments table.

-- CreateEnum
CREATE TYPE "PaymentWebhookReceiptStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "payment_webhook_receipts" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "PaymentWebhookReceiptStatus" NOT NULL DEFAULT 'PROCESSING',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_webhook_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_receipts_provider_eventId_key" ON "payment_webhook_receipts"("provider", "eventId");

-- CreateIndex
CREATE INDEX "payment_webhook_receipts_status_idx" ON "payment_webhook_receipts"("status");

-- CreateIndex
CREATE INDEX "payment_webhook_receipts_createdAt_idx" ON "payment_webhook_receipts"("createdAt");
