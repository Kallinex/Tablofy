import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UsageTrackingService } from './usage-tracking.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('usage')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/usage')
export class UsageController {
  constructor(
    private readonly usageTrackingService: UsageTrackingService,
    private readonly prisma: PrismaService,
  ) {}

  private async ensureRestaurant(restaurantId: string, tenantId: string): Promise<void> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
  }

  @Get('orders/count')
  @Roles('OWNER', 'MANAGER', 'VIEWER')
  @ApiOperation({ summary: 'Get total order count for a restaurant' })
  async getOrderCount(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.ensureRestaurant(restaurantId, user.tenantId!);
    const count = await this.usageTrackingService.getOrderCount(user.tenantId!, restaurantId);
    return { restaurantId, totalOrders: count };
  }

  @Get('products/:productId/count')
  @Roles('OWNER', 'MANAGER', 'VIEWER')
  @ApiOperation({ summary: 'Get order count for a specific product' })
  async getProductOrderCount(
    @Param('restaurantId') restaurantId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.ensureRestaurant(restaurantId, user.tenantId!);
    const count = await this.usageTrackingService.getProductOrderCount(
      user.tenantId!,
      restaurantId,
      productId,
    );
    return { restaurantId, productId, orderCount: count };
  }

  @Get('products/top')
  @Roles('OWNER', 'MANAGER', 'VIEWER')
  @ApiOperation({ summary: 'Get top ordered products' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getTopProducts(
    @Param('restaurantId') restaurantId: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: CurrentUserData,
  ) {
    await this.ensureRestaurant(restaurantId, user!.tenantId!);
    const top = await this.usageTrackingService.getTopProducts(
      user!.tenantId!,
      restaurantId,
      limit ? parseInt(limit, 10) : 10,
    );
    return { restaurantId, topProducts: top };
  }

  @Get('orders/daily')
  @Roles('OWNER', 'MANAGER', 'VIEWER')
  @ApiOperation({ summary: 'Get daily order counts' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async getDailyOrders(
    @Param('restaurantId') restaurantId: string,
    @Query('days') days?: string,
    @CurrentUser() user?: CurrentUserData,
  ) {
    await this.ensureRestaurant(restaurantId, user!.tenantId!);
    const daily = await this.usageTrackingService.getDailyOrders(
      user!.tenantId!,
      restaurantId,
      days ? parseInt(days, 10) : 30,
    );
    return { restaurantId, daily };
  }
}
