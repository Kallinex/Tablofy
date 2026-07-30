import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import * as crypto from 'crypto';

@Injectable()
export class WebhookDeliveryService {
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly backoffFactor: number;
  private readonly maxBackoffMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.maxRetries = this.configService.get('webhook.maxRetries', 5);
    this.initialBackoffMs = this.configService.get('webhook.initialBackoffMs', 1000);
    this.backoffFactor = this.configService.get('webhook.backoffFactor', 2);
    this.maxBackoffMs = this.configService.get('webhook.maxBackoffMs', 3600000);
    this.logger.setContext('WebhookDelivery');
  }

  generateSecret(): { secret: string; hash: string; prefix: string } {
    const secret = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHmac('sha256', secret).digest('hex');
    const prefix = secret.substring(0, 8);
    return { secret, hash, prefix };
  }

  signPayload(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = this.signPayload(payload, secret);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  calculateBackoff(attempt: number): number {
    const delay = this.initialBackoffMs * Math.pow(this.backoffFactor, attempt - 1);
    return Math.min(delay, this.maxBackoffMs);
  }

  async createDelivery(
    webhookId: string,
    tenantId: string,
    eventType: string,
    eventId: string,
    payload: Record<string, unknown>,
    maxRetries: number,
  ): Promise<string> {
    const delivery = await this.prisma.webhookDelivery.create({
      data: { webhookId, tenantId, eventType, eventId, payload: payload as object, maxRetries },
    });
    return delivery.id;
  }

  async markDelivered(
    deliveryId: string,
    statusCode: number,
    responseBody: string,
    durationMs: number,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'DELIVERED',
        statusCode,
        responseBody,
        durationMs,
        completedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
  }

  async markFailed(
    deliveryId: string,
    errorMessage: string,
    statusCode: number | null,
    durationMs: number | null,
  ): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) return;

    const attemptCount = delivery.attemptCount + 1;
    const isExhausted = attemptCount >= this.maxRetries;

    if (isExhausted) {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'DEAD_LETTER',
          attemptCount,
          errorMessage,
          statusCode,
          durationMs,
          completedAt: new Date(),
        },
      });
      this.logger.warn(
        `Webhook delivery ${deliveryId} moved to dead-letter queue after ${attemptCount} attempts`,
      );
    } else {
      const nextRetryAt = new Date(Date.now() + this.calculateBackoff(attemptCount));
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'RETRYING',
          attemptCount,
          errorMessage,
          statusCode,
          durationMs,
          nextRetryAt,
        },
      });
    }
  }

  async getPendingRetries(limit = 50) {
    return this.prisma.webhookDelivery.findMany({
      where: { status: 'RETRYING', nextRetryAt: { lte: new Date() } },
      take: limit,
      orderBy: { nextRetryAt: 'asc' },
    });
  }

  async getDeliveriesByWebhook(webhookId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where: { webhookId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.webhookDelivery.count({ where: { webhookId } }),
    ]);
    return { data, total, page, limit };
  }

  async cleanupOldDeliveries(retentionDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86400000);
    const result = await this.prisma.webhookDelivery.deleteMany({
      where: { createdAt: { lt: cutoff }, status: { in: ['DELIVERED', 'DEAD_LETTER'] } },
    });
    return result.count;
  }
}
