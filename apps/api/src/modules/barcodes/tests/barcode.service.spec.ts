import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { BarcodeService } from '../barcode.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BarcodeGateway } from '../barcode.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('BarcodeService', () => {
  let service: BarcodeService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  const mockGateway = {
    broadcastBarcodeUpdate: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarcodeService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: BarcodeGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<BarcodeService>(BarcodeService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    eventEmitter = module.get(EventEmitter2) as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    cache.reset();
    eventEmitter.reset();
    jest.clearAllMocks();
  });

  describe('generate', () => {
    const dto = { inventoryItemId: 'item-1', type: 'CODE128', isPrimary: true };

    it('should generate barcode successfully', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', tenantId: testTenantId });
      prisma.barcode.findFirst.mockResolvedValue(null);
      const fakeBarcode = {
        id: 'bar-1',
        ...dto,
        tenantId: testTenantId,
        barcode: 'BAR-XXXX',
        qrCode: 'QR-XXXX',
      };
      prisma.barcode.create.mockResolvedValue(fakeBarcode);

      const result = await service.generate(dto as never, testTenantId, testUserId);

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BARCODE_GENERATED' }),
      );
      expect(mockGateway.broadcastBarcodeUpdate).toHaveBeenCalled();
      expect(cache.deletePattern).toHaveBeenCalled();
    });

    it('should throw NotFoundException for invalid inventory item', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.generate(dto as never, testTenantId, testUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException for duplicate barcode', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', tenantId: testTenantId });
      prisma.barcode.findFirst.mockResolvedValue({ id: 'existing', barcode: 'DUP' });

      await expect(service.generate(dto as never, testTenantId, testUserId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('lookupByBarcode', () => {
    it('should return barcode from cache', async () => {
      const cached = { id: 'bar-1', barcode: 'BAR-123' };
      cache.get.mockResolvedValue(cached);

      const result = await service.lookupByBarcode('BAR-123', testTenantId);

      expect(result).toEqual(cached);
      expect(prisma.barcode.findFirst).not.toHaveBeenCalled();
    });

    it('should look up barcode from database on cache miss', async () => {
      cache.get.mockResolvedValue(null);
      const fakeBarcode = {
        id: 'bar-1',
        barcode: 'BAR-123',
        inventoryItem: { category: {}, unit: {} },
      };
      prisma.barcode.findFirst.mockResolvedValue(fakeBarcode);

      const result = await service.lookupByBarcode('BAR-123', testTenantId);

      expect(result).toBeDefined();
      expect(cache.set).toHaveBeenCalledWith(testTenantId, expect.any(String), fakeBarcode, 300);
    });

    it('should throw NotFoundException when barcode not found', async () => {
      cache.get.mockResolvedValue(null);
      prisma.barcode.findFirst.mockResolvedValue(null);

      await expect(service.lookupByBarcode('NONEXIST', testTenantId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('lookupByQrCode', () => {
    it('should look up QR code', async () => {
      cache.get.mockResolvedValue(null);
      const fakeBarcode = {
        id: 'bar-1',
        qrCode: 'QR-123',
        inventoryItem: { category: {}, unit: {} },
      };
      prisma.barcode.findFirst.mockResolvedValue(fakeBarcode);

      const result = await service.lookupByQrCode('QR-123', testTenantId);

      expect(result).toBeDefined();
    });
  });

  describe('delete', () => {
    it('should delete barcode with audit and broadcast', async () => {
      prisma.barcode.findFirst.mockResolvedValue({
        id: 'bar-1',
        tenantId: testTenantId,
        barcode: 'BAR-123',
        qrCode: 'QR-123',
        inventoryItemId: 'item-1',
      });
      prisma.barcode.delete.mockResolvedValue({});

      await service.delete('bar-1', testTenantId, testUserId);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BARCODE_DELETED' }),
      );
      expect(mockGateway.broadcastBarcodeUpdate).toHaveBeenCalled();
      expect(cache.deletePattern).toHaveBeenCalled();
    });
  });

  describe('setPrimary', () => {
    it('should set barcode as primary', async () => {
      prisma.barcode.findFirst.mockResolvedValue({
        id: 'bar-1',
        tenantId: testTenantId,
        inventoryItemId: 'item-1',
      });
      prisma.barcode.updateMany.mockResolvedValue({ count: 1 });
      prisma.barcode.update.mockResolvedValue({ id: 'bar-1', isPrimary: true });
      prisma.$transaction.mockImplementation(async (ops: unknown[]) => {
        if (Array.isArray(ops)) {
          return Promise.all(ops as Promise<unknown>[]);
        }
        return undefined;
      });
      prisma.barcode.findFirst
        .mockResolvedValueOnce({ id: 'bar-1', tenantId: testTenantId, inventoryItemId: 'item-1' })
        .mockResolvedValueOnce({ id: 'bar-1', isPrimary: true });

      const result = await service.setPrimary('bar-1', testTenantId, testUserId);

      expect(result).toBeDefined();
    });
  });
});
