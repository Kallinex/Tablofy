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
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { AddNoteDto } from './dto/add-note.dto';
import { ApplyDiscountDto } from './dto/apply-discount.dto';
import { SplitOrderDto } from './dto/split-order.dto';
import { MergeOrdersDto } from './dto/merge-orders.dto';
import { MoveTableDto } from './dto/move-table.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { ApplyServiceChargeDto } from './dto/apply-service-charge.dto';
import { ApplyTaxRateDto } from './dto/apply-tax-rate.dto';
import { VoidItemDto } from './dto/void-item.dto';
import { UpdateItemKitchenStatusDto } from './dto/update-item-kitchen-status.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'WAITER')
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, description: 'Order created' })
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    dto.restaurantId = restaurantId;
    return this.ordersService.create(dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List all orders for a restaurant' })
  async findAll(
    @Param('restaurantId') restaurantId: string,
    @Query() query: QueryOrderDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get an order by ID' })
  async findOne(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'WAITER')
  @ApiOperation({ summary: 'Update order items or details' })
  async update(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.update(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/status')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change order status (state machine)' })
  async changeStatus(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.changeStatus(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/discount')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply discount to order' })
  async applyDiscount(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: ApplyDiscountDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.applyDiscount(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id/discount')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove discount from order' })
  async removeDiscount(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.removeDiscount(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/payments')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add payment to order' })
  async addPayment(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: AddPaymentDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.addPayment(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/payments/:paymentId/refund')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refund a payment' })
  async refundPayment(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.refundPayment(id, paymentId, user.tenantId!, user.id, dto.reason, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/notes')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a note to an order' })
  async addNote(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.addNote(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/split')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Split order into two orders' })
  async splitOrder(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: SplitOrderDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.splitOrder(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/merge')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Merge another order into this order' })
  async mergeOrders(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: MergeOrdersDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.mergeOrders(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/move-table')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'WAITER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move order to a different table' })
  async moveTable(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: MoveTableDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.moveTable(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/duplicate')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'WAITER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Duplicate an order' })
  async duplicateOrder(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.duplicateOrder(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/service-charge')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply service charge to order' })
  async applyServiceCharge(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: ApplyServiceChargeDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.applyServiceCharge(id, dto.serviceChargeId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/tax-rate')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply tax rate to order' })
  async applyTaxRate(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: ApplyTaxRateDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.applyTaxRate(id, dto.taxRateId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/items/:itemId/void')
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'WAITER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void an order item' })
  async voidItem(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: VoidItemDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.voidItem(id, itemId, dto.reason, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/items/:itemId/kitchen-status')
  @Roles('KITCHEN', 'OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update kitchen status for an order item' })
  async updateItemKitchenStatus(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemKitchenStatusDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.updateItemKitchenStatus(
      id,
      itemId,
      dto.kitchenStatus,
      user.tenantId!,
      user.id,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
  }

  @Get(':id/kitchen-tickets')
  @Roles('KITCHEN', 'OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List kitchen tickets for an order' })
  async findKitchenTickets(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ordersService.findKitchenTickets(id, user.tenantId!);
  }

  @Post(':id/kitchen-tickets/:ticketId/status')
  @Roles('KITCHEN', 'OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update kitchen ticket status' })
  async updateKitchenTicketStatus(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: UpdateItemKitchenStatusDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.updateKitchenTicketStatus(
      ticketId,
      dto.kitchenStatus,
      user.tenantId!,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete an order' })
  async softDelete(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.ordersService.softDelete(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Order deleted successfully' };
  }

  @Post(':id/restore')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted order' })
  async restore(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.ordersService.restore(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
