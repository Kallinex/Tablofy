import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';
import { NutritionService } from '../nutrition.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateNutritionalInfoDto } from '../dto/create-nutritional-info.dto';

const userId = 'user-1';
const productId = 'p-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('NutritionService', () => {
  let service: NutritionService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NutritionService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<NutritionService>(NutritionService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
  });

  const info = {
    id: 'n-1',
    tenantId: testTenantId,
    productId,
    calories: 250,
    protein: 10,
    isActive: true,
    deletedAt: null,
  };

  describe('upsert', () => {
    it('requires the product to belong to the tenant', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(
        service.upsert(
          asDto<CreateNutritionalInfoDto>({ calories: 250 }),
          productId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.findFirst.mock.calls[0][0].where).toMatchObject({
        id: productId,
        tenantId: testTenantId,
      });
    });

    it('creates when no record exists', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.nutritionalInfo.findUnique.mockResolvedValue(null);
      prisma.nutritionalInfo.create.mockResolvedValue(info);

      await service.upsert(
        asDto<CreateNutritionalInfoDto>({ calories: 250 }),
        productId,
        testTenantId,
        userId,
      );

      expect(prisma.nutritionalInfo.create.mock.calls[0][0].data).toMatchObject({
        productId,
        tenantId: testTenantId,
        calories: 250,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'NUTRITIONAL_INFO_CREATED' }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'nutritionalInfo.created',
        expect.objectContaining({ productId }),
      );
    });

    it('updates an existing active record', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.nutritionalInfo.findUnique.mockResolvedValue(info);
      prisma.nutritionalInfo.update.mockResolvedValue({ ...info, calories: 300 });

      await service.upsert(
        asDto<CreateNutritionalInfoDto>({ calories: 300 }),
        productId,
        testTenantId,
        userId,
      );

      expect(prisma.nutritionalInfo.update.mock.calls[0][0].data).toEqual({ calories: 300 });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'NUTRITIONAL_INFO_UPDATED' }),
      );
    });

    it('restores a soft-deleted record', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: productId });
      prisma.nutritionalInfo.findUnique.mockResolvedValue({ ...info, deletedAt: new Date() });
      prisma.nutritionalInfo.update.mockResolvedValue(info);

      await service.upsert(
        asDto<CreateNutritionalInfoDto>({ calories: 250 }),
        productId,
        testTenantId,
        userId,
      );

      const data = prisma.nutritionalInfo.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeNull();
      expect(data.isActive).toBe(true);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'NUTRITIONAL_INFO_RESTORED' }),
      );
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.nutritionalInfo.findFirst.mockResolvedValue(null);
      await expect(service.findOne(productId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('scopes by tenant and product', async () => {
      prisma.nutritionalInfo.findFirst.mockResolvedValue(info);
      const result = await service.findOne(productId, testTenantId);
      expect(prisma.nutritionalInfo.findFirst.mock.calls[0][0].where).toEqual({
        productId,
        tenantId: testTenantId,
        deletedAt: null,
      });
      expect(result).toBe(info);
    });
  });

  describe('softDelete', () => {
    it('throws when there is no active record', async () => {
      prisma.nutritionalInfo.findFirst.mockResolvedValue(null);
      await expect(service.softDelete(productId, testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('soft-deletes and emits', async () => {
      prisma.nutritionalInfo.findFirst.mockResolvedValue(info);
      prisma.nutritionalInfo.update.mockResolvedValue({});

      await service.softDelete(productId, testTenantId, userId);

      const data = prisma.nutritionalInfo.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
      expect(events.emit).toHaveBeenCalledWith(
        'nutritionalInfo.deleted',
        expect.objectContaining({ productId }),
      );
    });
  });
});
