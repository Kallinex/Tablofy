import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request } from 'express';
import { CurrentUserData } from '../decorators/current-user.decorator';
import { AppLoggerService } from '../logger/logger.service';
import { AuditLogsService, AuditLogEntry } from '../../modules/audit-logs/audit-logs.service';

interface AuditLogData {
  userId?: string;
  tenantId?: string;
  method: string;
  path: string;
  statusCode?: number;
  duration?: number;
  error?: string;
  requestId?: string;
  correlationId?: string;
  ip?: string;
  userAgent?: string;
  browser?: string;
  device?: string;
}

function parseUserAgent(ua: string): { browser: string; device: string } {
  const lower = ua.toLowerCase();
  let browser = 'unknown';
  let device = 'desktop';

  if (lower.includes('firefox')) browser = 'Firefox';
  else if (lower.includes('edg')) browser = 'Edge';
  else if (lower.includes('chrome')) browser = 'Chrome';
  else if (lower.includes('safari')) browser = 'Safari';
  else if (lower.includes('curl')) browser = 'curl';

  if (lower.includes('mobile') || lower.includes('android') || lower.includes('iphone')) {
    device = 'mobile';
  } else if (lower.includes('tablet') || lower.includes('ipad')) {
    device = 'tablet';
  }

  return { browser, device };
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly auditLogsService: AuditLogsService,
  ) {
    this.logger.setContext('AuditLog');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUserData | undefined;
    const startTime = Date.now();
    const userAgent = request.headers['user-agent'] || '';
    const { browser, device } = parseUserAgent(userAgent);

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        const response = context.switchToHttp().getResponse();
        const logData: AuditLogData = {
          userId: user?.id,
          tenantId: user?.tenantId ?? undefined,
          method: request.method,
          path: request.url,
          statusCode: response.statusCode,
          duration,
          requestId: (request.headers['x-request-id'] as string) || undefined,
          correlationId: (request.headers['x-correlation-id'] as string) || undefined,
          ip: request.ip,
          userAgent,
          browser,
          device,
        };

        if (duration > 1000) {
          this.logger.warn('Slow request', logData);
        }

        if (request.method !== 'GET') {
          const entry: AuditLogEntry = {
            action: `${request.method} ${request.route?.path || request.url}`,
            resource: request.route?.path || request.url,
            userId: user?.id,
            tenantId: user?.tenantId ?? undefined,
            ipAddress: request.ip,
            userAgent,
            requestId: logData.requestId,
            correlationId: logData.correlationId,
            executionDuration: duration,
            browser,
            device,
          };
          this.auditLogsService.log(entry).catch(() => undefined);
        }
      }),
      catchError((error: unknown) => {
        const duration = Date.now() - startTime;
        const response = context.switchToHttp().getResponse();
        const logData: AuditLogData = {
          userId: user?.id,
          tenantId: user?.tenantId ?? undefined,
          method: request.method,
          path: request.url,
          statusCode: response.statusCode,
          duration,
          error: error instanceof Error ? error.message : String(error),
          requestId: (request.headers['x-request-id'] as string) || undefined,
          correlationId: (request.headers['x-correlation-id'] as string) || undefined,
          ip: request.ip,
          userAgent,
          browser,
          device,
        };

        this.logger.error('Request failed', logData);

        const entry: AuditLogEntry = {
          action: `${request.method} ${request.route?.path || request.url}`,
          resource: request.route?.path || request.url,
          userId: user?.id,
          tenantId: user?.tenantId ?? undefined,
          ipAddress: request.ip,
          userAgent,
          requestId: logData.requestId,
          correlationId: logData.correlationId,
          executionDuration: duration,
          browser,
          device,
        };
        this.auditLogsService.log(entry).catch(() => undefined);

        throw error;
      }),
    );
  }
}
