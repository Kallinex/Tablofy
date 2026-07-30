import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ExecutiveDashboardService } from './executive-dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@Controller('executive-dashboard')
export class ExecutiveDashboardController {
  constructor(private readonly executiveDashboardService: ExecutiveDashboardService) {}

  @Get('kpi')
  @Roles('OWNER', 'MANAGER')
  async getKpi(@Query() query: DashboardQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.executiveDashboardService.getKpi(user.tenantId!, query);
  }

  @Get('top-products')
  @Roles('OWNER', 'MANAGER')
  async getTopProducts(@Query() query: DashboardQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.executiveDashboardService.getTopProducts(user.tenantId!, query);
  }

  @Get('top-categories')
  @Roles('OWNER', 'MANAGER')
  async getTopCategories(@Query() query: DashboardQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.executiveDashboardService.getTopCategories(user.tenantId!, query);
  }

  @Get('top-branches')
  @Roles('OWNER', 'MANAGER')
  async getTopBranches(@Query() query: DashboardQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.executiveDashboardService.getTopBranches(user.tenantId!, query);
  }

  @Get('top-employees')
  @Roles('OWNER', 'MANAGER')
  async getTopEmployees(@Query() query: DashboardQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.executiveDashboardService.getTopEmployees(user.tenantId!, query);
  }

  @Get('top-customers')
  @Roles('OWNER', 'MANAGER')
  async getTopCustomers(@Query() query: DashboardQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.executiveDashboardService.getTopCustomers(user.tenantId!, query);
  }

  @Get('sales-trend')
  @Roles('OWNER', 'MANAGER')
  async getSalesTrend(@Query() query: DashboardQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.executiveDashboardService.getSalesTrend(user.tenantId!, query);
  }
}
