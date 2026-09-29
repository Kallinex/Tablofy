import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StockMovementType, ConsumptionPeriod, Prisma } from '@prisma/client';
import { RecipesService } from '../recipes.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { RecipesGateway } from '../recipes.gateway';

const original = {
  id: 'cr-1',
  inventoryItemId: 'inv-1',
  tenantId: 'tenant-1',
  quantity: new Prisma.Decimal(100),
  unitCost: new Prisma.Decimal(6),
  totalCost: new Prisma.Decimal(600),
  period: ConsumptionPeriod.DAILY,
};

type TxReversal = {
  tx: {
    $queryRaw: jest.Mock;
    consumptionRecord: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
  };
  created: Array<Record<string, unknown>>;
};

function makeReversalTx(
  ctx: {
    originals?: Array<typeof original>;
    existingReversals?: Record<string, Array<{ quantity: Prisma.Decimal }>>;
    existingKeys?: string[];
  } = {},
): TxReversal {
  const created: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    consumptionRecord: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { reversalKey: string } }) => {
        if (ctx.existingKeys?.includes(where.reversalKey)) {
          return Promise.resolve({ id: 'existing' });
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (where.source === 'ORDER') {
          return Promise.resolve(ctx.originals ?? []);
        }
        if (typeof where.reversedFromId === 'string') {
          return Promise.resolve(ctx.existingReversals?.[where.reversedFromId as string] ?? []);
        }
        return Promise.resolve([]);
      }),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: `rev-${created.length}` });
      }),
    },
  };
  return { tx, created };
}

const movements = [
  {
    id: 'sm-1',
    inventoryItemId: 'inv-1',
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    type: StockMovementType.CONSUMPTION,
    quantity: -100,
    unitCost: new Prisma.Decimal(6),
    totalCost: new Prisma.Decimal(-600),
    referenceType: 'ORDER',
    referenceId: 'order-1',
    inventoryItem: { id: 'inv-1', name: 'Flour', currentQuantity: 0 },
  },
];

