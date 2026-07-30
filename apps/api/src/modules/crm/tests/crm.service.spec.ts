import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CrmService } from '../crm.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('CrmService', () => {
  let service: CrmService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<CrmService>(CrmService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    eventEmitter = module.get(EventEmitter2) as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    cache.reset();
    eventEmitter.reset();
    jest.clearAllMocks();
  });

  describe('addTimelineEntry', () => {
    const dto = {
      type: 'NOTE',
      title: 'Customer visit',
      description: 'Visited restaurant on Friday',
    };

    it('should create timeline entry', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.crmTimelineEntry.create.mockResolvedValue({
        id: 'entry-1',
        ...dto,
        tenantId: testTenantId,
        customerId: 'cust-1',
      });

      const result = await service.addTimelineEntry(
        'cust-1',
        dto as never,
        testTenantId,
        testUserId,
      );

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CRM_TIMELINE_ADD' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('crm.timeline.added', expect.any(Object));
    });

    it('should throw NotFoundException for invalid customer', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.addTimelineEntry('nonexist', dto as never, testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getTimeline', () => {
    it('should return paginated timeline entries', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.crmTimelineEntry.findMany.mockResolvedValue([{ id: 'entry-1' }]);
      prisma.crmTimelineEntry.count.mockResolvedValue(1);

      const result = await service.getTimeline('cust-1', testTenantId);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should filter by type', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.crmTimelineEntry.findMany.mockResolvedValue([]);
      prisma.crmTimelineEntry.count.mockResolvedValue(0);

      await service.getTimeline('cust-1', testTenantId, 1, 20, 'NOTE' as never);

      expect(prisma.crmTimelineEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'NOTE' }),
        }),
      );
    });
  });

  describe('sendCommunication', () => {
    const dto = {
      customerId: 'cust-1',
      channel: 'EMAIL',
      recipient: 'john@test.com',
      subject: 'Welcome',
      body: 'Welcome to our restaurant!',
    };

    it('should create communication record', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenantId: testTenantId });
      prisma.communicationLog.create.mockResolvedValue({
        id: 'comm-1',
        ...dto,
        tenantId: testTenantId,
      });

      const result = await service.sendCommunication(dto as never, testTenantId, testUserId);

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMM_SEND' }));
    });
  });

  describe('getCommunicationLogs', () => {
    it('should return paginated communications', async () => {
      prisma.communicationLog.findMany.mockResolvedValue([{ id: 'comm-1' }]);
      prisma.communicationLog.count.mockResolvedValue(1);

      const result = await service.getCommunicationLogs(testTenantId, 1, 20);

      expect(result.data).toHaveLength(1);
    });
  });
});
