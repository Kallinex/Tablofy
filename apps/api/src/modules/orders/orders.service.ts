import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  OrderStatus as PrismaOrderStatus,
  OrderType,
  PaymentStatus,
  KitchenStatus as PrismaKitchenStatus,
} from '@prisma/client';
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
import {
  OrderStatus,
  validateTransition,
  isTerminalStatus,
  isPayableStatus,
} from './order-state-machine';

type OrderWithIncludes = Prisma.OrderGetPayload<{
  include: {
    items: { include: { modifiers: true } };
    payments: true;
    statusHistory: { orderBy: { createdAt: 'asc' } };
    orderNotes: {
      include: { user: { select: { id: true; firstName: true; lastName: true; role: true } } };
    };
    table: { select: { id: true; number: true } };
    user: { select: { id: true; firstName: true; lastName: true; role: true } };
    restaurant: { select: { id: true; name: true } };
    branch: { select: { id: true; name: true } };
  };
}>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateOrderDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    await this.validateBusinessRules(dto, tenantId);

    const orderNumber = await this.generateOrderNumber(dto.restaurantId);

    const result = await this.prisma.$transaction(async (tx) => {
      const subtotal = dto.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

      const order = await tx.order.create({
        data: {
          orderNumber,
          tenantId,
          restaurantId: dto.restaurantId,
          branchId: dto.branchId,
          tableId: dto.tableId || null,
          userId,
          orderType: dto.orderType || OrderType.DINE_IN,
          source: dto.source || 'POS',
          subtotal,
          total: subtotal,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail,
          deliveryAddress: dto.deliveryAddress,
          deliveryFee: dto.deliveryFee || 0,
          notes: dto.notes,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          tenantId,
          toStatus: PrismaOrderStatus.DRAFT,
          changedByUserId: userId,
          reason: 'Order created',
        },
      });

      for (const itemDto of dto.items) {
        const itemTotal = itemDto.unitPrice * itemDto.quantity;
        const modifiersTotal = (itemDto.modifiers || []).reduce(
          (s, m) => s + m.price * (m.quantity || 1),
          0,
        );

        await tx.orderItem.create({
          data: {
            orderId: order.id,
            tenantId,
            productId: itemDto.productId,
            productName: itemDto.productName,
            variantId: itemDto.variantId,
            variantName: itemDto.variantName,
            sku: itemDto.sku,
            quantity: itemDto.quantity,
            unitPrice: itemDto.unitPrice,
            total: itemTotal + modifiersTotal - (itemDto.discount || 0),
            discount: itemDto.discount || 0,
            preparationNotes: itemDto.preparationNotes,
            priceSnapshot: itemDto.unitPrice as unknown as Prisma.InputJsonValue,
            modifiers: {
              create: (itemDto.modifiers || []).map((m) => ({
                tenantId,
                modifierId: m.modifierId,
                name: m.name,
                quantity: m.quantity || 1,
                price: m.price,
              })),
            },
          },
        });
      }

      const fullOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: { items: { include: { modifiers: true } }, statusHistory: true },
      });

      return fullOrder;
    });

    await this.auditLogsService.log({
      action: 'ORDER_CREATED',
      resource: 'Order',
      resourceId: result!.id,
      userId,
      tenantId,
      newValues: {
        orderNumber: result!.orderNumber,
        status: result!.status,
        itemCount: dto.items.length,
      },
      ...meta,
    });

    this.eventEmitter.emit('order.created', {
      tenantId,
      orderId: result!.id,
      orderNumber: result!.orderNumber,
    });
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async findAll(query: QueryOrderDto, tenantId: string) {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      orderType,
      branchId,
      tableId,
      source,
      startDate,
      endDate,
    } = query;

    const listKey = `list:${page}:${limit}:${status || ''}:${orderType || ''}:${branchId || ''}:${tableId || ''}:${source || ''}:${search || ''}:${startDate || ''}:${endDate || ''}`;
    const cached = await this.cacheService.get<{ data: unknown[]; meta: unknown }>(
      tenantId,
      listKey,
    );
    if (cached) return cached;

    const where: Prisma.OrderWhereInput = { tenantId, deletedAt: null };
    if (status) where.status = status;
    if (orderType) where.orderType = orderType;
    if (branchId) where.branchId = branchId;
    if (tableId) where.tableId = tableId;
    if (source) where.source = source;
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      };
    }
    if (search) {
      where.OR = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: { include: { modifiers: true } },
          payments: true,
          table: { select: { id: true, number: true } },
          user: { select: { id: true, firstName: true, lastName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    const result = {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };

    await this.cacheService.set(tenantId, listKey, result, 30);
    return result;
  }

  async findOne(id: string, tenantId: string): Promise<OrderWithIncludes> {
    const cached = await this.cacheService.get<OrderWithIncludes>(tenantId, `one:${id}`);
    if (cached) return cached;

    const order = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        items: { include: { modifiers: true } },
        payments: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        orderNotes: {
          include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
        },
        table: { select: { id: true, number: true } },
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
        restaurant: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.cacheService.set(tenantId, `one:${id}`, order, 30);
    return order as OrderWithIncludes;
  }

  async update(
    id: string,
    dto: UpdateOrderDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);
    const currentStatus = existing.status;

    if (isTerminalStatus(currentStatus as string)) {
      throw new BadRequestException(`Cannot update order in ${currentStatus} status`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const verResult = await tx.order.updateMany({
        where: { id, version: existing.version },
        data: { version: { increment: 1 } },
      });
      if (verResult.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

      const updateData: Prisma.OrderUpdateInput = {};
      if (dto.tableId !== undefined) updateData.table = { connect: { id: dto.tableId } };
      if (dto.orderType !== undefined) updateData.orderType = dto.orderType;
      if (dto.notes !== undefined) updateData.notes = dto.notes;
      if (dto.customerName !== undefined) updateData.customerName = dto.customerName;
      if (dto.customerPhone !== undefined) updateData.customerPhone = dto.customerPhone;
      if (dto.customerEmail !== undefined) updateData.customerEmail = dto.customerEmail;
      if (dto.deliveryAddress !== undefined) updateData.deliveryAddress = dto.deliveryAddress;
      if (dto.deliveryFee !== undefined) updateData.deliveryFee = dto.deliveryFee;

      if (Object.keys(updateData).length > 0) {
        await tx.order.update({ where: { id }, data: updateData });
      }

      if (dto.items) {
        for (const itemDto of dto.items) {
          if (itemDto.id) {
            const itemUpdateData: Prisma.OrderItemUpdateInput = {};
            if (itemDto.quantity !== undefined) itemUpdateData.quantity = itemDto.quantity;
            if (itemDto.unitPrice !== undefined) itemUpdateData.unitPrice = itemDto.unitPrice;
            if (itemDto.productName !== undefined) itemUpdateData.productName = itemDto.productName;
            if (itemDto.variantId !== undefined) itemUpdateData.variantId = itemDto.variantId;
            if (itemDto.variantName !== undefined) itemUpdateData.variantName = itemDto.variantName;
            if (itemDto.discount !== undefined) itemUpdateData.discount = itemDto.discount;
            if (itemDto.preparationNotes !== undefined)
              itemUpdateData.preparationNotes = itemDto.preparationNotes;

            if (itemDto.unitPrice !== undefined && itemDto.quantity !== undefined) {
              const modifiersTotal = await tx.orderItemModifier.aggregate({
                where: { orderItemId: itemDto.id },
                _sum: { price: true },
              });
              const modTotal = Number(modifiersTotal._sum.price || 0) * (itemDto.quantity || 1);
              itemUpdateData.total =
                itemDto.unitPrice * itemDto.quantity + modTotal - (itemDto.discount || 0);
            }

            await tx.orderItem.update({ where: { id: itemDto.id }, data: itemUpdateData });

            if (itemDto.modifiers) {
              for (const modDto of itemDto.modifiers) {
                if (modDto.id) {
                  await tx.orderItemModifier.update({
                    where: { id: modDto.id },
                    data: {
                      name: modDto.name,
                      quantity: modDto.quantity || 1,
                      price: modDto.price,
                    },
                  });
                } else {
                  await tx.orderItemModifier.create({
                    data: {
                      orderItemId: itemDto.id,
                      tenantId,
                      modifierId: modDto.modifierId,
                      name: modDto.name,
                      quantity: modDto.quantity || 1,
                      price: modDto.price,
                    },
                  });
                }
              }
            }
          }
        }
      }

      await this.recalculateOrder(tx, id);

      return tx.order.findUnique({
        where: { id },
        include: { items: { include: { modifiers: true } }, payments: true },
      });
    });

    await this.auditLogsService.log({
      action: 'ORDER_UPDATED',
      resource: 'Order',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('order.updated', { tenantId, orderId: id });
    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async changeStatus(
    id: string,
    dto: ChangeStatusDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);
    const currentStatus = existing.status;

    validateTransition(currentStatus as string, dto.status);

    const result = await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.OrderUpdateInput = {
        status: dto.status as PrismaOrderStatus,
        version: { increment: 1 },
      };

      if (dto.status === OrderStatus.COMPLETED) {
        updateData.completedAt = new Date();
      }
      if (dto.status === OrderStatus.VOIDED) {
        updateData.voidedAt = new Date();
        updateData.voidReason = dto.reason;
      }

      const verResult = await tx.order.updateMany({
        where: { id, version: existing.version },
        data: {
          version: { increment: 1 },
          status: dto.status as PrismaOrderStatus,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(updateData as any),
        },
      });
      if (verResult.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          tenantId,
          fromStatus: currentStatus as PrismaOrderStatus,
          toStatus: dto.status as PrismaOrderStatus,
          changedByUserId: userId,
          reason: dto.reason,
        },
      });

      if (dto.status === OrderStatus.CONFIRMED) {
        const ticketCount = await tx.kitchenTicket.count({ where: { orderId: id } });
        await tx.kitchenTicket.create({
          data: {
            orderId: id,
            tenantId,
            ticketNumber: ticketCount + 1,
            status: PrismaKitchenStatus.PENDING,
          },
        });
      }

      await this.updateKitchenStatus(tx, id, dto.status as string);

      return tx.order.findUnique({
        where: { id },
        include: {
          items: { include: { modifiers: true } },
          payments: true,
          statusHistory: { orderBy: { createdAt: 'asc' } },
        },
      });
    });

    await this.auditLogsService.log({
      action: `ORDER_${dto.status}`,
      resource: 'Order',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: existing.status },
      newValues: { status: dto.status, reason: dto.reason },
      ...meta,
    });

    const eventName = `order.${dto.status.toLowerCase()}`;
    this.eventEmitter.emit(eventName, { tenantId, orderId: id });
    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async applyDiscount(
    id: string,
    dto: ApplyDiscountDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);
    const currentStatus = existing.status;

    if (isTerminalStatus(currentStatus as string)) {
      throw new BadRequestException(`Cannot modify order in ${currentStatus} status`);
    }

    const discountAmount =
      dto.discountType === 'PERCENTAGE' ? (Number(existing.subtotal) * dto.value) / 100 : dto.value;

    if (discountAmount > Number(existing.subtotal)) {
      throw new BadRequestException('Discount cannot exceed subtotal');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const verResult = await tx.order.updateMany({
        where: { id, version: existing.version },
        data: { version: { increment: 1 } },
      });
      if (verResult.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

      const updated = await tx.order.update({
        where: { id },
        data: {
          discount: discountAmount,
          discountType: dto.discountType,
          discountAmount: dto.value,
          discountReason: dto.reason,
        },
      });

      await this.recalculateOrder(tx, id);
      return updated;
    });

    await this.auditLogsService.log({
      action: 'ORDER_DISCOUNT_APPLIED',
      resource: 'Order',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { discount: existing.discount, discountType: existing.discountType },
      newValues: { discount: discountAmount, discountType: dto.discountType, reason: dto.reason },
      ...meta,
    });

    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async removeDiscount(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);
    const currentStatus = existing.status;

    if (isTerminalStatus(currentStatus as string)) {
      throw new BadRequestException(`Cannot modify order in ${currentStatus} status`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const verResult = await tx.order.updateMany({
        where: { id, version: existing.version },
        data: { version: { increment: 1 } },
      });
      if (verResult.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

      const updated = await tx.order.update({
        where: { id },
        data: {
          discount: 0,
          discountType: null,
          discountAmount: 0,
          discountReason: null,
        },
      });
      await this.recalculateOrder(tx, id);
      return updated;
    });

    await this.auditLogsService.log({
      action: 'ORDER_DISCOUNT_REMOVED',
      resource: 'Order',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { discount: existing.discount },
      ...meta,
    });

    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async addPayment(
    id: string,
    dto: AddPaymentDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);
    const currentStatus = existing.status;

    if (!isPayableStatus(currentStatus as string)) {
      throw new BadRequestException(`Cannot add payment to order in ${currentStatus} status`);
    }

    const totalPaid = Number(existing.paidAmount) + dto.amount;
    const orderTotal = Number(existing.total);

    if (totalPaid > orderTotal) {
      throw new BadRequestException('Payment amount exceeds remaining balance');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const verResult = await tx.order.updateMany({
        where: { id, version: existing.version },
        data: { version: { increment: 1 } },
      });
      if (verResult.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

      const payment = await tx.payment.create({
        data: {
          orderId: id,
          tenantId,
          method: dto.method,
          amount: dto.amount,
          tip: dto.tip || 0,
          reference: dto.reference,
          gatewayRef: dto.gatewayRef,
          status: PaymentStatus.COMPLETED,
          processedAt: new Date(),
        },
      });

      await tx.order.update({
        where: { id },
        data: {
          paidAmount: totalPaid,
          tip: { increment: dto.tip || 0 },
          ...(totalPaid >= orderTotal
            ? { status: PrismaOrderStatus.COMPLETED, completedAt: new Date() }
            : {}),
        },
      });

      if (totalPaid >= orderTotal) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: id,
            tenantId,
            fromStatus: currentStatus as PrismaOrderStatus,
            toStatus: PrismaOrderStatus.COMPLETED,
            changedByUserId: userId,
            reason: 'Payment completed',
          },
        });
      }

      return payment;
    });

    await this.auditLogsService.log({
      action: 'PAYMENT_ADDED',
      resource: 'Payment',
      resourceId: result.id,
      userId,
      tenantId,
      newValues: { method: dto.method, amount: dto.amount, tip: dto.tip },
      ...meta,
    });

    this.eventEmitter.emit('payment.completed', { tenantId, orderId: id, paymentId: result.id });
    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async refundPayment(
    id: string,
    paymentId: string,
    tenantId: string,
    userId: string,
    reason?: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, orderId: id, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status === PaymentStatus.REFUNDED) {
      throw new ConflictException('Payment already refunded');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const refunded = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.REFUNDED,
          refundedAt: new Date(),
          refundReason: reason || null,
        },
      });

      await tx.order.update({
        where: { id },
        data: {
          paidAmount: { decrement: payment.amount },
          tip: { decrement: payment.tip || 0 },
        },
      });

      return refunded;
    });

    await this.auditLogsService.log({
      action: 'PAYMENT_REFUNDED',
      resource: 'Payment',
      resourceId: paymentId,
      userId,
      tenantId,
      oldValues: { status: payment.status },
      newValues: { status: PaymentStatus.REFUNDED, reason },
      ...meta,
    });

    this.eventEmitter.emit('payment.refunded', { tenantId, orderId: id, paymentId });
    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async addNote(
    id: string,
    dto: AddNoteDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const note = await this.prisma.orderNote.create({
      data: {
        orderId: id,
        tenantId,
        type: dto.type || 'GENERAL',
        content: dto.content,
        userId,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    await this.auditLogsService.log({
      action: 'ORDER_NOTE_ADDED',
      resource: 'OrderNote',
      resourceId: note.id,
      userId,
      tenantId,
      newValues: { type: note.type, content: note.content },
      ...meta,
    });

    await this.cacheService.delete(tenantId, `one:${id}`);
    return note;
  }

  async splitOrder(
    id: string,
    dto: SplitOrderDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);
    const currentStatus = existing.status;

    if (currentStatus === OrderStatus.DRAFT || isTerminalStatus(currentStatus as string)) {
      throw new BadRequestException(`Cannot split order in ${currentStatus} status`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const newOrderNumber = await this.generateOrderNumber(existing.restaurantId);

      const newOrder = await tx.order.create({
        data: {
          orderNumber: newOrderNumber,
          tenantId,
          restaurantId: existing.restaurantId,
          branchId: existing.branchId,
          tableId: existing.tableId,
          userId,
          orderType: existing.orderType as OrderType,
          status: PrismaOrderStatus.DRAFT,
          source: existing.source,
          subtotal: 0,
          total: 0,
          notes: dto.newOrderNotes || `Split from order #${existing.orderNumber}`,
        },
      });

      let movedSubtotal = 0;

      for (const splitItem of dto.items) {
        const originalItem = existing.items.find((i) => i.id === splitItem.id);
        if (!originalItem) {
          throw new NotFoundException(`Order item ${splitItem.id} not found`);
        }

        const movedQuantity = splitItem.quantity;
        if (movedQuantity > originalItem.quantity) {
          throw new BadRequestException(
            `Cannot move ${movedQuantity} of ${originalItem.quantity} for item ${originalItem.productName}`,
          );
        }

        const remainingQuantity = originalItem.quantity - movedQuantity;
        const unitPrice = Number(originalItem.unitPrice);
        const itemSubtotal = unitPrice * movedQuantity;

        await tx.orderItem.create({
          data: {
            orderId: newOrder.id,
            tenantId,
            productId: originalItem.productId,
            productName: originalItem.productName,
            variantId: originalItem.variantId,
            variantName: originalItem.variantName,
            sku: originalItem.sku,
            quantity: movedQuantity,
            unitPrice,
            discount: 0,
            total: itemSubtotal,
            priceSnapshot: originalItem.priceSnapshot as Prisma.InputJsonValue | undefined,
          },
        });

        movedSubtotal += itemSubtotal;

        if (remainingQuantity > 0) {
          await tx.orderItem.update({
            where: { id: originalItem.id },
            data: { quantity: remainingQuantity },
          });
        }
      }

      await tx.order.update({
        where: { id: newOrder.id },
        data: { subtotal: movedSubtotal, total: movedSubtotal },
      });

      await this.recalculateOrder(tx, id);

      await tx.orderStatusHistory.create({
        data: {
          orderId: newOrder.id,
          tenantId,
          toStatus: PrismaOrderStatus.DRAFT,
          changedByUserId: userId,
          reason: 'Created from split',
        },
      });

      return { newOrderId: newOrder.id };
    });

    await this.auditLogsService.log({
      action: 'ORDER_SPLIT',
      resource: 'Order',
      resourceId: id,
      userId,
      tenantId,
      newValues: { splitOrderId: result.newOrderId, itemsMoved: dto.items.length },
      ...meta,
    });

    this.eventEmitter.emit('order.split', {
      tenantId,
      sourceOrderId: id,
      newOrderId: result.newOrderId,
    });
    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async mergeOrders(
    targetId: string,
    dto: MergeOrdersDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    if (targetId === dto.sourceOrderId) {
      throw new BadRequestException('Cannot merge an order with itself');
    }

    const [target, source] = await Promise.all([
      this.findOne(targetId, tenantId),
      this.findOne(dto.sourceOrderId, tenantId),
    ]);

    if (isTerminalStatus(target.status as string) || isTerminalStatus(source.status as string)) {
      throw new BadRequestException('Cannot merge orders in terminal status');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      for (const item of source.items) {
        await tx.orderItem.create({
          data: {
            orderId: targetId,
            tenantId,
            productId: item.productId,
            productName: item.productName,
            variantId: item.variantId,
            variantName: item.variantName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            total: item.total,
            preparationNotes: item.preparationNotes,
            priceSnapshot: item.priceSnapshot as Prisma.InputJsonValue | undefined,
          },
        });
      }

      await tx.order.update({
        where: { id: dto.sourceOrderId },
        data: { deletedAt: new Date() },
      });

      await this.recalculateOrder(tx, targetId);

      return { mergedOrderId: targetId };
    });

    await this.auditLogsService.log({
      action: 'ORDERS_MERGED',
      resource: 'Order',
      resourceId: targetId,
      userId,
      tenantId,
      newValues: { sourceOrderId: dto.sourceOrderId },
      ...meta,
    });

    this.eventEmitter.emit('orders.merged', {
      tenantId,
      targetOrderId: targetId,
      sourceOrderId: dto.sourceOrderId,
    });
    await this.cacheService.delete(tenantId, `one:${targetId}`);
    await this.cacheService.delete(tenantId, `one:${dto.sourceOrderId}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async moveTable(
    id: string,
    dto: MoveTableDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);

    if (isTerminalStatus(existing.status as string)) {
      throw new BadRequestException(`Cannot move table for order in ${existing.status} status`);
    }

    const table = await this.prisma.table.findFirst({
      where: { id: dto.newTableId, tenantId, deletedAt: null },
    });
    if (!table) {
      throw new NotFoundException('Table not found');
    }

    const result = await this.prisma.order.update({
      where: { id },
      data: { tableId: dto.newTableId },
    });

    await this.auditLogsService.log({
      action: 'ORDER_TABLE_MOVED',
      resource: 'Order',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { tableId: existing.tableId },
      newValues: { tableId: dto.newTableId },
      ...meta,
    });

    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async duplicateOrder(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);

    const result = await this.prisma.$transaction(async (tx) => {
      const newOrderNumber = await this.generateOrderNumber(existing.restaurantId);

      const subtotal = existing.items.reduce(
        (sum, item) => sum + Number(item.unitPrice) * item.quantity,
        0,
      );

      const newOrder = await tx.order.create({
        data: {
          orderNumber: newOrderNumber,
          tenantId,
          restaurantId: existing.restaurantId,
          branchId: existing.branchId,
          tableId: existing.tableId,
          userId,
          orderType: existing.orderType as OrderType,
          status: PrismaOrderStatus.DRAFT,
          source: existing.source,
          subtotal,
          total: subtotal,
          customerName: existing.customerName,
          customerPhone: existing.customerPhone,
          customerEmail: existing.customerEmail,
          deliveryAddress: existing.deliveryAddress,
          deliveryFee: existing.deliveryFee,
          notes: existing.notes
            ? `Duplicated from order #${existing.orderNumber}: ${existing.notes}`
            : `Duplicated from order #${existing.orderNumber}`,
        },
      });

      for (const item of existing.items) {
        const modifiersTotal = item.modifiers.reduce(
          (sum, mod) => sum + Number(mod.price) * mod.quantity,
          0,
        );

        await tx.orderItem.create({
          data: {
            orderId: newOrder.id,
            tenantId,
            productId: item.productId,
            productName: item.productName,
            variantId: item.variantId,
            variantName: item.variantName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: 0,
            total: Number(item.unitPrice) * item.quantity + modifiersTotal,
            preparationNotes: item.preparationNotes,
            priceSnapshot: item.priceSnapshot as Prisma.InputJsonValue | undefined,
          },
        });
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: newOrder.id,
          tenantId,
          toStatus: PrismaOrderStatus.DRAFT,
          changedByUserId: userId,
          reason: 'Order duplicated',
        },
      });

      return tx.order.findUnique({
        where: { id: newOrder.id },
        include: { items: { include: { modifiers: true } } },
      });
    });

    await this.auditLogsService.log({
      action: 'ORDER_DUPLICATED',
      resource: 'Order',
      resourceId: result!.id,
      userId,
      tenantId,
      newValues: { sourceOrderId: id, orderNumber: result!.orderNumber },
      ...meta,
    });

    this.eventEmitter.emit('order.duplicated', {
      tenantId,
      sourceOrderId: id,
      newOrderId: result!.id,
    });
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async applyServiceCharge(
    id: string,
    serviceChargeId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);

    if (isTerminalStatus(existing.status as string)) {
      throw new BadRequestException(`Cannot modify order in ${existing.status} status`);
    }

    const sc = await this.prisma.serviceCharge.findFirst({
      where: { id: serviceChargeId, tenantId, deletedAt: null },
    });
    if (!sc) {
      throw new NotFoundException('Service charge not found');
    }

    const rate = Number(sc.rate);
    const scAmount = sc.isPercentage ? (Number(existing.subtotal) * rate) / 100 : rate;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          serviceChargeId,
          serviceCharge: scAmount,
          serviceChargeRate: rate,
        },
      });
      await this.recalculateOrder(tx, id);
      return updated;
    });

    await this.auditLogsService.log({
      action: 'ORDER_SERVICE_CHARGE_APPLIED',
      resource: 'Order',
      resourceId: id,
      userId,
      tenantId,
      newValues: { serviceChargeId, rate, amount: scAmount },
      ...meta,
    });

    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async applyTaxRate(
    id: string,
    taxRateId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);

    if (isTerminalStatus(existing.status as string)) {
      throw new BadRequestException(`Cannot modify order in ${existing.status} status`);
    }

    const tax = await this.prisma.taxRate.findFirst({
      where: { id: taxRateId, tenantId, deletedAt: null },
    });
    if (!tax) {
      throw new NotFoundException('Tax rate not found');
    }

    const rate = Number(tax.rate);
    const taxableAmount = Number(existing.subtotal) - Number(existing.discount);
    const taxAmount = taxableAmount * rate;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          taxRateId,
          taxAmount,
          taxRate: rate,
        },
      });
      await this.recalculateOrder(tx, id);
      return updated;
    });

    await this.auditLogsService.log({
      action: 'ORDER_TAX_APPLIED',
      resource: 'Order',
      resourceId: id,
      userId,
      tenantId,
      newValues: { taxRateId, rate, amount: taxAmount },
      ...meta,
    });

    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async voidItem(
    id: string,
    itemId: string,
    reason: string | undefined,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);

    if (isTerminalStatus(existing.status as string)) {
      throw new BadRequestException(`Cannot void items in ${existing.status} status`);
    }

    const item = existing.items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException('Order item not found');
    }
    if (item.voidedAt) {
      throw new ConflictException('Item already voided');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const verResult = await tx.order.updateMany({
        where: { id, version: existing.version },
        data: { version: { increment: 1 } },
      });
      if (verResult.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          voidedAt: new Date(),
          voidReason: reason || null,
        },
      });
      await this.recalculateOrder(tx, id);
      return { message: 'Item voided' };
    });

    await this.auditLogsService.log({
      action: 'ORDER_ITEM_VOIDED',
      resource: 'OrderItem',
      resourceId: itemId,
      userId,
      tenantId,
      newValues: { reason },
      ...meta,
    });

    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    return result;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    await this.prisma.order.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'ORDER_DELETED',
      resource: 'Order',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { deletedAt: null } as Record<string, unknown>,
      newValues: { deletedAt: new Date().toISOString() } as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('order.deleted', { tenantId, orderId: id });
    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');
  }

  async updateItemKitchenStatus(
    id: string,
    itemId: string,
    kitchenStatus: PrismaKitchenStatus,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);
    const item = existing.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Order item not found');
    if (item.voidedAt) throw new BadRequestException('Cannot update kitchen status on voided item');

    const result = await this.prisma.orderItem.update({
      where: { id: itemId },
      data: { kitchenStatus },
    });

    await this.auditLogsService.log({
      action: 'ORDER_ITEM_KITCHEN_STATUS_UPDATED',
      resource: 'OrderItem',
      resourceId: itemId,
      userId,
      tenantId,
      oldValues: { kitchenStatus: item.kitchenStatus } as Record<string, unknown>,
      newValues: { kitchenStatus } as Record<string, unknown>,
      ...meta,
    });

    await this.cacheService.delete(tenantId, `one:${id}`);
    return result;
  }

  async findKitchenTickets(orderId: string, tenantId: string) {
    return this.prisma.kitchenTicket.findMany({
      where: { orderId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateKitchenTicketStatus(
    ticketId: string,
    status: PrismaKitchenStatus,
    tenantId: string,
    _meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const ticket = await this.prisma.kitchenTicket.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException('Kitchen ticket not found');

    const updateData: Record<string, unknown> = { status };
    if (status === PrismaKitchenStatus.READY) updateData.completedAt = new Date();

    const result = await this.prisma.kitchenTicket.update({
      where: { id: ticketId },
      data: updateData as Prisma.KitchenTicketUpdateInput,
    });

    await this.cacheService.deletePattern(tenantId, 'list:*');
    return result;
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const restored = await this.prisma.order.update({
      where: { id },
      data: { deletedAt: null },
    });

    await this.auditLogsService.log({
      action: 'ORDER_RESTORED',
      resource: 'Order',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { deletedAt: order.deletedAt?.toISOString() } as Record<string, unknown>,
      newValues: { deletedAt: null } as Record<string, unknown>,
      ...meta,
    });

    await this.cacheService.deletePattern(tenantId, 'list:*');
    return restored;
  }

  private async validateBusinessRules(dto: CreateOrderDto, tenantId: string) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: dto.restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    if (!restaurant.isActive) throw new BadRequestException('Restaurant is not active');

    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, restaurantId: dto.restaurantId, tenantId, deletedAt: null },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, tenantId, deletedAt: null },
      });
      if (!table) throw new NotFoundException('Table not found');
    }

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId, deletedAt: null },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const item of dto.items) {
      if (!productMap.has(item.productId))
        throw new NotFoundException(`Product ${item.productId} not found`);
    }

    const variantIds = dto.items.filter((i) => i.variantId).map((i) => i.variantId!);
    if (variantIds.length) {
      const variants = await this.prisma.productVariant.findMany({
        where: { id: { in: variantIds }, tenantId, deletedAt: null },
      });
      const variantMap = new Map(variants.map((v) => [v.id, v]));
      for (const item of dto.items) {
        if (item.variantId && !variantMap.has(item.variantId)) {
          throw new NotFoundException(`Variant ${item.variantId} not found`);
        }
      }
    }
  }

  private async updateKitchenStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
    orderStatus: string,
  ) {
    const statusMap: Record<string, PrismaKitchenStatus> = {
      CONFIRMED: PrismaKitchenStatus.PENDING,
      IN_PREPARATION: PrismaKitchenStatus.PREPARING,
      READY: PrismaKitchenStatus.READY,
      SERVED: PrismaKitchenStatus.SERVED,
      CANCELLED: PrismaKitchenStatus.CANCELLED,
      VOIDED: PrismaKitchenStatus.CANCELLED,
    };

    const kitchenStatus = statusMap[orderStatus];
    if (!kitchenStatus) return;

    await tx.kitchenTicket.updateMany({
      where: { orderId, status: { not: PrismaKitchenStatus.CANCELLED } },
      data: { status: kitchenStatus },
    });

    if (kitchenStatus === 'READY') {
      await tx.kitchenTicket.updateMany({
        where: { orderId, status: PrismaKitchenStatus.PREPARING },
        data: { status: kitchenStatus, completedAt: new Date() },
      });
    }

    if (kitchenStatus === 'SERVED') {
      await tx.kitchenTicket.updateMany({
        where: {
          orderId,
          status: { in: [PrismaKitchenStatus.READY, PrismaKitchenStatus.PREPARING] },
        },
        data: { status: kitchenStatus },
      });
    }

    if (
      kitchenStatus === PrismaKitchenStatus.PREPARING ||
      kitchenStatus === PrismaKitchenStatus.PENDING ||
      kitchenStatus === PrismaKitchenStatus.CANCELLED
    ) {
      await tx.orderItem.updateMany({
        where: { orderId, voidedAt: null },
        data: { kitchenStatus },
      });
    }
  }

  private async generateOrderNumber(restaurantId: string): Promise<number> {
    const lastOrder = await this.prisma.order.findFirst({
      where: { restaurantId },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });
    return (lastOrder?.orderNumber || 0) + 1;
  }

  private async recalculateOrder(tx: Prisma.TransactionClient, orderId: string) {
    const items = await tx.orderItem.findMany({
      where: { orderId, voidedAt: null },
    });

    const subtotal = items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
    let discount = 0;
    let taxAmount = 0;
    let serviceCharge = 0;
    let deliveryFee = 0;

    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (order) {
      discount = Number(order.discount);
      serviceCharge = Number(order.serviceCharge);
      taxAmount = Number(order.taxAmount);
      deliveryFee = Number(order.deliveryFee);
    }

    const itemTotal = items.reduce((sum, item) => sum + Number(item.total), 0);
    const total = itemTotal + serviceCharge + taxAmount + deliveryFee;
    const cappedDiscount = Math.min(discount, itemTotal);
    const finalTotal = Math.max(0, total - cappedDiscount);

    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal,
        discount: cappedDiscount,
        total: finalTotal,
      },
    });
  }
}
