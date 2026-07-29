import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { Prisma, PromotionStatus, CampaignType } from '@prisma/client';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { CampaignQueryDto } from './dto/campaign-query.dto';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { PromotionQueryDto } from './dto/promotion-query.dto';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Campaigns ──

  async createCampaign(dto: CreateCampaignDto, tenantId: string, userId?: string) {
    const campaign = await this.prisma.campaign.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        type: dto.type ?? 'EMAIL',
        status: dto.status ?? 'DRAFT',
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        budget: dto.budget,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
    });

    if (dto.template) {
      await this.prisma.campaignTemplate.create({
        data: {
          campaignId: campaign.id,
          tenantId,
            channel: dto.template.channel,
            subject: dto.template.subject,
            body: dto.template.body!,
            variables: dto.template.variables as Prisma.InputJsonValue,
        },
      });
    }

    if (dto.targeting) {
      await this.addTargeting(campaign.id, dto.targeting, tenantId);
    }

    await this.auditLogsService.log({
      action: 'CAMPAIGN_CREATE',
      resource: 'Campaign',
      resourceId: campaign.id,
      userId,
      tenantId,
      newValues: { name: dto.name, type: dto.type, status: dto.status },
    });

    await this.cacheService.delete(tenantId, 'campaigns:list');

    this.eventEmitter.emit('campaign.created', { tenantId, campaignId: campaign.id });

    return this.getCampaignWithRelations(campaign.id, tenantId);
  }

  async updateCampaign(id: string, dto: UpdateCampaignDto, tenantId: string, userId?: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    if (campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED') {
      throw new BadRequestException('Cannot update completed or cancelled campaign');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        status: dto.status,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        budget: dto.budget,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
    });

    if (dto.template) {
      const existing = await this.prisma.campaignTemplate.findFirst({
        where: { campaignId: id },
      });
      const tplUpdate: Prisma.CampaignTemplateUpdateInput = {};
      if (dto.template.channel) tplUpdate.channel = dto.template.channel;
      if (dto.template.subject) tplUpdate.subject = dto.template.subject;
      if (dto.template.body) tplUpdate.body = dto.template.body;
      if (dto.template.variables) tplUpdate.variables = dto.template.variables as Prisma.InputJsonValue;
      if (existing) {
        await this.prisma.campaignTemplate.update({
          where: { id: existing.id },
          data: tplUpdate,
        });
      } else {
        await this.prisma.campaignTemplate.create({
          data: {
            campaignId: id,
            tenantId,
            channel: dto.template.channel!,
            subject: dto.template.subject,
            body: dto.template.body!,
            variables: dto.template.variables as Prisma.InputJsonValue,
          },
        });
      }
    }

    if (dto.targeting) {
      await this.prisma.campaignRecipient.deleteMany({ where: { campaignId: id } });
      await this.addTargeting(id, dto.targeting, tenantId);
    }

    await this.auditLogsService.log({
      action: 'CAMPAIGN_UPDATE',
      resource: 'Campaign',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: campaign.name, status: campaign.status },
      newValues: { name: dto.name, status: dto.status },
    });

    await this.cacheService.delete(tenantId, 'campaigns:list');

    this.eventEmitter.emit('campaign.updated', { tenantId, campaignId: id });

    return this.getCampaignWithRelations(id, tenantId);
  }

  async deleteCampaign(id: string, tenantId: string, userId?: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    await this.prisma.campaign.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'CAMPAIGN_DELETE',
      resource: 'Campaign',
      resourceId: id,
      userId,
      tenantId,
    });

    await this.cacheService.delete(tenantId, 'campaigns:list');
  }

  async getCampaign(id: string, tenantId: string) {
    return this.getCampaignWithRelations(id, tenantId);
  }

  async listCampaigns(tenantId: string, query?: CampaignQueryDto) {
    const page = query?.page || 1;
    const limit = query?.limit || 20;
    const where: Record<string, unknown> = { tenantId, deletedAt: null };

    if (query?.type) where.type = query.type;
    if (query?.status) where.status = query.status;
    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        include: {
          templates: true,
          analytics: true,
          approval: true,
          _count: { select: { recipients: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async executeCampaign(id: string, tenantId: string, userId?: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { templates: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    if (campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED') {
      throw new BadRequestException('Cannot execute completed or cancelled campaign');
    }

    await this.prisma.campaign.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    await this.auditLogsService.log({
      action: 'CAMPAIGN_EXECUTE',
      resource: 'Campaign',
      resourceId: id,
      userId,
      tenantId,
    });

    await this.queueService.addJob('campaign-execution', 'execute-campaign', {
      tenantId,
      userId,
      payload: { campaignId: id },
    });

    this.eventEmitter.emit('campaign.executed', { tenantId, campaignId: id });

    return { campaignId: id, status: 'ACTIVE', queued: true };
  }

  async pauseCampaign(id: string, tenantId: string, userId?: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    if (campaign.status !== 'ACTIVE') {
      throw new BadRequestException('Only active campaigns can be paused');
    }

    await this.prisma.campaign.update({
      where: { id },
      data: { status: 'PAUSED' },
    });

    await this.auditLogsService.log({
      action: 'CAMPAIGN_PAUSE',
      resource: 'Campaign',
      resourceId: id,
      userId,
      tenantId,
    });

    return { campaignId: id, status: 'PAUSED' };
  }

  async cloneCampaign(id: string, tenantId: string, userId?: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { templates: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const clone = await this.prisma.campaign.create({
      data: {
        tenantId,
        name: `${campaign.name} (Copy)`,
        description: campaign.description,
        type: campaign.type,
        status: 'DRAFT',
        budget: campaign.budget,
        metadata: campaign.metadata as Prisma.InputJsonValue,
      },
    });

    if (campaign.templates.length > 0) {
      for (const tpl of campaign.templates) {
        await this.prisma.campaignTemplate.create({
          data: {
            campaignId: clone.id,
            tenantId,
            channel: tpl.channel as any,
            subject: tpl.subject,
            body: tpl.body,
            variables: tpl.variables as Prisma.InputJsonValue,
          },
        });
      }
    }

    await this.auditLogsService.log({
      action: 'CAMPAIGN_CLONE',
      resource: 'Campaign',
      resourceId: clone.id,
      userId,
      tenantId,
      newValues: { originalId: id, name: clone.name },
    });

    return this.getCampaignWithRelations(clone.id, tenantId);
  }

  async approveCampaign(id: string, tenantId: string, userId: string, approved: boolean, reason?: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const existingApproval = await this.prisma.campaignApproval.findUnique({
      where: { campaignId: id },
    });

    if (existingApproval) {
      await this.prisma.campaignApproval.update({
        where: { campaignId: id },
        data: {
          approvedBy: approved ? userId : null,
          approvedAt: approved ? new Date() : null,
          rejectedBy: approved ? null : userId,
          rejectedAt: approved ? null : new Date(),
          reason: reason,
          status: approved ? 'APPROVED' : 'REJECTED',
        },
      });
    } else {
      await this.prisma.campaignApproval.create({
        data: {
          campaignId: id,
          tenantId,
          approvedBy: approved ? userId : null,
          approvedAt: approved ? new Date() : null,
          rejectedBy: approved ? null : userId,
          rejectedAt: approved ? null : new Date(),
          reason: reason,
          status: approved ? 'APPROVED' : 'REJECTED',
        },
      });
    }

    await this.auditLogsService.log({
      action: approved ? 'CAMPAIGN_APPROVE' : 'CAMPAIGN_REJECT',
      resource: 'Campaign',
      resourceId: id,
      userId,
      tenantId,
      newValues: { status: approved ? 'APPROVED' : 'REJECTED', reason },
    });

    return { campaignId: id, approved, status: approved ? 'APPROVED' : 'REJECTED' };
  }

  async getCampaignAnalytics(campaignId: string, tenantId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      include: { analytics: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    return campaign.analytics || {
      totalRecipients: 0,
      sentCount: 0,
      deliveredCount: 0,
      openedCount: 0,
      clickedCount: 0,
      bouncedCount: 0,
      failedCount: 0,
      conversionCount: 0,
      revenueGenerated: null,
    };
  }

  async getCampaignStats(tenantId: string) {
    const cacheKey = 'campaigns:stats';
    const cached = await this.cacheService.get<Record<string, unknown>>(tenantId, cacheKey);
    if (cached) return cached;

    const [total, draft, active, paused, completed, cancelled] = await Promise.all([
      this.prisma.campaign.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.campaign.count({ where: { tenantId, status: 'DRAFT', deletedAt: null } }),
      this.prisma.campaign.count({ where: { tenantId, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.campaign.count({ where: { tenantId, status: 'PAUSED', deletedAt: null } }),
      this.prisma.campaign.count({ where: { tenantId, status: 'COMPLETED', deletedAt: null } }),
      this.prisma.campaign.count({ where: { tenantId, status: 'CANCELLED', deletedAt: null } }),
    ]);

    const stats = { total, draft, active, paused, completed, cancelled };
    await this.cacheService.set(tenantId, cacheKey, stats, 300);
    return stats;
  }

  private async getCampaignWithRelations(id: string, tenantId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        templates: true,
        recipients: { take: 20, orderBy: { createdAt: 'desc' } },
        analytics: true,
        approval: true,
        _count: { select: { recipients: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  private async addTargeting(
    campaignId: string,
    targeting: { segmentIds?: string[]; customerIds?: string[]; tags?: string[] },
    tenantId: string,
  ) {
    const recipients: Prisma.CampaignRecipientCreateManyInput[] = [];

    if (targeting.customerIds) {
      const customers = await this.prisma.customer.findMany({
        where: { id: { in: targeting.customerIds }, tenantId, deletedAt: null },
        select: { id: true, email: true, phone: true },
      });
      for (const c of customers) {
        if (c.email) {
          recipients.push({ campaignId, tenantId, recipient: c.email, channel: CampaignType.EMAIL, customerId: c.id });
        }
      }
    }

    if (targeting.segmentIds) {
      const assignments = await this.prisma.customerSegmentAssignment.findMany({
        where: { segmentId: { in: targeting.segmentIds }, tenantId },
        include: { customer: { select: { id: true, email: true, phone: true } } },
      });
      for (const a of assignments) {
        if (a.customer.email) {
          recipients.push({ campaignId, tenantId, recipient: a.customer.email, channel: CampaignType.EMAIL, customerId: a.customer.id });
        }
      }
    }

    if (recipients.length > 0) {
      await this.prisma.campaignRecipient.createMany({
        data: recipients,
        skipDuplicates: true,
      });
    }
  }

  // ── Promotions ──

  async createPromotion(dto: CreatePromotionDto, tenantId: string, userId?: string) {
    if (dto.code) {
      const existing = await this.prisma.promotion.findUnique({
        where: { tenantId_code: { tenantId, code: dto.code } },
      });
      if (existing) throw new ConflictException('Promotion code already exists');
    }

    const promotion = await this.prisma.promotion.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        type: dto.type ?? 'PERCENTAGE',
        status: dto.status ?? 'ACTIVE',
        value: dto.value,
        maxDiscount: dto.maxDiscount,
        minOrderAmount: dto.minOrderAmount,
        buyQuantity: dto.buyQuantity,
        getQuantity: dto.getQuantity,
        freeProductId: dto.freeProductId,
        freeProductName: dto.freeProductName,
        code: dto.code,
        usageLimit: dto.usageLimit,
        usagePerCustomer: dto.usagePerCustomer,
        usagePerTenant: dto.usagePerTenant,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        isStackable: dto.isStackable,
      },
    });

    if (dto.branchIds?.length) {
      await this.prisma.promotionBranchRestriction.createMany({
        data: dto.branchIds.map((branchId) => ({
          promotionId: promotion.id,
          branchId,
          tenantId,
        })),
      });
    }

    if (dto.productIds?.length) {
      await this.prisma.promotionProductRestriction.createMany({
        data: dto.productIds.map((productId) => ({
          promotionId: promotion.id,
          productId,
          tenantId,
        })),
      });
    }

    if (dto.categoryIds?.length) {
      await this.prisma.promotionCategoryRestriction.createMany({
        data: dto.categoryIds.map((categoryId) => ({
          promotionId: promotion.id,
          categoryId,
          tenantId,
        })),
      });
    }

    await this.auditLogsService.log({
      action: 'PROMOTION_CREATE',
      resource: 'Promotion',
      resourceId: promotion.id,
      userId,
      tenantId,
      newValues: { name: dto.name, type: dto.type, code: dto.code },
    });

    await this.cacheService.delete(tenantId, 'promotions:list');

    return this.getPromotionWithRelations(promotion.id, tenantId);
  }

  async updatePromotion(id: string, dto: UpdatePromotionDto, tenantId: string, userId?: string) {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!promotion) throw new NotFoundException('Promotion not found');

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        status: dto.status,
        value: dto.value,
        maxDiscount: dto.maxDiscount,
        minOrderAmount: dto.minOrderAmount,
        buyQuantity: dto.buyQuantity,
        getQuantity: dto.getQuantity,
        freeProductId: dto.freeProductId,
        freeProductName: dto.freeProductName,
        code: dto.code,
        usageLimit: dto.usageLimit,
        usagePerCustomer: dto.usagePerCustomer,
        usagePerTenant: dto.usagePerTenant,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        isStackable: dto.isStackable,
        version: { increment: 1 },
      },
    });

    if (dto.branchIds !== undefined) {
      await this.prisma.promotionBranchRestriction.deleteMany({ where: { promotionId: id } });
      if (dto.branchIds.length > 0) {
        await this.prisma.promotionBranchRestriction.createMany({
          data: dto.branchIds.map((branchId) => ({ promotionId: id, branchId, tenantId })),
        });
      }
    }

    if (dto.productIds !== undefined) {
      await this.prisma.promotionProductRestriction.deleteMany({ where: { promotionId: id } });
      if (dto.productIds.length > 0) {
        await this.prisma.promotionProductRestriction.createMany({
          data: dto.productIds.map((productId) => ({ promotionId: id, productId, tenantId })),
        });
      }
    }

    if (dto.categoryIds !== undefined) {
      await this.prisma.promotionCategoryRestriction.deleteMany({ where: { promotionId: id } });
      if (dto.categoryIds.length > 0) {
        await this.prisma.promotionCategoryRestriction.createMany({
          data: dto.categoryIds.map((categoryId) => ({ promotionId: id, categoryId, tenantId })),
        });
      }
    }

    await this.auditLogsService.log({
      action: 'PROMOTION_UPDATE',
      resource: 'Promotion',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: promotion.name, status: promotion.status },
      newValues: { name: dto.name, status: dto.status },
    });

    await this.cacheService.delete(tenantId, 'promotions:list');

    return this.getPromotionWithRelations(id, tenantId);
  }

  async deletePromotion(id: string, tenantId: string, userId?: string) {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!promotion) throw new NotFoundException('Promotion not found');

    await this.prisma.promotion.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'PROMOTION_DELETE',
      resource: 'Promotion',
      resourceId: id,
      userId,
      tenantId,
    });

    await this.cacheService.delete(tenantId, 'promotions:list');
  }

  async getPromotion(id: string, tenantId: string) {
    return this.getPromotionWithRelations(id, tenantId);
  }

  async getPromotionByCode(code: string, tenantId: string) {
    const promotion = await this.prisma.promotion.findFirst({
      where: { code, tenantId, deletedAt: null, status: 'ACTIVE' },
      include: {
        branchRestrictions: true,
        productRestrictions: true,
        categoryRestrictions: true,
      },
    });
    if (!promotion) throw new NotFoundException('Promotion not found');
    return promotion;
  }

  async listPromotions(tenantId: string, query?: PromotionQueryDto) {
    const page = query?.page || 1;
    const limit = query?.limit || 20;
    const where: Record<string, unknown> = { tenantId, deletedAt: null };

    if (query?.type) where.type = query.type;
    if (query?.status) where.status = query.status;
    if (query?.code) where.code = { contains: query.code, mode: 'insensitive' };
    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.promotion.findMany({
        where,
        include: {
          branchRestrictions: true,
          productRestrictions: true,
          categoryRestrictions: true,
          _count: { select: { usages: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.promotion.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async validatePromotion(code: string, tenantId?: string, customerId?: string, orderAmount?: number) {
    const where: Prisma.PromotionWhereInput = { code, deletedAt: null };
    if (tenantId) where.tenantId = tenantId;
    const promotion = await this.prisma.promotion.findFirst({ where });
    if (!promotion) throw new NotFoundException('Promotion not found');

    const errors: string[] = [];

    if (promotion.status !== 'ACTIVE') {
      errors.push('Promotion is not active');
    }

    const now = new Date();
    if (promotion.startsAt && now < promotion.startsAt) {
      errors.push('Promotion has not started yet');
    }
    if (promotion.endsAt && now > promotion.endsAt) {
      errors.push('Promotion has expired');
    }

    if (promotion.usageLimit && promotion.usedCount >= promotion.usageLimit) {
      errors.push('Promotion usage limit reached');
    }

    if (promotion.minOrderAmount && orderAmount && orderAmount < Number(promotion.minOrderAmount)) {
      errors.push(`Minimum order amount of ${promotion.minOrderAmount} required`);
    }

    if (customerId && promotion.usagePerCustomer) {
      const usageCount = await this.prisma.promotionUsage.count({
        where: { promotionId: promotion.id, customerId },
      });
      if (usageCount >= promotion.usagePerCustomer) {
        errors.push('Per-customer usage limit reached');
      }
    }

    return {
      valid: errors.length === 0,
      promotion,
      errors,
    };
  }

  async usePromotion(code: string, customerId: string, orderAmount: number, tenantId: string, orderId?: string) {
    const { valid, promotion, errors } = await this.validatePromotion(code, tenantId, customerId, orderAmount);
    if (!valid) throw new BadRequestException(errors.join('; '));

    let discountAmount = 0;
    if (promotion.type === 'PERCENTAGE') {
      discountAmount = orderAmount * (Number(promotion.value) / 100);
      if (promotion.maxDiscount) {
        discountAmount = Math.min(discountAmount, Number(promotion.maxDiscount));
      }
    } else if (promotion.type === 'FIXED') {
      discountAmount = Number(promotion.value);
    }

    await this.prisma.promotionUsage.create({
      data: {
        promotionId: promotion.id,
        customerId,
        orderId,
        tenantId,
        discountAmount,
      },
    });

    await this.prisma.promotion.update({
      where: { id: promotion.id },
      data: {
        usedCount: { increment: 1 },
        version: { increment: 1 },
      },
    });

    await this.auditLogsService.log({
      action: 'PROMOTION_USED',
      resource: 'Promotion',
      resourceId: promotion.id,
      userId: customerId,
      tenantId,
      newValues: { code, discountAmount, orderAmount },
    });

    this.eventEmitter.emit('promotion.used', { tenantId, promotionId: promotion.id, customerId, discountAmount });

    return {
      promotionId: promotion.id,
      code: promotion.code,
      discountAmount,
      finalAmount: orderAmount - discountAmount,
    };
  }

  async getPromotionStats(tenantId: string) {
    const cacheKey = 'promotions:stats';
    const cached = await this.cacheService.get<Record<string, unknown>>(tenantId, cacheKey);
    if (cached) return cached;

    const [total, active, expired, totalUsage] = await Promise.all([
      this.prisma.promotion.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.promotion.count({ where: { tenantId, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.promotion.count({ where: { tenantId, status: 'EXPIRED', deletedAt: null } }),
      this.prisma.promotionUsage.count({ where: { tenantId } }),
    ]);

    const stats = { total, active, expired, totalUsage };
    await this.cacheService.set(tenantId, cacheKey, stats, 300);
    return stats;
  }

  private async getPromotionWithRelations(id: string, tenantId: string) {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        branchRestrictions: true,
        productRestrictions: true,
        categoryRestrictions: true,
        _count: { select: { usages: true } },
      },
    });
    if (!promotion) throw new NotFoundException('Promotion not found');
    return promotion;
  }
}
