import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { I18nService } from '../../common/i18n/i18n.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async create(tenantId: string, type = 'FULL', lang: string) {
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

      if (data.menuCategories) {
        for (const cat of data.menuCategories) {
          await this.prisma.menuCategory.upsert({
            where: { id: cat.id },
            create: cat,
            update: cat,
          });
        }
      }

      await this.prisma.backupRecord.update({
        where: { id },
        data: { verificationStatus: 'RESTORED' },
      });

      return {
        message: this.i18n.t('backup.restored', lang),
        restoredCategories: data.menuCategories?.length ?? 0,
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
    const [menuCategories, products, customers, orders] = await Promise.all([
      this.prisma.menuCategory.findMany({ where: { tenantId } }),
      this.prisma.product.findMany({ where: { tenantId } }),
      this.prisma.customer.findMany({ where: { tenantId } }),
      this.prisma.order.findMany({ where: { tenantId }, take: 1000 }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      tenantId,
      menuCategories,
      products,
      customers,
      orders,
    };
  }
}
