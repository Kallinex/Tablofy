import { Controller, Get, Param, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { KitchenAnalyticsService } from './kitchen-analytics.service';
import { KitchenAnalyticsQueryDto } from './dto/kitchen-analytics-query.dto';

@Controller('kitchen-analytics')
export class KitchenAnalyticsController {
  constructor(private readonly kitchenAnalyticsService: KitchenAnalyticsService) {}

  @Get('overview')
  @Roles('OWNER', 'MANAGER')
  async getOverview(
    @Query() query: KitchenAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const [stationWorkload, avgPrepTime] = await Promise.all([
      this.kitchenAnalyticsService.getStationWorkload(user.tenantId!, query),
      this.kitchenAnalyticsService.getAveragePreparationTime(user.tenantId!, query),
    ]);
    return { stationWorkload, averagePreparationTime: avgPrepTime };
  }

  @Get('stations/:stationId')
  @Roles('OWNER', 'MANAGER')
  async getStationDetail(
    @Param('stationId') stationId: string,
    @Query() query: KitchenAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kitchenAnalyticsService.getStationDetail(user.tenantId!, stationId, query);
  }

  @Get('queue')
  @Roles('OWNER', 'MANAGER')
  async getQueue(@Query() query: KitchenAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.kitchenAnalyticsService.getQueueAnalysis(user.tenantId!, query);
  }

  @Get('delays')
  @Roles('OWNER', 'MANAGER')
  async getDelays(@Query() query: KitchenAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.kitchenAnalyticsService.getDelayDetection(user.tenantId!, query);
  }

  @Get('efficiency')
  @Roles('OWNER', 'MANAGER')
  async getEfficiency(
    @Query() query: KitchenAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kitchenAnalyticsService.getKitchenEfficiency(user.tenantId!, query);
  }

  @Get('bottlenecks')
  @Roles('OWNER', 'MANAGER')
  async getBottlenecks(
    @Query() query: KitchenAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kitchenAnalyticsService.getBottlenecks(user.tenantId!, query);
  }
}
