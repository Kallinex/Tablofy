import { Module } from '@nestjs/common';
import { TaxRatesService } from './tax-rates.service';
import { TaxRatesController } from './tax-rates.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [TaxRatesController],
  providers: [TaxRatesService],
  exports: [TaxRatesService],
})
export class TaxRatesModule {}
