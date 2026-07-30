import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { QueueService, QueueJobData } from '../queues/queue.service';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WebhookEventEmitter {
  private readonly subscribedEvents = new Set([
    'orders.created',
    'orders.updated',
    'orders.completed',
    'orders.cancelled',
    'customers.created',
    'customers.updated',
    'customers.deleted',
    'inventory.low_stock',
    'inventory.out_of_stock',
    'inventory.received',
    'payments.completed',
    'payments.failed',
    'payments.refunded',
    'loyalty.points_earned',
    'loyalty.points_redeemed',
    'loyalty.tier_changed',
    'campaigns.sent',
    'campaigns.opened',
    'campaigns.clicked',
    'suppliers.created',
    'suppliers.updated',
    'transfers.created',
    'transfers.completed',
  ]);

  constructor(
    private readonly queueService: QueueService,
    private readonly webhooksService: WebhooksService,
    private readonly deliveryService: WebhookDeliveryService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('WebhookEventEmitter');
  }

  @OnEvent('**')
  async handleEvent(payload: Record<string, unknown>, eventName?: string) {
    const eventType = eventName || (payload?.eventType as string | undefined);
    const tenantId = payload?.tenantId as string | undefined;

    if (!eventType || !tenantId || !this.subscribedEvents.has(eventType)) {
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
