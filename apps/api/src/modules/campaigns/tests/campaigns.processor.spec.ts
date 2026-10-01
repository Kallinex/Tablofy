import { Test, TestingModule } from '@nestjs/testing';
import { CampaignsProcessor } from '../campaigns.processor';
import { QueueService } from '../../queues/queue.service';
import { createMockQueueService } from '../../../test/mocks';

describe('CampaignsProcessor', () => {
  const queueService = createMockQueueService();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CampaignsProcessor, { provide: QueueService, useValue: queueService }],
    }).compile();
    module.get(CampaignsProcessor);
  });

  it('registers all campaign workers', () => {
    expect(queueService.registeredNames()).toEqual(
      expect.arrayContaining([
        'campaign-execution',
        'segment-recalculation',
        'analytics-generation',
        'membership-recalculation',
      ]),
    );
  });

  it('returns the campaign id when executing a campaign', async () => {
    const handler = queueService.getHandler('campaign-execution');
    const result = await handler({ id: 'job-1', data: { payload: { campaignId: 'c-1' } } });
    expect(result).toEqual({ processed: true, campaignId: 'c-1' });
  });

  it('processes the remaining campaign jobs', async () => {
    for (const name of [
      'segment-recalculation',
      'analytics-generation',
      'membership-recalculation',
    ]) {
      const handler = queueService.getHandler(name);
      await expect(handler({ id: 'job-1', data: { payload: {} } })).resolves.toEqual({
        processed: true,
      });
    }
  });
});
