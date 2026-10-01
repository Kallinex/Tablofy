import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { PurchasingGateway } from './purchasing.gateway';
import { Prisma, PurchaseOrderStatus, GoodsReceiptStatus, StockMovementType } from '@prisma/client';
import { addMoney, mulMoney } from '../../common/money/money.util';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { QueryGoodsReceiptDto } from './dto/query-goods-receipt.dto';

@Injectable()
export class PurchasingService {
  private readonly logger = new Logger(PurchasingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gateway: PurchasingGateway,
  ) {}

  // ============================================
  // Purchase Orders
  // ============================================

  async createPO(dto: CreatePurchaseOrderDto, tenantId: string, userId: string) {
    await this.validatePOReferences(dto, tenantId);

    const { po, poNumber } = await this.withPONumberRetry(tenantId, async (tx) => {
      const number = await this.generatePONumber(tenantId);

      let subtotal = 0;
      const itemData = dto.items.map((item, idx) => {
        const lineTotal = mulMoney(item.quantity, item.unitPrice);
        subtotal = addMoney(subtotal, lineTotal);
        return {
          tenantId,
          inventoryItemId: item.inventoryItemId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal,
          sortOrder: item.sortOrder ?? idx,
          notes: item.notes,
        };
      });

      const created = await tx.purchaseOrder.create({
        data: {
          poNumber: number,
          tenantId,
          supplierDetailId: dto.supplierDetailId,
          branchId: dto.branchId,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
          supplierReference: dto.supplierReference,
          notes: dto.notes,
          status: PurchaseOrderStatus.DRAFT,
          subtotal,
          total: subtotal,
          createdById: userId,
          items: { create: itemData },
        },
        include: { items: true, supplierDetail: true },
      });

      return { po: created, poNumber: number };
    });

    await this.auditLogsService.log({
      action: 'PO_CREATED',
      resource: 'PurchaseOrder',
      resourceId: po.id,
      userId,
      tenantId,
      newValues: { poNumber, status: po.status, itemsCount: dto.items.length, total: po.total },
    });

    await this.cacheService.delete(tenantId, 'po:list');
    await this.cacheService.delete(tenantId, 'po:stats');
    this.gateway.broadcastPurchaseUpdate(tenantId, 'purchase.created', po);

    return this.getPO(po.id, tenantId);
  }

