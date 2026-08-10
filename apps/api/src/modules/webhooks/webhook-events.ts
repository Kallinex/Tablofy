export const WEBHOOK_EVENT_NAMES: ReadonlyArray<string> = Object.freeze([
  'order.created',
  'order.updated',
  'order.pending',
  'order.confirmed',
  'order.in_preparation',
  'order.ready',
  'order.served',
  'order.completed',
  'order.cancelled',
  'order.refunded',
  'order.voided',
  'order.split',
  'orders.merged',
  'order.duplicated',
  'order.deleted',
  'payments.completed',
  'payments.failed',
  'payments.refunded',
  'campaign.created',
  'campaign.updated',
  'campaign.executed',
  'promotion.used',
  'crm.timeline.added',
  'crm.communication.sent',
  'nutritionalInfo.created',
  'nutritionalInfo.updated',
  'nutritionalInfo.deleted',
  'variantGroup.created',
  'variantGroup.updated',
  'variantGroup.deleted',
  'productTag.created',
  'productTag.deleted',
  'productVariant.created',
  'productVariant.updated',
  'productVariant.deleted',
  'modifier.created',
  'modifier.updated',
  'modifier.deleted',
  'allergen.created',
  'allergen.deleted',
  'modifierGroup.created',
  'modifierGroup.updated',
  'modifierGroup.deleted',
  'productImage.created',
  'productImage.updated',
  'productImage.deleted',
  'product.created',
  'product.updated',
  'product.deleted',
  'menuCategory.created',
  'menuCategory.updated',
  'menuCategory.deleted',
  'productAvailability.created',
  'productAvailability.updated',
  'productAvailability.deleted',
  'diningArea.created',
  'diningArea.updated',
  'diningArea.deleted',
  'floor.created',
  'floor.updated',
  'floor.deleted',
  'table.created',
  'table.updated',
  'table.statusChanged',
  'table.deleted',
  'restaurant.created',
  'restaurant.updated',
  'restaurant.deleted',
  'branch.created',
  'branch.updated',
  'branch.deleted',
  'recovery.health-check',
  'recovery.started',
  'recovery.completed',
] as const);

export const WEBHOOK_EVENT_ALIASES: Readonly<Record<string, string>> = {
  'orders.created': 'order.created',
  'orders.updated': 'order.updated',
  'orders.completed': 'order.completed',
  'orders.cancelled': 'order.cancelled',
  'orders.refunded': 'order.refunded',
  'orders.voided': 'order.voided',
  'orders.split': 'order.split',
  'orders.duplicated': 'order.duplicated',
  'orders.deleted': 'order.deleted',
  'order.merged': 'orders.merged',
};

const CANONICAL_SET: ReadonlySet<string> = new Set(WEBHOOK_EVENT_NAMES);

export function normalizeWebhookEventName(name: string): string | undefined {
  if (CANONICAL_SET.has(name)) return name;
  const alias = WEBHOOK_EVENT_ALIASES[name];
  if (alias) return alias;
  return undefined;
}

export function isValidWebhookEventName(name: string): boolean {
  return normalizeWebhookEventName(name) !== undefined;
}

export function webhookEventCandidates(canonical: string): ReadonlyArray<string> {
  const candidates = [canonical];
  for (const [alias, target] of Object.entries(WEBHOOK_EVENT_ALIASES)) {
    if (target === canonical) candidates.push(alias);
  }
  return candidates;
}
