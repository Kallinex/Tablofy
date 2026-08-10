import { DeadLetterProcessor } from '../dead-letter.processor';
import { createMockMetrics } from '../../../test/mocks/metrics.mock';

const queueServiceMock = {
  registerWorker: jest.fn(),
};

const metricsMock = createMockMetrics();

const eventEmitterMock = {
  emit: jest.fn(),
};

describe('DeadLetterProcessor', () => {
  let processor: DeadLetterProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new DeadLetterProcessor(
      queueServiceMock as never,
      metricsMock as never,
      eventEmitterMock as never,
    );
  });

  it('registers a dead-letter worker', () => {
    expect(queueServiceMock.registerWorker).toHaveBeenCalledWith(
      'dead-letter',
      expect.any(Function),
      5,
    );
  });

  it('alerts on dead letter consumption via metrics and event emission (D4)', async () => {
    const job = {
      id: 'dlq-1',
      data: {
        originalQueue: 'notification',
        originalJobId: 'job-42',
        originalJobName: 'low-stock-alert',
        attemptsMade: 5,
        failedAt: '2026-08-08T00:00:00.000Z',
        error: { message: 'boom' },
      },
    };

    const result = await (
      processor as unknown as {
        handleDeadLetter: (job: unknown) => Promise<unknown>;
      }
    ).handleDeadLetter(job);

    expect(result).toEqual({ consumed: true, originalQueue: 'notification' });
    expect(metricsMock.incrementBullQueueDeadLetter).toHaveBeenCalledWith('notification');
    expect(eventEmitterMock.emit).toHaveBeenCalledWith('queue.dead-letter', {
      queue: 'notification',
      jobId: 'job-42',
      jobName: 'low-stock-alert',
      attemptsMade: 5,
      failedAt: '2026-08-08T00:00:00.000Z',
      error: 'boom',
    });
  });

  it('defaults missing originalQueue to unknown', async () => {
    const job = { id: 'dlq-2', data: {} };

    await (
      processor as unknown as {
        handleDeadLetter: (job: unknown) => Promise<unknown>;
      }
    ).handleDeadLetter(job);

    expect(metricsMock.incrementBullQueueDeadLetter).toHaveBeenCalledWith('unknown');
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      'queue.dead-letter',
      expect.objectContaining({ queue: 'unknown', jobId: 'dlq-2' }),
    );
  });
});
