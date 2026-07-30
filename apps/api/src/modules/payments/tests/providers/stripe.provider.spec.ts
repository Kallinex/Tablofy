import { StripeProvider } from '../../providers/stripe.provider';

describe('StripeProvider', () => {
  let provider: StripeProvider;

  beforeEach(() => {
    provider = new StripeProvider();
  });

  describe('initialize', () => {
    it('should configure the provider', async () => {
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });
      const health = await provider.healthCheck();
      expect(health.success).toBe(true);
    });
  });

  describe('validateConnection', () => {
    it('should return success when initialized', async () => {
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });
      const result = await provider.validateConnection();
      expect(result.success).toBe(true);
    });

    it('should return failure when not initialized', async () => {
      const result = await provider.validateConnection();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Provider not initialized');
    });
  });

  describe('createPaymentIntent', () => {
    it('should return success with intent data', async () => {
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });
      const result = await provider.createPaymentIntent({
        amount: 1000,
        currency: 'usd',
      });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.id).toContain('pi_mock_');
    });

    it('should fail when not initialized', async () => {
      const result = await provider.createPaymentIntent({ amount: 1000, currency: 'usd' });
      expect(result.success).toBe(false);
    });
  });

  describe('confirmPayment', () => {
    it('should return success with transaction', async () => {
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });
      const result = await provider.confirmPayment('pi_mock_123');
      expect(result.success).toBe(true);
      expect(result.data!.transactionId).toContain('txn_mock_');
    });
  });

  describe('refundPayment', () => {
    it('should process full refund', async () => {
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });
      const result = await provider.refundPayment({ transactionId: 'txn_123' });
      expect(result.success).toBe(true);
      expect(result.data!.id).toContain('re_mock_');
    });
  });

  describe('getPaymentStatus', () => {
    it('should return status', async () => {
      await provider.initialize({ tenantId: 'tenant-1', settings: {} });
      const result = await provider.getPaymentStatus('txn_123');
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('succeeded');
    });
  });
});
