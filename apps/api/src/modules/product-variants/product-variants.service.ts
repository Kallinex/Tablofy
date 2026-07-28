import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, ProductVariant } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ProductVariantsService {
  private readonly logger = new Logger(ProductVariantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateProductVariantDto,
    productId: string,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductVariant> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, restaurantId, tenantId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (dto.variantGroupId) {
      const variantGroup = await this.prisma.variantGroup.findFirst({
        where: { id: dto.variantGroupId, restaurantId, tenantId, deletedAt: null },
      });
      if (!variantGroup) {
        throw new NotFoundException('Variant group not found');
      }
    }

    const existingName = await this.prisma.productVariant.findFirst({
      where: {
        productId,
        name: dto.name,
        variantGroupId: dto.variantGroupId ?? null,
        deletedAt: null,
      },
    });
    if (existingName) {
      throw new ConflictException('A variant with this name already exists for this product');
    }

    const variant = await this.prisma.productVariant.create({
      data: {
        productId,
        tenantId,
        variantGroupId: dto.variantGroupId,
        name: dto.name,
        sku: dto.sku,
        price: dto.price,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_VARIANT_CREATED',
      resource: 'ProductVariant',
      resourceId: variant.id,
      userId,
      tenantId,
      newValues: {
        name: variant.name,
        price: variant.price,
        sku: variant.sku,
        productId,
        variantGroupId: dto.variantGroupId,
      },
      ...meta,
    });

    this.eventEmitter.emit('productVariant.created', {
      tenantId,
      restaurantId,
      productId,
      variantId: variant.id,
    });

    return variant;
  }

  async findAll(params: {
    tenantId: string;
    productId: string;
    restaurantId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
    variantGroupId?: string;
  }): Promise<{
    data: ProductVariant[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, productId, page = 1, limit = 20, search, isActive, variantGroupId } = params;

    const where: Prisma.ProductVariantWhereInput = { tenantId, productId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;
    if (variantGroupId) where.variantGroupId = variantGroupId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.productVariant.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productVariant.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<ProductVariant> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }

    return variant;
  }

  async update(
    id: string,
    dto: UpdateProductVariantDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductVariant> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.productVariant.findFirst({
        where: {
          productId: existing.productId,
          name: dto.name,
          variantGroupId: existing.variantGroupId,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (nameTaken) {
        throw new ConflictException('A variant with this name already exists for this product');
      }
    }

    if (dto.variantGroupId) {
      const variantGroup = await this.prisma.variantGroup.findFirst({
        where: { id: dto.variantGroupId, deletedAt: null },
      });
      if (!variantGroup) {
        throw new NotFoundException('Variant group not found');
      }
    }

    const variant = await this.prisma.productVariant.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.sku !== undefined && { sku: dto.sku }),
        ...(dto.variantGroupId !== undefined && { variantGroupId: dto.variantGroupId }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_VARIANT_UPDATED',
      resource: 'ProductVariant',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('productVariant.updated', {
      tenantId,
      productId: existing.productId,
      variantId: id,
    });

    return variant;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.prisma.productVariant.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_VARIANT_DELETED',
      resource: 'ProductVariant',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('productVariant.deleted', {
      tenantId,
      productId: existing.productId,
      variantId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductVariant> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }

    const restored = await this.prisma.productVariant.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_VARIANT_RESTORED',
      resource: 'ProductVariant',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
