import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { PrometheusMiddleware } from './prometheus.middleware';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, PrometheusMiddleware],
  exports: [MetricsService, PrometheusMiddleware],
})
export class MetricsModule {}
