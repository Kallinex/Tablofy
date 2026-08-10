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

export type PaymobMode = 'mock' | 'live';

export interface PaymobProviderOptions {
  mode?: PaymobMode;
  apiKey?: string;
  integrationId?: number;
  webhookSecret?: string;
  apiBase?: string;
  http?: AxiosInstance;
}

interface PaymobToken {
  token: string;
  expiresAt: number;
}

interface PaymobTransaction {
  id?: number;
  pending?: boolean;
  success?: boolean;
  amount_cents?: number;
  currency?: string;
}

@Injectable()
export class PaymobProvider implements PaymentProvider {
  readonly type: IntegrationProviderType = 'paymob';
  readonly name = 'paymob';
  private readonly logger = new Logger(PaymobProvider.name);
  private readonly options: PaymobProviderOptions;
  private readonly http: AxiosInstance;
  private initialized = false;
  private authToken: PaymobToken | null = null;

  constructor(@Optional() options: PaymobProviderOptions = {}) {
    const mode = options.mode ?? 'mock';
    if (mode === 'live' && !options.apiKey) {
      throw new Error('PaymobProvider: live mode requires an apiKey');
    }
    this.options = { mode, apiBase: 'https://accept.paymob.com/api', ...options };
    this.http = options.http ?? axios.create({ baseURL: this.options.apiBase, timeout: 15000 });
  }

  get mode(): PaymobMode {
    return this.options.mode ?? 'mock';
  }

  private isLive(): boolean {
    return this.mode === 'live';
  }

  private async getAuthToken(): Promise<string> {
    if (this.authToken && this.authToken.expiresAt > Date.now()) {
      return this.authToken.token;
    }
    const response = await this.http.post<{ token: string }>('/auth/tokens', {
      api_key: this.options.apiKey || '',
    });
    if (!response.data?.token) {
      throw new Error('Paymob authentication failed: no token returned');
    }
    this.authToken = { token: response.data.token, expiresAt: Date.now() + 60 * 60 * 1000 };
    return response.data.token;
  }

  async initialize(config: IntegrationConfig): Promise<void> {
    const settings = (config.settings ?? {}) as Record<string, unknown>;
    if (settings.mode === 'live' && !this.options.apiKey && !settings.apiKey) {
      this.logger.error('PaymobProvider initialized in live mode without an API key');
    }
    this.initialized = true;
    this.logger.log(
      `PaymobProvider initialized (mode=${this.mode}${this.isLive() ? '' : ' - MOCK, not safe for production'})`,
    );
  }

  async validateConnection(): Promise<IntegrationResult<boolean>> {
    if (this.isLive() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isLive()) {
      return { success: true, data: true };
    }
    try {
      await this.getAuthToken();
      return { success: true, data: true };
    } catch (error) {
      return {
        success: false,
        error: this.errorMessage(error, 'Paymob connection failed'),
        statusCode: 503,
      };
    }
  }

  async healthCheck(): Promise<IntegrationResult<{ status: string; latencyMs: number }>> {
    const start = Date.now();
    if (this.isLive() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isLive()) {
      return { success: true, data: { status: 'mock', latencyMs: Date.now() - start } };
    }
    try {
      await this.getAuthToken();
      return { success: true, data: { status: 'healthy', latencyMs: Date.now() - start } };
    } catch (error) {
      return {
        success: false,
        error: this.errorMessage(error, 'Paymob unhealthy'),
        statusCode: 503,
      };
    }
  }

  async createPaymentIntent(
    data: PaymentIntentData,
    _idempotencyKey?: string,
  ): Promise<IntegrationResult<{ id: string; clientSecret?: string; status: string }>> {
    if (this.isLive() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isLive()) {
      return {
        success: true,
        data: {
          id: `paymob_order_${Date.now()}`,
          clientSecret: `paymob_token_${Date.now()}`,
          status: 'pending',
        },
      };
    }
    try {
      const token = await this.getAuthToken();
      const amountCents = String(Math.round(data.amount));
      const merchantOrderId = String(
        data.metadata?.orderId ?? `order_${data.metadata?.tenantId ?? 'tenant'}_${Date.now()}`,
      );

      const orderResponse = await this.http.post<{ id: string }>('/ecommerce/orders', {
        auth_token: token,
        delivery_needed: false,
        amount_cents: amountCents,
        currency: data.currency.toUpperCase(),
        merchant_order_id: merchantOrderId,
        items: [],
      });
      const orderId = orderResponse.data?.id;
      if (!orderId) {
        throw new Error('Paymob order creation failed: no order id returned');
      }

      if (!this.options.integrationId) {
        throw new Error('Paymob integration_id is required (PAYMOB_INTEGRATION_ID)');
      }

      const paymentKeyResponse = await this.http.post<{ token: string }>(
        '/acceptance/payment_keys',
        {
          auth_token: token,
          amount_cents: amountCents,
          currency: data.currency.toUpperCase(),
          order_id: orderId,
          integration_id: this.options.integrationId,
          lock_order_when_paid: true,
          billing_data: {
            apartment: 'NA',
            email: this.billingValue(data, 'customerEmail', 'na@example.com'),
            floor: 'NA',
            first_name: this.billingValue(data, 'firstName', 'Tablofy'),
            last_name: this.billingValue(data, 'lastName', 'Customer'),
            street: 'NA',
            building: 'NA',
            phone_number: this.billingValue(data, 'phoneNumber', '+201000000000'),
            shipping_method: 'PKG',
            postal_code: 'NA',
            city: 'NA',
            country: this.billingValue(data, 'country', 'EG'),
            state: 'NA',
          },
        },
      );

      return {
        success: true,
        data: {
          id: String(orderId),
          clientSecret: paymentKeyResponse.data?.token,
          status: 'pending',
        },
      };
    } catch (error) {
      this.logger.error('Paymob createPaymentIntent failed', error);
      return {
        success: false,
        error: this.errorMessage(error, 'Paymob createPaymentIntent failed'),
        statusCode: this.errorStatus(error, 502),
      };
    }
  }