  async getPO(id: string, tenantId: string) {
    const cacheKey = `po:${id}`;
    const cached = await this.cacheService.get<Record<string, unknown>>(tenantId, cacheKey);
    if (cached) return cached;

    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        items: {
          include: { inventoryItem: true },
          orderBy: { sortOrder: 'asc' },
        },
        supplierDetail: true,
        goodsReceipts: {
          include: { items: true },
          orderBy: { createdAt: 'desc' },
        },
        approval: true,
        branch: true,
      },
    });

    if (!po) throw new NotFoundException('Purchase order not found');
    await this.cacheService.set(tenantId, cacheKey, po, 300);
    return po;
  }

  async listPOs(tenantId: string, query: QueryPurchaseOrderDto) {
    const cacheKey = `po:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.supplierDetailId) where.supplierDetailId = query.supplierDetailId;
    if (query.branchId) where.branchId = query.branchId;

    if (query.dateFrom || query.dateTo) {
      where.orderDate = {};
      if (query.dateFrom) where.orderDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.orderDate.lte = new Date(query.dateTo);
    }

    if (query.search) {
      where.OR = [
        { poNumber: { contains: query.search, mode: 'insensitive' } },
        { supplierReference: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.PurchaseOrderOrderByWithRelationInput = {};
    if (query.sortBy === 'poNumber') orderBy.poNumber = query.sortOrder ?? 'asc';
    else if (query.sortBy === 'orderDate') orderBy.orderDate = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'expectedDate') orderBy.expectedDate = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'total') orderBy.total = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'status') orderBy.status = query.sortOrder ?? 'asc';
    else orderBy.createdAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          items: true,
          supplierDetail: true,
          approval: true,
          branch: true,
          _count: { select: { goodsReceipts: true } },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrevious: page > 1,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 120);
    return result;
  }

  async updatePO(id: string, dto: UpdatePurchaseOrderDto, tenantId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (
      po.status !== PurchaseOrderStatus.DRAFT &&
      po.status !== PurchaseOrderStatus.PENDING_APPROVAL
    ) {
      throw new BadRequestException('Only DRAFT or PENDING_APPROVAL orders can be updated');
    }

    if (dto.items || dto.supplierDetailId || dto.branchId) {
      await this.validatePOReferences(
        { items: dto.items ?? [], supplierDetailId: dto.supplierDetailId, branchId: dto.branchId },
        tenantId,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });

        let subtotal = 0;
        const itemData = dto.items.map((item, idx) => {
          const lineTotal = mulMoney(item.quantity, item.unitPrice);
          subtotal = addMoney(subtotal, lineTotal);
          return {
            tenantId,
            inventoryItemId: item.inventoryItemId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal,
            sortOrder: item.sortOrder ?? idx,
            notes: item.notes,
          };
        });

        const result = await tx.purchaseOrder.updateMany({
          where: { id, tenantId, version: po.version },
          data: {
            supplierDetailId: dto.supplierDetailId,
            branchId: dto.branchId,
            expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
            supplierReference: dto.supplierReference,
            notes: dto.notes,
            subtotal,
            total: subtotal,
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new ConflictException('Purchase order was modified by another user. Please retry.');
        }

        if (itemData.length > 0) {
          await tx.purchaseOrderItem.createMany({
            data: itemData.map((item) => ({ ...item, purchaseOrderId: id })),
          });
        }

        return tx.purchaseOrder.findUnique({
          where: { id },
          include: { items: true, supplierDetail: true },
        });
      }

      const result = await tx.purchaseOrder.updateMany({
        where: { id, tenantId, version: po.version },
        data: {
          supplierDetailId: dto.supplierDetailId,
          branchId: dto.branchId,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
          supplierReference: dto.supplierReference,
          notes: dto.notes,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw new ConflictException('Purchase order was modified by another user. Please retry.');
      }

      return tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true, supplierDetail: true },
      });
    });

    await this.auditLogsService.log({
      action: 'PO_UPDATED',
      resource: 'PurchaseOrder',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: po.status },
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.cacheService.delete(tenantId, `po:${id}`);
    await this.cacheService.delete(tenantId, 'po:list');
    this.gateway.broadcastPurchaseUpdate(tenantId, 'purchase.updated', updated);

    return updated;
  }

  async deletePO(id: string, tenantId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT orders can be deleted');
    }

    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'PO_DELETED',
      resource: 'PurchaseOrder',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { poNumber: po.poNumber, status: po.status },
    });

    await this.cacheService.delete(tenantId, `po:${id}`);
    await this.cacheService.delete(tenantId, 'po:list');
    await this.cacheService.delete(tenantId, 'po:stats');
    this.gateway.broadcastPurchaseUpdate(tenantId, 'purchase.deleted', { id });
  }

  private async updatePOWithCAS(
    po: { id: string; version: number },
    tenantId: string,
    data: Prisma.PurchaseOrderUncheckedUpdateInput,
    include?: Prisma.PurchaseOrderInclude,
  ) {
    const result = await this.prisma.purchaseOrder.updateMany({
      where: { id: po.id, tenantId, version: po.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictException('Purchase order was modified by another user. Please retry.');
    }
    const updated = await this.prisma.purchaseOrder.findUnique({
      where: { id: po.id },
      include,
    });
    if (!updated) throw new NotFoundException('Purchase order not found');
    return updated;
  }

  async submitPO(id: string, tenantId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT orders can be submitted');
    }

    const updated = await this.updatePOWithCAS(
      po,
      tenantId,
      { status: PurchaseOrderStatus.PENDING_APPROVAL },
      { items: true, supplierDetail: true },
    );

    await this.auditLogsService.log({
      action: 'PO_SUBMITTED',
      resource: 'PurchaseOrder',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: PurchaseOrderStatus.DRAFT },
      newValues: { status: PurchaseOrderStatus.PENDING_APPROVAL },
    });

    await this.cacheService.delete(tenantId, `po:${id}`);
    await this.cacheService.delete(tenantId, 'po:list');
    await this.cacheService.delete(tenantId, 'po:stats');
    this.gateway.broadcastPurchaseUpdate(tenantId, 'purchase.submitted', updated);

    await this.queueService.addJob('purchase-notifications', 'po-submitted', {
      tenantId,
      userId,
      payload: { poId: id, poNumber: po.poNumber },
    });

    return updated;
  }

  async approvePO(
    id: string,
    userId: string,
    tenantId: string,
    approved: boolean,
    reason?: string,
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { approval: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only PENDING_APPROVAL orders can be approved or rejected');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (approved) {
        await tx.purchaseOrderApproval.upsert({
          where: { purchaseOrderId: id },
          update: {
            approvedById: userId,
            approvedAt: new Date(),
            rejectedById: null,
            rejectedAt: null,
            reason: reason ?? null,
            status: 'APPROVED',
          },
          create: {
            purchaseOrderId: id,
            tenantId,
            approvedById: userId,
            approvedAt: new Date(),
            reason: reason ?? null,
            status: 'APPROVED',
          },
        });

        const approvedResult = await tx.purchaseOrder.updateMany({
          where: { id, tenantId, version: po.version },
          data: {
            status: PurchaseOrderStatus.APPROVED,
            approvedById: userId,
            approvedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (approvedResult.count === 0) {
          throw new ConflictException('Purchase order was modified by another user. Please retry.');
        }

        return tx.purchaseOrder.findUnique({
          where: { id },
          include: { items: true, supplierDetail: true, approval: true },
        });
      }

      await tx.purchaseOrderApproval.upsert({
        where: { purchaseOrderId: id },
        update: {
          rejectedById: userId,
          rejectedAt: new Date(),
          approvedById: null,
          approvedAt: null,
          reason: reason ?? null,
          status: 'REJECTED',
        },
        create: {
          purchaseOrderId: id,
          tenantId,
          rejectedById: userId,
          rejectedAt: new Date(),
          reason: reason ?? null,
          status: 'REJECTED',
        },
      });

      const rejectedResult = await tx.purchaseOrder.updateMany({
        where: { id, tenantId, version: po.version },
        data: {
          status: PurchaseOrderStatus.DRAFT,
          version: { increment: 1 },
        },
      });
      if (rejectedResult.count === 0) {
        throw new ConflictException('Purchase order was modified by another user. Please retry.');
      }

      return tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true, supplierDetail: true, approval: true },
      });
    });

    if (!updated) {
      throw new NotFoundException('Purchase order not found');
    }

    const action = approved ? 'PO_APPROVED' : 'PO_REJECTED';
    await this.auditLogsService.log({
      action,
      resource: 'PurchaseOrder',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: PurchaseOrderStatus.PENDING_APPROVAL },
      newValues: { status: updated.status, reason },
    });

    await this.cacheService.delete(tenantId, `po:${id}`);
    await this.cacheService.delete(tenantId, 'po:list');
    await this.cacheService.delete(tenantId, 'po:stats');
    this.gateway.broadcastPurchaseUpdate(
      tenantId,
      `purchase.${approved ? 'approved' : 'rejected'}`,
      updated,
    );

    await this.queueService.addJob('purchase-notifications', 'po-approved', {
      tenantId,
      userId,
      payload: { poId: id, poNumber: po.poNumber, approved },
    });

    return updated;
  }

  async orderPO(id: string, tenantId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.APPROVED) {
      throw new BadRequestException('Only APPROVED orders can be ordered');
    }

    const updated = await this.updatePOWithCAS(
      po,
      tenantId,
      { status: PurchaseOrderStatus.ORDERED },
      { items: true, supplierDetail: true },
    );

    await this.auditLogsService.log({
      action: 'PO_ORDERED',
      resource: 'PurchaseOrder',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: PurchaseOrderStatus.APPROVED },
      newValues: { status: PurchaseOrderStatus.ORDERED },
    });

    await this.cacheService.delete(tenantId, `po:${id}`);
    await this.cacheService.delete(tenantId, 'po:list');
    await this.cacheService.delete(tenantId, 'po:stats');
    this.gateway.broadcastPurchaseUpdate(tenantId, 'purchase.ordered', updated);

    return updated;
  }

  async receivePO(id: string, tenantId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (
      po.status !== PurchaseOrderStatus.ORDERED &&
      po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
    ) {
      throw new BadRequestException('Only ORDERED or PARTIALLY_RECEIVED orders can be received');
    }

    const allReceived = po.items.every(
      (item) => Number(item.receivedQuantity) >= Number(item.quantity),
    );

    const newStatus = allReceived
      ? PurchaseOrderStatus.RECEIVED
      : PurchaseOrderStatus.PARTIALLY_RECEIVED;

    const updated = await this.updatePOWithCAS(
      po,
      tenantId,
      {
        status: newStatus,
        deliveredDate: allReceived ? new Date() : undefined,
      },
      { items: true, supplierDetail: true },
    );

    await this.auditLogsService.log({
      action: 'PO_RECEIVED',
      resource: 'PurchaseOrder',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: po.status },
      newValues: { status: newStatus, allReceived },
    });

    await this.cacheService.delete(tenantId, `po:${id}`);
    await this.cacheService.delete(tenantId, 'po:list');
    await this.cacheService.delete(tenantId, 'po:stats');
    this.gateway.broadcastPurchaseUpdate(tenantId, 'purchase.received', updated);

    return updated;
  }

  async closePO(id: string, tenantId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.RECEIVED) {
      throw new BadRequestException('Only RECEIVED orders can be closed');
    }

    const updated = await this.updatePOWithCAS(
      po,
      tenantId,
      { status: PurchaseOrderStatus.CLOSED },
      { items: true, supplierDetail: true },
    );

    await this.auditLogsService.log({
      action: 'PO_CLOSED',
      resource: 'PurchaseOrder',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: PurchaseOrderStatus.RECEIVED },
      newValues: { status: PurchaseOrderStatus.CLOSED },
    });

    await this.cacheService.delete(tenantId, `po:${id}`);
    await this.cacheService.delete(tenantId, 'po:list');
    await this.cacheService.delete(tenantId, 'po:stats');
    this.gateway.broadcastPurchaseUpdate(tenantId, 'purchase.closed', updated);

    return updated;
  }

  async cancelPO(id: string, tenantId: string, userId: string, reason?: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === PurchaseOrderStatus.CLOSED || po.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already closed or cancelled');
    }

    const updated = await this.updatePOWithCAS(
      po,
      tenantId,
      {
        status: PurchaseOrderStatus.CANCELLED,
        cancelledById: userId,
        cancelledAt: new Date(),
        cancelReason: reason ?? null,
      },
      { items: true, supplierDetail: true },
    );

    await this.auditLogsService.log({
      action: 'PO_CANCELLED',
      resource: 'PurchaseOrder',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: po.status },
      newValues: { status: PurchaseOrderStatus.CANCELLED, reason },
    });

    await this.cacheService.delete(tenantId, `po:${id}`);
    await this.cacheService.delete(tenantId, 'po:list');
    await this.cacheService.delete(tenantId, 'po:stats');
    this.gateway.broadcastPurchaseUpdate(tenantId, 'purchase.cancelled', updated);

    await this.queueService.addJob('purchase-notifications', 'po-cancelled', {
      tenantId,
      userId,
      payload: { poId: id, poNumber: po.poNumber, reason },
    });

    return updated;
  }

  async getPOStats(tenantId: string) {
    const cacheKey = 'po:stats';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const statuses = Object.values(PurchaseOrderStatus);
    const counts = await Promise.all(
      statuses.map((status) =>
        this.prisma.purchaseOrder
          .count({
            where: { tenantId, status, deletedAt: null },
          })
          .then((count) => ({ status, count })),
      ),
    );

    const aggregate = await this.prisma.purchaseOrder.aggregate({
      where: { tenantId, deletedAt: null, status: { not: PurchaseOrderStatus.CANCELLED } },
      _sum: { total: true },
      _avg: { total: true },
      _count: { id: true },
    });

    const result = {
      counts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
      totalValue: aggregate._sum?.total ?? 0,
      averageValue: aggregate._avg?.total ?? 0,
      totalOrders: aggregate._count?.id ?? 0,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  private readonly poNumberMaxRetries = 10;

  private isPONumberConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.some((field) => String(field).includes('poNumber'));
    }
    return String(target ?? '').includes('poNumber');
  }

  private async withPONumberRetry<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.poNumberMaxRetries; attempt++) {
      try {
        return await this.prisma.$transaction(fn);
      } catch (error) {
        lastError = error;
        if (this.isPONumberConflict(error) && attempt < this.poNumberMaxRetries) {
          this.logger.warn(
            `PO number conflict for tenant ${tenantId}; retrying (attempt ${attempt}/${this.poNumberMaxRetries})`,
          );
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new ConflictException('Could not allocate a unique PO number');
  }

  private readonly grnNumberMaxRetries = 5;

  private isGRNNumberConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.some((field) => String(field).includes('grnNumber'));
    }
    return String(target ?? '').includes('grnNumber');
  }

  private isBatchKeyConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    // The only unique constraint involving batchNumber/lotNumber/expiryDate is the
    // inventory_batches natural key (goods_receipt_items has no such unique constraint).
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target : [target];
    return fields.some((field) =>
      ['batchNumber', 'lotNumber', 'expiryDate'].includes(String(field)),
    );
  }

  private async withGRNNumberRetry<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.grnNumberMaxRetries; attempt++) {
      try {
        return await this.prisma.$transaction(fn);
      } catch (error) {
        lastError = error;
        if (this.isGRNNumberConflict(error) && attempt < this.grnNumberMaxRetries) {
          this.logger.warn(
            `GRN number conflict for tenant ${tenantId}; retrying (attempt ${attempt}/${this.grnNumberMaxRetries})`,
          );
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new ConflictException('Could not allocate a unique GRN number');
  }

  private async validatePOReferences(
    dto: {
      items: { inventoryItemId: string }[];
      supplierDetailId?: string;
      branchId?: string;
    },
    tenantId: string,
  ): Promise<void> {
    const itemIds = dto.items.map((i) => i.inventoryItemId);
    if (itemIds.length) {
      const found = await this.prisma.inventoryItem.findMany({
        where: { id: { in: itemIds }, tenantId, deletedAt: null },
        select: { id: true },
      });
      const uniqueIds = new Set(itemIds);
      if (found.length !== uniqueIds.size) {
        throw new BadRequestException('One or more inventory items do not exist in this tenant');
      }
    }

    if (dto.supplierDetailId) {
      const supplier = await this.prisma.supplierDetail.findFirst({
        where: { id: dto.supplierDetailId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('Supplier does not exist in this tenant');
      }
    }

    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) {
        throw new BadRequestException('Branch does not exist in this tenant');
      }
    }
  }

  private async generatePONumber(tenantId: string): Promise<string> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PO-${datePart}-`;

    const lastPO = await this.prisma.purchaseOrder.findFirst({
      where: { tenantId, poNumber: { startsWith: prefix } },
      orderBy: { poNumber: 'desc' },
      select: { poNumber: true },
    });

    let sequence = 1;
    if (lastPO) {
      const lastSeq = parseInt(lastPO.poNumber.split('-')[2] ?? '0', 10);
      sequence = lastSeq + 1;
    }

    return `${prefix}${String(sequence).padStart(5, '0')}`;
  }

  // ============================================
  // Goods Receiving
  // ============================================

  async createGRN(dto: CreateGoodsReceiptDto, tenantId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, tenantId, deletedAt: null },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (
      po.status !== PurchaseOrderStatus.ORDERED &&
      po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
    ) {
      throw new BadRequestException(
        'Can only receive goods for ORDERED or PARTIALLY_RECEIVED orders',
      );
    }

    const validPoItemIds = new Set(po.items.map((item) => item.id));
    for (const item of dto.items) {
      if (!validPoItemIds.has(item.purchaseOrderItemId)) {
        throw new BadRequestException(
          `PO line item ${item.purchaseOrderItemId} does not belong to purchase order ${dto.purchaseOrderId}`,
        );
      }
    }

    const inventoryItemIds = dto.items.map((item) => item.inventoryItemId);
    const distinctInventoryItemIds = [...new Set(inventoryItemIds)];
    const tenantInventoryItems = await this.prisma.inventoryItem.findMany({
      where: { id: { in: distinctInventoryItemIds }, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (tenantInventoryItems.length !== distinctInventoryItemIds.length) {
      throw new NotFoundException('One or more inventory items were not found in this tenant');
    }

    let grnNumber = '';

    const result = await this.withGRNNumberRetry(tenantId, async (tx) => {
      grnNumber = await this.generateGRNNumber(tenantId, tx);

      const grn = await tx.goodsReceipt.create({
        data: {
          grnNumber,
          purchaseOrderId: dto.purchaseOrderId,
          tenantId,
          branchId: dto.branchId ?? po.branchId,
          receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : new Date(),
          notes: dto.notes,
          receivedById: userId,
          status: GoodsReceiptStatus.COMPLETED,
        },
      });

      for (const item of dto.items) {
        const poLine = await tx.purchaseOrderItem.findUnique({
          where: { id: item.purchaseOrderItemId },
          select: { id: true, quantity: true },
        });
        if (!poLine) {
          throw new NotFoundException(`Purchase order line ${item.purchaseOrderItemId} not found`);
        }

        const remainingAllowed = new Prisma.Decimal(poLine.quantity).minus(item.quantityReceived);
        const claimed = await tx.purchaseOrderItem.updateMany({
          where: {
            id: item.purchaseOrderItemId,
            receivedQuantity: { lte: remainingAllowed.toDecimalPlaces(4).toNumber() },
          },
          data: {
            receivedQuantity: { increment: item.quantityReceived },
          },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException(
            `Receiving ${item.quantityReceived} for line ${item.purchaseOrderItemId} exceeds the remaining PO quantity (over-receipt rejected)`,
          );
        }

        // P1-06 N1: averageCost is a read→compute→write over currentQuantity and
        // averageCost. Without a lock, two concurrent GRNs for the same item can
        // both compute from the same base and the later write wins with a stale
        // cost (inventory valuation lost update). Acquire the item row lock (same
        // pattern as recipe deduction) so the computation is serialized.
        await tx.$queryRaw`
          SELECT "id"
          FROM "inventory_items"
          WHERE "id" = ${item.inventoryItemId} AND "tenantId" = ${tenantId}
          FOR UPDATE
        `;

        const invItem = await tx.inventoryItem.findFirst({
          where: { id: item.inventoryItemId, tenantId },
        });
        if (!invItem)
          throw new NotFoundException(`Inventory item ${item.inventoryItemId} not found`);

        const unitPriceDecimal = new Prisma.Decimal(item.unitPrice ?? 0).toDecimalPlaces(
          4,
          Prisma.Decimal.ROUND_HALF_UP,
        );
        const unitPrice = unitPriceDecimal.toNumber();
        const quantityReceived = new Prisma.Decimal(item.quantityReceived);
        const totalCost = unitPriceDecimal
          .times(quantityReceived)
          .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber();
        const currentQty = new Prisma.Decimal(invItem.currentQuantity);
        const currentAvgCost = new Prisma.Decimal(invItem.averageCost ?? 0);
        const newQty = currentQty.plus(quantityReceived);
        const newAvgCost = newQty.gt(0)
          ? currentAvgCost
              .times(currentQty)
              .plus(totalCost)
              .div(newQty)
              .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
              .toNumber()
          : unitPrice;

        await tx.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            currentQuantity: { increment: item.quantityReceived },
            availableQuantity: { increment: item.quantityReceived },
            averageCost: newAvgCost,
            lastCost: unitPrice,
            unitCost: unitPrice,
            version: { increment: 1 },
          },
        });

        await tx.stockMovement.create({
          data: {
            inventoryItemId: item.inventoryItemId,
            tenantId,
            branchId: dto.branchId ?? po.branchId,
            type: StockMovementType.PURCHASE,
            quantity: item.quantityReceived,
            unitCost: unitPrice,
            totalCost,
            referenceType: 'GoodsReceipt',
            referenceId: grn.id,
            batchNumber: item.batchNumber,
            lotNumber: item.lotNumber,
            notes: `GRN ${grnNumber} - PO ${po.poNumber}`,
            recordedById: userId,
          },
        });

        let inventoryBatchId: string | null = null;
        if (item.batchNumber || item.lotNumber || item.expiryDate) {
          const batchMatch = {
            inventoryItemId: item.inventoryItemId,
            tenantId,
            batchNumber: item.batchNumber ?? null,
            lotNumber: item.lotNumber ?? null,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
            isActive: true,
          };

          const existingBatch = await tx.inventoryBatch.findFirst({
            where: batchMatch,
            select: { id: true },
          });

          if (existingBatch) {
            await tx.inventoryBatch.update({
              where: { id: existingBatch.id },
              data: {
                quantity: { increment: item.quantityReceived },
              },
            });
            inventoryBatchId = existingBatch.id;
          } else {
            try {
              const createdBatch = await tx.inventoryBatch.create({
                data: {
                  inventoryItemId: item.inventoryItemId,
                  tenantId,
                  batchNumber: item.batchNumber,
                  lotNumber: item.lotNumber,
                  expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
                  quantity: item.quantityReceived,
                  unitCost: unitPrice,
                },
                select: { id: true },
              });
              inventoryBatchId = createdBatch.id;
            } catch (error) {
              if (!this.isBatchKeyConflict(error)) throw error;
              // A concurrent GRN created this batch first (unique natural key). Reuse it
              // instead of failing: the batch represents one physical lot per item/tenant.
              const reusedBatch = await tx.inventoryBatch.findFirst({
                where: batchMatch,
                select: { id: true },
              });
              if (!reusedBatch) throw error;
              await tx.inventoryBatch.update({
                where: { id: reusedBatch.id },
                data: {
                  quantity: { increment: item.quantityReceived },
                },
              });
              inventoryBatchId = reusedBatch.id;
            }
          }
        }

        await tx.goodsReceiptItem.create({
          data: {
            goodsReceiptId: grn.id,
            purchaseOrderItemId: item.purchaseOrderItemId,
            inventoryItemId: item.inventoryItemId,
            tenantId,
            quantityReceived: item.quantityReceived,
            unitPrice: item.unitPrice ?? 0,
            batchNumber: item.batchNumber,
            lotNumber: item.lotNumber,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
            notes: item.notes,
            inventoryBatchId,
          },
        });
      }

      const poItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: dto.purchaseOrderId },
      });

      const allReceived = poItems.every(
        (poItem) => Number(poItem.receivedQuantity) >= Number(poItem.quantity),
      );

      await tx.purchaseOrder.update({
        where: { id: dto.purchaseOrderId },
        data: {
          status: allReceived
            ? PurchaseOrderStatus.RECEIVED
            : PurchaseOrderStatus.PARTIALLY_RECEIVED,
          deliveredDate: allReceived ? new Date() : undefined,
          version: { increment: 1 },
        },
      });

      return tx.goodsReceipt.findUnique({
        where: { id: grn.id },
        include: {
          items: {
            include: {
              inventoryItem: true,
              purchaseOrderItem: true,
            },
          },
          purchaseOrder: {
            include: { items: true },
          },
        },
      });
    });

    await this.auditLogsService.log({
      action: 'GRN_CREATED',
      resource: 'GoodsReceipt',
      resourceId: result!.id,
      userId,
      tenantId,
      newValues: {
        grnNumber,
        purchaseOrderId: dto.purchaseOrderId,
        itemsCount: dto.items.length,
      },
    });

    await this.cacheService.delete(tenantId, 'po:list');
    await this.cacheService.delete(tenantId, 'po:stats');
    await this.cacheService.delete(tenantId, `po:${dto.purchaseOrderId}`);
    await this.cacheService.delete(tenantId, 'grn:list');
    await this.invalidateItemCache(
      tenantId,
      dto.items.map((i) => i.inventoryItemId),
    );
    this.gateway.broadcastPurchaseUpdate(tenantId, 'purchase.received', result);
    this.gateway.broadcastGoodsReceived(tenantId, 'goods.received', result);

    return result;
  }

  async getGRN(id: string, tenantId: string) {
    const cacheKey = `grn:${id}`;
    const cached = await this.cacheService.get<Record<string, unknown>>(tenantId, cacheKey);
    if (cached) return cached;

    const grn = await this.prisma.goodsReceipt.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        items: {
          include: {
            inventoryItem: true,
            purchaseOrderItem: true,
          },
        },
        purchaseOrder: true,
        branch: true,
      },
    });

    if (!grn) throw new NotFoundException('Goods receipt not found');
    await this.cacheService.set(tenantId, cacheKey, grn, 300);
    return grn;
  }

  async listGRNs(tenantId: string, query: QueryGoodsReceiptDto) {
    const cacheKey = `grn:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.GoodsReceiptWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
    if (query.branchId) where.branchId = query.branchId;

    if (query.dateFrom || query.dateTo) {
      where.receivedDate = {};
      if (query.dateFrom) where.receivedDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.receivedDate.lte = new Date(query.dateTo);
    }

    const orderBy: Prisma.GoodsReceiptOrderByWithRelationInput = {};
    if (query.sortBy === 'grnNumber') orderBy.grnNumber = query.sortOrder ?? 'asc';
    else if (query.sortBy === 'receivedDate') orderBy.receivedDate = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'status') orderBy.status = query.sortOrder ?? 'asc';
    else orderBy.createdAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          items: true,
          purchaseOrder: { select: { poNumber: true } },
          branch: true,
        },
      }),
      this.prisma.goodsReceipt.count({ where }),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrevious: page > 1,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 120);
    return result;
  }

  async updateGRN(id: string, dto: UpdateGoodsReceiptDto, tenantId: string, userId: string) {
    const grn = await this.prisma.goodsReceipt.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!grn) throw new NotFoundException('Goods receipt not found');
    if (grn.status !== GoodsReceiptStatus.PENDING) {
      throw new BadRequestException('Only PENDING goods receipts can be updated');
    }

    const updated = await this.prisma.goodsReceipt.update({
      where: { id },
      data: {
        receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : undefined,
        notes: dto.notes,
      },
      include: { items: true, purchaseOrder: true },
    });

    await this.auditLogsService.log({
      action: 'GRN_UPDATED',
      resource: 'GoodsReceipt',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: grn.status },
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.cacheService.delete(tenantId, `grn:${id}`);
    await this.cacheService.delete(tenantId, 'grn:list');
    this.gateway.broadcastGoodsReceived(tenantId, 'goods.updated', updated);

    return updated;
  }

  async cancelGRN(id: string, tenantId: string, userId: string) {
    const grn = await this.prisma.goodsReceipt.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: true },
    });
    if (!grn) throw new NotFoundException('Goods receipt not found');
    if (grn.status === GoodsReceiptStatus.CANCELLED) {
      throw new BadRequestException('Goods receipt is already cancelled');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimResult = await tx.goodsReceipt.updateMany({
        where: { id, status: { not: GoodsReceiptStatus.CANCELLED } },
        data: { status: GoodsReceiptStatus.CANCELLED },
      });
      if (claimResult.count !== 1) {
        throw new BadRequestException('Goods receipt is already cancelled');
      }

      for (const item of grn.items) {
        await tx.purchaseOrderItem.update({
          where: { id: item.purchaseOrderItemId! },
          data: {
            receivedQuantity: { decrement: item.quantityReceived },
          },
        });

        const receivedQty = item.quantityReceived;

        // Item-level reversal: CAS (gte guard) + atomic decrement. Rejects the cancel if the
        // received stock was already consumed or double-cancelled. Never clamps to zero.
        const itemClaim = await tx.inventoryItem.updateMany({
          where: {
            id: item.inventoryItemId!,
            tenantId,
            currentQuantity: { gte: receivedQty },
            availableQuantity: { gte: receivedQty },
          },
          data: {
            currentQuantity: { decrement: receivedQty },
            availableQuantity: { decrement: receivedQty },
            version: { increment: 1 },
          },
        });
        if (itemClaim.count !== 1) {
          throw new BadRequestException(
            `Cannot cancel GRN ${grn.grnNumber}: received quantity for item ${item.inventoryItemId} has already been consumed or is no longer available`,
          );
        }

        await tx.stockMovement.create({
          data: {
            inventoryItemId: item.inventoryItemId!,
            tenantId,
            branchId: grn.branchId,
            type: StockMovementType.ADJUSTMENT,
            quantity: new Prisma.Decimal(item.quantityReceived).neg(),
            unitCost: item.unitPrice,
            totalCost: new Prisma.Decimal(item.quantityReceived)
              .times(item.unitPrice ?? 0)
              .neg()
              .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
              .toNumber(),
            referenceType: 'GoodsReceipt',
            referenceId: grn.id,
            notes: `GRN cancellation ${grn.grnNumber}`,
            recordedById: userId,
          },
        });

        // Batch-level reversal: touches ONLY the exact batch row this GRN line was
        // attributed to (inventoryBatchId). No key-match-all, no per-batch 0-clamp.
        // Legacy rows (created before attribution existed) have a null inventoryBatchId
        // and are intentionally skipped — they never had an attributable batch row.
        if (item.inventoryBatchId) {
          const batchClaim = await tx.inventoryBatch.updateMany({
            where: {
              id: item.inventoryBatchId,
              isActive: true,
              quantity: { gte: receivedQty },
            },
            data: {
              quantity: { decrement: receivedQty },
            },
          });
          if (batchClaim.count !== 1) {
            throw new BadRequestException(
              `Cannot cancel GRN ${grn.grnNumber}: batch stock for item ${item.inventoryItemId} has already been consumed`,
            );
          }
        }
      }

      const poItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: grn.purchaseOrderId },
      });

      const anyReceived = poItems.some((poi) => Number(poi.receivedQuantity) > 0);
      const allReceived = poItems.every(
        (poi) => Number(poi.receivedQuantity) >= Number(poi.quantity),
      );

      let newStatus: PurchaseOrderStatus;
      if (!anyReceived) newStatus = PurchaseOrderStatus.ORDERED;
      else if (allReceived) newStatus = PurchaseOrderStatus.RECEIVED;
      else newStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED;

      await tx.purchaseOrder.update({
        where: { id: grn.purchaseOrderId },
        data: {
          status: newStatus,
          version: { increment: 1 },
        },
      });
    });

    await this.auditLogsService.log({
      action: 'GRN_CANCELLED',
      resource: 'GoodsReceipt',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: grn.status },
      newValues: { status: GoodsReceiptStatus.CANCELLED },
    });

    await this.cacheService.delete(tenantId, `grn:${id}`);
    await this.cacheService.delete(tenantId, 'grn:list');
    await this.cacheService.delete(tenantId, 'po:list');
    await this.cacheService.delete(tenantId, 'po:stats');
    await this.cacheService.delete(tenantId, `po:${grn.purchaseOrderId}`);
    await this.invalidateItemCache(
      tenantId,
      grn.items.map((i) => i.inventoryItemId),
    );
    this.gateway.broadcastGoodsReceived(tenantId, 'goods.cancelled', { id });

    return { id, status: GoodsReceiptStatus.CANCELLED };
  }

  private async invalidateItemCache(tenantId: string, itemIds: (string | undefined | null)[]) {
    const ids = new Set(itemIds.filter((v): v is string => Boolean(v)));
    for (const id of ids) {
      await this.cacheService.delete(tenantId, `item:${id}`);
    }
    await this.cacheService.deletePattern(tenantId, 'items:*');
    await this.cacheService.deletePattern(tenantId, 'low-stock:*');
    await this.cacheService.deletePattern(tenantId, 'critical-stock:*');
    await this.cacheService.deletePattern(tenantId, 'out-of-stock:*');
  }

  private async generateGRNNumber(
    tenantId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `GRN-${datePart}-`;

    const lastGRN = await client.goodsReceipt.findFirst({
      where: { tenantId, grnNumber: { startsWith: prefix } },
      orderBy: { grnNumber: 'desc' },
      select: { grnNumber: true },
    });

    let sequence = 1;
    if (lastGRN) {
      const lastSeq = parseInt(lastGRN.grnNumber.split('-')[2] ?? '0', 10);
      sequence = lastSeq + 1;
    }

    return `${prefix}${String(sequence).padStart(5, '0')}`;
  }
}
