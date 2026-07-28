import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductAvailabilityDto } from './dto/create-product-availability.dto';
import { UpdateProductAvailabilityDto } from './dto/update-product-availability.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ProductAvailability } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ProductAvailabilityService {
  private readonly logger = new Logger(ProductAvailabilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateProductAvailabilityDto,
    productId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductAvailability> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const existing = await this.prisma.productAvailability.findFirst({
      where: {
        productId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
      },
    });
    if (existing) {
      throw new ConflictException(
        'Availability already exists for this product on this day and start time',
      );
    }

    const availability = await this.prisma.productAvailability.create({
      data: {
        productId,
        tenantId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_AVAILABILITY_CREATED',
      resource: 'ProductAvailability',
      resourceId: availability.id,
      userId,
      tenantId,
      newValues: {
        dayOfWeek: availability.dayOfWeek,
        startTime: availability.startTime,
        endTime: availability.endTime,
        productId,
      },
      ...meta,
    });

    this.eventEmitter.emit('productAvailability.created', {
      tenantId,
      productId,
      availabilityId: availability.id,
    });

    return availability;
  }

  async findAll(productId: string, tenantId: string): Promise<ProductAvailability[]> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.productAvailability.findMany({
      where: { productId, tenantId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async findOne(id: string, tenantId: string): Promise<ProductAvailability> {
    const availability = await this.prisma.productAvailability.findFirst({
      where: { id, tenantId },
    });

    if (!availability) {
      throw new NotFoundException('Product availability not found');
    }

    return availability;
  }

  async update(
    id: string,
    dto: UpdateProductAvailabilityDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductAvailability> {
    const existing = await this.findOne(id, tenantId);

    if (dto.dayOfWeek || dto.startTime) {
      const dayOfWeek = dto.dayOfWeek ?? existing.dayOfWeek;
      const startTime = dto.startTime ?? existing.startTime;

      const conflict = await this.prisma.productAvailability.findFirst({
        where: {
          productId: existing.productId,
          dayOfWeek,
          startTime,
          id: { not: id },
        },
      });
      if (conflict) {
        throw new ConflictException(
          'Availability already exists for this product on this day and start time',
        );
      }
    }

    const availability = await this.prisma.productAvailability.update({
      where: { id },
      data: {
        ...(dto.dayOfWeek !== undefined && { dayOfWeek: dto.dayOfWeek }),
        ...(dto.startTime !== undefined && { startTime: dto.startTime }),
        ...(dto.endTime !== undefined && { endTime: dto.endTime }),
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_AVAILABILITY_UPDATED',
      resource: 'ProductAvailability',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('productAvailability.updated', {
      tenantId,
      productId: existing.productId,
      availabilityId: id,
    });

    return availability;
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.prisma.productAvailability.delete({
      where: { id },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_AVAILABILITY_DELETED',
      resource: 'ProductAvailability',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('productAvailability.deleted', {
      tenantId,
      productId: existing.productId,
      availabilityId: id,
    });
  }
}
