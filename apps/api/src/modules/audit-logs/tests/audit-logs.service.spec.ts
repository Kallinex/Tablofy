import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsService } from '../audit-logs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  let prisma: MockPrisma;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditLogsService, { provide: PrismaService, useValue: createMockPrisma() }],
    }).compile();

    service = module.get<AuditLogsService>(AuditLogsService);
    prisma = module.get(PrismaService) as MockPrisma;
  });

  beforeEach(() => {
    prisma.reset();
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create audit log entry', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      await service.log({
        action: 'USER_CREATED',
        resource: 'User',
        resourceId: 'user-1',
        userId: testUserId,
        tenantId: testTenantId,
        newValues: { email: 'test@test.com' },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'USER_CREATED',
            resource: 'User',
            tenantId: testTenantId,
          }),
        }),
      );
    });

    it('should skip logging when no tenantId', async () => {
      await service.log({
        action: 'USER_CREATED',
        resource: 'User',
      });

      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('should handle prisma errors gracefully', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB connection error'));

      await expect(
        service.log({
          action: 'USER_CREATED',
          resource: 'User',
          tenantId: testTenantId,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('findAll', () => {
    it('should return paginated audit logs', async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll({ tenantId: testTenantId });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });

    it('should filter by action and userId', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({
        tenantId: testTenantId,
        userId: 'user-1',
        action: 'USER_CREATED',
        resource: 'User',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: testTenantId,
            userId: 'user-1',
            action: 'USER_CREATED',
            resource: 'User',
          }),
        }),
      );
    });

    it('should filter by date range', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      await service.findAll({ tenantId: testTenantId, startDate, endDate });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: startDate, lte: endDate },
          }),
        }),
      );
    });
  });
});
