import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AppLoggerService } from './logger.service';

@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext('HTTP');
  }

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = req.headers['user-agent'] || '';

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;
      const contentLength = res.getHeader('content-length') || 0;

      const logMeta: Record<string, unknown> = {
        method,
        url: originalUrl,
        statusCode,
        duration,
        contentLength,
        userAgent,
        ip,
      };

      if (statusCode >= 500) {
        this.logger.error(`${method} ${originalUrl} ${statusCode} ${duration}ms`, logMeta);
      } else if (duration > 500) {
        this.logger.warn(`SLOW ${method} ${originalUrl} ${statusCode} ${duration}ms`, logMeta);
      } else {
        this.logger.log(`${method} ${originalUrl} ${statusCode} ${duration}ms`, logMeta);
      }
    });

    next();
  }
}
