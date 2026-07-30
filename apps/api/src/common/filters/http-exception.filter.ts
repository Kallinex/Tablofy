import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLoggerService } from '../logger/logger.service';
import { CorrelationService } from '../correlation/correlation.service';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';

interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  correlationId: string;
  requestId?: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly correlationService: CorrelationService,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext('HttpException');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId =
      this.correlationService.correlationId ||
      (request.headers['x-correlation-id'] as string) ||
      'unknown';
    const requestId =
      this.correlationService.requestId || (request.headers['x-request-id'] as string) || 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();

      if (typeof exResponse === 'string') {
        message = exResponse;
        error = exception.name;
      } else if (typeof exResponse === 'object' && exResponse !== null) {
        const responseObj = exResponse as Record<string, unknown>;
        message = (responseObj.message as string | string[]) ?? message;
        error = (responseObj.error as string) ?? exception.name;
      }
    }

    const errorResponse: ErrorResponse = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId,
      requestId,
    };

    if (status >= 500) {
      this.logger.error(`[${correlationId}] ${request.method} ${request.url}`, {
        statusCode: status,
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      this.logger.warn(`[${correlationId}] ${request.method} ${request.url} - ${status}`, {
        statusCode: status,
        message,
      });
    }

    if (status >= 500 && this.configService.get<boolean>('sentry.enabled', false)) {
      Sentry.withScope((scope) => {
        scope.setExtra('requestId', requestId);
        scope.setExtra('correlationId', correlationId);
        scope.setTag('method', request.method);
        scope.setTag('url', request.url);
        const req = request as Request & { tenantId?: string };
        if (req.tenantId) {
          scope.setTag('tenant_id', req.tenantId);
        }
        if (exception instanceof Error) {
          Sentry.captureException(exception);
        }
      });
    }

    response.setHeader('X-Correlation-Id', correlationId);
    response.setHeader('X-Request-ID', requestId);
    response.status(status).json(errorResponse);
  }
}
