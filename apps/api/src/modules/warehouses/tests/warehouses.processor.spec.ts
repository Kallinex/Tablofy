import { Test, TestingModule } from '@nestjs/testing';
import { WarehousesProcessor } from '../warehouses.processor';
import { QueueService } from '../../queues/queue.service';
import { createMockQueueService } from '../../../test/mocks';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('WarehousesProcessor', () => {
  const queueService = createMockQueueService();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WarehousesProcessor, { provide: QueueService, useValue: queueService }],
    }).compile();
    module.get(WarehousesProcessor);
  });

  it('registers the warehouse analytics worker', () => {
    expect(queueService.registeredNames()).toContain('warehouse-analytics');
  });

  it('processes a warehouse analytics job', async () => {
    const handler = queueService.getHandler('warehouse-analytics');
    const result = await handler({
      id: 'job-1',
      data: { tenantId: testTenantId, payload: { warehouseId: 'w-1' } },
    });
    expect(result).toEqual({ processed: true });
  });
});
