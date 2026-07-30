import { IntegrationProvider, IntegrationResult } from './integration-provider.interface';

export interface PaymentIntentData {
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, unknown>;
  customerId?: string;
  paymentMethod?: string;
}

export interface RefundData {
  transactionId: string;
  amount?: number;
  reason?: string;
}

export interface PaymentProvider extends IntegrationProvider {
  createPaymentIntent(
    data: PaymentIntentData,
  ): Promise<IntegrationResult<{ id: string; clientSecret?: string; status: string }>>;
  confirmPayment(
    paymentIntentId: string,
  ): Promise<IntegrationResult<{ status: string; transactionId?: string }>>;
  refundPayment(data: RefundData): Promise<IntegrationResult<{ id: string; status: string }>>;
  getPaymentStatus(
    transactionId: string,
  ): Promise<IntegrationResult<{ status: string; amount: number; currency: string }>>;
}
