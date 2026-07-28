import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Supplier, Prisma } from '@prisma/client';

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    dto: CreateSupplierDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Supplier> {
    const existing = await this.prisma.supplier.findFirst({
      where: { tenantId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('A supplier with this name already exists');
    }

    const supplier = await this.prisma.supplier.create({
      data: {
        tenantId,
        name: dto.name,
        contactName: dto.contactName,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        isActive: dto.isActive ?? true,
        ...(dto.metadata !== undefined && { metadata: dto.metadata as Prisma.InputJsonValue }),
      },
    });

    await this.auditLogsService.log({
      action: 'SUPPLIER_CREATED',
      resource: 'Supplier',
      resourceId: supplier.id,
      userId,
      tenantId,
      newValues: { name: supplier.name, email: supplier.email },
      ...meta,
    });

    return supplier;
  }

  async findAll(params: {
    tenantId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: Supplier[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.SupplierWhereInput = { tenantId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, tenantId: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async update(
    id: string,
    dto: UpdateSupplierDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Supplier> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.supplier.findFirst({
        where: { tenantId, name: dto.name, deletedAt: null, id: { not: id } },
      });
      if (nameTaken) throw new ConflictException('A supplier with this name already exists');
    }

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.contactName !== undefined && { contactName: dto.contactName }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata as Prisma.InputJsonValue }),
      },
    });

    await this.auditLogsService.log({
      action: 'SUPPLIER_UPDATED',
      resource: 'Supplier',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: existing.name },
      newValues: { name: updated.name },
      ...meta,
    });

    return updated;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.findOne(id, tenantId);

    await this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'SUPPLIER_DELETED',
      resource: 'Supplier',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const restored = await this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'SUPPLIER_RESTORED',
      resource: 'Supplier',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
