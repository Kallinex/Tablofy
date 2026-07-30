import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { InventoryAnalyticsService } from './inventory-analytics.service';
import { InventoryAnalyticsQueryDto } from './dto/inventory-analytics-query.dto';

@Controller('inventory-analytics')
export class InventoryAnalyticsController {
  constructor(private readonly inventoryAnalyticsService: InventoryAnalyticsService) {}

  @Get('valuation')
  @Roles('OWNER', 'MANAGER')
  async getValuation(
    @Query() query: InventoryAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryAnalyticsService.getValuation(user.tenantId!, query);
  }

  @Get('turnover')
  @Roles('OWNER', 'MANAGER')
  async getTurnover(
    @Query() query: InventoryAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryAnalyticsService.getTurnover(user.tenantId!, query);
  }

  @Get('dead-stock')
  @Roles('OWNER', 'MANAGER')
  async getDeadStock(
    @Query() query: InventoryAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryAnalyticsService.getDeadStock(user.tenantId!, query);
  }

  @Get('classification')
  @Roles('OWNER', 'MANAGER')
  async getClassification(
    @Query() query: InventoryAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryAnalyticsService.getClassification(user.tenantId!, query);
  }

  @Get('waste')
  @Roles('OWNER', 'MANAGER')
  async getWasteAnalysis(
    @Query() query: InventoryAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryAnalyticsService.getWasteAnalysis(user.tenantId!, query);
  }

  @Get('shrinkage')
  @Roles('OWNER', 'MANAGER')
  async getShrinkage(
    @Query() query: InventoryAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryAnalyticsService.getShrinkage(user.tenantId!, query);
  }

  @Get('consumption')
  @Roles('OWNER', 'MANAGER')
  async getConsumptionTrends(
    @Query() query: InventoryAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryAnalyticsService.getConsumptionTrends(user.tenantId!, query);
  }

  @Get('recipe-usage')
  @Roles('OWNER', 'MANAGER')
  async getRecipeUsage(
    @Query() query: InventoryAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryAnalyticsService.getRecipeUsage(user.tenantId!, query);
  }

  @Get('forecast-accuracy')
  @Roles('OWNER', 'MANAGER')
  async getForecastAccuracy(
    @Query() query: InventoryAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryAnalyticsService.getForecastAccuracy(user.tenantId!, query);
  }

  @Get('stock-aging')
  @Roles('OWNER', 'MANAGER')
  async getStockAging(
    @Query() query: InventoryAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryAnalyticsService.getStockAging(user.tenantId!, query);
  }
}
