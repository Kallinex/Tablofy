import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TenantsService } from '../tenants.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { buildTenant } from '../../../test/factories/tenant.factory';
import { testUserId } from '../../../test/fixtures/auth.fixture';

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
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

  describe('findOne', () => {
    it('should return tenant', async () => {
      const fakeTenant = buildTenant({ id: 'tenant-1' });
      cache.get.mockResolvedValue(null);
      prisma.tenant.findFirst.mockResolvedValue(fakeTenant);

      const result = await service.findOne('tenant-1');

      expect(result).toEqual(fakeTenant);
    });

    it('should throw NotFoundException when not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.tenant.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update tenant settings', async () => {
      const fakeTenant = buildTenant({ id: 'tenant-1' });
      prisma.tenant.findFirst.mockResolvedValue(fakeTenant);
      prisma.tenant.update.mockResolvedValue(fakeTenant);

      const result = await service.update('tenant-1', { name: 'Updated' } as never, testUserId);

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TENANT_UPDATED' }),
      );
    });
  });

  describe('findBySlug', () => {
    it('should return tenant by slug', async () => {
      const fakeTenant = buildTenant({ id: 'tenant-1' });
      prisma.tenant.findFirst.mockResolvedValue(fakeTenant);

      const result = await service.findBySlug('my-restaurant');

      expect(result).toEqual(fakeTenant);
    });

    it('should throw NotFoundException when slug not found', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      await expect(service.findBySlug('nonexist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('should soft delete tenant', async () => {
      const fakeTenant = buildTenant({ id: 'tenant-1' });
      prisma.tenant.findFirst.mockResolvedValue(fakeTenant);
      prisma.tenant.update.mockResolvedValue({ ...fakeTenant, deletedAt: new Date() });

      await service.softDelete('tenant-1', testUserId);

      expect(prisma.tenant.update).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TENANT_DELETED' }),
      );
    });
  });
});
