import { Test, TestingModule } from '@nestjs/testing';
import { SupplierPerformanceProcessor } from '../supplier-performance.processor';
import { QueueService } from '../../queues/queue.service';
import { createMockQueueService } from '../../../test/mocks';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('SupplierPerformanceProcessor', () => {
  const queueService = createMockQueueService();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SupplierPerformanceProcessor, { provide: QueueService, useValue: queueService }],
    }).compile();
    module.get(SupplierPerformanceProcessor);
  });

  it('registers the performance calculation worker', () => {
    expect(queueService.registeredNames()).toContain('supplier-performance-calculation');
  });

  it('processes a calculation job', async () => {
    const handler = queueService.getHandler('supplier-performance-calculation');
    const result = await handler({
      id: 'job-1',
      data: { tenantId: testTenantId, payload: { supplierId: 's-1' } },
    });
    expect(result).toEqual({ processed: true });
  });
});
