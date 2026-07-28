import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Session } from '@prisma/client';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async findAllByUser(params: { userId: string; page?: number; limit?: number }): Promise<{
    data: Session[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { userId, page = 1, limit = 20 } = params;

    const where = { userId, expiresAt: { gt: new Date() } };

    const [data, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.session.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async revokeSession(
    sessionId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.session.delete({
      where: { id: sessionId },
    });

    await this.auditLogsService.log({
      action: 'SESSION_REVOKED',
      resource: 'Session',
      resourceId: sessionId,
      userId,
      ...meta,
    });
  }

  async revokeAllSessions(
    userId: string,
    excludeSessionId?: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<number> {
    const where = { userId, ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) };

    const count = await this.prisma.session.deleteMany({ where });

    await this.auditLogsService.log({
      action: 'SESSIONS_REVOKED_ALL',
      resource: 'Session',
      resourceId: userId,
      userId,
      ...meta,
    });

    return count.count;
  }

  async revokeExpiredSessions(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    this.logger.log(`Revoked ${result.count} expired sessions`);
    return result.count;
  }
}
