import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { FinancialAnalyticsService } from './financial-analytics.service';
import { FinancialAnalyticsQueryDto } from './dto/financial-analytics-query.dto';

@Controller('financial-analytics')
export class FinancialAnalyticsController {
  constructor(private readonly financialAnalyticsService: FinancialAnalyticsService) {}

  @Get('overview')
  @Roles('OWNER', 'MANAGER')
  async getOverview(
    @Query() query: FinancialAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.financialAnalyticsService.getOverview(user.tenantId!, query);
  }

  @Get('revenue')
  @Roles('OWNER', 'MANAGER')
  async getRevenueBreakdown(
    @Query() query: FinancialAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.financialAnalyticsService.getRevenueBreakdown(user.tenantId!, query);
  }

  @Get('cogs')
  @Roles('OWNER', 'MANAGER')
  async getCogsBreakdown(
    @Query() query: FinancialAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.financialAnalyticsService.getCogsBreakdown(user.tenantId!, query);
  }

  @Get('profitability/branches')
  @Roles('OWNER', 'MANAGER')
  async getProfitabilityByBranch(
    @Query() query: FinancialAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.financialAnalyticsService.getProfitabilityByBranch(user.tenantId!, query);
  }

  @Get('profitability/categories')
  @Roles('OWNER', 'MANAGER')
  async getProfitabilityByCategory(
    @Query() query: FinancialAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.financialAnalyticsService.getProfitabilityByCategory(user.tenantId!, query);
  }

  @Get('profitability/products')
  @Roles('OWNER', 'MANAGER')
  async getProfitabilityByProduct(
    @Query() query: FinancialAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.financialAnalyticsService.getProfitabilityByProduct(user.tenantId!, query);
  }

  @Get('taxes')
  @Roles('OWNER', 'MANAGER')
  async getTaxAnalysis(
    @Query() query: FinancialAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.financialAnalyticsService.getTaxAnalysis(user.tenantId!, query);
  }

  @Get('discounts')
  @Roles('OWNER', 'MANAGER')
  async getDiscountAnalysis(
    @Query() query: FinancialAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.financialAnalyticsService.getDiscountAnalysis(user.tenantId!, query);
  }

  @Get('refunds')
  @Roles('OWNER', 'MANAGER')
  async getRefundAnalysis(
    @Query() query: FinancialAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.financialAnalyticsService.getRefundAnalysis(user.tenantId!, query);
  }

  @Get('service-charges')
  @Roles('OWNER', 'MANAGER')
  async getServiceChargeAnalysis(
    @Query() query: FinancialAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.financialAnalyticsService.getServiceChargeAnalysis(user.tenantId!, query);
  }
}
