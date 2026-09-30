import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { CacheService } from '../../common/services/cache.service';
import { BackupRecordType } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly cacheService: CacheService,
  ) {}

  async create(tenantId: string, type: BackupRecordType = BackupRecordType.FULL, lang: string) {
    const inProgress = await this.prisma.backupRecord.findFirst({
      where: { tenantId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    });
    if (inProgress) {
      throw new BadRequestException(this.i18n.t('backup.inProgress', lang));
    }

    const record = await this.prisma.backupRecord.create({
      data: {
        tenantId,
        type,
        status: 'IN_PROGRESS',
        retentionDays: 30,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        startedAt: new Date(),
      },
    });

    try {
      const backupDir = path.join(process.cwd(), 'backups');
      await fs.mkdir(backupDir, { recursive: true });

      const data = await this.collectBackupData(tenantId);
      const content = JSON.stringify(data, null, 2);
      const checksum = crypto.createHash('sha256').update(content).digest('hex');

      const filename = `backup-${tenantId}-${record.id}-${Date.now()}.json`;
      const filePath = path.join(backupDir, filename);
      await fs.writeFile(filePath, content);

      const stat = await fs.stat(filePath);

      return this.prisma.backupRecord.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          filePath,
          fileSize: stat.size,
          checksum,
          completedAt: new Date(),
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      });
    }
  }

  async findAll(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.backupRecord.findMany({
        where: { tenantId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.backupRecord.count({ where: { tenantId } }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(tenantId: string, id: string, lang: string) {
    const record = await this.prisma.backupRecord.findFirst({ where: { id, tenantId } });
    if (!record) {
      throw new NotFoundException(this.i18n.t('backup.notFound', lang));
    }
    return record;
  }

  async verify(tenantId: string, id: string, lang: string) {
    const record = await this.findOne(tenantId, id, lang);
    if (!record.filePath) {
      throw new BadRequestException(this.i18n.t('backup.notFound', lang));
    }

    try {
      const content = await fs.readFile(record.filePath, 'utf-8');
      const checksum = crypto.createHash('sha256').update(content).digest('hex');
      const valid = checksum === record.checksum;

      await this.prisma.backupRecord.update({
        where: { id },
        data: { verifiedAt: new Date(), verificationStatus: valid ? 'VALID' : 'INVALID' },
      });

      return { valid, checksum, expectedChecksum: record.checksum };
    } catch {
      throw new BadRequestException(this.i18n.t('backup.notFound', lang));
    }
  }

  async restore(tenantId: string, id: string, lang: string) {
    const record = await this.findOne(tenantId, id, lang);
    if (record.status !== 'COMPLETED' || !record.filePath) {
      throw new BadRequestException('Backup is not available for restore');
    }

    try {
      const content = await fs.readFile(record.filePath, 'utf-8');
      const data = JSON.parse(content);

      if (data.tenantId && data.tenantId !== tenantId) {
        throw new Error('Backup file belongs to a different tenant');
      }

      const restored: Record<string, number> = {
        restaurants: 0,
        branches: 0,
        floors: 0,
        diningAreas: 0,
        tables: 0,
        menuCategories: 0,
        products: 0,
        customers: 0,
        orders: 0,
        orderItems: 0,
        orderItemModifiers: 0,
        orderStatusHistory: 0,
        orderNotes: 0,
        payments: 0,
      };

      if (Array.isArray(data.restaurants)) {
        for (const restaurant of data.restaurants) {
          const { id, ...rest } = restaurant;
          await this.prisma.restaurant.upsert({
            where: { id },
            create: { ...rest, id, tenantId },
            update: { ...rest, tenantId },
          });
          restored.restaurants++;
        }
      }

      if (Array.isArray(data.branches)) {
        for (const branch of data.branches) {
          const { id, ...rest } = branch;
          await this.prisma.branch.upsert({
            where: { id },
            create: { ...rest, id, tenantId },
            update: { ...rest, tenantId },
          });
          restored.branches++;
        }
      }

      if (Array.isArray(data.floors)) {
        for (const floor of data.floors) {
          const { id, ...rest } = floor;
          await this.prisma.floor.upsert({
            where: { id },
            create: { ...rest, id, tenantId },
            update: { ...rest, tenantId },
          });
          restored.floors++;
        }
      }

      if (Array.isArray(data.diningAreas)) {
        for (const area of data.diningAreas) {
          const { id, ...rest } = area;
          await this.prisma.diningArea.upsert({
            where: { id },
            create: { ...rest, id, tenantId },
            update: { ...rest, tenantId },
          });
          restored.diningAreas++;
        }
      }

      if (Array.isArray(data.tables)) {
        for (const table of data.tables) {
          const { id, ...rest } = table;
          await this.prisma.table.upsert({
            where: { id },
            create: { ...rest, id, tenantId },
            update: { ...rest, tenantId },
          });
          restored.tables++;
        }
      }

      if (Array.isArray(data.menuCategories)) {
        for (const cat of data.menuCategories) {
          await this.prisma.menuCategory.upsert({
            where: { id: cat.id },
            create: { ...cat, id: cat.id, tenantId },
            update: { ...cat, tenantId },
          });
          restored.menuCategories++;
        }
      }

      if (Array.isArray(data.products)) {
        for (const product of data.products) {
          const { id, ...rest } = product;
          await this.prisma.product.upsert({
            where: { id },
            create: { ...rest, id, tenantId },
            update: { ...rest, tenantId },
          });
          restored.products++;
        }
      }

      if (Array.isArray(data.customers)) {
        for (const customer of data.customers) {
          const { id, ...rest } = customer;
          await this.prisma.customer.upsert({
            where: { id },
            create: { ...rest, id, tenantId },
            update: { ...rest, tenantId },
          });
          restored.customers++;
        }
      }

      if (Array.isArray(data.orders)) {
        const restoredTableIds = new Set<string>();
        for (const table of data.tables ?? []) {
          if (table?.id) restoredTableIds.add(table.id);
        }
        for (const order of data.orders) {
          const { id, ...rest } = order;
          const tableId =
            order.tableId && restoredTableIds.has(order.tableId) ? order.tableId : null;
          await this.prisma.order.upsert({
            where: { id },
            create: {
              ...rest,
              id,
              tenantId,
              userId: null,
              serviceChargeId: null,
              taxRateId: null,
              tableId,
            },
            update: {
              ...rest,
              tenantId,
              userId: null,
              serviceChargeId: null,
              taxRateId: null,
              tableId,
            },
          });
          restored.orders++;
        }
      }

      if (Array.isArray(data.orderItems)) {
        for (const item of data.orderItems) {
          const { id, ...rest } = item;
          await this.prisma.orderItem.upsert({
            where: { id },
            create: { ...rest, id, tenantId },
            update: { ...rest, tenantId },
          });
          restored.orderItems++;
        }
      }

      if (Array.isArray(data.orderItemModifiers)) {
        for (const modifier of data.orderItemModifiers) {
          const { id, ...rest } = modifier;
          await this.prisma.orderItemModifier.upsert({
            where: { id },
            create: { ...rest, id, tenantId },
            update: { ...rest, tenantId },
          });
          restored.orderItemModifiers++;
        }
      }

      if (Array.isArray(data.orderStatusHistory)) {
        for (const entry of data.orderStatusHistory) {
          const { id, ...rest } = entry;
          await this.prisma.orderStatusHistory.upsert({
            where: { id },
            create: { ...rest, id, tenantId, changedByUserId: null },
            update: { ...rest, tenantId, changedByUserId: null },
          });
          restored.orderStatusHistory++;
        }
      }

      if (Array.isArray(data.orderNotes)) {
        for (const note of data.orderNotes) {
          const { id, ...rest } = note;
          await this.prisma.orderNote.upsert({
            where: { id },
            create: { ...rest, id, tenantId, userId: null },
            update: { ...rest, tenantId, userId: null },
          });
          restored.orderNotes++;
        }
      }

      if (Array.isArray(data.payments)) {
        for (const payment of data.payments) {
          const { id, ...rest } = payment;
          await this.prisma.payment.upsert({
            where: { id },
            create: { ...rest, id, tenantId },
            update: { ...rest, tenantId },
          });
          restored.payments++;
        }
      }

      const notRestored: Record<string, number> = {};

      // Restored rows would otherwise stay hidden behind the cached menu/customer
      // lists until their TTL expires.
      const restaurantIds = new Set<string>();
      for (const cat of data.menuCategories ?? []) {
        if (cat.restaurantId) restaurantIds.add(cat.restaurantId);
      }
      for (const product of data.products ?? []) {
        if (product.restaurantId) restaurantIds.add(product.restaurantId);
      }
      for (const restaurantId of restaurantIds) {
        await this.cacheService.deletePattern(tenantId, `menu:${restaurantId}:*`);
      }
      await this.cacheService.delete(tenantId, 'customers:list');
      await this.cacheService.deletePattern(tenantId, 'list:*');
      for (const order of data.orders ?? []) {
        if (order.id) await this.cacheService.delete(tenantId, `one:${order.id}`);
      }

      await this.prisma.backupRecord.update({
        where: { id },
        data: { verificationStatus: 'RESTORED' },
      });

      return {
        message: this.i18n.t('backup.restored', lang),
        restored,
        notRestored,
        exportedAt: data.exportedAt ?? null,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new BadRequestException(`Restore failed: ${message}`);
    }
  }

  async deleteExpired() {
    const expired = await this.prisma.backupRecord.findMany({
      where: { expiresAt: { lte: new Date() }, status: 'COMPLETED' },
    });
    for (const record of expired) {
      if (record.filePath) {
        try {
          await fs.unlink(record.filePath);
        } catch {
          /* file may not exist */
        }
      }
    }
    await this.prisma.backupRecord.updateMany({
      where: { id: { in: expired.map((r) => r.id) } },
      data: { status: 'EXPIRED' },
    });
    return expired.length;
  }

  private async collectBackupData(tenantId: string) {
    const [
      restaurants,
      branches,
      floors,
      diningAreas,
      tables,
      menuCategories,
      products,
      customers,
      orders,
    ] = await Promise.all([
      this.prisma.restaurant.findMany({ where: { tenantId } }),
      this.prisma.branch.findMany({ where: { tenantId } }),
      this.prisma.floor.findMany({ where: { tenantId } }),
      this.prisma.diningArea.findMany({ where: { tenantId } }),
      this.prisma.table.findMany({ where: { tenantId } }),
      this.prisma.menuCategory.findMany({ where: { tenantId } }),
      this.prisma.product.findMany({ where: { tenantId } }),
      this.prisma.customer.findMany({ where: { tenantId } }),
      this.prisma.order.findMany({ where: { tenantId }, take: 1000 }),
    ]);
    const [orderItems, orderItemModifiers, orderStatusHistory, orderNotes, payments] =
      await Promise.all([
        this.prisma.orderItem.findMany({ where: { tenantId }, take: 3000 }),
        this.prisma.orderItemModifier.findMany({ where: { tenantId }, take: 3000 }),
        this.prisma.orderStatusHistory.findMany({ where: { tenantId }, take: 3000 }),
        this.prisma.orderNote.findMany({ where: { tenantId }, take: 1000 }),
        this.prisma.payment.findMany({ where: { tenantId }, take: 3000 }),
      ]);
    return {
      exportedAt: new Date().toISOString(),
      tenantId,
      restaurants,
      branches,
      floors,
      diningAreas,
      tables,
      menuCategories,
      products,
      customers,
      orders,
      orderItems,
      orderItemModifiers,
      orderStatusHistory,
      orderNotes,
      payments,
    };
  }
}
