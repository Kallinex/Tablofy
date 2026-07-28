import { Module } from '@nestjs/common';
import { RestaurantSettingsService } from './restaurant-settings.service';
import { RestaurantSettingsController } from './restaurant-settings.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [RestaurantSettingsController],
  providers: [RestaurantSettingsService],
  exports: [RestaurantSettingsService],
})
export class RestaurantSettingsModule {}
