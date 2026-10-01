import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BusinessExceptionsService } from '../business-exceptions.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import {
  CreateBusinessExceptionDto,
  UpdateBusinessExceptionDto,
} from '../dto/business-exceptions.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('BusinessExceptionsService', () => {
  let service: BusinessExceptionsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessExceptionsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<BusinessExceptionsService>(BusinessExceptionsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
  });

  const exception = {
    id: 'be-1',
    tenantId: testTenantId,
    restaurantId,
    date: new Date('2026-01-01'),
    isClosed: true,
    reason: 'Holiday',
  };

  describe('create', () => {
    it('requires the restaurant in the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateBusinessExceptionDto>({ date: '2026-01-01' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('defaults isClosed to true and logs', async () => {
      prisma.businessException.create.mockResolvedValue(exception);

      await service.create(
        asDto<CreateBusinessExceptionDto>({ date: '2026-01-01', reason: 'Holiday' }),
        restaurantId,
        testTenantId,
        userId,
      );

      const data = prisma.businessException.create.mock.calls[0][0].data;
      expect(data.isClosed).toBe(true);
      expect(data.date).toEqual(new Date('2026-01-01'));
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BUSINESS_EXCEPTION_CREATED' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant and restaurant', async () => {
      prisma.businessException.findMany.mockResolvedValue([exception]);

      await service.findAll(restaurantId, testTenantId);

      expect(prisma.businessException.findMany.mock.calls[0][0].where).toEqual({
        restaurantId,
        tenantId: testTenantId,
      });
    });

    it('applies a date range when provided', async () => {
      prisma.businessException.findMany.mockResolvedValue([]);

      await service.findAll(restaurantId, testTenantId, { from: '2026-01-01', to: '2026-01-31' });

      const where = prisma.businessException.findMany.mock.calls[0][0].where;
      expect(where.date).toEqual({ gte: new Date('2026-01-01'), lte: new Date('2026-01-31') });
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.businessException.findFirst.mockResolvedValue(null);
      await expect(service.findOne('be-1', restaurantId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('writes only provided fields', async () => {
      prisma.businessException.findFirst.mockResolvedValue(exception);
      prisma.businessException.update.mockResolvedValue({ ...exception, reason: 'Eid' });

      await service.update(
        'be-1',
        asDto<UpdateBusinessExceptionDto>({ reason: 'Eid' }),
        restaurantId,
        testTenantId,
        userId,
      );

      expect(prisma.businessException.update.mock.calls[0][0].data).toEqual({ reason: 'Eid' });
    });
  });

  describe('remove', () => {
    it('throws when not found', async () => {
      prisma.businessException.findFirst.mockResolvedValue(null);
      await expect(
        service.remove('be-1', restaurantId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes and logs', async () => {
      prisma.businessException.findFirst.mockResolvedValue(exception);
      prisma.businessException.delete.mockResolvedValue(exception);

      await service.remove('be-1', restaurantId, testTenantId, userId);

      expect(prisma.businessException.delete).toHaveBeenCalledWith({ where: { id: 'be-1' } });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BUSINESS_EXCEPTION_DELETED' }),
      );
    });
  });
});
