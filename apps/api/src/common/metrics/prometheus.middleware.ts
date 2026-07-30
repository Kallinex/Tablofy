import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class PrometheusMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const { method } = req;
    const route = req.route?.path || req.originalUrl || req.url;

    res.on('finish', () => {
      const duration = Date.now() - start;
      this.metrics.observeHttpDuration(method, route, res.statusCode, duration);
    });

    next();
  }
}
