import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy, JwtPayload } from '../strategies/jwt.strategy';
import { RedisService } from '../../../redis/redis.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockRedis, MockRedis } from '../../../test/mocks/redis.mock';
import { buildUser } from '../../../test/factories/user.factory';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: MockPrisma;
  let redis: MockRedis;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: RedisService, useValue: createMockRedis() },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'jwt.secret') return 'test-secret-at-least-32-characters-long!!';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    prisma = module.get(PrismaService) as MockPrisma;
    redis = module.get(RedisService) as MockRedis;
  });

  beforeEach(() => {
    prisma.reset();
    redis.reset();
  });

  const validPayload: JwtPayload = {
    sub: 'user-1',
    email: 'test@test.com',
    role: 'OWNER' as never,
    tenantId: 'tenant-1',
    jti: 'jti-1',
    iss: 'tablofy',
    aud: 'tablofy-api',
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 900,
  };

  it('should validate a valid token payload', async () => {
    redis.isTokenBlacklisted.mockResolvedValue(false);
    const fakeUser = buildUser();
    prisma.user.findUnique.mockResolvedValue(fakeUser);

    const result = await strategy.validate(validPayload);

    expect(result.id).toBe(fakeUser.id);
    expect(result.role).toBe(fakeUser.role);
  });

  it('should throw for blacklisted token', async () => {
    redis.isTokenBlacklisted.mockResolvedValue(true);

    await expect(strategy.validate(validPayload)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw for missing user', async () => {
    redis.isTokenBlacklisted.mockResolvedValue(false);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(strategy.validate(validPayload)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw for inactive user', async () => {
    redis.isTokenBlacklisted.mockResolvedValue(false);
    const inactiveUser = buildUser();
    Object.defineProperty(inactiveUser, 'status', { value: 'SUSPENDED', writable: true });
    prisma.user.findUnique.mockResolvedValue(inactiveUser as never);

    await expect(strategy.validate(validPayload)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw for invalid issuer', async () => {
    const badPayload = { ...validPayload, iss: 'hacker' };

    await expect(strategy.validate(badPayload)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw for invalid audience', async () => {
    const badPayload = { ...validPayload, aud: 'evil-app' };

    await expect(strategy.validate(badPayload)).rejects.toThrow(UnauthorizedException);
  });
});
