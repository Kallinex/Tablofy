import { Controller, Get } from '@nestjs/common';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { LiveAnalyticsService } from './live-analytics.service';

@Controller('live-analytics')
export class LiveAnalyticsController {
  constructor(private readonly liveAnalyticsService: LiveAnalyticsService) {}

  @Get('kpi')
  async getLiveKpi(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getLiveKpi(user.tenantId!);
  }

  @Get('sales')
  async getSalesUpdate(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getSalesUpdate(user.tenantId!);
  }

  @Get('inventory-alerts')
  async getInventoryAlerts(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getInventoryAlerts(user.tenantId!);
  }

  @Get('kitchen-alerts')
  async getKitchenAlerts(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getKitchenAlerts(user.tenantId!);
  }

  @Get('customer-activity')
  async getCustomerActivity(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getCustomerActivity(user.tenantId!);
  }

  @Get('dashboard')
  async getDashboardRefresh(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getDashboardRefresh(user.tenantId!);
  }
}
