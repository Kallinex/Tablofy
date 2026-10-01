import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CampaignsService } from '../campaigns.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';

const TENANT = 'tenant-1';

const campaign = (overrides: Record<string, unknown> = {}) => ({
  id: 'camp-1',
  tenantId: TENANT,
  name: 'Spring sale',
  type: 'EMAIL',
  status: 'DRAFT',
  budget: 1000,
  metadata: {},
  deletedAt: null,
  templates: [],
  recipients: [],
  analytics: null,
  approval: null,
  _count: { recipients: 0 },
  ...overrides,
});

const promotion = (overrides: Record<string, unknown> = {}) => ({
  id: 'promo-1',
  tenantId: TENANT,
  code: 'SAVE10',
  type: 'PERCENTAGE',
  value: 10,
  status: 'ACTIVE',
  usedCount: 0,
  deletedAt: null,
  branchRestrictions: [],
  productRestrictions: [],
  categoryRestrictions: [],
  _count: { usages: 0 },
  ...overrides,
});

describe('CampaignsService campaign and promotion management', () => {
  let service: CampaignsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let cacheService: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
  let queueService: { addJob: jest.Mock };
  let auditLogsService: { log: jest.Mock };
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      campaign: {
        create: jest.fn().mockResolvedValue(campaign()),
        findFirst: jest.fn().mockResolvedValue(campaign()),
        findMany: jest.fn().mockResolvedValue([campaign()]),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(campaign()),
      },
      campaignTemplate: {
        create: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
        update: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
      },
      campaignRecipient: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      campaignApproval: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'appr-1' }),
        update: jest.fn().mockResolvedValue({ id: 'appr-1' }),
      },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      customerSegmentAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      promotion: {
        create: jest.fn().mockResolvedValue(promotion()),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(promotion()),
        findMany: jest.fn().mockResolvedValue([promotion()]),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(promotion()),
      },
      promotionUsage: { count: jest.fn().mockResolvedValue(0) },
      promotionBranchRestriction: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      promotionProductRestriction: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      promotionCategoryRestriction: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    queueService = {
      add: jest.fn(),
      addJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
    } as never;
    auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: CacheService, useValue: cacheService },
        { provide: QueueService, useValue: queueService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<CampaignsService>(CampaignsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createCampaign', () => {
    it('defaults the type to EMAIL and the status to DRAFT', async () => {
      await service.createCampaign({ name: 'Launch' } as never, TENANT, 'user-1');

      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT,
          name: 'Launch',
          type: 'EMAIL',
          status: 'DRAFT',
        }),
      });
      expect(prisma.campaignTemplate.create).not.toHaveBeenCalled();
    });

    it('honours an explicit type, status and schedule', async () => {
      await service.createCampaign(
        {
          name: 'Launch',
          type: 'SMS',
          status: 'SCHEDULED',
          startsAt: '2030-01-01T00:00:00.000Z',
          endsAt: '2030-02-01T00:00:00.000Z',
        } as never,
        TENANT,
      );

      const data = prisma.campaign.create.mock.calls[0][0].data;
      expect(data.type).toBe('SMS');
      expect(data.status).toBe('SCHEDULED');
      expect(data.startsAt).toEqual(new Date('2030-01-01T00:00:00.000Z'));
      expect(data.endsAt).toEqual(new Date('2030-02-01T00:00:00.000Z'));
    });

    it('persists a template when one is supplied', async () => {
      await service.createCampaign(
        {
          name: 'Launch',
          template: { channel: 'EMAIL', subject: 'Hi', body: '<p>Hi</p>' },
        } as never,
        TENANT,
      );

      expect(prisma.campaignTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ campaignId: 'camp-1', tenantId: TENANT, channel: 'EMAIL' }),
      });
    });

    it('creates recipients for targeted customers that have an email', async () => {
      prisma.customer.findMany.mockResolvedValue([
        { id: 'cust-1', email: 'a@b.c', phone: null },
        { id: 'cust-2', email: null, phone: '0100' },
      ]);

      await service.createCampaign(
        { name: 'Launch', targeting: { customerIds: ['cust-1', 'cust-2'] } } as never,
        TENANT,
      );

      expect(prisma.campaignRecipient.createMany).toHaveBeenCalledWith({
        data: [
          {
            campaignId: 'camp-1',
            tenantId: TENANT,
            recipient: 'a@b.c',
            channel: 'EMAIL',
            customerId: 'cust-1',
          },
        ],
        skipDuplicates: true,
      });
    });

    it('creates recipients for segment assignments that have an email', async () => {
      prisma.customerSegmentAssignment.findMany.mockResolvedValue([
        { customer: { id: 'cust-9', email: 'seg@b.c', phone: null } },
        { customer: { id: 'cust-8', email: null, phone: null } },
      ]);

      await service.createCampaign(
        { name: 'Launch', targeting: { segmentIds: ['seg-1'] } } as never,
        TENANT,
      );

      expect(prisma.campaignRecipient.createMany).toHaveBeenCalledWith({
        data: [
          {
            campaignId: 'camp-1',
            tenantId: TENANT,
            recipient: 'seg@b.c',
            channel: 'EMAIL',
            customerId: 'cust-9',
          },
        ],
        skipDuplicates: true,
      });
    });

    it('skips the recipient write when targeting resolves to nobody', async () => {
      await service.createCampaign(
        { name: 'Launch', targeting: { customerIds: [], segmentIds: [] } } as never,
        TENANT,
      );

      expect(prisma.campaignRecipient.createMany).not.toHaveBeenCalled();
    });

    it('audits, invalidates the list cache and emits the created event', async () => {
      await service.createCampaign({ name: 'Launch' } as never, TENANT, 'user-1');

      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CAMPAIGN_CREATE', resourceId: 'camp-1' }),
      );
      expect(cacheService.delete).toHaveBeenCalledWith(TENANT, 'campaigns:list');
      expect(eventEmitter.emit).toHaveBeenCalledWith('campaign.created', {
        tenantId: TENANT,
        campaignId: 'camp-1',
      });
    });
  });

  describe('updateCampaign', () => {
    it('throws NotFound for a campaign outside the tenant', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCampaign('camp-1', { name: 'x' } as never, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });

    it('refuses to update a completed or cancelled campaign', async () => {
      for (const status of ['COMPLETED', 'CANCELLED']) {
        prisma.campaign.findFirst.mockResolvedValue(campaign({ status }));

        await expect(
          service.updateCampaign('camp-1', { name: 'x' } as never, TENANT),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('updates the scalar fields and audits the change', async () => {
      await service.updateCampaign('camp-1', { name: 'Renamed' } as never, TENANT, 'user-1');

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: expect.objectContaining({ name: 'Renamed' }),
      });
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CAMPAIGN_UPDATE' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('campaign.updated', {
        tenantId: TENANT,
        campaignId: 'camp-1',
      });
    });

    it('updates an existing template when one is present', async () => {
      prisma.campaignTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });

      await service.updateCampaign(
        'camp-1',
        { template: { channel: 'SMS', subject: 'S', body: 'B' } } as never,
        TENANT,
      );

      expect(prisma.campaignTemplate.update).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
        data: { channel: 'SMS', subject: 'S', body: 'B' },
      });
      expect(prisma.campaignTemplate.create).not.toHaveBeenCalled();
    });

    it('creates a template when the campaign has none yet', async () => {
      prisma.campaignTemplate.findFirst.mockResolvedValue(null);

      await service.updateCampaign(
        'camp-1',
        { template: { channel: 'SMS', subject: 'S', body: 'B' } } as never,
        TENANT,
      );

      expect(prisma.campaignTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ campaignId: 'camp-1', tenantId: TENANT }),
      });
    });

    it('replaces the recipient set when new targeting is supplied', async () => {
      prisma.customer.findMany.mockResolvedValue([{ id: 'cust-1', email: 'new@b.c', phone: null }]);

      await service.updateCampaign(
        'camp-1',
        { targeting: { customerIds: ['cust-1'] } } as never,
        TENANT,
      );

      expect(prisma.campaignRecipient.deleteMany).toHaveBeenCalledWith({
        where: { campaignId: 'camp-1' },
      });
      expect(prisma.campaignRecipient.createMany).toHaveBeenCalled();
    });

    it('leaves the recipient set alone when targeting is absent', async () => {
      await service.updateCampaign('camp-1', { name: 'Renamed' } as never, TENANT);

      expect(prisma.campaignRecipient.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('deleteCampaign', () => {
    it('soft deletes, audits and invalidates the list cache', async () => {
      await service.deleteCampaign('camp-1', TENANT, 'user-1');

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CAMPAIGN_DELETE' }),
      );
      expect(cacheService.delete).toHaveBeenCalledWith(TENANT, 'campaigns:list');
    });

    it('throws NotFound for a campaign outside the tenant', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(service.deleteCampaign('camp-x', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getCampaign and listCampaigns', () => {
    it('loads the campaign with its relations', async () => {
      await service.getCampaign('camp-1', TENANT);

      expect(prisma.campaign.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'camp-1', tenantId: TENANT, deletedAt: null },
          include: expect.objectContaining({ templates: true, analytics: true, approval: true }),
        }),
      );
    });

    it('throws NotFound when the campaign is gone', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(service.getCampaign('camp-x', TENANT)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('paginates and totals with the default page size', async () => {
      const result = await service.listCampaigns(TENANT);

      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });

    it('applies status, type and search filters', async () => {
      await service.listCampaigns(TENANT, {
        status: 'ACTIVE',
        type: 'EMAIL',
        search: 'spring',
        page: 2,
        limit: 10,
      } as never);

      const where = prisma.campaign.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('ACTIVE');
      expect(where.type).toBe('EMAIL');
      expect(where.OR).toEqual([
        { name: { contains: 'spring', mode: 'insensitive' } },
        { description: { contains: 'spring', mode: 'insensitive' } },
      ]);
      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('rounds totalPages up for a partial last page', async () => {
      prisma.campaign.count.mockResolvedValue(21);

      const result = await service.listCampaigns(TENANT, { limit: 10 } as never);

      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('executeCampaign', () => {
    it('queues the execution, audits and emits the executed event', async () => {
      await service.executeCampaign('camp-1', TENANT, 'user-1');

      expect(queueService.addJob).toHaveBeenCalledWith(
        'campaign-execution',
        'execute-campaign',
        expect.objectContaining({ tenantId: TENANT }),
      );
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CAMPAIGN_EXECUTE' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('campaign.executed', {
        tenantId: TENANT,
        campaignId: 'camp-1',
      });
    });

    it('refuses to execute a completed or cancelled campaign', async () => {
      for (const status of ['COMPLETED', 'CANCELLED']) {
        prisma.campaign.findFirst.mockResolvedValue(campaign({ status }));

        await expect(service.executeCampaign('camp-1', TENANT)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
    });

    it('throws NotFound for a campaign outside the tenant', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(service.executeCampaign('camp-x', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('pauseCampaign', () => {
    it('pauses an active campaign and audits the change', async () => {
      prisma.campaign.findFirst.mockResolvedValue(campaign({ status: 'ACTIVE' }));

      await service.pauseCampaign('camp-1', TENANT, 'user-1');

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: { status: 'PAUSED' },
      });
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CAMPAIGN_PAUSE' }),
      );
    });

    it('refuses to pause a campaign that is not active', async () => {
      prisma.campaign.findFirst.mockResolvedValue(campaign({ status: 'DRAFT' }));

      await expect(service.pauseCampaign('camp-1', TENANT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFound for a campaign outside the tenant', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(service.pauseCampaign('camp-x', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cloneCampaign', () => {
    it('copies the campaign together with its templates', async () => {
      prisma.campaign.findFirst.mockResolvedValue(
        campaign({
          templates: [{ channel: 'EMAIL', subject: 'S', body: 'B', variables: { a: 1 } }],
        }),
      );

      await service.cloneCampaign('camp-1', TENANT, 'user-1');

      expect(prisma.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT }) }),
      );
      expect(prisma.campaignTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: 'EMAIL', variables: { a: 1 } }),
      });
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CAMPAIGN_CLONE' }),
      );
    });

    it('skips the template write when the campaign has none', async () => {
      prisma.campaign.findFirst.mockResolvedValue(campaign({ templates: [] }));

      await service.cloneCampaign('camp-1', TENANT);

      expect(prisma.campaignTemplate.create).not.toHaveBeenCalled();
    });

    it('throws NotFound for a campaign outside the tenant', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(service.cloneCampaign('camp-x', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('approveCampaign', () => {
    it('creates a new approval row when none exists', async () => {
      prisma.campaignApproval.findUnique.mockResolvedValue(null);

      const result = await service.approveCampaign('camp-1', TENANT, 'user-1', true, 'looks good');

      expect(result).toEqual({ campaignId: 'camp-1', approved: true, status: 'APPROVED' });
      expect(prisma.campaignApproval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campaignId: 'camp-1',
          tenantId: TENANT,
          approvedBy: 'user-1',
          rejectedBy: null,
          status: 'APPROVED',
          reason: 'looks good',
        }),
      });
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CAMPAIGN_APPROVE' }),
      );
    });

    it('updates the existing approval row when one is present', async () => {
      prisma.campaignApproval.findUnique.mockResolvedValue({ id: 'appr-1', campaignId: 'camp-1' });

      const result = await service.approveCampaign('camp-1', TENANT, 'user-1', false, 'bad target');

      expect(result).toEqual({ campaignId: 'camp-1', approved: false, status: 'REJECTED' });
      expect(prisma.campaignApproval.update).toHaveBeenCalledWith({
        where: { campaignId: 'camp-1' },
        data: expect.objectContaining({
          approvedBy: null,
          approvedAt: null,
          rejectedBy: 'user-1',
          rejectedAt: expect.any(Date),
          status: 'REJECTED',
        }),
      });
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CAMPAIGN_REJECT' }),
      );
    });

    it('throws NotFound for a campaign outside the tenant', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(
        service.approveCampaign('camp-x', TENANT, 'user-1', true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getCampaignAnalytics and getCampaignStats', () => {
    it('returns stored analytics when present', async () => {
      prisma.campaign.findFirst.mockResolvedValue(
        campaign({ analytics: { totalRecipients: 10, sentCount: 8, openedCount: 3 } }),
      );

      await expect(service.getCampaignAnalytics('camp-1', TENANT)).resolves.toEqual(
        expect.objectContaining({ totalRecipients: 10 }),
      );
    });

    it('returns zeroed analytics when none were recorded', async () => {
      prisma.campaign.findFirst.mockResolvedValue(campaign({ analytics: null }));

      await expect(service.getCampaignAnalytics('camp-1', TENANT)).resolves.toEqual({
        totalRecipients: 0,
        sentCount: 0,
        deliveredCount: 0,
        openedCount: 0,
        clickedCount: 0,
        bouncedCount: 0,
        failedCount: 0,
        conversionCount: 0,
        revenueGenerated: null,
      });
    });

    it('throws NotFound when the campaign is gone', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(service.getCampaignAnalytics('camp-x', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('serves the cached stats without touching the database', async () => {
      cacheService.get.mockResolvedValue({ total: 9 });

      await expect(service.getCampaignStats(TENANT)).resolves.toEqual({ total: 9 });
      expect(prisma.campaign.count).not.toHaveBeenCalled();
    });

    it('counts every status and caches the result', async () => {
      const result = await service.getCampaignStats(TENANT);

      expect(result).toEqual({
        total: 1,
        draft: 1,
        active: 1,
        paused: 1,
        completed: 1,
        cancelled: 1,
      });
      expect(cacheService.set).toHaveBeenCalledWith(TENANT, 'campaigns:stats', result, 300);
    });
  });

  describe('createPromotion', () => {
    it('creates a promotion with the default type and status', async () => {
      await service.createPromotion({ name: 'Ten off' } as never, TENANT, 'user-1');

      expect(prisma.promotion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT,
          type: 'PERCENTAGE',
          status: 'ACTIVE',
        }),
      });
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROMOTION_CREATE' }),
      );
      expect(cacheService.delete).toHaveBeenCalledWith(TENANT, 'promotions:list');
    });

    it('rejects a duplicate code within the tenant', async () => {
      prisma.promotion.findUnique.mockResolvedValue(promotion());

      await expect(
        service.createPromotion({ name: 'Dup', code: 'SAVE10' } as never, TENANT),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.promotion.create).not.toHaveBeenCalled();
    });

    it('skips the uniqueness check when no code is supplied', async () => {
      await service.createPromotion({ name: 'No code' } as never, TENANT);

      expect(prisma.promotion.findUnique).not.toHaveBeenCalled();
    });

    it('writes branch, product and category restrictions in one pass', async () => {
      await service.createPromotion(
        { name: 'Scoped', branchIds: ['b1'], productIds: ['p1'], categoryIds: ['c1'] } as never,
        TENANT,
      );

      expect(prisma.promotionBranchRestriction.createMany).toHaveBeenCalledWith({
        data: [{ promotionId: 'promo-1', branchId: 'b1', tenantId: TENANT }],
      });
      expect(prisma.promotionProductRestriction.createMany).toHaveBeenCalledWith({
        data: [{ promotionId: 'promo-1', productId: 'p1', tenantId: TENANT }],
      });
      expect(prisma.promotionCategoryRestriction.createMany).toHaveBeenCalledWith({
        data: [{ promotionId: 'promo-1', categoryId: 'c1', tenantId: TENANT }],
      });
    });

    it('writes no restrictions when every id list is empty', async () => {
      await service.createPromotion(
        { name: 'Scoped', branchIds: [], productIds: [], categoryIds: [] } as never,
        TENANT,
      );

      expect(prisma.promotionBranchRestriction.createMany).not.toHaveBeenCalled();
      expect(prisma.promotionProductRestriction.createMany).not.toHaveBeenCalled();
      expect(prisma.promotionCategoryRestriction.createMany).not.toHaveBeenCalled();
    });
  });

  describe('updatePromotion', () => {
    it('bumps the optimistic-lock version on every update', async () => {
      await service.updatePromotion('promo-1', { name: 'Renamed' } as never, TENANT);

      expect(prisma.promotion.update).toHaveBeenCalledWith({
        where: { id: 'promo-1' },
        data: expect.objectContaining({ version: { increment: 1 } }),
      });
    });

    it('throws NotFound for a promotion outside the tenant', async () => {
      prisma.promotion.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePromotion('promo-x', { name: 'x' } as never, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('replaces branch, product and category restrictions', async () => {
      await service.updatePromotion(
        'promo-1',
        { branchIds: ['b1'], productIds: ['p1'], categoryIds: ['c1'] } as never,
        TENANT,
      );

      expect(prisma.promotionBranchRestriction.deleteMany).toHaveBeenCalledWith({
        where: { promotionId: 'promo-1' },
      });
      expect(prisma.promotionProductRestriction.createMany).toHaveBeenCalled();
      expect(prisma.promotionCategoryRestriction.createMany).toHaveBeenCalled();
    });

    it('clears restrictions without re-inserting when the lists are emptied', async () => {
      await service.updatePromotion(
        'promo-1',
        { branchIds: [], productIds: [], categoryIds: [] } as never,
        TENANT,
      );

      expect(prisma.promotionBranchRestriction.deleteMany).toHaveBeenCalled();
      expect(prisma.promotionBranchRestriction.createMany).not.toHaveBeenCalled();
      expect(prisma.promotionProductRestriction.createMany).not.toHaveBeenCalled();
      expect(prisma.promotionCategoryRestriction.createMany).not.toHaveBeenCalled();
    });

    it('leaves restrictions untouched when the fields are absent', async () => {
      await service.updatePromotion('promo-1', { name: 'Renamed' } as never, TENANT);

      expect(prisma.promotionBranchRestriction.deleteMany).not.toHaveBeenCalled();
      expect(prisma.promotionProductRestriction.deleteMany).not.toHaveBeenCalled();
      expect(prisma.promotionCategoryRestriction.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('deletePromotion, getPromotion and getPromotionByCode', () => {
    it('soft deletes the promotion and audits the change', async () => {
      await service.deletePromotion('promo-1', TENANT, 'user-1');

      expect(prisma.promotion.update).toHaveBeenCalledWith({
        where: { id: 'promo-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROMOTION_DELETE' }),
      );
      expect(cacheService.delete).toHaveBeenCalledWith(TENANT, 'promotions:list');
    });

    it('throws NotFound when deleting a promotion outside the tenant', async () => {
      prisma.promotion.findFirst.mockResolvedValue(null);

      await expect(service.deletePromotion('promo-x', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('loads a promotion with its relations', async () => {
      await service.getPromotion('promo-1', TENANT);

      expect(prisma.promotion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'promo-1', tenantId: TENANT, deletedAt: null },
          include: expect.objectContaining({ branchRestrictions: true }),
        }),
      );
    });

    it('throws NotFound when the promotion is gone', async () => {
      prisma.promotion.findFirst.mockResolvedValue(null);

      await expect(service.getPromotion('promo-x', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('resolves an active promotion by code', async () => {
      await expect(service.getPromotionByCode('SAVE10', TENANT)).resolves.toEqual(
        expect.objectContaining({ code: 'SAVE10' }),
      );
      expect(prisma.promotion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ code: 'SAVE10', status: 'ACTIVE' }),
        }),
      );
    });

    it('throws NotFound for an inactive or foreign code', async () => {
      prisma.promotion.findFirst.mockResolvedValue(null);

      await expect(service.getPromotionByCode('SAVE10', 'tenant-other')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listPromotions', () => {
    it('paginates and totals with the default page size', async () => {
      const result = await service.listPromotions(TENANT);

      expect(prisma.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });

    it('applies type, status, code and search filters', async () => {
      await service.listPromotions(TENANT, {
        type: 'FIXED',
        status: 'ACTIVE',
        code: 'save',
        search: 'summer',
      } as never);

      const where = prisma.promotion.findMany.mock.calls[0][0].where;
      expect(where.type).toBe('FIXED');
      expect(where.status).toBe('ACTIVE');
      expect(where.code).toEqual({ contains: 'save', mode: 'insensitive' });
      expect(where.OR).toEqual([
        { name: { contains: 'summer', mode: 'insensitive' } },
        { description: { contains: 'summer', mode: 'insensitive' } },
      ]);
    });
  });

  describe('getPromotionStats', () => {
    it('serves the cached stats without touching the database', async () => {
      cacheService.get.mockResolvedValue({ total: 4 });

      await expect(service.getPromotionStats(TENANT)).resolves.toEqual({ total: 4 });
      expect(prisma.promotion.count).not.toHaveBeenCalled();
    });

    it('counts totals, active, expired and usage then caches the result', async () => {
      const result = await service.getPromotionStats(TENANT);

      expect(result).toEqual({ total: 1, active: 1, expired: 1, totalUsage: 0 });
      expect(cacheService.set).toHaveBeenCalledWith(TENANT, 'promotions:stats', result, 300);
    });
  });
});
