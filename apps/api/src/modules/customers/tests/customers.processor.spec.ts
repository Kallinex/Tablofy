import { Test, TestingModule } from '@nestjs/testing';
import { CustomersProcessor } from '../customers.processor';
import { QueueService } from '../../queues/queue.service';
import { createMockQueueService } from '../../../test/mocks';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

const WORKERS = [
  'reward-processing',
  'point-expiration',
  'membership-upgrade',
  'marketing-jobs',
  'notification-jobs',
];

describe('CustomersProcessor', () => {
  const queueService = createMockQueueService();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomersProcessor, { provide: QueueService, useValue: queueService }],
    }).compile();
    module.get(CustomersProcessor);
  });

  it('registers all customer workers', () => {
    expect(queueService.registeredNames()).toEqual(expect.arrayContaining(WORKERS));
  });

  it('processes every registered customer job', async () => {
    for (const name of WORKERS) {
      const handler = queueService.getHandler(name);
      const result = await handler({
        id: 'job-1',
        data: { tenantId: testTenantId, userId: 'user-1', payload: {} },
      });
      expect(result).toEqual({ processed: true });
    }
  });
});
