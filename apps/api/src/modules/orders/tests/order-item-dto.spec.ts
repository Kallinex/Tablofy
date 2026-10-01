import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderDto } from '../dto/update-order.dto';

const UUID = '3f6c1e4a-9b2d-4c7e-8a1b-2d3e4f5a6b7c';

function createItem(overrides: Record<string, unknown> = {}) {
  return {
    productId: UUID,
    productName: 'Koshari',
    quantity: 1,
    unitPrice: 120,
    ...overrides,
  };
}

function createOrder(overrides: Record<string, unknown> = {}) {
  return {
    restaurantId: UUID,
    branchId: UUID,
    items: [createItem()],
    ...overrides,
  };
}

function errorsFor(cls: new () => object, payload: Record<string, unknown>) {
  const instance = plainToInstance(cls, payload);
  return validateSync(instance as object, { whitelist: false, forbidUnknownValues: false });
}

// alidateSync nests child errors under .children, so flatten the tree before asserting.
function flatten(errorList: ReturnType<typeof errorsFor>): ReturnType<typeof errorsFor> {
  return errorList.flatMap((error) => [error, ...flatten(error.children ?? [])]);
}

describe('CreateOrderDto nested items and modifiers', () => {
  it('accepts an order with no modifiers at all', () => {
    expect(errorsFor(CreateOrderDto, createOrder())).toHaveLength(0);
  });

  it('accepts an explicitly empty modifier list', () => {
    expect(
      errorsFor(CreateOrderDto, createOrder({ items: [createItem({ modifiers: [] })] })),
    ).toHaveLength(0);
  });

  it('accepts a fully populated modifier', () => {
    const payload = createOrder({
      items: [
        createItem({
          modifiers: [{ modifierId: UUID, name: 'Extra cheese', quantity: 2, price: 15 }],
        }),
      ],
    });

    expect(errorsFor(CreateOrderDto, payload)).toHaveLength(0);
  });

  it('accepts a modifier carrying only the required name and price', () => {
    const payload = createOrder({
      items: [createItem({ modifiers: [{ name: 'No onions', price: 0 }] })],
    });

    expect(errorsFor(CreateOrderDto, payload)).toHaveLength(0);
  });

  it('rejects a modifier missing its name', () => {
    const payload = createOrder({
      items: [createItem({ modifiers: [{ price: 10 }] })],
    });

    const errors = flatten(errorsFor(CreateOrderDto, payload));
    expect(errors.some((error) => error.constraints?.isString)).toBe(true);
  });

  it('rejects a modifier missing its price', () => {
    const payload = createOrder({
      items: [createItem({ modifiers: [{ name: 'Sauce' }] })],
    });

    expect(errorsFor(CreateOrderDto, payload).length).toBeGreaterThan(0);
  });

  it('rejects a zero modifier quantity', () => {
    const payload = createOrder({
      items: [createItem({ modifiers: [{ name: 'Sauce', quantity: 0, price: 5 }] })],
    });

    const errors = flatten(errorsFor(CreateOrderDto, payload));
    expect(errors.some((error) => error.constraints?.min)).toBe(true);
  });

  it('rejects a negative modifier price', () => {
    const payload = createOrder({
      items: [createItem({ modifiers: [{ name: 'Discount', price: -1 }] })],
    });

    expect(errorsFor(CreateOrderDto, payload).length).toBeGreaterThan(0);
  });

  it('rejects a non-numeric modifier quantity', () => {
    const payload = createOrder({
      items: [createItem({ modifiers: [{ name: 'Sauce', quantity: 'two', price: 5 }] })],
    });

    expect(errorsFor(CreateOrderDto, payload).length).toBeGreaterThan(0);
  });

  it('accepts any string as a modifier id, matching the declared @IsString contract', () => {
    const payload = createOrder({
      items: [createItem({ modifiers: [{ modifierId: 'modifier-42', name: 'Sauce', price: 5 }] })],
    });

    expect(errorsFor(CreateOrderDto, payload)).toHaveLength(0);
  });
  it('rejects a scalar in place of a modifier object', () => {
    const payload = createOrder({ items: [createItem({ modifiers: ['extra-cheese'] })] });

    expect(errorsFor(CreateOrderDto, payload).length).toBeGreaterThan(0);
  });

  it('reports nested modifier errors against the items path', () => {
    const payload = createOrder({
      items: [createItem({ modifiers: [{ name: 'Sauce', price: -5 }] })],
    });

    const errors = errorsFor(CreateOrderDto, payload);
    expect(errors.some((error) => error.property === 'items')).toBe(true);
  });

  it('still rejects an order with no items', () => {
    const errors = errorsFor(CreateOrderDto, createOrder({ items: [] }));

    expect(errors.some((error) => error.constraints?.arrayMinSize)).toBe(true);
  });
});

describe('UpdateOrderDto nested items and modifiers', () => {
  function updateOrder(overrides: Record<string, unknown> = {}) {
    return { items: [createItem()], ...overrides };
  }

  it('accepts a partial update with no modifiers', () => {
    expect(errorsFor(UpdateOrderDto, updateOrder())).toHaveLength(0);
  });

  it('accepts an empty payload when every field is optional', () => {
    expect(errorsFor(UpdateOrderDto, {})).toHaveLength(0);
  });

  it('accepts a fully populated modifier', () => {
    const payload = updateOrder({
      items: [createItem({ modifiers: [{ name: 'Extra tahina', price: 8, quantity: 1 }] })],
    });

    expect(errorsFor(UpdateOrderDto, payload)).toHaveLength(0);
  });

  it('rejects a modifier missing its name', () => {
    const payload = updateOrder({ items: [createItem({ modifiers: [{ price: 8 }] })] });

    expect(errorsFor(UpdateOrderDto, payload).length).toBeGreaterThan(0);
  });

  it('rejects a zero modifier quantity', () => {
    const payload = updateOrder({
      items: [createItem({ modifiers: [{ name: 'Extra tahina', quantity: 0, price: 8 }] })],
    });

    expect(errorsFor(UpdateOrderDto, payload).length).toBeGreaterThan(0);
  });

  it('rejects a negative modifier price', () => {
    const payload = updateOrder({
      items: [createItem({ modifiers: [{ name: 'Bad', price: -3 }] })],
    });

    expect(errorsFor(UpdateOrderDto, payload).length).toBeGreaterThan(0);
  });

  it('rejects a scalar in place of a modifier object', () => {
    const payload = updateOrder({ items: [createItem({ modifiers: [42] })] });

    expect(errorsFor(UpdateOrderDto, payload).length).toBeGreaterThan(0);
  });
});
