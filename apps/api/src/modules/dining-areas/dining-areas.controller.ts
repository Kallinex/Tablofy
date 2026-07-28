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
import { DiningAreasService } from './dining-areas.service';
import { CreateDiningAreaDto } from './dto/create-dining-area.dto';
import { UpdateDiningAreaDto } from './dto/update-dining-area.dto';
import { QueryDiningAreaDto } from './dto/query-dining-area.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('dining-areas')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/branches/:branchId/areas')
export class DiningAreasController {
  constructor(private readonly diningAreasService: DiningAreasService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a new dining area for a branch' })
  @ApiResponse({ status: 201, description: 'Dining area created' })
  async create(
    @Param('branchId') branchId: string,
    @Body() dto: CreateDiningAreaDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.diningAreasService.create(dto, branchId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List all dining areas for a branch' })
  async findAll(
    @Param('branchId') branchId: string,
    @Query() query: QueryDiningAreaDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.diningAreasService.findAll({
      tenantId: user.tenantId!,
      branchId,
      floorId: query.floorId,
      page: query.page,
      limit: query.limit,
      search: query.search,
      isActive: query.isActive,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get a dining area by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.diningAreasService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a dining area' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDiningAreaDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.diningAreasService.update(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a dining area' })
  async softDelete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.diningAreasService.softDelete(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Dining area deleted successfully' };
  }

  @Post(':id/restore')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted dining area' })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.diningAreasService.restore(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
