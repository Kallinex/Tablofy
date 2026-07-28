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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { QueryTenantDto } from './dto/query-tenant.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SkipTenantCheck } from '../../common/decorators/skip-tenant.decorator';
import { Request } from 'express';
import { Req } from '@nestjs/common';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @Roles('SUPER_ADMIN')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'Create a new tenant' })
  @ApiResponse({ status: 201, description: 'Tenant created' })
  async create(
    @Body() dto: CreateTenantDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.tenantsService.create(dto, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('SUPER_ADMIN')
  @SkipTenantCheck()
  async findAll(@Query() query: QueryTenantDto) {
    return this.tenantsService.findAll({
      page: query.page,
      limit: query.limit,
      search: query.search,
      status: query.status,
    });
  }

  @Get(':id')
  @Roles('SUPER_ADMIN')
  @SkipTenantCheck()
  async findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Put(':id')
  @Roles('SUPER_ADMIN')
  @SkipTenantCheck()
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.tenantsService.update(id, dto, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @SkipTenantCheck()
  @HttpCode(HttpStatus.OK)
  async softDelete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.tenantsService.softDelete(id, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Tenant deleted successfully' };
  }

  @Post(':id/restore')
  @Roles('SUPER_ADMIN')
  @SkipTenantCheck()
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.tenantsService.restore(id, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
