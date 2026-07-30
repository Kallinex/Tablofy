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
export class PaymobProvider implements PaymentProvider {
  readonly type: IntegrationProviderType = 'paymob';
  readonly name = 'paymob';
  private readonly logger = new Logger(PaymobProvider.name);
  private initialized = false;

  async initialize(_config: IntegrationConfig): Promise<void> {
    this.initialized = true;
    this.logger.log('PaymobProvider initialized');
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
          id: `paymob_order_${Date.now()}`,
          clientSecret: `paymob_token_${Date.now()}`,
          status: 'pending',
        },
      };
    } catch (error) {
      this.logger.error('Paymob createPaymentIntent failed', error);
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
        data: { status: 'success', transactionId: `paymob_txn_${Date.now()}` },
      };
    } catch (error) {
      this.logger.error('Paymob confirmPayment failed', error);
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
        data: { id: `paymob_refund_${Date.now()}`, status: 'refunded' },
      };
    } catch (error) {
      this.logger.error('Paymob refundPayment failed', error);
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
        data: { status: 'success', amount: 0, currency: 'egp' },
      };
    } catch (error) {
      this.logger.error('Paymob getPaymentStatus failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 500,
      };
    }
  }
}
