import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, Tenant, TenantStatus } from '@prisma/client';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    dto: CreateTenantDto,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Tenant> {
    const existingSlug = await this.prisma.tenant.findUnique({
      where: { slug: dto.slug },
    });

    if (existingSlug) {
      throw new ConflictException('A tenant with this slug already exists');
    }

    const tenant = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
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
          locale: dto.locale ?? 'en',
          logoUrl: dto.logoUrl,
          metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });

      await tx.subscription.create({
        data: {
          tenantId: t.id,
          plan: 'FREE',
          status: 'ACTIVE',
        },
      });

      return t;
    });

    await this.auditLogsService.log({
      action: 'TENANT_CREATED',
      resource: 'Tenant',
      resourceId: tenant.id,
      userId,
      tenantId: tenant.id,
      newValues: { name: tenant.name, slug: tenant.slug },
      ...meta,
    });

    return tenant;
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: TenantStatus;
  }): Promise<{
    data: Tenant[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { page = 1, limit = 20, search, status } = params;

    const where: Prisma.TenantWhereInput = { deletedAt: null };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findFirst({ where: { id, deletedAt: null } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  async findBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findFirst({ where: { slug, deletedAt: null } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  async update(
    id: string,
    dto: UpdateTenantDto,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Tenant> {
    const existing = await this.findOne(id);

    if (dto.slug && dto.slug !== existing.slug) {
      const slugTaken = await this.prisma.tenant.findUnique({
        where: { slug: dto.slug },
      });
      if (slugTaken) {
        throw new ConflictException('Slug is already taken');
      }
    }

    const tenant = await this.prisma.tenant.update({
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
        ...(dto.locale !== undefined && { locale: dto.locale }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata as Prisma.InputJsonValue }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    await this.auditLogsService.log({
      action: 'TENANT_UPDATED',
      resource: 'Tenant',
      resourceId: id,
      userId,
      tenantId: id,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    return tenant;
  }

  async softDelete(
    id: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.findOne(id);

    await this.prisma.tenant.update({
      where: { id },
      data: { deletedAt: new Date(), status: TenantStatus.CANCELED },
    });

    await this.auditLogsService.log({
      action: 'TENANT_DELETED',
      resource: 'Tenant',
      resourceId: id,
      userId,
      tenantId: id,
      ...meta,
    });
  }

  async restore(
    id: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    if (!tenant.deletedAt) {
      throw new ConflictException('Tenant is not deleted');
    }

    const restored = await this.prisma.tenant.update({
      where: { id },
      data: { deletedAt: null, status: TenantStatus.ACTIVE },
    });

    await this.auditLogsService.log({
      action: 'TENANT_RESTORED',
      resource: 'Tenant',
      resourceId: id,
      userId,
      tenantId: id,
      ...meta,
    });

    return restored;
  }
}
