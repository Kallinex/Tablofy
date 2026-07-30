import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MonitoringService } from './monitoring.service';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class PerformanceMonitorInterceptor implements NestInterceptor {
  constructor(
    private readonly monitoring: MonitoringService,
    private readonly metrics: MetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          this.monitoring.checkSlowRequest(method, url, duration);

          const bodySize = body ? JSON.stringify(body).length : 0;
          this.monitoring.checkLargePayload(method, url, bodySize);
        },
        error: () => {
          const duration = Date.now() - start;
          this.monitoring.checkSlowRequest(method, url, duration);
        },
      }),
    );
  }
}
