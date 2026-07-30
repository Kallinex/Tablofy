import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockRedis, MockRedis } from '../../../test/mocks/redis.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { buildUser, buildAuthUser } from '../../../test/factories/user.factory';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
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

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService) as MockPrisma;
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;
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

  describe('register', () => {
    const registerDto = {
      email: 'new@test.com',
      password: 'StrongPass123!',
      firstName: 'New',
      lastName: 'User',
      tenantName: 'My Restaurant',
    };

    it('should register a new user without tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const fakeUser = buildUser({ email: registerDto.email, tenantId: null, role: 'STAFF' });
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue(fakeUser) },
          tenant: { create: jest.fn() },
          subscription: { create: jest.fn() },
        };
        return cb(tx);
      });
      jwtService.sign.mockReturnValue('mock-token');
      prisma.refreshToken.create.mockResolvedValue({ token: 'mock-refresh-token' } as never);

      const result = await service.register({
        email: registerDto.email,
        password: registerDto.password,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
      });

      expect(result.user.email).toBe(registerDto.email);
      expect(result.tokens.accessToken).toBe('mock-token');
      expect(result.alreadyExists).toBe(false);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_REGISTERED' }),
      );
    });

    it('should return alreadyExists for existing user', async () => {
      const existingUser = buildUser();
      prisma.user.findFirst.mockResolvedValue(existingUser);

      const result = await service.register(registerDto);

      expect(result.alreadyExists).toBe(true);
      expect(result.tokens.accessToken).toBe('');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create tenant and subscription when tenantName provided', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const fakeUser = buildUser({ email: registerDto.email });
      let tenantCreated = false;
      let subscriptionCreated = false;

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          tenant: {
            create: jest.fn().mockImplementation(() => {
              tenantCreated = true;
              return Promise.resolve({ id: 'new-tenant-1' });
            }),
          },
          subscription: {
            create: jest.fn().mockImplementation(() => {
              subscriptionCreated = true;
              return Promise.resolve({ id: 'sub-1' });
            }),
          },
          user: { create: jest.fn().mockResolvedValue(fakeUser) },
        };
        return cb(tx);
      });
      jwtService.sign.mockReturnValue('mock-token');
      prisma.refreshToken.create.mockResolvedValue({ token: 'mock-refresh' } as never);

      await service.register(registerDto);

      expect(tenantCreated).toBe(true);
      expect(subscriptionCreated).toBe(true);
    });
  });

  describe('login', () => {
    const loginEmail = 'user@test.com';
    const loginPassword = 'CorrectPass123!';

    it('should login successfully with valid credentials', async () => {
      const fakeUser = buildUser({
        email: loginEmail,
        password: 'hashed-password',
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prisma.user.findFirst.mockResolvedValue(fakeUser);
      jwtService.sign.mockReturnValue('mock-token');
      prisma.refreshToken.create.mockResolvedValue({ token: 'mock-refresh' } as never);
      prisma.user.update.mockResolvedValue(fakeUser);

      const result = await service.login(loginEmail, loginPassword);

      expect(result.user.email).toBe(loginEmail);
      expect(result.tokens.accessToken).toBe('mock-token');
      expect(auditLogs.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_LOGIN' }));
    });

    it('should throw UnauthorizedException when user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login('nonexist@test.com', 'pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when account is inactive', async () => {
      const fakeUser = buildUser({ email: loginEmail, status: 'SUSPENDED' });
      prisma.user.findFirst.mockResolvedValue(fakeUser);

      await expect(service.login(loginEmail, loginPassword)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when account is locked', async () => {
      const fakeUser = buildUser({
        email: loginEmail,
        status: 'ACTIVE',
        lockedUntil: new Date(Date.now() + 3600000),
      });
      prisma.user.findFirst.mockResolvedValue(fakeUser);

      await expect(service.login(loginEmail, loginPassword)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException on wrong password', async () => {
      const fakeUser = buildUser({
        email: loginEmail,
        password: 'hashed-password',
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prisma.user.findFirst.mockResolvedValue(fakeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginEmail, loginPassword)).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failedLoginAttempts: 1 }),
        }),
      );
    });

    it('should lock account after MAX_FAILED_LOGIN_ATTEMPTS', async () => {
      const fakeUser = buildUser({
        email: loginEmail,
        password: 'hashed-password',
        status: 'ACTIVE',
        failedLoginAttempts: 4,
        lockedUntil: null,
      });
      prisma.user.findFirst.mockResolvedValue(fakeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginEmail, loginPassword)).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
        }),
      );
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens successfully', async () => {
      const fakeUser = buildUser({ status: 'ACTIVE' });
      const storedToken = {
        id: 'token-1',
        token: 'valid-refresh-token',
        userId: fakeUser.id,
        user: fakeUser,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(),
      };
      prisma.refreshToken.findUnique.mockResolvedValue(storedToken);
      jwtService.sign.mockReturnValue('new-access-token');
      prisma.refreshToken.create.mockResolvedValue({ token: 'new-refresh-token' } as never);

      const result = await service.refreshTokens('valid-refresh-token');

      expect(result.accessToken).toBe('new-access-token');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'token-1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('should throw on invalid refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens('invalid-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on revoked token', async () => {
      const storedToken = {
        id: 'token-1',
        token: 'revoked-token',
        userId: 'user-1',
        user: buildUser({ status: 'ACTIVE' }),
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(),
      };
      prisma.refreshToken.findUnique.mockResolvedValue(storedToken);

      await expect(service.refreshTokens('revoked-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should revoke refresh token and clear sessions', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 } as never);

      await service.logout('user-1', 'refresh-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(redis.deleteUserSessions).toHaveBeenCalledWith('user-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_LOGOUT' }),
      );
    });
  });

  describe('logoutAllDevices', () => {
    it('should revoke all tokens and clear all sessions', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 } as never);

      await service.logoutAllDevices('user-1');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(redis.deleteUserSessions).toHaveBeenCalledWith('user-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_LOGOUT_ALL_DEVICES' }),
      );
    });
  });

  describe('forgotPassword', () => {
    it('should create verification token for existing user', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      prisma.verificationToken?.create?.mockResolvedValue({ id: 'token-1' });

      await service.forgotPassword('user@test.com');

      expect(prisma.verificationToken?.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'PASSWORD_RESET' }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PASSWORD_RESET_REQUESTED' }),
      );
    });

    it('should silently return for non-existent user', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.forgotPassword('nonexist@test.com')).resolves.not.toThrow();
      expect(prisma.verificationToken?.create).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should reset password with valid token', async () => {
      prisma.verificationToken?.findUnique?.mockResolvedValue({
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

      await service.resetPassword('valid-token', 'NewPass123!');

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PASSWORD_RESET_COMPLETED' }),
      );
    });

    it('should throw on invalid token', async () => {
      prisma.verificationToken?.findUnique?.mockResolvedValue(null);

      await expect(service.resetPassword('bad-token', 'NewPass123!')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('changePassword', () => {
    it('should change password with valid current password', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ password: 'hashed-current' }) as never);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: { update: jest.fn().mockResolvedValue({}) },
          refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        };
        return cb(tx);
      });

      await service.changePassword('user-1', 'current-pass', 'new-pass');

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PASSWORD_CHANGED' }),
      );
    });

    it('should throw on wrong current password', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ password: 'hashed-current' }) as never);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.changePassword('user-1', 'wrong-pass', 'new-pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('verifyEmail', () => {
    it('should verify email with valid token', async () => {
      prisma.verificationToken?.findUnique?.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        type: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + 3600000),
        user: { id: 'user-1', tenantId: 'tenant-1' },
      });
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          user: { update: jest.fn().mockResolvedValue({}) },
          verificationToken: { delete: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      await service.verifyEmail('valid-token');

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMAIL_VERIFIED' }),
      );
    });

    it('should throw on expired token', async () => {
      prisma.verificationToken?.findUnique?.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        type: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() - 3600000),
        user: { id: 'user-1', tenantId: 'tenant-1' },
      });

      await expect(service.verifyEmail('expired-token')).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateUserById', () => {
    it('should return user when found', async () => {
      const fakeUser = buildAuthUser();
      prisma.user.findUnique.mockResolvedValue(fakeUser);

      const result = await service.validateUserById('user-1');

      expect(result).toEqual(fakeUser);
    });

    it('should return null when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUserById('nonexist');

      expect(result).toBeNull();
    });
  });
});
