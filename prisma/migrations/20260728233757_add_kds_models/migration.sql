-- CreateEnum
CREATE TYPE "public"."TicketItemStatus" AS ENUM ('PENDING', 'QUEUED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "public"."kitchen_tickets" ADD COLUMN     "stationId" TEXT;

-- AlterTable
ALTER TABLE "public"."products" ADD COLUMN     "stationId" TEXT;

-- CreateTable
CREATE TABLE "public"."kitchen_stations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."kitchen_ticket_items" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT,
    "status" "public"."TicketItemStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_ticket_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kitchen_stations_tenantId_idx" ON "public"."kitchen_stations"("tenantId");

-- CreateIndex
CREATE INDEX "kitchen_stations_restaurantId_idx" ON "public"."kitchen_stations"("restaurantId");

-- CreateIndex
CREATE INDEX "kitchen_stations_isActive_idx" ON "public"."kitchen_stations"("isActive");

-- CreateIndex
CREATE INDEX "kitchen_stations_displayOrder_idx" ON "public"."kitchen_stations"("displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_stations_restaurantId_slug_key" ON "public"."kitchen_stations"("restaurantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_stations_restaurantId_name_key" ON "public"."kitchen_stations"("restaurantId", "name");

-- CreateIndex
CREATE INDEX "kitchen_ticket_items_ticketId_idx" ON "public"."kitchen_ticket_items"("ticketId");

-- CreateIndex
CREATE INDEX "kitchen_ticket_items_orderItemId_idx" ON "public"."kitchen_ticket_items"("orderItemId");

-- CreateIndex
CREATE INDEX "kitchen_ticket_items_tenantId_idx" ON "public"."kitchen_ticket_items"("tenantId");

-- CreateIndex
CREATE INDEX "kitchen_ticket_items_stationId_idx" ON "public"."kitchen_ticket_items"("stationId");

-- CreateIndex
CREATE INDEX "kitchen_ticket_items_status_idx" ON "public"."kitchen_ticket_items"("status");

-- CreateIndex
CREATE INDEX "kitchen_ticket_items_startedAt_idx" ON "public"."kitchen_ticket_items"("startedAt");

-- CreateIndex
CREATE INDEX "kitchen_tickets_stationId_idx" ON "public"."kitchen_tickets"("stationId");

-- CreateIndex
CREATE INDEX "products_stationId_idx" ON "public"."products"("stationId");

-- AddForeignKey
ALTER TABLE "public"."products" ADD CONSTRAINT "products_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."kitchen_stations" ADD CONSTRAINT "kitchen_stations_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."kitchen_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "public"."order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
