-- CreateEnum
CREATE TYPE "public"."TimelineEventType" AS ENUM ('ORDER_CREATED', 'PAYMENT_COMPLETED', 'REFUND_ISSUED', 'REWARD_REDEEMED', 'WALLET_CHANGED', 'MEMBERSHIP_CHANGED', 'REFERRAL_COMPLETED', 'CAMPAIGN_SENT', 'POINTS_EARNED', 'POINTS_REDEEMED', 'PROMOTION_USED', 'NOTE_ADDED', 'SUPPORT_INTERACTION', 'SYSTEM_EVENT');

-- CreateEnum
CREATE TYPE "public"."CommunicationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "public"."CommunicationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'OPENED', 'CLICKED');

-- CreateEnum
CREATE TYPE "public"."CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."CampaignType" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "public"."PromotionType" AS ENUM ('PERCENTAGE', 'FIXED', 'BUY_X_GET_Y', 'FREE_DELIVERY', 'HAPPY_HOUR');

-- CreateEnum
CREATE TYPE "public"."PromotionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED', 'SCHEDULED');

-- CreateTable
CREATE TABLE "public"."crm_timeline_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "public"."TimelineEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_timeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."communication_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "public"."CommunicationChannel" NOT NULL DEFAULT 'EMAIL',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "communication_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."communication_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "campaignId" TEXT,
    "channel" "public"."CommunicationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "status" "public"."CommunicationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."campaign_templates" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "public"."CampaignType" NOT NULL DEFAULT 'EMAIL',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "recipient" TEXT NOT NULL,
    "channel" "public"."CampaignType" NOT NULL DEFAULT 'EMAIL',
    "status" "public"."CommunicationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."campaign_analytics" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "openedCount" INTEGER NOT NULL DEFAULT 0,
    "clickedCount" INTEGER NOT NULL DEFAULT 0,
    "bouncedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "conversionCount" INTEGER NOT NULL DEFAULT 0,
    "revenueGenerated" DECIMAL(10,2),
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."campaign_approvals" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."promotions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "public"."PromotionType" NOT NULL DEFAULT 'PERCENTAGE',
    "status" "public"."PromotionStatus" NOT NULL DEFAULT 'ACTIVE',
    "value" DECIMAL(10,2) NOT NULL,
    "maxDiscount" DECIMAL(10,2),
    "minOrderAmount" DECIMAL(10,2),
    "buyQuantity" INTEGER,
    "getQuantity" INTEGER,
    "freeProductId" TEXT,
    "freeProductName" TEXT,
    "code" TEXT,
    "usageLimit" INTEGER,
    "usagePerCustomer" INTEGER,
    "usagePerTenant" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isStackable" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."promotion_branch_restrictions" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "promotion_branch_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."promotion_product_restrictions" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "promotion_product_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."promotion_category_restrictions" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "promotion_category_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."promotion_usages" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "tenantId" TEXT NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "promotion_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "condition" JSONB,
    "action" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "event_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT,
    "payload" JSONB,
    "result" TEXT,
    "error" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_timeline_entries_customerId_createdAt_idx" ON "public"."crm_timeline_entries"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_timeline_entries_tenantId_customerId_idx" ON "public"."crm_timeline_entries"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "crm_timeline_entries_tenantId_type_idx" ON "public"."crm_timeline_entries"("tenantId", "type");

-- CreateIndex
CREATE INDEX "crm_timeline_entries_createdAt_idx" ON "public"."crm_timeline_entries"("createdAt");

-- CreateIndex
CREATE INDEX "communication_templates_tenantId_idx" ON "public"."communication_templates"("tenantId");

-- CreateIndex
CREATE INDEX "communication_templates_channel_idx" ON "public"."communication_templates"("channel");

-- CreateIndex
CREATE INDEX "communication_templates_deletedAt_idx" ON "public"."communication_templates"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "communication_templates_tenantId_name_key" ON "public"."communication_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "communication_logs_tenantId_idx" ON "public"."communication_logs"("tenantId");

-- CreateIndex
CREATE INDEX "communication_logs_customerId_idx" ON "public"."communication_logs"("customerId");

-- CreateIndex
CREATE INDEX "communication_logs_campaignId_idx" ON "public"."communication_logs"("campaignId");

-- CreateIndex
CREATE INDEX "communication_logs_channel_idx" ON "public"."communication_logs"("channel");

-- CreateIndex
CREATE INDEX "communication_logs_status_idx" ON "public"."communication_logs"("status");

-- CreateIndex
CREATE INDEX "communication_logs_createdAt_idx" ON "public"."communication_logs"("createdAt");

-- CreateIndex
CREATE INDEX "campaign_templates_campaignId_idx" ON "public"."campaign_templates"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_templates_tenantId_idx" ON "public"."campaign_templates"("tenantId");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaignId_idx" ON "public"."campaign_recipients"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_recipients_customerId_idx" ON "public"."campaign_recipients"("customerId");

-- CreateIndex
CREATE INDEX "campaign_recipients_tenantId_idx" ON "public"."campaign_recipients"("tenantId");

