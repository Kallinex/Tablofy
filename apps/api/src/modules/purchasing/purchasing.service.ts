import {
  Injectable, NotFoundException, ConflictException, BadRequestException, Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { PurchasingGateway } from './purchasing.gateway';
import {
  Prisma, PurchaseOrderStatus, GoodsReceiptStatus, StockMovementType,
} from '@prisma/client';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { CreateGoodsReceiptDto, GoodsReceiptItemDto } from './dto/create-goods-receipt.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { QueryGoodsReceiptDto } from './dto/query-goods-receipt.dto';
import { ApprovePurchaseOrderDto } from './dto/approve-purchase-order.dto';

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
    const poNumber = await this.generatePONumber(tenantId);

    const po = await this.prisma.$transaction(async (tx) => {
      let subtotal = 0;
      const itemData = dto.items.map((item, idx) => {
        const lineTotal = Number((item.quantity * item.unitPrice).toFixed(2));
        subtotal += lineTotal;
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

      subtotal = Number(subtotal.toFixed(2));

      const created = await tx.purchaseOrder.create({
        data: {
          poNumber,
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

      return created;
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
    if (po.status !== PurchaseOrderStatus.DRAFT && po.status !== PurchaseOrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only DRAFT or PENDING_APPROVAL orders can be updated');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });

        let subtotal = 0;
        const itemData = dto.items.map((item, idx) => {
          const lineTotal = Number((item.quantity * item.unitPrice).toFixed(2));
          subtotal += lineTotal;
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
        subtotal = Number(subtotal.toFixed(2));

        return tx.purchaseOrder.update({
          where: { id },
          data: {
            supplierDetailId: dto.supplierDetailId,
            branchId: dto.branchId,
            expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
            supplierReference: dto.supplierReference,
            notes: dto.notes,
            subtotal,
            total: subtotal,
            version: { increment: 1 },
            items: { create: itemData },
          },
          include: { items: true, supplierDetail: true },
        });
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierDetailId: dto.supplierDetailId,
          branchId: dto.branchId,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
          supplierReference: dto.supplierReference,
          notes: dto.notes,
          version: { increment: 1 },
        },
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

  async submitPO(id: string, tenantId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT orders can be submitted');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.PENDING_APPROVAL, version: { increment: 1 } },
      include: { items: true, supplierDetail: true },
    });

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

  async approvePO(id: string, userId: string, tenantId: string, approved: boolean, reason?: string) {
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

        return tx.purchaseOrder.update({
          where: { id },
          data: {
            status: PurchaseOrderStatus.APPROVED,
            approvedById: userId,
            approvedAt: new Date(),
            version: { increment: 1 },
          },
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

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.DRAFT,
          version: { increment: 1 },
        },
        include: { items: true, supplierDetail: true, approval: true },
      });
    });

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
    this.gateway.broadcastPurchaseUpdate(tenantId, `purchase.${approved ? 'approved' : 'rejected'}`, updated);

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

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.ORDERED, version: { increment: 1 } },
      include: { items: true, supplierDetail: true },
    });

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
    if (po.status !== PurchaseOrderStatus.ORDERED && po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException('Only ORDERED or PARTIALLY_RECEIVED orders can be received');
    }

    const allReceived = po.items.every(
      (item) => Number(item.receivedQuantity) >= Number(item.quantity),
    );

    const newStatus = allReceived
      ? PurchaseOrderStatus.RECEIVED
      : PurchaseOrderStatus.PARTIALLY_RECEIVED;

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: newStatus,
        deliveredDate: allReceived ? new Date() : undefined,
        version: { increment: 1 },
      },
      include: { items: true, supplierDetail: true },
    });

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

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CLOSED, version: { increment: 1 } },
      include: { items: true, supplierDetail: true },
    });

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

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.CANCELLED,
        cancelledById: userId,
        cancelledAt: new Date(),
        cancelReason: reason ?? null,
        version: { increment: 1 },
      },
      include: { items: true, supplierDetail: true },
    });

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
        this.prisma.purchaseOrder.count({
          where: { tenantId, status, deletedAt: null },
        }).then((count) => ({ status, count })),
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
      totalValue: aggregate._sum.total ?? 0,
      averageValue: aggregate._avg.total ?? 0,
      totalOrders: aggregate._count.id ?? 0,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
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
    if (po.status !== PurchaseOrderStatus.ORDERED && po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException('Can only receive goods for ORDERED or PARTIALLY_RECEIVED orders');
    }

    const grnNumber = await this.generateGRNNumber(tenantId);

    const result = await this.prisma.$transaction(async (tx) => {
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
          items: {
            create: dto.items.map((item) => ({
              purchaseOrderItemId: item.purchaseOrderItemId,
              inventoryItemId: item.inventoryItemId,
              tenantId,
              quantityReceived: item.quantityReceived,
              unitPrice: item.unitPrice ?? 0,
              batchNumber: item.batchNumber,
              lotNumber: item.lotNumber,
              expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
              notes: item.notes,
            })),
          },
        },
        include: { items: true },
      });

      for (const item of dto.items) {
        await tx.purchaseOrderItem.update({
          where: { id: item.purchaseOrderItemId },
          data: {
            receivedQuantity: { increment: item.quantityReceived },
          },
        });

        const invItem = await tx.inventoryItem.findFirst({
          where: { id: item.inventoryItemId, tenantId },
        });
        if (!invItem) throw new NotFoundException(`Inventory item ${item.inventoryItemId} not found`);

        const unitPrice = item.unitPrice ?? 0;
        const totalCost = Number((item.quantityReceived * unitPrice).toFixed(4));
        const currentQty = Number(invItem.currentQuantity);
        const currentAvgCost = Number(invItem.averageCost ?? 0);
        const newQty = currentQty + Number(item.quantityReceived);
        const newAvgCost = newQty > 0
          ? Number(((currentAvgCost * currentQty + totalCost) / newQty).toFixed(4))
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

        if (item.batchNumber || item.lotNumber || item.expiryDate) {
          const existingBatch = await tx.inventoryBatch.findFirst({
            where: {
              inventoryItemId: item.inventoryItemId,
              tenantId,
              batchNumber: item.batchNumber ?? null,
              lotNumber: item.lotNumber ?? null,
              expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
              isActive: true,
            },
          });

          if (existingBatch) {
            await tx.inventoryBatch.update({
              where: { id: existingBatch.id },
              data: {
                quantity: { increment: item.quantityReceived },
              },
            });
          } else {
            await tx.inventoryBatch.create({
              data: {
                inventoryItemId: item.inventoryItemId,
                tenantId,
                batchNumber: item.batchNumber,
                lotNumber: item.lotNumber,
                expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
                quantity: item.quantityReceived,
                unitCost: unitPrice,
              },
            });
          }
        }
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
      await tx.goodsReceipt.update({
        where: { id },
        data: { status: GoodsReceiptStatus.CANCELLED },
      });

      for (const item of grn.items) {
        await tx.purchaseOrderItem.update({
          where: { id: item.purchaseOrderItemId! },
          data: {
            receivedQuantity: { decrement: item.quantityReceived },
          },
        });

        const invItem = await tx.inventoryItem.findFirst({
          where: { id: item.inventoryItemId!, tenantId },
        });
        if (invItem) {
          const currentQty = Number(invItem.currentQuantity);
          const receivedQty = Number(item.quantityReceived);
          const newQty = Math.max(0, currentQty - receivedQty);
          const newAvailable = Math.max(0, Number(invItem.availableQuantity) - receivedQty);

          await tx.inventoryItem.update({
            where: { id: item.inventoryItemId! },
            data: {
              currentQuantity: newQty,
              availableQuantity: newAvailable,
              version: { increment: 1 },
            },
          });

          await tx.stockMovement.create({
            data: {
              inventoryItemId: item.inventoryItemId!,
              tenantId,
              branchId: grn.branchId,
              type: StockMovementType.ADJUSTMENT,
              quantity: -item.quantityReceived,
              unitCost: item.unitPrice,
              totalCost: Number((-Number(item.quantityReceived) * Number(item.unitPrice ?? 0)).toFixed(4)),
              referenceType: 'GoodsReceipt',
              referenceId: grn.id,
              notes: `GRN cancellation ${grn.grnNumber}`,
              recordedById: userId,
            },
          });

          await tx.inventoryBatch.updateMany({
            where: {
              inventoryItemId: item.inventoryItemId!,
              tenantId,
              isActive: true,
            },
            data: {
              quantity: { decrement: item.quantityReceived },
            },
          });
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
    this.gateway.broadcastGoodsReceived(tenantId, 'goods.cancelled', { id });

    return { id, status: GoodsReceiptStatus.CANCELLED };
  }

  private async generateGRNNumber(tenantId: string): Promise<string> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `GRN-${datePart}-`;

    const lastGRN = await this.prisma.goodsReceipt.findFirst({
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
