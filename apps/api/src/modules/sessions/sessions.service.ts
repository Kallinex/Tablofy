import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

interface SessionView {
  id: string;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastActiveAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async findAllByUser(params: { userId: string; page?: number; limit?: number }): Promise<{
    data: SessionView[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { userId, page = 1, limit = 20 } = params;

    const sessionIds = await this.redisService.getUserSessionIds(userId);
    const sessions: SessionView[] = [];
    for (const sessionId of sessionIds) {
      const data = await this.redisService.getSession(sessionId);
      if (!data) continue;
      sessions.push(this.toSessionView(sessionId, data));
    }
    sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = sessions.length;
    const start = (page - 1) * limit;
    const data = sessions.slice(start, start + limit);

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
    const session = await this.redisService.getSession(sessionId);
    if (session && session.userId === userId) {
      await this.revokeRedisSession(sessionId, userId, session);
    } else {
      const dbSession = await this.prisma.session.findFirst({
        where: { id: sessionId, userId },
      });
      if (!dbSession) {
        throw new NotFoundException('Session not found');
      }
      await this.prisma.session.delete({
        where: { id: sessionId },
      });
    }

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
    const sessionIds = await this.redisService.getUserSessionIds(userId);
    let count = 0;
    for (const sessionId of sessionIds) {
      if (excludeSessionId && sessionId === excludeSessionId) continue;
      const session = await this.redisService.getSession(sessionId);
      if (session && session.userId === userId) {
        await this.revokeRedisSession(sessionId, userId, session);
        count += 1;
      }
    }

    if (!excludeSessionId) {
      const dbResult = await this.prisma.session.deleteMany({ where: { userId } });
      count += dbResult.count;
    }

    await this.auditLogsService.log({
      action: 'SESSIONS_REVOKED_ALL',
      resource: 'Session',
      resourceId: userId,
      userId,
      ...meta,
    });

    return count;
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

  private async revokeRedisSession(
    sessionId: string,
    userId: string,
    session: Record<string, unknown>,
  ): Promise<void> {
    const jti = session.accessTokenJti as string | undefined;
    if (jti) {
      const ttlSeconds = await this.remainingSessionTtlSeconds(sessionId);
      await this.redisService.blacklistToken(jti, ttlSeconds);
    }
    await this.redisService.deleteSession(sessionId);
    await this.redisService.removeUserSession(userId, sessionId);
  }

  private async remainingSessionTtlSeconds(sessionId: string): Promise<number> {
    try {
      const client = await this.redisService.getClient();
      const ms = await client.pttl(`session:${sessionId}`);
      return ms > 0 ? Math.ceil(ms / 1000) : 900;
    } catch {
      return 900;
    }
  }

  private toSessionView(sessionId: string, data: Record<string, unknown>): SessionView {
    const createdAt = data.createdAt ? new Date(data.createdAt as string) : new Date();
    return {
      id: sessionId,
      userId: (data.userId as string) ?? '',
      userAgent: (data.userAgent as string) ?? null,
      ipAddress: (data.ipAddress as string) ?? null,
      lastActiveAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    };
  }
}
