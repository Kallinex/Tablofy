import 'reflect-metadata';
import paymentsConfig from './payments.config';

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key] as string;
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key] as string;
      }
    }
  }
}

describe('payments.config', () => {
  it('defaults to mock mode in non-production environments', () => {
    withEnv({ NODE_ENV: 'test', PAYMENTS_MODE: undefined }, () => {
      const config = paymentsConfig();
      expect(config.mode).toBe('mock');
    });
  });

  it('defaults to live mode in production and requires a gateway credential', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        PAYMENTS_MODE: undefined,
        STRIPE_SECRET_KEY: undefined,
        PAYMOB_API_KEY: undefined,
      },
      () => {
        expect(() => paymentsConfig()).toThrow(/PAYMENTS_MODE=live requires/);
      },
    );
  });

  it('accepts an explicit live mode with a live Stripe key', () => {
    withEnv({ NODE_ENV: 'test', PAYMENTS_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_123' }, () => {
      const config = paymentsConfig();
      expect(config.mode).toBe('live');
      expect(config.stripeSecretKey).toBe('sk_live_123');
    });
  });

  it('accepts live mode satisfied by a Paymob key alone', () => {
    withEnv(
      {
        NODE_ENV: 'test',
        PAYMENTS_MODE: 'live',
        STRIPE_SECRET_KEY: undefined,
        PAYMOB_API_KEY: 'paymob_test_123',
      },
      () => {
        expect(paymentsConfig().mode).toBe('live');
      },
    );
  });

  it('rejects live mode with a Stripe test key', () => {
    withEnv({ NODE_ENV: 'test', PAYMENTS_MODE: 'live', STRIPE_SECRET_KEY: 'sk_test_123' }, () => {
      expect(() => paymentsConfig()).toThrow(/forbids Stripe test keys/);
    });
  });

  it('accepts test mode with a Stripe test key', () => {
    withEnv({ NODE_ENV: 'test', PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_123' }, () => {
      const config = paymentsConfig();
      expect(config.mode).toBe('test');
      expect(config.stripeSecretKey).toBe('sk_test_123');
    });
  });

  it('rejects test mode without a Stripe test key', () => {
    withEnv({ NODE_ENV: 'test', PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: undefined }, () => {
      expect(() => paymentsConfig()).toThrow(/requires a Stripe TEST key/);
    });
  });

  it('rejects test mode with a Stripe live key', () => {
    withEnv({ NODE_ENV: 'test', PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_live_123' }, () => {
      expect(() => paymentsConfig()).toThrow(/requires a Stripe TEST key/);
    });
  });

  it('rejects mock mode in production', () => {
    withEnv(
      { NODE_ENV: 'production', PAYMENTS_MODE: 'mock', STRIPE_SECRET_KEY: 'sk_live_123' },
      () => {
        expect(() => paymentsConfig()).toThrow(/mock is forbidden in production/);
      },
    );
  });

  it('rejects test mode in production even with a test key', () => {
    withEnv(
      { NODE_ENV: 'production', PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_123' },
      () => {
        expect(() => paymentsConfig()).toThrow(/test is forbidden in production/);
      },
    );
  });

  it('rejects an unknown PAYMENTS_MODE value', () => {
    withEnv({ NODE_ENV: 'test', PAYMENTS_MODE: 'staging' }, () => {
      expect(() => paymentsConfig()).toThrow(/Invalid PAYMENTS_MODE/);
    });
  });

  it('accepts mock mode with any Stripe key in non-production (sandbox ignores keys)', () => {
    withEnv({ NODE_ENV: 'test', PAYMENTS_MODE: 'mock', STRIPE_SECRET_KEY: 'sk_test_123' }, () => {
      expect(paymentsConfig().mode).toBe('mock');
    });
  });
});
