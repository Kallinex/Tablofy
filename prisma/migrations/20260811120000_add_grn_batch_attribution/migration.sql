-- P1-05: per-GRN batch attribution + database-level batch uniqueness.
-- Adds GoodsReceiptItem.inventoryBatchId (FK to inventory_batches, SET NULL) and a
-- UNIQUE natural key on inventory_batches (inventoryItemId, tenantId, batchNumber,
-- lotNumber, expiryDate) so concurrent GRN creates resolve batch reuse at the DB level.

-- AlterTable
ALTER TABLE "goods_receipt_items" ADD COLUMN     "inventoryBatchId" TEXT;

-- CreateIndex
CREATE INDEX "goods_receipt_items_inventoryBatchId_idx" ON "goods_receipt_items"("inventoryBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_batches_inventoryItemId_tenantId_batchNumber_lotN_key" ON "inventory_batches"("inventoryItemId", "tenantId", "batchNumber", "lotNumber", "expiryDate");

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_inventoryBatchId_fkey" FOREIGN KEY ("inventoryBatchId") REFERENCES "inventory_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "loyalty_points_transactions_tenantId_referenceType_referenceId_" RENAME TO "loyalty_points_transactions_tenantId_referenceType_referenc_key";
