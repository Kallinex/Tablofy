import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from '../scheduler.service';
import { QueueService } from '../../queues/queue.service';
import { RedisLockService } from '../../../redis/redis-lock.service';

const queueServiceMock = {
  addJob: jest.fn().mockResolvedValue({ id: 'mock-job' }),
};

const redisLockMock = {
  runIfLocked: jest.fn(async (_key: string, _ttl: number, task: () => Promise<void>) => {
    await task();
    return true;
  }),
};

const CRON_HANDLERS: Array<[string, string, string]> = [
  ['handleCleanupExpiredSessions', 'cleanup_expired_sessions', 'expired_sessions'],
  ['handleCleanupExpiredTokens', 'cleanup_expired_tokens', 'expired_tokens'],
  ['handleArchiveOldAuditLogs', 'archive_old_audit_logs', 'archive_old_audit_logs'],
  ['handleCleanupExpiredTokens2am', 'cleanup_expired_tokens_2am', 'expired_tokens'],
  ['handleCleanupFailedWebhooks', 'cleanup_failed_webhooks', 'failed_webhook_deliveries'],
  ['handleCleanupStaleJobs', 'cleanup_stale_jobs', 'stale_jobs'],
  ['handleCleanupExpiredDataExports', 'cleanup_expired_data_exports', 'expired_data_exports'],
  ['handleCleanupExpiredBackups', 'cleanup_expired_backups', 'expired_backups'],
  ['handleCleanupStaleGiftCards', 'cleanup_stale_gift_cards', 'stale_gift_cards'],
];

describe('SchedulerService', () => {
  let service: SchedulerService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: QueueService, useValue: queueServiceMock },
        { provide: RedisLockService, useValue: redisLockMock },
      ],
    }).compile();

    service = module.get(SchedulerService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('wraps every cron handler with a distributed lock', async () => {
    for (const [handler, jobName, payloadType] of CRON_HANDLERS) {
      await (service as unknown as Record<string, () => Promise<void>>)[handler]();
      expect(redisLockMock.runIfLocked).toHaveBeenCalledWith(
        `cron:${jobName}`,
        expect.any(Number),
        expect.any(Function),
      );
      expect(queueServiceMock.addJob).toHaveBeenCalledWith('cleanup', 'cleanup', {
        payload: { type: payloadType },
      });
    }
  });

  it('skips enqueueing when the lock is not acquired', async () => {
    redisLockMock.runIfLocked.mockResolvedValueOnce(false);
    await service.handleCleanupExpiredSessions();
    expect(queueServiceMock.addJob).not.toHaveBeenCalled();
  });
});