  async confirmPayment(
    paymentIntentId: string,
    _idempotencyKey?: string,
  ): Promise<IntegrationResult<ConfirmedPayment>> {
    if (this.isLive() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isLive()) {
      return {
        success: true,
        data: { status: 'succeeded', transactionId: `paymob_txn_${Date.now()}` },
      };
    }
    try {
      const tx = await this.inquiryTransaction(paymentIntentId);
      if (tx && tx.id !== undefined) {
        return {
          success: true,
          data: { status: this.mapPaymobStatus(tx), transactionId: String(tx.id) },
        };
      }
      return { success: true, data: { status: 'pending' } };
    } catch (error) {
      this.logger.warn(
        'Paymob confirmPayment inquiry failed; awaiting webhook confirmation',
        error,
      );
      return { success: true, data: { status: 'pending' } };
    }
  }

  async refundPayment(
    data: RefundData,
    _idempotencyKey?: string,
  ): Promise<IntegrationResult<{ id: string; status: string }>> {
    if (this.isLive() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isLive()) {
      return {
        success: true,
        data: { id: `paymob_refund_${Date.now()}`, status: 'refunded' },
      };
    }
    try {
      const token = await this.getAuthToken();
      const tx = await this.inquiryTransaction(data.transactionId);
      if (!tx || tx.id === undefined) {
        return {
          success: false,
          error: 'Paymob refund failed: no transaction found for this order',
          statusCode: 400,
        };
      }
      const amountCents = data.amount !== undefined ? Math.round(data.amount) : tx.amount_cents;
      if (typeof amountCents !== 'number' || amountCents <= 0) {
        return {
          success: false,
          error: 'Paymob refund failed: amount is required',
          statusCode: 400,
        };
      }
      const response = await this.http.post<{ id?: number; success?: boolean }>(
        '/acceptance/void_refund/refund',
        {
          auth_token: token,
          transaction_id: tx.id,
          amount_cents: String(amountCents),
        },
      );
      if (response.data?.success === false) {
        return { success: false, error: 'Paymob refund rejected', statusCode: 400 };
      }
      return {
        success: true,
        data: {
          id:
            response.data?.id !== undefined
              ? String(response.data.id)
              : `paymob_refund_${Date.now()}`,
          status: 'refunded',
        },
      };
    } catch (error) {
      this.logger.error('Paymob refundPayment failed', error);
      return {
        success: false,
        error: this.errorMessage(error, 'Paymob refundPayment failed'),
        statusCode: this.errorStatus(error, 502),
      };
    }
  }

  async voidPayment(
    paymentIntentId: string,
    _idempotencyKey?: string,
  ): Promise<IntegrationResult<{ id: string; status: string }>> {
    if (this.isLive() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isLive()) {
      return {
        success: true,
        data: { id: `paymob_void_${Date.now()}`, status: 'voided' },
      };
    }
    try {
      const token = await this.getAuthToken();
      const tx = await this.inquiryTransaction(paymentIntentId);
      if (!tx || tx.id === undefined) {
        return {
          success: false,
          error: 'Paymob void failed: no transaction found for this order',
          statusCode: 400,
        };
      }
      const response = await this.http.post<{ id?: number; success?: boolean }>(
        '/acceptance/void_refund/void',
        {
          auth_token: token,
          transaction_id: tx.id,
        },
      );
      if (response.data?.success === false) {
        return { success: false, error: 'Paymob void rejected', statusCode: 400 };
      }
      return {
        success: true,
        data: {
          id: response.data?.id !== undefined ? String(response.data.id) : String(tx.id),
          status: 'voided',
        },
      };
    } catch (error) {
      this.logger.error('Paymob voidPayment failed', error);
      return {
        success: false,
        error: this.errorMessage(error, 'Paymob voidPayment failed'),
        statusCode: this.errorStatus(error, 502),
      };
    }
  }

