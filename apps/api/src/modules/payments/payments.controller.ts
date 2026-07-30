import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PartialRefundDto } from './dto/partial-refund.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';
import { SplitPaymentDto } from './dto/split-payment.dto';
import { ReconcileQueryDto } from './dto/reconcile-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Process a payment against an order' })
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.charge(dto.orderId, dto, user.tenantId!, user.id);
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @ApiOperation({ summary: 'List payments with filters' })
  async findAll(
    @Param('restaurantId') restaurantId: string,
    @Query() query: ReconcileQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.findAll(user.tenantId!, query);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @ApiOperation({ summary: 'Get payment details' })
  async findOne(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.findOne(id, user.tenantId!);
  }

  @Post(':paymentId/refund')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Full refund of a payment' })
  async refund(
    @Param('restaurantId') restaurantId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.refund(paymentId, user.tenantId!, user.id, dto.reason);
  }

  @Post(':paymentId/partial-refund')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Partial refund of a payment' })
  async partialRefund(
    @Param('restaurantId') restaurantId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: PartialRefundDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.partialRefund(paymentId, dto, user.tenantId!, user.id);
  }

  @Post(':paymentId/void')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void a pending payment' })
  async voidPayment(
    @Param('restaurantId') restaurantId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: VoidPaymentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.voidPayment(paymentId, dto, user.tenantId!, user.id);
  }

  @Post('split')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Split payment across methods' })
  async splitPayment(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: SplitPaymentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.paymentsService.splitPayment(dto.orderId, dto, user.tenantId!, user.id);
  }

  @Get('reconcile')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Reconciliation report' })
  async reconcile(
    @Param('restaurantId') restaurantId: string,
    @Query() query: ReconcileQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const fromDate = query.fromDate || new Date(Date.now() - 86400000).toISOString();
    const toDate = query.toDate || new Date().toISOString();
    return this.paymentsService.reconcile(user.tenantId!, fromDate, toDate);
  }

  @Get('providers/:tenantId/status')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Payment provider health check' })
  async providerStatus(
    @Param('restaurantId') restaurantId: string,
    @Param('tenantId') tenantId: string,
  ) {
    const provider = await this.paymentsService.getProviderForTenant(tenantId);
    if (!provider) {
      return { status: 'unavailable', message: 'No payment provider configured' };
    }
    return provider.healthCheck();
  }
}
