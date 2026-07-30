import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { QueueService, QueueJobData } from '../queues/queue.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';

@Injectable()
export class WebhookProcessor implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly deliveryService: WebhookDeliveryService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
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
      ...(registration.headers as Record<string, string>),
    };

    const startTime = Date.now();

    try {
      const response = await axios.post(registration.url, delivery.payload, {
        headers,
        timeout: registration.timeoutMs,
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
        this.logger.warn(`Webhook ${deliveryId} failed with status ${response.status}`);
        return { delivered: false, statusCode: response.status };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.deliveryService.markFailed(deliveryId, errorMessage, null, duration);

      if (delivery.attemptCount < this.configService.get('webhook.maxRetries', 5)) {
        await this.queueService.addJob('webhook-retry', 'retry-webhook', {
          tenantId,
          payload: { webhookId, deliveryId, eventType, eventId },
        });
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
