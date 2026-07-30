import { Controller, Get, Param, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CrmAnalyticsService } from './crm-analytics.service';
import { CrmAnalyticsQueryDto } from './dto/crm-analytics-query.dto';

@Controller('crm-analytics')
export class CrmAnalyticsController {
  constructor(private readonly crmAnalyticsService: CrmAnalyticsService) {}

  @Get('overview')
  @Roles('OWNER', 'MANAGER')
  async getOverview(@Query() query: CrmAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.crmAnalyticsService.getOverview(user.tenantId!, query);
  }

  @Get('campaigns/:id')
  @Roles('OWNER', 'MANAGER')
  async getCampaignDetail(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.crmAnalyticsService.getCampaignDetail(user.tenantId!, id);
  }

  @Get('campaign-roi')
  @Roles('OWNER', 'MANAGER')
  async getCampaignRoi(@Query() query: CrmAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.crmAnalyticsService.getCampaignRoi(user.tenantId!, query);
  }

  @Get('promotions')
  @Roles('OWNER', 'MANAGER')
  async getPromotionMetrics(
    @Query() query: CrmAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.crmAnalyticsService.getPromotionMetrics(user.tenantId!, query);
  }

  @Get('coupons')
  @Roles('OWNER', 'MANAGER')
  async getCouponUsage(@Query() query: CrmAnalyticsQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.crmAnalyticsService.getCouponUsage(user.tenantId!, query);
  }

  @Get('conversion')
  @Roles('OWNER', 'MANAGER')
  async getConversionRates(
    @Query() query: CrmAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.crmAnalyticsService.getConversionRates(user.tenantId!, query);
  }

  @Get('engagement')
  @Roles('OWNER', 'MANAGER')
  async getCustomerEngagement(
    @Query() query: CrmAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.crmAnalyticsService.getCustomerEngagement(user.tenantId!, query);
  }

  @Get('automation')
  @Roles('OWNER', 'MANAGER')
  async getAutomationEffectiveness(
    @Query() query: CrmAnalyticsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.crmAnalyticsService.getAutomationEffectiveness(user.tenantId!, query);
  }
}
