import { Test, TestingModule } from '@nestjs/testing';
import { RecipesProcessor } from '../recipes.processor';
import { QueueService } from '../../queues/queue.service';
import { RecipesService } from '../recipes.service';

describe('RecipesProcessor (inventory deduction queue)', () => {
  let processor: RecipesProcessor;
  let inventoryHandler: (job: {
    data: { tenantId?: string; payload: { orderId?: string } };
  }) => Promise<unknown>;

  const queueServiceMock = {
    registerWorker: jest.fn(),
    addJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };

  const recipesServiceMock = {
    isOrderCompletedForDeduction: jest.fn(),
    deductInventoryForOrder: jest.fn().mockResolvedValue({
      orderId: 'order-1',
      tenantId: 'tenant-1',
      items: [],
      totalDeducted: 0,
      totalCost: 0,
      timestamp: new Date(),
    }),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipesProcessor,
        { provide: QueueService, useValue: queueServiceMock },
        { provide: RecipesService, useValue: recipesServiceMock },
      ],
    }).compile();

    processor = module.get(RecipesProcessor);
    expect(queueServiceMock.registerWorker).toHaveBeenCalledWith(
      'inventory-deduction',
      expect.any(Function),
    );
    inventoryHandler = queueServiceMock.registerWorker.mock.calls[0][1];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    queueServiceMock.addJob.mockResolvedValue({ id: 'job-1' });
    recipesServiceMock.isOrderCompletedForDeduction.mockResolvedValue(true);
  });

  it('enqueues exactly one deterministic job when order.completed fires', async () => {
    await processor.onOrderCompleted({ orderId: 'order-1', tenantId: 'tenant-1' });

    expect(queueServiceMock.addJob).toHaveBeenCalledTimes(1);
    expect(queueServiceMock.addJob).toHaveBeenCalledWith(
      'inventory-deduction',
      'deduct-inventory',
      { tenantId: 'tenant-1', payload: { orderId: 'order-1' } },
      { jobId: 'deduct-order-1' },
    );
  });

  it('uses the same deterministic jobId for every duplicate order.completed event', async () => {
    await processor.onOrderCompleted({ orderId: 'order-1', tenantId: 'tenant-1' });
    await processor.onOrderCompleted({ orderId: 'order-1', tenantId: 'tenant-1' });
    await processor.onOrderCompleted({ orderId: 'order-1', tenantId: 'tenant-1' });

    expect(queueServiceMock.addJob).toHaveBeenCalledTimes(3);
    for (const call of queueServiceMock.addJob.mock.calls) {
      expect(call[3]).toEqual({ jobId: 'deduct-order-1' });
    }
  });

  it('enqueues a deterministic job for a completed payment event', async () => {
    await processor.onPaymentsCompleted({ orderId: 'order-1', tenantId: 'tenant-1' });

    expect(recipesServiceMock.isOrderCompletedForDeduction).toHaveBeenCalledWith(
      'order-1',
      'tenant-1',
    );
    expect(queueServiceMock.addJob).toHaveBeenCalledWith(
      'inventory-deduction',
      'deduct-inventory',
      { tenantId: 'tenant-1', payload: { orderId: 'order-1' } },
      { jobId: 'deduct-order-1' },
    );
  });

  it('collapses every split-completion event onto the same deterministic jobId', async () => {
    for (let i = 0; i < 5; i += 1) {
      await processor.onPaymentsCompleted({ orderId: 'order-1', tenantId: 'tenant-1' });
    }

    expect(queueServiceMock.addJob).toHaveBeenCalledTimes(5);
    for (const call of queueServiceMock.addJob.mock.calls) {
      expect(call[3]).toEqual({ jobId: 'deduct-order-1' });
    }
  });

  it('does not enqueue a deduction when the order is not completed', async () => {
    recipesServiceMock.isOrderCompletedForDeduction.mockResolvedValue(false);

    await processor.onPaymentsCompleted({ orderId: 'order-1', tenantId: 'tenant-1' });

    expect(queueServiceMock.addJob).not.toHaveBeenCalled();
  });

  it('uses distinct jobIds for distinct orders', async () => {
    await processor.onOrderCompleted({ orderId: 'order-1', tenantId: 'tenant-1' });
    await processor.onOrderCompleted({ orderId: 'order-2', tenantId: 'tenant-1' });

    const jobIds = queueServiceMock.addJob.mock.calls.map((call) => call[3].jobId);
    expect(jobIds).toEqual(['deduct-order-1', 'deduct-order-2']);
  });

  it('delegates worker processing to deductInventoryForOrder', async () => {
    await inventoryHandler({
      data: { tenantId: 'tenant-1', payload: { orderId: 'order-1' } },
    });

    expect(recipesServiceMock.deductInventoryForOrder).toHaveBeenCalledWith('order-1', 'tenant-1');
  });

  it('throws when a deduction job has no tenantId so it can be retried', async () => {
    await expect(inventoryHandler({ data: { payload: { orderId: 'order-1' } } })).rejects.toThrow(
      'tenantId is required for inventory deduction',
    );
    expect(recipesServiceMock.deductInventoryForOrder).not.toHaveBeenCalled();
  });
});
