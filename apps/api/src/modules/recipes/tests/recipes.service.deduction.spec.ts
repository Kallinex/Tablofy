import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StockMovementType, ConsumptionPeriod } from '@prisma/client';
import { RecipesService } from '../recipes.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { RecipesGateway } from '../recipes.gateway';

const order = {
  id: 'order-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  orderNumber: 1001,
  status: 'COMPLETED',
};

const orderItems = [
  {
    id: 'oi-1',
    orderId: 'order-1',
    tenantId: 'tenant-1',
    productId: 'prod-1',
    quantity: 2,
    voidedAt: null,
    deletedAt: null,
  },
];

const recipe = {
  id: 'recipe-1',
  productId: 'prod-1',
  tenantId: 'tenant-1',
  isActive: true,
  deletedAt: null,
  items: [
    {
      id: 'ri-1',
      recipeId: 'recipe-1',
      inventoryItemId: 'inv-1',
      quantity: 1,
      inventoryItem: {
        id: 'inv-1',
        name: 'Flour',
        currentQuantity: 100,
        unitCost: 5,
        averageCost: 6,
      },
    },
  ],
};

const inventoryItem = {
  id: 'inv-1',
  name: 'Flour',
  currentQuantity: 100,
  availableQuantity: 100,
  unitCost: 5,
  averageCost: 6,
};

const movement = {
  id: 'sm-1',
  inventoryItemId: 'inv-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  type: StockMovementType.CONSUMPTION,
  quantity: -2,
  unitCost: 6,
  totalCost: -12,
  referenceType: 'ORDER',
  referenceId: 'order-1',
  inventoryItem: { id: 'inv-1', name: 'Flour' },
};

type TxShape = ReturnType<typeof makeTx>;

function makeTx(options: { inTxExisting?: unknown } = {}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    stockMovement: {
      findFirst: jest.fn().mockResolvedValue(options.inTxExisting ?? null),
      create: jest.fn().mockResolvedValue({ id: 'sm-new' }),
    },
    inventoryItem: {
      findUnique: jest.fn().mockResolvedValue(inventoryItem),
      update: jest.fn().mockResolvedValue(inventoryItem),
    },
    consumptionRecord: {
      create: jest.fn().mockResolvedValue({ id: 'cr-new' }),
    },
  };
}

