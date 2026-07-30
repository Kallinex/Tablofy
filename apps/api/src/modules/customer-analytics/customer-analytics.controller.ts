import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CustomerAnalyticsService } from './customer-analytics.service';
import { CustomerAnalyticsQueryDto } from './dto/customer-analytics-query.dto';

@Controller('customer-analytics')
export class CustomerAnalyticsController {
  constructor(private readonly customerAnalyticsService: CustomerAnalyticsService) {}

  @Get('overview')
  @Roles('OWNER', 'MANAGER')
  async getOverview(
    @Query() query: CustomerAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customerAnalyticsService.getOverview(user.tenantId!, query);
  }

  @Get('retention')
  @Roles('OWNER', 'MANAGER')
  async getRetention(
    @Query() query: CustomerAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customerAnalyticsService.getRetention(user.tenantId!, query);
  }

  @Get('churn')
  @Roles('OWNER', 'MANAGER')
  async getChurn(@Query() query: CustomerAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.customerAnalyticsService.getChurn(user.tenantId!, query);
  }

  @Get('lifetime-value')
  @Roles('OWNER', 'MANAGER')
  async getLifetimeValue(
    @Query() query: CustomerAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customerAnalyticsService.getLifetimeValue(user.tenantId!, query);
  }

  @Get('average-spend')
  @Roles('OWNER', 'MANAGER')
  async getAverageSpend(
    @Query() query: CustomerAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customerAnalyticsService.getAverageSpend(user.tenantId!, query);
  }

  @Get('visit-frequency')
  @Roles('OWNER', 'MANAGER')
  async getVisitFrequency(
    @Query() query: CustomerAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customerAnalyticsService.getVisitFrequency(user.tenantId!, query);
  }

  @Get('rfm')
  @Roles('OWNER', 'MANAGER')
  async getRfmSegmentation(
    @Query() query: CustomerAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customerAnalyticsService.getRfmSegmentation(user.tenantId!, query);
  }

  @Get('rewards')
  @Roles('OWNER', 'MANAGER')
  async getRewardsUsage(
    @Query() query: CustomerAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customerAnalyticsService.getRewardsUsage(user.tenantId!, query);
  }

  @Get('wallet')
  @Roles('OWNER', 'MANAGER')
  async getWalletActivity(
    @Query() query: CustomerAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customerAnalyticsService.getWalletActivity(user.tenantId!, query);
  }

  @Get('referrals')
  @Roles('OWNER', 'MANAGER')
  async getReferralPerformance(
    @Query() query: CustomerAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customerAnalyticsService.getReferralPerformance(user.tenantId!, query);
  }

  @Get('memberships')
  @Roles('OWNER', 'MANAGER')
  async getMembershipDistribution(
    @Query() query: CustomerAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customerAnalyticsService.getMembershipDistribution(user.tenantId!, query);
  }
}
