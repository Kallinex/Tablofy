import { Controller, Get, Put, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BranchSettingsService } from './branch-settings.service';
import { UpdateBranchSettingsDto } from './dto/update-branch-settings.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('branch-settings')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/branches/:branchId/settings')
export class BranchSettingsController {
  constructor(private readonly branchSettingsService: BranchSettingsService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get branch settings (metadata)' })
  async getSettings(
    @Param('restaurantId') restaurantId: string,
    @Param('branchId') branchId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.branchSettingsService.getSettings(restaurantId, branchId, user.tenantId!);
  }

  @Put()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update branch settings (merges into metadata)' })
  async updateSettings(
    @Param('restaurantId') restaurantId: string,
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchSettingsDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.branchSettingsService.updateSettings(
      restaurantId,
      branchId,
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
