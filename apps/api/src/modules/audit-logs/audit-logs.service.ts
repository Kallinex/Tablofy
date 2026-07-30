import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface AuditLogEntry {
  action: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  tenantId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
  executionDuration?: number;
  browser?: string;
  device?: string;
}

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    if (!entry.tenantId) {
      this.logger.debug(
        `Skipping audit log for ${entry.action} on ${entry.resource}: no tenant context`,
      );
      return;
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId,
          userId: entry.userId,
          tenantId: entry.tenantId,
          oldValues: entry.oldValues ? (entry.oldValues as Prisma.InputJsonValue) : undefined,
          newValues: entry.newValues ? (entry.newValues as Prisma.InputJsonValue) : undefined,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log: ${entry.action} on ${entry.resource}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async findAll(params: {
    tenantId?: string;
    userId?: string;
    action?: string;
    resource?: string;
    page?: number;
    limit?: number;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    data: Array<Record<string, unknown>>;
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, userId, action, resource, page = 1, limit = 20, startDate, endDate } = params;

    const where: Record<string, unknown> = {};
    if (tenantId) where.tenantId = tenantId;
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
