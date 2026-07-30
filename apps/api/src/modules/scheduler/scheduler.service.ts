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

  @Cron(CronExpression.EVERY_6_HOURS, { name: 'cleanup_failed_webhooks' })
  async handleCleanupFailedWebhooks() {
    await this.queueService.addJob('cleanup', 'cleanup', {
      payload: { type: 'failed_webhook_deliveries' },
    });
    this.logger.log('Scheduled: cleanup_failed_webhooks queued');
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'cleanup_stale_jobs' })
  async handleCleanupStaleJobs() {
    await this.queueService.addJob('cleanup', 'cleanup', {
      payload: { type: 'stale_jobs' },
    });
    this.logger.log('Scheduled: cleanup_stale_jobs queued');
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'cleanup_expired_data_exports' })
  async handleCleanupExpiredDataExports() {
    await this.queueService.addJob('cleanup', 'cleanup', {
      payload: { type: 'expired_data_exports' },
    });
    this.logger.log('Scheduled: cleanup_expired_data_exports queued');
  }

  @Cron(CronExpression.EVERY_WEEK, { name: 'cleanup_expired_backups' })
  async handleCleanupExpiredBackups() {
    await this.queueService.addJob('cleanup', 'cleanup', {
      payload: { type: 'expired_backups' },
    });
    this.logger.log('Scheduled: cleanup_expired_backups queued');
  }

  @Cron(CronExpression.EVERY_DAY_AT_5AM, { name: 'cleanup_stale_gift_cards' })
  async handleCleanupStaleGiftCards() {
    await this.queueService.addJob('cleanup', 'cleanup', {
      payload: { type: 'stale_gift_cards' },
    });
    this.logger.log('Scheduled: cleanup_stale_gift_cards queued');
  }

  getRegisteredJobs(): Array<{ name: string; description: string }> {
    return [
      { name: 'cleanup_expired_sessions', description: 'Every 6 hours - remove expired sessions' },
      {
        name: 'cleanup_expired_tokens',
        description: 'Every 12 hours - remove expired verification tokens',
      },
      { name: 'archive_old_audit_logs', description: 'Daily at midnight - archive old audit logs' },
      {
        name: 'cleanup_failed_webhooks',
        description: 'Every 6 hours - remove failed webhook deliveries',
      },
      { name: 'cleanup_stale_jobs', description: 'Daily at 3am - clean up stale jobs' },
      {
        name: 'cleanup_expired_data_exports',
        description: 'Daily at 4am - remove expired data exports',
      },
      { name: 'cleanup_expired_backups', description: 'Weekly - mark expired backups' },
      { name: 'cleanup_stale_gift_cards', description: 'Daily at 5am - expire stale gift cards' },
    ];
  }
}
