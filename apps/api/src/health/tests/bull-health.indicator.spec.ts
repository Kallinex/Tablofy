import { BullHealthIndicator } from '../bull-health.indicator';
import { QUEUE_NAMES } from '../../modules/queues/queue.service';

const queueServiceMock = {
  getQueueStats: jest.fn(),
};

const stats = {
  queue: 'x',
  waiting: 0,
  active: 0,
  completed: 1,
  failed: 0,
  delayed: 0,
};

describe('BullHealthIndicator', () => {
  let indicator: BullHealthIndicator;

  beforeEach(() => {
    jest.clearAllMocks();
    queueServiceMock.getQueueStats.mockResolvedValue(stats);
    indicator = new BullHealthIndicator(queueServiceMock as never);
  });

  it('reports healthy when every configured queue is reachable', async () => {
    const result = await indicator.isHealthy('bullmq');

    expect(result.bullmq.status).toBe('up');
    for (const name of QUEUE_NAMES) {
      expect(queueServiceMock.getQueueStats).toHaveBeenCalledWith(name);
    }
  });

  it('monitors all configured queues, not a hardcoded subset (D4)', () => {
    const monitored = QUEUE_NAMES;
    expect(monitored).toHaveLength(21);
    for (const name of [
      'webhook-delivery',
      'webhook-retry',
      'inventory-sync',
      'low-stock-alerts',
      'expiration-checks',
      'waste-reports',
      'crm-jobs',
      'campaign-execution',
      'dead-letter',
      'email',
      'cleanup',
      'notification',
      'kitchen',
      'print',
    ]) {
      expect(monitored).toContain(name);
    }
  });

  it('reports unhealthy when a queue is unreachable', async () => {
    queueServiceMock.getQueueStats.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(indicator.isHealthy('bullmq')).rejects.toThrow();
  });
});
