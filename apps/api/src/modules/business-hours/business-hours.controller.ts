import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BusinessHoursService } from './business-hours.service';
import { CreateBusinessHoursDto, UpdateBusinessHoursDto } from './dto/business-hours.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('business-hours')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/business-hours')
export class BusinessHoursController {
  constructor(private readonly businessHoursService: BusinessHoursService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Set business hours for a day (upsert)' })
  @ApiResponse({ status: 201, description: 'Hours set' })
  async setHours(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateBusinessHoursDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.businessHoursService.setHours(dto, restaurantId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List all business hours for a restaurant' })
  async findAll(@Param('restaurantId') restaurantId: string, @CurrentUser() user: CurrentUserData) {
    return this.businessHoursService.findAll(restaurantId, user.tenantId!);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get business hours by ID' })
  async findOne(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.businessHoursService.findOne(id, restaurantId, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update business hours' })
  async update(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBusinessHoursDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.businessHoursService.update(id, dto, restaurantId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete business hours for a day' })
  async remove(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.businessHoursService.remove(id, restaurantId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Business hours deleted successfully' };
  }
}
