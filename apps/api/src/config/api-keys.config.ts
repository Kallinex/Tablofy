import { registerAs } from '@nestjs/config';

export interface ApiKeysConfig {
  keyPrefix: string;
  keyLength: number;
  maxKeysPerTenant: number;
  rateLimitPerMin: number;
}

export default registerAs(
  'apiKeys',
  (): ApiKeysConfig => ({
    keyPrefix: process.env.API_KEY_PREFIX || 'tab_',
    keyLength: parseInt(process.env.API_KEY_LENGTH || '48', 10),
    maxKeysPerTenant: parseInt(process.env.API_KEY_MAX_KEYS_PER_TENANT || '20', 10),
    rateLimitPerMin: parseInt(process.env.API_KEY_RATE_LIMIT_PER_MIN || '60', 10),
  }),
);
