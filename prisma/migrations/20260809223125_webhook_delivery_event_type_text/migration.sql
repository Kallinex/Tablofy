-- AlterTable
ALTER TABLE "webhook_deliveries" DROP COLUMN "eventType",
ADD COLUMN     "eventType" TEXT NOT NULL;

-- DropEnum
DROP TYPE "WebhookEventType";

-- CreateIndex
CREATE INDEX "webhook_deliveries_eventType_idx" ON "webhook_deliveries"("eventType");
