import { createHmac } from 'crypto';
import { StripeProvider } from '../../providers/stripe.provider';

describe('StripeProvider', () => {
  describe('mock mode', () => {
    let provider: StripeProvider;

    beforeEach(() => {
      provider = new StripeProvider();
    });

    it('should default to mock mode', () => {
      expect(provider.mode).toBe('mock');
    });

    it('should initialize and report mock health', async () => {
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });
      const health = await provider.healthCheck();
      expect(health.success).toBe(true);
      expect(health.data?.status).toBe('mock');
    });

    it('should work without explicit initialization in mock mode', async () => {
      const result = await provider.createPaymentIntent({ amount: 1000, currency: 'usd' });
      expect(result.success).toBe(true);
      expect(result.data!.id).toContain('pi_mock_');
    });

    it('should confirm successfully in mock mode', async () => {
      const result = await provider.confirmPayment('pi_mock_123');
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('succeeded');
      expect(result.data!.transactionId).toContain('txn_mock_');
    });

    it('should refund successfully in mock mode', async () => {
      const result = await provider.refundPayment({ transactionId: 'txn_123' });
      expect(result.success).toBe(true);
      expect(result.data!.id).toContain('re_mock_');
    });

    it('should report status in mock mode', async () => {
      const result = await provider.getPaymentStatus('txn_123');
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('succeeded');
    });
  });

  describe('live mode', () => {
    it('should throw when constructed in live mode without a secret key', () => {
      expect(() => new StripeProvider({ mode: 'live' })).toThrow(/secretKey/);
    });

    it('should create a payment intent against the Stripe API with idempotency header', async () => {
      const captured: Array<Record<string, unknown>> = [];
      const http = {
        request: async (opts: Record<string, unknown>) => {
          captured.push(opts);
          return {
            data: { id: 'pi_live_1', client_secret: 'cs_1', status: 'requires_confirmation' },
          };
        },
      } as never;

      const provider = new StripeProvider({
        mode: 'live',
        secretKey: 'sk_live_123',
        webhookSecret: 'whsec_test',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.createPaymentIntent(
        { amount: 1234, currency: 'USD', description: 'Test' },
        'idem-1',
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        id: 'pi_live_1',
        clientSecret: 'cs_1',
        status: 'requires_confirmation',
      });

      const req = captured[0] as {
        method: string;
        url: string;
        headers: Record<string, string>;
        data: string;
      };
      expect(req.method).toBe('post');
      expect(req.url).toBe('/v1/payment_intents');
      expect(req.headers.Authorization).toBe('Bearer sk_live_123');
      expect(req.headers['Idempotency-Key']).toBe('idem-1');
      expect(req.data).toContain('amount=1234');
      expect(req.data).toContain('currency=usd');
    });

    it('should map confirmed intent status to succeeded', async () => {
      const http = {
        request: async () => ({ data: { id: 'pi_live_1', status: 'succeeded' } }),
      } as never;
      const provider = new StripeProvider({
        mode: 'live',
        secretKey: 'sk_live_123',
        webhookSecret: 'whsec_test',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.confirmPayment('pi_live_1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: 'succeeded', transactionId: 'pi_live_1' });
    });

    it('should map processing intent to pending', async () => {
      const http = {
        request: async () => ({ data: { id: 'pi_live_1', status: 'processing' } }),
      } as never;
      const provider = new StripeProvider({
        mode: 'live',
        secretKey: 'sk_live_123',
        webhookSecret: 'whsec_test',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.confirmPayment('pi_live_1');
      expect(result.data?.status).toBe('pending');
    });

    it('should refund against the Stripe API', async () => {
      const captured: Array<Record<string, unknown>> = [];
      const http = {
        request: async (opts: Record<string, unknown>) => {
          captured.push(opts);
          return { data: { id: 're_live_1', status: 'succeeded' } };
        },
      } as never;
      const provider = new StripeProvider({
        mode: 'live',
        secretKey: 'sk_live_123',
        webhookSecret: 'whsec_test',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.refundPayment(
        { transactionId: 'pi_live_1', amount: 500, reason: 'duplicate' },
        'refund-idem-1',
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 're_live_1', status: 'succeeded' });

      const req = captured[0] as { method: string; url: string; headers: Record<string, string> };
      expect(req.method).toBe('post');
      expect(req.url).toBe('/v1/refunds');
      expect(req.headers['Idempotency-Key']).toBe('refund-idem-1');
    });

    it('should omit a refund reason that is not a valid Stripe reason', async () => {
      const captured: Array<Record<string, unknown>> = [];
      const http = {
        request: async (opts: Record<string, unknown>) => {
          captured.push(opts);
          return { data: { id: 're_live_2', status: 'succeeded' } };
        },
      } as never;
      const provider = new StripeProvider({
        mode: 'live',
        secretKey: 'sk_live_123',
        webhookSecret: 'whsec_test',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.refundPayment({
        transactionId: 'pi_live_1',
        reason: 'Customer changed their mind',
      });
      expect(result.success).toBe(true);

      const req = captured[0] as { data: string };
      expect(req.data).not.toContain('reason=');
    });

    it('should void a payment intent via cancel', async () => {
      const captured: Array<Record<string, unknown>> = [];
      const http = {
        request: async (opts: Record<string, unknown>) => {
          captured.push(opts);
          return { data: { id: 'pi_live_1', status: 'canceled' } };
        },
      } as never;
      const provider = new StripeProvider({
        mode: 'live',
        secretKey: 'sk_live_123',
        webhookSecret: 'whsec_test',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.voidPayment('pi_live_1', 'void-idem-1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'pi_live_1', status: 'canceled' });

      const req = captured[0] as { method: string; url: string; headers: Record<string, string> };
      expect(req.method).toBe('post');
      expect(req.url).toBe('/v1/payment_intents/pi_live_1/cancel');
      expect(req.headers['Idempotency-Key']).toBe('void-idem-1');
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should accept a valid Stripe signature', () => {
      const secret = 'whsec_test';
      const payload = '{"type":"payment_intent.succeeded"}';
      const timestamp = '1700000000';

      const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
      const provider = new StripeProvider({
        mode: 'live',
        secretKey: 'sk_live_123',
        webhookSecret: secret,
      });
      expect(provider.verifyWebhookSignature(payload, `t=${timestamp},v1=${expected}`)).toBe(true);
    });

    it('should reject an invalid Stripe signature', () => {
      const provider = new StripeProvider({
        mode: 'live',
        secretKey: 'sk_live_123',
        webhookSecret: 'whsec_test',
      });
      expect(provider.verifyWebhookSignature('{"x":1}', 't=1700000000,v1=deadbeef')).toBe(false);
    });

    it('should reject when webhook secret is not configured', () => {
      const provider = new StripeProvider();
      expect(provider.verifyWebhookSignature('{}', 't=1,v1=abc')).toBe(false);
    });
  });

  describe('parseWebhookEvent', () => {
    let provider: StripeProvider;

    beforeEach(() => {
      provider = new StripeProvider({ mode: 'live', secretKey: 'sk_live_123' });
    });

    it('should map payment_intent.succeeded', () => {
      const event = provider.parseWebhookEvent({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', amount: 5000, currency: 'usd' } },
      });
      expect(event).toEqual({
        provider: 'stripe',
        type: 'payment.succeeded',
        reference: 'pi_1',
        amount: 50,
        currency: 'USD',
        raw: expect.anything(),
      });
    });

    it('should map payment failure', () => {
      const event = provider.parseWebhookEvent({
        type: 'payment_intent.payment_failed',
        data: { object: { id: 'pi_1' } },
      });
      expect(event?.type).toBe('payment.failed');
      expect(event?.reference).toBe('pi_1');
    });

    it('should map partial charge refund', () => {
      const event = provider.parseWebhookEvent({
        type: 'charge.refunded',
        data: {
          object: { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 1000 },
        },
      });
      expect(event?.type).toBe('refund.partial');
      expect(event?.reference).toBe('pi_1');
      expect(event?.refundedAmount).toBe(10);
    });

    it('should return null for unknown events', () => {
      expect(provider.parseWebhookEvent({ type: 'customer.created', data: {} })).toBeNull();
    });
  });
});
