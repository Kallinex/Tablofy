import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CurrentUserData } from '../decorators/current-user.decorator';

const PLAN_RATE_LIMITS: Record<string, { requests: number; windowSeconds: number }> = {
  FREE: { requests: 30, windowSeconds: 60 },
  BASIC: { requests: 60, windowSeconds: 60 },
  STANDARD: { requests: 120, windowSeconds: 60 },
  PREMIUM: { requests: 300, windowSeconds: 60 },
  ENTERPRISE: { requests: 1000, windowSeconds: 60 },
};

const UNAUTHENTICATED_LIMIT = 20;
const UNAUTHENTICATED_WINDOW_SECONDS = 60;

export const PLAN_THROTTLE_KEY = 'planThrottle';
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {};
export const SkipPlanThrottle = (): PropertyDecorator & MethodDecorator =>
  noop as unknown as PropertyDecorator & MethodDecorator;

@Injectable()
export class PlanThrottleGuard implements CanActivate {
  private readonly logger = new Logger(PlanThrottleGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as CurrentUserData | undefined;

    let windowSeconds = UNAUTHENTICATED_WINDOW_SECONDS;
    let limit = UNAUTHENTICATED_LIMIT;
    let keyPrefix = `ratelimit:ip:${request.ip}`;

    if (user?.tenantId) {
      const subscription = await this.prisma.subscription.findUnique({
        where: { tenantId: user.tenantId },
        select: { plan: true },
      });

      const plan = subscription?.plan ?? 'FREE';
      const planLimits = PLAN_RATE_LIMITS[plan] ?? PLAN_RATE_LIMITS.FREE;
      windowSeconds = planLimits.windowSeconds;
      limit = planLimits.requests;
      keyPrefix = `ratelimit:tenant:${user.tenantId}`;
    }

    const redisKey = `${keyPrefix}:${request.url}`;
    const current = await this.redisService.incrementCounter(redisKey, windowSeconds);

    if (current > limit) {
      const retryAfter = windowSeconds;
      this.logger.warn(`Rate limit exceeded: ${keyPrefix} ${current}/${limit} on ${request.url}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit', limit.toString());
    response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current).toString());
    response.setHeader(
      'X-RateLimit-Reset',
      (Math.ceil(Date.now() / 1000) + windowSeconds).toString(),
    );

    return true;
  }
}
