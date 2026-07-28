import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly queueService: QueueService) {}

  @Cron(CronExpression.EVERY_6_HOURS, { name: 'cleanup_expired_sessions' })
  async handleCleanupExpiredSessions() {
    await this.queueService.addJob('cleanup', 'cleanup', {
      payload: { type: 'expired_sessions' },
    });
    this.logger.log('Scheduled: cleanup_expired_sessions queued');
  }

  @Cron(CronExpression.EVERY_12_HOURS, { name: 'cleanup_expired_tokens' })
  async handleCleanupExpiredTokens() {
    await this.queueService.addJob('cleanup', 'cleanup', {
      payload: { type: 'expired_tokens' },
    });
    this.logger.log('Scheduled: cleanup_expired_tokens queued');
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'archive_old_audit_logs' })
  async handleArchiveOldAuditLogs() {
    await this.queueService.addJob('cleanup', 'cleanup', {
      payload: { type: 'archive_old_audit_logs' },
    });
    this.logger.log('Scheduled: archive_old_audit_logs queued');
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'cleanup_expired_tokens_2am' })
  async handleCleanupExpiredTokens2am() {
    await this.queueService.addJob('cleanup', 'cleanup', {
      payload: { type: 'expired_tokens' },
    });
    this.logger.log('Scheduled: cleanup_expired_tokens_2am queued');
  }

  getRegisteredJobs(): Array<{ name: string; description: string }> {
    return [
      { name: 'cleanup_expired_sessions', description: 'Every 6 hours - remove expired sessions' },
      {
        name: 'cleanup_expired_tokens',
        description: 'Every 12 hours - remove expired verification tokens',
      },
      { name: 'archive_old_audit_logs', description: 'Daily at midnight - archive old audit logs' },
    ];
  }
}
