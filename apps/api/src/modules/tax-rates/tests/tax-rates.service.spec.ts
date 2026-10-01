import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { TaxRatesService } from '../tax-rates.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateTaxRateDto, UpdateTaxRateDto } from '../dto/tax-rate.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('TaxRatesService', () => {
  let service: TaxRatesService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxRatesService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<TaxRatesService>(TaxRatesService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
  });

  const rate = {
    id: 't-1',
    tenantId: testTenantId,
    restaurantId,
    name: 'VAT',
    rate: 14,
    isCompound: false,
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the restaurant in the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateTaxRateDto>({ name: 'VAT', rate: 14 }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a duplicate name', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.taxRate.findFirst.mockResolvedValue(rate);
      await expect(
        service.create(
          asDto<CreateTaxRateDto>({ name: 'VAT', rate: 14 }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('applies defaults and logs', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.taxRate.findFirst.mockResolvedValue(null);
      prisma.taxRate.create.mockResolvedValue(rate);

      await service.create(
        asDto<CreateTaxRateDto>({ name: 'VAT', rate: 14 }),
        restaurantId,
        testTenantId,
        userId,
      );

      const data = prisma.taxRate.create.mock.calls[0][0].data;
      expect(data.isCompound).toBe(false);
      expect(data.isActive).toBe(true);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TAX_RATE_CREATED' }),
      );
    });
  });

  describe('findAll', () => {
    it('requires the restaurant and scopes by tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.taxRate.findMany.mockResolvedValue([rate]);
      prisma.taxRate.count.mockResolvedValue(1);

      await service.findAll({ tenantId: testTenantId, restaurantId, isActive: true });

      expect(prisma.taxRate.findMany.mock.calls[0][0].where).toMatchObject({
        tenantId: testTenantId,
        restaurantId,
        isActive: true,
      });
    });

    it('throws when the restaurant is missing', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(
        service.findAll({ tenantId: testTenantId, restaurantId }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('scopes by tenant and restaurant', async () => {
      prisma.taxRate.findFirst.mockResolvedValue(null);
      await expect(service.findOne('t-1', restaurantId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.taxRate.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 't-1',
        restaurantId,
        tenantId: testTenantId,
      });
    });
  });

  describe('update', () => {
    it('rejects a duplicated name', async () => {
      prisma.taxRate.findFirst.mockResolvedValueOnce(rate).mockResolvedValueOnce({ id: 't-2' });
      await expect(
        service.update(
          't-1',
          asDto<UpdateTaxRateDto>({ name: 'GST' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('writes only provided fields and logs old/new', async () => {
      prisma.taxRate.findFirst.mockResolvedValue(rate);
      prisma.taxRate.update.mockResolvedValue({ ...rate, rate: 15 });

      await service.update(
        't-1',
        asDto<UpdateTaxRateDto>({ rate: 15 }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.taxRate.update.mock.calls[0][0].data).toEqual({ rate: 15 });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TAX_RATE_UPDATED',
          oldValues: { name: 'VAT', rate: 14, isCompound: false },
          newValues: { name: 'VAT', rate: 15, isCompound: false },
        }),
      );
    });
  });

  describe('softDelete / restore', () => {
    it('soft-deletes and deactivates', async () => {
      prisma.taxRate.findFirst.mockResolvedValue(rate);
      prisma.taxRate.update.mockResolvedValue({});

      await service.softDelete('t-1', restaurantId, testTenantId, userId);

      const data = prisma.taxRate.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
    });

    it('restores a deleted rate', async () => {
      prisma.taxRate.findFirst.mockResolvedValue({ ...rate, deletedAt: new Date() });
      prisma.taxRate.update.mockResolvedValue(rate);

      await service.restore('t-1', restaurantId, testTenantId, userId);

      expect(prisma.taxRate.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws restoring a non-deleted rate', async () => {
      prisma.taxRate.findFirst.mockResolvedValue(null);
      await expect(
        service.restore('t-1', restaurantId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
