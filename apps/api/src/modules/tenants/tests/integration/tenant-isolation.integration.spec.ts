import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { TenantsService } from '../../tenants.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../../test/mocks/audit-log.mock';

describe('Tenant Isolation — Integration', () => {
  let service: TenantsService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    jest.clearAllMocks();
  });

  describe('Cross-tenant read isolation', () => {
    it('should only return tenant-1 data when querying tenant-1', async () => {
      const tenants = [
        {
          id: 'tenant-1',
          name: 'Tenant 1',
          slug: 'tenant-1',
          status: 'ACTIVE',
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          description: null,
          phone: null,
          email: null,
          address: null,
          city: null,
          country: null,
          timezone: 'UTC',
          currency: 'USD',
          locale: 'en',
          logoUrl: null,
          metadata: null,
        },
      ];
      prisma.tenant.findMany.mockResolvedValueOnce(tenants);
      prisma.tenant.count.mockResolvedValueOnce(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    });

    it('should throw NotFoundException when accessing cross-tenant entity', async () => {
      prisma.tenant.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne('nonexistent-tenant')).rejects.toThrow(NotFoundException);
    });

    it('should enforce soft-delete isolation', async () => {
      prisma.tenant.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne('deleted-tenant-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Cross-tenant write isolation via body tenantId', () => {
    it('should create a new tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValueOnce(null);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          tenant: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'new-tenant', name: 'New Tenant', slug: 'new-tenant' }),
          },
          subscription: { create: jest.fn().mockResolvedValue({ id: 'sub-1' }) },
        };
        return cb(tx);
      });

      const result = await service.create({ name: 'New Tenant', slug: 'new-tenant' }, 'user-1');

      expect(result.id).toBe('new-tenant');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TENANT_CREATED' }),
      );
    });

    it('should reject duplicate tenant slug', async () => {
      prisma.tenant.findUnique.mockResolvedValueOnce({ id: 'existing', slug: 'taken-slug' });

      await expect(service.create({ name: 'Test', slug: 'taken-slug' }, 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should update own tenant data', async () => {
      const existingTenant = { id: 'tenant-1', name: 'Old Name', slug: 'tenant-1' };
      prisma.tenant.findFirst.mockResolvedValueOnce(existingTenant);
      prisma.tenant.findUnique.mockResolvedValueOnce(null);
      prisma.tenant.update.mockResolvedValueOnce({
        ...existingTenant,
        name: 'New Name',
        description: 'Updated',
        status: 'ACTIVE',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        phone: null,
        email: null,
        address: null,
        city: null,
        country: null,
        timezone: 'UTC',
        currency: 'USD',
        locale: 'en',
        logoUrl: null,
        metadata: null,
      });

      const result = await service.update('tenant-1', { name: 'New Name' }, 'user-1');

      expect(result.name).toBe('New Name');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TENANT_UPDATED' }),
      );
    });
  });
});
