-- CreateEnum
CREATE TYPE "public"."StockMovementType" AS ENUM ('PURCHASE', 'CONSUMPTION', 'TRANSFER_IN', 'TRANSFER_OUT', 'WASTE', 'ADJUSTMENT', 'RETURN', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."GoodsReceiptStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TransferStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."AdjustmentType" AS ENUM ('INCREASE', 'DECREASE');

-- CreateEnum
CREATE TYPE "public"."AdjustmentReason" AS ENUM ('SPOILAGE', 'DAMAGE', 'CYCLE_COUNT', 'PHYSICAL_COUNT', 'MANUAL', 'RETURN', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."WasteType" AS ENUM ('SPOILAGE', 'KITCHEN_WASTE', 'EXPIRED', 'DAMAGED', 'EMPLOYEE_MISTAKE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."CountType" AS ENUM ('CYCLE', 'PHYSICAL', 'SPOT');

-- CreateEnum
CREATE TYPE "public"."InventoryLocationType" AS ENUM ('STORAGE', 'FRIDGE', 'FREEZER', 'SHELF', 'DRY_STORAGE', 'COLD_STORAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."InventoryUnitType" AS ENUM ('VOLUME', 'WEIGHT', 'UNIT', 'LENGTH');

-- AlterTable
ALTER TABLE "public"."ingredients" ADD COLUMN     "inventoryItemId" TEXT;

-- CreateTable
CREATE TABLE "public"."inventory_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_units" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "type" "public"."InventoryUnitType" NOT NULL DEFAULT 'UNIT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "type" "public"."InventoryLocationType" NOT NULL DEFAULT 'STORAGE',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "internalCode" TEXT,
    "categoryId" TEXT,
    "unitId" TEXT,
    "locationId" TEXT,
    "currentQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "reservedQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "availableQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "minStock" DECIMAL(12,4),
    "maxStock" DECIMAL(12,4),
    "reorderLevel" DECIMAL(12,4),
    "unitCost" DECIMAL(12,4),
    "averageCost" DECIMAL(12,4),
    "lastCost" DECIMAL(12,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPurchasable" BOOLEAN NOT NULL DEFAULT true,
    "isManufactured" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_batches" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchNumber" TEXT,
    "lotNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(12,4),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supplier_details" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT,
    "taxId" TEXT,
    "paymentTerms" TEXT,
    "creditLimit" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "rating" INTEGER,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supplier_contacts" (
    "id" TEXT NOT NULL,
    "supplierDetailId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supplier_documents" (
    "id" TEXT NOT NULL,
    "supplierDetailId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "type" TEXT,
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_orders" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "supplierDetailId" TEXT,
    "status" "public"."PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "deliveredDate" TIMESTAMP(3),
    "supplierReference" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(12,2),
    "tax" DECIMAL(12,2),
    "total" DECIMAL(12,2),
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "tenantId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(12,4) NOT NULL,
    "receivedQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,4),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_order_approvals" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."goods_receipts" (
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."GoodsReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "receivedById" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."goods_receipt_items" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "inventoryItemId" TEXT,
    "tenantId" TEXT NOT NULL,
    "quantityReceived" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(12,4),
    "batchNumber" TEXT,
    "lotNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_movements" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" "public"."StockMovementType" NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(12,4),
    "totalCost" DECIMAL(12,4),
    "referenceType" TEXT,
    "referenceId" TEXT,
    "batchNumber" TEXT,
    "lotNumber" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."branch_transfers" (
    "id" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "toBranchId" TEXT NOT NULL,
    "status" "public"."TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "branch_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."branch_transfer_items" (
    "id" TEXT NOT NULL,
    "branchTransferId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "tenantId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "receivedQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recipes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "productId" TEXT,
    "yield" DECIMAL(10,2),
    "servingUnit" TEXT,
    "preparationTime" INTEGER,
    "cookingTime" INTEGER,
    "instructions" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "cost" DECIMAL(12,4),
    "foodCostPercentage" DECIMAL(5,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recipe_items" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "tenantId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unit" TEXT,
    "wastePercentage" DECIMAL(5,2),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_adjustments" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" "public"."AdjustmentType" NOT NULL,
    "reason" "public"."AdjustmentReason" NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(12,4),
    "totalCost" DECIMAL(12,4),
    "referenceNumber" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."waste_entries" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" "public"."WasteType" NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(12,4),
    "totalCost" DECIMAL(12,4),
    "reason" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "waste_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_counts" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "countType" "public"."CountType" NOT NULL,
    "expectedQuantity" DECIMAL(12,4) NOT NULL,
    "actualQuantity" DECIMAL(12,4) NOT NULL,
    "variance" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(12,4),
    "varianceCost" DECIMAL(12,4),
    "notes" TEXT,
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."expiration_alerts" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "alertType" TEXT NOT NULL DEFAULT 'WARNING',
    "message" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expiration_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_categories_tenantId_idx" ON "public"."inventory_categories"("tenantId");

-- CreateIndex
CREATE INDEX "inventory_categories_parentId_idx" ON "public"."inventory_categories"("parentId");

-- CreateIndex
CREATE INDEX "inventory_categories_isActive_idx" ON "public"."inventory_categories"("isActive");

-- CreateIndex
CREATE INDEX "inventory_categories_deletedAt_idx" ON "public"."inventory_categories"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_categories_tenantId_name_deletedAt_key" ON "public"."inventory_categories"("tenantId", "name", "deletedAt");

-- CreateIndex
CREATE INDEX "inventory_units_tenantId_idx" ON "public"."inventory_units"("tenantId");

-- CreateIndex
CREATE INDEX "inventory_units_isActive_idx" ON "public"."inventory_units"("isActive");

-- CreateIndex
CREATE INDEX "inventory_units_deletedAt_idx" ON "public"."inventory_units"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_tenantId_name_deletedAt_key" ON "public"."inventory_units"("tenantId", "name", "deletedAt");

-- CreateIndex
CREATE INDEX "inventory_locations_tenantId_idx" ON "public"."inventory_locations"("tenantId");

-- CreateIndex
CREATE INDEX "inventory_locations_branchId_idx" ON "public"."inventory_locations"("branchId");

-- CreateIndex
CREATE INDEX "inventory_locations_isActive_idx" ON "public"."inventory_locations"("isActive");

-- CreateIndex
CREATE INDEX "inventory_locations_deletedAt_idx" ON "public"."inventory_locations"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_tenantId_name_branchId_deletedAt_key" ON "public"."inventory_locations"("tenantId", "name", "branchId", "deletedAt");

-- CreateIndex
CREATE INDEX "inventory_items_tenantId_idx" ON "public"."inventory_items"("tenantId");

-- CreateIndex
CREATE INDEX "inventory_items_categoryId_idx" ON "public"."inventory_items"("categoryId");

-- CreateIndex
CREATE INDEX "inventory_items_unitId_idx" ON "public"."inventory_items"("unitId");

-- CreateIndex
CREATE INDEX "inventory_items_locationId_idx" ON "public"."inventory_items"("locationId");

-- CreateIndex
CREATE INDEX "inventory_items_sku_idx" ON "public"."inventory_items"("sku");

-- CreateIndex
CREATE INDEX "inventory_items_barcode_idx" ON "public"."inventory_items"("barcode");

-- CreateIndex
CREATE INDEX "inventory_items_isActive_idx" ON "public"."inventory_items"("isActive");

-- CreateIndex
CREATE INDEX "inventory_items_deletedAt_idx" ON "public"."inventory_items"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenantId_sku_deletedAt_key" ON "public"."inventory_items"("tenantId", "sku", "deletedAt");

-- CreateIndex
CREATE INDEX "inventory_batches_inventoryItemId_idx" ON "public"."inventory_batches"("inventoryItemId");

-- CreateIndex
CREATE INDEX "inventory_batches_tenantId_idx" ON "public"."inventory_batches"("tenantId");

-- CreateIndex
CREATE INDEX "inventory_batches_expiryDate_idx" ON "public"."inventory_batches"("expiryDate");

-- CreateIndex
CREATE INDEX "inventory_batches_batchNumber_idx" ON "public"."inventory_batches"("batchNumber");

-- CreateIndex
CREATE INDEX "inventory_batches_lotNumber_idx" ON "public"."inventory_batches"("lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_details_supplierId_key" ON "public"."supplier_details"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_details_tenantId_idx" ON "public"."supplier_details"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_details_supplierId_idx" ON "public"."supplier_details"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_details_code_idx" ON "public"."supplier_details"("code");

-- CreateIndex
CREATE INDEX "supplier_details_isPreferred_idx" ON "public"."supplier_details"("isPreferred");

-- CreateIndex
CREATE INDEX "supplier_contacts_supplierDetailId_idx" ON "public"."supplier_contacts"("supplierDetailId");

-- CreateIndex
CREATE INDEX "supplier_contacts_tenantId_idx" ON "public"."supplier_contacts"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_contacts_isPrimary_idx" ON "public"."supplier_contacts"("isPrimary");

-- CreateIndex
CREATE INDEX "supplier_documents_supplierDetailId_idx" ON "public"."supplier_documents"("supplierDetailId");

-- CreateIndex
CREATE INDEX "supplier_documents_tenantId_idx" ON "public"."supplier_documents"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_documents_expiryDate_idx" ON "public"."supplier_documents"("expiryDate");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_idx" ON "public"."purchase_orders"("tenantId");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierDetailId_idx" ON "public"."purchase_orders"("supplierDetailId");

-- CreateIndex
CREATE INDEX "purchase_orders_branchId_idx" ON "public"."purchase_orders"("branchId");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "public"."purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_orders_orderDate_idx" ON "public"."purchase_orders"("orderDate");

-- CreateIndex
CREATE INDEX "purchase_orders_expectedDate_idx" ON "public"."purchase_orders"("expectedDate");

-- CreateIndex
CREATE INDEX "purchase_orders_deletedAt_idx" ON "public"."purchase_orders"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenantId_poNumber_deletedAt_key" ON "public"."purchase_orders"("tenantId", "poNumber", "deletedAt");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchaseOrderId_idx" ON "public"."purchase_order_items"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_order_items_inventoryItemId_idx" ON "public"."purchase_order_items"("inventoryItemId");

-- CreateIndex
CREATE INDEX "purchase_order_items_tenantId_idx" ON "public"."purchase_order_items"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_approvals_purchaseOrderId_key" ON "public"."purchase_order_approvals"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_order_approvals_purchaseOrderId_idx" ON "public"."purchase_order_approvals"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_order_approvals_tenantId_idx" ON "public"."purchase_order_approvals"("tenantId");

-- CreateIndex
CREATE INDEX "goods_receipts_tenantId_idx" ON "public"."goods_receipts"("tenantId");

-- CreateIndex
CREATE INDEX "goods_receipts_purchaseOrderId_idx" ON "public"."goods_receipts"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "goods_receipts_branchId_idx" ON "public"."goods_receipts"("branchId");

-- CreateIndex
CREATE INDEX "goods_receipts_receivedDate_idx" ON "public"."goods_receipts"("receivedDate");

-- CreateIndex
CREATE INDEX "goods_receipts_deletedAt_idx" ON "public"."goods_receipts"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenantId_grnNumber_deletedAt_key" ON "public"."goods_receipts"("tenantId", "grnNumber", "deletedAt");

-- CreateIndex
CREATE INDEX "goods_receipt_items_goodsReceiptId_idx" ON "public"."goods_receipt_items"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "goods_receipt_items_purchaseOrderItemId_idx" ON "public"."goods_receipt_items"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "goods_receipt_items_inventoryItemId_idx" ON "public"."goods_receipt_items"("inventoryItemId");

-- CreateIndex
CREATE INDEX "goods_receipt_items_tenantId_idx" ON "public"."goods_receipt_items"("tenantId");

-- CreateIndex
CREATE INDEX "stock_movements_inventoryItemId_idx" ON "public"."stock_movements"("inventoryItemId");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_idx" ON "public"."stock_movements"("tenantId");

-- CreateIndex
CREATE INDEX "stock_movements_branchId_idx" ON "public"."stock_movements"("branchId");

-- CreateIndex
CREATE INDEX "stock_movements_type_idx" ON "public"."stock_movements"("type");

-- CreateIndex
CREATE INDEX "stock_movements_referenceType_referenceId_idx" ON "public"."stock_movements"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "stock_movements_createdAt_idx" ON "public"."stock_movements"("createdAt");

-- CreateIndex
CREATE INDEX "branch_transfers_tenantId_idx" ON "public"."branch_transfers"("tenantId");

-- CreateIndex
CREATE INDEX "branch_transfers_fromBranchId_idx" ON "public"."branch_transfers"("fromBranchId");

-- CreateIndex
CREATE INDEX "branch_transfers_toBranchId_idx" ON "public"."branch_transfers"("toBranchId");

-- CreateIndex
CREATE INDEX "branch_transfers_status_idx" ON "public"."branch_transfers"("status");

-- CreateIndex
CREATE INDEX "branch_transfers_deletedAt_idx" ON "public"."branch_transfers"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "branch_transfers_tenantId_transferNumber_deletedAt_key" ON "public"."branch_transfers"("tenantId", "transferNumber", "deletedAt");

-- CreateIndex
CREATE INDEX "branch_transfer_items_branchTransferId_idx" ON "public"."branch_transfer_items"("branchTransferId");

-- CreateIndex
CREATE INDEX "branch_transfer_items_inventoryItemId_idx" ON "public"."branch_transfer_items"("inventoryItemId");

-- CreateIndex
CREATE INDEX "branch_transfer_items_tenantId_idx" ON "public"."branch_transfer_items"("tenantId");

-- CreateIndex
CREATE INDEX "recipes_tenantId_idx" ON "public"."recipes"("tenantId");

-- CreateIndex
CREATE INDEX "recipes_productId_idx" ON "public"."recipes"("productId");

-- CreateIndex
CREATE INDEX "recipes_isActive_idx" ON "public"."recipes"("isActive");

-- CreateIndex
CREATE INDEX "recipes_deletedAt_idx" ON "public"."recipes"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_tenantId_name_deletedAt_key" ON "public"."recipes"("tenantId", "name", "deletedAt");

-- CreateIndex
CREATE INDEX "recipe_items_recipeId_idx" ON "public"."recipe_items"("recipeId");

-- CreateIndex
CREATE INDEX "recipe_items_inventoryItemId_idx" ON "public"."recipe_items"("inventoryItemId");

-- CreateIndex
CREATE INDEX "recipe_items_tenantId_idx" ON "public"."recipe_items"("tenantId");

-- CreateIndex
CREATE INDEX "stock_adjustments_inventoryItemId_idx" ON "public"."stock_adjustments"("inventoryItemId");

-- CreateIndex
CREATE INDEX "stock_adjustments_tenantId_idx" ON "public"."stock_adjustments"("tenantId");

-- CreateIndex
CREATE INDEX "stock_adjustments_branchId_idx" ON "public"."stock_adjustments"("branchId");

-- CreateIndex
CREATE INDEX "stock_adjustments_type_idx" ON "public"."stock_adjustments"("type");

-- CreateIndex
CREATE INDEX "stock_adjustments_reason_idx" ON "public"."stock_adjustments"("reason");

-- CreateIndex
CREATE INDEX "stock_adjustments_status_idx" ON "public"."stock_adjustments"("status");

-- CreateIndex
CREATE INDEX "stock_adjustments_deletedAt_idx" ON "public"."stock_adjustments"("deletedAt");

-- CreateIndex
CREATE INDEX "waste_entries_inventoryItemId_idx" ON "public"."waste_entries"("inventoryItemId");

-- CreateIndex
CREATE INDEX "waste_entries_tenantId_idx" ON "public"."waste_entries"("tenantId");

-- CreateIndex
CREATE INDEX "waste_entries_branchId_idx" ON "public"."waste_entries"("branchId");

-- CreateIndex
CREATE INDEX "waste_entries_type_idx" ON "public"."waste_entries"("type");

-- CreateIndex
CREATE INDEX "waste_entries_createdAt_idx" ON "public"."waste_entries"("createdAt");

-- CreateIndex
CREATE INDEX "waste_entries_deletedAt_idx" ON "public"."waste_entries"("deletedAt");

-- CreateIndex
CREATE INDEX "inventory_counts_inventoryItemId_idx" ON "public"."inventory_counts"("inventoryItemId");

-- CreateIndex
CREATE INDEX "inventory_counts_tenantId_idx" ON "public"."inventory_counts"("tenantId");

-- CreateIndex
CREATE INDEX "inventory_counts_branchId_idx" ON "public"."inventory_counts"("branchId");

-- CreateIndex
CREATE INDEX "inventory_counts_countType_idx" ON "public"."inventory_counts"("countType");

-- CreateIndex
CREATE INDEX "inventory_counts_countedAt_idx" ON "public"."inventory_counts"("countedAt");

-- CreateIndex
CREATE INDEX "expiration_alerts_inventoryItemId_idx" ON "public"."expiration_alerts"("inventoryItemId");

-- CreateIndex
CREATE INDEX "expiration_alerts_tenantId_idx" ON "public"."expiration_alerts"("tenantId");

-- CreateIndex
CREATE INDEX "expiration_alerts_expiryDate_idx" ON "public"."expiration_alerts"("expiryDate");

-- CreateIndex
CREATE INDEX "expiration_alerts_alertType_idx" ON "public"."expiration_alerts"("alertType");

-- CreateIndex
CREATE INDEX "expiration_alerts_resolvedAt_idx" ON "public"."expiration_alerts"("resolvedAt");

-- AddForeignKey
ALTER TABLE "public"."ingredients" ADD CONSTRAINT "ingredients_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_categories" ADD CONSTRAINT "inventory_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."inventory_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_locations" ADD CONSTRAINT "inventory_locations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_items" ADD CONSTRAINT "inventory_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."inventory_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_items" ADD CONSTRAINT "inventory_items_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."inventory_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_items" ADD CONSTRAINT "inventory_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_batches" ADD CONSTRAINT "inventory_batches_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_details" ADD CONSTRAINT "supplier_details_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplierDetailId_fkey" FOREIGN KEY ("supplierDetailId") REFERENCES "public"."supplier_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_documents" ADD CONSTRAINT "supplier_documents_supplierDetailId_fkey" FOREIGN KEY ("supplierDetailId") REFERENCES "public"."supplier_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplierDetailId_fkey" FOREIGN KEY ("supplierDetailId") REFERENCES "public"."supplier_details"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_orders" ADD CONSTRAINT "purchase_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_items" ADD CONSTRAINT "purchase_order_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."goods_receipts" ADD CONSTRAINT "goods_receipts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "public"."purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."branch_transfers" ADD CONSTRAINT "branch_transfers_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "public"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."branch_transfers" ADD CONSTRAINT "branch_transfers_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "public"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."branch_transfer_items" ADD CONSTRAINT "branch_transfer_items_branchTransferId_fkey" FOREIGN KEY ("branchTransferId") REFERENCES "public"."branch_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."branch_transfer_items" ADD CONSTRAINT "branch_transfer_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recipes" ADD CONSTRAINT "recipes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recipe_items" ADD CONSTRAINT "recipe_items_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "public"."recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recipe_items" ADD CONSTRAINT "recipe_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_adjustments" ADD CONSTRAINT "stock_adjustments_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."waste_entries" ADD CONSTRAINT "waste_entries_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_counts" ADD CONSTRAINT "inventory_counts_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."expiration_alerts" ADD CONSTRAINT "expiration_alerts_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