-- CreateIndex
CREATE INDEX "campaign_recipients_status_idx" ON "public"."campaign_recipients"("status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_analytics_campaignId_key" ON "public"."campaign_analytics"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_analytics_tenantId_idx" ON "public"."campaign_analytics"("tenantId");

-- CreateIndex
CREATE INDEX "campaign_approvals_tenantId_idx" ON "public"."campaign_approvals"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_approvals_campaignId_key" ON "public"."campaign_approvals"("campaignId");

-- CreateIndex
CREATE INDEX "promotions_tenantId_idx" ON "public"."promotions"("tenantId");

-- CreateIndex
CREATE INDEX "promotions_type_idx" ON "public"."promotions"("type");

-- CreateIndex
CREATE INDEX "promotions_status_idx" ON "public"."promotions"("status");

-- CreateIndex
CREATE INDEX "promotions_code_idx" ON "public"."promotions"("code");

-- CreateIndex
CREATE INDEX "promotions_startsAt_endsAt_idx" ON "public"."promotions"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "promotions_deletedAt_idx" ON "public"."promotions"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_tenantId_code_key" ON "public"."promotions"("tenantId", "code");

-- CreateIndex
CREATE INDEX "promotion_branch_restrictions_promotionId_idx" ON "public"."promotion_branch_restrictions"("promotionId");

-- CreateIndex
CREATE INDEX "promotion_branch_restrictions_tenantId_idx" ON "public"."promotion_branch_restrictions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_branch_restrictions_promotionId_branchId_key" ON "public"."promotion_branch_restrictions"("promotionId", "branchId");

-- CreateIndex
CREATE INDEX "promotion_product_restrictions_promotionId_idx" ON "public"."promotion_product_restrictions"("promotionId");

-- CreateIndex
CREATE INDEX "promotion_product_restrictions_tenantId_idx" ON "public"."promotion_product_restrictions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_product_restrictions_promotionId_productId_key" ON "public"."promotion_product_restrictions"("promotionId", "productId");

-- CreateIndex
CREATE INDEX "promotion_category_restrictions_promotionId_idx" ON "public"."promotion_category_restrictions"("promotionId");

-- CreateIndex
CREATE INDEX "promotion_category_restrictions_tenantId_idx" ON "public"."promotion_category_restrictions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_category_restrictions_promotionId_categoryId_key" ON "public"."promotion_category_restrictions"("promotionId", "categoryId");

-- CreateIndex
CREATE INDEX "promotion_usages_promotionId_idx" ON "public"."promotion_usages"("promotionId");

-- CreateIndex
CREATE INDEX "promotion_usages_customerId_idx" ON "public"."promotion_usages"("customerId");

-- CreateIndex
CREATE INDEX "promotion_usages_tenantId_idx" ON "public"."promotion_usages"("tenantId");

-- CreateIndex
CREATE INDEX "promotion_usages_usedAt_idx" ON "public"."promotion_usages"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_usages_promotionId_customerId_orderId_key" ON "public"."promotion_usages"("promotionId", "customerId", "orderId");

-- CreateIndex
CREATE INDEX "event_rules_tenantId_idx" ON "public"."event_rules"("tenantId");

-- CreateIndex
CREATE INDEX "event_rules_event_idx" ON "public"."event_rules"("event");

-- CreateIndex
CREATE INDEX "event_rules_isActive_idx" ON "public"."event_rules"("isActive");

-- CreateIndex
CREATE INDEX "event_rules_deletedAt_idx" ON "public"."event_rules"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "event_rules_tenantId_name_key" ON "public"."event_rules"("tenantId", "name");

-- CreateIndex
CREATE INDEX "event_logs_tenantId_idx" ON "public"."event_logs"("tenantId");

-- CreateIndex
CREATE INDEX "event_logs_event_idx" ON "public"."event_logs"("event");

-- CreateIndex
CREATE INDEX "event_logs_ruleId_idx" ON "public"."event_logs"("ruleId");

-- CreateIndex
CREATE INDEX "event_logs_processedAt_idx" ON "public"."event_logs"("processedAt");

-- AddForeignKey
ALTER TABLE "public"."crm_timeline_entries" ADD CONSTRAINT "crm_timeline_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."communication_logs" ADD CONSTRAINT "communication_logs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaign_templates" ADD CONSTRAINT "campaign_templates_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaign_recipients" ADD CONSTRAINT "campaign_recipients_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaign_analytics" ADD CONSTRAINT "campaign_analytics_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaign_approvals" ADD CONSTRAINT "campaign_approvals_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."promotion_branch_restrictions" ADD CONSTRAINT "promotion_branch_restrictions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "public"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."promotion_product_restrictions" ADD CONSTRAINT "promotion_product_restrictions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "public"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."promotion_category_restrictions" ADD CONSTRAINT "promotion_category_restrictions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "public"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."promotion_usages" ADD CONSTRAINT "promotion_usages_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "public"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."promotion_usages" ADD CONSTRAINT "promotion_usages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
