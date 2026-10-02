-- Enterprise single sign-on (SAML 2.0) support.
--
-- SAML connections do not use the OIDC issuer/client credentials, so those
-- columns become nullable and the connection stores the IdP metadata instead.
-- The IdP signing certificate is public information; the SP private key (when
-- used) is never persisted here.
--
-- All statements are additive or DROP NOT NULL, so existing OIDC rows and
-- tables are unaffected.

ALTER TABLE "sso_connections" ALTER COLUMN "issuerUrl" DROP NOT NULL;
ALTER TABLE "sso_connections" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "sso_connections" ALTER COLUMN "clientSecretEncrypted" DROP NOT NULL;

ALTER TABLE "sso_connections" ADD COLUMN "idpEntityId" TEXT;
ALTER TABLE "sso_connections" ADD COLUMN "idpSsoUrl" TEXT;
ALTER TABLE "sso_connections" ADD COLUMN "idpCertificate" TEXT;
ALTER TABLE "sso_connections" ADD COLUMN "spEntityId" TEXT;
