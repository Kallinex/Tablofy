import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { Prisma } from '@prisma/client';
import { CronTime } from 'cron';
import { CreateScheduledReportDto } from './dto/create-scheduled-report.dto';
import { UpdateScheduledReportDto } from './dto/update-scheduled-report.dto';
import { ScheduledReportQueryDto } from './dto/scheduled-report-query.dto';
import { EXPORT_EXTENSIONS, EXPORT_MIME_TYPES } from '../export-engine/export-storage.service';

export interface ReportExportCompletedEvent {
  tenantId: string;
  exportId: string;
  filePath: string;
  absolutePath: string;
  fileSize: number;
  type: string;
  scheduledReportId?: string;
}

@Injectable()
export class ScheduledReportsService {
  private readonly logger = new Logger(ScheduledReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
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

  async update(tenantId: string, id: string, dto: UpdateScheduledReportDto, userId?: string) {
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
      userId,
      tenantId,
      oldValues: { name: existing.name, type: existing.type },
      newValues: { name: updated.name, type: updated.type },
    });

    await this.cacheService.deletePattern(tenantId, 'scheduled-reports:*');
    return updated;
  }

  async remove(tenantId: string, id: string, userId?: string) {
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
      userId,
      tenantId,
      oldValues: { name: existing.name },
    });

    await this.cacheService.deletePattern(tenantId, 'scheduled-reports:*');
  }

  async trigger(tenantId: string, id: string, userId?: string) {
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

  async runDueReports(): Promise<{ scanned: number; triggered: string[]; skipped: number }> {
    const reports = await this.prisma.scheduledReport.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, tenantId: true, schedule: true, lastRunAt: true },
    });

    const now = new Date();
    const triggered: string[] = [];
    let skipped = 0;

    for (const report of reports) {
      if (!this.isDue(report.schedule, report.lastRunAt, now)) {
        skipped++;
        continue;
      }
      try {
        const result = await this.trigger(report.tenantId, report.id);
        triggered.push(result.exportId);
      } catch (error) {
        this.logger.error(
          `Scheduled report ${report.id} (tenant ${report.tenantId}) failed to trigger: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.logger.log(
      `Scheduled report scan complete: ${reports.length} active, ${triggered.length} triggered, ${skipped} not due`,
    );
    return { scanned: reports.length, triggered, skipped };
  }

  @OnEvent('report-export.completed')
  async handleReportExportCompleted(event: ReportExportCompletedEvent) {
    if (!event?.scheduledReportId) {
      return;
    }

    const report = await this.prisma.scheduledReport.findFirst({
      where: { id: event.scheduledReportId, tenantId: event.tenantId, deletedAt: null },
    });
    if (!report || !report.isActive) {
      return;
    }

    const recipients = Array.isArray(report.recipients) ? report.recipients : [];
    if (recipients.length === 0) {
      this.logger.warn(`Scheduled report ${report.id} has no recipients; no email queued`);
      return;
    }

    try {
      const ext = EXPORT_EXTENSIONS[event.type];
      const attachments = ext
        ? [
            {
              filename: `${event.exportId}.${ext}`,
              path: event.absolutePath,
              contentType: EXPORT_MIME_TYPES[event.type],
            },
          ]
        : [];

      await this.queueService.addJob('email', 'send-email', {
        tenantId: event.tenantId,
        payload: {
          to: recipients.join(', '),
          subject: `Scheduled report: ${report.name}`,
          body: `Your scheduled report "${report.name}" is ready.`,
          attachments,
        } as Record<string, unknown>,
      });

      await this.auditLogsService.log({
        action: 'SCHEDULED_REPORT_EMAIL_QUEUED',
        resource: 'ScheduledReport',
        resourceId: report.id,
        tenantId: event.tenantId,
        newValues: { exportId: event.exportId, recipients: recipients.length },
      });
    } catch (error) {
      this.logger.error(
        `Failed to queue scheduled report email for ${report.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private isDue(schedule: string, lastRunAt: Date | null, now: Date): boolean {
    try {
      const nextRun = new CronTime(schedule).getNextDateFrom(lastRunAt ?? new Date(0)).toJSDate();
      return nextRun.getTime() <= now.getTime();
    } catch {
      this.logger.warn(`Scheduled report has an invalid cron schedule "${schedule}"; skipping`);
      return false;
    }
  }
}
