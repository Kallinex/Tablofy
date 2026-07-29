import {
  Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PurchasingService } from './purchasing.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { QueryGoodsReceiptDto } from './dto/query-goods-receipt.dto';
import { ApprovePurchaseOrderDto } from './dto/approve-purchase-order.dto';

@ApiTags('Purchasing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class PurchasingController {
  constructor(private readonly purchasingService: PurchasingService) {}

  // ============================================
  // Purchase Orders
  // ============================================

  @Post('purchase-orders')
  @Roles('OWNER', 'MANAGER', 'PURCHASING')
  @ApiOperation({ summary: 'Create purchase order' })
  async createPO(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.createPO(dto, user.tenantId!, user.id);
  }

  @Get('purchase-orders')
  @ApiOperation({ summary: 'List purchase orders' })
  async listPOs(@Query() query: QueryPurchaseOrderDto, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.listPOs(user.tenantId!, query);
  }

  @Get('purchase-orders/stats')
  @ApiOperation({ summary: 'Get purchase order statistics' })
  async getPOStats(@CurrentUser() user: CurrentUserData) {
    return this.purchasingService.getPOStats(user.tenantId!);
  }

  @Get('purchase-orders/:id')
  @ApiOperation({ summary: 'Get purchase order by ID' })
  async getPO(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.getPO(id, user.tenantId!);
  }

  @Put('purchase-orders/:id')
  @Roles('OWNER', 'MANAGER', 'PURCHASING')
  @ApiOperation({ summary: 'Update purchase order' })
  async updatePO(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.purchasingService.updatePO(id, dto, user.tenantId!, user.id);
  }

  @Delete('purchase-orders/:id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete purchase order' })
  async deletePO(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.purchasingService.deletePO(id, user.tenantId!, user.id);
  }

  @Post('purchase-orders/:id/submit')
  @Roles('OWNER', 'MANAGER', 'PURCHASING')
  @ApiOperation({ summary: 'Submit purchase order for approval' })
  async submitPO(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.submitPO(id, user.tenantId!, user.id);
  }

  @Post('purchase-orders/:id/approve')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Approve or reject purchase order' })
  async approvePO(
    @Param('id') id: string,
    @Body() dto: ApprovePurchaseOrderDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.purchasingService.approvePO(id, user.id, user.tenantId!, dto.approved, dto.reason);
  }

  @Post('purchase-orders/:id/order')
  @Roles('OWNER', 'MANAGER', 'PURCHASING')
  @ApiOperation({ summary: 'Place order with supplier' })
  async orderPO(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.orderPO(id, user.tenantId!, user.id);
  }

  @Post('purchase-orders/:id/receive')
  @Roles('OWNER', 'MANAGER', 'PURCHASING')
  @ApiOperation({ summary: 'Mark purchase order as received' })
  async receivePO(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.receivePO(id, user.tenantId!, user.id);
  }

  @Post('purchase-orders/:id/close')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Close purchase order' })
  async closePO(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.closePO(id, user.tenantId!, user.id);
  }

  @Post('purchase-orders/:id/cancel')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Cancel purchase order' })
  async cancelPO(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.purchasingService.cancelPO(id, user.tenantId!, user.id, reason);
  }

  // ============================================
  // Goods Receipts
  // ============================================

  @Post('goods-receipts')
  @Roles('OWNER', 'MANAGER', 'PURCHASING', 'CASHIER')
  @ApiOperation({ summary: 'Create goods receipt' })
  async createGRN(@Body() dto: CreateGoodsReceiptDto, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.createGRN(dto, user.tenantId!, user.id);
  }

  @Get('goods-receipts')
  @ApiOperation({ summary: 'List goods receipts' })
  async listGRNs(@Query() query: QueryGoodsReceiptDto, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.listGRNs(user.tenantId!, query);
  }

  @Get('goods-receipts/:id')
  @ApiOperation({ summary: 'Get goods receipt by ID' })
  async getGRN(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.getGRN(id, user.tenantId!);
  }

  @Put('goods-receipts/:id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update goods receipt' })
  async updateGRN(
    @Param('id') id: string,
    @Body() dto: UpdateGoodsReceiptDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.purchasingService.updateGRN(id, dto, user.tenantId!, user.id);
  }

  @Post('goods-receipts/:id/cancel')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Cancel goods receipt and reverse stock' })
  async cancelGRN(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.purchasingService.cancelGRN(id, user.tenantId!, user.id);
  }
}
