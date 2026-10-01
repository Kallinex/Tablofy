import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { BranchesService } from '../branches.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../../common/services/plan-limits.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { UpdateBranchDto } from '../dto/update-branch.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('BranchesService', () => {
  let service: BranchesService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;
  let planLimits: { checkLimit: jest.Mock };

  beforeAll(async () => {
    planLimits = { checkLimit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchesService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: PlanLimitsService, useValue: planLimits },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<BranchesService>(BranchesService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
    planLimits.checkLimit.mockReset();
    planLimits.checkLimit.mockResolvedValue({
      allowed: true,
      current: 0,
      limit: 5,
      resource: 'branches',
    });
  });

  const branch = {
    id: 'br-1',
    tenantId: testTenantId,
    restaurantId,
    name: 'Main',
    slug: 'main',
    type: 'BRANCH',
    timezone: 'UTC',
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the restaurant to belong to the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          asDto<CreateBranchDto>({ name: 'Main', slug: 'main' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a duplicate slug within the restaurant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.branch.findFirst.mockResolvedValue(branch);

      await expect(
        service.create(
          asDto<CreateBranchDto>({ name: 'Main', slug: 'main' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('enforces the plan branch limit', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.branch.findFirst.mockResolvedValue(null);
      planLimits.checkLimit.mockResolvedValue({
        allowed: false,
        current: 5,
        limit: 5,
        resource: 'branches',
      });

      await expect(
        service.create(
          asDto<CreateBranchDto>({ name: 'Main', slug: 'main' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('applies defaults, audits and emits on success', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.branch.findFirst.mockResolvedValue(null);
      prisma.branch.create.mockResolvedValue({ ...branch, id: 'br-9' });

      await service.create(
        asDto<CreateBranchDto>({ name: 'Main', slug: 'main' }),
        restaurantId,
        testTenantId,
        userId,
      );

      const data = prisma.branch.create.mock.calls[0][0].data;
      expect(data.type).toBe('BRANCH');
      expect(data.timezone).toBe('UTC');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BRANCH_CREATED', resourceId: 'br-9' }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'branch.created',
        expect.objectContaining({ branchId: 'br-9' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant with filters and pagination', async () => {
      prisma.branch.findMany.mockResolvedValue([branch]);
      prisma.branch.count.mockResolvedValue(25);

      const result = await service.findAll({
        tenantId: testTenantId,
        restaurantId,
        page: 2,
        limit: 10,
        search: 'ma',
        isActive: true,
      });

      const where = prisma.branch.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: testTenantId,
        deletedAt: null,
        restaurantId,
        isActive: true,
      });
      expect(where.OR).toHaveLength(3);
      expect(result.meta).toEqual({ total: 25, page: 2, limit: 10, totalPages: 3 });
    });

    it('does not constrain isActive when the filter is omitted', async () => {
      prisma.branch.findMany.mockResolvedValue([]);
      prisma.branch.count.mockResolvedValue(0);

      await service.findAll({ tenantId: testTenantId });

      expect(prisma.branch.findMany.mock.calls[0][0].where.isActive).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('throws when not found for the tenant', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(service.findOne('br-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.branch.findFirst).toHaveBeenCalledWith({
        where: { id: 'br-1', tenantId: testTenantId, deletedAt: null },
      });
    });
  });

  describe('update', () => {
    it('rejects a slug used by another branch of the restaurant', async () => {
      prisma.branch.findFirst
        .mockResolvedValueOnce(branch) // findOne
        .mockResolvedValueOnce({ id: 'br-2' }); // clash

      await expect(
        service.update('br-1', asDto<UpdateBranchDto>({ slug: 'other' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('only writes provided fields and emits updated', async () => {
      prisma.branch.findFirst.mockResolvedValue(branch);
      prisma.branch.update.mockResolvedValue(branch);

      await service.update(
        'br-1',
        asDto<UpdateBranchDto>({ name: 'Downtown' }),
        testTenantId,
        userId,
      );

      expect(prisma.branch.update.mock.calls[0][0].data).toEqual({ name: 'Downtown' });
      expect(events.emit).toHaveBeenCalledWith(
        'branch.updated',
        expect.objectContaining({ branchId: 'br-1' }),
      );
    });
  });

  describe('softDelete / restore', () => {
    it('soft-deletes, deactivates and emits', async () => {
      prisma.branch.findFirst.mockResolvedValue(branch);
      prisma.branch.update.mockResolvedValue({});

      await service.softDelete('br-1', testTenantId, userId);

      const data = prisma.branch.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
      expect(events.emit).toHaveBeenCalledWith(
        'branch.deleted',
        expect.objectContaining({ branchId: 'br-1' }),
      );
    });

    it('restores a deleted branch', async () => {
      prisma.branch.findFirst.mockResolvedValue({ ...branch, deletedAt: new Date() });
      prisma.branch.update.mockResolvedValue(branch);

      await service.restore('br-1', testTenantId, userId);

      expect(prisma.branch.findFirst.mock.calls[0][0].where.deletedAt).toEqual({ not: null });
      expect(prisma.branch.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws when restoring a branch that is not deleted', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(service.restore('br-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
