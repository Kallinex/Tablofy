import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { Prisma } from '@prisma/client';
import { CreatePerformanceDto } from './dto/create-performance.dto';
import { QueryPerformanceDto } from './dto/query-performance.dto';

@Injectable()
export class SupplierPerformanceService {
  private readonly logger = new Logger(SupplierPerformanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreatePerformanceDto, tenantId: string, userId: string) {
    const data: Prisma.SupplierPerformanceMetricCreateInput = {
      tenantId,
      periodStart: new Date(dto.periodStart),
      periodEnd: new Date(dto.periodEnd),
      leadTimeAvg: dto.leadTimeAvg,
      fillRate: dto.fillRate,
      deliveryAccuracy: dto.deliveryAccuracy,
      rejectedItems: dto.rejectedItems ?? 0,
      averageDelay: dto.averageDelay,
      totalOrders: dto.totalOrders ?? 0,
      onTimeDeliveries: dto.onTimeDeliveries ?? 0,
      qualityScore: dto.qualityScore,
      costScore: dto.costScore,
      overallScore: this.calculateOverallScore(dto),
      rank: dto.rank,
      metadata: dto.metadata as Prisma.InputJsonValue ?? Prisma.DbNull,
    };

    if (dto.supplierId) {
      data.supplier = { connect: { id: dto.supplierId } };
    }
    if (dto.supplierDetailId) {
      data.supplierDetail = { connect: { id: dto.supplierDetailId } };
    }

    const metric = await this.prisma.supplierPerformanceMetric.create({ data });

    await this.auditLogsService.log({
      action: 'SUPPLIER_PERFORMANCE_CREATED',
      resource: 'SupplierPerformanceMetric',
      resourceId: metric.id,
      userId,
      tenantId,
      newValues: {
        supplierId: dto.supplierId,
        overallScore: metric.overallScore,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
      },
    });

    await this.invalidateListCache(tenantId);
    return metric;
  }

  async findAll(tenantId: string, query: QueryPerformanceDto) {
    const cacheKey = `supplier-performance:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierPerformanceMetricWhereInput = { tenantId };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.supplierDetailId) where.supplierDetailId = query.supplierDetailId;

    const [data, total] = await Promise.all([
      this.prisma.supplierPerformanceMetric.findMany({
        where,
        skip,
        take: limit,
        orderBy: { periodStart: 'desc' },
        include: { supplier: true, supplierDetail: true },
      }),
      this.prisma.supplierPerformanceMetric.count({ where }),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrevious: page > 1,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 120);
    return result;
  }

  async findOne(id: string, tenantId: string) {
    const metric = await this.prisma.supplierPerformanceMetric.findFirst({
      where: { id, tenantId },
      include: { supplier: true, supplierDetail: true },
    });
    if (!metric) throw new NotFoundException('Supplier performance metric not found');
    return metric;
  }

  async findBySupplier(supplierId: string, tenantId: string) {
    return this.prisma.supplierPerformanceMetric.findMany({
      where: { supplierId, tenantId },
      orderBy: { periodStart: 'desc' },
      include: { supplier: true },
    });
  }

  async getRanking(tenantId: string) {
    const cacheKey = 'supplier-performance:ranking';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const metrics = await this.prisma.supplierPerformanceMetric.findMany({
      where: { tenantId, overallScore: { not: null } },
      orderBy: { overallScore: 'desc' },
      include: { supplier: true, supplierDetail: true },
    });

    const rankings = metrics.map((m, idx) => ({
      rank: idx + 1,
      supplierId: m.supplierId,
      supplierName: m.supplier?.name ?? 'Unknown',
      overallScore: Number(m.overallScore),
      qualityScore: Number(m.qualityScore ?? 0),
      costScore: Number(m.costScore ?? 0),
      totalOrders: m.totalOrders,
      periodStart: m.periodStart,
      periodEnd: m.periodEnd,
    }));

    await this.cacheService.set(tenantId, cacheKey, rankings, 300);
    return rankings;
  }

  private calculateOverallScore(dto: CreatePerformanceDto): number {
    const qualityWeight = 0.3;
    const costWeight = 0.3;
    const deliveryWeight = 0.2;
    const fillRateWeight = 0.2;

    const quality = dto.qualityScore ?? 0;
    const cost = dto.costScore ?? 0;
    const delivery = (dto.deliveryAccuracy ?? (dto.onTimeDeliveries != null && dto.totalOrders != null
      ? (dto.onTimeDeliveries / dto.totalOrders) * 100
      : 0));
    const fillRate = dto.fillRate ?? 0;

    return Math.round(
      (quality * qualityWeight + cost * costWeight + delivery * deliveryWeight + fillRate * fillRateWeight) * 100,
    ) / 100;
  }

  private async invalidateListCache(tenantId: string) {
    await this.cacheService.deletePattern(tenantId, 'supplier-performance:*');
  }
}
