import { Logger } from '@nestjs/common';
import { ScheduledReportsCron } from '../scheduled-reports.cron';

const redisLockMock = {
  runIfLocked: jest.fn(async (_key: string, _ttl: number, task: () => Promise<void>) => {
    await task();
    return true;
  }),
};

const scheduledReportsServiceMock = {
  runDueReports: jest.fn().mockResolvedValue({ scanned: 3, triggered: ['export-1'], skipped: 2 }),
};

describe('ScheduledReportsCron', () => {
  let cron: ScheduledReportsCron;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    cron = new ScheduledReportsCron(redisLockMock as never, scheduledReportsServiceMock as never);
  });

  it('wraps the due-report scan with a distributed lock', async () => {
    await cron.handleDueScheduledReports();

    expect(redisLockMock.runIfLocked).toHaveBeenCalledWith(
      'cron:process_due_scheduled_reports',
      expect.any(Number),
      expect.any(Function),
    );
    expect(scheduledReportsServiceMock.runDueReports).toHaveBeenCalledTimes(1);
  });

  it('skips the scan when another instance holds the lock', async () => {
    redisLockMock.runIfLocked.mockResolvedValueOnce(false);

    await cron.handleDueScheduledReports();

    expect(scheduledReportsServiceMock.runDueReports).not.toHaveBeenCalled();
  });
});
