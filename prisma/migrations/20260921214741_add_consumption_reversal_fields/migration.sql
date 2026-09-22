-- AlterTable
ALTER TABLE "consumption_records" ADD COLUMN     "reversalKey" TEXT,
ADD COLUMN     "reversedFromId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "consumption_records_reversalKey_key" ON "consumption_records"("reversalKey");

-- CreateIndex
CREATE INDEX "consumption_records_reversedFromId_idx" ON "consumption_records"("reversedFromId");

