import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { Prisma, UserRole } from '@prisma/client';
import { InventoryProcessor } from '../inventory.processor';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../queues/queue.service';

const queueServiceMock = {
  registerWorker: jest.fn(),
  addJob: jest.fn().mockResolvedValue({ id: 'mock-job' }),
};

const prismaMock = {
  inventoryItem: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  inventoryBatch: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
  notification: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  expirationAlert: {
    findMany: jest.fn(),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn(),
  },
  wasteEntry: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  stockMovement: {
    count: jest.fn(),
  },
  stockAdjustment: {
    count: jest.fn(),
  },
  report: {
    create: jest.fn().mockResolvedValue({ id: 'report-1' }),
  },
};

function makeJob(data: Record<string, unknown>): Job {
  return { data } as Job;
}

describe('InventoryProcessor', () => {
  let processor: InventoryProcessor;
  let registeredWorkers: Array<[string, unknown]>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryProcessor,
        { provide: QueueService, useValue: queueServiceMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    processor = module.get(InventoryProcessor);
    registeredWorkers = queueServiceMock.registerWorker.mock.calls
      .map((call) => [call[0] as string, call[1]])
      .slice();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers a worker for every inventory queue', () => {
    expect(registeredWorkers).toHaveLength(4);
    for (const [name] of registeredWorkers) {
      expect([
        'inventory-sync',
        'low-stock-alerts',
        'expiration-checks',
        'waste-reports',
      ]).toContain(name);
    }
  });

  describe('handleLowStockAlerts', () => {
    it('creates low stock notifications for items below reorder level', async () => {
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          tenantId: 'tenant-1',
          name: 'Flour',
          sku: 'FL-1',
          currentQuantity: new Prisma.Decimal(5),
          minStock: null,
          reorderLevel: new Prisma.Decimal(10),
        },
      ]);
      prismaMock.user.findMany.mockResolvedValue([{ id: 'user-1', tenantId: 'tenant-1' }]);
      prismaMock.notification.createMany.mockResolvedValue({ count: 1 });

      const result = await (processor as unknown as Record<string, (job: Job) => Promise<never>>)[
        'handleLowStockAlerts'
      ](makeJob({ tenantId: 'tenant-1', payload: {} }));

      expect(result).toEqual({ processed: true, tenantId: 'tenant-1', lowStockCount: 1 });
      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          role: { in: [UserRole.OWNER, UserRole.MANAGER] },
          tenantId: { in: ['tenant-1'] },
        },
        select: { id: true, tenantId: true },
      });
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [
          {
            tenantId: 'tenant-1',
            userId: 'user-1',
            title: 'Low stock alert',
            message: expect.stringContaining('Flour'),
            type: 'LOW_STOCK',
          },
        ],
      });
      expect(queueServiceMock.addJob).toHaveBeenCalledWith('notification', 'low-stock-alert', {
        tenantId: 'tenant-1',
        payload: { items: ['item-1'] },
      });
    });

    it('returns zero when no items are low on stock', async () => {
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          tenantId: 'tenant-1',
          name: 'Flour',
          sku: 'FL-1',
          currentQuantity: new Prisma.Decimal(20),
          minStock: null,
          reorderLevel: new Prisma.Decimal(10),
        },
      ]);

      const result = await (processor as unknown as Record<string, (job: Job) => Promise<never>>)[
        'handleLowStockAlerts'
      ](makeJob({ tenantId: 'tenant-1', payload: {} }));

      expect(result).toEqual({ processed: true, tenantId: 'tenant-1', lowStockCount: 0 });
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
      expect(queueServiceMock.addJob).not.toHaveBeenCalled();
    });
  });

  describe('handleExpirationChecks', () => {
    const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    it('creates expiration alerts for batches expiring within the window', async () => {
      prismaMock.inventoryBatch.findMany.mockResolvedValue([
        {
          id: 'batch-1',
          inventoryItemId: 'item-1',
          tenantId: 'tenant-1',
          batchNumber: 'B1',
          expiryDate: daysFromNow(3),
          inventoryItem: { tenantId: 'tenant-1', name: 'Milk', sku: 'MK-1' },
        },
      ]);
      prismaMock.expirationAlert.findMany.mockResolvedValue([]);

      const result = await (processor as unknown as Record<string, (job: Job) => Promise<never>>)[
        'handleExpirationChecks'
      ](makeJob({ tenantId: 'tenant-1', payload: { days: 30 } }));

      expect(result).toEqual({ processed: true, tenantId: 'tenant-1', expiringBatchCount: 1 });
      expect(prismaMock.expirationAlert.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            inventoryItemId: 'item-1',
            batchNumber: 'B1',
            alertType: 'CRITICAL',
          }),
        ],
      });
      expect(queueServiceMock.addJob).toHaveBeenCalledWith('notification', 'expiration-alert', {
        tenantId: 'tenant-1',
        payload: { alertCount: 1, inventoryItemIds: ['item-1'] },
      });
    });

    it('skips batches that already have an unresolved alert', async () => {
      prismaMock.inventoryBatch.findMany.mockResolvedValue([
        {
          id: 'batch-1',
          inventoryItemId: 'item-1',
          tenantId: 'tenant-1',
          batchNumber: 'B1',
          expiryDate: daysFromNow(3),
          inventoryItem: { tenantId: 'tenant-1', name: 'Milk', sku: 'MK-1' },
        },
      ]);
      prismaMock.expirationAlert.findMany.mockResolvedValue([
        { inventoryItemId: 'item-1', batchNumber: 'B1' },
      ]);

      const result = await (processor as unknown as Record<string, (job: Job) => Promise<never>>)[
        'handleExpirationChecks'
      ](makeJob({ tenantId: 'tenant-1', payload: { days: 30 } }));

      expect(result).toEqual({ processed: true, tenantId: 'tenant-1', expiringBatchCount: 0 });
      expect(prismaMock.expirationAlert.createMany).not.toHaveBeenCalled();
    });
  });

  describe('handleWasteReports', () => {
    it('aggregates waste entries and persists a report', async () => {
      prismaMock.wasteEntry.findMany.mockResolvedValue([
        {
          quantity: new Prisma.Decimal(2),
          totalCost: new Prisma.Decimal(10),
          type: 'SPOILAGE',
        },
        {
          quantity: new Prisma.Decimal(3),
          totalCost: null,
          type: 'KITCHEN_WASTE',
        },
      ]);

      const result = await (processor as unknown as Record<string, (job: Job) => Promise<never>>)[
        'handleWasteReports'
      ](makeJob({ tenantId: 'tenant-1', payload: { period: 'month' } }));

      expect(result).toMatchObject({
        processed: true,
        tenantId: 'tenant-1',
        period: 'month',
        totalEntries: 2,
      });
      expect(prismaMock.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          type: 'INVENTORY',
          status: 'GENERATED',
          generatedAt: expect.any(Date),
          result: {
            period: 'month',
            totalEntries: 2,
            totalQuantity: 5,
            totalCost: 10,
            byType: {
              SPOILAGE: { entries: 1, quantity: '2' },
              KITCHEN_WASTE: { entries: 1, quantity: '3' },
            },
          },
        }),
      });
    });

    it('refuses to run without a tenantId', async () => {
      const result = await (processor as unknown as Record<string, (job: Job) => Promise<never>>)[
        'handleWasteReports'
      ](makeJob({ payload: { period: 'day' } }));

      expect(result).toEqual({
        processed: false,
        reason: 'tenantId is required for waste reports',
      });
      expect(prismaMock.report.create).not.toHaveBeenCalled();
    });
  });

  describe('handleInventorySync', () => {
    it('summarizes counts and reconciles batch quantities', async () => {
      prismaMock.inventoryItem.count.mockResolvedValue(1);
      prismaMock.inventoryBatch.count.mockResolvedValue(2);
      prismaMock.stockMovement.count.mockResolvedValue(3);
      prismaMock.stockAdjustment.count.mockResolvedValue(4);
      prismaMock.wasteEntry.count.mockResolvedValue(5);
      prismaMock.expirationAlert.count.mockResolvedValue(6);
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          name: 'Flour',
          currentQuantity: new Prisma.Decimal(10),
          batches: [{ quantity: new Prisma.Decimal(10) }],
        },
        {
          id: 'item-2',
          name: 'Oil',
          currentQuantity: new Prisma.Decimal(10),
          batches: [{ quantity: new Prisma.Decimal(8) }],
        },
      ]);

      const result = await (processor as unknown as Record<string, (job: Job) => Promise<never>>)[
        'handleInventorySync'
      ](makeJob({ tenantId: 'tenant-1', payload: {} }));

      expect(result).toEqual(
        expect.objectContaining({
          processed: true,
          tenantId: 'tenant-1',
          items: 1,
          activeBatches: 2,
          stockMovements: 3,
          stockAdjustments: 4,
          wasteEntries: 5,
          expirationAlerts: 6,
          reconciledItems: 1,
          quantityMismatches: 1,
        }),
      );
    });
  });
});
