import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionsService } from '../sessions.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testUserId } from '../../../test/fixtures/auth.fixture';

describe('SessionsService', () => {
  let service: SessionsService;
  let prisma: MockPrisma;
  let redis: {
    getUserSessionIds: jest.Mock;
    getSession: jest.Mock;
    deleteSession: jest.Mock;
    removeUserSession: jest.Mock;
    blacklistToken: jest.Mock;
    getClient: jest.Mock;
  };
  let auditLogs: MockAuditLogs;

  beforeAll(async () => {
    redis = {
      getUserSessionIds: jest.fn().mockResolvedValue([]),
      getSession: jest.fn().mockResolvedValue(null),
      deleteSession: jest.fn().mockResolvedValue(undefined),
      removeUserSession: jest.fn().mockResolvedValue(undefined),
      blacklistToken: jest.fn().mockResolvedValue(undefined),
      getClient: jest.fn().mockResolvedValue({ pttl: jest.fn().mockResolvedValue(600000) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: RedisService, useValue: redis },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    redis.getUserSessionIds.mockClear().mockResolvedValue([]);
    redis.getSession.mockClear().mockResolvedValue(null);
    redis.deleteSession.mockClear().mockResolvedValue(undefined);
    redis.removeUserSession.mockClear().mockResolvedValue(undefined);
    redis.blacklistToken.mockClear().mockResolvedValue(undefined);
    redis.getClient.mockClear().mockResolvedValue({ pttl: jest.fn().mockResolvedValue(600000) });
  });

  describe('findAllByUser', () => {
    it('should return paginated sessions from redis sorted by most recent', async () => {
      redis.getUserSessionIds.mockResolvedValue(['sess-old', 'sess-new']);
      redis.getSession
        .mockResolvedValueOnce({
          userId: testUserId,
          accessTokenJti: 'jti-1',
          createdAt: '2026-01-01T00:00:00.000Z',
        })
        .mockResolvedValueOnce({
          userId: testUserId,
          accessTokenJti: 'jti-2',
          createdAt: '2026-01-02T00:00:00.000Z',
        });

      const result = await service.findAllByUser({ userId: testUserId });

      expect(result.meta.total).toBe(2);
      expect(result.data[0].id).toBe('sess-new');
      expect(result.data[1].id).toBe('sess-old');
      expect(redis.getUserSessionIds).toHaveBeenCalledWith(testUserId);
    });

    it('should skip session ids with no stored payload', async () => {
      redis.getUserSessionIds.mockResolvedValue(['sess-1', 'sess-2']);
      redis.getSession.mockResolvedValue(null);

      const result = await service.findAllByUser({ userId: testUserId });

      expect(result.meta.total).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('should paginate results', async () => {
      redis.getUserSessionIds.mockResolvedValue(['sess-1', 'sess-2', 'sess-3']);
      redis.getSession.mockResolvedValue({
        userId: testUserId,
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await service.findAllByUser({ userId: testUserId, page: 2, limit: 2 });

      expect(result.data.length).toBe(1);
      expect(result.meta.totalPages).toBe(2);
    });
  });

  describe('revokeSession', () => {
    const meta = { ipAddress: '127.0.0.1', userAgent: 'test-agent' };

    it('should blacklist the access token jti and delete the redis session', async () => {
      redis.getSession.mockResolvedValue({ userId: testUserId, accessTokenJti: 'jti-abc' });

      await service.revokeSession('sess-1', testUserId, meta);

      expect(redis.blacklistToken).toHaveBeenCalledWith('jti-abc', expect.any(Number));
      expect(redis.deleteSession).toHaveBeenCalledWith('sess-1');
      expect(redis.removeUserSession).toHaveBeenCalledWith(testUserId, 'sess-1');
      expect(prisma.session.delete).not.toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SESSION_REVOKED', resourceId: 'sess-1', ...meta }),
      );
    });

    it('should fall back to the database session when not present in redis', async () => {
      redis.getSession.mockResolvedValue(null);
      prisma.session.findFirst.mockResolvedValue({ id: 'sess-1', userId: testUserId });

      await service.revokeSession('sess-1', testUserId, meta);

      expect(prisma.session.delete).toHaveBeenCalledWith({ where: { id: 'sess-1' } });
      expect(redis.blacklistToken).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the session belongs to another user', async () => {
      redis.getSession.mockResolvedValue({ userId: 'someone-else', accessTokenJti: 'jti-x' });
      prisma.session.findFirst.mockResolvedValue(null);

      await expect(service.revokeSession('sess-1', testUserId, meta)).rejects.toThrow(
        NotFoundException,
      );

      expect(redis.deleteSession).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when no session exists anywhere', async () => {
      redis.getSession.mockResolvedValue(null);
      prisma.session.findFirst.mockResolvedValue(null);

      await expect(service.revokeSession('missing', testUserId, meta)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('revokeAllSessions', () => {
    it('should revoke every session for the user and delete db rows when nothing is excluded', async () => {
      redis.getUserSessionIds.mockResolvedValue(['sess-1', 'sess-2']);
      redis.getSession.mockResolvedValue({ userId: testUserId, accessTokenJti: 'jti-1' });
      prisma.session.deleteMany.mockResolvedValue({ count: 1 });

      const count = await service.revokeAllSessions(testUserId);

      expect(count).toBe(3);
      expect(redis.blacklistToken).toHaveBeenCalledTimes(2);
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: testUserId } });
    });

    it('should skip the excluded session id', async () => {
      redis.getUserSessionIds.mockResolvedValue(['sess-1', 'sess-2']);
      redis.getSession.mockResolvedValue({ userId: testUserId, accessTokenJti: 'jti-1' });
      prisma.session.deleteMany.mockResolvedValue({ count: 0 });

      const count = await service.revokeAllSessions(testUserId, 'sess-1');

      expect(count).toBe(1);
      expect(redis.deleteSession).toHaveBeenCalledWith('sess-2');
      expect(redis.deleteSession).not.toHaveBeenCalledWith('sess-1');
      expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('revokeExpiredSessions', () => {
    it('should delete expired db session rows', async () => {
      prisma.session.deleteMany.mockResolvedValue({ count: 4 });

      const count = await service.revokeExpiredSessions();

      expect(count).toBe(4);
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });
  });
});
