import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CurrentUserData } from '../decorators/current-user.decorator';
import {
  DEFAULT_API_KEY_LIMIT,
  DEFAULT_API_KEY_WINDOW_SECONDS,
  DEFAULT_PLAN_RATE_LIMITS,
  DEFAULT_PLAN_WINDOW_SECONDS,
  DEFAULT_UNAUTHENTICATED_LIMIT,
} from '../../config/throttle.config';

const UNAUTHENTICATED_PLAN = 'FREE';

export const PLAN_THROTTLE_KEY = 'planThrottle';
/** Marks a handler (or an entire controller) as exempt from plan-based throttling. */
export const SkipPlanThrottle = (): PropertyDecorator & MethodDecorator =>
  SetMetadata(PLAN_THROTTLE_KEY, true);

function rateLimited(retryAfter: number): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Requests carrying `Authorization: ApiKey <key>` are bucketed per key so one
 * noisy integration cannot exhaust the tenant budget and a shared egress IP
 * cannot pool unrelated tenants. The raw key is never used in the Redis key or
 * the logs - only a truncated SHA-256 digest.
 */
export function apiKeyBucketId(headers: Record<string, unknown> | undefined): string | null {
  const header = headers?.['authorization'];
  if (typeof header !== 'string') {
    return null;
  }
  const [scheme, credentials] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'apikey') {
    return null;
  }
  const rawKey = credentials?.trim();
  if (!rawKey) {
    return null;
  }
  return createHash('sha256').update(rawKey).digest('hex').slice(0, 32);
}

@Injectable()
export class PlanThrottleGuard implements CanActivate {
  private readonly logger = new Logger(PlanThrottleGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipped = this.reflector.getAllAndOverride<boolean>(PLAN_THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipped) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as CurrentUserData | undefined;

    let windowSeconds = this.unauthenticatedWindowSeconds();
    let limit = this.unauthenticatedLimit();
    let keyPrefix = `ratelimit:ip:${request.ip}`;

    if (user?.tenantId) {
      const subscription = await this.prisma.subscription.findUnique({
        where: { tenantId: user.tenantId },
        select: { plan: true },
      });

      const plan = subscription?.plan ?? UNAUTHENTICATED_PLAN;
      const planLimits = this.configService.get<Record<string, number>>(
        'throttle.planLimits',
        DEFAULT_PLAN_RATE_LIMITS as Record<string, number>,
      );
      windowSeconds = this.planWindowSeconds();
      limit = planLimits[plan] ?? planLimits[UNAUTHENTICATED_PLAN] ?? DEFAULT_PLAN_RATE_LIMITS.FREE;
      keyPrefix = `ratelimit:tenant:${user.tenantId}`;
    }

    // A single API key gets its own budget on top of the tenant bucket, so an
    // abusive integration is throttled without starving the tenant's other keys.
    const bucketId = apiKeyBucketId(request.headers);
    if (bucketId !== null && this.apiKeyEnabled()) {
      const apiKeyWindow = this.apiKeyWindowSeconds();
      const apiKeyLimit = this.apiKeyLimit();
      const apiKeyCounter = await this.redisService.incrementCounter(
        `ratelimit:apikey:${bucketId}:${request.url}`,
        apiKeyWindow,
      );

      if (apiKeyCounter > apiKeyLimit) {
        this.logger.warn(
          `API key rate limit exceeded: ${apiKeyCounter}/${apiKeyLimit} on ${request.url}`,
        );
        throw rateLimited(apiKeyWindow);
      }
    }

    const redisKey = `${keyPrefix}:${request.url}`;
    const current = await this.redisService.incrementCounter(redisKey, windowSeconds);

    if (current > limit) {
      this.logger.warn(`Rate limit exceeded: ${keyPrefix} ${current}/${limit} on ${request.url}`);
      throw rateLimited(windowSeconds);
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

  private planWindowSeconds(): number {
    return this.configService.get<number>(
      'throttle.planWindowSeconds',
      DEFAULT_PLAN_WINDOW_SECONDS,
    );
  }

  private unauthenticatedLimit(): number {
    return this.configService.get<number>(
      'throttle.unauthenticatedLimit',
      DEFAULT_UNAUTHENTICATED_LIMIT,
    );
  }

  private unauthenticatedWindowSeconds(): number {
    return this.planWindowSeconds();
  }

  private apiKeyEnabled(): boolean {
    return this.configService.get<boolean>('throttle.apiKeyEnabled', true);
  }

  private apiKeyLimit(): number {
    return this.configService.get<number>('throttle.apiKeyLimit', DEFAULT_API_KEY_LIMIT);
  }

  private apiKeyWindowSeconds(): number {
    return this.configService.get<number>(
      'throttle.apiKeyWindowSeconds',
      DEFAULT_API_KEY_WINDOW_SECONDS,
    );
  }
}
