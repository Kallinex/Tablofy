/*
  Warnings:

  - You are about to drop the column `name` on the `order_items` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `order_items` table. All the data in the column will be lost.
  - The `status` column on the `orders` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `productName` to the `order_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `order_items` table without a default value. This is not possible if the table is not empty.
  - Made the column `productId` on table `order_items` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "public"."OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'DELIVERY');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('DRAFT', 'PENDING', 'CONFIRMED', 'IN_PREPARATION', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "public"."KitchenStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."NoteType" AS ENUM ('GENERAL', 'KITCHEN', 'CUSTOMER', 'WAITER');

-- CreateEnum
CREATE TYPE "public"."DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."PaymentMethod" ADD VALUE 'WALLET';
ALTER TYPE "public"."PaymentMethod" ADD VALUE 'GIFT_CARD';

-- AlterEnum
ALTER TYPE "public"."PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- DropForeignKey
ALTER TABLE "public"."order_items" DROP CONSTRAINT "order_items_productId_fkey";

-- AlterTable
ALTER TABLE "public"."order_item_modifiers" ADD COLUMN     "modifierId" TEXT,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "public"."order_items" DROP COLUMN "name",
DROP COLUMN "notes",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountType" "public"."DiscountType",
ADD COLUMN     "kitchenStatus" "public"."KitchenStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "preparationNotes" TEXT,
ADD COLUMN     "priceSnapshot" JSONB,
ADD COLUMN     "productName" TEXT NOT NULL,
ADD COLUMN     "serviceCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxSnapshot" JSONB,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "variantId" TEXT,
ADD COLUMN     "variantName" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ALTER COLUMN "productId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."orders" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountType" "public"."DiscountType",
ADD COLUMN     "kitchenStatus" "public"."KitchenStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "orderType" "public"."OrderType" NOT NULL DEFAULT 'DINE_IN',
ADD COLUMN     "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "serviceCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "serviceChargeId" TEXT,
ADD COLUMN     "serviceChargeRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'POS',
ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRateId" TEXT,
ADD COLUMN     "tip" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "public"."OrderStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "taxAmount" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."payments" ADD COLUMN     "gatewayData" JSONB,
ADD COLUMN     "gatewayRef" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "tip" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."order_status_history" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromStatus" "public"."OrderStatus",
    "toStatus" "public"."OrderStatus" NOT NULL,
    "changedBy" TEXT,
    "changedByUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."order_notes" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "public"."NoteType" NOT NULL DEFAULT 'GENERAL',
    "content" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."kitchen_tickets" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "status" "public"."KitchenStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "printedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_status_history_orderId_idx" ON "public"."order_status_history"("orderId");

-- CreateIndex
CREATE INDEX "order_status_history_tenantId_idx" ON "public"."order_status_history"("tenantId");

-- CreateIndex
CREATE INDEX "order_status_history_createdAt_idx" ON "public"."order_status_history"("createdAt");

-- CreateIndex
CREATE INDEX "order_notes_orderId_idx" ON "public"."order_notes"("orderId");

-- CreateIndex
CREATE INDEX "order_notes_tenantId_idx" ON "public"."order_notes"("tenantId");

-- CreateIndex
CREATE INDEX "order_notes_type_idx" ON "public"."order_notes"("type");

-- CreateIndex
CREATE INDEX "kitchen_tickets_orderId_idx" ON "public"."kitchen_tickets"("orderId");

-- CreateIndex
CREATE INDEX "kitchen_tickets_tenantId_idx" ON "public"."kitchen_tickets"("tenantId");

-- CreateIndex
CREATE INDEX "kitchen_tickets_status_idx" ON "public"."kitchen_tickets"("status");

-- CreateIndex
CREATE INDEX "kitchen_tickets_createdAt_idx" ON "public"."kitchen_tickets"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_tickets_orderId_ticketNumber_key" ON "public"."kitchen_tickets"("orderId", "ticketNumber");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "public"."order_items"("productId");

-- CreateIndex
CREATE INDEX "order_items_kitchenStatus_idx" ON "public"."order_items"("kitchenStatus");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "public"."orders"("status");

-- CreateIndex
CREATE INDEX "orders_orderType_idx" ON "public"."orders"("orderType");

-- CreateIndex
CREATE INDEX "orders_source_idx" ON "public"."orders"("source");

-- CreateIndex
CREATE INDEX "payments_method_idx" ON "public"."payments"("method");

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_serviceChargeId_fkey" FOREIGN KEY ("serviceChargeId") REFERENCES "public"."service_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "public"."tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_status_history" ADD CONSTRAINT "order_status_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_notes" ADD CONSTRAINT "order_notes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_notes" ADD CONSTRAINT "order_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
