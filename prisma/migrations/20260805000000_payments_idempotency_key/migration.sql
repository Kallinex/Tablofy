-- AlterTable
ALTER TABLE "public"."payments" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_idempotencyKey_key" ON "public"."payments"("tenantId", "idempotencyKey");
