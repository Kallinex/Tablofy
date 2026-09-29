import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from '../users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../../common/services/plan-limits.service';
import { CacheService } from '../../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { buildUser } from '../../../test/factories/user.factory';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';
import { CreateUserDto } from '../dto/create-user.dto';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let planLimits: { checkLimit: jest.Mock };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        {
          provide: PlanLimitsService,
          useValue: { checkLimit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    planLimits = module.get(PlanLimitsService) as unknown as { checkLimit: jest.Mock };
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    cache.reset();
    jest.clearAllMocks();
    // default: a tenant with room to spare
    planLimits.checkLimit.mockResolvedValue({
      allowed: true,
      current: 1,
      limit: 5,
      resource: 'users',
    });
  });

  describe('create - plan user limit', () => {
    const dto: CreateUserDto = {
      email: 'New.Staff@Tablofy.test',
      password: 'Str0ngPass!2026',
      firstName: 'New',
      lastName: 'Staff',
      role: 'STAFF' as never,
    };

    it('rejects creation once the plan user limit is reached', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      planLimits.checkLimit.mockResolvedValue({
        allowed: false,
        current: 5,
        limit: 5,
        resource: 'users',
      });

      await expect(service.create(dto, testUserId, testTenantId, 'OWNER' as never)).rejects.toThrow(
        BadRequestException,
      );

      expect(planLimits.checkLimit).toHaveBeenCalledWith(testTenantId, 'users');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('includes the current count and the limit in the error so the UI can upsell', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      planLimits.checkLimit.mockResolvedValue({
        allowed: false,
        current: 15,
        limit: 15,
        resource: 'users',
      });

      await expect(service.create(dto, testUserId, testTenantId, 'OWNER' as never)).rejects.toThrow(
        /Current: 15, Limit: 15/,
      );
    });

    it('allows creation while under the limit', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      planLimits.checkLimit.mockResolvedValue({
        allowed: true,
        current: 4,
        limit: 5,
        resource: 'users',
      });
      prisma.user.create.mockResolvedValue(buildUser());

      await service.create(dto, testUserId, testTenantId, 'OWNER' as never);

      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('does not consume a seat check for a duplicate email', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());

      await expect(service.create(dto, testUserId, testTenantId, 'OWNER' as never)).rejects.toThrow(
        ConflictException,
      );

      expect(planLimits.checkLimit).not.toHaveBeenCalled();
    });
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

  describe('create', () => {
    it('should create a STAFF user when no role is provided', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const created = buildUser({ id: 'user-new', role: 'STAFF' });
      prisma.user.create.mockResolvedValue(created);

      const dto: CreateUserDto = {
        email: 'new@test.com',
        password: 'StrongPass1',
        firstName: 'New',
        lastName: 'User',
      };

      const result = await service.create(dto, testUserId, testTenantId, 'MANAGER');
      expect(result.role).toBe('STAFF');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: 'STAFF' }),
        }),
      );
    });

    it('should allow OWNER to create a MANAGER', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const created = buildUser({ id: 'user-new', role: 'MANAGER' });
      prisma.user.create.mockResolvedValue(created);

      const dto: CreateUserDto = {
        email: 'manager@test.com',
        password: 'StrongPass1',
        firstName: 'New',
        lastName: 'Manager',
        role: 'MANAGER',
      };

      const result = await service.create(dto, testUserId, testTenantId, 'OWNER');
      expect(result.role).toBe('MANAGER');
    });

    it('should reject MANAGER creating an OWNER (privilege escalation)', async () => {
      const dto: CreateUserDto = {
        email: 'owner@test.com',
        password: 'StrongPass1',
        firstName: 'New',
        lastName: 'Owner',
        role: 'OWNER',
      };

      await expect(service.create(dto, testUserId, testTenantId, 'MANAGER')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject MANAGER creating a MANAGER', async () => {
      const dto: CreateUserDto = {
        email: 'manager@test.com',
        password: 'StrongPass1',
        firstName: 'New',
        lastName: 'Manager',
        role: 'MANAGER',
      };

      await expect(service.create(dto, testUserId, testTenantId, 'MANAGER')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject any tenant role assigning SUPER_ADMIN', async () => {
      const dto: CreateUserDto = {
        email: 'super@test.com',
        password: 'StrongPass1',
        firstName: 'New',
        lastName: 'Super',
        role: 'SUPER_ADMIN',
      };

      await expect(service.create(dto, testUserId, testTenantId, 'OWNER')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.create(dto, testUserId, testTenantId, 'MANAGER')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should convert a duplicate-email P2002 into a ConflictException', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`tenantId`,`email`)',
        { code: 'P2002', clientVersion: 'test', meta: { target: ['tenantId', 'email'] } },
      );
      prisma.user.create.mockRejectedValue(conflict);

      const dto: CreateUserDto = {
        email: 'dup@test.com',
        password: 'StrongPass1',
        firstName: 'Dup',
        lastName: 'User',
      };

      await expect(service.create(dto, testUserId, testTenantId, 'OWNER')).rejects.toThrow(
        ConflictException,
      );
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('should rethrow an unrelated P2002 as the original error', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const unrelated = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`phone`)',
        { code: 'P2002', clientVersion: 'test', meta: { target: ['phone'] } },
      );
      prisma.user.create.mockRejectedValue(unrelated);

      const dto: CreateUserDto = {
        email: 'other@test.com',
        password: 'StrongPass1',
        firstName: 'Other',
        lastName: 'User',
      };

      await expect(service.create(dto, testUserId, testTenantId, 'OWNER')).rejects.toMatchObject({
        code: 'P2002',
      });
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('should use a provided transaction client for reads and writes', async () => {
      const txUser = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(buildUser({ id: 'user-tx' })),
      };
      const tx = { user: txUser } as never;

      const dto: CreateUserDto = {
        email: 'tx@test.com',
        password: 'StrongPass1',
        firstName: 'Tx',
        lastName: 'User',
      };

      const result = await service.create(dto, testUserId, testTenantId, 'OWNER', undefined, tx);

      expect(txUser.findFirst).toHaveBeenCalled();
      expect(txUser.create).toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.id).toBe('user-tx');
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
        'OWNER',
      );

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_UPDATED' }),
      );
    });

    it('should reject MANAGER updating an OWNER', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser({ id: 'owner-1', role: 'OWNER' }));

      await expect(
        service.update('owner-1', { firstName: 'Hacked' }, testTenantId, testUserId, 'MANAGER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject MANAGER promoting a user to MANAGER', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser({ id: 'staff-1', role: 'STAFF' }));

      await expect(
        service.update('staff-1', { role: 'MANAGER' }, testTenantId, testUserId, 'MANAGER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject any tenant role promoting a user to SUPER_ADMIN', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser({ id: 'staff-1', role: 'STAFF' }));

      await expect(
        service.update('staff-1', { role: 'SUPER_ADMIN' }, testTenantId, testUserId, 'OWNER'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('softDelete', () => {
    it('should soft delete user', async () => {
      const fakeUser = buildUser({ id: 'user-1' });
      prisma.user.findFirst.mockResolvedValue(fakeUser);
      prisma.user.update.mockResolvedValue(fakeUser);

      await service.softDelete('user-1', testTenantId, testUserId, 'OWNER');

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

    it('should reject MANAGER deleting an OWNER', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser({ id: 'owner-1', role: 'OWNER' }));

      await expect(
        service.softDelete('owner-1', testTenantId, testUserId, 'MANAGER'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('restore', () => {
    it('should restore user', async () => {
      const fakeUser = buildUser({ id: 'user-1', deletedAt: new Date() });
      prisma.user.findFirst.mockResolvedValue(fakeUser);
      prisma.user.update.mockResolvedValue({ ...fakeUser, deletedAt: null });

      const result = await service.restore('user-1', testTenantId, testUserId, 'OWNER');

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_RESTORED' }),
      );
    });

    it('should reject MANAGER restoring an OWNER', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildUser({ id: 'owner-1', role: 'OWNER', deletedAt: new Date() }),
      );

      await expect(service.restore('owner-1', testTenantId, testUserId, 'MANAGER')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
