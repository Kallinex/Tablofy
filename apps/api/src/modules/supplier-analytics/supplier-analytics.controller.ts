import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { SupplierAnalyticsService } from './supplier-analytics.service';
import { SupplierAnalyticsQueryDto } from './dto/supplier-analytics-query.dto';

@Controller('supplier-analytics')
export class SupplierAnalyticsController {
  constructor(private readonly supplierAnalyticsService: SupplierAnalyticsService) {}

  @Get('overview')
  @Roles('OWNER', 'MANAGER')
  async getOverview(
    @Query() query: SupplierAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.supplierAnalyticsService.getOverview(user.tenantId!, query);
  }

  @Get('scorecards')
  @Roles('OWNER', 'MANAGER')
  async getScorecards(
    @Query() query: SupplierAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.supplierAnalyticsService.getScorecards(user.tenantId!, query);
  }

  @Get('delivery')
  @Roles('OWNER', 'MANAGER')
  async getDeliveryPerformance(
    @Query() query: SupplierAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.supplierAnalyticsService.getDeliveryPerformance(user.tenantId!, query);
  }

  @Get('lead-time')
  @Roles('OWNER', 'MANAGER')
  async getLeadTime(
    @Query() query: SupplierAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.supplierAnalyticsService.getLeadTime(user.tenantId!, query);
  }

  @Get('fill-rate')
  @Roles('OWNER', 'MANAGER')
  async getFillRate(
    @Query() query: SupplierAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.supplierAnalyticsService.getFillRate(user.tenantId!, query);
  }

  @Get('price-variance')
  @Roles('OWNER', 'MANAGER')
  async getPriceVariance(
    @Query() query: SupplierAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.supplierAnalyticsService.getPriceVariance(user.tenantId!, query);
  }

  @Get('quality')
  @Roles('OWNER', 'MANAGER')
  async getQualityScores(
    @Query() query: SupplierAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.supplierAnalyticsService.getQualityScores(user.tenantId!, query);
  }

  @Get('purchase-trends')
  @Roles('OWNER', 'MANAGER')
  async getPurchaseTrends(
    @Query() query: SupplierAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.supplierAnalyticsService.getPurchaseTrends(user.tenantId!, query);
  }

  @Get('ranking')
  @Roles('OWNER', 'MANAGER')
  async getVendorRanking(
    @Query() query: SupplierAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.supplierAnalyticsService.getVendorRanking(user.tenantId!, query);
  }
}
