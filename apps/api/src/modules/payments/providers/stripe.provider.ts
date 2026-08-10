import { Injectable, Logger, Optional } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  PaymentProvider,
  PaymentIntentData,
  RefundData,
  ConfirmedPayment,
  GatewayWebhookEvent,
} from '../../integrations/interfaces/payment-provider.interface';
import {
  IntegrationConfig,
  IntegrationResult,
} from '../../integrations/interfaces/integration-provider.interface';
import { IntegrationProviderType } from '@tablofy/shared/types';

export type StripeMode = 'mock' | 'test' | 'live';

const STRIPE_REFUND_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer'] as const;

export interface StripeProviderOptions {
  mode?: StripeMode;
  secretKey?: string;
  webhookSecret?: string;
  apiBase?: string;
  http?: AxiosInstance;
}

@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly type: IntegrationProviderType = 'stripe';
  readonly name = 'stripe';
  private readonly logger = new Logger(StripeProvider.name);
  private readonly options: StripeProviderOptions;
  private readonly http: AxiosInstance;
  private initialized = false;

  constructor(@Optional() options: StripeProviderOptions = {}) {
    const mode = options.mode ?? 'mock';
    if (mode !== 'mock' && !options.secretKey) {
      throw new Error(`StripeProvider: ${mode} mode requires a secretKey`);
    }
    this.options = { mode, apiBase: 'https://api.stripe.com', ...options };
    this.http = options.http ?? axios.create({ baseURL: this.options.apiBase, timeout: 15000 });
  }

  get mode(): StripeMode {
    return this.options.mode ?? 'mock';
  }

  private isReal(): boolean {
    return this.mode !== 'mock';
  }

  private async authedRequest<T>(
    method: 'get' | 'post',
    url: string,
    body?: Record<string, string>,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.secretKey || ''}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const response = await this.http.request<T>({
      method,
      url,
      data: body ? new URLSearchParams(body).toString() : undefined,
      headers,
    });
    return response.data;
  }

  private mapStripeStatus(status: string): ConfirmedPayment['status'] {
    switch (status) {
      case 'succeeded':
        return 'succeeded';
      case 'canceled':
        return 'failed';
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'requires_action':
      case 'processing':
      case 'requires_capture':
      default:
        return 'pending';
    }
  }

  async initialize(config: IntegrationConfig): Promise<void> {
    const settings = (config.settings ?? {}) as Record<string, unknown>;
    const settingMode = settings.mode;
    if (settingMode === 'live' && !this.options.secretKey && !settings.secretKey) {
      this.logger.error('StripeProvider initialized in live mode without a secret key');
    }
    this.initialized = true;
    this.logger.log(
      `StripeProvider initialized (mode=${this.mode}${this.isReal() ? '' : ' - MOCK, not safe for production'})`,
    );
  }

  async validateConnection(): Promise<IntegrationResult<boolean>> {
    if (this.isReal() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isReal()) {
      return { success: true, data: true };
    }
    try {
      await this.authedRequest('get', '/v1/balance');
      return { success: true, data: true };
    } catch (error) {
      return {
        success: false,
        error: this.errorMessage(error, 'Stripe connection failed'),
        statusCode: 503,
      };
    }
  }

  async healthCheck(): Promise<IntegrationResult<{ status: string; latencyMs: number }>> {
    const start = Date.now();
    if (this.isReal() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isReal()) {
      return { success: true, data: { status: 'mock', latencyMs: Date.now() - start } };
    }
    try {
      await this.authedRequest('get', '/v1/balance');
      return { success: true, data: { status: 'healthy', latencyMs: Date.now() - start } };
    } catch (error) {
      return {
        success: false,
        error: this.errorMessage(error, 'Stripe unhealthy'),
        statusCode: 503,
      };
    }
  }

  async createPaymentIntent(
    data: PaymentIntentData,
    idempotencyKey?: string,
  ): Promise<IntegrationResult<{ id: string; clientSecret?: string; status: string }>> {
    if (this.isReal() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isReal()) {
      return {
        success: true,
        data: {
          id: `pi_mock_${Date.now()}`,
          clientSecret: `secret_mock_${Date.now()}`,
          status: 'requires_confirmation',
        },
      };
    }
    try {
      const body: Record<string, string> = {
        amount: String(Math.round(data.amount)),
        currency: data.currency.toLowerCase(),
        description: data.description || '',
        ...(data.metadata
          ? Object.entries(data.metadata).reduce<Record<string, string>>((acc, [k, v]) => {
              acc[`metadata[${k}]`] = String(v);
              return acc;
            }, {})
          : {}),
      };
      const intent = await this.authedRequest<{
        id: string;
        client_secret?: string;
        status: string;
      }>('post', '/v1/payment_intents', body, idempotencyKey);
      return {
        success: true,
        data: {
          id: intent.id,
          clientSecret: intent.client_secret,
          status: intent.status,
        },
      };
    } catch (error) {
      this.logger.error('Stripe createPaymentIntent failed', error);
      return {
        success: false,
        error: this.errorMessage(error, 'Stripe createPaymentIntent failed'),
        statusCode: this.errorStatus(error, 502),
      };
    }
  }

  async confirmPayment(
    paymentIntentId: string,
    idempotencyKey?: string,
  ): Promise<IntegrationResult<ConfirmedPayment>> {
    if (this.isReal() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isReal()) {
      return {
        success: true,
        data: { status: 'succeeded', transactionId: `txn_mock_${Date.now()}` },
      };
    }
    void idempotencyKey;
    try {
      const intent = await this.authedRequest<{ id: string; status: string }>(
        'get',
        `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      );
      return {
        success: true,
        data: {
          status: this.mapStripeStatus(intent.status),
          transactionId: intent.id,
        },
      };
    } catch (error) {
      this.logger.error('Stripe confirmPayment failed', error);
      return {
        success: false,
        error: this.errorMessage(error, 'Stripe confirmPayment failed'),
        statusCode: this.errorStatus(error, 502),
      };
    }
  }

  async refundPayment(
    data: RefundData,
    idempotencyKey?: string,
  ): Promise<IntegrationResult<{ id: string; status: string }>> {
    if (this.isReal() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isReal()) {
      return {
        success: true,
        data: { id: `re_mock_${Date.now()}`, status: 'succeeded' },
      };
    }
    try {
      const body: Record<string, string> = {
        payment_intent: data.transactionId,
        ...(data.amount !== undefined ? { amount: String(Math.round(data.amount)) } : {}),
        ...(data.reason && (STRIPE_REFUND_REASONS as readonly string[]).includes(data.reason)
          ? { reason: data.reason }
          : {}),
      };
      const refund = await this.authedRequest<{ id: string; status: string }>(
        'post',
        '/v1/refunds',
        body,
        idempotencyKey,
      );
      return { success: true, data: { id: refund.id, status: refund.status } };
    } catch (error) {
      this.logger.error('Stripe refundPayment failed', error);
      return {
        success: false,
        error: this.errorMessage(error, 'Stripe refundPayment failed'),
        statusCode: this.errorStatus(error, 502),
      };
    }
  }

  async voidPayment(
    paymentIntentId: string,
    idempotencyKey?: string,
  ): Promise<IntegrationResult<{ id: string; status: string }>> {
    if (this.isReal() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isReal()) {
      return {
        success: true,
        data: { id: `pi_canceled_${Date.now()}`, status: 'canceled' },
      };
    }
    try {
      const intent = await this.authedRequest<{ id: string; status: string }>(
        'post',
        `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
        undefined,
        idempotencyKey,
      );
      return { success: true, data: { id: intent.id, status: intent.status } };
    } catch (error) {
      this.logger.error('Stripe voidPayment failed', error);
      return {
        success: false,
        error: this.errorMessage(error, 'Stripe voidPayment failed'),
        statusCode: this.errorStatus(error, 502),
      };
    }
  }

  async getPaymentStatus(
    transactionId: string,
  ): Promise<IntegrationResult<{ status: string; amount: number; currency: string }>> {
    if (this.isReal() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isReal()) {
      return {
        success: true,
        data: { status: 'succeeded', amount: 0, currency: 'usd' },
      };
    }
    try {
      const intent = await this.authedRequest<{
        id: string;
        status: string;
        amount: number;
        currency: string;
      }>('get', `/v1/payment_intents/${encodeURIComponent(transactionId)}`);
      return {
        success: true,
        data: {
          status: this.mapStripeStatus(intent.status),
          amount: intent.amount,
          currency: intent.currency.toUpperCase(),
        },
      };
    } catch (error) {
      this.logger.error('Stripe getPaymentStatus failed', error);
      return {
        success: false,
        error: this.errorMessage(error, 'Stripe getPaymentStatus failed'),
        statusCode: this.errorStatus(error, 502),
      };
    }
  }

  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    if (!this.options.webhookSecret) {
      this.logger.error('Stripe webhook secret not configured');
      return false;
    }
    const parts = new Map<string, string>();
    for (const item of signature.split(',')) {
      const [key, value] = item.split('=');
      if (key && value) {
        parts.set(key, value);
      }
    }
    const timestamp = parts.get('t');
    const expected = parts.get('v1');
    if (!timestamp || !expected) {
      return false;
    }
    const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
    const digest = createHmac('sha256', this.options.webhookSecret)
      .update(`${timestamp}.${raw}`)
      .digest('hex');
    try {
      const a = Buffer.from(digest, 'hex');
      const b = Buffer.from(expected, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(payload: unknown): GatewayWebhookEvent | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const event = payload as {
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    const obj = event.data?.object ?? {};
    switch (event.type) {
      case 'payment_intent.succeeded':
        return {
          provider: 'stripe',
          type: 'payment.succeeded',
          reference: String(obj.id ?? ''),
          amount: typeof obj.amount === 'number' ? obj.amount / 100 : undefined,
          currency: typeof obj.currency === 'string' ? obj.currency.toUpperCase() : undefined,
          raw: payload,
        };
      case 'payment_intent.canceled':
      case 'payment_intent.payment_failed':
        return {
          provider: 'stripe',
          type: 'payment.failed',
          reference: String(obj.id ?? ''),
          raw: payload,
        };
      case 'charge.refunded': {
        const amountRefunded = typeof obj.amount_refunded === 'number' ? obj.amount_refunded : 0;
        const amount = typeof obj.amount === 'number' ? obj.amount : 0;
        return {
          provider: 'stripe',
          type: amountRefunded < amount ? 'refund.partial' : 'refund.succeeded',
          reference: String(obj.payment_intent ?? obj.id ?? ''),
          refundedAmount: amountRefunded / 100,
          refundedAmountIsTotal: true,
          raw: payload,
        };
      }
      case 'refund.created': {
        const refundObj = event.data?.object ?? {};
        return {
          provider: 'stripe',
          type: 'refund.succeeded',
          reference: String(refundObj.payment_intent ?? refundObj.id ?? ''),
          refundedAmount: typeof refundObj.amount === 'number' ? refundObj.amount / 100 : undefined,
          refundedAmountIsTotal: false,
          raw: payload,
        };
      }
      default:
        return null;
    }
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
      return String(error.response?.data?.error?.message ?? error.message ?? fallback);
    }
    return error instanceof Error ? error.message : fallback;
  }

  private errorStatus(error: unknown, fallback: number): number {
    if (axios.isAxiosError(error)) {
      return error.response?.status ?? fallback;
    }
    return fallback;
  }
}