describe('RecipesService consumption reversal (F-002 MODEL C)', () => {
  let service: RecipesService;
  let prisma: {
    order: { findFirst: jest.Mock };
    stockMovement: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    inventoryItem: { update: jest.Mock };
    consumptionRecord: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const auditLogsMock = { log: jest.fn().mockResolvedValue(undefined) };
  const cacheMock = {
    delete: jest.fn().mockResolvedValue(undefined),
    deletePattern: jest.fn().mockResolvedValue(undefined),
  };
  const queueServiceMock = { addJob: jest.fn() };
  const eventEmitterMock = { emit: jest.fn() };
  const gatewayMock = { broadcastInventoryUpdate: jest.fn() };

  beforeEach(async () => {
    prisma = {
      order: { findFirst: jest.fn() },
      stockMovement: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      inventoryItem: { update: jest.fn() },
      consumptionRecord: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogsMock },
        { provide: CacheService, useValue: cacheMock },
        { provide: QueueService, useValue: queueServiceMock },
        { provide: EventEmitter2, useValue: eventEmitterMock },
        { provide: RecipesGateway, useValue: gatewayMock },
      ],
    }).compile();

    service = module.get<RecipesService>(RecipesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('reverseConsumptionForRefund', () => {
    function setupRefund(
      ctx: {
        total?: number;
        originals?: Array<typeof original>;
        existingReversals?: Record<string, Array<{ quantity: Prisma.Decimal }>>;
      } = {},
    ) {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1', total: ctx.total ?? 100 });
      const reversal = makeReversalTx({
        originals: ctx.originals ?? [original],
        existingReversals: ctx.existingReversals,
      });
      prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) =>
        cb(reversal.tx),
      );
      return reversal;
    }

    it('reverses the full remaining consumption for a full refund (ratio 1), linked to the original', async () => {
      const { created } = setupRefund();

      await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 100,
        amountRefunded: 100,
      });

      expect(created).toHaveLength(1);
      expect(Number(created[0].quantity)).toBe(-100);
      expect(Number(created[0].totalCost)).toBe(-600);
      expect(created[0].source).toBe('REVERSAL');
      expect(created[0].reversedFromId).toBe('cr-1');
      expect(created[0].referenceId).toBe('order-1');
      expect(created[0].reversalKey).toBe('REFUND:payment-1:100:cr-1');
    });

    it('reverses a proportional share for a partial refund (25 of 100)', async () => {
      const { created } = setupRefund();

      await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 25,
        amountRefunded: 25,
      });

      expect(Number(created[0].quantity)).toBe(-25);
      expect(Number(created[0].totalCost)).toBe(-150);
    });

    it('accumulates proportional reversals across multiple partial refunds to net zero', async () => {
      const first = setupRefund();
      await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 25,
        amountRefunded: 25,
      });
      expect(first.created).toHaveLength(1);
      expect(Number(first.created[0].quantity)).toBe(-25);

      const second = setupRefund({
        existingReversals: { 'cr-1': [{ quantity: new Prisma.Decimal(-25) }] },
      });
      await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 25,
        amountRefunded: 50,
      });

      expect(second.created).toHaveLength(1);
      expect(Number(second.created[0].quantity)).toBe(-25);
      const total = Number(first.created[0].quantity) + Number(second.created[0].quantity);
      expect(total).toBe(-50);
    });

    it('does not create a second reversal for a retried identical refund event (idempotent)', async () => {
      const first = setupRefund();
      await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 25,
        amountRefunded: 25,
      });

      const retry = setupRefund();
      retry.tx.consumptionRecord.findUnique.mockResolvedValue({ id: 'existing' });
      const result = await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 25,
        amountRefunded: 25,
      });

      expect(first.created).toHaveLength(1);
      expect(retry.created).toHaveLength(0);
      expect(result).toEqual({ created: 0, skipped: 1 });
    });

    it('caps reversals so net consumption never goes below zero', async () => {
      const reversal = setupRefund({
        total: 100,
        existingReversals: { 'cr-1': [{ quantity: new Prisma.Decimal(-90) }] },
      });
      prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) =>
        cb(reversal.tx),
      );

      await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 100,
        amountRefunded: 100,
      });

      expect(Number(reversal.created[0].quantity)).toBe(-10);
      expect(reversal.created).toHaveLength(1);
    });

    it('keeps the original record intact and only adds a linked compensating record', async () => {
      const { created } = setupRefund();
      await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 50,
        amountRefunded: 50,
      });

      expect(created).toHaveLength(1);
      expect(prisma.consumptionRecord.create).not.toHaveBeenCalled();
      expect(created[0].reversedFromId).toBe('cr-1');
    });

    it('isolates reversals between tenants with the same order id', async () => {
      const tenantA = setupRefund();
      await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 50,
        amountRefunded: 50,
      });

      const tenantB = setupRefund({ originals: [{ ...original, id: 'cr-2' }] });
      await service.reverseConsumptionForRefund({
        tenantId: 'tenant-other',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 50,
        amountRefunded: 50,
      });

      expect(tenantA.created[0].reversedFromId).toBe('cr-1');
      expect(tenantB.created[0].reversedFromId).toBe('cr-2');
    });

    it('uses exact Decimal rounding (4dp) instead of float arithmetic', async () => {
      const reversal = setupRefund({ total: 3, originals: [original] });
      const tx = reversal.tx;
      prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) =>
        cb(tx),
      );

      await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 1,
        amountRefunded: 1,
      });

      expect((reversal.created[0].quantity as Prisma.Decimal).toString()).toBe('-33.3333');
    });

    it('skips when the order total is zero', async () => {
      const reversal = setupRefund({ total: 0 });
      const result = await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 50,
      });

      expect(result).toEqual({ created: 0, skipped: 0 });
      expect(reversal.created).toHaveLength(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips when the order has no original consumption records', async () => {
      const reversal = setupRefund({ originals: [] });
      const result = await service.reverseConsumptionForRefund({
        tenantId: 'tenant-1',
        orderId: 'order-1',
        paymentId: 'payment-1',
        amount: 50,
      });

      expect(result).toEqual({ created: 0, skipped: 0 });
      expect(reversal.created).toHaveLength(0);
    });

    it('uses a ROLLBACK key once for a full cancellation shown through rollbackDeduction', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1', total: 100 });
      prisma.stockMovement.findMany.mockResolvedValue(movements);
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        stockMovement: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'sm-rb' }),
        },
        inventoryItem: { update: jest.fn().mockResolvedValue({}) },
        consumptionRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest
            .fn()
            .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
              if (where.source === 'ORDER') return Promise.resolve([original]);
              if (typeof where.reversedFromId === 'string') return Promise.resolve([]);
              return Promise.resolve([]);
            }),
          create: jest.fn().mockResolvedValue({ id: 'cr-rb' }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) =>
        cb(tx),
      );

      const result = await service.rollbackDeduction('order-1', 'tenant-1');

      expect(result).toEqual({ rolledBack: true, movementsReversed: 1 });
      expect(tx.consumptionRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: 'REVERSAL',
            quantity: expect.objectContaining({ s: -1, e: 2 }),
            reversedFromId: 'cr-1',
          }),
        }),
      );
      const createdData = tx.consumptionRecord.create.mock.calls[0][0].data;
      expect(createdData.reversalKey).toBe('ROLLBACK:order-1:cr-1');
      expect(createdData.quantity.toString()).toBe('-100');
    });
  });

  describe('rollbackDeduction', () => {
    it('is idempotent: a second rollback for the same order is a no-op', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1', total: 100 });
      prisma.stockMovement.findMany.mockResolvedValue(movements);
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        stockMovement: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'sm-rb' }),
        },
        inventoryItem: { update: jest.fn().mockResolvedValue({}) },
        consumptionRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest
            .fn()
            .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
              if (where.source === 'ORDER') return Promise.resolve([original]);
              if (typeof where.reversedFromId === 'string') return Promise.resolve([]);
              return Promise.resolve([]);
            }),
          create: jest.fn().mockResolvedValue({ id: 'cr-rb' }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) =>
        cb(tx),
      );

      await service.rollbackDeduction('order-1', 'tenant-1');

      const secondTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        stockMovement: {
          findFirst: jest.fn().mockResolvedValue({ id: 'rb-existing' }),
          create: jest.fn(),
        },
        inventoryItem: { update: jest.fn() },
        consumptionRecord: {
          findUnique: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) =>
        cb(secondTx),
      );

      const second = await service.rollbackDeduction('order-1', 'tenant-1');

      expect(second).toEqual({ rolledBack: false, movementsReversed: 0 });
      expect(secondTx.stockMovement.create).not.toHaveBeenCalled();
      expect(secondTx.inventoryItem.update).not.toHaveBeenCalled();
      expect(secondTx.consumptionRecord.create).not.toHaveBeenCalled();
    });

    it('throws NotFound when there are no deduction movements for the order', async () => {
      prisma.stockMovement.findMany.mockResolvedValue([]);

      await expect(service.rollbackDeduction('order-1', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('derives reversal totalCost from unitCost x quantity (negative)', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1', total: 100 });
      prisma.stockMovement.findMany.mockResolvedValue(movements);
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        stockMovement: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'sm-rb' }),
        },
        inventoryItem: { update: jest.fn().mockResolvedValue({}) },
        consumptionRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest
            .fn()
            .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
              if (where.source === 'ORDER') return Promise.resolve([original]);
              if (typeof where.reversedFromId === 'string') return Promise.resolve([]);
              return Promise.resolve([]);
            }),
          create: jest.fn().mockResolvedValue({ id: 'cr-rb' }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: Record<string, unknown>) => unknown) =>
        cb(tx),
      );

      await service.rollbackDeduction('order-1', 'tenant-1');

      const data = tx.consumptionRecord.create.mock.calls[0][0].data;
      expect(data.quantity.toString()).toBe('-100');
      expect(data.unitCost.toString()).toBe('6');
      expect(data.totalCost.toString()).toBe('-600');
    });
  });
});
