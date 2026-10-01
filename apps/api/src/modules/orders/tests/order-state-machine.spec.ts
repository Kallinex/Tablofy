import { OrderStatus, isKitchenTracked } from '../order-state-machine';

describe('isKitchenTracked', () => {
  it('tracks the statuses that belong on the kitchen board', () => {
    expect(isKitchenTracked(OrderStatus.CONFIRMED)).toBe(true);
    expect(isKitchenTracked(OrderStatus.IN_PREPARATION)).toBe(true);
    expect(isKitchenTracked(OrderStatus.READY)).toBe(true);
  });

  it('does not track pre-kitchen, terminal, or unknown statuses', () => {
    expect(isKitchenTracked(OrderStatus.DRAFT)).toBe(false);
    expect(isKitchenTracked(OrderStatus.SERVED)).toBe(false);
    expect(isKitchenTracked(OrderStatus.COMPLETED)).toBe(false);
    expect(isKitchenTracked('UNKNOWN')).toBe(false);
  });
});
