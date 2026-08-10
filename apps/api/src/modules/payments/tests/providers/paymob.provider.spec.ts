import { createHmac } from 'crypto';
import { PaymobProvider } from '../../providers/paymob.provider';

describe('PaymobProvider', () => {
  describe('mock mode', () => {
    let provider: PaymobProvider;

    beforeEach(() => {
      provider = new PaymobProvider();
    });

    it('should default to mock mode', () => {
      expect(provider.mode).toBe('mock');
    });

    it('should work without explicit initialization in mock mode', async () => {
      const result = await provider.createPaymentIntent({ amount: 1000, currency: 'egp' });
      expect(result.success).toBe(true);
      expect(result.data!.id).toContain('paymob_order_');
    });

    it('should confirm successfully in mock mode', async () => {
      const result = await provider.confirmPayment('paymob_order_123');
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('succeeded');
    });

    it('should refund successfully in mock mode', async () => {
      const result = await provider.refundPayment({ transactionId: 'txn_123' });
      expect(result.success).toBe(true);
      expect(result.data!.id).toContain('paymob_refund_');
    });

    it('should report status in mock mode', async () => {
      const result = await provider.getPaymentStatus('txn_123');
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('succeeded');
    });
  });

  describe('live mode', () => {
    it('should throw when constructed in live mode without an api key', () => {
      expect(() => new PaymobProvider({ mode: 'live' })).toThrow(/apiKey/);
    });

    it('should create a payment key through the token -> order -> payment_key flow', async () => {
      const calls: string[] = [];
      const http = {
        post: async (url: string, body: Record<string, unknown>) => {
          calls.push(`${url}:${body.auth_token ?? ''}`);
          if (url === '/auth/tokens') return { data: { token: 'tok_1' } };
          if (url === '/ecommerce/orders') return { data: { id: 'order_1' } };
          if (url === '/acceptance/payment_keys') return { data: { token: 'pk_1' } };
          throw new Error('unexpected url');
        },
      } as never;

      const provider = new PaymobProvider({
        mode: 'live',
        apiKey: 'sk_123',
        integrationId: 456,
        webhookSecret: 'hmac_secret',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.createPaymentIntent({ amount: 1500, currency: 'EGP' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'order_1', clientSecret: 'pk_1', status: 'pending' });
      expect(calls).toEqual([
        '/auth/tokens:',
        '/ecommerce/orders:tok_1',
        '/acceptance/payment_keys:tok_1',
      ]);
    });

    it('should return pending confirmation in live mode until a transaction exists', async () => {
      const http = {
        post: async (url: string, body: Record<string, unknown>) => {
          if (url === '/auth/tokens') return { data: { token: 'tok_1' } };
          if (url === '/ecommerce/orders/transaction_inquiry') {
            expect(body).toMatchObject({ auth_token: 'tok_1', order_id: 1 });
            return { data: {} };
          }
          throw new Error('unexpected url');
        },
      } as never;
      const provider = new PaymobProvider({
        mode: 'live',
        apiKey: 'sk_123',
        integrationId: 456,
        webhookSecret: 'hmac_secret',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.confirmPayment('1');
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('pending');
    });

    it('should confirm succeeded when the transaction inquiry finds a completed transaction', async () => {
      const http = {
        post: async (url: string) => {
          if (url === '/auth/tokens') return { data: { token: 'tok_1' } };
          if (url === '/ecommerce/orders/transaction_inquiry') {
            return { data: { id: 123, pending: false, success: true } };
          }
          throw new Error('unexpected url');
        },
      } as never;
      const provider = new PaymobProvider({
        mode: 'live',
        apiKey: 'sk_123',
        integrationId: 456,
        webhookSecret: 'hmac_secret',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.confirmPayment('1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: 'succeeded', transactionId: '123' });
    });

    it('should refund a transaction resolved from the order id', async () => {
      const calls: string[] = [];
      const http = {
        post: async (url: string, body: Record<string, unknown>) => {
          calls.push(url);
          if (url === '/auth/tokens') return { data: { token: 'tok_1' } };
          if (url === '/ecommerce/orders/transaction_inquiry') {
            return { data: { id: 123, amount_cents: 1500 } };
          }
          if (url === '/acceptance/void_refund/refund') {
            expect(body).toMatchObject({
              auth_token: 'tok_1',
              transaction_id: 123,
              amount_cents: '1500',
            });
            return { data: { id: 999, success: true } };
          }
          throw new Error('unexpected url');
        },
      } as never;
      const provider = new PaymobProvider({
        mode: 'live',
        apiKey: 'sk_123',
        integrationId: 456,
        webhookSecret: 'hmac_secret',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.refundPayment({ transactionId: '1' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: '999', status: 'refunded' });
      expect(calls).toEqual([
        '/auth/tokens',
        '/ecommerce/orders/transaction_inquiry',
        '/acceptance/void_refund/refund',
      ]);
    });

    it('should void a transaction resolved from the order id', async () => {
      const http = {
        post: async (url: string, body: Record<string, unknown>) => {
          if (url === '/auth/tokens') return { data: { token: 'tok_1' } };
          if (url === '/ecommerce/orders/transaction_inquiry') {
            return { data: { id: 123, pending: true } };
          }
          if (url === '/acceptance/void_refund/void') {
            expect(body).toMatchObject({ auth_token: 'tok_1', transaction_id: 123 });
            return { data: { id: 888, success: true } };
          }
          throw new Error('unexpected url');
        },
      } as never;
      const provider = new PaymobProvider({
        mode: 'live',
        apiKey: 'sk_123',
        integrationId: 456,
        webhookSecret: 'hmac_secret',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.voidPayment('1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: '888', status: 'voided' });
    });

    it('should report status resolved from the order id', async () => {
      const http = {
        post: async (url: string) => {
          if (url === '/auth/tokens') return { data: { token: 'tok_1' } };
          if (url === '/ecommerce/orders/transaction_inquiry') {
            return {
              data: { id: 123, pending: false, success: true, amount_cents: 1500, currency: 'EGP' },
            };
          }
          throw new Error('unexpected url');
        },
      } as never;
      const provider = new PaymobProvider({
        mode: 'live',
        apiKey: 'sk_123',
        integrationId: 456,
        webhookSecret: 'hmac_secret',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.getPaymentStatus('1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: 'succeeded', amount: 15, currency: 'EGP' });
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should accept a valid Paymob HMAC over the documented field order', () => {
      const secret = 'hmac_secret';
      const payload = {
        id: 'pay_1',
        amount_cents: '1500',
        created_at: '2026-08-05T00:00:00Z',
        currency: 'EGP',
        hmac: '',
        obj: {
          id: 'txn_1',
          created_at: '2026-08-05T00:00:00Z',
          currency: 'EGP',
          pending: false,
          transaction_id: 123,
          source_data: {
            pan: '1234',
            sub_type: 'CASH',
            type: 'CARD',
          },
        },
      };

      const expected = createHmac('sha512', secret)
        .update(
          [
            payload.amount_cents,
            payload.created_at,
            payload.currency,
            payload.id,
            payload.obj.id,
            payload.obj.created_at,
            payload.obj.currency,
            payload.obj.pending,
            payload.obj.source_data.pan,
            payload.obj.source_data.sub_type,
            payload.obj.source_data.type,
            payload.obj.transaction_id,
          ].join(''),
        )
        .digest('hex');

      const provider = new PaymobProvider({ mode: 'live', apiKey: 'sk', webhookSecret: secret });
      expect(
        provider.verifyWebhookSignature(JSON.stringify({ ...payload, hmac: expected }), expected),
      ).toBe(true);
    });

    it('should reject an invalid Paymob HMAC', () => {
      const provider = new PaymobProvider({ mode: 'live', apiKey: 'sk', webhookSecret: 'secret' });
      expect(provider.verifyWebhookSignature(JSON.stringify({ id: 1, hmac: 'deadbeef' }), '')).toBe(
        false,
      );
    });
  });

  describe('parseWebhookEvent', () => {
    let provider: PaymobProvider;

    beforeEach(() => {
      provider = new PaymobProvider();
    });

    it('should map a successful transaction.updated', () => {
      const event = provider.parseWebhookEvent({
        type: 'transaction.updated',
        amount_cents: 1500,
        currency: 'EGP',
        obj: { id: 'txn_1', pending: false, success: true, order: { id: 'order_1' } },
      });
      expect(event?.type).toBe('payment.succeeded');
      expect(event?.reference).toBe('order_1');
      expect(event?.amount).toBe(15);
    });

    it('should map a failed transaction.updated', () => {
      const event = provider.parseWebhookEvent({
        type: 'transaction.updated',
        amount_cents: 1500,
        currency: 'EGP',
        obj: { id: 'txn_1', pending: false, success: false, order: { id: 'order_1' } },
      });
      expect(event?.type).toBe('payment.failed');
    });

    it('should ignore pending transactions', () => {
      const event = provider.parseWebhookEvent({
        type: 'transaction.updated',
        obj: { id: 'txn_1', pending: true },
      });
      expect(event).toBeNull();
    });

    it('should map refund.transaction.updated', () => {
      const event = provider.parseWebhookEvent({
        type: 'refund.transaction.updated',
        amount_cents: 1500,
        obj: {
          id: 'txn_1',
          transaction_id: 123,
          order: { id: 'order_1' },
          source_data: { type: 'REFUND', amount: '500' },
        },
      });
      expect(event?.type).toBe('refund.succeeded');
      expect(event?.reference).toBe('order_1');
      expect(event?.refundedAmount).toBe(5);
      expect(event?.refundedAmountIsTotal).toBe(false);
    });
  });
});
