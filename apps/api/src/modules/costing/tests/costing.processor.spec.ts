import { Test, TestingModule } from '@nestjs/testing';
import { CostingProcessor } from '../costing.processor';
import { QueueService } from '../../queues/queue.service';
import { createMockQueueService } from '../../../test/mocks';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('CostingProcessor', () => {
  const queueService = createMockQueueService();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CostingProcessor, { provide: QueueService, useValue: queueService }],
    }).compile();
    module.get(CostingProcessor);
  });

  it('registers the daily valuation worker', () => {
    expect(queueService.registeredNames()).toContain('daily-valuation');
  });

  it('processes a valuation job', async () => {
    const handler = queueService.getHandler('daily-valuation');
    const result = await handler({
      id: 'job-1',
      data: { tenantId: testTenantId, payload: { date: '2026-01-01' } },
    });
    expect(result).toEqual({ processed: true });
  });
});
