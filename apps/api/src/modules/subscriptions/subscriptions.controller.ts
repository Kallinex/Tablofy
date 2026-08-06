import { Controller, Get, Post, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Request } from 'express';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('plans')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'List available subscription plans' })
  @ApiResponse({ status: 200, description: 'Subscription plans returned' })
  getPlans() {
    return this.subscriptionsService.getPlans();
  }

  @Get('current')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get the current tenant subscription with usage' })
  @ApiResponse({ status: 200, description: 'Current subscription returned' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  getCurrent(@CurrentUser() user: CurrentUserData) {
    return this.subscriptionsService.getCurrent(user.tenantId!);
  }

  @Post('change-plan')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Change the tenant subscription plan' })
  @ApiResponse({ status: 200, description: 'Subscription plan changed' })
  @ApiResponse({ status: 400, description: 'Downgrade blocked or same plan' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async changePlan(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangePlanDto,
    @Req() req: Request,
  ) {
    return this.subscriptionsService.changePlan(user.tenantId!, dto, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Cancel the tenant subscription' })
  @ApiResponse({ status: 200, description: 'Subscription canceled' })
  @ApiResponse({ status: 400, description: 'Subscription already canceled' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async cancel(@CurrentUser() user: CurrentUserData, @Req() req: Request) {
    return this.subscriptionsService.cancel(user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  @Permissions('settings:manage')
  @ApiOperation({ summary: 'Reactivate a canceled subscription' })
  @ApiResponse({ status: 200, description: 'Subscription reactivated' })
  @ApiResponse({ status: 400, description: 'Subscription is not canceled' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async reactivate(@CurrentUser() user: CurrentUserData, @Req() req: Request) {
    return this.subscriptionsService.reactivate(user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
