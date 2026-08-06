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

export interface ConfirmedPayment {
  status: 'succeeded' | 'pending' | 'failed';
  transactionId?: string;
}

export interface GatewayWebhookEvent {
  provider: 'stripe' | 'paymob';
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'refund.partial';
  reference: string;
  amount?: number;
  currency?: string;
  refundedAmount?: number;
  raw: unknown;
}

export interface PaymentProvider extends IntegrationProvider {
  createPaymentIntent(
    data: PaymentIntentData,
    idempotencyKey?: string,
  ): Promise<IntegrationResult<{ id: string; clientSecret?: string; status: string }>>;
  confirmPayment(
    paymentIntentId: string,
    idempotencyKey?: string,
  ): Promise<IntegrationResult<ConfirmedPayment>>;
  refundPayment(
    data: RefundData,
    idempotencyKey?: string,
  ): Promise<IntegrationResult<{ id: string; status: string }>>;
  voidPayment(
    paymentIntentId: string,
    idempotencyKey?: string,
  ): Promise<IntegrationResult<{ id: string; status: string }>>;
  getPaymentStatus(
    transactionId: string,
  ): Promise<IntegrationResult<{ status: string; amount: number; currency: string }>>;
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean;
  parseWebhookEvent(payload: unknown): GatewayWebhookEvent | null;
}
