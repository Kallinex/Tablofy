import { registerAs } from '@nestjs/config';

export interface LoggingConfig {
  level: string;
  json: boolean;
  dir: string;
  maxFiles: string;
  maxSize: string;
  console: boolean;
}

export default registerAs(
  'logging',
  (): LoggingConfig => ({
    level: process.env.LOG_LEVEL || 'info',
    json: process.env.LOG_JSON !== 'false',
    dir: process.env.LOG_DIR || 'logs',
    maxFiles: process.env.LOG_MAX_FILES || '14d',
    maxSize: process.env.LOG_MAX_SIZE || '100m',
    console: process.env.LOG_CONSOLE !== 'false',
  }),
);
