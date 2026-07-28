import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateBranchSettingsDto } from './dto/update-branch-settings.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, Branch } from '@prisma/client';

@Injectable()
export class BranchSettingsService {
  private readonly logger = new Logger(BranchSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getSettings(restaurantId: string, branchId: string, tenantId: string): Promise<Branch> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, restaurantId, tenantId, deletedAt: null },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  async updateSettings(
    restaurantId: string,
    branchId: string,
    dto: UpdateBranchSettingsDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Branch> {
    const existing = await this.prisma.branch.findFirst({
      where: { id: branchId, restaurantId, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Branch not found');
    }

    const currentMetadata = (existing.metadata as Record<string, unknown>) ?? {};

    const mergedMetadata: Record<string, unknown> = { ...currentMetadata };
    if (dto.tax !== undefined) mergedMetadata.tax = dto.tax;
    if (dto.receipt !== undefined) mergedMetadata.receipt = dto.receipt;
    if (dto.orders !== undefined) mergedMetadata.orders = dto.orders;
    if (dto.custom !== undefined) mergedMetadata.custom = dto.custom;

    const updated = await this.prisma.branch.update({
      where: { id: branchId },
      data: { metadata: mergedMetadata as Prisma.InputJsonValue },
    });

    await this.auditLogsService.log({
      action: 'BRANCH_SETTINGS_UPDATED',
      resource: 'Branch',
      resourceId: branchId,
      userId,
      tenantId,
      oldValues: { metadata: currentMetadata },
      newValues: { metadata: mergedMetadata },
      ...meta,
    });

    return updated;
  }
}
