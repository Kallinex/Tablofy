import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { QueryWarehouseDto } from './dto/query-warehouse.dto';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { CreateBinDto } from './dto/create-bin.dto';
import { UpdateBinDto } from './dto/update-bin.dto';
import { CreateWarehouseBranchDto } from './dto/create-warehouse-branch.dto';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  // ============================================
  // Warehouses CRUD
  // ============================================

  @Post()
  @Roles('OWNER', 'MANAGER')
  async create(@Body() dto: CreateWarehouseDto, @CurrentUser() user: CurrentUserData) {
    return this.warehousesService.create(dto, user.tenantId!, user.id);
  }

  @Get()
  async findAll(@Query() query: QueryWarehouseDto, @CurrentUser() user: CurrentUserData) {
    return this.warehousesService.findAll(user.tenantId!, query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.warehousesService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.warehousesService.update(id, dto, user.tenantId!, user.id);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.warehousesService.remove(id, user.tenantId!, user.id);
  }

  @Post(':id/restore')
  @Roles('OWNER', 'MANAGER')
  async restore(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.warehousesService.restore(id, user.tenantId!, user.id);
  }

  @Post(':id/set-default')
  @Roles('OWNER', 'MANAGER')
  async setDefault(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.warehousesService.setDefault(id, user.tenantId!, user.id);
  }

  // ============================================
  // Stats
  // ============================================

  @Get(':id/stats')
  async getStats(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.warehousesService.getStats(id, user.tenantId!);
  }

  // ============================================
  // Zones
  // ============================================

  @Post(':id/zones')
  @Roles('OWNER', 'MANAGER')
  async createZone(
    @Param('id') warehouseId: string,
    @Body() dto: CreateZoneDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.warehousesService.createZone(warehouseId, dto, user.tenantId!, user.id);
  }

  @Get(':id/zones')
  async findZones(@Param('id') warehouseId: string, @CurrentUser() user: CurrentUserData) {
    return this.warehousesService.findZones(warehouseId, user.tenantId!);
  }

  @Put('zones/:id')
  @Roles('OWNER', 'MANAGER')
  async updateZone(
    @Param('id') id: string,
    @Body() dto: UpdateZoneDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.warehousesService.updateZone(id, dto, user.tenantId!, user.id);
  }

  @Delete('zones/:id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteZone(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.warehousesService.deleteZone(id, user.tenantId!, user.id);
  }

  // ============================================
  // Bins
  // ============================================

  @Post(':id/bins')
  @Roles('OWNER', 'MANAGER')
  async createBin(
    @Param('id') warehouseId: string,
    @Body() dto: CreateBinDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.warehousesService.createBin(warehouseId, dto, user.tenantId!, user.id);
  }

  @Get(':id/bins')
  async findBins(
    @Param('id') warehouseId: string,
    @Query('zoneId') zoneId?: string,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.warehousesService.findBins(warehouseId, user!.tenantId!, zoneId);
  }

  @Put('bins/:id')
  @Roles('OWNER', 'MANAGER')
  async updateBin(
    @Param('id') id: string,
    @Body() dto: UpdateBinDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.warehousesService.updateBin(id, dto, user.tenantId!, user.id);
  }

  @Delete('bins/:id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBin(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.warehousesService.deleteBin(id, user.tenantId!, user.id);
  }

  // ============================================
  // Warehouse-Branch Mapping
  // ============================================

  @Post(':id/branches')
  @Roles('OWNER', 'MANAGER')
  async addBranch(
    @Param('id') warehouseId: string,
    @Body() dto: CreateWarehouseBranchDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.warehousesService.addBranch(warehouseId, dto, user.tenantId!, user.id);
  }

  @Get(':id/branches')
  async findBranches(@Param('id') warehouseId: string, @CurrentUser() user: CurrentUserData) {
    return this.warehousesService.findBranches(warehouseId, user.tenantId!);
  }

  @Delete(':id/branches/:branchId')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeBranch(
    @Param('id') warehouseId: string,
    @Param('branchId') branchId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.warehousesService.removeBranch(warehouseId, branchId, user.tenantId!, user.id);
  }
}