  async getPaymentStatus(
    transactionId: string,
  ): Promise<IntegrationResult<{ status: string; amount: number; currency: string }>> {
    if (this.isLive() && !this.initialized) {
      return { success: false, error: 'Provider not initialized', statusCode: 500 };
    }
    if (!this.isLive()) {
      return {
        success: true,
        data: { status: 'succeeded', amount: 0, currency: 'egp' },
      };
    }
    try {
      let tx = await this.inquiryTransaction(transactionId);
      if (!tx) {
        tx = await this.getTransactionById(transactionId);
      }
      if (!tx) {
        return {
          success: false,
          error: 'Paymob getPaymentStatus failed: transaction not found',
          statusCode: 404,
        };
      }
      return {
        success: true,
        data: {
          status: this.mapPaymobStatus(tx),
          amount: (tx.amount_cents ?? 0) / 100,
          currency: (tx.currency ?? 'egp').toUpperCase(),
        },
      };
    } catch (error) {
      this.logger.error('Paymob getPaymentStatus failed', error);
      return {
        success: false,
        error: this.errorMessage(error, 'Paymob getPaymentStatus failed'),
        statusCode: this.errorStatus(error, 502),
      };
    }
  }

  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    if (!this.options.webhookSecret) {
      this.logger.error('Paymob webhook secret not configured');
      return false;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : payload);
    } catch {
      return false;
    }
    const bodyHmac = signature || String(parsed.hmac ?? '');
    if (!bodyHmac) {
      return false;
    }
    const obj = (parsed.obj ?? {}) as Record<string, unknown>;
    const sourceData = (obj.source_data ?? {}) as Record<string, unknown>;
    const parts = [
      parsed.amount_cents,
      parsed.created_at,
      parsed.currency,
      parsed.id,
      obj.id,
      obj.created_at,
      obj.currency,
      obj.pending,
      sourceData.pan,
      sourceData.sub_type,
      sourceData.type,
      obj.transaction_id,
    ];
    if (parts.some((p) => p === undefined || p === null)) {
      this.logger.warn('Paymob webhook payload missing HMAC fields');
      return false;
    }
    const digest = createHmac('sha512', this.options.webhookSecret)
      .update(parts.join(''))
      .digest('hex');
    try {
      const a = Buffer.from(digest, 'hex');
      const b = Buffer.from(bodyHmac, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(payload: unknown): GatewayWebhookEvent | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const body = payload as {
      type?: string;
      obj?: Record<string, unknown>;
      amount_cents?: number;
      currency?: string;
    };
    const obj = (body.obj ?? {}) as Record<string, unknown>;
    const sourceData = (obj.source_data ?? {}) as Record<string, unknown>;
    const amount = (body.amount_cents ?? 0) / 100;
    const orderId = (obj.order as { id?: unknown } | undefined)?.id;
    const reference = String(orderId ?? obj.id ?? obj.transaction_id ?? '');
    switch (body.type) {
      case 'transaction.updated': {
        const pending = Boolean(obj.pending);
        const success = obj.success === true;
        if (pending) {
          return null;
        }
        return {
          provider: 'paymob',
          type: success ? 'payment.succeeded' : 'payment.failed',
          reference,
          amount,
          currency: typeof body.currency === 'string' ? body.currency.toUpperCase() : undefined,
          raw: payload,
        };
      }
      case 'refund.transaction.updated': {
        const sourceType = String(sourceData.type ?? '');
        const refundedAmount =
          sourceType === 'REFUND' ? Number(sourceData.amount ?? body.amount_cents ?? 0) / 100 : 0;
        return {
          provider: 'paymob',
          type: 'refund.succeeded',
          reference,
          refundedAmount: refundedAmount || undefined,
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
      return String(error.response?.data?.message ?? error.message ?? fallback);
    }
    return error instanceof Error ? error.message : fallback;
  }

  private errorStatus(error: unknown, fallback: number): number {
    if (axios.isAxiosError(error)) {
      return error.response?.status ?? fallback;
    }
    return fallback;
  }

  private billingValue(data: PaymentIntentData, key: string, fallback: string): string {
    const value = data.metadata?.[key];
    return typeof value === 'string' && value.trim() ? value : fallback;
  }

  private async inquiryTransaction(orderRef: string): Promise<PaymobTransaction | null> {
    const token = await this.getAuthToken();
    const body: Record<string, unknown> = { auth_token: token };
    const orderId = Number(orderRef);
    if (Number.isInteger(orderId) && orderId > 0) {
      body.order_id = orderId;
    } else {
      body.merchant_order_id = orderRef;
    }
    const response = await this.http.post<PaymobTransaction>(
      '/ecommerce/orders/transaction_inquiry',
      body,
    );
    return response.data && typeof response.data.id === 'number' ? response.data : null;
  }

  private async getTransactionById(transactionId: string): Promise<PaymobTransaction | null> {
    const token = await this.getAuthToken();
    const response = await this.http.get<PaymobTransaction>(
      `/acceptance/transactions/${encodeURIComponent(transactionId)}?auth_token=${token}`,
    );
    return response.data || null;
  }

  private mapPaymobStatus(tx: PaymobTransaction): ConfirmedPayment['status'] {
    if (tx.pending === false) {
      return tx.success === true ? 'succeeded' : 'failed';
    }
    return 'pending';
  }
}
