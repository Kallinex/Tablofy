import { registerAs } from '@nestjs/config';

export interface SsoConfig {
  enabled: boolean;
  encryptionKey: string;
  stateTtlSeconds: number;
  exchangeCodeTtlSeconds: number;
  callbackBaseUrl: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
}

export default registerAs('sso', (): SsoConfig => {
  const enabled = process.env.SSO_ENABLED === 'true';
  const encryptionKey = process.env.SSO_ENCRYPTION_KEY || process.env.WEBHOOK_ENCRYPTION_KEY || '';

  if (enabled && (!encryptionKey || encryptionKey.length < 32)) {
    throw new Error(
      'SSO_ENABLED requires SSO_ENCRYPTION_KEY (or WEBHOOK_ENCRYPTION_KEY) of at least 32 characters. Without a strong key, every tenant IdP client secret stored in the database can be decrypted. Refusing to boot.',
    );
  }

  const callbackBaseUrl = process.env.SSO_CALLBACK_BASE_URL || '';
  const successRedirectUrl = process.env.SSO_SUCCESS_REDIRECT_URL || process.env.FRONTEND_URL || '';
  const failureRedirectUrl = process.env.SSO_FAILURE_REDIRECT_URL || successRedirectUrl;

  if (enabled && (!callbackBaseUrl || !successRedirectUrl)) {
    throw new Error(
      'SSO_ENABLED requires SSO_CALLBACK_BASE_URL and SSO_SUCCESS_REDIRECT_URL (or FRONTEND_URL) so the OIDC redirect flow can complete. Refusing to boot.',
    );
  }

  return {
    enabled,
    encryptionKey,
    stateTtlSeconds: parseInt(process.env.SSO_STATE_TTL_SECONDS || '600', 10),
    exchangeCodeTtlSeconds: parseInt(process.env.SSO_EXCHANGE_CODE_TTL_SECONDS || '60', 10),
    callbackBaseUrl,
    successRedirectUrl,
    failureRedirectUrl,
  };
});
