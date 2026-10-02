import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsString, IsOptional, MinLength, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Testing = 'testing',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV!: Environment;

  @IsOptional()
  @IsNumber()
  PORT!: number;

  @IsOptional()
  @IsString()
  API_PREFIX!: string;

  @IsString()
  DATABASE_URL!: string;

  @IsOptional()
  @IsString()
  REDIS_HOST!: string;

  @IsOptional()
  @IsNumber()
  REDIS_PORT!: number;

  // Optional: redis.config.ts falls back to redis://localhost:6379 and derives
  // host/port/password from this URL when present.
  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters long' })
  JWT_SECRET!: string;

  // Optional: jwt.config.ts defaults to 15m.
  @IsOptional()
  @IsString()
  JWT_EXPIRATION?: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters long' })
  JWT_REFRESH_SECRET!: string;

  // Optional: jwt.config.ts defaults to 7d.
  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRATION?: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsString()
  CORS_CREDENTIALS?: string;

  // Optional: throttle.config.ts defaults to a 60s window and 120 requests.
  @IsOptional()
  @IsNumber()
  THROTTLE_TTL?: number;

  @IsOptional()
  @IsNumber()
  THROTTLE_LIMIT?: number;

  @IsOptional()
  @IsNumber()
  THROTTLE_PLAN_WINDOW_SECONDS?: number;

  @IsOptional()
  @IsNumber()
  THROTTLE_UNAUTHENTICATED_LIMIT?: number;

  @IsOptional()
  @IsNumber()
  THROTTLE_PLAN_FREE?: number;

  @IsOptional()
  @IsNumber()
  THROTTLE_PLAN_BASIC?: number;

  @IsOptional()
  @IsNumber()
  THROTTLE_PLAN_STANDARD?: number;

  @IsOptional()
  @IsNumber()
  THROTTLE_PLAN_PREMIUM?: number;

  @IsOptional()
  @IsNumber()
  THROTTLE_PLAN_ENTERPRISE?: number;

  @IsOptional()
  @IsString()
  THROTTLE_API_KEY_ENABLED?: string;

  @IsOptional()
  @IsNumber()
  THROTTLE_API_KEY_LIMIT?: number;

  @IsOptional()
  @IsNumber()
  THROTTLE_API_KEY_WINDOW_SECONDS?: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  // Redis HA topology. REDIS_MODE is optional and auto-detected from the values
  // below; set it explicitly to override detection.
  @IsOptional()
  @IsString()
  REDIS_MODE?: string;

  @IsOptional()
  @IsString()
  REDIS_USERNAME?: string;

  @IsOptional()
  @IsNumber()
  REDIS_DB?: number;

  @IsOptional()
  @IsNumber()
  REDIS_CONNECT_TIMEOUT?: number;

  // Sentinel: comma-separated "host:port" sentinels plus the master set name.
  @IsOptional()
  @IsString()
  REDIS_SENTINEL_HOSTS?: string;

  @IsOptional()
  @IsString()
  REDIS_SENTINEL_MASTER?: string;

  @IsOptional()
  @IsString()
  REDIS_SENTINEL_PASSWORD?: string;

  @IsOptional()
  @IsString()
  REDIS_SENTINEL_ROLE?: string;

  // Cluster: comma-separated startup nodes; the rest is discovered from the cluster.
  @IsOptional()
  @IsString()
  REDIS_CLUSTER_NODES?: string;

  @IsOptional()
  @IsString()
  REDIS_CLUSTER_NODES_RAW?: string;

  @IsOptional()
  @IsString()
  REDIS_CLUSTER_SCALE_READS?: string;

  @IsOptional()
  @IsString()
  REDIS_TLS?: string;

  @IsOptional()
  @IsNumber()
  CLEANUP_SESSION_RETENTION_DAYS?: number;

  @IsOptional()
  @IsNumber()
  CLEANUP_TOKEN_RETENTION_DAYS?: number;

  @IsOptional()
  @IsNumber()
  AUDIT_LOG_RETENTION_DAYS?: number;

  @IsOptional()
  @IsNumber()
  REPORT_EXPORT_RETENTION_DAYS?: number;

  @IsOptional()
  @IsNumber()
  SHUTDOWN_TIMEOUT_MS?: number;

  @IsOptional()
  @IsString()
  TRUST_PROXY?: string;

  @IsOptional()
  @IsNumber()
  HEALTH_MEMORY_RSS_LIMIT_MB?: number;

  @IsOptional()
  @IsString()
  SWAGGER_ENABLED?: string;

  @IsOptional()
  @IsString()
  SWAGGER_AUTH_USER?: string;

  @IsOptional()
  @IsString()
  SWAGGER_AUTH_PASSWORD?: string;

  @IsOptional()
  @IsString()
  COMPRESSION_ENABLED?: string;

  @IsOptional()
  @IsNumber()
  COMPRESSION_THRESHOLD_BYTES?: number;

  @IsOptional()
  @IsString()
  HEALTH_DISK_PATH?: string;

  @IsOptional()
  @IsNumber()
  HEALTH_DISK_THRESHOLD_MB?: number;

  @IsOptional()
  @IsNumber()
  QUEUE_DLQ_ALERT_THRESHOLD?: number;

  @IsOptional()
  @IsString()
  EXPORT_DIR?: string;

  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  @IsOptional()
  @IsString()
  SENTRY_ENABLED?: string;

  @IsOptional()
  @IsNumber()
  SENTRY_TRACES_SAMPLE_RATE?: number;

  @IsOptional()
  @IsNumber()
  SENTRY_PROFILES_SAMPLE_RATE?: number;

  @IsOptional()
  @IsString()
  METRICS_ENABLED?: string;

  @IsOptional()
  @IsString()
  METRICS_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  METRICS_AUTH_TOKEN?: string;

  @IsOptional()
  @IsString()
  METRICS_COLLECT_DEFAULT?: string;

  @IsOptional()
  @IsNumber()
  METRICS_COLLECT_INTERVAL_MS?: number;

  @IsOptional()
  @IsEnum(['mock', 'test', 'live'])
  PAYMENTS_MODE?: string;

  // Always required, not just in production: webhook.config.ts refuses to boot
  // without it in every environment, so validating it only under production left
  // development and staging to die inside the DI container with a stack trace
  // instead of a clear, actionable message.
  @IsString()
  @MinLength(32, { message: 'WEBHOOK_ENCRYPTION_KEY must be at least 32 characters long' })
  WEBHOOK_ENCRYPTION_KEY!: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsNumber()
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;

  @IsOptional()
  @IsString()
  STRIPE_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  STRIPE_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  STRIPE_API_BASE?: string;

  @IsOptional()
  @IsString()
  PAYMOB_API_KEY?: string;

  @IsOptional()
  @IsNumber()
  PAYMOB_INTEGRATION_ID?: number;

  @IsOptional()
  @IsString()
  PAYMOB_API_BASE?: string;

  @IsOptional()
  @IsString()
  PAYMOB_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  SSO_ENABLED?: string;

  @IsOptional()
  @IsString()
  SSO_ENCRYPTION_KEY?: string;

  @IsOptional()
  @IsString()
  SSO_CALLBACK_BASE_URL?: string;

  @IsOptional()
  @IsString()
  SSO_SUCCESS_REDIRECT_URL?: string;

  @IsOptional()
  @IsString()
  SSO_FAILURE_REDIRECT_URL?: string;

  @IsOptional()
  @IsNumber()
  SSO_STATE_TTL_SECONDS?: number;

  @IsOptional()
  @IsNumber()
  SSO_EXCHANGE_CODE_TTL_SECONDS?: number;

  @IsOptional()
  @IsString()
  UPLOAD_DIR?: string;

  @IsOptional()
  @IsString()
  UPLOAD_PUBLIC_BASE_URL?: string;

  @IsOptional()
  @IsNumber()
  UPLOAD_MAX_IMAGE_SIZE_BYTES?: number;

  @IsOptional()
  @IsString()
  SMS_PROVIDER_URL?: string;

  @IsOptional()
  @IsString()
  SMS_API_KEY?: string;

  @IsOptional()
  @IsNumber()
  HEALTH_DEPENDENCY_TIMEOUT_MS?: number;

  // OpenTelemetry (all optional: tracing is opt-in and disabled by default).
  @IsOptional()
  @IsString()
  OTEL_ENABLED?: string;

  @IsOptional()
  @IsString()
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  OTEL_SERVICE_NAME?: string;

  @IsOptional()
  @IsString()
  OTEL_TRACES_ENABLED?: string;

  @IsOptional()
  @IsString()
  OTEL_METRICS_ENABLED?: string;

  @IsOptional()
  @IsString()
  OTEL_TRACES_SAMPLER_ARG?: string;

  @IsOptional()
  @IsString()
  OTEL_EXPORTER_OTLP_TIMEOUT?: string;

  @IsOptional()
  @IsString()
  OTEL_EXPORTER_OTLP_PROTOCOL?: string;

  @IsOptional()
  @IsString()
  OTEL_METRIC_EXPORT_INTERVAL?: string;
}

