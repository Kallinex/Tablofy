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

  @IsNumber()
  PORT!: number;

  @IsString()
  API_PREFIX!: string;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_HOST!: string;

  @IsNumber()
  REDIS_PORT!: number;

  @IsString()
  REDIS_URL!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters long' })
  JWT_SECRET!: string;

  @IsString()
  JWT_EXPIRATION!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters long' })
  JWT_REFRESH_SECRET!: string;

  @IsString()
  JWT_REFRESH_EXPIRATION!: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsString()
  CORS_CREDENTIALS?: string;

  @IsNumber()
  THROTTLE_TTL!: number;

  @IsNumber()
  THROTTLE_LIMIT!: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

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
}

export function validate(config: Record<string, unknown>) {
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

  return validatedConfig;
}
