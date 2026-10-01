import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrintProcessor } from '../print.processor';
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

describe('PrintProcessor', () => {
  const queueService = createMockQueueService();
  const processor = new PrintProcessor(queueService as unknown as QueueService);
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('registers the print worker with concurrency 3 on init', () => {
    processor.onModuleInit();

    expect(queueService.registerWorker).toHaveBeenCalledWith('print', expect.any(Function), 3);
  });

  it('routes the registered handler to process', async () => {
    processor.onModuleInit();
    const handler = queueService.getHandler('print');

    await expect(
      handler(makeJob('receipt.print', { printerType: 'thermal' })),
    ).resolves.toMatchObject({ printed: true, printerType: 'thermal' });
  });

  it('reports the payload size and printer type', async () => {
    const job = makeJob('receipt.print', {
      printerType: 'thermal',
      content: { lines: ['a', 'b'] },
    });

    const result = await processor.process(job);

    expect(result).toEqual({
      printed: true,
      printJobType: 'receipt.print',
      printerType: 'thermal',
      tenantId: testTenantId,
      contentLength: JSON.stringify({ lines: ['a', 'b'] }).length,
    });
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('defaults the printer type and reports zero length for empty content', async () => {
    const job = makeJob('kitchen-ticket.print', {});

    const result = await processor.process(job);

    expect(result.printerType).toBe('default');
    expect(result.contentLength).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('printer: default'));
  });
});
