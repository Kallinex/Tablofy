import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ServiceChargesService } from '../service-charges.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateServiceChargeDto, UpdateServiceChargeDto } from '../dto/service-charge.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('ServiceChargesService', () => {
  let service: ServiceChargesService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceChargesService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<ServiceChargesService>(ServiceChargesService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
  });

  const charge = {
    id: 'sc-1',
    tenantId: testTenantId,
    restaurantId,
    name: 'Service',
    rate: 10,
    isPercentage: true,
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the restaurant in the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateServiceChargeDto>({ name: 'Service', rate: 10 }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a duplicate name', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.serviceCharge.findFirst.mockResolvedValue(charge);
      await expect(
        service.create(
          asDto<CreateServiceChargeDto>({ name: 'Service', rate: 10 }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('applies defaults and logs', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.serviceCharge.findFirst.mockResolvedValue(null);
      prisma.serviceCharge.create.mockResolvedValue(charge);

      await service.create(
        asDto<CreateServiceChargeDto>({ name: 'Service', rate: 10 }),
        restaurantId,
        testTenantId,
        userId,
      );

      const data = prisma.serviceCharge.create.mock.calls[0][0].data;
      expect(data.isPercentage).toBe(true);
      expect(data.isActive).toBe(true);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SERVICE_CHARGE_CREATED' }),
      );
    });
  });

  describe('findAll', () => {
    it('requires the restaurant and scopes by tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.serviceCharge.findMany.mockResolvedValue([charge]);
      prisma.serviceCharge.count.mockResolvedValue(1);

      await service.findAll({ tenantId: testTenantId, restaurantId, isActive: true });

      expect(prisma.serviceCharge.findMany.mock.calls[0][0].where).toMatchObject({
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
      prisma.serviceCharge.findFirst.mockResolvedValue(null);
      await expect(service.findOne('sc-1', restaurantId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.serviceCharge.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'sc-1',
        restaurantId,
        tenantId: testTenantId,
      });
    });
  });

  describe('update', () => {
    it('rejects a duplicated name', async () => {
      prisma.serviceCharge.findFirst
        .mockResolvedValueOnce(charge)
        .mockResolvedValueOnce({ id: 'sc-2' });
      await expect(
        service.update(
          'sc-1',
          asDto<UpdateServiceChargeDto>({ name: 'Tip' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('writes only provided fields and logs old/new', async () => {
      prisma.serviceCharge.findFirst.mockResolvedValue(charge);
      prisma.serviceCharge.update.mockResolvedValue({ ...charge, rate: 12 });

      await service.update(
        'sc-1',
        asDto<UpdateServiceChargeDto>({ rate: 12 }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.serviceCharge.update.mock.calls[0][0].data).toEqual({ rate: 12 });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SERVICE_CHARGE_UPDATED',
          oldValues: { name: 'Service', rate: 10, isPercentage: true },
          newValues: { name: 'Service', rate: 12, isPercentage: true },
        }),
      );
    });
  });

  describe('softDelete / restore', () => {
    it('soft-deletes and deactivates', async () => {
      prisma.serviceCharge.findFirst.mockResolvedValue(charge);
      prisma.serviceCharge.update.mockResolvedValue({});

      await service.softDelete('sc-1', restaurantId, testTenantId, userId);

      const data = prisma.serviceCharge.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
    });

    it('restores a deleted charge', async () => {
      prisma.serviceCharge.findFirst.mockResolvedValue({ ...charge, deletedAt: new Date() });
      prisma.serviceCharge.update.mockResolvedValue(charge);

      await service.restore('sc-1', restaurantId, testTenantId, userId);

      expect(prisma.serviceCharge.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws restoring a non-deleted charge', async () => {
      prisma.serviceCharge.findFirst.mockResolvedValue(null);
      await expect(
        service.restore('sc-1', restaurantId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
