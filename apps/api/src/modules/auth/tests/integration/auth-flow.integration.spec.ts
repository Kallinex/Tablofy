import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../auth.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RedisService } from '../../../../redis/redis.service';
import { AuditLogsService } from '../../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../../test/mocks/prisma.mock';
import { createMockRedis, MockRedis } from '../../../../test/mocks/redis.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../../test/mocks/audit-log.mock';
import { buildUser } from '../../../../test/factories/user.factory';

jest.mock('bcrypt');

describe('Auth Flow — Integration', () => {
  let authService: AuthService;
  let prisma: MockPrisma;
  let jwtService: jest.Mocked<JwtService>;
  let redis: MockRedis;
  let auditLogs: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: RedisService, useValue: createMockRedis() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-access-token'),
            verify: jest.fn(),
            decode: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                'jwt.secret': 'test-secret-at-least-32-characters-long!!',
                'jwt.expiration': '15m',
                'jwt.refreshExpiration': '7d',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService) as MockPrisma;
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;
    redis = module.get(RedisService) as MockRedis;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    redis.reset();
    auditLogs.reset();
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$hashedpassword');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  describe('Register → Login flow', () => {
    it('should register a new user and login with same credentials', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(null);
      const newUser = buildUser({
        email: 'newuser@test.com',
        tenantId: null,
        role: 'STAFF',
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue(newUser) },
          tenant: { create: jest.fn() },
          subscription: { create: jest.fn() },
        };
        return cb(tx);
      });
      jwtService.sign.mockReturnValue('access-token');
      prisma.refreshToken.create.mockResolvedValue({ token: 'refresh-token' } as never);

      const registerResult = await authService.register({
        email: 'newuser@test.com',
        password: 'StrongPass123!',
        firstName: 'New',
        lastName: 'User',
      });
      expect(registerResult.user.email).toBe('newuser@test.com');
      expect(registerResult.tokens.accessToken).toBe('access-token');

      prisma.user.findFirst.mockResolvedValueOnce(newUser);
      prisma.tenant.findUnique.mockResolvedValueOnce({
        id: 'tenant-1',
        status: 'ACTIVE',
        subscription: { status: 'ACTIVE' },
      });
      prisma.user.update.mockResolvedValueOnce(newUser);
      prisma.refreshToken.create.mockResolvedValue({ token: 'new-refresh' } as never);

      const loginResult = await authService.login('newuser@test.com', 'StrongPass123!');
      expect(loginResult.user.email).toBe('newuser@test.com');
      expect(loginResult.tokens.accessToken).toBe('access-token');
      expect(auditLogs.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_LOGIN' }));
    });

    it('should reject login for unregistered user', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(null);
      await expect(authService.login('unknown@test.com', 'anypass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject login with wrong password', async () => {
      const user = buildUser({
        email: 'user@test.com',
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prisma.user.findFirst.mockResolvedValueOnce(user);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
      prisma.user.update.mockResolvedValueOnce(user);

      await expect(authService.login('user@test.com', 'wrongpass')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Refresh → Logout → Token Revocation', () => {
    it('should refresh tokens and revoke old one', async () => {
      const user = buildUser({ status: 'ACTIVE' });
      const storedToken = {
        id: 'token-1',
        token: 'valid-refresh-token',
        userId: user.id,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId,
          status: 'ACTIVE',
          emailVerified: true,
        },
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(),
      };
      prisma.refreshToken.findUnique.mockResolvedValueOnce(storedToken);
      jwtService.sign.mockReturnValue('new-access-token');
      prisma.refreshToken.create.mockResolvedValue({ token: 'new-refresh-token' } as never);

      const result = await authService.refreshTokens('valid-refresh-token');
      expect(result.accessToken).toBe('new-access-token');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'token-1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('should detect token reuse and revoke all sessions', async () => {
      const user = buildUser({ status: 'ACTIVE' });
      const revokedToken = {
        id: 'token-2',
        token: 'already-revoked',
        userId: user.id,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId,
          status: 'ACTIVE',
          emailVerified: true,
        },
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(),
      };
      prisma.refreshToken.findUnique.mockResolvedValueOnce(revokedToken);
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 2 } as never);

      await expect(authService.refreshTokens('already-revoked')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TOKEN_REUSE_DETECTED' }),
      );
    });

    it('should logout and invalidate session', async () => {
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 } as never);

      await authService.logout('user-1', 'refresh-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: 'refresh-token', userId: 'user-1', revokedAt: null },
        }),
      );
      expect(redis.deleteUserSessions).toHaveBeenCalledWith('user-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_LOGOUT' }),
      );
    });

    it('should reject refresh with invalid token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce(null);

      await expect(authService.refreshTokens('nonsense-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Password management', () => {
    it('should request password reset for existing user', async () => {
      const user = buildUser();
      prisma.user.findFirst.mockResolvedValueOnce(user);
      prisma.verificationToken?.create?.mockResolvedValueOnce({ id: 'vt-1' });

      await authService.forgotPassword(user.email);

      expect(prisma.verificationToken?.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'PASSWORD_RESET' }) }),
      );
    });

    it('should silently ignore forgot-password for non-existent user', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(null);

      await expect(authService.forgotPassword('nonexist@test.com')).resolves.not.toThrow();
    });

    it('should reset password with valid token', async () => {
      prisma.verificationToken?.findUnique?.mockResolvedValueOnce({
        id: 'vt-1',
        userId: 'user-1',
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 3600000),
        user: { id: 'user-1', tenantId: 'tenant-1' },
      });
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: { update: jest.fn().mockResolvedValue({}) },
          verificationToken: { delete: jest.fn().mockResolvedValue({}) },
          refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        };
        return cb(tx);
      });

      await authService.resetPassword('valid-token', 'NewPass123!');

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PASSWORD_RESET_COMPLETED' }),
      );
    });
  });
});
