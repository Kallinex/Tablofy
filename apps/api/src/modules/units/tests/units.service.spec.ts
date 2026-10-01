import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { UnitsService } from '../units.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateUnitDto, UpdateUnitDto } from '../dto/unit.dto';

const userId = 'user-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('UnitsService', () => {
  let service: UnitsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnitsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<UnitsService>(UnitsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
  });

  const unit = {
    id: 'u-1',
    tenantId: testTenantId,
    name: 'Kilogram',
    abbreviation: 'kg',
    type: 'WEIGHT',
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('rejects a duplicate name', async () => {
      prisma.unit.findFirst.mockResolvedValue(unit);
      await expect(
        service.create(
          asDto<CreateUnitDto>({ name: 'Kilogram', abbreviation: 'kg', type: 'WEIGHT' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.unit.findFirst.mock.calls[0][0].where).toMatchObject({
        tenantId: testTenantId,
        name: 'Kilogram',
      });
    });

    it('defaults isActive to true and logs', async () => {
      prisma.unit.findFirst.mockResolvedValue(null);
      prisma.unit.create.mockResolvedValue(unit);

      await service.create(
        asDto<CreateUnitDto>({ name: 'Kilogram', abbreviation: 'kg', type: 'WEIGHT' }),
        testTenantId,
        userId,
      );

      expect(prisma.unit.create.mock.calls[0][0].data.isActive).toBe(true);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UNIT_CREATED' }));
    });
  });

  describe('findAll', () => {
    it('scopes by tenant with a type filter', async () => {
      prisma.unit.findMany.mockResolvedValue([unit]);
      prisma.unit.count.mockResolvedValue(1);

      await service.findAll({ tenantId: testTenantId, type: 'WEIGHT', isActive: true });

      expect(prisma.unit.findMany.mock.calls[0][0].where).toMatchObject({
        tenantId: testTenantId,
        type: 'WEIGHT',
        isActive: true,
        deletedAt: null,
      });
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.unit.findFirst.mockResolvedValue(null);
      await expect(service.findOne('u-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects a duplicated name', async () => {
      prisma.unit.findFirst.mockResolvedValueOnce(unit).mockResolvedValueOnce({ id: 'u-2' });
      await expect(
        service.update('u-1', asDto<UpdateUnitDto>({ name: 'Gram' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('writes only provided fields and logs old/new', async () => {
      prisma.unit.findFirst.mockResolvedValue(unit);
      prisma.unit.update.mockResolvedValue({ ...unit, abbreviation: 'kgs' });

      await service.update(
        'u-1',
        asDto<UpdateUnitDto>({ abbreviation: 'kgs' }),
        testTenantId,
        userId,
      );

      expect(prisma.unit.update.mock.calls[0][0].data).toEqual({ abbreviation: 'kgs' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UNIT_UPDATED',
          oldValues: { name: 'Kilogram', abbreviation: 'kg', type: 'WEIGHT' },
          newValues: { name: 'Kilogram', abbreviation: 'kgs', type: 'WEIGHT' },
        }),
      );
    });
  });

  describe('softDelete / restore', () => {
    it('soft-deletes and deactivates', async () => {
      prisma.unit.findFirst.mockResolvedValue(unit);
      prisma.unit.update.mockResolvedValue({});

      await service.softDelete('u-1', testTenantId, userId);

      const data = prisma.unit.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
    });

    it('restores a deleted unit', async () => {
      prisma.unit.findFirst.mockResolvedValue({ ...unit, deletedAt: new Date() });
      prisma.unit.update.mockResolvedValue(unit);

      await service.restore('u-1', testTenantId, userId);

      expect(prisma.unit.update.mock.calls[0][0].data).toEqual({ deletedAt: null, isActive: true });
    });

    it('throws restoring a non-deleted unit', async () => {
      prisma.unit.findFirst.mockResolvedValue(null);
      await expect(service.restore('u-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
