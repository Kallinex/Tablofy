import { Test, TestingModule } from '@nestjs/testing';
import { TransfersProcessor } from '../transfers.processor';
import { QueueService } from '../../queues/queue.service';
import { createMockQueueService } from '../../../test/mocks';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('TransfersProcessor', () => {
  const queueService = createMockQueueService();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TransfersProcessor, { provide: QueueService, useValue: queueService }],
    }).compile();
    module.get(TransfersProcessor);
  });

  it('registers the transfer notification worker', () => {
    expect(queueService.registeredNames()).toContain('transfer-notifications');
  });

  it('processes a transfer notification job', async () => {
    const handler = queueService.getHandler('transfer-notifications');
    const result = await handler({
      id: 'job-1',
      data: { tenantId: testTenantId, userId: 'user-1', payload: { transferId: 't-1' } },
    });
    expect(result).toEqual({ processed: true });
  });
});
