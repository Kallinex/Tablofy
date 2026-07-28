import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductTagDto } from './dto/create-product-tag.dto';
import { UpdateProductTagDto } from './dto/update-product-tag.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, ProductTag } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ProductTagsService {
  private readonly logger = new Logger(ProductTagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async create(
    dto: CreateProductTagDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductTag> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const slug = dto.slug || this.generateSlug(dto.name);

    const existing = await this.prisma.productTag.findFirst({
      where: { restaurantId, slug, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('A tag with this slug already exists');
    }

    const tag = await this.prisma.productTag.create({
      data: {
        restaurantId,
        tenantId,
        name: dto.name,
        slug,
        description: dto.description,
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_TAG_CREATED',
      resource: 'ProductTag',
      resourceId: tag.id,
      userId,
      tenantId,
      newValues: { name: tag.name, slug: tag.slug, restaurantId },
      ...meta,
    });

    this.eventEmitter.emit('productTag.created', {
      tenantId,
      restaurantId,
      tagId: tag.id,
    });

    return tag;
  }

  async findAll(params: {
    tenantId: string;
    restaurantId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: ProductTag[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, restaurantId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.ProductTagWhereInput = { tenantId, restaurantId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.productTag.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productTag.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<ProductTag> {
    const tag = await this.prisma.productTag.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!tag) {
      throw new NotFoundException('Product tag not found');
    }
    return tag;
  }

  async update(
    id: string,
    dto: UpdateProductTagDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductTag> {
    const existing = await this.findOne(id, tenantId);

    if (dto.slug && dto.slug !== existing.slug) {
      const slugTaken = await this.prisma.productTag.findFirst({
        where: {
          restaurantId: existing.restaurantId,
          slug: dto.slug,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (slugTaken) {
        throw new ConflictException('A tag with this slug already exists');
      }
    }

    const tag = await this.prisma.productTag.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_TAG_UPDATED',
      resource: 'ProductTag',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    return tag;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.prisma.productTag.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_TAG_DELETED',
      resource: 'ProductTag',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('productTag.deleted', {
      tenantId,
      restaurantId: existing.restaurantId,
      tagId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductTag> {
    const tag = await this.prisma.productTag.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!tag) {
      throw new NotFoundException('Product tag not found');
    }

    const restored = await this.prisma.productTag.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_TAG_RESTORED',
      resource: 'ProductTag',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }

  async assignToProduct(
    productId: string,
    tagIds: string[],
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductTag[]> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, restaurantId, tenantId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    for (const tagId of tagIds) {
      const tag = await this.prisma.productTag.findFirst({
        where: { id: tagId, restaurantId, tenantId, deletedAt: null },
      });
      if (!tag) {
        throw new NotFoundException(`Tag ${tagId} not found`);
      }
    }

    await this.prisma.productTagAssignment.createMany({
      data: tagIds.map((tagId) => ({ productId, tagId })),
      skipDuplicates: true,
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_TAGS_ASSIGNED',
      resource: 'Product',
      resourceId: productId,
      userId,
      tenantId,
      newValues: { tagIds },
      ...meta,
    });

    const assigned = await this.prisma.productTag.findMany({
      where: {
        id: { in: tagIds },
        products: { some: { productId } },
        deletedAt: null,
      },
    });

    return assigned;
  }

  async removeFromProduct(
    productId: string,
    tagId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const assignment = await this.prisma.productTagAssignment.findUnique({
      where: { productId_tagId: { productId, tagId } },
    });
    if (!assignment) {
      throw new NotFoundException('Tag not assigned to this product');
    }

    await this.prisma.productTagAssignment.delete({
      where: { productId_tagId: { productId, tagId } },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_TAG_REMOVED',
      resource: 'Product',
      resourceId: productId,
      userId,
      tenantId,
      oldValues: { tagId },
      ...meta,
    });
  }

  async listProductTags(productId: string, tenantId: string): Promise<ProductTag[]> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.productTag.findMany({
      where: {
        products: { some: { productId } },
        deletedAt: null,
        tenantId,
      },
      orderBy: { name: 'asc' },
    });
  }
}
