import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../common/services/plan-limits.service';
import { Prisma, Branch } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly planLimitsService: PlanLimitsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateBranchDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Branch> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const existingSlug = await this.prisma.branch.findFirst({
      where: { restaurantId, slug: dto.slug, deletedAt: null },
    });

    if (existingSlug) {
      throw new ConflictException('A branch with this slug already exists');
    }

    const limitCheck = await this.planLimitsService.checkLimit(tenantId, 'branches');
    if (!limitCheck.allowed) {
      throw new BadRequestException(
        `Branch limit reached. Current: ${limitCheck.current}, Limit: ${limitCheck.limit}. Please upgrade your plan.`,
      );
    }

    const branch = await this.prisma.branch.create({
      data: {
        restaurantId,
        tenantId,
        name: dto.name,
        slug: dto.slug,
        type: dto.type ?? 'BRANCH',
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        city: dto.city,
        country: dto.country,
        latitude: dto.latitude,
        longitude: dto.longitude,
        timezone: dto.timezone ?? 'UTC',
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await this.auditLogsService.log({
      action: 'BRANCH_CREATED',
      resource: 'Branch',
      resourceId: branch.id,
      userId,
      tenantId,
      newValues: { name: branch.name, slug: branch.slug, restaurantId },
      ...meta,
    });

    this.eventEmitter.emit('branch.created', {
      tenantId,
      restaurantId,
      branchId: branch.id,
    });

    return branch;
  }

  async findAll(params: {
    tenantId: string;
    restaurantId?: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: Branch[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, restaurantId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.BranchWhereInput = { tenantId, deletedAt: null };
    if (restaurantId) where.restaurantId = restaurantId;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.branch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.branch.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<Branch> {
    const branch = await this.prisma.branch.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  async update(
    id: string,
    dto: UpdateBranchDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Branch> {
    const existing = await this.findOne(id, tenantId);

    if (dto.slug && dto.slug !== existing.slug) {
      const slugTaken = await this.prisma.branch.findFirst({
        where: {
          restaurantId: existing.restaurantId,
          slug: dto.slug,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (slugTaken) {
        throw new ConflictException('Slug is already taken');
      }
    }

    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.latitude !== undefined && { latitude: dto.latitude }),
        ...(dto.longitude !== undefined && { longitude: dto.longitude }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.metadata !== undefined && {
          metadata: dto.metadata as Prisma.InputJsonValue,
        }),
      },
    });

    await this.auditLogsService.log({
      action: 'BRANCH_UPDATED',
      resource: 'Branch',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('branch.updated', {
      tenantId,
      restaurantId: existing.restaurantId,
      branchId: id,
    });

    return branch;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'BRANCH_DELETED',
      resource: 'Branch',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('branch.deleted', {
      tenantId,
      restaurantId: existing.restaurantId,
      branchId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Branch> {
    const branch = await this.prisma.branch.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    const restored = await this.prisma.branch.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'BRANCH_RESTORED',
      resource: 'Branch',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
