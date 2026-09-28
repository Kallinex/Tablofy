import { createHmac } from 'crypto';
import { StripeProvider } from '../../providers/stripe.provider';
import { PaymobProvider } from '../../providers/paymob.provider';

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

  describe('test mode', () => {
    it('should throw when constructed in test mode without a secret key', () => {
      expect(() => new StripeProvider({ mode: 'test' })).toThrow(/secretKey/);
    });

    it('should report test mode and call the real Stripe API, not return mock data', async () => {
      const captured: Array<Record<string, unknown>> = [];
      const http = {
        request: async (opts: Record<string, unknown>) => {
          captured.push(opts);
          return {
            data: { id: 'pi_test_1', client_secret: 'cs_test_1', status: 'requires_confirmation' },
          };
        },
      } as never;

      const provider = new StripeProvider({
        mode: 'test',
        secretKey: 'sk_test_123',
        webhookSecret: 'whsec_test',
        http,
      });
      expect(provider.mode).toBe('test');

      await provider.initialize({ tenantId: 'tenant-1', settings: {} });
      const result = await provider.createPaymentIntent(
        { amount: 1234, currency: 'USD', description: 'Test' },
        'idem-test-1',
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        id: 'pi_test_1',
        clientSecret: 'cs_test_1',
        status: 'requires_confirmation',
      });

      const req = captured[0] as { headers: Record<string, string>; data: string };
      expect(req.headers.Authorization).toBe('Bearer sk_test_123');
      expect(req.headers['Idempotency-Key']).toBe('idem-test-1');
      expect(req.data).toContain('amount=1234');
    });

    it('should hit the Stripe balance endpoint for health checks in test mode', async () => {
      const captured: Array<Record<string, unknown>> = [];
      const http = {
        request: async (opts: Record<string, unknown>) => {
          captured.push(opts);
          return { data: { available: [] } };
        },
      } as never;

      const provider = new StripeProvider({
        mode: 'test',
        secretKey: 'sk_test_123',
        webhookSecret: 'whsec_test',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const health = await provider.healthCheck();
      expect(health.success).toBe(true);
      expect(health.data?.status).toBe('healthy');

      const req = captured[0] as { url: string };
      expect(req.url).toBe('/v1/balance');
    });

    it('should map confirmed intent status in test mode', async () => {
      const http = {
        request: async () => ({ data: { id: 'pi_test_1', status: 'succeeded' } }),
      } as never;
      const provider = new StripeProvider({
        mode: 'test',
        secretKey: 'sk_test_123',
        webhookSecret: 'whsec_test',
        http,
      });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.confirmPayment('pi_test_1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: 'succeeded', transactionId: 'pi_test_1' });
    });
  });

  describe('verifyWebhookSignature', () => {
    const buildProvider = (webhookSecret = 'whsec_test') =>
      new StripeProvider({
        mode: 'live',
        secretKey: 'sk_live_123',
        webhookSecret,
      });

    const sign = (secret: string, timestamp: string, payload: string) =>
      createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

    it('should accept a valid Stripe signature', () => {
      const secret = 'whsec_test';
      const payload = '{"type":"payment_intent.succeeded"}';
      const timestamp = String(Math.floor(Date.now() / 1000));

      const expected = sign(secret, timestamp, payload);
      expect(
        buildProvider(secret).verifyWebhookSignature(payload, `t=${timestamp},v1=${expected}`),
      ).toBe(true);
    });

    it('should reject an invalid Stripe signature', () => {
      const payload = '{"x":1}';
      const timestamp = String(Math.floor(Date.now() / 1000));
      expect(buildProvider().verifyWebhookSignature(payload, `t=${timestamp},v1=deadbeef`)).toBe(
        false,
      );
    });

    it('should reject when webhook secret is not configured', () => {
      const provider = new StripeProvider();
      const timestamp = String(Math.floor(Date.now() / 1000));
      expect(provider.verifyWebhookSignature('{}', `t=${timestamp},v1=abc`)).toBe(false);
    });

    it('should reject a correctly signed but stale timestamp (replay window)', () => {
      const secret = 'whsec_test';
      const payload = '{"type":"payment_intent.succeeded"}';
      // Signature is cryptographically valid, but captured 2 hours ago.
      const stale = String(Math.floor(Date.now() / 1000) - 7200);
      const expected = sign(secret, stale, payload);

      expect(
        buildProvider(secret).verifyWebhookSignature(payload, `t=${stale},v1=${expected}`),
      ).toBe(false);
    });

    it('should accept a timestamp inside the configured tolerance', () => {
      const secret = 'whsec_test';
      const payload = '{"type":"payment_intent.succeeded"}';
      const recent = String(Math.floor(Date.now() / 1000) - 60);
      const expected = sign(secret, recent, payload);

      expect(
        buildProvider(secret).verifyWebhookSignature(payload, `t=${recent},v1=${expected}`),
      ).toBe(true);
    });

    it('should honour a custom tolerance window', () => {
      const secret = 'whsec_test';
      const payload = '{"type":"payment_intent.succeeded"}';
      const stale = String(Math.floor(Date.now() / 1000) - 120);
      const expected = sign(secret, stale, payload);
      const provider = new StripeProvider({
        mode: 'live',
        secretKey: 'sk_live_123',
        webhookSecret: secret,
        webhookToleranceSeconds: 600,
      });

      expect(provider.verifyWebhookSignature(payload, `t=${stale},v1=${expected}`)).toBe(true);
    });

    it('should accept a signature matching any v1 during secret rotation', () => {
      const secret = 'whsec_test';
      const oldSecret = 'whsec_old';
      const payload = '{"type":"payment_intent.succeeded"}';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const rotated = `t=${timestamp},v1=${sign(oldSecret, timestamp, payload)},v1=${sign(
        secret,
        timestamp,
        payload,
      )}`;

      expect(buildProvider(secret).verifyWebhookSignature(payload, rotated)).toBe(true);
    });

    it('should reject a non-numeric timestamp', () => {
      const provider = buildProvider();
      expect(provider.verifyWebhookSignature('{"x":1}', 't=not-a-number,v1=abc')).toBe(false);
    });

    it('should reject a header with no v1 segment', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      expect(buildProvider().verifyWebhookSignature('{"x":1}', `t=${timestamp}`)).toBe(false);
    });

    it('should reject a payload that differs from the signed payload', () => {
      const secret = 'whsec_test';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const expected = sign(secret, timestamp, '{"amount_cents":100}');

      expect(
        buildProvider(secret).verifyWebhookSignature(
          '{"amount_cents":99999}',
          `t=${timestamp},v1=${expected}`,
        ),
      ).toBe(false);
    });
  });

  describe('getPaymentStatus amount units', () => {
    it('should return major units even though Stripe reports cents', async () => {
      const http = {
        request: async () => ({
          data: { id: 'pi_live_1', status: 'succeeded', amount: 5000, currency: 'usd' },
        }),
      } as never;
      const provider = new StripeProvider({ mode: 'live', secretKey: 'sk_live_123', http });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.getPaymentStatus('pi_live_1');

      // The PaymentProvider contract is major units, matching Payment.amount
      // and parseWebhookEvent. A raw 5000 here would make reconciliation
      // compare 500000 cents against an expected 5000.
      expect(result.data!.amount).toBe(50);
    });

    it('should keep a non-round cents value as a fraction in major units', async () => {
      const http = {
        request: async () => ({
          data: { id: 'pi_live_2', status: 'succeeded', amount: 4999, currency: 'usd' },
        }),
      } as never;
      const provider = new StripeProvider({ mode: 'live', secretKey: 'sk_live_123', http });
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });

      const result = await provider.getPaymentStatus('pi_live_2');

      expect(result.data!.amount).toBe(49.99);
    });

    it('should agree with the Paymob provider on the same underlying amount', async () => {
      // Both providers must expose the same major-unit contract so
      // reconciliation never needs a provider-specific conversion.
      const http = {
        request: async () => ({
          data: { id: 'pi_live_3', status: 'succeeded', amount: 1500, currency: 'usd' },
        }),
      } as never;
      const stripe = new StripeProvider({ mode: 'live', secretKey: 'sk_live_123', http });
      await stripe.initialize({ tenantId: 'tenant-1', settings: {} });

      const stripeStatus = await stripe.getPaymentStatus('pi_live_3');
      const paymobEvent = new PaymobProvider().parseWebhookEvent({
        type: 'transaction.updated',
        amount_cents: 1500,
        currency: 'egp',
        obj: { id: 1, pending: false, success: true, source_data: { type: 'wallet' } },
      });

      expect(stripeStatus.data!.amount).toBe(15);
      expect(paymobEvent?.amount).toBe(15);
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
      expect(event?.refundedAmountIsTotal).toBe(true);
    });

    it('should return null for unknown events', () => {
      expect(provider.parseWebhookEvent({ type: 'customer.created', data: {} })).toBeNull();
    });
  });
});
