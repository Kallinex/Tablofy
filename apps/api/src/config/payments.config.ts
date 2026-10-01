import { registerAs } from '@nestjs/config';

export type PaymentsMode = 'mock' | 'test' | 'live';

export interface PaymentsConfig {
  mode: PaymentsMode;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripeApiBase: string;
  paymobApiBase: string;
  paymobApiKey: string;
  paymobIntegrationId: number;
  paymobWebhookSecret: string;
}

export const DEFAULT_STRIPE_API_BASE = 'https://api.stripe.com';
export const DEFAULT_PAYMOB_API_BASE = 'https://accept.paymob.com/api';

export default registerAs('payments', (): PaymentsConfig => {
  const explicitMode = (process.env.PAYMENTS_MODE || '').toLowerCase();
  if (
    explicitMode !== '' &&
    explicitMode !== 'mock' &&
    explicitMode !== 'test' &&
    explicitMode !== 'live'
  ) {
    throw new Error(
      `Invalid PAYMENTS_MODE "${explicitMode}". Use "mock" (sandbox, dev/test only), "test" (Stripe test keys), or "live".`,
    );
  }

  const mode: PaymentsMode =
    explicitMode !== ''
      ? (explicitMode as PaymentsMode)
      : process.env.NODE_ENV === 'production'
        ? 'live'
        : 'mock';

  if (process.env.NODE_ENV === 'production' && mode === 'mock') {
    throw new Error(
      'PAYMENTS_MODE=mock is forbidden in production. Set PAYMENTS_MODE=live and provide real gateway credentials (STRIPE_SECRET_KEY / PAYMOB_API_KEY) before deploying.',
    );
  }

  if (process.env.NODE_ENV === 'production' && mode === 'test') {
    throw new Error(
      'PAYMENTS_MODE=test is forbidden in production (Stripe test keys must never be used in a production environment). Set PAYMENTS_MODE=live and provide real gateway credentials before deploying.',
    );
  }

  if (mode === 'live') {
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    const paymobKey = process.env.PAYMOB_API_KEY || '';

    if (!stripeKey && !paymobKey) {
      throw new Error(
        'PAYMENTS_MODE=live requires at least one gateway credential: STRIPE_SECRET_KEY or PAYMOB_API_KEY.',
      );
    }

    if (stripeKey) {
      if (stripeKey.startsWith('sk_test')) {
        throw new Error(
          'PAYMENTS_MODE=live forbids Stripe test keys (sk_test_*). Use a live secret key.',
        );
      }
      if (!stripeKey.startsWith('sk_live')) {
        throw new Error(
          'PAYMENTS_MODE=live requires a Stripe live secret key (STRIPE_SECRET_KEY must start with "sk_live").',
        );
      }
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        throw new Error(
          'PAYMENTS_MODE=live with Stripe requires STRIPE_WEBHOOK_SECRET so webhook signatures can be verified.',
        );
      }
    }

    if (paymobKey) {
      const integrationId = parseInt(process.env.PAYMOB_INTEGRATION_ID || '0', 10);
      if (!Number.isFinite(integrationId) || integrationId <= 0) {
        throw new Error(
          'PAYMENTS_MODE=live with Paymob requires PAYMOB_INTEGRATION_ID (a positive integer).',
        );
      }
      if (!process.env.PAYMOB_WEBHOOK_SECRET) {
        throw new Error(
          'PAYMENTS_MODE=live with Paymob requires PAYMOB_WEBHOOK_SECRET so webhook signatures can be verified.',
        );
      }
    }
  }

  if (mode === 'test') {
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    if (!stripeKey.startsWith('sk_test')) {
      throw new Error(
        'PAYMENTS_MODE=test requires a Stripe TEST key (STRIPE_SECRET_KEY must start with "sk_test").',
      );
    }
  }

  return {
    mode,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    stripeApiBase: process.env.STRIPE_API_BASE || DEFAULT_STRIPE_API_BASE,
    paymobApiBase: process.env.PAYMOB_API_BASE || DEFAULT_PAYMOB_API_BASE,
    paymobApiKey: process.env.PAYMOB_API_KEY || '',
    paymobIntegrationId: parseInt(process.env.PAYMOB_INTEGRATION_ID || '0', 10),
    paymobWebhookSecret: process.env.PAYMOB_WEBHOOK_SECRET || '',
  };
});
