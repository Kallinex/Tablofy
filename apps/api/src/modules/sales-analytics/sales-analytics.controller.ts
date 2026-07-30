import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { SalesAnalyticsService } from './sales-analytics.service';
import { SalesAnalyticsQueryDto } from './dto/sales-analytics-query.dto';

@Controller('sales-analytics')
export class SalesAnalyticsController {
  constructor(private readonly salesAnalyticsService: SalesAnalyticsService) {}

  @Get('overview')
  @Roles('OWNER', 'MANAGER')
  async getOverview(@Query() query: SalesAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.salesAnalyticsService.getOverview(user.tenantId!, query);
  }

  @Get('revenue-comparison')
  @Roles('OWNER', 'MANAGER')
  async getRevenueComparison(
    @Query() query: SalesAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.salesAnalyticsService.getRevenueComparison(user.tenantId!, query);
  }

  @Get('by-branch')
  @Roles('OWNER', 'MANAGER')
  async getByBranch(@Query() query: SalesAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.salesAnalyticsService.getByBranch(user.tenantId!, query);
  }

  @Get('by-product')
  @Roles('OWNER', 'MANAGER')
  async getByProduct(@Query() query: SalesAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.salesAnalyticsService.getByProduct(user.tenantId!, query);
  }

  @Get('by-category')
  @Roles('OWNER', 'MANAGER')
  async getByCategory(
    @Query() query: SalesAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.salesAnalyticsService.getByCategory(user.tenantId!, query);
  }

  @Get('employee-performance')
  @Roles('OWNER', 'MANAGER')
  async getEmployeePerformance(
    @Query() query: SalesAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.salesAnalyticsService.getEmployeePerformance(user.tenantId!, query);
  }

  @Get('payment-methods')
  @Roles('OWNER', 'MANAGER')
  async getPaymentMethods(
    @Query() query: SalesAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.salesAnalyticsService.getPaymentMethods(user.tenantId!, query);
  }

  @Get('order-channels')
  @Roles('OWNER', 'MANAGER')
  async getOrderChannels(
    @Query() query: SalesAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.salesAnalyticsService.getOrderChannels(user.tenantId!, query);
  }

  @Get('discounts')
  @Roles('OWNER', 'MANAGER')
  async getDiscountAnalysis(
    @Query() query: SalesAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.salesAnalyticsService.getDiscountAnalysis(user.tenantId!, query);
  }

  @Get('service-charges')
  @Roles('OWNER', 'MANAGER')
  async getServiceChargeAnalysis(
    @Query() query: SalesAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.salesAnalyticsService.getServiceChargeAnalysis(user.tenantId!, query);
  }

  @Get('taxes')
  @Roles('OWNER', 'MANAGER')
  async getTaxAnalysis(
    @Query() query: SalesAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.salesAnalyticsService.getTaxAnalysis(user.tenantId!, query);
  }

  @Get('peak-hours')
  @Roles('OWNER', 'MANAGER')
  async getPeakHours(@Query() query: SalesAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.salesAnalyticsService.getPeakHours(user.tenantId!, query);
  }

  @Get('peak-days')
  @Roles('OWNER', 'MANAGER')
  async getPeakDays(@Query() query: SalesAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.salesAnalyticsService.getPeakDays(user.tenantId!, query);
  }

  @Get('conversion')
  @Roles('OWNER', 'MANAGER')
  async getConversionMetrics(
    @Query() query: SalesAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.salesAnalyticsService.getConversionMetrics(user.tenantId!, query);
  }
}
