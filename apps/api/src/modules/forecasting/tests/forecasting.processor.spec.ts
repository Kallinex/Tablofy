import { Test, TestingModule } from '@nestjs/testing';
import { ForecastingProcessor } from '../forecasting.processor';
import { ForecastingService } from '../forecasting.service';
import { QueueService } from '../../queues/queue.service';
import { createMockQueueService } from '../../../test/mocks';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('ForecastingProcessor', () => {
  const queueService = createMockQueueService();
  const forecastingService = {
    generateForecast: jest.fn().mockResolvedValue({ id: 'f-1' }),
    generateReorderSuggestions: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForecastingProcessor,
        { provide: QueueService, useValue: queueService },
        { provide: ForecastingService, useValue: forecastingService },
      ],
    }).compile();
    module.get(ForecastingProcessor);
  });

  beforeEach(() => {
    forecastingService.generateForecast.mockClear();
    forecastingService.generateReorderSuggestions.mockClear();
  });

  it('registers forecasting workers', () => {
    expect(queueService.registeredNames()).toEqual(
      expect.arrayContaining(['forecast-generation', 'auto-reorder']),
    );
  });

  it('generates a forecast when tenant and item are present', async () => {
    const handler = queueService.getHandler('forecast-generation');
    const result = await handler({
      id: 'job-1',
      data: {
        tenantId: testTenantId,
        payload: {
          inventoryItemId: 'item-1',
          period: 'WEEKLY',
          method: 'MOVING_AVERAGE',
          days: 7,
          userId: 'user-1',
        },
      },
    });

    expect(forecastingService.generateForecast).toHaveBeenCalledWith(
      { inventoryItemId: 'item-1', period: 'WEEKLY', method: 'MOVING_AVERAGE', days: 7 },
      testTenantId,
      'user-1',
    );
    expect(result).toEqual({ processed: true, tenantId: testTenantId, inventoryItemId: 'item-1' });
  });

  it('skips forecast generation when the item is missing', async () => {
    const handler = queueService.getHandler('forecast-generation');
    const result = await handler({ id: 'job-2', data: { tenantId: testTenantId, payload: {} } });

    expect(forecastingService.generateForecast).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: true, tenantId: testTenantId, inventoryItemId: undefined });
  });

  it('generates reorder suggestions for the tenant', async () => {
    const handler = queueService.getHandler('auto-reorder');
    const result = await handler({
      id: 'job-3',
      data: { tenantId: testTenantId, userId: 'user-2' },
    });

    expect(forecastingService.generateReorderSuggestions).toHaveBeenCalledWith(
      testTenantId,
      'user-2',
    );
    expect(result).toEqual({ processed: true, tenantId: testTenantId });
  });

  it('skips reorder suggestions when no tenant is present', async () => {
    const handler = queueService.getHandler('auto-reorder');
    await handler({ id: 'job-4', data: {} });

    expect(forecastingService.generateReorderSuggestions).not.toHaveBeenCalled();
  });
});
