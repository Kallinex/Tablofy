-- CreateEnum
CREATE TYPE "public"."WarehouseType" AS ENUM ('CENTRAL', 'BRANCH', 'TRANSIT', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "public"."WarehouseStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "public"."WarehouseZoneType" AS ENUM ('STORAGE', 'PICKING', 'RECEIVING', 'SHIPPING', 'RETURNS', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "public"."StorageBinType" AS ENUM ('RACK', 'SHELF', 'BIN', 'PALLET', 'DRAWER');

-- CreateEnum
CREATE TYPE "public"."StorageBinStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "public"."BarcodeType" AS ENUM ('EAN13', 'UPC', 'CODE128', 'QR', 'DATAMATRIX');

-- CreateEnum
CREATE TYPE "public"."ForecastMethod" AS ENUM ('MOVING_AVERAGE', 'LINEAR_REGRESSION', 'SEASONAL', 'EXPONENTIAL_SMOOTHING');

-- CreateEnum
CREATE TYPE "public"."ReorderStatus" AS ENUM ('PENDING', 'APPROVED', 'ORDERED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."CycleCountStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'BLIND', 'COMPLETED', 'APPROVED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "public"."CycleCountItemStatus" AS ENUM ('PENDING', 'COUNTED', 'VERIFIED', 'DISCREPANCY', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."ValuationMethod" AS ENUM ('FIFO', 'WEIGHTED_AVERAGE', 'MOVING_AVERAGE');

-- CreateEnum
CREATE TYPE "public"."ConsumptionPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "public"."warehouses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "public"."WarehouseType" NOT NULL DEFAULT 'BRANCH',
    "status" "public"."WarehouseStatus" NOT NULL DEFAULT 'ACTIVE',
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "capacity" DECIMAL(12,4),
    "capacityUnit" TEXT,
    "managerName" TEXT,
    "managerId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "branchId" TEXT,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."warehouse_zones" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "public"."WarehouseZoneType" NOT NULL DEFAULT 'STORAGE',
    "capacity" DECIMAL(12,4),
    "capacityUnit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "warehouse_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."storage_bins" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "public"."StorageBinType" NOT NULL DEFAULT 'BIN',
    "status" "public"."StorageBinStatus" NOT NULL DEFAULT 'AVAILABLE',
    "capacity" DECIMAL(12,4),
    "capacityUnit" TEXT,
    "currentLoad" DECIMAL(12,4) DEFAULT 0,
    "maxWeight" DECIMAL(12,4),
    "length" DECIMAL(12,4),
    "width" DECIMAL(12,4),
    "height" DECIMAL(12,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "storage_bins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."warehouse_branches" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."barcodes" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "barcode" TEXT,
    "qrCode" TEXT,
    "type" "public"."BarcodeType" NOT NULL DEFAULT 'CODE128',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "labelTemplate" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_forecasts" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "forecastDate" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "confidence" DECIMAL(5,4),
    "method" "public"."ForecastMethod" NOT NULL DEFAULT 'MOVING_AVERAGE',
    "period" "public"."ConsumptionPeriod" NOT NULL DEFAULT 'DAILY',
    "factors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reorder_suggestions" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "suggestedQuantity" DECIMAL(12,4) NOT NULL,
    "suggestedDate" TIMESTAMP(3) NOT NULL,
    "currentStock" DECIMAL(12,4) NOT NULL,
    "minStock" DECIMAL(12,4),
    "maxStock" DECIMAL(12,4),
    "safetyStock" DECIMAL(12,4),
    "leadTimeDays" INTEGER NOT NULL DEFAULT 1,
    "eoq" DECIMAL(12,4),
    "priority" TEXT,
    "status" "public"."ReorderStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reorder_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."consumption_records" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(12,4),
    "totalCost" DECIMAL(12,4),
    "period" "public"."ConsumptionPeriod" NOT NULL DEFAULT 'DAILY',
    "source" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumption_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cycle_counts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "countDate" TIMESTAMP(3) NOT NULL,
    "scheduledDate" TIMESTAMP(3),
    "status" "public"."CycleCountStatus" NOT NULL DEFAULT 'SCHEDULED',
    "countType" TEXT NOT NULL DEFAULT 'FULL',
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "cycle_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cycle_count_items" (
    "id" TEXT NOT NULL,
    "cycleCountId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "expectedQuantity" DECIMAL(12,4) NOT NULL,
    "actualQuantity" DECIMAL(12,4),
    "variance" DECIMAL(12,4),
    "variancePercent" DECIMAL(5,2),
    "isBlind" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."CycleCountItemStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supplier_performance_metrics" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierDetailId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "leadTimeAvg" DECIMAL(8,2),
    "fillRate" DECIMAL(5,2),
    "deliveryAccuracy" DECIMAL(5,2),
    "rejectedItems" INTEGER NOT NULL DEFAULT 0,
    "averageDelay" DECIMAL(8,2),
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "onTimeDeliveries" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" DECIMAL(5,2),
    "costScore" DECIMAL(5,2),
    "overallScore" DECIMAL(5,2),
    "rank" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_performance_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_valuations" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "valuationDate" TIMESTAMP(3) NOT NULL,
    "method" "public"."ValuationMethod" NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "unitCost" DECIMAL(12,4) NOT NULL,
    "totalValue" DECIMAL(16,4) NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "currency" "public"."Currency" NOT NULL DEFAULT 'USD',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouses_tenantId_idx" ON "public"."warehouses"("tenantId");

-- CreateIndex
CREATE INDEX "warehouses_branchId_idx" ON "public"."warehouses"("branchId");

-- CreateIndex
CREATE INDEX "warehouses_type_idx" ON "public"."warehouses"("type");

-- CreateIndex
CREATE INDEX "warehouses_status_idx" ON "public"."warehouses"("status");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenantId_code_deletedAt_key" ON "public"."warehouses"("tenantId", "code", "deletedAt");

-- CreateIndex
CREATE INDEX "warehouse_zones_tenantId_idx" ON "public"."warehouse_zones"("tenantId");

-- CreateIndex
CREATE INDEX "warehouse_zones_warehouseId_idx" ON "public"."warehouse_zones"("warehouseId");

-- CreateIndex
CREATE INDEX "warehouse_zones_type_idx" ON "public"."warehouse_zones"("type");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_zones_warehouseId_code_deletedAt_key" ON "public"."warehouse_zones"("warehouseId", "code", "deletedAt");

-- CreateIndex
CREATE INDEX "storage_bins_tenantId_idx" ON "public"."storage_bins"("tenantId");

-- CreateIndex
CREATE INDEX "storage_bins_zoneId_idx" ON "public"."storage_bins"("zoneId");

-- CreateIndex
CREATE INDEX "storage_bins_warehouseId_idx" ON "public"."storage_bins"("warehouseId");

-- CreateIndex
CREATE INDEX "storage_bins_type_idx" ON "public"."storage_bins"("type");

-- CreateIndex
CREATE INDEX "storage_bins_status_idx" ON "public"."storage_bins"("status");

-- CreateIndex
CREATE UNIQUE INDEX "storage_bins_warehouseId_code_deletedAt_key" ON "public"."storage_bins"("warehouseId", "code", "deletedAt");

-- CreateIndex
CREATE INDEX "warehouse_branches_tenantId_idx" ON "public"."warehouse_branches"("tenantId");

-- CreateIndex
CREATE INDEX "warehouse_branches_branchId_idx" ON "public"."warehouse_branches"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_branches_warehouseId_branchId_key" ON "public"."warehouse_branches"("warehouseId", "branchId");

-- CreateIndex
CREATE INDEX "barcodes_inventoryItemId_idx" ON "public"."barcodes"("inventoryItemId");

-- CreateIndex
CREATE INDEX "barcodes_tenantId_idx" ON "public"."barcodes"("tenantId");

-- CreateIndex
CREATE INDEX "barcodes_isPrimary_idx" ON "public"."barcodes"("isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "barcodes_barcode_tenantId_key" ON "public"."barcodes"("barcode", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "barcodes_qrCode_tenantId_key" ON "public"."barcodes"("qrCode", "tenantId");

-- CreateIndex
CREATE INDEX "inventory_forecasts_inventoryItemId_idx" ON "public"."inventory_forecasts"("inventoryItemId");

-- CreateIndex
CREATE INDEX "inventory_forecasts_tenantId_idx" ON "public"."inventory_forecasts"("tenantId");

-- CreateIndex
CREATE INDEX "inventory_forecasts_forecastDate_idx" ON "public"."inventory_forecasts"("forecastDate");

-- CreateIndex
CREATE INDEX "inventory_forecasts_method_idx" ON "public"."inventory_forecasts"("method");

-- CreateIndex
CREATE INDEX "reorder_suggestions_inventoryItemId_idx" ON "public"."reorder_suggestions"("inventoryItemId");

-- CreateIndex
CREATE INDEX "reorder_suggestions_tenantId_idx" ON "public"."reorder_suggestions"("tenantId");

-- CreateIndex
CREATE INDEX "reorder_suggestions_status_idx" ON "public"."reorder_suggestions"("status");

-- CreateIndex
CREATE INDEX "reorder_suggestions_suggestedDate_idx" ON "public"."reorder_suggestions"("suggestedDate");

-- CreateIndex
CREATE INDEX "consumption_records_inventoryItemId_idx" ON "public"."consumption_records"("inventoryItemId");

-- CreateIndex
CREATE INDEX "consumption_records_tenantId_idx" ON "public"."consumption_records"("tenantId");

-- CreateIndex
CREATE INDEX "consumption_records_date_idx" ON "public"."consumption_records"("date");

-- CreateIndex
CREATE INDEX "consumption_records_period_idx" ON "public"."consumption_records"("period");

-- CreateIndex
CREATE INDEX "cycle_counts_tenantId_idx" ON "public"."cycle_counts"("tenantId");

-- CreateIndex
CREATE INDEX "cycle_counts_warehouseId_idx" ON "public"."cycle_counts"("warehouseId");

-- CreateIndex
CREATE INDEX "cycle_counts_status_idx" ON "public"."cycle_counts"("status");

-- CreateIndex
CREATE INDEX "cycle_counts_countDate_idx" ON "public"."cycle_counts"("countDate");

-- CreateIndex
CREATE INDEX "cycle_count_items_cycleCountId_idx" ON "public"."cycle_count_items"("cycleCountId");

-- CreateIndex
CREATE INDEX "cycle_count_items_inventoryItemId_idx" ON "public"."cycle_count_items"("inventoryItemId");

-- CreateIndex
CREATE INDEX "cycle_count_items_status_idx" ON "public"."cycle_count_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_count_items_cycleCountId_inventoryItemId_key" ON "public"."cycle_count_items"("cycleCountId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "supplier_performance_metrics_tenantId_idx" ON "public"."supplier_performance_metrics"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_performance_metrics_supplierId_idx" ON "public"."supplier_performance_metrics"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_performance_metrics_supplierDetailId_idx" ON "public"."supplier_performance_metrics"("supplierDetailId");

-- CreateIndex
CREATE INDEX "supplier_performance_metrics_periodStart_periodEnd_idx" ON "public"."supplier_performance_metrics"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "supplier_performance_metrics_overallScore_idx" ON "public"."supplier_performance_metrics"("overallScore");

-- CreateIndex
CREATE INDEX "inventory_valuations_inventoryItemId_idx" ON "public"."inventory_valuations"("inventoryItemId");

-- CreateIndex
CREATE INDEX "inventory_valuations_tenantId_idx" ON "public"."inventory_valuations"("tenantId");

-- CreateIndex
CREATE INDEX "inventory_valuations_valuationDate_idx" ON "public"."inventory_valuations"("valuationDate");

-- CreateIndex
CREATE INDEX "inventory_valuations_method_idx" ON "public"."inventory_valuations"("method");

-- AddForeignKey
ALTER TABLE "public"."warehouse_zones" ADD CONSTRAINT "warehouse_zones_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."storage_bins" ADD CONSTRAINT "storage_bins_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "public"."warehouse_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."storage_bins" ADD CONSTRAINT "storage_bins_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."warehouse_branches" ADD CONSTRAINT "warehouse_branches_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."warehouse_branches" ADD CONSTRAINT "warehouse_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."barcodes" ADD CONSTRAINT "barcodes_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_forecasts" ADD CONSTRAINT "inventory_forecasts_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consumption_records" ADD CONSTRAINT "consumption_records_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cycle_count_items" ADD CONSTRAINT "cycle_count_items_cycleCountId_fkey" FOREIGN KEY ("cycleCountId") REFERENCES "public"."cycle_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cycle_count_items" ADD CONSTRAINT "cycle_count_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_performance_metrics" ADD CONSTRAINT "supplier_performance_metrics_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_performance_metrics" ADD CONSTRAINT "supplier_performance_metrics_supplierDetailId_fkey" FOREIGN KEY ("supplierDetailId") REFERENCES "public"."supplier_details"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_valuations" ADD CONSTRAINT "inventory_valuations_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