describe('RecipesService.deductInventoryForOrder (F1 idempotency)', () => {
  let service: RecipesService;
  let prisma: {
    order: { findFirst: jest.Mock };
    orderItem: { findMany: jest.Mock };
    stockMovement: { findMany: jest.Mock };
    recipe: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const auditLogsMock = { log: jest.fn().mockResolvedValue(undefined) };
  const cacheMock = { delete: jest.fn().mockResolvedValue(undefined) };
  const queueServiceMock = { addJob: jest.fn() };
  const eventEmitterMock = { emit: jest.fn() };
  const gatewayMock = { broadcastInventoryUpdate: jest.fn() };

  beforeEach(async () => {
    prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(order) },
      orderItem: { findMany: jest.fn().mockResolvedValue(orderItems) },
      stockMovement: { findMany: jest.fn().mockResolvedValue([]) },
      recipe: { findMany: jest.fn().mockResolvedValue([recipe]) },
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

    service = module.get(RecipesService);
  });

  it('throws NotFound when the order does not exist', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.deductInventoryForOrder('order-1', 'tenant-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'CANCELLED', 'REFUNDED', 'VOIDED'])(
    'rejects a %s order before any deduction work',
    async (status) => {
      prisma.order.findFirst.mockResolvedValue({ ...order, status });
      await expect(service.deductInventoryForOrder('order-1', 'tenant-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.stockMovement.findMany).not.toHaveBeenCalled();
    },
  );

  it('performs exactly one deduction for a single completed order', async () => {
    const tx = makeTx();
    prisma.$transaction.mockImplementation((cb: (t: TxShape) => unknown) => cb(tx));

    const report = await service.deductInventoryForOrder('order-1', 'tenant-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.inventoryItem.update).toHaveBeenCalledTimes(1);
    expect(report.orderId).toBe('order-1');
    expect(report.totalDeducted).toBe(2);
    expect(auditLogsMock.log).toHaveBeenCalledTimes(1);
    expect(cacheMock.delete).toHaveBeenCalledWith('tenant-1', 'inventory:list');
    expect(gatewayMock.broadcastInventoryUpdate).toHaveBeenCalledTimes(1);
  });

  it('returns an idempotent report when movements already exist and writes nothing', async () => {
    prisma.stockMovement.findMany.mockResolvedValue([movement]);

    const report = await service.deductInventoryForOrder('order-1', 'tenant-1');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(report.orderId).toBe('order-1');
    expect(report.totalDeducted).toBe(2);
    expect(report.items[0]).toEqual({
      inventoryItemId: 'inv-1',
      inventoryItemName: 'Flour',
      quantityDeducted: 2,
      unitCost: 6,
      totalCost: 12,
      wasPartial: false,
      shortfall: 0,
    });
    expect(auditLogsMock.log).not.toHaveBeenCalled();
    expect(gatewayMock.broadcastInventoryUpdate).not.toHaveBeenCalled();
  });

  it('deducts exactly once when duplicate claims race for the same order', async () => {
    const txInstances: TxShape[] = [];
    let committed = false;
    let committedMovement: unknown = null;
    let lock: Promise<void> = Promise.resolve();

    prisma.$transaction.mockImplementation(async (cb: (t: TxShape) => unknown) => {
      const previous = lock;
      let release!: () => void;
      lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const tx = makeTx({
        inTxExisting: committed ? committedMovement : null,
      });
      tx.stockMovement.create.mockImplementation((args: { data?: Record<string, unknown> }) => {
        committed = true;
        committedMovement = { ...movement, ...(args.data ?? {}) };
        return Promise.resolve({ id: 'sm-new' });
      });
      txInstances.push(tx);
      try {
        return await cb(tx);
      } finally {
        release();
      }
    });

    const results = await Promise.all([
      service.deductInventoryForOrder('order-1', 'tenant-1'),
      service.deductInventoryForOrder('order-1', 'tenant-1'),
    ]);

    const createCalls = txInstances.reduce(
      (total, t) => total + t.stockMovement.create.mock.calls.length,
      0,
    );
    const updateCalls = txInstances.reduce(
      (total, t) => total + t.inventoryItem.update.mock.calls.length,
      0,
    );

    expect(createCalls).toBe(1);
    expect(updateCalls).toBe(1);
    expect(auditLogsMock.log).toHaveBeenCalledTimes(1);
    expect(gatewayMock.broadcastInventoryUpdate).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    for (const report of results) {
      expect(report.orderId).toBe('order-1');
      expect(report.totalDeducted).toBe(2);
    }
  });

  it('deducts exactly once across a failed attempt and its retry', async () => {
    let attempt = 0;
    let resolvedCreates = 0;

    prisma.$transaction.mockImplementation(async (cb: (t: TxShape) => unknown) => {
      attempt += 1;
      const tx = makeTx();
      if (attempt === 1) {
        tx.stockMovement.create.mockRejectedValue(new Error('connection lost'));
      } else {
        tx.stockMovement.create.mockImplementation(() => {
          resolvedCreates += 1;
          return Promise.resolve({ id: 'sm-new' });
        });
      }
      return cb(tx);
    });

    await expect(service.deductInventoryForOrder('order-1', 'tenant-1')).rejects.toThrow(
      'connection lost',
    );

    const retryTx = makeTx();
    retryTx.stockMovement.create.mockImplementation(() => {
      resolvedCreates += 1;
      return Promise.resolve({ id: 'sm-new' });
    });
    prisma.$transaction.mockImplementation((cb: (t: TxShape) => unknown) => cb(retryTx));

    const report = await service.deductInventoryForOrder('order-1', 'tenant-1');

    expect(resolvedCreates).toBe(1);
    expect(report.totalDeducted).toBe(2);
  });

  it('deducts each order independently', async () => {
    prisma.order.findFirst.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve({ ...order, id: args.where.id }),
    );
    const txInstances: TxShape[] = [];
    prisma.$transaction.mockImplementation(async (cb: (t: TxShape) => unknown) => {
      const tx = makeTx();
      txInstances.push(tx);
      return cb(tx);
    });

    const results = await Promise.all([
      service.deductInventoryForOrder('order-1', 'tenant-1'),
      service.deductInventoryForOrder('order-2', 'tenant-1'),
    ]);

    const createCalls = txInstances.reduce(
      (total, t) => total + t.stockMovement.create.mock.calls.length,
      0,
    );
    expect(createCalls).toBe(2);
    const referenceIds = txInstances
      .flatMap((t) => t.stockMovement.create.mock.calls.map((c) => c[0].data.referenceId as string))
      .sort();
    expect(referenceIds).toEqual(['order-1', 'order-2']);
    expect(results.map((r) => r.orderId).sort()).toEqual(['order-1', 'order-2']);
  });

  it('isolates deductions between tenants for the same order id', async () => {
    prisma.order.findFirst.mockImplementation((args: { where: { tenantId: string } }) =>
      Promise.resolve({
        ...order,
        tenantId: args.where.tenantId,
        branchId: args.where.tenantId === 'tenant-2' ? 'branch-2' : 'branch-1',
      }),
    );
    const txInstances: TxShape[] = [];
    prisma.$transaction.mockImplementation(async (cb: (t: TxShape) => unknown) => {
      const tx = makeTx();
      txInstances.push(tx);
      return cb(tx);
    });

    const results = await Promise.all([
      service.deductInventoryForOrder('order-1', 'tenant-1'),
      service.deductInventoryForOrder('order-1', 'tenant-2'),
    ]);

    const createCalls = txInstances.reduce(
      (total, t) => total + t.stockMovement.create.mock.calls.length,
      0,
    );
    expect(createCalls).toBe(2);
    const tenants = txInstances
      .flatMap((t) => t.stockMovement.create.mock.calls.map((c) => c[0].data.tenantId as string))
      .sort();
    expect(tenants).toEqual(['tenant-1', 'tenant-2']);
    expect(results.map((r) => r.tenantId).sort()).toEqual(['tenant-1', 'tenant-2']);
  });

  it('decrements inventory quantities exactly once by the ordered quantity', async () => {
    const tx = makeTx();
    prisma.$transaction.mockImplementation((cb: (t: TxShape) => unknown) => cb(tx));

    const report = await service.deductInventoryForOrder('order-1', 'tenant-1');

    expect(tx.inventoryItem.update).toHaveBeenCalledTimes(1);
    expect(tx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { currentQuantity: { decrement: 2 }, availableQuantity: { decrement: 2 } },
    });
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inventoryItemId: 'inv-1',
          tenantId: 'tenant-1',
          referenceType: 'ORDER',
          referenceId: 'order-1',
          quantity: -2,
          type: StockMovementType.CONSUMPTION,
        }),
      }),
    );
    expect(report.items[0]).toEqual({
      inventoryItemId: 'inv-1',
      inventoryItemName: 'Flour',
      quantityDeducted: 2,
      unitCost: 6,
      totalCost: 12,
      wasPartial: false,
      shortfall: 0,
    });
  });

  it('rejects when no active recipe exists for the ordered product', async () => {
    prisma.recipe.findMany.mockResolvedValue([]);
    await expect(service.deductInventoryForOrder('order-1', 'tenant-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('P1-01 consumption records', () => {
    it('writes one DAILY ORDER consumption record mirroring each deduction, inside the same tx', async () => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation((cb: (t: TxShape) => unknown) => cb(tx));

      const report = await service.deductInventoryForOrder('order-1', 'tenant-1');

      expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
      expect(tx.consumptionRecord.create).toHaveBeenCalledTimes(1);
      expect(tx.consumptionRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          inventoryItemId: 'inv-1',
          tenantId: 'tenant-1',
          quantity: 2,
          unitCost: 6,
          totalCost: 12,
          period: ConsumptionPeriod.DAILY,
          source: 'ORDER',
          referenceId: 'order-1',
        }),
      });
      expect(report.totalDeducted).toBe(2);
    });

    it('records the actually-deducted quantity (not the needed amount) on partial shortfall', async () => {
      const tx = makeTx();
      tx.inventoryItem.findUnique.mockResolvedValue({
        ...inventoryItem,
        currentQuantity: 1,
        availableQuantity: 1,
      });
      prisma.$transaction.mockImplementation((cb: (t: TxShape) => unknown) => cb(tx));

      await service.deductInventoryForOrder('order-1', 'tenant-1');

      expect(tx.consumptionRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ quantity: 1, unitCost: 6, totalCost: 6 }),
      });
    });

    it('does not duplicate records when a concurrent claim already deducted the order', async () => {
      const txInstances: TxShape[] = [];
      let committed = false;
      let committedMovement: unknown = null;
      let lock: Promise<void> = Promise.resolve();

      prisma.$transaction.mockImplementation(async (cb: (t: TxShape) => unknown) => {
        const previous = lock;
        let release!: () => void;
        lock = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const tx = makeTx({
          inTxExisting: committed ? committedMovement : null,
        });
        tx.stockMovement.create.mockImplementation((args: { data?: Record<string, unknown> }) => {
          committed = true;
          committedMovement = { ...movement, ...(args.data ?? {}) };
          return Promise.resolve({ id: 'sm-new' });
        });
        txInstances.push(tx);
        try {
          return await cb(tx);
        } finally {
          release();
        }
      });

      await Promise.all([
        service.deductInventoryForOrder('order-1', 'tenant-1'),
        service.deductInventoryForOrder('order-1', 'tenant-1'),
      ]);

      const recordCalls = txInstances.reduce(
        (total, t) => total + t.consumptionRecord.create.mock.calls.length,
        0,
      );
      expect(recordCalls).toBe(1);
    });

    it('writes a record for each tenant independently for the same order id', async () => {
      prisma.order.findFirst.mockImplementation((args: { where: { tenantId: string } }) =>
        Promise.resolve({
          ...order,
          tenantId: args.where.tenantId,
          branchId: args.where.tenantId === 'tenant-2' ? 'branch-2' : 'branch-1',
        }),
      );
      const txInstances: TxShape[] = [];
      prisma.$transaction.mockImplementation(async (cb: (t: TxShape) => unknown) => {
        const tx = makeTx();
        txInstances.push(tx);
        return cb(tx);
      });

      await Promise.all([
        service.deductInventoryForOrder('order-1', 'tenant-1'),
        service.deductInventoryForOrder('order-1', 'tenant-2'),
      ]);

      const tenants = txInstances
        .flatMap((t) =>
          t.consumptionRecord.create.mock.calls.map((c) => c[0].data.tenantId as string),
        )
        .sort();
      expect(tenants).toEqual(['tenant-1', 'tenant-2']);
    });

    it('does not write consumption records on the idempotent no-op path', async () => {
      prisma.stockMovement.findMany.mockResolvedValue([movement]);

      await service.deductInventoryForOrder('order-1', 'tenant-1');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('isOrderCompletedForDeduction', () => {
    it('returns true when the order is COMPLETED', async () => {
      prisma.order.findFirst.mockResolvedValue({ ...order, status: 'COMPLETED' });
      await expect(service.isOrderCompletedForDeduction('order-1', 'tenant-1')).resolves.toBe(true);
    });

    it('returns false for other statuses or missing orders', async () => {
      prisma.order.findFirst.mockResolvedValue({ ...order, status: 'CONFIRMED' });
      await expect(service.isOrderCompletedForDeduction('order-1', 'tenant-1')).resolves.toBe(
        false,
      );

      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.isOrderCompletedForDeduction('order-1', 'tenant-1')).resolves.toBe(
        false,
      );
    });
  });
});
