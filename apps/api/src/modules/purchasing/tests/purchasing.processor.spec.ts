import { Test, TestingModule } from '@nestjs/testing';
import { PurchasingProcessor } from '../purchasing.processor';
import { QueueService } from '../../queues/queue.service';
import { createMockQueueService } from '../../../test/mocks';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('PurchasingProcessor', () => {
  const queueService = createMockQueueService();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchasingProcessor, { provide: QueueService, useValue: queueService }],
    }).compile();
    module.get(PurchasingProcessor);
  });

  it('registers purchasing workers', () => {
    expect(queueService.registeredNames()).toEqual(
      expect.arrayContaining(['purchase-notifications', 'purchase-analytics']),
    );
  });

  it('processes purchase notifications', async () => {
    const handler = queueService.getHandler('purchase-notifications');
    const result = await handler({
      id: 'job-1',
      data: { tenantId: testTenantId, userId: 'user-1', payload: { poId: 'po-1' } },
    });
    expect(result).toEqual({ processed: true });
  });

  it('processes purchase analytics', async () => {
    const handler = queueService.getHandler('purchase-analytics');
    const result = await handler({
      id: 'job-2',
      data: { tenantId: testTenantId, payload: { poId: 'po-1' } },
    });
    expect(result).toEqual({ processed: true });
  });
});
