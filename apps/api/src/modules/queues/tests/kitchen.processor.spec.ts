import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { KitchenProcessor } from '../kitchen.processor';
import { QueueService } from '../queue.service';
import { createMockQueueService } from '../../../test/mocks';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

function makeJob(name: string, payload: Record<string, unknown> = {}): Job {
  return {
    name,
    data: { tenantId: testTenantId, payload },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job;
}

describe('KitchenProcessor', () => {
  const queueService = createMockQueueService();
  let processor: KitchenProcessor;
  let logSpy: jest.SpyInstance;

  beforeAll(() => {
    processor = new KitchenProcessor(queueService as unknown as QueueService);
  });

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('registers the kitchen worker with concurrency 5 on init', () => {
    processor.onModuleInit();

    expect(queueService.registerWorker).toHaveBeenCalledWith('kitchen', expect.any(Function), 5);
  });

  it('routes the handler registered on init to process', async () => {
    processor.onModuleInit();
    const handler = queueService.getHandler('kitchen');

    await expect(handler(makeJob('order.confirmed.kds', { orderId: 'order-1' }))).resolves.toEqual({
      processed: true,
      eventType: 'order.confirmed.kds',
      tenantId: testTenantId,
    });
  });

  it('handles a confirmed KDS order', async () => {
    const job = makeJob('order.confirmed.kds', { orderId: 'order-1' });

    const result = await processor.process(job);

    expect(result.eventType).toBe('order.confirmed.kds');
    expect(job.updateProgress).toHaveBeenCalledWith(100);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('KDS processing for order order-1'),
    );
  });

  it('handles a ticket item status change', async () => {
    const job = makeJob('ticket-item.status-changed', {
      itemId: 'item-1',
      status: 'READY',
    });

    await processor.process(job);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Item item-1 status changed to READY'),
    );
  });

  it('logs and still completes unknown event types', async () => {
    const job = makeJob('something.else');

    const result = await processor.process(job);

    expect(result).toEqual({
      processed: true,
      eventType: 'something.else',
      tenantId: testTenantId,
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown event type: something.else'),
    );
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });
});
