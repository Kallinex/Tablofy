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
import { ModifierGroupsService } from './modifier-groups.service';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto';
import { QueryModifierGroupDto } from './dto/query-modifier-group.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('modifier-groups')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/modifier-groups')
export class ModifierGroupsController {
  constructor(private readonly modifierGroupsService: ModifierGroupsService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a new modifier group for a restaurant' })
  @ApiResponse({ status: 201, description: 'Modifier group created' })
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateModifierGroupDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.modifierGroupsService.create(dto, restaurantId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List all modifier groups for a restaurant' })
  async findAll(
    @Param('restaurantId') restaurantId: string,
    @Query() query: QueryModifierGroupDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.modifierGroupsService.findAll({
      tenantId: user.tenantId!,
      restaurantId,
      page: query.page,
      limit: query.limit,
      search: query.search,
      isActive: query.isActive,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get a modifier group by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.modifierGroupsService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a modifier group' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateModifierGroupDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.modifierGroupsService.update(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a modifier group' })
  async softDelete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.modifierGroupsService.softDelete(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Modifier group deleted successfully' };
  }

  @Post(':id/restore')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted modifier group' })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.modifierGroupsService.restore(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
