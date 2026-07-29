import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { QueueService, QueueJobData } from '../queues/queue.service';
import { RecipesService } from './recipes.service';

@Injectable()
export class RecipesProcessor {
  private readonly logger = new Logger(RecipesProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly recipesService: RecipesService,
  ) {
    this.queueService.registerWorker('inventory-deduction', this.handleInventoryDeduction.bind(this));
  }

  @OnEvent('order.completed')
  async onOrderCompleted(payload: { orderId: string; tenantId: string }) {
    this.logger.log(`Order completed event received: ${payload.orderId}`);
    await this.queueService.addJob('inventory-deduction', 'deduct-inventory', {
      tenantId: payload.tenantId,
      payload: { orderId: payload.orderId },
    });
  }

  @OnEvent('order.cancelled')
  async onOrderCancelled(payload: { orderId: string; tenantId: string }) {
    this.logger.log(`Order cancelled event received: ${payload.orderId}`);
    try {
      await this.recipesService.rollbackDeduction(payload.orderId, payload.tenantId);
    } catch (error) {
      this.logger.error(`Rollback failed for order ${payload.orderId}: ${(error as Error).message}`);
    }
  }

  @OnEvent('order.refunded')
  async onOrderRefunded(payload: { orderId: string; tenantId: string }) {
    this.logger.log(`Order refunded event received: ${payload.orderId}`);
    try {
      await this.recipesService.rollbackDeduction(payload.orderId, payload.tenantId);
    } catch (error) {
      this.logger.error(`Rollback failed for order ${payload.orderId}: ${(error as Error).message}`);
    }
  }

  private async handleInventoryDeduction(job: Job<QueueJobData>) {
    const { tenantId, payload } = job.data;
    const orderId = payload.orderId as string;
    this.logger.log(`Processing inventory deduction for order ${orderId}`);

    if (!tenantId) {
      throw new Error('tenantId is required for inventory deduction');
    }

    return this.recipesService.deductInventoryForOrder(orderId, tenantId);
  }
}
