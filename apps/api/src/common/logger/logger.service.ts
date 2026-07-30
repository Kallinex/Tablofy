/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { CorrelationService } from '../correlation/correlation.service';

@Injectable({ scope: Scope.TRANSIENT })
export class AppLoggerService implements LoggerService {
  private logger: winston.Logger;
  private context?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly correlationService: CorrelationService,
  ) {
    const level = this.configService.get('logging.level', 'info');
    const json = this.configService.get('logging.json', true);
    const dir = this.configService.get('logging.dir', 'logs');
    const maxFiles = this.configService.get('logging.maxFiles', '14d');
    const maxSize = this.configService.get('logging.maxSize', '100m');
    const consoleEnabled = this.configService.get('logging.console', true);

    const transports: winston.transport[] = [];

    if (consoleEnabled) {
      transports.push(
        new winston.transports.Console({
          format: json
            ? winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json(),
              )
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
                  return `${timestamp} [${level}] ${context ? '[' + context + '] ' : ''}${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
                }),
              ),
        }),
      );
    }

    transports.push(
      new winston.transports.DailyRotateFile({
        dirname: dir,
        filename: 'app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles,
        maxSize,
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
      new winston.transports.DailyRotateFile({
        dirname: dir,
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles,
        maxSize,
        level: 'error',
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
    );

    this.logger = winston.createLogger({
      level,
      transports,
    });
  }

  setContext(context: string) {
    this.context = context;
  }

  private getCorrelationMeta() {
    return {
      requestId: this.correlationService.requestId,
      correlationId: this.correlationService.correlationId,
      tenantId: this.correlationService.tenantId,
      userId: this.correlationService.userId,
    };
  }

  log(message: any, ...optionalParams: any[]) {
    const context = this.extractContext(optionalParams);
    this.logger.info(message, {
      context: context || this.context,
      ...this.getCorrelationMeta(),
      ...this.extractMeta(optionalParams),
    });
  }

  error(message: any, ...optionalParams: any[]) {
    const context = this.extractContext(optionalParams);
    const trace = optionalParams.find((p) => p instanceof Error);
    this.logger.error(message, {
      context: context || this.context,
      trace: trace?.stack,
      ...this.getCorrelationMeta(),
      ...this.extractMeta(optionalParams),
    });
  }

  warn(message: any, ...optionalParams: any[]) {
    const context = this.extractContext(optionalParams);
    this.logger.warn(message, {
      context: context || this.context,
      ...this.getCorrelationMeta(),
      ...this.extractMeta(optionalParams),
    });
  }

  debug(message: any, ...optionalParams: any[]) {
    const context = this.extractContext(optionalParams);
    this.logger.debug(message, {
      context: context || this.context,
      ...this.getCorrelationMeta(),
      ...this.extractMeta(optionalParams),
    });
  }

  verbose(message: any, ...optionalParams: any[]) {
    const context = this.extractContext(optionalParams);
    this.logger.verbose(message, {
      context: context || this.context,
      ...this.getCorrelationMeta(),
      ...this.extractMeta(optionalParams),
    });
  }

  fatal(message: any, ...optionalParams: any[]) {
    const context = this.extractContext(optionalParams);
    this.logger.error(`FATAL: ${message}`, {
      context: context || this.context,
      ...this.getCorrelationMeta(),
      ...this.extractMeta(optionalParams),
    });
  }

  child(meta: Record<string, unknown>): winston.Logger {
    return this.logger.child(meta);
  }

  private extractContext(params: any[]): string | undefined {
    if (params.length > 0 && typeof params[params.length - 1] === 'string') {
      return params.pop();
    }
    return undefined;
  }

  private readonly sensitiveKeys = new Set([
    'password',
    'token',
    'authorization',
    'secret',
    'apiKey',
    'api_key',
    'api-key',
    'twoFactorSecret',
    'two_factor_secret',
    'accessToken',
    'refreshToken',
    'jwt',
    'bearer',
  ]);

  private sanitize(obj: unknown, depth = 0): unknown {
    if (depth > 10 || obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitize(item, depth + 1));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (this.sensitiveKeys.has(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value, depth + 1);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private extractMeta(params: any[]): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    for (const p of params) {
      if (p && typeof p === 'object' && !(p instanceof Error)) {
        Object.assign(meta, p);
      }
    }
    return this.sanitize(meta, 0) as Record<string, unknown>;
  }
}
