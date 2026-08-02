import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RequestHandler } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { QueueService } from '../../modules/queues/queue.service';
import { RedisService } from '../../redis/redis.service';
import { JwtPayload } from '../../modules/auth/strategies/jwt.strategy';

export const BULL_BOARD_PATH = '/admin/queues';
const JWT_ISSUER = 'tablofy';
const JWT_AUDIENCE = 'tablofy-api';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Record<string, unknown> => ({
        secret: configService.get<string>('jwt.secret'),
      }),
    }),
  ],
})
export class BullBoardModule implements OnModuleInit {
  private readonly logger = new Logger(BullBoardModule.name);
  private board?: ReturnType<typeof createBullBoard>;
  private adapter?: ExpressAdapter;

  constructor(
    private readonly queueService: QueueService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit(): void {
    this.adapter = new ExpressAdapter();
    this.adapter.setBasePath(BULL_BOARD_PATH);
    this.board = createBullBoard({
      queues: [],
      serverAdapter: this.adapter,
    });

    this.queueService.setQueueListener((queue: Queue) => {
      this.board?.addQueue(new BullMQAdapter(queue));
    });

    for (const name of this.queueService.getQueueNames()) {
      this.board.addQueue(new BullMQAdapter(this.queueService.getQueue(name)));
    }

    this.logger.log('Bull Board initialized');
  }

  getRouter(): ReturnType<ExpressAdapter['getRouter']> {
    if (!this.board || !this.adapter) {
      throw new Error('Bull Board not initialized');
    }
    return this.adapter.getRouter();
  }

  createAuthMiddleware(): RequestHandler {
    const secret = this.configService.get<string>('jwt.secret');
    if (!secret) {
      throw new Error('JWT_SECRET is not configured for Bull Board auth');
    }

    return async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.status(401).json({ statusCode: 401, message: 'Missing bearer token' });
          return;
        }

        let payload: JwtPayload;
        try {
          payload = await this.jwtService.verifyAsync<JwtPayload>(token(authHeader), {
            secret,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
          });
        } catch {
          res.status(401).json({ statusCode: 401, message: 'Invalid or expired token' });
          return;
        }

        if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) {
          res.status(401).json({ statusCode: 401, message: 'Invalid token claims' });
          return;
        }

        if (await this.redisService.isTokenBlacklisted(payload.jti)) {
          res.status(401).json({ statusCode: 401, message: 'Token has been revoked' });
          return;
        }

        if (payload.role !== 'OWNER') {
          res.status(403).json({ statusCode: 403, message: 'Forbidden resource' });
          return;
        }

        this.logger.log(`Bull Board access granted to ${payload.email} (${payload.role})`);
        next();
      } catch (error) {
        this.logger.error(
          'Bull Board auth middleware error',
          error instanceof Error ? error.stack : String(error),
        );
        res.status(401).json({ statusCode: 401, message: 'Authentication failed' });
      }
    };
  }
}

function token(authHeader: string): string {
  return authHeader.slice(7);
}
