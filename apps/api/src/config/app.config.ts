import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api',
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:4200', 'http://localhost:3000'],
  corsCredentials: process.env.CORS_CREDENTIALS !== 'false',
  shutdownTimeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '15000', 10),
  trustProxy: process.env.TRUST_PROXY || '',
  healthMemoryRssLimitMb: parseInt(process.env.HEALTH_MEMORY_RSS_LIMIT_MB || '300', 10),
  swaggerEnabled: process.env.SWAGGER_ENABLED || '',
  swaggerAuthUser: process.env.SWAGGER_AUTH_USER || '',
  swaggerAuthPassword: process.env.SWAGGER_AUTH_PASSWORD || '',
  compressionEnabled: process.env.COMPRESSION_ENABLED !== 'false',
  compressionThreshold: parseInt(process.env.COMPRESSION_THRESHOLD_BYTES || '1024', 10),
}));
