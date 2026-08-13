import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InvitationStatus, UserRole } from '@prisma/client';
import { InvitationsService } from '../invitations.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { UsersService } from '../../users/users.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockRedis } from '../../../test/mocks/redis.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';
import * as crypto from 'crypto';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto') as typeof crypto;
  return { ...actual, randomBytes: jest.fn(actual.randomBytes) };
});

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let redis: ReturnType<typeof createMockRedis>;
  let usersService: { create: jest.Mock };

  const baseInvitation = {
    id: 'inv-1',
    email: 'new@example.com',
    token: 'a'.repeat(64),
    role: UserRole.STAFF,
    tenantId: testTenantId,
    invitedBy: testUserId,
    status: InvitationStatus.PENDING,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    usersService = { create: jest.fn().mockResolvedValue({ id: 'user-1' }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: RedisService, useValue: createMockRedis() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    redis = module.get(RedisService) as ReturnType<typeof createMockRedis>;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    redis.reset();
    jest.clearAllMocks();
    (crypto.randomBytes as jest.Mock).mockImplementation(jest.requireActual('crypto').randomBytes);
    usersService.create.mockReset();
    usersService.create.mockResolvedValue({ id: 'user-1' });
    redis.deleteTemporaryToken.mockReset();
    redis.deleteTemporaryToken.mockResolvedValue(undefined);
    prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
      fn(prisma as unknown as MockPrisma),
    );
  });

  describe('create', () => {
    it('should reject assigning a role above the inviter', async () => {
      await expect(
        service.create(
          { email: 'new@example.com', role: UserRole.OWNER } as never,
          testTenantId,
          testUserId,
          UserRole.STAFF,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.invitation.create).not.toHaveBeenCalled();
    });

    it('should reject a duplicate pending invitation', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);

      await expect(
        service.create(
          { email: 'NEW@example.com', role: UserRole.STAFF } as never,
          testTenantId,
          testUserId,
          UserRole.OWNER,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject inviting an email that already belongs to a tenant user', async () => {
      prisma.invitation.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue({ id: 'user-x' });

      await expect(
        service.create(
          { email: 'new@example.com', role: UserRole.STAFF } as never,
          testTenantId,
          testUserId,
          UserRole.OWNER,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should persist the SHA-256 hashed token and return the raw token to the inviter', async () => {
      const rawToken = '63'.repeat(32);
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      (crypto.randomBytes as jest.Mock).mockReturnValue(Buffer.alloc(32, 0x63));
      prisma.invitation.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.invitation.create.mockResolvedValue({ ...baseInvitation, token: hashedToken });

      const result = await service.create(
        { email: 'NEW@example.com', role: UserRole.STAFF } as never,
        testTenantId,
        testUserId,
        UserRole.OWNER,
      );

      expect(prisma.invitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'new@example.com',
            token: hashedToken,
            role: UserRole.STAFF,
            tenantId: testTenantId,
            invitedBy: testUserId,
            expiresAt: expect.any(Date),
          }),
        }),
      );
      expect(redis.setTemporaryToken).toHaveBeenCalledWith(
        `invitation:${hashedToken}`,
        { invitationId: 'inv-1' },
        expect.any(Number),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVITATION_CREATED' }),
      );
      expect(result.token).toBe(rawToken);
      expect(result.token).not.toBe(hashedToken);
    });

    it('should not leave a raw token in the stored row or the Redis key', async () => {
      const rawToken = '63'.repeat(32);
      (crypto.randomBytes as jest.Mock).mockReturnValue(Buffer.alloc(32, 0x63));
      prisma.invitation.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.invitation.create.mockResolvedValue(baseInvitation);

      await service.create(
        { email: 'new@example.com', role: UserRole.STAFF } as never,
        testTenantId,
        testUserId,
        UserRole.OWNER,
      );

      const createData = prisma.invitation.create.mock.calls[0][0].data as {
        token: string;
      };
      expect(createData.token).not.toBe(rawToken);
      const redisKey = redis.setTemporaryToken.mock.calls[0][0] as string;
      expect(redisKey).not.toBe(`invitation:${rawToken}`);
      expect(redisKey).toContain(createData.token);
    });
  });

  describe('findByToken', () => {
    it('should throw NotFoundException for an unknown token', async () => {
      prisma.invitation.findFirst.mockResolvedValue(null);

      await expect(service.findByToken('nope')).rejects.toThrow(NotFoundException);
    });

    it('should mark and reject an expired invitation', async () => {
      prisma.invitation.findFirst.mockResolvedValue({
        ...baseInvitation,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.findByToken('expired')).rejects.toThrow('has expired');

      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({ status: InvitationStatus.EXPIRED }),
        }),
      );
    });

    it('should return a valid pending invitation', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);

      await expect(service.findByToken(baseInvitation.token)).resolves.toEqual(baseInvitation);
    });

    it('should look up the invitation by the hashed token, never the raw token', async () => {
      const rawToken = 'raw-incoming-token';
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);

      await service.findByToken(rawToken);

      const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      expect(prisma.invitation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            token: expectedHash,
            status: InvitationStatus.PENDING,
          }),
        }),
      );
      expect(
        (prisma.invitation.findFirst.mock.calls[0][0] as { where: { token: string } }).where.token,
      ).not.toBe(rawToken);
    });
  });

  describe('accept', () => {
    it('should throw ForbiddenException when the inviter role cannot assign the invite role', async () => {
      prisma.invitation.findFirst.mockResolvedValue({
        ...baseInvitation,
        role: UserRole.OWNER,
      });
      prisma.user.findFirst.mockResolvedValue({ role: UserRole.STAFF });

      await expect(service.accept('token', 'password', 'New', 'User')).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersService.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should claim the invitation via a status CAS inside a transaction, create the user, clean Redis, and audit', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);
      prisma.user.findFirst.mockResolvedValue({ role: UserRole.OWNER });
      prisma.invitation.updateMany.mockResolvedValue({ count: 1 });

      await service.accept('token', 'password', 'New', 'User');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.invitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1', status: InvitationStatus.PENDING },
          data: expect.objectContaining({
            status: InvitationStatus.ACCEPTED,
            acceptedAt: expect.any(Date),
          }),
        }),
      );
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          password: 'password',
          firstName: 'New',
          lastName: 'User',
          role: UserRole.STAFF,
        }),
        testUserId,
        testTenantId,
        UserRole.OWNER,
        undefined,
        expect.anything(),
      );
      expect(redis.deleteTemporaryToken).toHaveBeenCalledWith(`invitation:${baseInvitation.token}`);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVITATION_ACCEPTED', resourceId: 'inv-1' }),
      );
    });

    it('should reject a duplicate acceptance when the status CAS claims zero rows', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);
      prisma.user.findFirst.mockResolvedValue({ role: UserRole.OWNER });
      prisma.invitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.accept('token', 'password', 'New', 'User')).rejects.toThrow(
        ConflictException,
      );
      expect(usersService.create).not.toHaveBeenCalled();
      expect(redis.deleteTemporaryToken).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('should propagate a duplicate-email Conflict from user creation with no post-transaction side effects', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);
      prisma.user.findFirst.mockResolvedValue({ role: UserRole.OWNER });
      prisma.invitation.updateMany.mockResolvedValue({ count: 1 });
      usersService.create.mockRejectedValue(
        new ConflictException('A user with this email already exists'),
      );

      await expect(service.accept('token', 'password', 'New', 'User')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.invitation.updateMany).toHaveBeenCalledTimes(1);
      expect(redis.deleteTemporaryToken).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('should allow exactly one of two concurrent accepts to succeed (atomic claim)', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);
      prisma.user.findFirst.mockResolvedValue({ role: UserRole.OWNER });
      const release: Array<() => void> = [];
      const barrier = new Promise<void>((resolve) => {
        release.push(resolve);
        release.push(resolve);
      });
      let claims = 0;
      prisma.invitation.updateMany.mockImplementation(async () => {
        await barrier;
        claims += 1;
        return { count: claims === 1 ? 1 : 0 };
      });

      const first = service.accept('token', 'password', 'New', 'User');
      const second = service.accept('token', 'password', 'New', 'User');
      release.forEach((r) => r());

      const [r1, r2] = await Promise.allSettled([first, second]);
      const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled').length;
      const conflicted = [r1, r2].filter(
        (r) => r.status === 'rejected' && (r.reason as Error) instanceof ConflictException,
      ).length;

      expect(fulfilled).toBe(1);
      expect(conflicted).toBe(1);
      expect(usersService.create).toHaveBeenCalledTimes(1);
    });

    it('should not report a failure when best-effort Redis cleanup fails after commit', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);
      prisma.user.findFirst.mockResolvedValue({ role: UserRole.OWNER });
      prisma.invitation.updateMany.mockResolvedValue({ count: 1 });
      redis.deleteTemporaryToken.mockRejectedValue(new Error('redis down'));

      await expect(service.accept('token', 'password', 'New', 'User')).resolves.toBeUndefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVITATION_ACCEPTED' }),
      );
    });

    it('should not include the invitation token in the acceptance audit event', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);
      prisma.user.findFirst.mockResolvedValue({ role: UserRole.OWNER });
      prisma.invitation.updateMany.mockResolvedValue({ count: 1 });

      await service.accept('token', 'password', 'New', 'User');

      const auditCall = auditLogs.log.mock.calls[0][0] as Record<string, unknown>;
      expect(auditCall.action).toBe('INVITATION_ACCEPTED');
      expect(auditCall.token).toBeUndefined();
      expect(JSON.stringify(auditCall)).not.toContain(baseInvitation.token);
    });
  });

  describe('reject', () => {
    it('should mark rejected and remove the hashed Redis token (never the raw token)', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);

      await service.reject('raw-token', testUserId, testTenantId);

      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({ status: InvitationStatus.REJECTED }),
        }),
      );
      expect(redis.deleteTemporaryToken).toHaveBeenCalledWith(`invitation:${baseInvitation.token}`);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVITATION_REJECTED' }),
      );
    });
  });

  describe('revoke and revokeExpired', () => {
    it('should reject revoking a non-pending invitation', async () => {
      prisma.invitation.findFirst.mockResolvedValue({
        ...baseInvitation,
        status: InvitationStatus.ACCEPTED,
      });

      await expect(service.revoke('inv-1', testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should expire a pending invitation and delete its hashed token', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);

      await service.revoke('inv-1', testTenantId, testUserId);

      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: InvitationStatus.EXPIRED }),
        }),
      );
      expect(redis.deleteTemporaryToken).toHaveBeenCalledWith(`invitation:${baseInvitation.token}`);
    });

    it('should bulk-expire overdue pending invitations', async () => {
      prisma.invitation.updateMany.mockResolvedValue({ count: 3 });

      const count = await service.revokeExpired();

      expect(count).toBe(3);
      expect(prisma.invitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: InvitationStatus.PENDING,
            expiresAt: { lt: expect.any(Date) },
          }),
        }),
      );
    });
  });
});
