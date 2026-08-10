import { Controller, Get } from '@nestjs/common';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { LiveAnalyticsService } from './live-analytics.service';

@Controller('live-analytics')
export class LiveAnalyticsController {
  constructor(private readonly liveAnalyticsService: LiveAnalyticsService) {}

  @Permissions('analytics:read')
  @Get('kpi')
  async getLiveKpi(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getLiveKpi(user.tenantId!);
  }

  @Permissions('analytics:read')
  @Get('sales')
  async getSalesUpdate(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getSalesUpdate(user.tenantId!);
  }

  @Permissions('analytics:read')
  @Get('inventory-alerts')
  async getInventoryAlerts(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getInventoryAlerts(user.tenantId!);
  }

  @Permissions('analytics:read')
  @Get('kitchen-alerts')
  async getKitchenAlerts(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getKitchenAlerts(user.tenantId!);
  }

  @Permissions('analytics:read')
  @Get('customer-activity')
  async getCustomerActivity(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getCustomerActivity(user.tenantId!);
  }

  @Permissions('analytics:read')
  @Get('dashboard')
  async getDashboardRefresh(@CurrentUser() user: CurrentUserData) {
    return this.liveAnalyticsService.getDashboardRefresh(user.tenantId!);
  }
}
