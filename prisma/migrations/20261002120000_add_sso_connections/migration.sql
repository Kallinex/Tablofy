-- Enterprise single sign-on (OIDC) configuration, one connection per tenant.
--
-- The IdP client secret must never be stored in plaintext, so it is written to
-- "clientSecretEncrypted" (AES-256-GCM, key from SSO_ENCRYPTION_KEY or
-- WEBHOOK_ENCRYPTION_KEY). The unique (tenantId) keeps the login flow
-- unambiguous: a user's email domain maps to at most one tenant IdP.
--
-- Additive migration only (new table), cannot lock or rewrite existing tables.

-- CreateTable
CREATE TABLE "sso_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OIDC',
    "issuerUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'openid email profile',
    "allowedEmailDomains" JSONB,
    "autoProvision" BOOLEAN NOT NULL DEFAULT true,
    "defaultRole" "UserRole" NOT NULL DEFAULT 'STAFF',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdBy" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sso_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_connections_tenantId_key" ON "sso_connections"("tenantId");

-- CreateIndex
CREATE INDEX "sso_connections_enabled_idx" ON "sso_connections"("enabled");

-- AddForeignKey
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
