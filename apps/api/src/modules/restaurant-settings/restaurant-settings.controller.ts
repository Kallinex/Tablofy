import { Controller, Get, Put, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RestaurantSettingsService } from './restaurant-settings.service';
import { UpdateRestaurantSettingsDto } from './dto/update-restaurant-settings.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('restaurant-settings')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/settings')
export class RestaurantSettingsController {
  constructor(private readonly restaurantSettingsService: RestaurantSettingsService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get restaurant settings (metadata)' })
  async getSettings(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.restaurantSettingsService.getSettings(restaurantId, user.tenantId!);
  }

  @Put()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update restaurant settings (merges into metadata)' })
  async updateSettings(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: UpdateRestaurantSettingsDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.restaurantSettingsService.updateSettings(
      restaurantId,
      dto,
      user.tenantId!,
      user.id,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
  }
}
