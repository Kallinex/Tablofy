import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateProductIngredientDto,
  UpdateProductIngredientDto,
} from './dto/product-ingredient.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ProductIngredient } from '@prisma/client';

@Injectable()
export class ProductIngredientsService {
  private readonly logger = new Logger(ProductIngredientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    dto: CreateProductIngredientDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductIngredient> {
    await this.ensureProduct(dto.productId, restaurantId, tenantId);
    await this.ensureIngredient(dto.ingredientId, tenantId);

    if (dto.supplierId) {
      await this.ensureSupplier(dto.supplierId, tenantId);
    }

    const existing = await this.prisma.productIngredient.findUnique({
      where: {
        productId_ingredientId: { productId: dto.productId, ingredientId: dto.ingredientId },
      },
    });
    if (existing) {
      throw new ConflictException('This ingredient is already linked to this product');
    }

    const pi = await this.prisma.productIngredient.create({
      data: {
        productId: dto.productId,
        ingredientId: dto.ingredientId,
        supplierId: dto.supplierId,
        tenantId,
        quantity: dto.quantity,
      },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_INGREDIENT_CREATED',
      resource: 'ProductIngredient',
      resourceId: pi.id,
      userId,
      tenantId,
      newValues: {
        productId: dto.productId,
        ingredientId: dto.ingredientId,
        quantity: dto.quantity,
      },
      ...meta,
    });

    return pi;
  }

  async findByProduct(productId: string, tenantId: string): Promise<ProductIngredient[]> {
    return this.prisma.productIngredient.findMany({
      where: { productId, tenantId },
      include: { ingredient: true, supplier: true },
      orderBy: { ingredient: { name: 'asc' } },
    });
  }

  async findOne(id: string, tenantId: string): Promise<ProductIngredient> {
    const pi = await this.prisma.productIngredient.findFirst({
      where: { id, tenantId },
      include: { ingredient: true, supplier: true },
    });
    if (!pi) throw new NotFoundException('Product-ingredient link not found');
    return pi;
  }

  async update(
    id: string,
    dto: UpdateProductIngredientDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ProductIngredient> {
    const existing = await this.findOne(id, tenantId);

    if (dto.supplierId) {
      await this.ensureSupplier(dto.supplierId, tenantId);
    }

    const updated = await this.prisma.productIngredient.update({
      where: { id },
      data: {
        ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
      },
      include: { ingredient: true, supplier: true },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_INGREDIENT_UPDATED',
      resource: 'ProductIngredient',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { quantity: existing.quantity },
      newValues: { quantity: updated.quantity },
      ...meta,
    });

    return updated;
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.prisma.productIngredient.delete({ where: { id } });

    await this.auditLogsService.log({
      action: 'PRODUCT_INGREDIENT_DELETED',
      resource: 'ProductIngredient',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { productId: existing.productId, ingredientId: existing.ingredientId },
      ...meta,
    });
  }

  async getProductCost(
    productId: string,
    tenantId: string,
  ): Promise<{
    productId: string;
    totalCostPerUnit: number;
    ingredients: Array<{ name: string; quantity: number; costPerUnit: number; totalCost: number }>;
  }> {
    await this.ensureProduct(productId, '', tenantId);

    const links = await this.prisma.productIngredient.findMany({
      where: { productId, tenantId },
      include: { ingredient: true },
    });

    let totalCostPerUnit = 0;
    const ingredients = links.map((link) => {
      const costPerUnit = link.ingredient.costPerUnit
        ? parseFloat(link.ingredient.costPerUnit.toString())
        : 0;
      const quantity = parseFloat(link.quantity.toString());
      const totalCost = costPerUnit * quantity;
      totalCostPerUnit += totalCost;
      return {
        name: link.ingredient.name,
        quantity,
        costPerUnit,
        totalCost,
      };
    });

    return { productId, totalCostPerUnit, ingredients };
  }

  private async ensureProduct(
    productId: string,
    restaurantId: string,
    tenantId: string,
  ): Promise<void> {
    const where: Record<string, unknown> = { id: productId, tenantId, deletedAt: null };
    if (restaurantId) where.restaurantId = restaurantId;
    const product = await this.prisma.product.findFirst({ where });
    if (!product) throw new NotFoundException('Product not found');
  }

  private async ensureIngredient(ingredientId: string, tenantId: string): Promise<void> {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id: ingredientId, tenantId, deletedAt: null },
    });
    if (!ingredient) throw new NotFoundException('Ingredient not found');
  }

  private async ensureSupplier(supplierId: string, tenantId: string): Promise<void> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
  }
}
