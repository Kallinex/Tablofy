import { registerAs } from '@nestjs/config';

export interface WebhookConfig {
  maxRetries: number;
  initialBackoffMs: number;
  backoffFactor: number;
  maxBackoffMs: number;
  deliveryTimeoutMs: number;
  maxRegistrationsPerTenant: number;
  secretRotationDays: number;
  encryptionKey: string;
  encryptionAlgorithm: string;
}

export default registerAs(
  'webhook',
  (): WebhookConfig => ({
    maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || '5', 10),
    initialBackoffMs: parseInt(process.env.WEBHOOK_INITIAL_BACKOFF_MS || '1000', 10),
    backoffFactor: parseFloat(process.env.WEBHOOK_BACKOFF_FACTOR || '2'),
    maxBackoffMs: parseInt(process.env.WEBHOOK_MAX_BACKOFF_MS || '3600000', 10),
    deliveryTimeoutMs: parseInt(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS || '30000', 10),
    maxRegistrationsPerTenant: parseInt(
      process.env.WEBHOOK_MAX_REGISTRATIONS_PER_TENANT || '50',
      10,
    ),
    secretRotationDays: parseInt(process.env.WEBHOOK_SECRET_ROTATION_DAYS || '90', 10),
    encryptionKey: process.env.WEBHOOK_ENCRYPTION_KEY || '',
    encryptionAlgorithm: 'aes-256-gcm',
  }),
);
