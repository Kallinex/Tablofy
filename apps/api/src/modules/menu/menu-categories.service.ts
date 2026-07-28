import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, MenuCategory } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from '../../common/services/cache.service';

@Injectable()
export class MenuCategoriesService {
  private readonly logger = new Logger(MenuCategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cacheService: CacheService,
  ) {}

  private async invalidateCache(tenantId: string, restaurantId: string): Promise<void> {
    await this.cacheService.delete(tenantId, `menu:${restaurantId}:categories`);
  }

  async create(
    dto: CreateMenuCategoryDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<MenuCategory> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const existingName = await this.prisma.menuCategory.findFirst({
      where: { restaurantId, name: dto.name, deletedAt: null },
    });
    if (existingName) {
      throw new ConflictException('A category with this name already exists');
    }

    const category = await this.prisma.menuCategory.create({
      data: {
        restaurantId,
        tenantId,
        name: dto.name,
        description: dto.description,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLogsService.log({
      action: 'MENU_CATEGORY_CREATED',
      resource: 'MenuCategory',
      resourceId: category.id,
      userId,
      tenantId,
      newValues: { name: category.name, sortOrder: category.sortOrder, restaurantId },
      ...meta,
    });

    this.eventEmitter.emit('menuCategory.created', {
      tenantId,
      restaurantId,
      categoryId: category.id,
    });

    await this.invalidateCache(tenantId, restaurantId);

    return category;
  }

  async findAll(params: {
    tenantId: string;
    restaurantId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: MenuCategory[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, restaurantId, page = 1, limit = 20, search, isActive } = params;

    const cacheKey = `menu:${restaurantId}:categories:${page}:${limit}:${search ?? ''}:${isActive ?? ''}`;
    return this.cacheService.getOrSet(
      tenantId,
      cacheKey,
      async () => {
        const where: Prisma.MenuCategoryWhereInput = { tenantId, restaurantId, deletedAt: null };
        if (isActive !== undefined) where.isActive = isActive;
        if (search) {
          where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ];
        }

        const [data, total] = await Promise.all([
          this.prisma.menuCategory.findMany({
            where,
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
          }),
          this.prisma.menuCategory.count({ where }),
        ]);

        return {
          data,
          meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
      },
      300,
    );
  }

  async findOne(id: string, tenantId: string): Promise<MenuCategory> {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!category) {
      throw new NotFoundException('Menu category not found');
    }

    return category;
  }

  async update(
    id: string,
    dto: UpdateMenuCategoryDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<MenuCategory> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.menuCategory.findFirst({
        where: {
          restaurantId: existing.restaurantId,
          name: dto.name,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (nameTaken) {
        throw new ConflictException('A category with this name already exists');
      }
    }

    const category = await this.prisma.menuCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'MENU_CATEGORY_UPDATED',
      resource: 'MenuCategory',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('menuCategory.updated', {
      tenantId,
      restaurantId: existing.restaurantId,
      categoryId: id,
    });

    await this.invalidateCache(tenantId, existing.restaurantId);

    return category;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    const productCount = await this.prisma.product.count({
      where: { menuCategoryId: id, deletedAt: null },
    });
    if (productCount > 0) {
      throw new ConflictException(
        'Cannot delete category with active products. Reassign products first.',
      );
    }

    await this.prisma.menuCategory.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'MENU_CATEGORY_DELETED',
      resource: 'MenuCategory',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('menuCategory.deleted', {
      tenantId,
      restaurantId: existing.restaurantId,
      categoryId: id,
    });

    await this.invalidateCache(tenantId, existing.restaurantId);
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<MenuCategory> {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!category) {
      throw new NotFoundException('Menu category not found');
    }

    const restored = await this.prisma.menuCategory.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'MENU_CATEGORY_RESTORED',
      resource: 'MenuCategory',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    await this.invalidateCache(tenantId, category.restaurantId);

    return restored;
  }
}
