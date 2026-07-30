import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService, QueueJobData } from '../queues/queue.service';
import { Prisma } from '@prisma/client';
import { CreateScheduledReportDto } from './dto/create-scheduled-report.dto';
import { UpdateScheduledReportDto } from './dto/update-scheduled-report.dto';
import { ScheduledReportQueryDto } from './dto/scheduled-report-query.dto';
import { Job } from 'bullmq';

@Injectable()
export class ScheduledReportsService {
  private readonly logger = new Logger(ScheduledReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateScheduledReportDto) {
    const report = await this.prisma.scheduledReport.create({
      data: {
        tenantId,
        name: dto.name,
        type: dto.type,
        format: dto.format,
        schedule: dto.schedule,
        recipients: dto.recipients as Prisma.InputJsonValue,
        config: (dto.config ?? {}) as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogsService.log({
      action: 'SCHEDULED_REPORT_CREATED',
      resource: 'ScheduledReport',
      resourceId: report.id,
      userId,
      tenantId,
      newValues: { name: dto.name, type: dto.type, schedule: dto.schedule },
    });

    await this.cacheService.delete(tenantId, 'scheduled-reports:list:*');
    return report;
  }

  async findAll(tenantId: string, query: ScheduledReportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ScheduledReportWhereInput = { tenantId, deletedAt: null };
    if (query.type) where.type = query.type;
    if (query.name) where.name = { contains: query.name, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      this.prisma.scheduledReport.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.scheduledReport.count({ where }),
    ]);

    return {
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
  }

  async findOne(tenantId: string, id: string) {
    const report = await this.prisma.scheduledReport.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!report) throw new NotFoundException('Scheduled report not found');
    return report;
  }

  async update(tenantId: string, id: string, dto: UpdateScheduledReportDto) {
    const existing = await this.prisma.scheduledReport.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Scheduled report not found');

    const updateData: Prisma.ScheduledReportUpdateInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.type !== undefined) updateData.type = dto.type;
    if (dto.format !== undefined) updateData.format = dto.format;
    if (dto.schedule !== undefined) updateData.schedule = dto.schedule;
    if (dto.recipients !== undefined)
      updateData.recipients = dto.recipients as Prisma.InputJsonValue;
    if (dto.config !== undefined) updateData.config = dto.config as Prisma.InputJsonValue;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    const updated = await this.prisma.scheduledReport.update({
      where: { id },
      data: updateData,
    });

    await this.auditLogsService.log({
      action: 'SCHEDULED_REPORT_UPDATED',
      resource: 'ScheduledReport',
      resourceId: id,
      userId: tenantId,
      tenantId,
      oldValues: { name: existing.name, type: existing.type },
      newValues: { name: updated.name, type: updated.type },
    });

    await this.cacheService.deletePattern(tenantId, 'scheduled-reports:*');
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.scheduledReport.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Scheduled report not found');

    await this.prisma.scheduledReport.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'SCHEDULED_REPORT_DELETED',
      resource: 'ScheduledReport',
      resourceId: id,
      userId: tenantId,
      tenantId,
      oldValues: { name: existing.name },
    });

    await this.cacheService.deletePattern(tenantId, 'scheduled-reports:*');
  }

  async trigger(tenantId: string, userId: string, id: string) {
    const report = await this.prisma.scheduledReport.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!report) throw new NotFoundException('Scheduled report not found');

    const exportRecord = await this.prisma.reportExport.create({
      data: {
        tenantId,
        type: report.format,
        reportType: report.type,
        config: report.config as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });

    await this.queueService.addJob('export-engine', 'generate-export', {
      tenantId,
      userId,
      payload: { exportId: exportRecord.id, scheduledReportId: id } as Record<string, unknown>,
    });

    await this.prisma.scheduledReport.update({
      where: { id },
      data: { lastRunAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'SCHEDULED_REPORT_TRIGGERED',
      resource: 'ScheduledReport',
      resourceId: id,
      userId,
      tenantId,
      newValues: { exportId: exportRecord.id },
    });

    return { exportId: exportRecord.id };
  }

  async processScheduledReport(job: Job<QueueJobData>) {
    const { tenantId: tId, payload } = job.data;
    const scheduledReportId = payload?.scheduledReportId as string | undefined;
    if (!scheduledReportId || !tId) throw new Error('scheduledReportId and tenantId are required');

    const report = await this.prisma.scheduledReport.findFirst({
      where: { id: scheduledReportId, tenantId: tId, deletedAt: null },
    });
    if (!report) throw new NotFoundException('Scheduled report not found');
    if (!report.isActive) {
      this.logger.log(`Scheduled report ${scheduledReportId} is inactive, skipping`);
      return { processed: false, reason: 'inactive' };
    }

    const exportRecord = await this.prisma.reportExport.create({
      data: {
        tenantId: tId,
        type: report.format,
        reportType: report.type,
        config: report.config as Prisma.InputJsonValue,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    await this.prisma.scheduledReport.update({
      where: { id: scheduledReportId },
      data: { lastRunAt: new Date() },
    });

    this.logger.log(`Scheduled report ${scheduledReportId} processed for tenant ${tId}`);
    return { processed: true, exportId: exportRecord.id };
  }

  private async fetchReportData(
    tenantId: string,
    report: { type: string },
  ): Promise<Record<string, unknown>[]> {
    switch (report.type) {
      case 'SALES':
        return (await this.prisma.order.findMany({
          where: { tenantId },
          include: { items: true, payments: true },
          take: 500,
        })) as unknown as Record<string, unknown>[];
      case 'INVENTORY':
        return (await this.prisma.inventoryItem.findMany({
          where: { tenantId, deletedAt: null },
          take: 500,
        })) as unknown as Record<string, unknown>[];
      case 'KITCHEN':
        return (await this.prisma.kitchenTicket.findMany({
          where: { tenantId },
          take: 500,
        })) as unknown as Record<string, unknown>[];
      case 'FINANCIAL':
        return (await this.prisma.payment.findMany({
          where: { tenantId },
          take: 500,
        })) as unknown as Record<string, unknown>[];
      default:
        return [];
    }
  }
}
