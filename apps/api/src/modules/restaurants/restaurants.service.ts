import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../common/services/plan-limits.service';
import { Prisma, Restaurant } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class RestaurantsService {
  private readonly logger = new Logger(RestaurantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly planLimitsService: PlanLimitsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateRestaurantDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Restaurant> {
    const existingSlug = await this.prisma.restaurant.findFirst({
      where: { tenantId, slug: dto.slug, deletedAt: null },
    });

    if (existingSlug) {
      throw new ConflictException('A restaurant with this slug already exists');
    }

    const restaurant = await this.prisma.restaurant.create({
      data: {
        tenantId,
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        city: dto.city,
        country: dto.country,
        timezone: dto.timezone ?? 'UTC',
        currency: dto.currency ?? 'USD',
        logoUrl: dto.logoUrl,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await this.auditLogsService.log({
      action: 'RESTAURANT_CREATED',
      resource: 'Restaurant',
      resourceId: restaurant.id,
      userId,
      tenantId,
      newValues: { name: restaurant.name, slug: restaurant.slug },
      ...meta,
    });

    this.eventEmitter.emit('restaurant.created', {
      tenantId,
      restaurantId: restaurant.id,
    });

    return restaurant;
  }

  async findAll(params: {
    tenantId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: Restaurant[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.RestaurantWhereInput = { tenantId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.restaurant.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<Restaurant> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    return restaurant;
  }

  async update(
    id: string,
    dto: UpdateRestaurantDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Restaurant> {
    const existing = await this.findOne(id, tenantId);

    if (dto.slug && dto.slug !== existing.slug) {
      const slugTaken = await this.prisma.restaurant.findFirst({
        where: { tenantId, slug: dto.slug, deletedAt: null, id: { not: id } },
      });
      if (slugTaken) {
        throw new ConflictException('Slug is already taken');
      }
    }

    const restaurant = await this.prisma.restaurant.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.metadata !== undefined && {
          metadata: dto.metadata as Prisma.InputJsonValue,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'RESTAURANT_UPDATED',
      resource: 'Restaurant',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('restaurant.updated', {
      tenantId,
      restaurantId: id,
    });

    return restaurant;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.findOne(id, tenantId);

    await this.prisma.restaurant.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'RESTAURANT_DELETED',
      resource: 'Restaurant',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('restaurant.deleted', {
      tenantId,
      restaurantId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Restaurant> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const restored = await this.prisma.restaurant.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'RESTAURANT_RESTORED',
      resource: 'Restaurant',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
