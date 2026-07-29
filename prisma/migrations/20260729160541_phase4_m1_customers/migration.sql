-- CreateEnum
CREATE TYPE "public"."CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."MembershipTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND');

-- CreateEnum
CREATE TYPE "public"."RewardType" AS ENUM ('COUPON', 'DISCOUNT', 'FREE_PRODUCT', 'FREE_DRINK', 'BIRTHDAY', 'ANNIVERSARY', 'REFERRAL', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "public"."RewardStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."WalletTransactionType" AS ENUM ('RECHARGE', 'SPEND', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."LoyaltyTransactionType" AS ENUM ('EARNED', 'REDEEMED', 'EXPIRED', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "public"."ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."SegmentType" AS ENUM ('VIP', 'INACTIVE', 'HIGH_SPENDER', 'FREQUENT_VISITOR', 'NEW_CUSTOMER', 'LOST_CUSTOMER', 'CUSTOM');

-- CreateTable
CREATE TABLE "public"."customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "restaurantId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "anniversary" TIMESTAMP(3),
    "language" TEXT NOT NULL DEFAULT 'en',
    "notes" TEXT,
    "status" "public"."CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "preferredBranchId" TEXT,
    "preferredTableId" TEXT,
    "tags" TEXT[],
    "source" TEXT,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "country" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_preferences" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."visit_history" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "restaurantId" TEXT,
    "branchId" TEXT,
    "orderId" TEXT,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalSpent" DECIMAL(65,30) DEFAULT 0,
    "itemsCount" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loyalty_programs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pointsPerCurrency" DECIMAL(65,30) NOT NULL DEFAULT 10,
    "currencyPerPoint" DECIMAL(65,30) NOT NULL DEFAULT 0.1,
    "minPointsRedeem" INTEGER NOT NULL DEFAULT 100,
    "maxPointsRedeem" INTEGER,
    "pointsExpireDays" INTEGER NOT NULL DEFAULT 365,
    "earnEnabled" BOOLEAN NOT NULL DEFAULT true,
    "redeemEnabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeBonusPoints" INTEGER NOT NULL DEFAULT 0,
    "referrerPoints" INTEGER NOT NULL DEFAULT 50,
    "referredPoints" INTEGER NOT NULL DEFAULT 25,
    "birthdayPoints" INTEGER NOT NULL DEFAULT 100,
    "anniversaryPoints" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loyalty_tiers" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tier" "public"."MembershipTier" NOT NULL,
    "minPoints" INTEGER NOT NULL DEFAULT 0,
    "maxPoints" INTEGER NOT NULL DEFAULT 1000,
    "multiplier" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "discountPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "priorityService" BOOLEAN NOT NULL DEFAULT false,
    "freeDelivery" BOOLEAN NOT NULL DEFAULT false,
    "birthdayReward" BOOLEAN NOT NULL DEFAULT true,
    "anniversaryReward" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loyalty_points_transactions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "restaurantId" TEXT,
    "points" INTEGER NOT NULL,
    "type" "public"."LoyaltyTransactionType" NOT NULL,
    "description" TEXT,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_points_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."memberships" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tier" "public"."MembershipTier" NOT NULL DEFAULT 'BRONZE',
    "points" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3),
    "tierUpgradedAt" TIMESTAMP(3),
    "tierDowngradedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."membership_history" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromTier" "public"."MembershipTier" NOT NULL,
    "toTier" "public"."MembershipTier" NOT NULL,
    "reason" TEXT,
    "pointsAtTime" INTEGER NOT NULL DEFAULT 0,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rewards" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "restaurantId" TEXT,
    "type" "public"."RewardType" NOT NULL,
    "status" "public"."RewardStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "code" TEXT,
    "discountPercent" DECIMAL(65,30),
    "discountAmount" DECIMAL(65,30),
    "freeProductId" TEXT,
    "freeProductName" TEXT,
    "minOrderAmount" DECIMAL(65,30),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."wallets" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" "public"."Currency" NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "public"."WalletTransactionType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "balanceBefore" DECIMAL(65,30) NOT NULL,
    "balanceAfter" DECIMAL(65,30) NOT NULL,
    "description" TEXT,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "currency" "public"."Currency" NOT NULL DEFAULT 'USD',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "public"."ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "referredEmail" TEXT,
    "referredPhone" TEXT,
    "rewardPoints" INTEGER NOT NULL DEFAULT 0,
    "rewardGiven" BOOLEAN NOT NULL DEFAULT false,
    "referredAt" TIMESTAMP(3),
    "rewardExpiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_segments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."SegmentType" NOT NULL DEFAULT 'CUSTOM',
    "description" TEXT,
    "rules" JSONB,
    "isDynamic" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_segment_assignments" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "customer_segment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_analytics" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lifetimeValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "averageOrderValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "visitFrequency" INTEGER NOT NULL DEFAULT 0,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "totalSpend" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "favoriteProductId" TEXT,
    "favoriteCategoryId" TEXT,
    "favoriteProductName" TEXT,
    "favoriteCategoryName" TEXT,
    "lastVisitAt" TIMESTAMP(3),
    "lastOrderAt" TIMESTAMP(3),
    "rewardUsageCount" INTEGER NOT NULL DEFAULT 0,
    "rewardPointsEarned" INTEGER NOT NULL DEFAULT 0,
    "rewardPointsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "daysSinceLastVisit" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenantId_status_idx" ON "public"."customers"("tenantId", "status");

