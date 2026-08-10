import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueService, QueueJobData } from '../queues/queue.service';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { normalizeWebhookEventName } from './webhook-events';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WebhookEventEmitter {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly queueService: QueueService,
    private readonly webhooksService: WebhooksService,
    private readonly deliveryService: WebhookDeliveryService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('WebhookEventEmitter');
    // EventEmitter2 (wildcard mode) forwards only the payload to "**" listeners,
    // so listen via onAny, which passes the emitted event name as the first arg.
    this.eventEmitter.onAny((eventName, payload) => {
      void this.handleEvent(String(eventName), payload as Record<string, unknown>);
    });
  }

  async handleEvent(eventName: string, payload: Record<string, unknown> = {}) {
    const eventType = normalizeWebhookEventName(eventName);
    const tenantId = payload?.tenantId as string | undefined;

    if (!eventType || !tenantId) {
      return;
    }

    try {
      const registrations = await this.webhooksService.getActiveWebhooksForEvent(
        eventType,
        tenantId,
      );

      if (registrations.length === 0) return;

      const eventId = uuidv4();

      for (const registration of registrations) {
        const deliveryId = await this.deliveryService.createDelivery(
          registration.id,
          tenantId,
          eventType,
          eventId,
          payload as Record<string, unknown>,
          registration.retryCount,
        );

        await this.queueService.addJob('webhook-delivery', `deliver-${eventType}`, {
          tenantId,
          payload: {
            webhookId: registration.id,
            deliveryId,
            eventType,
            eventId,
          } as Record<string, unknown>,
          userId: payload.userId as string | undefined,
        } as QueueJobData);
      }

      this.logger.debug(
        `Dispatched ${eventType} to ${registrations.length} webhooks for tenant ${tenantId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to dispatch webhook for ${eventType}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
