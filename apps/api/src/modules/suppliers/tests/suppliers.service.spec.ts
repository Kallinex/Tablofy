import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SuppliersService } from '../suppliers.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('SuppliersService', () => {
  let service: SuppliersService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;

  const baseSupplier = {
    id: 'sup-1',
    tenantId: testTenantId,
    name: 'Fresh Farms',
    contactName: 'Sam',
    email: 'sam@freshfarms.com',
    phone: '+1000',
    address: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should reject a duplicate supplier name', async () => {
      prisma.supplier.findFirst.mockResolvedValue(baseSupplier);

      await expect(
        service.create({ name: 'Fresh Farms' } as never, testTenantId, testUserId),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a tenant-scoped supplier', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);
      prisma.supplier.create.mockResolvedValue(baseSupplier);

      const result = await service.create(
        { name: 'Fresh Farms', email: 'sam@freshfarms.com', isActive: true } as never,
        testTenantId,
        testUserId,
      );

      expect(prisma.supplier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: testTenantId,
            name: 'Fresh Farms',
            isActive: true,
          }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUPPLIER_CREATED' }),
      );
      expect(result).toBe(baseSupplier);
    });
  });

  describe('update', () => {
    it('should throw NotFoundException for a missing supplier', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.update('missing', { name: 'X' } as never, testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject renaming to another supplier name', async () => {
      prisma.supplier.findFirst
        .mockResolvedValueOnce(baseSupplier)
        .mockResolvedValueOnce({ id: 'sup-2' });

      await expect(
        service.update('sup-1', { name: 'Other Farms' } as never, testTenantId, testUserId),
      ).rejects.toThrow(ConflictException);
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });

    it('should update only the provided fields', async () => {
      prisma.supplier.findFirst.mockResolvedValue(baseSupplier);
      prisma.supplier.update.mockResolvedValue({ ...baseSupplier, phone: '+2000' });

      const result = await service.update(
        'sup-1',
        { phone: '+2000' } as never,
        testTenantId,
        testUserId,
      );

      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: 'sup-1' },
        data: { phone: '+2000' },
      });
      expect(result.phone).toBe('+2000');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUPPLIER_UPDATED' }),
      );
    });
  });

  describe('findAll', () => {
    it('applies the search filter and returns pagination meta', async () => {
      prisma.supplier.findMany.mockResolvedValue([baseSupplier]);
      prisma.supplier.count.mockResolvedValue(1);

      const result = await service.findAll({
        tenantId: testTenantId,
        search: 'Fresh',
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: testTenantId,
            deletedAt: null,
            OR: expect.any(Array),
          }),
        }),
      );
    });

    it('filters by isActive when provided', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      prisma.supplier.count.mockResolvedValue(0);

      await service.findAll({ tenantId: testTenantId, isActive: false });

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: false }),
        }),
      );
    });
  });

  describe('softDelete and restore', () => {
    it('should soft-delete and deactivate', async () => {
      prisma.supplier.findFirst.mockResolvedValue(baseSupplier);

      await service.softDelete('sup-1', testTenantId, testUserId);

      expect(prisma.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sup-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date), isActive: false }),
        }),
      );
    });

    it('should restore only a soft-deleted supplier', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(service.restore('sup-1', testTenantId, testUserId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