export function validate(config: Record<string, unknown>) {
  // Environment variables always arrive as strings, so this DTO genuinely
  // needs coercion (PORT=3000 must become a number to satisfy @IsNumber()).
  // The global HTTP ValidationPipe does NOT use implicit conversion because it
  // inverts boolean query parameters; see main.ts and
  // common/transform/boolean.transform.ts. This DTO declares no boolean or
  // Date fields, which are the types implicit conversion coerces incorrectly.
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors.toString();
    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  if (
    validatedConfig.NODE_ENV === Environment.Production &&
    (validatedConfig.JWT_SECRET.includes('change-this') ||
      validatedConfig.JWT_REFRESH_SECRET.includes('change-this'))
  ) {
    throw new Error(
      'Production environment requires strong JWT secrets. Remove "change-this" from your JWT secrets.',
    );
  }

  if (validatedConfig.NODE_ENV === Environment.Production && validatedConfig.CORS_ORIGINS === '*') {
    throw new Error(
      'Wildcard CORS origin (*) is not allowed in production. Specify explicit origins.',
    );
  }

  const metricsEnabled = validatedConfig.METRICS_ENABLED !== 'false';
  if (
    validatedConfig.NODE_ENV === Environment.Production &&
    metricsEnabled &&
    (!validatedConfig.METRICS_AUTH_TOKEN || validatedConfig.METRICS_AUTH_TOKEN.length < 16)
  ) {
    throw new Error(
      'Production environment requires METRICS_AUTH_TOKEN (min 16 characters) to secure the /metrics endpoint.',
    );
  }

  if (
    validatedConfig.NODE_ENV === Environment.Production &&
    (!validatedConfig.REDIS_PASSWORD || validatedConfig.REDIS_PASSWORD.length < 16)
  ) {
    throw new Error(
      'Production environment requires REDIS_PASSWORD (min 16 characters) to secure Redis.',
    );
  }

  return validatedConfig;
}
