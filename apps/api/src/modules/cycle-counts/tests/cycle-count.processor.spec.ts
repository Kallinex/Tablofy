import { Test, TestingModule } from '@nestjs/testing';
import { CycleCountProcessor } from '../cycle-count.processor';
import { QueueService } from '../../queues/queue.service';
import { createMockQueueService } from '../../../test/mocks';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('CycleCountProcessor', () => {
  const queueService = createMockQueueService();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CycleCountProcessor, { provide: QueueService, useValue: queueService }],
    }).compile();
    module.get(CycleCountProcessor);
  });

  it('registers the reminder worker', () => {
    expect(queueService.registeredNames()).toContain('cycle-count-reminders');
  });

  it('processes a reminder job', async () => {
    const handler = queueService.getHandler('cycle-count-reminders');
    const result = await handler({
      id: 'job-1',
      data: { tenantId: testTenantId, payload: { countId: 'cc-1' } },
    });
    expect(result).toEqual({ processed: true });
  });
});
