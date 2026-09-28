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
  /**
   * The provider's own id for this event (Stripe `event.id`, Paymob
   * `type:obj.id`). Used as the inbound replay key: a duplicate delivery of the
   * same event id is dropped before it can touch a payment. Must be stable
   * across provider retries of the *same* event and different for each new one.
   */
  eventId?: string;
  amount?: number;
  currency?: string;
  refundedAmount?: number;
  /**
   * Whether `refundedAmount` is the cumulative total refunded on the charge/payment
   * (e.g. Stripe `charge.refunded` -> `amount_refunded`) rather than the amount of a
   * single refund event (e.g. Stripe `refund.created`, Paymob `refund.transaction.updated`).
   */
  refundedAmountIsTotal?: boolean;
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
  /**
   * `amount` is always in MAJOR units (e.g. 50.00), matching the local
   * `Payment.amount` column. Providers that receive minor units (Stripe cents)
   * must divide before returning, so callers never need provider-specific
   * conversions. Same contract as `parseWebhookEvent`.
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean;
  parseWebhookEvent(payload: unknown): GatewayWebhookEvent | null;
}
