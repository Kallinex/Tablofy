import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService, QueueJobData } from './queue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Job } from 'bullmq';

@Injectable()
export class CleanupProcessor implements OnModuleInit {
  private readonly logger = new Logger(CleanupProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.queueService.registerWorker('cleanup', this.process.bind(this), 1);
    this.logger.log('Cleanup processor registered');
  }

  async process(job: Job<QueueJobData>): Promise<{ cleaned: string[] }> {
    const { payload } = job.data;
    const { type } = payload as { type: string };

    const cleaned: string[] = [];

    switch (type) {
      case 'expired_sessions': {
        const retentionDays = this.configService.get<number>('CLEANUP_SESSION_RETENTION_DAYS', 30);
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        const result = await this.prisma.session.deleteMany({
          where: { expiresAt: { lt: cutoff } },
        });
        this.logger.log(
          `[Cleanup] Removed ${result.count} expired sessions (retention: ${retentionDays}d)`,
        );
        cleaned.push(`expired_sessions: ${result.count}`);
        break;
      }
      case 'expired_tokens': {
        const retentionDays = this.configService.get<number>('CLEANUP_TOKEN_RETENTION_DAYS', 7);
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        const result = await this.prisma.verificationToken.deleteMany({
          where: { expiresAt: { lt: cutoff } },
        });
        this.logger.log(
          `[Cleanup] Removed ${result.count} expired tokens (retention: ${retentionDays}d)`,
        );
        cleaned.push(`expired_tokens: ${result.count}`);
        break;
      }
      case 'archive_old_audit_logs': {
        const retentionDays = this.configService.get<number>('AUDIT_LOG_RETENTION_DAYS', 365);
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        const result = await this.prisma.auditLog.updateMany({
          where: {
            createdAt: { lt: cutoff },
            isArchived: false,
          },
          data: {
            isArchived: true,
            archivedAt: new Date(),
          },
        });
        this.logger.log(
          `[Cleanup] Archived ${result.count} audit logs older than ${retentionDays} days (not deleted)`,
        );
        cleaned.push(`archived_audit_logs: ${result.count}`);
        break;
      }
      case 'failed_webhook_deliveries': {
        const retentionDays = this.configService.get<number>('WEBHOOK_RETENTION_DAYS', 30);
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        const result = await this.prisma.webhookDelivery.deleteMany({
          where: { status: 'FAILED', createdAt: { lt: cutoff } },
        });
        this.logger.log(`[Cleanup] Removed ${result.count} failed webhook deliveries`);
        cleaned.push(`failed_webhook_deliveries: ${result.count}`);
        break;
      }
      case 'stale_jobs': {
        this.logger.log(
          '[Cleanup] stale_jobs cleanup: BullMQ queue maintenance recommended via external tool',
        );
        cleaned.push('stale_jobs: skipped (bullmq jobs managed externally)');
        break;
      }
      case 'expired_data_exports': {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const result = await this.prisma.dataExportRequest.deleteMany({
          where: { expiresAt: { lt: cutoff }, status: 'COMPLETED' },
        });
        this.logger.log(`[Cleanup] Removed ${result.count} expired data exports`);
        cleaned.push(`expired_data_exports: ${result.count}`);
        break;
      }
      case 'expired_backups': {
        const cutoff = new Date(Date.now());
        const expired = await this.prisma.backupRecord.findMany({
          where: { expiresAt: { lt: cutoff }, status: 'COMPLETED' },
        });
        const ids = expired.map((r) => r.id);
        if (ids.length > 0) {
          await this.prisma.backupRecord.updateMany({
            where: { id: { in: ids } },
            data: { status: 'EXPIRED' },
          });
          this.logger.log(`[Cleanup] Expired ${ids.length} backup records`);
        }
        cleaned.push(`expired_backups: ${ids.length}`);
        break;
      }
      case 'stale_gift_cards': {
        const cutoff = new Date(Date.now());
        const result = await this.prisma.giftCard.updateMany({
          where: { expiresAt: { lt: cutoff }, status: 'ACTIVE' },
          data: { status: 'EXPIRED' },
        });
        if (result.count > 0) {
          this.logger.log(`[Cleanup] Expired ${result.count} gift cards`);
        }
        cleaned.push(`stale_gift_cards: ${result.count}`);
        break;
      }
      default:
        this.logger.warn(`[Cleanup] Unknown cleanup type: ${type}`);
    }

    await job.updateProgress(100);
    return { cleaned };
  }
}
