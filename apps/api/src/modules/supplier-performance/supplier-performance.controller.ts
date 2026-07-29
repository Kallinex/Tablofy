import {
  Controller, Get, Post, Param, Query, Body,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { SupplierPerformanceService } from './supplier-performance.service';
import { CreatePerformanceDto } from './dto/create-performance.dto';
import { QueryPerformanceDto } from './dto/query-performance.dto';

@Controller('supplier-performance')
export class SupplierPerformanceController {
  constructor(private readonly supplierPerformanceService: SupplierPerformanceService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  async create(@Body() dto: CreatePerformanceDto, @CurrentUser() user: CurrentUserData) {
    return this.supplierPerformanceService.create(dto, user.tenantId!, user.id);
  }

  @Get()
  async findAll(@Query() query: QueryPerformanceDto, @CurrentUser() user: CurrentUserData) {
    return this.supplierPerformanceService.findAll(user.tenantId!, query);
  }

  @Get('ranking')
  async getRanking(@CurrentUser() user: CurrentUserData) {
    return this.supplierPerformanceService.getRanking(user.tenantId!);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.supplierPerformanceService.findOne(id, user.tenantId!);
  }

  @Get('supplier/:supplierId')
  async findBySupplier(@Param('supplierId') supplierId: string, @CurrentUser() user: CurrentUserData) {
    return this.supplierPerformanceService.findBySupplier(supplierId, user.tenantId!);
  }
}
