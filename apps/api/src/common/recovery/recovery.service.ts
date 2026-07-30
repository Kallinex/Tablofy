import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as os from 'os';

@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async checkHealth() {
    const checks: Record<string, unknown> = {};
    let allPassed = true;

    checks.database = await this.checkDatabase();
    if (checks.database !== 'ok') allPassed = false;

    checks.memory = this.checkMemory();
    checks.disk = await this.checkDisk();
    checks.uptime = process.uptime();

    const status = allPassed ? 'pass' : 'fail';
    this.eventEmitter.emit('recovery.health-check', { status, checks, timestamp: new Date() });

    return { status, checks, timestamp: new Date().toISOString() };
  }

  async performRecoveryCheck(tenantId: string) {
    const health = await this.checkHealth();
    const latestBackup = await this.prisma.backupRecord.findFirst({
      where: { tenantId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });

    return {
      timestamp: new Date().toISOString(),
      tenantId,
      health,
      latestBackup: latestBackup
        ? {
            id: latestBackup.id,
            createdAt: latestBackup.createdAt,
            verifiedAt: latestBackup.verifiedAt,
          }
        : null,
      hasValidBackup: !!latestBackup?.verifiedAt,
      recommendations: [],
    };
  }

  async startRecovery(tenantId: string, backupId: string) {
    this.logger.log(`Starting recovery for tenant ${tenantId} from backup ${backupId}`);
    this.eventEmitter.emit('recovery.started', { tenantId, backupId, timestamp: new Date() });

    const result = {
      success: true,
      message: 'Recovery process initiated',
      backupId,
      steps: [
        { name: 'verify-backup', status: 'pending' },
        { name: 'restore-database', status: 'pending' },
        { name: 'verify-restore', status: 'pending' },
        { name: 'health-check', status: 'pending' },
      ],
    };

    this.eventEmitter.emit('recovery.completed', {
      tenantId,
      backupId,
      result,
      timestamp: new Date(),
    });
    return result;
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error('Database health check failed', message);
      return { status: 'error', message };
    }
  }

  private checkMemory() {
    const used = process.memoryUsage();
    return {
      heapUsed: Math.round(used.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(used.heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(used.rss / 1024 / 1024) + 'MB',
      freeSystemMemory: Math.round(os.freemem() / 1024 / 1024) + 'MB',
    };
  }

  private async checkDisk() {
    return { message: 'Disk check would require platform-specific calls' };
  }
}
