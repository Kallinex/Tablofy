import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeProvider } from './providers/stripe.provider';
import { PaymobProvider } from './providers/paymob.provider';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeProvider, PaymobProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
