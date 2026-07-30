import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService, QueueJobData } from '../queues/queue.service';
import { Prisma } from '@prisma/client';
import { GenerateExportDto, ExportType } from './dto/generate-export.dto';
import { ExportQueryDto } from './dto/export-query.dto';
import { Job } from 'bullmq';
import * as Excel from 'exceljs';
import * as PDFDocument from 'pdfkit';

@Injectable()
export class ExportEngineService {
  private readonly logger = new Logger(ExportEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async generateExport(tenantId: string, userId: string, dto: GenerateExportDto) {
    const exportRecord = await this.prisma.reportExport.create({
      data: {
        tenantId,
        type: dto.type,
        reportType: dto.reportType,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
        config: (dto.config ?? {}) as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });

    await this.queueService.addJob('export-engine', 'generate-export', {
      tenantId,
      userId,
      payload: { exportId: exportRecord.id } as Record<string, unknown>,
    });

    await this.auditLogsService.log({
      action: 'EXPORT_GENERATED',
      resource: 'ReportExport',
      resourceId: exportRecord.id,
      userId,
      tenantId,
      newValues: { type: dto.type, reportType: dto.reportType },
    });

    return exportRecord;
  }

  async processExport(job: Job<QueueJobData>) {
    const { tenantId, payload } = job.data;
    const exportId = payload?.exportId as string | undefined;
    if (!exportId) throw new Error('exportId is required');

    const exportRecord = await this.prisma.reportExport.findFirst({
      where: { id: exportId, tenantId },
    });
    if (!exportRecord) throw new NotFoundException('Export not found');

    await this.prisma.reportExport.update({
      where: { id: exportId },
      data: { status: 'PROCESSING' },
    });

    try {
      const data = await this.fetchReportData(exportRecord);
      const columns = this.getColumnsForReportType(exportRecord.reportType);
      let buffer: Buffer;
      let filePath: string;

      switch (exportRecord.type as ExportType) {
        case 'CSV':
          buffer = Buffer.from(this.generateCsv(data, columns));
          filePath = `exports/${tenantId}/${exportId}.csv`;
          break;
        case 'EXCEL':
          buffer = await this.generateExcel(data, columns, exportRecord.reportType);
          filePath = `exports/${tenantId}/${exportId}.xlsx`;
          break;
        case 'PDF':
          buffer = await this.generatePdf(exportRecord.reportType, data, columns);
          filePath = `exports/${tenantId}/${exportId}.pdf`;
          break;
        default:
          throw new Error(`Unsupported export type: ${exportRecord.type}`);
      }

      await this.prisma.reportExport.update({
        where: { id: exportId },
        data: {
          status: 'COMPLETED',
          filePath,
          fileSize: buffer.length,
          completedAt: new Date(),
        },
      });

      this.logger.log(`Export ${exportId} completed for tenant ${tenantId}`);
      return { processed: true, exportId, filePath, fileSize: buffer.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export processing failed';
      await this.prisma.reportExport.update({
        where: { id: exportId },
        data: { status: 'FAILED', errorMessage: message },
      });
      throw error;
    }
  }

  async getExport(tenantId: string, exportId: string) {
    const exportRecord = await this.prisma.reportExport.findFirst({
      where: { id: exportId, tenantId, deletedAt: null },
    });
    if (!exportRecord) throw new NotFoundException('Export not found');
    return exportRecord;
  }

  async listExports(tenantId: string, query: ExportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ReportExportWhereInput = { tenantId, deletedAt: null };
    if (query.type) where.type = query.type;
    if (query.reportType) where.reportType = query.reportType;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.reportExport.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.reportExport.count({ where }),
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

  async downloadExport(tenantId: string, exportId: string) {
    const exportRecord = await this.prisma.reportExport.findFirst({
      where: { id: exportId, tenantId, deletedAt: null },
    });
    if (!exportRecord) throw new NotFoundException('Export not found');
    if (exportRecord.status !== 'COMPLETED')
      throw new NotFoundException('Export not yet completed');
    return {
      filePath: exportRecord.filePath,
      fileSize: exportRecord.fileSize,
      type: exportRecord.type,
      reportType: exportRecord.reportType,
      completedAt: exportRecord.completedAt,
    };
  }

  generateCsv(data: Record<string, unknown>[], columns: { key: string; header: string }[]): string {
    const header = columns.map((c) => this.escapeCsvField(c.header)).join(',');
    const rows = data.map((row) =>
      columns.map((c) => this.escapeCsvField(String(row[c.key] ?? ''))).join(','),
    );
    return [header, ...rows].join('\r\n');
  }

  async generateExcel(
    data: Record<string, unknown>[],
    columns: { key: string; header: string }[],
    sheetName: string,
  ): Promise<Buffer> {
    const workbook = new Excel.Workbook();
    const sheet = workbook.addWorksheet(sheetName ?? 'Export');

    sheet.columns = columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: Math.max(c.header.length, 12),
    }));

    data.forEach((row) => sheet.addRow(row));

    sheet.getRow(1).font = { bold: true };

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  async generatePdf(
    title: string,
    data: Record<string, unknown>[],
    columns: { key: string; header: string }[],
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const PDFDocumentConstructor = PDFDocument as unknown as new (
      options?: Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => any;
    const doc = new PDFDocumentConstructor({ margin: 30, size: 'A4' });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(16).text(title, { align: 'center' });
    doc.moveDown();

    const tableTop = doc.y;
    const colWidth = (doc.page.width - 60) / columns.length;

    doc.fontSize(10).font('Helvetica-Bold');
    columns.forEach((col, i) => {
      doc.text(col.header, 30 + i * colWidth, tableTop, {
        width: colWidth,
        align: 'left',
      });
    });

    doc.moveDown(0.5);
    let yPos = doc.y;
    doc.font('Helvetica');

    data.forEach((row) => {
      if (yPos > doc.page.height - 60) {
        doc.addPage();
        yPos = 30;
      }
      columns.forEach((col, i) => {
        doc.text(String(row[col.key] ?? ''), 30 + i * colWidth, yPos, {
          width: colWidth,
          align: 'left',
        });
      });
      yPos += 18;
    });

    doc.end();

    return new Promise((resolve) => {
      doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });
  }

  async getDashboardSnapshot(
    tenantId: string,
    user: { id: string },
    config: Record<string, unknown>,
  ) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [ordersToday, revenueToday, activeOrders, totalCustomers, lowStockItems, delayedTickets] =
      await Promise.all([
        this.prisma.order.count({
          where: { tenantId, createdAt: { gte: todayStart } },
        }),
        this.prisma.payment.aggregate({
          where: { tenantId, processedAt: { gte: todayStart } },
          _sum: { amount: true },
        }),
        this.prisma.order.count({
          where: { tenantId, status: { in: ['PENDING', 'IN_PREPARATION'] } },
        }),
        this.prisma.customer.count({
          where: { tenantId, createdAt: { gte: todayStart } },
        }),
        this.prisma.inventoryItem.findMany({
          where: { tenantId, deletedAt: null, currentQuantity: { lte: 5 } },
          take: 10,
        }),
        this.prisma.kitchenTicket.count({
          where: {
            tenantId,
            status: { in: ['PENDING', 'PREPARING'] },
            createdAt: { gte: todayStart },
          },
        }),
      ]);

    return {
      timestamp: now.toISOString(),
      kpi: {
        ordersToday,
        revenueToday: revenueToday._sum.amount ?? 0,
        activeOrders,
        newCustomers: totalCustomers,
        lowStockItems: lowStockItems.length,
        delayedTickets,
      },
      config,
    };
  }

  private async fetchReportData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exportRecord: any,
  ): Promise<Record<string, unknown>[]> {
    const { tenantId, reportType, periodStart, periodEnd } = exportRecord;
    const dateFilter =
      periodStart || periodEnd
        ? {
            ...(periodStart ? { gte: new Date(periodStart) } : {}),
            ...(periodEnd ? { lte: new Date(periodEnd) } : {}),
          }
        : undefined;

    switch (reportType) {
      case 'SALES':
        return (await this.prisma.order.findMany({
          where: { tenantId, ...(dateFilter ? { createdAt: dateFilter } : {}) },
          include: { items: true, payments: true },
          take: 1000,
        })) as unknown as Record<string, unknown>[];
      case 'INVENTORY':
        return (await this.prisma.inventoryItem.findMany({
          where: { tenantId, deletedAt: null },
          take: 1000,
        })) as unknown as Record<string, unknown>[];
      case 'KITCHEN':
        return (await this.prisma.kitchenTicket.findMany({
          where: { tenantId, ...(dateFilter ? { createdAt: dateFilter } : {}) },
          take: 1000,
        })) as unknown as Record<string, unknown>[];
      case 'FINANCIAL':
        return (await this.prisma.payment.findMany({
          where: { tenantId, ...(dateFilter ? { processedAt: dateFilter } : {}) },
          take: 1000,
        })) as unknown as Record<string, unknown>[];
      default:
        return [];
    }
  }

  private getColumnsForReportType(reportType: string): { key: string; header: string }[] {
    switch (reportType) {
      case 'SALES':
        return [
          { key: 'id', header: 'Order ID' },
          { key: 'status', header: 'Status' },
          { key: 'total', header: 'Total' },
          { key: 'createdAt', header: 'Date' },
        ];
      case 'INVENTORY':
        return [
          { key: 'id', header: 'Item ID' },
          { key: 'name', header: 'Name' },
          { key: 'currentQuantity', header: 'Quantity' },
          { key: 'unitCost', header: 'Unit Cost' },
        ];
      case 'KITCHEN':
        return [
          { key: 'id', header: 'Ticket ID' },
          { key: 'status', header: 'Status' },
          { key: 'createdAt', header: 'Created' },
          { key: 'completedAt', header: 'Completed' },
        ];
      case 'FINANCIAL':
        return [
          { key: 'id', header: 'Payment ID' },
          { key: 'method', header: 'Method' },
          { key: 'amount', header: 'Amount' },
          { key: 'processedAt', header: 'Date' },
        ];
      default:
        return [{ key: 'id', header: 'ID' }];
    }
  }

  private escapeCsvField(value: string): string {
    if (
      value.includes(',') ||
      value.includes('"') ||
      value.includes('\n') ||
      value.includes('\r')
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
