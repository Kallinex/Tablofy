import {
  Controller, Get, Post, Put, Delete, Param, Query, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { InventoryService } from './inventory.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { QueryInventoryDto, QueryStockAdjustmentDto, QueryWasteEntryDto, QueryInventoryCountDto } from './dto/query-inventory.dto';
import { CreateInventoryCategoryDto } from './dto/create-inventory-category.dto';
import { UpdateInventoryCategoryDto } from './dto/update-inventory-category.dto';
import { CreateInventoryUnitDto } from './dto/create-inventory-unit.dto';
import { UpdateInventoryUnitDto } from './dto/update-inventory-unit.dto';
import { CreateInventoryLocationDto } from './dto/create-inventory-location.dto';
import { UpdateInventoryLocationDto } from './dto/update-inventory-location.dto';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { CreateWasteEntryDto } from './dto/create-waste-entry.dto';
import { CreateInventoryCountDto } from './dto/create-inventory-count.dto';
import { CreateInventoryBatchDto } from './dto/inventory-batch.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ============================================
  // Items
  // ============================================

  @Post('items')
  @Roles('OWNER', 'MANAGER')
  async createItem(@Body() dto: CreateInventoryItemDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.createItem(dto, user.tenantId!, user.id);
  }

  @Get('items')
  async listItems(@Query() query: QueryInventoryDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.listItems(user.tenantId!, query);
  }

  @Get('items/:id')
  async getItem(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.getItem(id, user.tenantId!);
  }

  @Put('items/:id')
  @Roles('OWNER', 'MANAGER')
  async updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryService.updateItem(id, dto, user.tenantId!, user.id);
  }

  @Delete('items/:id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteItem(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.inventoryService.deleteItem(id, user.tenantId!, user.id);
  }

  @Post('items/:id/restore')
  @Roles('OWNER', 'MANAGER')
  async restoreItem(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.restoreItem(id, user.tenantId!, user.id);
  }

  // ============================================
  // Categories
  // ============================================

  @Post('categories')
  @Roles('OWNER', 'MANAGER')
  async createCategory(@Body() dto: CreateInventoryCategoryDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.createCategory(dto, user.tenantId!, user.id);
  }

  @Get('categories')
  async getCategories(@CurrentUser() user: CurrentUserData) {
    return this.inventoryService.getCategories(user.tenantId!);
  }

  @Put('categories/:id')
  @Roles('OWNER', 'MANAGER')
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryCategoryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryService.updateCategory(id, dto, user.tenantId!, user.id);
  }

  @Delete('categories/:id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.inventoryService.deleteCategory(id, user.tenantId!, user.id);
  }

  // ============================================
  // Units
  // ============================================

  @Post('units')
  @Roles('OWNER', 'MANAGER')
  async createUnit(@Body() dto: CreateInventoryUnitDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.createUnit(dto, user.tenantId!, user.id);
  }

  @Get('units')
  async getUnits(@CurrentUser() user: CurrentUserData) {
    return this.inventoryService.getUnits(user.tenantId!);
  }

  @Put('units/:id')
  @Roles('OWNER', 'MANAGER')
  async updateUnit(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryUnitDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryService.updateUnit(id, dto, user.tenantId!, user.id);
  }

  @Delete('units/:id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUnit(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.inventoryService.deleteUnit(id, user.tenantId!, user.id);
  }

  // ============================================
  // Locations
  // ============================================

  @Post('locations')
  @Roles('OWNER', 'MANAGER')
  async createLocation(@Body() dto: CreateInventoryLocationDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.createLocation(dto, user.tenantId!, user.id);
  }

  @Get('locations')
  async getLocations(
    @Query('branchId') branchId?: string,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.inventoryService.getLocations(user!.tenantId!, branchId);
  }

  @Put('locations/:id')
  @Roles('OWNER', 'MANAGER')
  async updateLocation(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryLocationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.inventoryService.updateLocation(id, dto, user.tenantId!, user.id);
  }

  @Delete('locations/:id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLocation(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.inventoryService.deleteLocation(id, user.tenantId!, user.id);
  }

  // ============================================
  // Stock Adjustments
  // ============================================

  @Post('adjustments')
  @Roles('OWNER', 'MANAGER')
  async createAdjustment(@Body() dto: CreateStockAdjustmentDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.createAdjustment(dto, user.tenantId!, user.id);
  }

  @Get('adjustments')
  async listAdjustments(@Query() query: QueryStockAdjustmentDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.listAdjustments(user.tenantId!, query as unknown as Record<string, unknown>);
  }

  @Post('adjustments/:id/approve')
  @Roles('OWNER', 'MANAGER')
  async approveAdjustment(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.approveAdjustment(id, user.tenantId!, user.id);
  }

  // ============================================
  // Waste
  // ============================================

  @Post('waste')
  @Roles('OWNER', 'MANAGER')
  async createWasteEntry(@Body() dto: CreateWasteEntryDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.createWasteEntry(dto, user.tenantId!, user.id);
  }

  @Get('waste')
  async listWasteEntries(@Query() query: QueryWasteEntryDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.listWasteEntries(user.tenantId!, query as unknown as Record<string, unknown>);
  }

  // ============================================
  // Inventory Counts
  // ============================================

  @Post('counts')
  @Roles('OWNER', 'MANAGER')
  async createCount(@Body() dto: CreateInventoryCountDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.createCount(dto, user.tenantId!, user.id);
  }

  @Get('counts')
  async listCounts(@Query() query: QueryInventoryCountDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.listCounts(user.tenantId!, query as unknown as Record<string, unknown>);
  }

  // ============================================
  // Batches
  // ============================================

  @Post('batches')
  @Roles('OWNER', 'MANAGER')
  async createBatch(@Body() dto: CreateInventoryBatchDto, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.createBatch(dto, user.tenantId!, user.id);
  }

  @Get('items/:itemId/batches')
  async getBatchesForItem(@Param('itemId') itemId: string, @CurrentUser() user: CurrentUserData) {
    return this.inventoryService.getBatchesForItem(itemId, user.tenantId!);
  }

  @Get('expiring')
  async getExpiringBatches(
    @Query('days') days?: number,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.inventoryService.getExpiringBatches(user!.tenantId!, days ?? 30);
  }

  // ============================================
  // Stock Status
  // ============================================

  @Get('low-stock')
  async getLowStockItems(@CurrentUser() user: CurrentUserData) {
    return this.inventoryService.getLowStockItems(user.tenantId!);
  }

  @Get('critical-stock')
  async getCriticalStockItems(@CurrentUser() user: CurrentUserData) {
    return this.inventoryService.getCriticalStockItems(user.tenantId!);
  }

  @Get('out-of-stock')
  async getOutOfStockItems(@CurrentUser() user: CurrentUserData) {
    return this.inventoryService.getOutOfStockItems(user.tenantId!);
  }
}
