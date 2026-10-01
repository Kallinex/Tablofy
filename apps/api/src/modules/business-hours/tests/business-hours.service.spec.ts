import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BusinessHoursService } from '../business-hours.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateBusinessHoursDto, UpdateBusinessHoursDto } from '../dto/business-hours.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('BusinessHoursService', () => {
  let service: BusinessHoursService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessHoursService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<BusinessHoursService>(BusinessHoursService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
  });

  const hours = {
    id: 'bh-1',
    tenantId: testTenantId,
    restaurantId,
    dayOfWeek: 1,
    openTime: '09:00',
    closeTime: '17:00',
    isClosed: false,
  };

  describe('setHours', () => {
    it('requires the restaurant in the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(
        service.setHours(
          asDto<CreateBusinessHoursDto>({ dayOfWeek: 1 }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates when no row exists for the day', async () => {
      prisma.businessHours.findUnique.mockResolvedValue(null);
      prisma.businessHours.create.mockResolvedValue(hours);

      await service.setHours(
        asDto<CreateBusinessHoursDto>({ dayOfWeek: 1, openTime: '09:00', closeTime: '17:00' }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.businessHours.findUnique.mock.calls[0][0].where).toEqual({
        restaurantId_dayOfWeek: { restaurantId, dayOfWeek: 1 },
      });
      expect(prisma.businessHours.create.mock.calls[0][0].data.isClosed).toBe(false);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BUSINESS_HOURS_CREATED' }),
      );
    });

    it('updates when a row already exists', async () => {
      prisma.businessHours.findUnique.mockResolvedValue(hours);
      prisma.businessHours.update.mockResolvedValue({ ...hours, closeTime: '20:00' });

      await service.setHours(
        asDto<CreateBusinessHoursDto>({ dayOfWeek: 1, openTime: '09:00', closeTime: '20:00' }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.businessHours.update.mock.calls[0][0].where).toEqual({ id: 'bh-1' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BUSINESS_HOURS_UPDATED' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant and restaurant', async () => {
      prisma.businessHours.findMany.mockResolvedValue([hours]);

      const result = await service.findAll(restaurantId, testTenantId);

      expect(prisma.businessHours.findMany.mock.calls[0][0].where).toEqual({
        restaurantId,
        tenantId: testTenantId,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.businessHours.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bh-1', restaurantId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('writes only provided fields', async () => {
      prisma.businessHours.findFirst.mockResolvedValue(hours);
      prisma.businessHours.update.mockResolvedValue({ ...hours, isClosed: true });

      await service.update(
        'bh-1',
        asDto<UpdateBusinessHoursDto>({ isClosed: true }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.businessHours.update.mock.calls[0][0].data).toEqual({ isClosed: true });
    });
  });

  describe('remove', () => {
    it('throws when not found', async () => {
      prisma.businessHours.findFirst.mockResolvedValue(null);
      await expect(
        service.remove('bh-1', restaurantId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes and logs', async () => {
      prisma.businessHours.findFirst.mockResolvedValue(hours);
      prisma.businessHours.delete.mockResolvedValue(hours);

      await service.remove('bh-1', restaurantId, testTenantId, userId);

      expect(prisma.businessHours.delete).toHaveBeenCalledWith({ where: { id: 'bh-1' } });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BUSINESS_HOURS_DELETED' }),
      );
    });
  });
});
