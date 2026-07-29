import { Controller, Get } from '@nestjs/common';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('inventory-summary')
  async getInventorySummary(@CurrentUser() user: CurrentUserData) {
    return this.dashboardService.getInventorySummary(user.tenantId!);
  }

  @Get('warehouse-summary')
  async getWarehouseSummary(@CurrentUser() user: CurrentUserData) {
    return this.dashboardService.getWarehouseSummary(user.tenantId!);
  }

  @Get('movement-summary')
  async getMovementSummary(@CurrentUser() user: CurrentUserData) {
    return this.dashboardService.getMovementSummary(user.tenantId!);
  }

  @Get('turnover-rate')
  async getTurnoverRate(@CurrentUser() user: CurrentUserData) {
    return this.dashboardService.getTurnoverRate(user.tenantId!);
  }

  @Get('supplier-performance')
  async getSupplierPerformanceSummary(@CurrentUser() user: CurrentUserData) {
    return this.dashboardService.getSupplierPerformanceSummary(user.tenantId!);
  }

  @Get('reorder-alert')
  async getReorderAlert(@CurrentUser() user: CurrentUserData) {
    return this.dashboardService.getReorderAlert(user.tenantId!);
  }

  @Get('valuation-summary')
  async getValuationSummary(@CurrentUser() user: CurrentUserData) {
    return this.dashboardService.getValuationSummary(user.tenantId!);
  }
}
