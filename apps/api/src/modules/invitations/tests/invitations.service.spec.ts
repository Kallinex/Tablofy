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
    jest.clearAllMocks();
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

    it('should create an invitation, store a redis token, and lower-case the email', async () => {
      prisma.invitation.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.invitation.create.mockResolvedValue(baseInvitation);

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
            token: expect.stringMatching(/^[a-f0-9]{64}$/),
            role: UserRole.STAFF,
            tenantId: testTenantId,
            invitedBy: testUserId,
            expiresAt: expect.any(Date),
          }),
        }),
      );
      expect(redis.setTemporaryToken).toHaveBeenCalledWith(
        expect.stringContaining('invitation:'),
        { invitationId: 'inv-1' },
        expect.any(Number),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVITATION_CREATED' }),
      );
      expect(result).toBe(baseInvitation);
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
    });

    it('should create the user, mark accepted, and delete the token', async () => {
      prisma.invitation.findFirst.mockResolvedValue(baseInvitation);
      prisma.user.findFirst.mockResolvedValue({ role: UserRole.OWNER });
      prisma.invitation.update.mockResolvedValue(baseInvitation);

      await service.accept('token', 'password', 'New', 'User');

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
      );
      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: InvitationStatus.ACCEPTED }),
        }),
      );
      expect(redis.deleteTemporaryToken).toHaveBeenCalledWith('invitation:token');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVITATION_ACCEPTED' }),
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

    it('should expire a pending invitation and delete its token', async () => {
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
