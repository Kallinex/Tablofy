import { NotificationProcessor } from '../notification.processor';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

const queueServiceMock = {
  registerWorker: jest.fn(),
};

function makeJob(data: Record<string, unknown>, name = 'notification'): Job {
  return { data, name, updateProgress: jest.fn().mockResolvedValue(undefined) } as unknown as Job;
}

describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    processor = new NotificationProcessor(queueServiceMock as never);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('registers a notification worker on init', () => {
    processor.onModuleInit();
    expect(queueServiceMock.registerWorker).toHaveBeenCalledWith(
      'notification',
      expect.any(Function),
      5,
    );
  });

  it('delivers to every recipient in the canonical payload (D3)', async () => {
    const job = makeJob({
      tenantId: 'tenant-1',
      userId: 'user-1',
      payload: {
        title: 'Low stock alert',
        message: '2 item(s) below reorder level.',
        type: 'LOW_STOCK',
        channel: 'in_app',
        recipientUserIds: ['user-1', 'user-2'],
      },
    });

    const result = await processor.process(job);

    expect(result).toEqual({ delivered: true, recipients: 2 });
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('falls back to the job userId when recipientUserIds is absent', async () => {
    const job = makeJob({
      tenantId: 'tenant-1',
      userId: 'user-9',
      payload: {
        title: 'Low stock alert',
        message: '1 item(s) below reorder level.',
        type: 'LOW_STOCK',
        channel: 'in_app',
      },
    });

    const result = await processor.process(job);

    expect(result).toEqual({ delivered: true, recipients: 1 });
  });

  it('warns (instead of crashing) when the producer sends a mismatched payload (D3)', async () => {
    const job = makeJob({
      tenantId: 'tenant-1',
      payload: { items: ['item-1'] },
    });

    const result = await processor.process(job);

    expect(result).toEqual({ delivered: false, recipients: 0 });
    expect(warnSpy).toHaveBeenCalled();
    expect(job.updateProgress).not.toHaveBeenCalled();
  });
});
