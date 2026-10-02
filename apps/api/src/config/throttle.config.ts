import { registerAs } from '@nestjs/config';

export interface ThrottleConfig {
  ttl: number;
  limit: number;
  planWindowSeconds: number;
  unauthenticatedLimit: number;
  planLimits: Record<string, number>;
  apiKeyEnabled: boolean;
  apiKeyLimit: number;
  apiKeyWindowSeconds: number;
}

export const DEFAULT_PLAN_RATE_LIMITS: Readonly<Record<string, number>> = {
  FREE: 30,
  BASIC: 60,
  STANDARD: 120,
  PREMIUM: 300,
  ENTERPRISE: 1000,
};

export const DEFAULT_PLAN_WINDOW_SECONDS = 60;
export const DEFAULT_UNAUTHENTICATED_LIMIT = 100;
export const DEFAULT_API_KEY_LIMIT = 600;
export const DEFAULT_API_KEY_WINDOW_SECONDS = 60;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const throttleConfig = registerAs(
  'throttle',
  (): ThrottleConfig => ({
    ttl: intEnv('THROTTLE_TTL', 60) * 1000,
    limit: intEnv('THROTTLE_LIMIT', 120),
    planWindowSeconds: intEnv('THROTTLE_PLAN_WINDOW_SECONDS', DEFAULT_PLAN_WINDOW_SECONDS),
    unauthenticatedLimit: intEnv('THROTTLE_UNAUTHENTICATED_LIMIT', DEFAULT_UNAUTHENTICATED_LIMIT),
    planLimits: {
      FREE: intEnv('THROTTLE_PLAN_FREE', DEFAULT_PLAN_RATE_LIMITS.FREE),
      BASIC: intEnv('THROTTLE_PLAN_BASIC', DEFAULT_PLAN_RATE_LIMITS.BASIC),
      STANDARD: intEnv('THROTTLE_PLAN_STANDARD', DEFAULT_PLAN_RATE_LIMITS.STANDARD),
      PREMIUM: intEnv('THROTTLE_PLAN_PREMIUM', DEFAULT_PLAN_RATE_LIMITS.PREMIUM),
      ENTERPRISE: intEnv('THROTTLE_PLAN_ENTERPRISE', DEFAULT_PLAN_RATE_LIMITS.ENTERPRISE),
    },
    apiKeyEnabled: process.env.THROTTLE_API_KEY_ENABLED !== 'false',
    apiKeyLimit: intEnv('THROTTLE_API_KEY_LIMIT', DEFAULT_API_KEY_LIMIT),
    apiKeyWindowSeconds: intEnv('THROTTLE_API_KEY_WINDOW_SECONDS', DEFAULT_API_KEY_WINDOW_SECONDS),
  }),
);
