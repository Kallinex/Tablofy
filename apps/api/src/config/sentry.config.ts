import { registerAs } from '@nestjs/config';

export interface SentryConfig {
  dsn: string;
  enabled: boolean;
  environment: string;
  tracesSampleRate: number;
  profilesSampleRate: number;
}

export default registerAs(
  'sentry',
  (): SentryConfig => ({
    dsn: process.env.SENTRY_DSN || '',
    enabled: process.env.SENTRY_ENABLED === 'true' && !!process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.1'),
  }),
);
