import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RestaurantsService } from './restaurants.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { QueryRestaurantDto } from './dto/query-restaurant.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('restaurants')
@ApiBearerAuth()
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a new restaurant' })
  @ApiResponse({ status: 201, description: 'Restaurant created' })
  async create(
    @Body() dto: CreateRestaurantDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.restaurantsService.create(dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List all restaurants for the tenant' })
  async findAll(@Query() query: QueryRestaurantDto, @CurrentUser() user: CurrentUserData) {
    return this.restaurantsService.findAll({
      tenantId: user.tenantId!,
      page: query.page,
      limit: query.limit,
      search: query.search,
      isActive: query.isActive,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get a restaurant by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.restaurantsService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a restaurant' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRestaurantDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.restaurantsService.update(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a restaurant' })
  async softDelete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.restaurantsService.softDelete(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Restaurant deleted successfully' };
  }

  @Post(':id/restore')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted restaurant' })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.restaurantsService.restore(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
