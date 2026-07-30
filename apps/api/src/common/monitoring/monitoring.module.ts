import { Global, Module } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { PerformanceMonitorInterceptor } from './performance-monitor.interceptor';

@Global()
@Module({
  providers: [MonitoringService, PerformanceMonitorInterceptor],
  exports: [MonitoringService, PerformanceMonitorInterceptor],
})
export class MonitoringModule {}
