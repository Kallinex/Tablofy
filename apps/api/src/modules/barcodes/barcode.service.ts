import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { BarcodeGateway } from './barcode.gateway';
import { Prisma } from '@prisma/client';
import { GenerateBarcodeDto } from './dto/generate-barcode.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BarcodeService {
  private readonly logger = new Logger(BarcodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gateway: BarcodeGateway,
  ) {}

  async generate(dto: GenerateBarcodeDto, tenantId: string, userId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.inventoryItemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    const barcode = dto.barcode ?? `BAR-${uuidv4().slice(0, 8).toUpperCase()}`;
    const qrCode = dto.qrCode ?? `QR-${uuidv4().slice(0, 12).toUpperCase()}`;

    const existingBarcode = await this.prisma.barcode.findFirst({
      where: { barcode, tenantId },
    });
    if (existingBarcode) throw new ConflictException('Barcode already exists');

    const existingQr = await this.prisma.barcode.findFirst({
      where: { qrCode, tenantId },
    });
    if (existingQr) throw new ConflictException('QR code already exists');

    if (dto.isPrimary) {
      await this.prisma.barcode.updateMany({
        where: { inventoryItemId: dto.inventoryItemId, tenantId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const barcodeEntry = await this.prisma.barcode.create({
      data: {
        inventoryItemId: dto.inventoryItemId,
        tenantId,
        barcode,
        qrCode,
        type: (dto.type as Prisma.EnumBarcodeTypeFilter['equals']) ?? 'CODE128',
        isPrimary: dto.isPrimary ?? false,
        labelTemplate: dto.labelTemplate,
        metadata: Prisma.DbNull,
      },
    });

    await this.auditLogsService.log({
      action: 'BARCODE_GENERATED',
      resource: 'Barcode',
      resourceId: barcodeEntry.id,
      userId,
      tenantId,
      newValues: {
        inventoryItemId: dto.inventoryItemId,
        barcode,
        qrCode,
        type: dto.type,
        isPrimary: dto.isPrimary,
      },
    });

    await this.invalidateCache(dto.inventoryItemId, tenantId);
    this.gateway.broadcastBarcodeUpdate(tenantId, 'barcode.created', barcodeEntry);

    return barcodeEntry;
  }

  async lookupByBarcode(code: string, tenantId: string) {
    const cacheKey = `barcode:lookup:${code}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const barcode = await this.prisma.barcode.findFirst({
      where: { barcode: code, tenantId },
      include: {
        inventoryItem: {
          include: { category: true, unit: true },
        },
      },
    });

    if (!barcode) throw new NotFoundException('Barcode not found');

    await this.cacheService.set(tenantId, cacheKey, barcode, 300);
    return barcode;
  }

  async lookupByQrCode(qrCode: string, tenantId: string) {
    const cacheKey = `barcode:lookup:qr:${qrCode}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const barcode = await this.prisma.barcode.findFirst({
      where: { qrCode, tenantId },
      include: {
        inventoryItem: {
          include: { category: true, unit: true },
        },
      },
    });

    if (!barcode) throw new NotFoundException('QR code not found');

    await this.cacheService.set(tenantId, cacheKey, barcode, 300);
    return barcode;
  }

  async getBarcodesForItem(itemId: string, tenantId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    const cacheKey = `barcodes:item:${itemId}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const barcodes = await this.prisma.barcode.findMany({
      where: { inventoryItemId: itemId, tenantId },
      orderBy: { isPrimary: 'desc' },
    });

    await this.cacheService.set(tenantId, cacheKey, barcodes, 120);
    return barcodes;
  }

  async delete(id: string, tenantId: string, userId: string) {
    const barcode = await this.prisma.barcode.findFirst({
      where: { id, tenantId },
    });
    if (!barcode) throw new NotFoundException('Barcode not found');

    await this.prisma.barcode.delete({
      where: { id },
    });

    await this.auditLogsService.log({
      action: 'BARCODE_DELETED',
      resource: 'Barcode',
      resourceId: id,
      userId,
      tenantId,
      oldValues: {
        barcode: barcode.barcode,
        qrCode: barcode.qrCode,
        inventoryItemId: barcode.inventoryItemId,
      },
    });

    await this.invalidateCache(barcode.inventoryItemId, tenantId);
    this.gateway.broadcastBarcodeUpdate(tenantId, 'barcode.deleted', { id });
  }

  async setPrimary(id: string, tenantId: string, userId: string) {
    const barcode = await this.prisma.barcode.findFirst({
      where: { id, tenantId },
    });
    if (!barcode) throw new NotFoundException('Barcode not found');

    await this.prisma.$transaction([
      this.prisma.barcode.updateMany({
        where: { inventoryItemId: barcode.inventoryItemId, tenantId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.barcode.update({
        where: { id },
        data: { isPrimary: true },
      }),
    ]);

    const updated = await this.prisma.barcode.findFirst({
      where: { id, tenantId },
    });

    await this.auditLogsService.log({
      action: 'BARCODE_SET_PRIMARY',
      resource: 'Barcode',
      resourceId: id,
      userId,
      tenantId,
      newValues: { isPrimary: true },
    });

    await this.invalidateCache(barcode.inventoryItemId, tenantId);
    this.gateway.broadcastBarcodeUpdate(tenantId, 'barcode.updated', updated);

    return updated;
  }

  private async invalidateCache(itemId: string, tenantId: string) {
    await this.cacheService.deletePattern(tenantId, `barcode:*`);
    await this.cacheService.deletePattern(tenantId, `barcodes:*`);
  }
}
