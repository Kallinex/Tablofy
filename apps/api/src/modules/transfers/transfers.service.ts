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
import { TransfersGateway } from './transfers.gateway';
import { Prisma, TransferStatus, StockMovementType } from '@prisma/client';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { QueryTransferDto } from './dto/query-transfer.dto';
import { ReceiveTransferDto } from './dto/receive-transfer.dto';

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gateway: TransfersGateway,
  ) {}

  // ============================================
  // Branch Transfers
  // ============================================

  async createTransfer(dto: CreateTransferDto, tenantId: string, userId: string) {
    if (dto.fromBranchId === dto.toBranchId) {
      throw new BadRequestException('Source and destination branches must be different');
    }

    const [fromBranch, toBranch] = await Promise.all([
      this.prisma.branch.findFirst({ where: { id: dto.fromBranchId, tenantId } }),
      this.prisma.branch.findFirst({ where: { id: dto.toBranchId, tenantId } }),
    ]);

    if (!fromBranch) throw new NotFoundException('Source branch not found');
    if (!toBranch) throw new NotFoundException('Destination branch not found');

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
    const transferNumber = `TRF-${datePart}-${randomPart}`;

    const existing = await this.prisma.branchTransfer.findFirst({
      where: { tenantId, transferNumber, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('Transfer number collision, please retry');
    }

    const transfer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.branchTransfer.create({
        data: {
          transferNumber,
          tenantId,
          fromBranchId: dto.fromBranchId,
          toBranchId: dto.toBranchId,
          notes: dto.notes,
          status: TransferStatus.DRAFT,
          requestedById: userId,
          items: {
            create: dto.items.map((item) => ({
              inventoryItemId: item.inventoryItemId,
              tenantId,
              quantity: item.quantity,
              unitCost: item.unitCost,
              notes: item.notes,
            })),
          },
        },
        include: {
          items: { include: { inventoryItem: true } },
          fromBranch: true,
          toBranch: true,
        },
      });

      return created;
    });

    await this.auditLogsService.log({
      action: 'TRANSFER_CREATED',
      resource: 'BranchTransfer',
      resourceId: transfer.id,
      userId,
      tenantId,
      newValues: {
        transferNumber,
        fromBranchId: dto.fromBranchId,
        toBranchId: dto.toBranchId,
        itemCount: dto.items.length,
      },
    });

    await this.cacheService.delete(tenantId, 'transfers:list');
    this.gateway.broadcastTransferUpdate(tenantId, 'transfer.created', transfer);

    return this.getTransfer(transfer.id, tenantId);
  }

  async getTransfer(id: string, tenantId: string) {
    const cacheKey = `transfer:${id}`;
    const cached = await this.cacheService.get<Record<string, unknown>>(tenantId, cacheKey);
    if (cached) return cached;

    const transfer = await this.prisma.branchTransfer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        items: { include: { inventoryItem: true } },
        fromBranch: true,
        toBranch: true,
      },
    });

    if (!transfer) throw new NotFoundException('Transfer not found');
    await this.cacheService.set(tenantId, cacheKey, transfer, 300);
    return transfer;
  }

  async listTransfers(tenantId: string, query: QueryTransferDto) {
    const cacheKey = `transfers:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.BranchTransferWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.fromBranchId) where.fromBranchId = query.fromBranchId;
    if (query.toBranchId) where.toBranchId = query.toBranchId;

    if (query.search) {
      where.OR = [
        { transferNumber: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.BranchTransferOrderByWithRelationInput = {};
    if (query.sortBy === 'transferNumber') orderBy.transferNumber = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'status') orderBy.status = query.sortOrder ?? 'asc';
    else if (query.sortBy === 'createdAt') orderBy.createdAt = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'updatedAt') orderBy.updatedAt = query.sortOrder ?? 'desc';
    else orderBy.createdAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.branchTransfer.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          items: { include: { inventoryItem: true } },
          fromBranch: true,
          toBranch: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.branchTransfer.count({ where }),
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

  async updateTransfer(id: string, dto: UpdateTransferDto, tenantId: string, userId: string) {
    const transfer = await this.prisma.branchTransfer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: true },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== TransferStatus.DRAFT) {
      throw new BadRequestException('Only draft transfers can be updated');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.branchTransferItem.deleteMany({ where: { branchTransferId: id } });
        await tx.branchTransferItem.createMany({
          data: dto.items.map((item) => ({
            branchTransferId: id,
            inventoryItemId: item.inventoryItemId,
            tenantId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            notes: item.notes,
          })),
        });
      }

      return tx.branchTransfer.update({
        where: { id },
        data: {
          fromBranchId: dto.fromBranchId,
          toBranchId: dto.toBranchId,
          notes: dto.notes,
        },
        include: {
          items: { include: { inventoryItem: true } },
          fromBranch: true,
          toBranch: true,
        },
      });
    });

    await this.auditLogsService.log({
      action: 'TRANSFER_UPDATED',
      resource: 'BranchTransfer',
      resourceId: id,
      userId,
      tenantId,
      oldValues: transfer as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.cacheService.delete(tenantId, `transfer:${id}`);
    await this.cacheService.delete(tenantId, 'transfers:list');
    this.gateway.broadcastTransferUpdate(tenantId, 'transfer.updated', updated);

    return updated;
  }

  async deleteTransfer(id: string, tenantId: string, userId: string) {
    const transfer = await this.prisma.branchTransfer.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== TransferStatus.DRAFT) {
      throw new BadRequestException('Only draft transfers can be deleted');
    }

    await this.prisma.branchTransfer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'TRANSFER_DELETED',
      resource: 'BranchTransfer',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { transferNumber: transfer.transferNumber, status: transfer.status },
    });

    await this.cacheService.delete(tenantId, `transfer:${id}`);
    await this.cacheService.delete(tenantId, 'transfers:list');
    this.gateway.broadcastTransferUpdate(tenantId, 'transfer.deleted', { id });
  }

  async submitTransfer(id: string, tenantId: string, userId: string) {
    const transfer = await this.prisma.branchTransfer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: true },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== TransferStatus.DRAFT) {
      throw new BadRequestException('Only draft transfers can be submitted');
    }
    if (transfer.items.length === 0) {
      throw new BadRequestException('Transfer must have at least one item');
    }

    const updated = await this.prisma.branchTransfer.update({
      where: { id },
      data: { status: TransferStatus.PENDING },
      include: {
        items: { include: { inventoryItem: true } },
        fromBranch: true,
        toBranch: true,
      },
    });

    await this.auditLogsService.log({
      action: 'TRANSFER_SUBMITTED',
      resource: 'BranchTransfer',
      resourceId: id,
      userId,
      tenantId,
      newValues: { status: TransferStatus.PENDING },
    });

    await this.cacheService.delete(tenantId, `transfer:${id}`);
    await this.cacheService.delete(tenantId, 'transfers:list');
    this.gateway.broadcastTransferUpdate(tenantId, 'transfer.submitted', updated);

    return updated;
  }

  async approveTransfer(id: string, tenantId: string, userId: string, _userRole?: string) {
    const transfer = await this.prisma.branchTransfer.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== TransferStatus.PENDING) {
      throw new BadRequestException('Only pending transfers can be approved');
    }

    const updated = await this.prisma.branchTransfer.update({
      where: { id },
      data: {
        status: TransferStatus.APPROVED,
        approvedById: userId,
        approvedAt: new Date(),
      },
      include: {
        items: { include: { inventoryItem: true } },
        fromBranch: true,
        toBranch: true,
      },
    });

    await this.auditLogsService.log({
      action: 'TRANSFER_APPROVED',
      resource: 'BranchTransfer',
      resourceId: id,
      userId,
      tenantId,
      newValues: { status: TransferStatus.APPROVED, approvedBy: userId },
    });

    await this.cacheService.delete(tenantId, `transfer:${id}`);
    await this.cacheService.delete(tenantId, 'transfers:list');
    this.gateway.broadcastTransferUpdate(tenantId, 'transfer.approved', updated);

    return updated;
  }

  async startTransfer(id: string, tenantId: string, userId: string) {
    const transfer = await this.prisma.branchTransfer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: { include: { inventoryItem: true } } },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== TransferStatus.APPROVED) {
      throw new BadRequestException('Only approved transfers can be dispatched');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        if (!item.inventoryItemId) continue;

        const inventoryItem = await tx.inventoryItem.findFirst({
          where: { id: item.inventoryItemId, tenantId },
        });
        if (!inventoryItem) {
          throw new NotFoundException(`Inventory item ${item.inventoryItemId} not found`);
        }

        const qty = Number(item.quantity);
        const currentQty = Number(inventoryItem.currentQuantity);

        if (currentQty < qty) {
          throw new BadRequestException(
            `Insufficient quantity for item "${inventoryItem.name}". Available: ${currentQty}, required: ${qty}`,
          );
        }

        await tx.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            currentQuantity: { decrement: qty },
            availableQuantity: { decrement: qty },
            version: { increment: 1 },
          },
        });

        await tx.stockMovement.create({
          data: {
            inventoryItemId: item.inventoryItemId,
            tenantId,
            branchId: transfer.fromBranchId,
            type: StockMovementType.TRANSFER_OUT,
            quantity: -qty,
            unitCost: item.unitCost ?? inventoryItem.averageCost,
            totalCost: item.unitCost
              ? -Number(item.unitCost) * qty
              : -(Number(inventoryItem.averageCost ?? 0) * qty),
            referenceType: 'BranchTransfer',
            referenceId: transfer.id,
            notes: `Transfer OUT to ${transfer.toBranchId} | ${item.notes ?? ''}`,
            recordedById: userId,
          },
        });
      }

      return tx.branchTransfer.update({
        where: { id },
        data: {
          status: TransferStatus.IN_TRANSIT,
        },
        include: {
          items: { include: { inventoryItem: true } },
          fromBranch: true,
          toBranch: true,
        },
      });
    });

    await this.auditLogsService.log({
      action: 'TRANSFER_STARTED',
      resource: 'BranchTransfer',
      resourceId: id,
      userId,
      tenantId,
      newValues: { status: TransferStatus.IN_TRANSIT },
    });

    await this.cacheService.delete(tenantId, `transfer:${id}`);
    await this.cacheService.delete(tenantId, 'transfers:list');
    await this.cacheService.deletePattern(tenantId, 'movements:*');
    this.gateway.broadcastTransferUpdate(tenantId, 'transfer.started', updated);

    return updated;
  }

  async receiveTransfer(id: string, dto: ReceiveTransferDto, tenantId: string, userId: string) {
    const transfer = await this.prisma.branchTransfer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: { include: { inventoryItem: true } } },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== TransferStatus.IN_TRANSIT) {
      throw new BadRequestException('Only in-transit transfers can be received');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const receiveItem of dto.items) {
        const transferItem = transfer.items.find(
          (ti) => ti.inventoryItemId === receiveItem.inventoryItemId,
        );
        if (!transferItem) {
          throw new NotFoundException(`Item ${receiveItem.inventoryItemId} not found in transfer`);
        }

        const qtyReceived = Number(receiveItem.quantityReceived);
        const qtyOrdered = Number(transferItem.quantity);

        if (qtyReceived > qtyOrdered) {
          throw new BadRequestException(
            `Received quantity (${qtyReceived}) exceeds ordered quantity (${qtyOrdered}) for item ${receiveItem.inventoryItemId}`,
          );
        }

        await tx.branchTransferItem.update({
          where: { id: transferItem.id },
          data: {
            receivedQuantity: qtyReceived,
            notes: receiveItem.notes
              ? `${transferItem.notes ?? ''} | ${receiveItem.notes}`
              : transferItem.notes,
          },
        });

        if (receiveItem.inventoryItemId) {
          const inventoryItem = await tx.inventoryItem.findFirst({
            where: { id: receiveItem.inventoryItemId, tenantId },
          });
          if (!inventoryItem) {
            throw new NotFoundException(`Inventory item ${receiveItem.inventoryItemId} not found`);
          }

          await tx.inventoryItem.update({
            where: { id: receiveItem.inventoryItemId },
            data: {
              currentQuantity: { increment: qtyReceived },
              availableQuantity: { increment: qtyReceived },
              version: { increment: 1 },
            },
          });

          await tx.stockMovement.create({
            data: {
              inventoryItemId: receiveItem.inventoryItemId,
              tenantId,
              branchId: transfer.toBranchId,
              type: StockMovementType.TRANSFER_IN,
              quantity: qtyReceived,
              unitCost: transferItem.unitCost ?? inventoryItem.averageCost,
              totalCost: transferItem.unitCost
                ? Number(transferItem.unitCost) * qtyReceived
                : Number(inventoryItem.averageCost ?? 0) * qtyReceived,
              referenceType: 'BranchTransfer',
              referenceId: transfer.id,
              notes: `Transfer IN from ${transfer.fromBranchId} | ${receiveItem.notes ?? ''}`,
              recordedById: userId,
            },
          });
        }
      }

      return tx.branchTransfer.update({
        where: { id },
        data: {
          status: TransferStatus.RECEIVED,
          receivedById: userId,
          receivedAt: new Date(),
        },
        include: {
          items: { include: { inventoryItem: true } },
          fromBranch: true,
          toBranch: true,
        },
      });
    });

    await this.auditLogsService.log({
      action: 'TRANSFER_RECEIVED',
      resource: 'BranchTransfer',
      resourceId: id,
      userId,
      tenantId,
      newValues: {
        status: TransferStatus.RECEIVED,
        itemsReceived: dto.items.length,
      },
    });

    await this.cacheService.delete(tenantId, `transfer:${id}`);
    await this.cacheService.delete(tenantId, 'transfers:list');
    await this.cacheService.deletePattern(tenantId, 'movements:*');
    this.gateway.broadcastTransferUpdate(tenantId, 'transfer.received', updated);

    return updated;
  }

  async cancelTransfer(id: string, tenantId: string, userId: string, reason?: string) {
    const transfer = await this.prisma.branchTransfer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: { include: { inventoryItem: true } } },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (
      transfer.status === TransferStatus.RECEIVED ||
      transfer.status === TransferStatus.CANCELLED
    ) {
      throw new BadRequestException(`Cannot cancel a ${transfer.status.toLowerCase()} transfer`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (transfer.status === TransferStatus.IN_TRANSIT) {
        for (const item of transfer.items) {
          if (!item.inventoryItemId) continue;

          const inventoryItem = await tx.inventoryItem.findFirst({
            where: { id: item.inventoryItemId, tenantId },
          });
          if (!inventoryItem) continue;

          const qty = Number(item.quantity);
          await tx.inventoryItem.update({
            where: { id: item.inventoryItemId },
            data: {
              currentQuantity: { increment: qty },
              availableQuantity: { increment: qty },
              version: { increment: 1 },
            },
          });

          await tx.stockMovement.create({
            data: {
              inventoryItemId: item.inventoryItemId,
              tenantId,
              branchId: transfer.fromBranchId,
              type: StockMovementType.ADJUSTMENT,
              quantity: qty,
              unitCost: item.unitCost ?? inventoryItem.averageCost,
              referenceType: 'BranchTransfer',
              referenceId: transfer.id,
              notes: `Cancellation reversal for transfer ${transfer.transferNumber} | ${reason ?? ''}`,
              recordedById: userId,
            },
          });
        }
      }

      return tx.branchTransfer.update({
        where: { id },
        data: {
          status: TransferStatus.CANCELLED,
          cancelledById: userId,
          cancelledAt: new Date(),
          cancelReason: reason,
        },
        include: {
          items: { include: { inventoryItem: true } },
          fromBranch: true,
          toBranch: true,
        },
      });
    });

    await this.auditLogsService.log({
      action: 'TRANSFER_CANCELLED',
      resource: 'BranchTransfer',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: transfer.status },
      newValues: { status: TransferStatus.CANCELLED, reason },
    });

    await this.cacheService.delete(tenantId, `transfer:${id}`);
    await this.cacheService.delete(tenantId, 'transfers:list');
    await this.cacheService.deletePattern(tenantId, 'movements:*');
    this.gateway.broadcastTransferUpdate(tenantId, 'transfer.cancelled', updated);

    return updated;
  }

  // ============================================
  // Stock Movements
  // ============================================

  async getMovements(
    tenantId: string,
    query: {
      page?: number;
      limit?: number;
      type?: StockMovementType;
      itemId?: string;
      branchId?: string;
      fromDate?: string;
      toDate?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
  ) {
    const cacheKey = `movements:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.StockMovementWhereInput = { tenantId };

    if (query.type) where.type = query.type;
    if (query.itemId) where.inventoryItemId = query.itemId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.fromDate || query.toDate) {
      where.createdAt = {};
      if (query.fromDate) where.createdAt.gte = new Date(query.fromDate);
      if (query.toDate) where.createdAt.lte = new Date(query.toDate);
    }

    const orderBy: Prisma.StockMovementOrderByWithRelationInput = {};
    if (query.sortBy === 'createdAt') orderBy.createdAt = query.sortOrder ?? 'desc';
    else if (query.sortBy === 'type') orderBy.type = query.sortOrder ?? 'asc';
    else orderBy.createdAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          inventoryItem: true,
        },
      }),
      this.prisma.stockMovement.count({ where }),
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

  async getMovement(id: string, tenantId: string) {
    const cacheKey = `movement:${id}`;
    const cached = await this.cacheService.get<Record<string, unknown>>(tenantId, cacheKey);
    if (cached) return cached;

    const movement = await this.prisma.stockMovement.findFirst({
      where: { id, tenantId },
      include: { inventoryItem: true },
    });

    if (!movement) throw new NotFoundException('Stock movement not found');
    await this.cacheService.set(tenantId, cacheKey, movement, 300);
    return movement;
  }

  async getMovementsByItem(
    itemId: string,
    tenantId: string,
    query: {
      page?: number;
      limit?: number;
      type?: StockMovementType;
      fromDate?: string;
      toDate?: string;
    },
  ) {
    const cacheKey = `movements:item:${itemId}:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.StockMovementWhereInput = {
      inventoryItemId: itemId,
      tenantId,
    };

    if (query.type) where.type = query.type;
    if (query.fromDate || query.toDate) {
      where.createdAt = {};
      if (query.fromDate) where.createdAt.gte = new Date(query.fromDate);
      if (query.toDate) where.createdAt.lte = new Date(query.toDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { inventoryItem: true },
      }),
      this.prisma.stockMovement.count({ where }),
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
}
