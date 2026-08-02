-- CreateTable
CREATE TABLE "public"."webhook_registrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[],
    "secretHash" TEXT NOT NULL,
    "secretPrefix" TEXT NOT NULL,
    "encryptedSecret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "retryCount" INTEGER NOT NULL DEFAULT 3,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "lastDeliveredAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "statusCode" INTEGER,
    "responseBody" TEXT,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyLastChars" TEXT NOT NULL,
    "scopes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 60,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."gift_cards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "initialBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" "public"."Currency" NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "issueType" TEXT NOT NULL DEFAULT 'MANUAL',
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "message" TEXT,
    "expiresAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."gift_card_transactions" (
    "id" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "balanceBefore" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" "public"."Currency" NOT NULL DEFAULT 'USD',
    "referenceId" TEXT,
    "referenceType" TEXT,
    "description" TEXT,
    "performedById" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."consent_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "customerId" TEXT,
    "type" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "consentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cookie_preferences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "visitorId" TEXT,
    "necessary" BOOLEAN NOT NULL DEFAULT true,
    "functional" BOOLEAN NOT NULL DEFAULT true,
    "analytics" BOOLEAN NOT NULL DEFAULT false,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "thirdParty" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "preferencesSet" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cookie_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."data_export_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestType" TEXT NOT NULL DEFAULT 'FULL',
    "format" TEXT NOT NULL DEFAULT 'JSON',
    "filePath" TEXT,
    "fileSize" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."backup_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FULL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filePath" TEXT,
    "fileSize" INTEGER,
    "checksum" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "verificationStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."revoked_tokens" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revoked_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_registrations_tenantId_idx" ON "public"."webhook_registrations"("tenantId");

-- CreateIndex
CREATE INDEX "webhook_registrations_tenantId_isActive_idx" ON "public"."webhook_registrations"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_registrations_tenantId_name_key" ON "public"."webhook_registrations"("tenantId", "name");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookId_idx" ON "public"."webhook_deliveries"("webhookId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenantId_status_idx" ON "public"."webhook_deliveries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "webhook_deliveries_eventType_idx" ON "public"."webhook_deliveries"("eventType");

-- CreateIndex
CREATE INDEX "webhook_deliveries_nextRetryAt_idx" ON "public"."webhook_deliveries"("nextRetryAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextRetryAt_idx" ON "public"."webhook_deliveries"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_idx" ON "public"."api_keys"("tenantId");

-- CreateIndex
CREATE INDEX "api_keys_keyPrefix_idx" ON "public"."api_keys"("keyPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_tenantId_name_key" ON "public"."api_keys"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_code_key" ON "public"."gift_cards"("code");

-- CreateIndex
CREATE INDEX "gift_cards_tenantId_idx" ON "public"."gift_cards"("tenantId");

-- CreateIndex
CREATE INDEX "gift_cards_code_idx" ON "public"."gift_cards"("code");

-- CreateIndex
CREATE INDEX "gift_cards_status_idx" ON "public"."gift_cards"("status");

-- CreateIndex
CREATE INDEX "gift_cards_expiresAt_idx" ON "public"."gift_cards"("expiresAt");

-- CreateIndex
CREATE INDEX "gift_card_transactions_giftCardId_idx" ON "public"."gift_card_transactions"("giftCardId");

-- CreateIndex
CREATE INDEX "gift_card_transactions_tenantId_idx" ON "public"."gift_card_transactions"("tenantId");

-- CreateIndex
CREATE INDEX "gift_card_transactions_type_idx" ON "public"."gift_card_transactions"("type");

-- CreateIndex
CREATE INDEX "gift_card_transactions_createdAt_idx" ON "public"."gift_card_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "consent_records_tenantId_idx" ON "public"."consent_records"("tenantId");

-- CreateIndex
CREATE INDEX "consent_records_userId_idx" ON "public"."consent_records"("userId");

-- CreateIndex
CREATE INDEX "consent_records_customerId_idx" ON "public"."consent_records"("customerId");

-- CreateIndex
CREATE INDEX "consent_records_type_idx" ON "public"."consent_records"("type");

-- CreateIndex
CREATE INDEX "consent_records_consentDate_idx" ON "public"."consent_records"("consentDate");

-- CreateIndex
CREATE INDEX "cookie_preferences_tenantId_idx" ON "public"."cookie_preferences"("tenantId");

-- CreateIndex
CREATE INDEX "cookie_preferences_userId_idx" ON "public"."cookie_preferences"("userId");

-- CreateIndex
CREATE INDEX "cookie_preferences_visitorId_idx" ON "public"."cookie_preferences"("visitorId");

-- CreateIndex
CREATE INDEX "data_export_requests_tenantId_idx" ON "public"."data_export_requests"("tenantId");

-- CreateIndex
CREATE INDEX "data_export_requests_userId_idx" ON "public"."data_export_requests"("userId");

-- CreateIndex
CREATE INDEX "data_export_requests_status_idx" ON "public"."data_export_requests"("status");

-- CreateIndex
CREATE INDEX "backup_records_tenantId_idx" ON "public"."backup_records"("tenantId");

-- CreateIndex
CREATE INDEX "backup_records_status_idx" ON "public"."backup_records"("status");

-- CreateIndex
CREATE INDEX "backup_records_createdAt_idx" ON "public"."backup_records"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "revoked_tokens_jti_key" ON "public"."revoked_tokens"("jti");

-- CreateIndex
CREATE INDEX "revoked_tokens_jti_idx" ON "public"."revoked_tokens"("jti");

-- CreateIndex
CREATE INDEX "revoked_tokens_expiresAt_idx" ON "public"."revoked_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."webhook_registrations" ADD CONSTRAINT "webhook_registrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "public"."webhook_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."gift_cards" ADD CONSTRAINT "gift_cards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."gift_cards" ADD CONSTRAINT "gift_cards_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "public"."gift_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consent_records" ADD CONSTRAINT "consent_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cookie_preferences" ADD CONSTRAINT "cookie_preferences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."data_export_requests" ADD CONSTRAINT "data_export_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."data_export_requests" ADD CONSTRAINT "data_export_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."backup_records" ADD CONSTRAINT "backup_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

