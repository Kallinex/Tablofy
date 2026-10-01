import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { DayOfWeek } from '@prisma/client';
import { ProductAvailabilityService } from '../product-availability.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateProductAvailabilityDto } from '../dto/create-product-availability.dto';
import { UpdateProductAvailabilityDto } from '../dto/update-product-availability.dto';

const userId = 'user-1';
const productId = 'prod-1';
const availabilityId = 'av-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('ProductAvailabilityService', () => {
  let service: ProductAvailabilityService;
  let prisma: MockPrisma;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductAvailabilityService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<ProductAvailabilityService>(ProductAvailabilityService);
    prisma = module.get(PrismaService) as MockPrisma;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    events.reset();
  });

  const availability = {
    id: availabilityId,
    productId,
    tenantId: testTenantId,
    dayOfWeek: DayOfWeek.MONDAY,
    startTime: '09:00',
    endTime: '17:00',
  };

  describe('create', () => {
    const dto = { dayOfWeek: DayOfWeek.MONDAY, startTime: '09:00', endTime: '17:00' };

    it('throws when the product is missing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(
        service.create(asDto<CreateProductAvailabilityDto>(dto), productId, testTenantId, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws on a duplicate slot', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productAvailability.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create(asDto<CreateProductAvailabilityDto>(dto), productId, testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates and emits', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productAvailability.create.mockResolvedValue(availability);

      await service.create(
        asDto<CreateProductAvailabilityDto>(dto),
        productId,
        testTenantId,
        userId,
      );

      expect(events.emit).toHaveBeenCalledWith(
        'productAvailability.created',
        expect.objectContaining({ availabilityId }),
      );
    });
  });

  describe('findAll', () => {
    it('throws when the product is missing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.findAll(productId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns scoped rows ordered by day/time', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.productAvailability.findMany.mockResolvedValue([availability]);

      const result = await service.findAll(productId, testTenantId);

      expect(prisma.productAvailability.findMany.mock.calls[0][0].where).toEqual({
        productId,
        tenantId: testTenantId,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('throws when missing', async () => {
      prisma.productAvailability.findFirst.mockResolvedValue(null);
      await expect(service.findOne(availabilityId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('throws on a conflicting slot', async () => {
      prisma.productAvailability.findFirst
        .mockResolvedValueOnce(availability)
        .mockResolvedValueOnce({ id: 'other' });
      await expect(
        service.update(
          availabilityId,
          asDto<UpdateProductAvailabilityDto>({ startTime: '10:00' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates and emits', async () => {
      prisma.productAvailability.findFirst.mockResolvedValueOnce(availability);
      prisma.productAvailability.update.mockResolvedValue({ ...availability, endTime: '18:00' });

      await service.update(
        availabilityId,
        asDto<UpdateProductAvailabilityDto>({ endTime: '18:00' }),
        testTenantId,
        userId,
      );

      expect(prisma.productAvailability.update.mock.calls[0][0].data.endTime).toBe('18:00');
      expect(events.emit).toHaveBeenCalledWith('productAvailability.updated', expect.anything());
    });
  });

  describe('remove', () => {
    it('throws when missing', async () => {
      prisma.productAvailability.findFirst.mockResolvedValue(null);
      await expect(service.remove(availabilityId, testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes and emits', async () => {
      prisma.productAvailability.findFirst.mockResolvedValue(availability);

      await service.remove(availabilityId, testTenantId, userId);

      expect(prisma.productAvailability.delete).toHaveBeenCalledWith({
        where: { id: availabilityId },
      });
      expect(events.emit).toHaveBeenCalledWith('productAvailability.deleted', expect.anything());
    });
  });
});
