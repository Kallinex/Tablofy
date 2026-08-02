import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  ExpirationAlertType,
  NotificationType,
  ReportStatus,
  ReportType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService, QueueJobData } from '../queues/queue.service';

interface InventoryJobData extends QueueJobData {
  tenantId?: string;
}

interface LowStockPayload {
  branchId?: string;
}

interface ExpirationPayload {
  days?: number;
  branchId?: string;
}

interface WasteReportPayload {
  period?: 'day' | 'week' | 'month';
}

const DEFAULT_EXPIRATION_WINDOW_DAYS = 30;

@Injectable()
export class InventoryProcessor {
  private readonly logger = new Logger(InventoryProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly prisma: PrismaService,
  ) {
    this.queueService.registerWorker('inventory-sync', this.handleInventorySync.bind(this));
    this.queueService.registerWorker('low-stock-alerts', this.handleLowStockAlerts.bind(this));
    this.queueService.registerWorker('expiration-checks', this.handleExpirationChecks.bind(this));
    this.queueService.registerWorker('waste-reports', this.handleWasteReports.bind(this));
  }

  private tenantScope(tenantId?: string): Record<string, string> {
    return tenantId ? { tenantId } : {};
  }

  private async handleLowStockAlerts(job: Job<InventoryJobData>) {
    const { tenantId } = job.data;
    const payload = (job.data.payload ?? {}) as LowStockPayload;

    const items = await this.prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...this.tenantScope(tenantId),
        ...(payload.branchId ? { locationId: payload.branchId } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        sku: true,
        currentQuantity: true,
        minStock: true,
        reorderLevel: true,
      },
    });

    const lowStockItems = items.filter(
      (item) =>
        item.currentQuantity !== null &&
        ((item.reorderLevel !== null && item.currentQuantity.lte(item.reorderLevel)) ||
          (item.minStock !== null && item.currentQuantity.lte(item.minStock))),
    );

    if (lowStockItems.length === 0) {
      return { processed: true, tenantId, lowStockCount: 0 };
    }

    const tenants = Array.from(new Set(lowStockItems.map((item) => item.tenantId)));
    const recipients = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        role: { in: [UserRole.OWNER, UserRole.MANAGER] },
        tenantId: { in: tenants },
      },
      select: { id: true, tenantId: true },
    });

    const notifications: Array<{
      tenantId: string;
      userId: string;
      title: string;
      message: string;
      type: NotificationType;
    }> = [];
    for (const item of lowStockItems) {
      for (const user of recipients) {
        if (user.tenantId !== item.tenantId) {
          continue;
        }
        notifications.push({
          tenantId: item.tenantId,
          userId: user.id,
          title: 'Low stock alert',
          message: `Item "${item.name}" (${item.sku ?? 'no SKU'}) is at ${item.currentQuantity.toString()} units, below its reorder level.`,
          type: NotificationType.LOW_STOCK,
        });
      }
    }

    if (notifications.length > 0) {
      await this.prisma.notification.createMany({ data: notifications });
    }

    for (const tenant of tenants) {
      const tenantItems = lowStockItems.filter((item) => item.tenantId === tenant);
      await this.queueService.addJob('notification', 'low-stock-alert', {
        tenantId: tenant,
        payload: { items: tenantItems.map((item) => item.id) },
      });
    }

    this.logger.log(
      `Low stock: ${lowStockItems.length} item(s) below reorder level for ${tenants.length} tenant(s)`,
    );
    return { processed: true, tenantId, lowStockCount: lowStockItems.length };
  }

  private async handleExpirationChecks(job: Job<InventoryJobData>) {
    const { tenantId } = job.data;
    const payload = (job.data.payload ?? {}) as ExpirationPayload;
    const days = payload.days ?? DEFAULT_EXPIRATION_WINDOW_DAYS;
    const windowEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        expiryDate: { not: null, lte: windowEnd },
        ...this.tenantScope(tenantId),
      },
      include: { inventoryItem: { select: { tenantId: true, name: true, sku: true } } },
    });

    if (batches.length === 0) {
      return { processed: true, tenantId, expiringBatchCount: 0 };
    }

    const existingAlerts = await this.prisma.expirationAlert.findMany({
      where: {
        tenantId: { in: Array.from(new Set(batches.map((b) => b.inventoryItem.tenantId))) },
        resolvedAt: null,
      },
      select: { inventoryItemId: true, batchNumber: true },
    });
    const alertedKeys = new Set(
      existingAlerts.map((alert) => `${alert.inventoryItemId}:${alert.batchNumber ?? ''}`),
    );

    const now = Date.now();
    const alerts: Array<{
      inventoryItemId: string;
      tenantId: string;
      batchNumber: string | null;
      expiryDate: Date;
      alertType: ExpirationAlertType;
      message: string;
    }> = [];
    for (const batch of batches) {
      if (!batch.expiryDate) {
        continue;
      }
      const key = `${batch.inventoryItemId}:${batch.batchNumber ?? ''}`;
      if (alertedKeys.has(key)) {
        continue;
      }
      const expiresAt = batch.expiryDate.getTime();
      const daysRemaining = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
      const alertType =
        daysRemaining < 0
          ? ExpirationAlertType.EXPIRED
          : daysRemaining <= 7
            ? ExpirationAlertType.CRITICAL
            : ExpirationAlertType.WARNING;
      alerts.push({
        inventoryItemId: batch.inventoryItemId,
        tenantId: batch.inventoryItem.tenantId,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        alertType,
        message: `Batch${batch.batchNumber ? ` ${batch.batchNumber}` : ''} of "${batch.inventoryItem.name}"${
          daysRemaining < 0 ? ' has expired' : ` expires in ${daysRemaining} day(s)`
        }.`,
      });
    }

    if (alerts.length > 0) {
      await this.prisma.expirationAlert.createMany({ data: alerts });
    }

    const tenants = Array.from(new Set(alerts.map((alert) => alert.tenantId)));
    for (const tenant of tenants) {
      const tenantAlerts = alerts.filter((alert) => alert.tenantId === tenant);
      await this.queueService.addJob('notification', 'expiration-alert', {
        tenantId: tenant,
        payload: {
          alertCount: tenantAlerts.length,
          inventoryItemIds: tenantAlerts.map((a) => a.inventoryItemId),
        },
      });
    }

    this.logger.log(
      `Expiration check: ${alerts.length} batch(es) expiring within ${days} day(s) across ${tenants.length} tenant(s)`,
    );
    return { processed: true, tenantId, expiringBatchCount: alerts.length };
  }

  private async handleWasteReports(job: Job<InventoryJobData>) {
    const { tenantId } = job.data;
    const payload = (job.data.payload ?? {}) as WasteReportPayload;
    const period = payload.period ?? 'month';
    const from = this.periodStart(period);

    if (!tenantId) {
      return { processed: false, reason: 'tenantId is required for waste reports' };
    }

    const wasteEntries = await this.prisma.wasteEntry.findMany({
      where: { tenantId, deletedAt: null, createdAt: { gte: from } },
      select: { quantity: true, totalCost: true, type: true },
    });

    const byType: Record<string, { entries: number; quantity: string }> = {};
    let totalQuantity = 0;
    let totalCost = 0;
    for (const entry of wasteEntries) {
      const quantity = Number(entry.quantity);
      const cost = Number(entry.totalCost ?? 0);
      totalQuantity += quantity;
      totalCost += cost;
      const bucket = byType[entry.type] ?? { entries: 0, quantity: '0' };
      bucket.entries += 1;
      bucket.quantity = String(Number(bucket.quantity) + quantity);
      byType[entry.type] = bucket;
    }

    await this.prisma.report.create({
      data: {
        tenantId,
        type: ReportType.INVENTORY,
        title: `Waste report (${period})`,
        description: 'Aggregated waste entries for the selected period',
        parameters: { period, from: from.toISOString() },
        status: ReportStatus.GENERATED,
        generatedAt: new Date(),
        result: {
          period,
          totalEntries: wasteEntries.length,
          totalQuantity,
          totalCost,
          byType,
        },
      },
    });

    this.logger.log(
      `Waste report (${period}) for tenant ${tenantId}: ${wasteEntries.length} entrie(s), ${totalQuantity} units, cost ${totalCost}`,
    );
    return { processed: true, tenantId, period, totalEntries: wasteEntries.length };
  }

  private async handleInventorySync(job: Job<InventoryJobData>) {
    const { tenantId } = job.data;
    const scope = this.tenantScope(tenantId);

    const [itemCount, batchCount, movementCount, adjustmentCount, wasteCount, alertCount] =
      await Promise.all([
        this.prisma.inventoryItem.count({ where: { deletedAt: null, ...scope } }),
        this.prisma.inventoryBatch.count({ where: { deletedAt: null, isActive: true, ...scope } }),
        this.prisma.stockMovement.count({ where: { deletedAt: null, ...scope } }),
        this.prisma.stockAdjustment.count({ where: { deletedAt: null, ...scope } }),
        this.prisma.wasteEntry.count({ where: { deletedAt: null, ...scope } }),
        this.prisma.expirationAlert.count({ where: { deletedAt: null, ...scope } }),
      ]);

    const itemsWithBatches = await this.prisma.inventoryItem.findMany({
      where: { deletedAt: null, ...scope },
      select: {
        id: true,
        name: true,
        currentQuantity: true,
        batches: {
          where: { deletedAt: null, isActive: true },
          select: { quantity: true },
        },
      },
    });

    let mismatches = 0;
    let matchedItems = 0;
    for (const item of itemsWithBatches) {
      const batchTotal = item.batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
      if (Math.abs(Number(item.currentQuantity) - batchTotal) > 0.0001) {
        mismatches += 1;
      } else {
        matchedItems += 1;
      }
    }

    const summary = {
      tenantId,
      items: itemCount,
      activeBatches: batchCount,
      stockMovements: movementCount,
      stockAdjustments: adjustmentCount,
      wasteEntries: wasteCount,
      expirationAlerts: alertCount,
      reconciledItems: matchedItems,
      quantityMismatches: mismatches,
    };

    this.logger.log(`Inventory sync complete: ${JSON.stringify(summary)}`);
    return { processed: true, ...summary };
  }

  private periodStart(period: 'day' | 'week' | 'month'): Date {
    const now = new Date();
    switch (period) {
      case 'day':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
      default:
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }
}
