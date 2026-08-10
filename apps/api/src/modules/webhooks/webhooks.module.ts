import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookProcessor } from './webhook-processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SsrfModule } from '../../common/ssrf/ssrf.module';

@Module({
  imports: [AuditLogsModule, SsrfModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDeliveryService, WebhookProcessor],
  exports: [WebhooksService, WebhookDeliveryService],
})
export class WebhooksModule {}
