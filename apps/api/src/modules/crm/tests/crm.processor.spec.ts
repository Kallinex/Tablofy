import { Test, TestingModule } from '@nestjs/testing';
import { CrmProcessor } from '../crm.processor';
import { QueueService } from '../../queues/queue.service';
import { createMockQueueService } from '../../../test/mocks';

describe('CrmProcessor', () => {
  const queueService = createMockQueueService();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CrmProcessor, { provide: QueueService, useValue: queueService }],
    }).compile();
    module.get(CrmProcessor);
  });

  it('registers all crm workers', () => {
    expect(queueService.registeredNames()).toEqual(
      expect.arrayContaining(['crm-jobs', 'scheduled-notifications', 'daily-reports']),
    );
  });

  it('processes every registered crm job', async () => {
    for (const name of ['crm-jobs', 'scheduled-notifications', 'daily-reports']) {
      const handler = queueService.getHandler(name);
      await expect(handler({ id: 'job-1', name, data: { payload: { a: 1 } } })).resolves.toEqual({
        processed: true,
      });
    }
  });
});
