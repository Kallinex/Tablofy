import { Global, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RequestHandler } from 'express';
import { BullBoardModule, BULL_BOARD_PATH } from '../bull-board.module';
import { QueueService } from '../../../modules/queues/queue.service';
import { RedisService } from '../../../redis/redis.service';
import { Queue } from '../../../test/mocks/bullmq.mock';

const queueServiceMock = {
  setQueueListener: jest.fn(),
  getQueueNames: jest.fn().mockReturnValue(['email']),
  getQueue: jest.fn((name: string) => new Queue(name)),
};

const configServiceMock = {
  get: jest.fn((key: string) => (key === 'jwt.secret' ? 'test-secret' : undefined)),
};

const redisServiceMock = {
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
};

@Global()
@Module({
  providers: [
    { provide: QueueService, useValue: queueServiceMock },
    { provide: RedisService, useValue: redisServiceMock },
    { provide: ConfigService, useValue: configServiceMock },
  ],
  exports: [QueueService, RedisService, ConfigService],
})
class BullBoardTestSupportModule {}

describe('BullBoardModule', () => {
  let module: TestingModule;
  let bullBoard: BullBoardModule;
  let jwtService: JwtService;

  const basePayload = {
    sub: 'user-1',
    email: 'owner@tablofy.com',
    role: 'OWNER',
    tenantId: null,
    jti: 'jti-1',
    iss: 'tablofy',
    aud: 'tablofy-api',
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [BullBoardModule, BullBoardTestSupportModule],
    })
      .overrideProvider(JwtService)
      .useValue(new JwtService({ secret: 'test-secret' }))
      .compile();

    bullBoard = module.get(BullBoardModule);
    jwtService = module.get(JwtService);
  });

  it('exposes the Bull Board base path', () => {
    expect(BULL_BOARD_PATH).toBe('/admin/queues');
  });

  it('provides an express router', () => {
    bullBoard.onModuleInit();
    const router = bullBoard.getRouter();
    expect(router).toBeDefined();
  });

  it('registers adapters for existing queues on init', () => {
    bullBoard.onModuleInit();
    expect(queueServiceMock.setQueueListener).toHaveBeenCalledWith(expect.any(Function));
    expect(queueServiceMock.getQueue).toHaveBeenCalledWith('email');
  });

  describe('auth middleware', () => {
    const run = async (
      middleware: RequestHandler,
      authorization: string | undefined,
    ): Promise<{ status: jest.Mock; json: jest.Mock; next: jest.Mock }> => {
      const req = { headers: { authorization } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      await middleware(req as never, res as never, next);
      return { status: res.status, json: res.json, next };
    };

    const ownToken = (role = 'OWNER', extra: Record<string, unknown> = {}) =>
      jwtService.sign({ ...basePayload, role, ...extra });

    it('returns 401 when no bearer token is present', async () => {
      const middleware = bullBoard.createAuthMiddleware();
      const { status, next } = await run(middleware, undefined);
      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for an invalid token', async () => {
      const middleware = bullBoard.createAuthMiddleware();
      const { status, next } = await run(middleware, 'Bearer not-a-real-token');
      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for a revoked token', async () => {
      redisServiceMock.isTokenBlacklisted.mockResolvedValueOnce(true);
      const middleware = bullBoard.createAuthMiddleware();
      const { status, next } = await run(middleware, `Bearer ${ownToken()}`);
      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 for a non-OWNER role', async () => {
      const middleware = bullBoard.createAuthMiddleware();
      const { status, next } = await run(middleware, `Bearer ${ownToken('MANAGER')}`);
      expect(status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('grants access to an OWNER token', async () => {
      const middleware = bullBoard.createAuthMiddleware();
      const { status, next } = await run(middleware, `Bearer ${ownToken()}`);
      expect(status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });
});
