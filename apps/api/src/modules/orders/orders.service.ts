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
import { PaymentsService } from '../payments/payments.service';
import type { OrderCreatedEvent } from '../usage/usage-tracking.service';
import {
  Prisma,
  OrderStatus as PrismaOrderStatus,
  OrderType,
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
import { OrderStatus, validateTransition, isTerminalStatus } from './order-state-machine';
import { CACHE_TTL } from '@tablofy/shared/constants';
import { MetricsService } from '../../common/metrics/metrics.service';
import {
  addMoney,
  mulMoney,
  subMoney,
  sumMoney,
  percentOf,
  roundMoney,
} from '../../common/money/money.util';

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

type CatalogPrices = {
  products: Map<string, { basePrice: Prisma.Decimal }>;
  variants: Map<string, { price: Prisma.Decimal }>;
  modifiers: Map<string, { price: Prisma.Decimal }>;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
    private readonly paymentsService: PaymentsService,
    private readonly metricsService: MetricsService,
  ) {}

  async create(
    dto: CreateOrderDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const catalog = await this.validateBusinessRules(dto, tenantId);

    let result: Prisma.OrderGetPayload<{
      include: { items: { include: { modifiers: true } }; statusHistory: true };
    }> | null = null;

    for (let attempt = 1; attempt <= this.orderNumberMaxRetries; attempt++) {
      try {
        const orderNumber = await this.generateOrderNumber(dto.restaurantId);

        result = await this.prisma.$transaction(async (tx) => {
          const subtotal = sumMoney(
            dto.items.map((item) =>
              mulMoney(this.resolveItemUnitPrice(item, catalog), item.quantity),
            ),
          );

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
              deliveryFee: roundMoney(dto.deliveryFee || 0),
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
            const unitPrice = this.resolveItemUnitPrice(itemDto, catalog);
            const itemTotal = mulMoney(unitPrice, itemDto.quantity);
            const modifiersTotal = sumMoney(
              (itemDto.modifiers || []).map((m) =>
                mulMoney(this.resolveModifierPrice(m, catalog), m.quantity || 1),
              ),
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
                unitPrice,
                total: subMoney(addMoney(itemTotal, modifiersTotal), itemDto.discount || 0),
                discount: roundMoney(itemDto.discount || 0),
                preparationNotes: itemDto.preparationNotes,
                priceSnapshot: unitPrice as unknown as Prisma.InputJsonValue,
                modifiers: {
                  create: (itemDto.modifiers || []).map((m) => ({
                    tenantId,
                    modifierId: m.modifierId,
                    name: m.name,
                    quantity: m.quantity || 1,
                    price: this.resolveModifierPrice(m, catalog),
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

        break;
      } catch (error) {
        if (this.isOrderNumberConflict(error) && attempt < this.orderNumberMaxRetries) {
          this.logger.warn(
            `Order number conflict for restaurant ${dto.restaurantId}; retrying (attempt ${attempt}/${this.orderNumberMaxRetries})`,
          );
          continue;
        }
        throw error;
      }
    }

    if (!result) {
      throw new ConflictException('Could not allocate a unique order number');
    }

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

    const usageEvent: OrderCreatedEvent = {
      tenantId,
      orderId: result!.id,
      orderNumber: result!.orderNumber,
      restaurantId: result!.restaurantId,
      items: dto.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
    };
    this.eventEmitter.emit('order.created', usageEvent);
    await this.cacheService.deletePattern(tenantId, 'list:*');
    this.metricsService.incrementOrdersCreated();

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

    await this.cacheService.set(tenantId, listKey, result, CACHE_TTL.ORDERS);
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

    await this.cacheService.set(tenantId, `one:${id}`, order, CACHE_TTL.ORDERS);
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
      if (dto.deliveryFee !== undefined) updateData.deliveryFee = roundMoney(dto.deliveryFee);

      if (Object.keys(updateData).length > 0) {
        await tx.order.update({ where: { id }, data: updateData });
      }

      if (dto.items) {
        for (const itemDto of dto.items) {
          if (itemDto.id) {
            const itemUpdateData: Prisma.OrderItemUpdateInput = {};
            if (itemDto.quantity !== undefined) itemUpdateData.quantity = itemDto.quantity;
            if (itemDto.productName !== undefined) itemUpdateData.productName = itemDto.productName;
            if (itemDto.variantId !== undefined) itemUpdateData.variantId = itemDto.variantId;
            if (itemDto.variantName !== undefined) itemUpdateData.variantName = itemDto.variantName;
            if (itemDto.discount !== undefined) itemUpdateData.discount = itemDto.discount;
            if (itemDto.preparationNotes !== undefined)
              itemUpdateData.preparationNotes = itemDto.preparationNotes;

            if (
              itemDto.quantity !== undefined ||
              itemDto.unitPrice !== undefined ||
              itemDto.discount !== undefined
            ) {
              const existingItem = existing.items.find((i) => i.id === itemDto.id);
              if (!existingItem) {
                throw new NotFoundException('Order item not found in this order');
              }
              const existingUnitPrice = Number(existingItem.unitPrice);
              const quantity = itemDto.quantity ?? existingItem.quantity;
              const discount = itemDto.discount ?? existingItem.discount ?? 0;
              let unitPrice: number = existingUnitPrice;
              if (itemDto.unitPrice !== undefined || itemDto.variantId !== undefined) {
                unitPrice = await this.resolveAuthoritativeItemPrice(
                  tx,
                  tenantId,
                  itemDto.productId ?? existingItem.productId,
                  itemDto.variantId !== undefined ? itemDto.variantId : existingItem.variantId,
                  itemDto.unitPrice ?? existingUnitPrice,
                );
                itemUpdateData.unitPrice = unitPrice;
              }
              const modifiersTotal = await tx.orderItemModifier.aggregate({
                where: { orderItemId: itemDto.id, tenantId },
                _sum: { price: true },
              });
              const modTotal = mulMoney(modifiersTotal._sum.price, quantity);
              itemUpdateData.total = subMoney(
                addMoney(mulMoney(unitPrice, quantity), modTotal),
                discount,
              );
            }

            if (Object.keys(itemUpdateData).length > 0) {
              const itemUpdated = await tx.orderItem.updateMany({
                where: { id: itemDto.id, orderId: id, tenantId },
                data: itemUpdateData as Prisma.OrderItemUpdateManyMutationInput,
              });
              if (itemUpdated.count === 0) {
                throw new NotFoundException('Order item not found in this order');
              }
            }

            if (itemDto.modifiers) {
              for (const modDto of itemDto.modifiers) {
                const modPrice = modDto.modifierId
                  ? await this.resolveAuthoritativeModifierPrice(
                      tx,
                      tenantId,
                      modDto.modifierId,
                      modDto.price,
                    )
                  : roundMoney(modDto.price);
                if (modDto.id) {
                  const modUpdated = await tx.orderItemModifier.updateMany({
                    where: { id: modDto.id, orderItemId: itemDto.id, tenantId },
                    data: {
                      name: modDto.name,
                      quantity: modDto.quantity || 1,
                      price: modPrice,
                    },
                  });
                  if (modUpdated.count === 0) {
                    throw new NotFoundException('Order item modifier not found in this order');
                  }
                } else {
                  await tx.orderItemModifier.create({
                    data: {
                      orderItemId: itemDto.id,
                      tenantId,
                      modifierId: modDto.modifierId,
                      name: modDto.name,
                      quantity: modDto.quantity || 1,
                      price: modPrice,
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

    const result = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.order.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!fresh) {
        throw new NotFoundException('Order not found');
      }

      validateTransition(fresh.status as string, dto.status);

      if (dto.status === OrderStatus.COMPLETED) {
        const totalPaid = Number(fresh.paidAmount ?? 0);
        const orderTotal = Number(fresh.total ?? 0);
        if (totalPaid < orderTotal) {
          throw new BadRequestException(
            `Order cannot be completed until fully paid (${totalPaid} of ${orderTotal})`,
          );
        }
      }

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
        where: { id, version: fresh.version },
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
          fromStatus: fresh.status as PrismaOrderStatus,
          toStatus: dto.status as PrismaOrderStatus,
          changedByUserId: userId,
          reason: dto.reason,
        },
      });

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
    if (dto.status === OrderStatus.CONFIRMED) {
      await this.eventEmitter.emitAsync('order.confirmed', { tenantId, orderId: id });
    } else {
      this.eventEmitter.emit(eventName, { tenantId, orderId: id });
    }
    await this.cacheService.delete(tenantId, `one:${id}`);
    await this.cacheService.deletePattern(tenantId, 'list:*');

    if (dto.status === OrderStatus.COMPLETED) {
      this.metricsService.incrementOrdersCompleted();
    }

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
      dto.discountType === 'PERCENTAGE'
        ? percentOf(existing.subtotal, dto.value)
        : roundMoney(dto.value);

    if (discountAmount > roundMoney(existing.subtotal)) {
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
    _meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const result = await this.paymentsService.charge(
      id,
      {
        orderId: id,
        method: dto.method,
        amount: dto.amount,
        tip: dto.tip,
        reference: dto.reference,
      },
      tenantId,
      userId,
    );

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
    _meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const result = await this.paymentsService.refund(paymentId, tenantId, userId, reason);

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
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

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

    const result = await this.withOrderNumberRetry(existing.restaurantId, async (tx) => {
      const sourceVer = await tx.order.updateMany({
        where: { id, version: existing.version },
        data: { version: { increment: 1 } },
      });
      if (sourceVer.count === 0) {
        throw new ConflictException('Order was modified by another user. Please retry.');
      }

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
        const unitPrice = roundMoney(originalItem.unitPrice);
        const itemSubtotal = mulMoney(unitPrice, movedQuantity);

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

        movedSubtotal = addMoney(movedSubtotal, itemSubtotal);

        if (remainingQuantity > 0) {
          const remainingModifiersTotal = sumMoney(
            (originalItem.modifiers ?? []).map((mod) => mulMoney(mod.price, mod.quantity)),
          );
          await tx.orderItem.update({
            where: { id: originalItem.id },
            data: {
              quantity: remainingQuantity,
              total: subMoney(
                addMoney(mulMoney(unitPrice, remainingQuantity), remainingModifiersTotal),
                roundMoney(originalItem.discount),
              ),
            },
          });
        }
      }

      await tx.order.update({
        where: { id: newOrder.id },
        data: { subtotal: movedSubtotal, total: movedSubtotal },
      });

      await this.recalculateOrder(tx, id);
      await this.recalculateOrder(tx, newOrder.id);

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
      const targetVer = await tx.order.updateMany({
        where: { id: targetId, version: target.version },
        data: { version: { increment: 1 } },
      });
      if (targetVer.count === 0) {
        throw new ConflictException('Target order was modified by another user. Please retry.');
      }
      const sourceVer = await tx.order.updateMany({
        where: { id: dto.sourceOrderId, version: source.version },
        data: { version: { increment: 1 } },
      });
      if (sourceVer.count === 0) {
        throw new ConflictException('Source order was modified by another user. Please retry.');
      }

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

    const result = await this.withOrderNumberRetry(existing.restaurantId, async (tx) => {
      const newOrderNumber = await this.generateOrderNumber(existing.restaurantId);

      const subtotal = sumMoney(
        existing.items.map((item) => mulMoney(item.unitPrice, item.quantity)),
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
        const modifiersTotal = sumMoney(
          item.modifiers.map((mod) => mulMoney(mod.price, mod.quantity)),
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
            total: addMoney(mulMoney(item.unitPrice, item.quantity), modifiersTotal),
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
    const scAmount = sc.isPercentage ? percentOf(existing.subtotal, rate) : roundMoney(rate);

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
    const taxableAmount = subMoney(existing.subtotal, existing.discount);
    const taxAmount = mulMoney(taxableAmount, rate);

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
    const result = await this.prisma.order.updateMany({
      where: { id, tenantId },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Order not found');
    }

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

    const updated = await this.prisma.orderItem.updateMany({
      where: { id: itemId, tenantId },
      data: { kitchenStatus },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Order item not found');
    }

    const result = await this.prisma.orderItem.findUnique({ where: { id: itemId } });

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

  private async validateBusinessRules(
    dto: CreateOrderDto,
    tenantId: string,
  ): Promise<CatalogPrices> {
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
    let variants: Awaited<ReturnType<typeof this.prisma.productVariant.findMany>> = [];
    if (variantIds.length) {
      variants = await this.prisma.productVariant.findMany({
        where: { id: { in: variantIds }, tenantId, deletedAt: null },
      });
      const variantMap = new Map(variants.map((v) => [v.id, v]));
      for (const item of dto.items) {
        if (item.variantId && !variantMap.has(item.variantId)) {
          throw new NotFoundException(`Variant ${item.variantId} not found`);
        }
      }
    }

    const modifierIds = dto.items
      .flatMap((i) => i.modifiers || [])
      .filter((m) => m.modifierId)
      .map((m) => m.modifierId!);
    let modifiers: Awaited<ReturnType<typeof this.prisma.modifier.findMany>> = [];
    if (modifierIds.length) {
      modifiers = await this.prisma.modifier.findMany({
        where: { id: { in: modifierIds }, tenantId, deletedAt: null },
      });
      const modifierMap = new Map(modifiers.map((m) => [m.id, m]));
      for (const modifierId of modifierIds) {
        if (!modifierMap.has(modifierId))
          throw new NotFoundException(`Modifier ${modifierId} not found`);
      }
    }

    return {
      products: new Map(
        products.map(
          (p) => [p.id, { basePrice: p.basePrice }] as [string, { basePrice: Prisma.Decimal }],
        ),
      ),
      variants: new Map(
        variants.map((v) => [v.id, { price: v.price }] as [string, { price: Prisma.Decimal }]),
      ),
      modifiers: new Map(
        modifiers.map((m) => [m.id, { price: m.price }] as [string, { price: Prisma.Decimal }]),
      ),
    };
  }

  private resolveItemUnitPrice(
    item: CreateOrderDto['items'][number],
    catalog: CatalogPrices,
  ): number {
    if (item.variantId) {
      const variant = catalog.variants.get(item.variantId);
      return variant ? roundMoney(variant.price) : roundMoney(item.unitPrice);
    }
    const product = catalog.products.get(item.productId);
    return product ? roundMoney(product.basePrice) : roundMoney(item.unitPrice);
  }

  private resolveModifierPrice(
    modifier: NonNullable<CreateOrderDto['items'][number]['modifiers']>[number],
    catalog: CatalogPrices,
  ): number {
    if (!modifier.modifierId) return roundMoney(modifier.price);
    const catalogModifier = catalog.modifiers.get(modifier.modifierId);
    return catalogModifier ? roundMoney(catalogModifier.price) : roundMoney(modifier.price);
  }

  private async resolveAuthoritativeItemPrice(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    variantId: string | null,
    fallbackPrice: number,
  ): Promise<number> {
    if (variantId) {
      const variant = await tx.productVariant.findFirst({
        where: { id: variantId, tenantId, deletedAt: null },
        select: { price: true },
      });
      if (variant) return roundMoney(variant.price);
    }
    const product = await tx.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
      select: { basePrice: true },
    });
    return product ? roundMoney(product.basePrice) : roundMoney(fallbackPrice);
  }

  private async resolveAuthoritativeModifierPrice(
    tx: Prisma.TransactionClient,
    tenantId: string,
    modifierId: string,
    fallbackPrice: number,
  ): Promise<number> {
    const modifier = await tx.modifier.findFirst({
      where: { id: modifierId, tenantId, deletedAt: null },
      select: { price: true },
    });
    return modifier ? roundMoney(modifier.price) : roundMoney(fallbackPrice);
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

  private readonly orderNumberMaxRetries = 10;

  private isOrderNumberConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.some((field) => String(field).includes('orderNumber'));
    }
    return String(target ?? '').includes('orderNumber');
  }

  private async withOrderNumberRetry<T>(
    restaurantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.orderNumberMaxRetries; attempt++) {
      try {
        return await this.prisma.$transaction(fn);
      } catch (error) {
        lastError = error;
        if (this.isOrderNumberConflict(error) && attempt < this.orderNumberMaxRetries) {
          this.logger.warn(
            `Order number conflict for restaurant ${restaurantId}; retrying (attempt ${attempt}/${this.orderNumberMaxRetries})`,
          );
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new ConflictException('Could not allocate a unique order number');
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
      include: { modifiers: true },
    });

    const subtotal = sumMoney(items.map((item) => mulMoney(item.unitPrice, item.quantity)));
    let discount = 0;
    let taxAmount = 0;
    let serviceCharge = 0;
    let deliveryFee = 0;

    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (order) {
      discount = roundMoney(order.discount);
      serviceCharge = roundMoney(order.serviceCharge);
      taxAmount = roundMoney(order.taxAmount);
      deliveryFee = roundMoney(order.deliveryFee);
    }

    const itemTotal = sumMoney(
      items.map((item) => {
        const modifiersTotal = sumMoney(
          (item.modifiers ?? []).map((mod) => mulMoney(mod.price, mod.quantity)),
        );
        return subMoney(
          addMoney(mulMoney(item.unitPrice, item.quantity), modifiersTotal),
          roundMoney(item.discount),
        );
      }),
    );
    const total = addMoney(itemTotal, addMoney(serviceCharge, addMoney(taxAmount, deliveryFee)));
    const cappedDiscount = Math.min(discount, itemTotal);
    const paidAmountFloor = order ? roundMoney(order.paidAmount) : 0;
    const finalTotal = Math.max(paidAmountFloor, subMoney(total, cappedDiscount));

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
