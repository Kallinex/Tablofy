import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as Sentry from '@sentry/node';

@Catch()
export class SentryFilter implements ExceptionFilter {
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.enabled = configService.get<boolean>('sentry.enabled', false);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    if (!this.enabled) {
      return;
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException && exception.getStatus() < 500) {
      return;
    }

    Sentry.withScope((scope) => {
      scope.setExtra('requestId', request.headers['x-request-id'] || 'unknown');
      scope.setExtra('correlationId', request.headers['x-correlation-id'] || 'unknown');
      scope.setTag('method', request.method);
      scope.setTag('url', request.url);
      const req = request as Request & { tenantId?: string; user?: { sub?: string } };
      if (req.tenantId) {
        scope.setTag('tenant_id', req.tenantId);
      }
      if (req.user?.sub) {
        scope.setUser({ id: req.user.sub });
      }

      if (exception instanceof Error) {
        Sentry.captureException(exception);
      } else {
        Sentry.captureException(new Error(String(exception)));
      }
    });
  }
}
