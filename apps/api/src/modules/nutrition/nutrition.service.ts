import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateNutritionalInfoDto } from './dto/create-nutritional-info.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, NutritionalInfo } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class NutritionService {
  private readonly logger = new Logger(NutritionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async upsert(
    dto: CreateNutritionalInfoDto,
    productId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<NutritionalInfo> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const existing = await this.prisma.nutritionalInfo.findUnique({
      where: { productId },
    });

    if (existing && existing.deletedAt) {
      const restored = await this.prisma.nutritionalInfo.update({
        where: { productId },
        data: {
          deletedAt: null,
          isActive: true,
          ...(dto.calories !== undefined && { calories: dto.calories }),
          ...(dto.protein !== undefined && { protein: dto.protein }),
          ...(dto.carbs !== undefined && { carbs: dto.carbs }),
          ...(dto.fat !== undefined && { fat: dto.fat }),
          ...(dto.fiber !== undefined && { fiber: dto.fiber }),
          ...(dto.sugar !== undefined && { sugar: dto.sugar }),
          ...(dto.sodium !== undefined && { sodium: dto.sodium }),
          ...(dto.metadata !== undefined && {
            metadata: dto.metadata as Prisma.InputJsonValue,
          }),
        },
      });

      await this.auditLogsService.log({
        action: 'NUTRITIONAL_INFO_RESTORED',
        resource: 'NutritionalInfo',
        resourceId: restored.id,
        userId,
        tenantId,
        newValues: dto as unknown as Record<string, unknown>,
        ...meta,
      });

      return restored;
    }

    if (existing) {
      const updated = await this.prisma.nutritionalInfo.update({
        where: { productId },
        data: {
          ...(dto.calories !== undefined && { calories: dto.calories }),
          ...(dto.protein !== undefined && { protein: dto.protein }),
          ...(dto.carbs !== undefined && { carbs: dto.carbs }),
          ...(dto.fat !== undefined && { fat: dto.fat }),
          ...(dto.fiber !== undefined && { fiber: dto.fiber }),
          ...(dto.sugar !== undefined && { sugar: dto.sugar }),
          ...(dto.sodium !== undefined && { sodium: dto.sodium }),
          ...(dto.metadata !== undefined && {
            metadata: dto.metadata as Prisma.InputJsonValue,
          }),
        },
      });

      await this.auditLogsService.log({
        action: 'NUTRITIONAL_INFO_UPDATED',
        resource: 'NutritionalInfo',
        resourceId: updated.id,
        userId,
        tenantId,
        newValues: dto as unknown as Record<string, unknown>,
        ...meta,
      });

      this.eventEmitter.emit('nutritionalInfo.updated', {
        tenantId,
        productId,
        nutritionalInfoId: updated.id,
      });

      return updated;
    }

    const created = await this.prisma.nutritionalInfo.create({
      data: {
        productId,
        tenantId,
        calories: dto.calories,
        protein: dto.protein,
        carbs: dto.carbs,
        fat: dto.fat,
        fiber: dto.fiber,
        sugar: dto.sugar,
        sodium: dto.sodium,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });

    await this.auditLogsService.log({
      action: 'NUTRITIONAL_INFO_CREATED',
      resource: 'NutritionalInfo',
      resourceId: created.id,
      userId,
      tenantId,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('nutritionalInfo.created', {
      tenantId,
      productId,
      nutritionalInfoId: created.id,
    });

    return created;
  }

  async findOne(productId: string, tenantId: string): Promise<NutritionalInfo> {
    const info = await this.prisma.nutritionalInfo.findFirst({
      where: { productId, tenantId, deletedAt: null },
    });
    if (!info) {
      throw new NotFoundException('Nutritional info not found for this product');
    }
    return info;
  }

  async softDelete(
    productId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.prisma.nutritionalInfo.findFirst({
      where: { productId, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Nutritional info not found');
    }

    await this.prisma.nutritionalInfo.update({
      where: { productId },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'NUTRITIONAL_INFO_DELETED',
      resource: 'NutritionalInfo',
      resourceId: existing.id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('nutritionalInfo.deleted', {
      tenantId,
      productId,
      nutritionalInfoId: existing.id,
    });
  }
}
