import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ForecastingDashboardService } from './forecasting-dashboard.service';
import { ForecastingDashboardQueryDto } from './dto/forecasting-dashboard-query.dto';

@Controller('forecasting-dashboard')
export class ForecastingDashboardController {
  constructor(private readonly forecastingDashboardService: ForecastingDashboardService) {}

  @Get('sales')
  @Roles('OWNER', 'MANAGER')
  async getSalesForecast(
    @Query() query: ForecastingDashboardQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingDashboardService.getSalesForecast(user.tenantId!, query);
  }

  @Get('revenue')
  @Roles('OWNER', 'MANAGER')
  async getRevenueForecast(
    @Query() query: ForecastingDashboardQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingDashboardService.getRevenueForecast(user.tenantId!, query);
  }

  @Get('demand')
  @Roles('OWNER', 'MANAGER')
  async getDemandForecast(
    @Query() query: ForecastingDashboardQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingDashboardService.getDemandForecast(user.tenantId!, query);
  }

  @Get('inventory')
  @Roles('OWNER', 'MANAGER')
  async getInventoryForecast(
    @Query() query: ForecastingDashboardQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingDashboardService.getInventoryForecast(user.tenantId!, query);
  }

  @Get('customers')
  @Roles('OWNER', 'MANAGER')
  async getCustomerForecast(
    @Query() query: ForecastingDashboardQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingDashboardService.getCustomerForecast(user.tenantId!, query);
  }

  @Get('trends')
  @Roles('OWNER', 'MANAGER')
  async getTrendAnalysis(
    @Query() query: ForecastingDashboardQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingDashboardService.getTrendAnalysis(user.tenantId!, query);
  }

  @Get('seasonality')
  @Roles('OWNER', 'MANAGER')
  async getSeasonality(
    @Query() query: ForecastingDashboardQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingDashboardService.getSeasonality(user.tenantId!, query);
  }

  @Get('growth')
  @Roles('OWNER', 'MANAGER')
  async getGrowthProjection(
    @Query() query: ForecastingDashboardQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingDashboardService.getGrowthProjection(user.tenantId!, query);
  }
}
