import { ExportEngineProcessor } from '../export-engine.processor';
import { QueueService } from '../../queues/queue.service';
import { ExportEngineService } from '../export-engine.service';
import { createMockQueueService } from '../../../test/mocks/queue.mock';

describe('ExportEngineProcessor', () => {
  let queueService: ReturnType<typeof createMockQueueService>;
  let exportEngineService: { processExport: jest.Mock };
  let processor: ExportEngineProcessor;

  beforeEach(() => {
    queueService = createMockQueueService();
    exportEngineService = { processExport: jest.fn().mockResolvedValue({ status: 'DONE' }) };
    processor = new ExportEngineProcessor(
      queueService as unknown as QueueService,
      exportEngineService as unknown as ExportEngineService,
    );
  });

  it('registers the export-engine worker on construction', () => {
    expect(processor).toBeInstanceOf(ExportEngineProcessor);
    expect(queueService.registeredNames()).toEqual(['export-engine']);
  });

  it('delegates the job to the export engine service', async () => {
    const handler = queueService.getHandler('export-engine');
    const job = { id: 'export-1', data: { tenantId: 'tenant-1', payload: { type: 'orders' } } };

    const result = await handler(job);

    expect(exportEngineService.processExport).toHaveBeenCalledWith(job);
    expect(result).toEqual({ status: 'DONE' });
  });

  it('propagates processing failures so the job can be retried', async () => {
    const handler = queueService.getHandler('export-engine');
    exportEngineService.processExport.mockRejectedValue(new Error('export failed'));

    await expect(
      handler({ id: 'export-2', data: { tenantId: 'tenant-2', payload: {} } }),
    ).rejects.toThrow('export failed');
  });
});
