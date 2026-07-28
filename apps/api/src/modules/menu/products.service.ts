import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../common/services/plan-limits.service';
import { Prisma, Product } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from '../../common/services/cache.service';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly planLimitsService: PlanLimitsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cacheService: CacheService,
  ) {}

  private async invalidateCache(tenantId: string, restaurantId: string): Promise<void> {
    await this.cacheService.deletePattern(tenantId, `menu:${restaurantId}:*`);
  }

  async create(
    dto: CreateProductDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Product> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    if (dto.menuCategoryId) {
      const category = await this.prisma.menuCategory.findFirst({
        where: { id: dto.menuCategoryId, restaurantId, tenantId, deletedAt: null },
      });
      if (!category) {
        throw new NotFoundException('Menu category not found');
      }
    }

    if (dto.sku) {
      const existingSku = await this.prisma.product.findFirst({
        where: { restaurantId, sku: dto.sku, deletedAt: null },
      });
      if (existingSku) {
        throw new ConflictException('A product with this SKU already exists');
      }
    }

    const limitCheck = await this.planLimitsService.checkLimit(tenantId, 'products');
    if (!limitCheck.allowed) {
      throw new BadRequestException(
        `Product limit reached. Current: ${limitCheck.current}, Limit: ${limitCheck.limit}. Please upgrade your plan.`,
      );
    }

    const product = await this.prisma.product.create({
      data: {
        restaurantId,
        tenantId,
        menuCategoryId: dto.menuCategoryId,
        name: dto.name,
        description: dto.description,
        sku: dto.sku,
        basePrice: dto.basePrice,
        costPrice: dto.costPrice,
        taxRate: dto.taxRate,
        isFeatured: dto.isFeatured ?? false,
        sortOrder: dto.sortOrder ?? 0,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_CREATED',
      resource: 'Product',
      resourceId: product.id,
      userId,
      tenantId,
      newValues: {
        name: product.name,
        basePrice: product.basePrice,
        sku: product.sku,
        restaurantId,
      },
      ...meta,
    });

    this.eventEmitter.emit('product.created', {
      tenantId,
      restaurantId,
      productId: product.id,
    });

    await this.invalidateCache(tenantId, restaurantId);

    return product;
  }

  async findAll(params: {
    tenantId: string;
    restaurantId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
    isFeatured?: boolean;
    menuCategoryId?: string;
  }): Promise<{
    data: Product[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const {
      tenantId,
      restaurantId,
      page = 1,
      limit = 20,
      search,
      isActive,
      isFeatured,
      menuCategoryId,
    } = params;

    const cacheKey = `menu:${restaurantId}:products:${page}:${limit}:${search ?? ''}:${isActive ?? ''}:${isFeatured ?? ''}:${menuCategoryId ?? ''}`;
    return this.cacheService.getOrSet(
      tenantId,
      cacheKey,
      async () => {
        const where: Prisma.ProductWhereInput = { tenantId, restaurantId, deletedAt: null };
        if (isActive !== undefined) where.isActive = isActive;
        if (isFeatured !== undefined) where.isFeatured = isFeatured;
        if (menuCategoryId) where.menuCategoryId = menuCategoryId;
        if (search) {
          where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
          ];
        }

        const [data, total] = await Promise.all([
          this.prisma.product.findMany({
            where,
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
          }),
          this.prisma.product.count({ where }),
        ]);

        return {
          data,
          meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
      },
      300,
    );
  }

  async findOne(id: string, tenantId: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Product> {
    const existing = await this.findOne(id, tenantId);

    if (dto.sku && dto.sku !== existing.sku) {
      const skuTaken = await this.prisma.product.findFirst({
        where: {
          restaurantId: existing.restaurantId,
          sku: dto.sku,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (skuTaken) {
        throw new ConflictException('A product with this SKU already exists');
      }
    }

    if (dto.menuCategoryId) {
      const category = await this.prisma.menuCategory.findFirst({
        where: {
          id: dto.menuCategoryId,
          restaurantId: existing.restaurantId,
          tenantId,
          deletedAt: null,
        },
      });
      if (!category) {
        throw new NotFoundException('Menu category not found');
      }
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.menuCategoryId !== undefined && { menuCategoryId: dto.menuCategoryId }),
        ...(dto.sku !== undefined && { sku: dto.sku }),
        ...(dto.basePrice !== undefined && { basePrice: dto.basePrice }),
        ...(dto.costPrice !== undefined && { costPrice: dto.costPrice }),
        ...(dto.taxRate !== undefined && { taxRate: dto.taxRate }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isFeatured !== undefined && { isFeatured: dto.isFeatured }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.metadata !== undefined && {
          metadata: dto.metadata as Prisma.InputJsonValue,
        }),
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_UPDATED',
      resource: 'Product',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('product.updated', {
      tenantId,
      restaurantId: existing.restaurantId,
      productId: id,
    });

    await this.invalidateCache(tenantId, existing.restaurantId);

    return product;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_DELETED',
      resource: 'Product',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('product.deleted', {
      tenantId,
      restaurantId: existing.restaurantId,
      productId: id,
    });

    await this.invalidateCache(tenantId, existing.restaurantId);
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const restored = await this.prisma.product.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_RESTORED',
      resource: 'Product',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    await this.invalidateCache(tenantId, product.restaurantId);

    return restored;
  }
}
