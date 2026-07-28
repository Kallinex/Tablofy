import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanType } from '@prisma/client';
import { PLAN_LIMITS } from '@tablofy/shared/constants';

interface ResourceCounts {
  users: number;
  products: number;
  tables: number;
  branches: number;
}

interface PlanLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  resource: string;
}

const BRANCH_LIMITS: Record<PlanType, number> = {
  FREE: 1,
  BASIC: 3,
  STANDARD: 10,
  PREMIUM: 50,
  ENTERPRISE: -1,
};

@Injectable()
export class PlanLimitsService {
  private readonly logger = new Logger(PlanLimitsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkLimit(tenantId: string, resource: keyof ResourceCounts): Promise<PlanLimitResult> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new Error('No subscription found for tenant');
    }

    const plan = subscription.plan;
    const limits = PLAN_LIMITS[plan];
    let limitValue: number;

    if (resource === 'branches') {
      limitValue = BRANCH_LIMITS[plan];
    } else {
      const planLimits = limits as Record<string, number>;
      const key = `max${resource.charAt(0).toUpperCase()}${resource.slice(1)}`;
      limitValue = planLimits[key] ?? 0;
    }

    if (limitValue === -1) {
      return { allowed: true, current: 0, limit: -1, resource };
    }

    const current = await this.getCurrentCount(tenantId, resource);

    return {
      allowed: current < limitValue,
      current,
      limit: limitValue,
      resource,
    };
  }

  async enforceLimit(tenantId: string, resource: keyof ResourceCounts): Promise<void> {
    const result = await this.checkLimit(tenantId, resource);

    if (!result.allowed) {
      this.logger.warn(
        `Plan limit exceeded: ${resource} ${result.current}/${result.limit} for tenant ${tenantId}`,
      );
      throw new Error(
        `Plan limit exceeded for ${resource}. Current: ${result.current}, Limit: ${result.limit}. Please upgrade your plan.`,
      );
    }
  }

  async getResourceCounts(tenantId: string): Promise<ResourceCounts> {
    const [users, products, tables, branches] = await Promise.all([
      this.prisma.user.count({
        where: this.prisma.softDeleteWhere({ tenantId }),
      }),
      this.prisma.product.count({
        where: this.prisma.softDeleteWhere({ tenantId }),
      }),
      this.prisma.table.count({
        where: this.prisma.softDeleteWhere({ tenantId }),
      }),
      this.prisma.branch.count({
        where: this.prisma.softDeleteWhere({ tenantId }),
      }),
    ]);

    return { users, products, tables, branches };
  }

  async getPlanUsage(
    tenantId: string,
  ): Promise<Record<string, { current: number; limit: number }>> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      return {};
    }

    const limits = PLAN_LIMITS[subscription.plan];
    const counts = await this.getResourceCounts(tenantId);

    return {
      users: { current: counts.users, limit: limits.maxUsers },
      products: { current: counts.products, limit: limits.maxProducts },
      tables: { current: counts.tables, limit: limits.maxTables },
      branches: { current: counts.branches, limit: BRANCH_LIMITS[subscription.plan] },
    };
  }

  private async getCurrentCount(tenantId: string, resource: keyof ResourceCounts): Promise<number> {
    const where = this.prisma.softDeleteWhere({ tenantId });
    switch (resource) {
      case 'users':
        return this.prisma.user.count({ where });
      case 'products':
        return this.prisma.product.count({ where });
      case 'tables':
        return this.prisma.table.count({ where });
      case 'branches':
        return this.prisma.branch.count({ where });
      default:
        return 0;
    }
  }
}
