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
      default:
        this.logger.warn(`[Cleanup] Unknown cleanup type: ${type}`);
    }

    await job.updateProgress(100);
    return { cleaned };
  }
}