-- CreateIndex
CREATE INDEX "customers_tenantId_restaurantId_idx" ON "public"."customers"("tenantId", "restaurantId");

-- CreateIndex
CREATE INDEX "customers_tenantId_createdAt_idx" ON "public"."customers"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "customers_tenantId_deletedAt_idx" ON "public"."customers"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_email_key" ON "public"."customers"("tenantId", "email");

-- CreateIndex
CREATE INDEX "customer_addresses_customerId_idx" ON "public"."customer_addresses"("customerId");

-- CreateIndex
CREATE INDEX "customer_addresses_tenantId_idx" ON "public"."customer_addresses"("tenantId");

-- CreateIndex
CREATE INDEX "customer_preferences_tenantId_idx" ON "public"."customer_preferences"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_preferences_customerId_key_key" ON "public"."customer_preferences"("customerId", "key");

-- CreateIndex
CREATE INDEX "visit_history_customerId_idx" ON "public"."visit_history"("customerId");

-- CreateIndex
CREATE INDEX "visit_history_tenantId_idx" ON "public"."visit_history"("tenantId");

-- CreateIndex
CREATE INDEX "visit_history_visitedAt_idx" ON "public"."visit_history"("visitedAt");

-- CreateIndex
CREATE INDEX "visit_history_customerId_visitedAt_idx" ON "public"."visit_history"("customerId", "visitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_tenantId_key" ON "public"."loyalty_programs"("tenantId");

-- CreateIndex
CREATE INDEX "loyalty_tiers_tenantId_idx" ON "public"."loyalty_tiers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_tiers_programId_tier_key" ON "public"."loyalty_tiers"("programId", "tier");

-- CreateIndex
CREATE INDEX "loyalty_points_transactions_customerId_idx" ON "public"."loyalty_points_transactions"("customerId");

-- CreateIndex
CREATE INDEX "loyalty_points_transactions_tenantId_idx" ON "public"."loyalty_points_transactions"("tenantId");

-- CreateIndex
CREATE INDEX "loyalty_points_transactions_customerId_createdAt_idx" ON "public"."loyalty_points_transactions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_points_transactions_expiresAt_idx" ON "public"."loyalty_points_transactions"("expiresAt");

-- CreateIndex
CREATE INDEX "memberships_tenantId_idx" ON "public"."memberships"("tenantId");

-- CreateIndex
CREATE INDEX "memberships_tier_idx" ON "public"."memberships"("tier");

-- CreateIndex
CREATE INDEX "memberships_points_idx" ON "public"."memberships"("points");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_customerId_tenantId_key" ON "public"."memberships"("customerId", "tenantId");

-- CreateIndex
CREATE INDEX "membership_history_customerId_idx" ON "public"."membership_history"("customerId");

-- CreateIndex
CREATE INDEX "membership_history_tenantId_idx" ON "public"."membership_history"("tenantId");

-- CreateIndex
CREATE INDEX "membership_history_changedAt_idx" ON "public"."membership_history"("changedAt");

-- CreateIndex
CREATE INDEX "rewards_customerId_idx" ON "public"."rewards"("customerId");

-- CreateIndex
CREATE INDEX "rewards_tenantId_idx" ON "public"."rewards"("tenantId");

-- CreateIndex
CREATE INDEX "rewards_status_idx" ON "public"."rewards"("status");

-- CreateIndex
CREATE INDEX "rewards_type_idx" ON "public"."rewards"("type");

-- CreateIndex
CREATE INDEX "rewards_expiredAt_idx" ON "public"."rewards"("expiredAt");

-- CreateIndex
CREATE INDEX "wallets_tenantId_idx" ON "public"."wallets"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_customerId_tenantId_key" ON "public"."wallets"("customerId", "tenantId");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_idx" ON "public"."wallet_transactions"("walletId");

-- CreateIndex
CREATE INDEX "wallet_transactions_customerId_idx" ON "public"."wallet_transactions"("customerId");

-- CreateIndex
CREATE INDEX "wallet_transactions_type_idx" ON "public"."wallet_transactions"("type");

-- CreateIndex
CREATE INDEX "wallet_transactions_tenantId_idx" ON "public"."wallet_transactions"("tenantId");

-- CreateIndex
CREATE INDEX "wallet_transactions_createdAt_idx" ON "public"."wallet_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "referrals_referrerId_idx" ON "public"."referrals"("referrerId");

-- CreateIndex
CREATE INDEX "referrals_referredId_idx" ON "public"."referrals"("referredId");

-- CreateIndex
CREATE INDEX "referrals_tenantId_idx" ON "public"."referrals"("tenantId");

-- CreateIndex
CREATE INDEX "referrals_status_idx" ON "public"."referrals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_code_key" ON "public"."referrals"("code");

-- CreateIndex
CREATE INDEX "customer_segments_tenantId_idx" ON "public"."customer_segments"("tenantId");

-- CreateIndex
CREATE INDEX "customer_segments_type_idx" ON "public"."customer_segments"("type");

-- CreateIndex
CREATE UNIQUE INDEX "customer_segments_tenantId_name_key" ON "public"."customer_segments"("tenantId", "name");

-- CreateIndex
CREATE INDEX "customer_segment_assignments_segmentId_idx" ON "public"."customer_segment_assignments"("segmentId");

-- CreateIndex
CREATE INDEX "customer_segment_assignments_tenantId_idx" ON "public"."customer_segment_assignments"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_segment_assignments_customerId_segmentId_key" ON "public"."customer_segment_assignments"("customerId", "segmentId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_analytics_customerId_key" ON "public"."customer_analytics"("customerId");

-- CreateIndex
CREATE INDEX "customer_analytics_tenantId_idx" ON "public"."customer_analytics"("tenantId");

-- CreateIndex
CREATE INDEX "customer_analytics_lifetimeValue_idx" ON "public"."customer_analytics"("lifetimeValue");

-- CreateIndex
CREATE INDEX "customer_analytics_totalVisits_idx" ON "public"."customer_analytics"("totalVisits");

-- AddForeignKey
ALTER TABLE "public"."customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customers" ADD CONSTRAINT "customers_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "public"."restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_preferences" ADD CONSTRAINT "customer_preferences_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."visit_history" ADD CONSTRAINT "visit_history_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loyalty_tiers" ADD CONSTRAINT "loyalty_tiers_programId_fkey" FOREIGN KEY ("programId") REFERENCES "public"."loyalty_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loyalty_points_transactions" ADD CONSTRAINT "loyalty_points_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rewards" ADD CONSTRAINT "rewards_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallets" ADD CONSTRAINT "wallets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."referrals" ADD CONSTRAINT "referrals_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "public"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_segment_assignments" ADD CONSTRAINT "customer_segment_assignments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_segment_assignments" ADD CONSTRAINT "customer_segment_assignments_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "public"."customer_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_analytics" ADD CONSTRAINT "customer_analytics_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
