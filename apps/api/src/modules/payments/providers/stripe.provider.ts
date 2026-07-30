import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentIntentData,
  RefundData,
} from '../../integrations/interfaces/payment-provider.interface';
import {
  IntegrationConfig,
  IntegrationResult,
} from '../../integrations/interfaces/integration-provider.interface';
import { IntegrationProviderType } from '@tablofy/shared/types';

@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly type: IntegrationProviderType = 'stripe';
  readonly name = 'stripe';
  private readonly logger = new Logger(StripeProvider.name);
  private initialized = false;

  async initialize(_config: IntegrationConfig): Promise<void> {
    this.initialized = true;
    this.logger.log('StripeProvider initialized');
  }

  async validateConnection(): Promise<IntegrationResult<boolean>> {
    if (!this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    return { success: true, data: true };
  }

  async healthCheck(): Promise<IntegrationResult<{ status: string; latencyMs: number }>> {
    const start = Date.now();
    if (!this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    return { success: true, data: { status: 'healthy', latencyMs: Date.now() - start } };
  }

  async createPaymentIntent(
    _data: PaymentIntentData,
  ): Promise<IntegrationResult<{ id: string; clientSecret?: string; status: string }>> {
    if (!this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    try {
      return {
        success: true,
        data: {
          id: `pi_mock_${Date.now()}`,
          clientSecret: `secret_mock_${Date.now()}`,
          status: 'requires_confirmation',
        },
      };
    } catch (error) {
      this.logger.error('Stripe createPaymentIntent failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 500,
      };
    }
  }

  async confirmPayment(
    _paymentIntentId: string,
  ): Promise<IntegrationResult<{ status: string; transactionId?: string }>> {
    if (!this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    try {
      return {
        success: true,
        data: { status: 'succeeded', transactionId: `txn_mock_${Date.now()}` },
      };
    } catch (error) {
      this.logger.error('Stripe confirmPayment failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 500,
      };
    }
  }

  async refundPayment(
    _data: RefundData,
  ): Promise<IntegrationResult<{ id: string; status: string }>> {
    if (!this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    try {
      return {
        success: true,
        data: { id: `re_mock_${Date.now()}`, status: 'succeeded' },
      };
    } catch (error) {
      this.logger.error('Stripe refundPayment failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 500,
      };
    }
  }

  async getPaymentStatus(
    _transactionId: string,
  ): Promise<IntegrationResult<{ status: string; amount: number; currency: string }>> {
    if (!this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    try {
      return {
        success: true,
        data: { status: 'succeeded', amount: 0, currency: 'usd' },
      };
    } catch (error) {
      this.logger.error('Stripe getPaymentStatus failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 500,
      };
    }
  }
}
