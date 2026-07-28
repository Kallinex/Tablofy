import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductImageDto } from './dto/create-product-image.dto';
import { UpdateProductImageDto } from './dto/update-product-image.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ProductImage } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateProductImageDto,
    productId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductImage> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (dto.isPrimary) {
      await this.prisma.productImage.updateMany({
        where: { productId, tenantId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const image = await this.prisma.productImage.create({
      data: {
        productId,
        tenantId,
        url: dto.url,
        altText: dto.altText,
        sortOrder: dto.sortOrder ?? 0,
        isPrimary: dto.isPrimary ?? false,
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_IMAGE_CREATED',
      resource: 'ProductImage',
      resourceId: image.id,
      userId,
      tenantId,
      newValues: { url: image.url, isPrimary: image.isPrimary, productId },
      ...meta,
    });

    this.eventEmitter.emit('productImage.created', {
      tenantId,
      productId,
      imageId: image.id,
    });

    return image;
  }

  async findAll(productId: string, tenantId: string): Promise<ProductImage[]> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.productImage.findMany({
      where: { productId, tenantId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<ProductImage> {
    const image = await this.prisma.productImage.findFirst({
      where: { id, tenantId },
    });

    if (!image) {
      throw new NotFoundException('Product image not found');
    }

    return image;
  }

  async update(
    id: string,
    dto: UpdateProductImageDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductImage> {
    const existing = await this.findOne(id, tenantId);

    if (dto.isPrimary && !existing.isPrimary) {
      await this.prisma.productImage.updateMany({
        where: { productId: existing.productId, tenantId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const image = await this.prisma.productImage.update({
      where: { id },
      data: {
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.altText !== undefined && { altText: dto.altText }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isPrimary !== undefined && { isPrimary: dto.isPrimary }),
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_IMAGE_UPDATED',
      resource: 'ProductImage',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('productImage.updated', {
      tenantId,
      productId: existing.productId,
      imageId: id,
    });

    return image;
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.prisma.productImage.delete({
      where: { id },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_IMAGE_DELETED',
      resource: 'ProductImage',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('productImage.deleted', {
      tenantId,
      productId: existing.productId,
      imageId: id,
    });
  }
}
