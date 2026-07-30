import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from '../users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { buildUser } from '../../../test/factories/user.factory';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    cache.reset();
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([buildUser()]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.findAll({ tenantId: testTenantId, page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
    });

    it('should filter by tenantId', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.findAll({ tenantId: testTenantId });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: testTenantId, deletedAt: null }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return user by id', async () => {
      cache.get.mockResolvedValue(null);
      const fakeUser = buildUser({ id: 'user-1' });
      prisma.user.findFirst.mockResolvedValue(fakeUser);

      const result = await service.findOne('user-1', testTenantId);

      expect(result).toEqual(fakeUser);
    });

    it('should throw NotFoundException when not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexist', testTenantId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update user', async () => {
      const fakeUser = buildUser({ id: 'user-1' });
      prisma.user.findFirst.mockResolvedValue(fakeUser);
      prisma.user.update.mockResolvedValue(fakeUser);

      const result = await service.update(
        'user-1',
        { firstName: 'Updated' },
        testTenantId,
        testUserId,
      );

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_UPDATED' }),
      );
    });
  });

  describe('softDelete', () => {
    it('should soft delete user', async () => {
      const fakeUser = buildUser({ id: 'user-1' });
      prisma.user.findFirst.mockResolvedValue(fakeUser);
      prisma.user.update.mockResolvedValue(fakeUser);

      await service.softDelete('user-1', testTenantId, testUserId);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_DELETED' }),
      );
    });
  });

  describe('restore', () => {
    it('should restore user', async () => {
      const fakeUser = buildUser({ id: 'user-1', deletedAt: new Date() });
      prisma.user.findFirst.mockResolvedValue(fakeUser);
      prisma.user.update.mockResolvedValue({ ...fakeUser, deletedAt: null });

      const result = await service.restore('user-1', testTenantId, testUserId);

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_RESTORED' }),
      );
    });
  });
});
