import { Injectable, OnModuleInit } from '@nestjs/common';
import { QueueService, QueueJobData } from '../queues/queue.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { SsrfBlockedError } from '../../common/ssrf/ssrf-guard';
import { SsrfClientService } from '../../common/ssrf/ssrf-client.service';

const FORBIDDEN_USER_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'content-type',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'proxy-authorization',
  'proxy-connection',
  'via',
  'forwarded',
  'x-webhook-signature',
  'x-webhook-event',
  'x-webhook-delivery-id',
  'x-webhook-tenant-id',
]);

/**
 * Tenant-supplied headers are merged onto outbound webhook deliveries. Never
 * forward hop-by-hop, proxy-spoofing, or platform-contract headers that could
 * be used to poison proxies/caches or forge delivery metadata.
 */
function sanitizeUserHeaders(
  headers: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  if (!headers) return sanitized;

  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== 'string' || typeof value !== 'string' || key.trim() === '') continue;
    const lower = key.toLowerCase();
    if (FORBIDDEN_USER_HEADERS.has(lower)) continue;
    if (
      lower.startsWith('x-forwarded-') ||
      lower.startsWith('x-original-') ||
      lower.startsWith('x-real-') ||
      lower.startsWith('x-client-')
    ) {
      continue;
    }
    sanitized[key] = value;
  }

  return sanitized;
}

@Injectable()
export class WebhookProcessor implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly deliveryService: WebhookDeliveryService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly ssrfClient: SsrfClientService,
  ) {
    this.logger.setContext('WebhookProcessor');
  }

  onModuleInit() {
    this.queueService.registerWorker('webhook-delivery', this.processDelivery.bind(this), 10);
    this.queueService.registerWorker('webhook-retry', this.processRetry.bind(this), 5);
    this.logger.log('Webhook delivery workers registered');
  }

  async processDelivery(job: { data: QueueJobData }) {
    const { tenantId, payload } = job.data;
    const { webhookId, deliveryId, eventType, eventId } = payload as {
      webhookId: string;
      deliveryId: string;
      eventType: string;
      eventId: string;
    };

    const registration = await this.prisma.webhookRegistration.findUnique({
      where: { id: webhookId },
    });
    if (!registration || !registration.isActive) {
      this.logger.warn(`Webhook ${webhookId} not found or inactive`);
      return { delivered: false, reason: 'inactive' };
    }

    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!delivery) {
      this.logger.warn(`Delivery ${deliveryId} not found`);
      return { delivered: false, reason: 'not_found' };
    }

    const payloadBody = JSON.stringify(delivery.payload);
    const secret = await this.getWebhookSecret(webhookId);
    const signature = this.deliveryService.signPayload(payloadBody, secret);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': `v1,${signature}`,
      'X-Webhook-Event': eventType,
      'X-Webhook-Delivery-Id': deliveryId,
      'X-Webhook-Tenant-Id': tenantId || '',
      'User-Agent': 'Tablofy-Webhook/1.0',
      ...sanitizeUserHeaders(registration.headers as Record<string, unknown> | null),
    };

    const startTime = Date.now();

    try {
      const response = await this.ssrfClient.postJson(registration.url, delivery.payload, {
        headers,
        timeoutMs: registration.timeoutMs,
        validateStatus: () => true,
      });

      const duration = Date.now() - startTime;

      if (response.status >= 200 && response.status < 300) {
        await this.deliveryService.markDelivered(
          deliveryId,
          response.status,
          JSON.stringify(response.data),
          duration,
        );
        await this.prisma.webhookRegistration.update({
          where: { id: webhookId },
          data: { lastDeliveredAt: new Date() },
        });
        this.logger.log(
          `Webhook ${deliveryId} delivered to ${registration.url} (${response.status})`,
        );
        return { delivered: true, statusCode: response.status };
      } else {
        await this.deliveryService.markFailed(
          deliveryId,
          `HTTP ${response.status}: ${JSON.stringify(response.data).substring(0, 200)}`,
          response.status,
          duration,
        );
        if (delivery.attemptCount + 1 < delivery.maxRetries) {
          await this.queueService.addJob(
            'webhook-retry',
            'retry-webhook',
            {
              tenantId,
              payload: { webhookId, deliveryId, eventType, eventId },
            },
            { delay: this.deliveryService.calculateBackoff(delivery.attemptCount + 1) },
          );
        }
        this.logger.warn(`Webhook ${deliveryId} failed with status ${response.status}`);
        return { delivered: false, statusCode: response.status };
      }
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SsrfBlockedError) {
        await this.deliveryService.markFailed(
          deliveryId,
          `Blocked by SSRF guard: ${error.message}`,
          null,
          duration,
        );
        this.logger.warn(`Webhook delivery ${deliveryId} blocked by SSRF guard: ${error.message}`);
        return { delivered: false, error: error.message, ssrfBlocked: true };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.deliveryService.markFailed(deliveryId, errorMessage, null, duration);

      if (delivery.attemptCount + 1 < delivery.maxRetries) {
        await this.queueService.addJob(
          'webhook-retry',
          'retry-webhook',
          {
            tenantId,
            payload: { webhookId, deliveryId, eventType, eventId },
          },
          { delay: this.deliveryService.calculateBackoff(delivery.attemptCount + 1) },
        );
      }

      this.logger.error(`Webhook delivery ${deliveryId} failed: ${errorMessage}`);
      return { delivered: false, error: errorMessage };
    }
  }

  async processRetry(job: { data: QueueJobData }) {
    const { tenantId, payload } = job.data;
    const { webhookId, deliveryId, eventType, eventId } = payload as {
      webhookId: string;
      deliveryId: string;
      eventType: string;
      eventId: string;
    };

    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!delivery || delivery.status !== 'RETRYING') {
      return { skipped: true, reason: 'not_retrying' };
    }

    return this.processDelivery({
      data: { tenantId, payload: { webhookId, deliveryId, eventType, eventId } },
    } as { data: QueueJobData });
  }

  private async getWebhookSecret(webhookId: string): Promise<string> {
    const registration = await this.prisma.webhookRegistration.findUnique({
      where: { id: webhookId },
    });
    if (!registration) return '';
    if (registration.encryptedSecret) {
      return this.deliveryService.decryptSecret(registration.encryptedSecret);
    }
    return registration.secretHash || '';
  }
}
