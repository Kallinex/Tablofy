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
    this.queueService.registerWorker(
      'inventory-deduction',
      this.handleInventoryDeduction.bind(this),
    );
  }

  @OnEvent('order.completed')
  async onOrderCompleted(payload: { orderId: string; tenantId: string }) {
    this.logger.log(`Order completed event received: ${payload.orderId}`);
    await this.queueService.addJob(
      'inventory-deduction',
      'deduct-inventory',
      {
        tenantId: payload.tenantId,
        payload: { orderId: payload.orderId },
      },
      { jobId: `deduct-${payload.orderId}` },
    );
  }

  @OnEvent('payments.completed')
  async onPaymentsCompleted(payload: { orderId: string; tenantId: string }) {
    const completed = await this.recipesService.isOrderCompletedForDeduction(
      payload.orderId,
      payload.tenantId,
    );
    if (!completed) {
      return;
    }
    this.logger.log(`Order completed via payment event received: ${payload.orderId}`);
    await this.queueService.addJob(
      'inventory-deduction',
      'deduct-inventory',
      {
        tenantId: payload.tenantId,
        payload: { orderId: payload.orderId },
      },
      { jobId: `deduct-${payload.orderId}` },
    );
  }

  @OnEvent('order.cancelled')
  async onOrderCancelled(payload: { orderId: string; tenantId: string }) {
    this.logger.log(`Order cancelled event received: ${payload.orderId}`);
    try {
      await this.recipesService.rollbackDeduction(payload.orderId, payload.tenantId);
    } catch (error) {
      this.logger.error(
        `Rollback failed for order ${payload.orderId}: ${(error as Error).message}`,
      );
    }
  }

  @OnEvent('order.refunded')
  async onOrderRefunded(payload: { orderId: string; tenantId: string }) {
    this.logger.log(`Order refunded event received: ${payload.orderId}`);
    try {
      await this.recipesService.rollbackDeduction(payload.orderId, payload.tenantId);
    } catch (error) {
      this.logger.error(
        `Rollback failed for order ${payload.orderId}: ${(error as Error).message}`,
      );
    }
  }

  @OnEvent('payments.refunded')
  async onPaymentsRefunded(payload: {
    orderId: string;
    tenantId: string;
    paymentId: string;
    amount?: number | string;
    amountRefunded?: number | string;
  }) {
    this.logger.log(`Payment refunded event received: ${payload.paymentId}`);
    if (!payload.orderId || !payload.tenantId || !payload.paymentId) {
      this.logger.warn('payments.refunded event missing required fields; skipping reversal');
      return;
    }
    try {
      await this.recipesService.reverseConsumptionForRefund({
        tenantId: payload.tenantId,
        orderId: payload.orderId,
        paymentId: payload.paymentId,
        amount: payload.amount != null ? Number(payload.amount) : 0,
        amountRefunded: payload.amountRefunded != null ? Number(payload.amountRefunded) : undefined,
      });
    } catch (error) {
      this.logger.error(
        `Consumption reversal failed for payment ${payload.paymentId}: ${(error as Error).message}`,
      );
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
