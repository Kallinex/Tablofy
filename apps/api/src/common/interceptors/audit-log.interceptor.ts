import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request } from 'express';
import { CurrentUserData } from '../decorators/current-user.decorator';

interface AuditLogData {
  userId?: string;
  tenantId?: string;
  method: string;
  path: string;
  statusCode?: number;
  duration?: number;
  error?: string;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUserData | undefined;
    const startTime = Date.now();

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
        };

        if (duration > 1000) {
          this.logger.warn(`Slow request: ${JSON.stringify(logData)}`);
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
        };

        this.logger.error(`Request failed: ${JSON.stringify(logData)}`);
        throw error;
      }),
    );
  }
}
