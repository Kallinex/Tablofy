import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RedisLockService } from '../../redis/redis-lock.service';
import { ScheduledReportsService } from './scheduled-reports.service';

const SCHEDULED_REPORT_SCAN_LOCK_TTL_MS = 60 * 1000;

@Injectable()
export class ScheduledReportsCron {
  private readonly logger = new Logger(ScheduledReportsCron.name);

  constructor(
    private readonly redisLockService: RedisLockService,
    private readonly scheduledReportsService: ScheduledReportsService,
  ) {}

  @Cron('* * * * *', { name: 'process_due_scheduled_reports' })
  async handleDueScheduledReports() {
    await this.redisLockService.runIfLocked(
      'cron:process_due_scheduled_reports',
      SCHEDULED_REPORT_SCAN_LOCK_TTL_MS,
      async () => {
        const result = await this.scheduledReportsService.runDueReports();
        this.logger.log(
          `Scheduled reports scan: ${result.scanned} active, ${result.triggered.length} triggered`,
        );
      },
    );
  }
}
