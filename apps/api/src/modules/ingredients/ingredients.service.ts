import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateIngredientDto, UpdateIngredientDto } from './dto/ingredient.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Ingredient, Prisma } from '@prisma/client';

@Injectable()
export class IngredientsService {
  private readonly logger = new Logger(IngredientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    dto: CreateIngredientDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Ingredient> {
    const existing = await this.prisma.ingredient.findFirst({
      where: { tenantId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('An ingredient with this name already exists');
    }

    const ingredient = await this.prisma.ingredient.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        unit: dto.unit,
        costPerUnit: dto.costPerUnit,
        stockLevel: dto.stockLevel,
        minStock: dto.minStock,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogsService.log({
      action: 'INGREDIENT_CREATED',
      resource: 'Ingredient',
      resourceId: ingredient.id,
      userId,
      tenantId,
      newValues: {
        name: ingredient.name,
        unit: ingredient.unit,
        costPerUnit: ingredient.costPerUnit,
      },
      ...meta,
    });

    return ingredient;
  }

  async findAll(params: {
    tenantId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: Ingredient[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.IngredientWhereInput = { tenantId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.ingredient.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.ingredient.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, tenantId: string): Promise<Ingredient> {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!ingredient) throw new NotFoundException('Ingredient not found');
    return ingredient;
  }

  async update(
    id: string,
    dto: UpdateIngredientDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Ingredient> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.ingredient.findFirst({
        where: { tenantId, name: dto.name, deletedAt: null, id: { not: id } },
      });
      if (nameTaken) throw new ConflictException('An ingredient with this name already exists');
    }

    const updated = await this.prisma.ingredient.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.unit !== undefined && { unit: dto.unit }),
        ...(dto.costPerUnit !== undefined && { costPerUnit: dto.costPerUnit }),
        ...(dto.stockLevel !== undefined && { stockLevel: dto.stockLevel }),
        ...(dto.minStock !== undefined && { minStock: dto.minStock }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'INGREDIENT_UPDATED',
      resource: 'Ingredient',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: existing.name, costPerUnit: existing.costPerUnit },
      newValues: { name: updated.name, costPerUnit: updated.costPerUnit },
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

    await this.prisma.ingredient.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'INGREDIENT_DELETED',
      resource: 'Ingredient',
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
  ): Promise<Ingredient> {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!ingredient) throw new NotFoundException('Ingredient not found');

    const restored = await this.prisma.ingredient.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'INGREDIENT_RESTORED',
      resource: 'Ingredient',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
