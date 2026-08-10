import {
  WEBHOOK_EVENT_NAMES,
  WEBHOOK_EVENT_ALIASES,
  normalizeWebhookEventName,
  isValidWebhookEventName,
  webhookEventCandidates,
} from '../webhook-events';

describe('webhook-events', () => {
  describe('WEBHOOK_EVENT_NAMES', () => {
    it('contains every emitted event family (payments, orders, campaigns, crm)', () => {
      expect(WEBHOOK_EVENT_NAMES).toEqual(
        expect.arrayContaining([
          'payments.completed',
          'payments.failed',
          'payments.refunded',
          'order.created',
          'order.updated',
          'order.completed',
          'order.cancelled',
          'order.refunded',
          'order.split',
          'orders.merged',
          'order.duplicated',
          'order.deleted',
          'campaign.created',
          'campaign.executed',
          'promotion.used',
          'crm.timeline.added',
          'crm.communication.sent',
        ]),
      );
    });

    it('contains no duplicates', () => {
      expect(new Set(WEBHOOK_EVENT_NAMES).size).toBe(WEBHOOK_EVENT_NAMES.length);
    });

    it('is readonly and non-empty', () => {
      expect(WEBHOOK_EVENT_NAMES.length).toBeGreaterThan(0);
      expect(Object.isFrozen(WEBHOOK_EVENT_NAMES)).toBe(true);
    });
  });

  describe('normalizeWebhookEventName', () => {
    it('returns canonical names unchanged', () => {
      expect(normalizeWebhookEventName('order.completed')).toBe('order.completed');
      expect(normalizeWebhookEventName('payments.completed')).toBe('payments.completed');
    });

    it('maps legacy plural order aliases to canonical singular', () => {
      expect(normalizeWebhookEventName('orders.created')).toBe('order.created');
      expect(normalizeWebhookEventName('orders.completed')).toBe('order.completed');
      expect(normalizeWebhookEventName('orders.cancelled')).toBe('order.cancelled');
      expect(normalizeWebhookEventName('orders.deleted')).toBe('order.deleted');
    });

    it('maps singular order.merged to canonical orders.merged', () => {
      expect(normalizeWebhookEventName('order.merged')).toBe('orders.merged');
    });

    it('returns undefined for unknown events', () => {
      expect(normalizeWebhookEventName('customers.created')).toBeUndefined();
      expect(normalizeWebhookEventName('inventory.low_stock')).toBeUndefined();
      expect(normalizeWebhookEventName('nonsense.event')).toBeUndefined();
      expect(normalizeWebhookEventName('')).toBeUndefined();
    });
  });

  describe('isValidWebhookEventName', () => {
    it('accepts canonical and legacy aliases', () => {
      expect(isValidWebhookEventName('order.completed')).toBe(true);
      expect(isValidWebhookEventName('orders.completed')).toBe(true);
    });

    it('rejects unknown events', () => {
      expect(isValidWebhookEventName('customers.created')).toBe(false);
      expect(isValidWebhookEventName('foo')).toBe(false);
    });
  });

  describe('webhookEventCandidates', () => {
    it('returns canonical plus aliases targeting it', () => {
      const candidates = webhookEventCandidates('order.completed');
      expect(candidates).toContain('order.completed');
      expect(candidates).toContain('orders.completed');
    });

    it('returns only the canonical name when no aliases target it', () => {
      expect(webhookEventCandidates('payments.completed')).toEqual(['payments.completed']);
    });

    it('does not mutate the alias table', () => {
      const before = Object.keys(WEBHOOK_EVENT_ALIASES).length;
      webhookEventCandidates('order.created');
      expect(Object.keys(WEBHOOK_EVENT_ALIASES).length).toBe(before);
    });
  });
});
