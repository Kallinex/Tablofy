import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAllergenDto } from './dto/create-allergen.dto';
import { UpdateAllergenDto } from './dto/update-allergen.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, Allergen } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class AllergensService {
  private readonly logger = new Logger(AllergensService.name);

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
    dto: CreateAllergenDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Allergen> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const slug = dto.slug || this.generateSlug(dto.name);

    const existing = await this.prisma.allergen.findFirst({
      where: { restaurantId, slug, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('An allergen with this slug already exists');
    }

    const allergen = await this.prisma.allergen.create({
      data: {
        restaurantId,
        tenantId,
        name: dto.name,
        slug,
        description: dto.description,
        iconUrl: dto.iconUrl,
      },
    });

    await this.auditLogsService.log({
      action: 'ALLERGEN_CREATED',
      resource: 'Allergen',
      resourceId: allergen.id,
      userId,
      tenantId,
      newValues: { name: allergen.name, slug: allergen.slug, restaurantId },
      ...meta,
    });

    this.eventEmitter.emit('allergen.created', {
      tenantId,
      restaurantId,
      allergenId: allergen.id,
    });

    return allergen;
  }

  async findAll(params: {
    tenantId: string;
    restaurantId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: Allergen[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, restaurantId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.AllergenWhereInput = { tenantId, restaurantId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.allergen.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.allergen.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<Allergen> {
    const allergen = await this.prisma.allergen.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!allergen) {
      throw new NotFoundException('Allergen not found');
    }
    return allergen;
  }

  async update(
    id: string,
    dto: UpdateAllergenDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Allergen> {
    const existing = await this.findOne(id, tenantId);

    if (dto.slug && dto.slug !== existing.slug) {
      const slugTaken = await this.prisma.allergen.findFirst({
        where: {
          restaurantId: existing.restaurantId,
          slug: dto.slug,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (slugTaken) {
        throw new ConflictException('An allergen with this slug already exists');
      }
    }

    const allergen = await this.prisma.allergen.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.iconUrl !== undefined && { iconUrl: dto.iconUrl }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'ALLERGEN_UPDATED',
      resource: 'Allergen',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    return allergen;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.prisma.allergen.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'ALLERGEN_DELETED',
      resource: 'Allergen',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('allergen.deleted', {
      tenantId,
      restaurantId: existing.restaurantId,
      allergenId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Allergen> {
    const allergen = await this.prisma.allergen.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!allergen) {
      throw new NotFoundException('Allergen not found');
    }

    const restored = await this.prisma.allergen.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'ALLERGEN_RESTORED',
      resource: 'Allergen',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }

  async assignToProduct(
    productId: string,
    allergenIds: string[],
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Allergen[]> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, restaurantId, tenantId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    for (const allergenId of allergenIds) {
      const allergen = await this.prisma.allergen.findFirst({
        where: { id: allergenId, restaurantId, tenantId, deletedAt: null },
      });
      if (!allergen) {
        throw new NotFoundException(`Allergen ${allergenId} not found`);
      }
    }

    await this.prisma.productAllergenAssignment.createMany({
      data: allergenIds.map((allergenId) => ({ productId, allergenId })),
      skipDuplicates: true,
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_ALLERGENS_ASSIGNED',
      resource: 'Product',
      resourceId: productId,
      userId,
      tenantId,
      newValues: { allergenIds },
      ...meta,
    });

    const assigned = await this.prisma.allergen.findMany({
      where: {
        id: { in: allergenIds },
        products: { some: { productId } },
        deletedAt: null,
      },
    });

    return assigned;
  }

  async removeFromProduct(
    productId: string,
    allergenId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const assignment = await this.prisma.productAllergenAssignment.findUnique({
      where: { productId_allergenId: { productId, allergenId } },
    });
    if (!assignment) {
      throw new NotFoundException('Allergen not assigned to this product');
    }

    await this.prisma.productAllergenAssignment.delete({
      where: { productId_allergenId: { productId, allergenId } },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_ALLERGEN_REMOVED',
      resource: 'Product',
      resourceId: productId,
      userId,
      tenantId,
      oldValues: { allergenId },
      ...meta,
    });
  }

  async listProductAllergens(productId: string, tenantId: string): Promise<Allergen[]> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.allergen.findMany({
      where: {
        products: { some: { productId } },
        deletedAt: null,
        tenantId,
      },
      orderBy: { name: 'asc' },
    });
  }
}
