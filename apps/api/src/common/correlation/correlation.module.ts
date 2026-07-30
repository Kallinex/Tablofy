import { Global, Module } from '@nestjs/common';
import { CorrelationService } from './correlation.service';
import { CorrelationMiddleware } from './correlation.middleware';

@Global()
@Module({
  providers: [CorrelationService, CorrelationMiddleware],
  exports: [CorrelationService, CorrelationMiddleware],
})
export class CorrelationModule {}
