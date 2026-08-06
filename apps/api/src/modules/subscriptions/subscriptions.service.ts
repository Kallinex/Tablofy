import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../common/services/plan-limits.service';
import { Prisma, PlanType, SubscriptionStatus } from '@prisma/client';
import { PLAN_LIMITS } from '@tablofy/shared/constants';
import { ChangePlanDto } from './dto/change-plan.dto';

export interface PlanCatalogEntry {
  plan: PlanType;
  maxUsers: number;
  maxProducts: number;
  maxTables: number;
  maxBranches: number;
  monthlyPrice: number;
}

const BRANCH_LIMITS: Record<PlanType, number> = {
  FREE: 1,
  BASIC: 3,
  STANDARD: 10,
  PREMIUM: 50,
  ENTERPRISE: -1,
};

const PLAN_PRICES: Record<PlanType, number> = {
  FREE: 0,
  BASIC: 29,
  STANDARD: 99,
  PREMIUM: 299,
  ENTERPRISE: 999,
};

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly planLimitsService: PlanLimitsService,
  ) {}

  getPlans(): PlanCatalogEntry[] {
    return (Object.keys(PLAN_LIMITS) as PlanType[]).map((plan) => {
      const limits = PLAN_LIMITS[plan];
      return {
        plan,
        maxUsers: limits.maxUsers,
        maxProducts: limits.maxProducts,
        maxTables: limits.maxTables,
        maxBranches: BRANCH_LIMITS[plan],
        monthlyPrice: PLAN_PRICES[plan],
      };
    });
  }

  async getCurrent(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    const usage = await this.planLimitsService.getPlanUsage(tenantId);

    return { ...subscription, usage };
  }

  async changePlan(
    tenantId: string,
    dto: ChangePlanDto,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (dto.plan === subscription.plan) {
      throw new BadRequestException('Tenant is already on this plan');
    }

    await this.assertDowngradeFits(tenantId, dto.plan, subscription);

    const updated = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.update({
        where: { tenantId },
        data: {
          plan: dto.plan,
          status:
            subscription.status === SubscriptionStatus.CANCELED
              ? SubscriptionStatus.ACTIVE
              : subscription.status,
          endDate:
            subscription.status === SubscriptionStatus.CANCELED ? null : subscription.endDate,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'SUBSCRIPTION_PLAN_CHANGED',
          resource: 'Subscription',
          resourceId: sub.id,
          userId,
          tenantId,
          oldValues: { plan: subscription.plan } as Prisma.InputJsonValue,
          newValues: { plan: dto.plan } as Prisma.InputJsonValue,
          ...meta,
        },
      });

      return sub;
    });

    this.logger.log(`Tenant ${tenantId} changed plan to ${dto.plan}`);

    return updated;
  }

  async cancel(
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (subscription.status === SubscriptionStatus.CANCELED) {
      throw new BadRequestException('Subscription is already canceled');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.update({
        where: { tenantId },
        data: { status: SubscriptionStatus.CANCELED, endDate: new Date() },
      });

      await tx.auditLog.create({
        data: {
          action: 'SUBSCRIPTION_CANCELED',
          resource: 'Subscription',
          resourceId: sub.id,
          userId,
          tenantId,
          oldValues: { status: subscription.status } as Prisma.InputJsonValue,
          newValues: { status: SubscriptionStatus.CANCELED } as Prisma.InputJsonValue,
        },
      });

      return sub;
    });

    await this.auditLogsService.log({
      action: 'SUBSCRIPTION_CANCELED_NOTIFIED',
      resource: 'Subscription',
      resourceId: updated.id,
      userId,
      tenantId,
      newValues: { plan: updated.plan },
      ...meta,
    });

    return updated;
  }

  async reactivate(
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (subscription.status !== SubscriptionStatus.CANCELED) {
      throw new BadRequestException('Only a canceled subscription can be reactivated');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.update({
        where: { tenantId },
        data: { status: SubscriptionStatus.ACTIVE, endDate: null },
      });

      await tx.auditLog.create({
        data: {
          action: 'SUBSCRIPTION_REACTIVATED',
          resource: 'Subscription',
          resourceId: sub.id,
          userId,
          tenantId,
          oldValues: { status: SubscriptionStatus.CANCELED } as Prisma.InputJsonValue,
          newValues: { status: SubscriptionStatus.ACTIVE } as Prisma.InputJsonValue,
        },
      });

      return sub;
    });

    await this.auditLogsService.log({
      action: 'SUBSCRIPTION_REACTIVATED_NOTIFIED',
      resource: 'Subscription',
      resourceId: updated.id,
      userId,
      tenantId,
      newValues: { plan: updated.plan },
      ...meta,
    });

    return updated;
  }

  private async assertDowngradeFits(
    tenantId: string,
    targetPlan: PlanType,
    current: { plan: PlanType },
  ): Promise<void> {
    const order: Record<PlanType, number> = {
      FREE: 0,
      BASIC: 1,
      STANDARD: 2,
      PREMIUM: 3,
      ENTERPRISE: 4,
    };

    if (order[targetPlan] >= order[current.plan]) {
      return;
    }

    const counts = await this.planLimitsService.getResourceCounts(tenantId);
    const limits = PLAN_LIMITS[targetPlan];
    const branchLimit = BRANCH_LIMITS[targetPlan];
    const failures: string[] = [];

    const check = (label: string, currentCount: number, limit: number) => {
      if (limit !== -1 && currentCount > limit) {
        failures.push(`${label} (${currentCount}/${limit})`);
      }
    };

    check('users', counts.users, limits.maxUsers);
    check('products', counts.products, limits.maxProducts);
    check('tables', counts.tables, limits.maxTables);
    check('branches', counts.branches, branchLimit);

    if (failures.length > 0) {
      throw new BadRequestException(
        `Cannot downgrade: current usage exceeds target plan limits — ${failures.join(', ')}`,
      );
    }
  }
}
