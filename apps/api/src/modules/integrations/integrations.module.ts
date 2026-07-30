import { Global, Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

@Global()
@Module({
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
