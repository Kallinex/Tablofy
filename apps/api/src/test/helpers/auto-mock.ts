/**
 * Recursive auto-mock used to boot controllers without hand-written stubs.
 *
 * Every node is a callable jest mock wrapped in a proxy, so chained access
 * (`prisma.restaurant.findFirst`) keeps resolving to further mocks and records
 * each call. Well-known properties are special-cased so the proxy behaves like
 * a benign value instead of an exotic object:
 *  - `then` returns undefined so the node is not treated as a thenable
 *    (otherwise every `await this.service.x()` would hang forever).
 *  - `toJSON` returns `{}` so JSON.stringify does not recurse infinitely.
 *  - `Symbol.toPrimitive` / `Symbol.iterator` keep template literals
 *    (`${value}`) and `for..of` over a mocked result working.
 *  - jest's own API (`mockReturnValue`, `mock`, ...) passes through untouched.
 */
export interface RecordedCall {
  path: string;
  args: unknown[];
}

const JEST_MEMBERS = new Set([
  '_isMockFunction',
  'calledWith',
  'calledTimes',
  'getMockName',
  'mock',
  'mockClear',
  'mockImplementation',
  'mockImplementationOnce',
  'mockName',
  'mockReset',
  'mockResolvedValue',
  'mockResolvedValueOnce',
  'mockRejectedValue',
  'mockRejectedValueOnce',
  'mockRestore',
  'mockReturnThis',
  'mockReturnValue',
  'mockReturnValueOnce',
]);

export function createAutoMock(registry: RecordedCall[], path: string): never {
  const cache = new Map<string, unknown>();

  const call = jest.fn((...args: unknown[]) => {
    registry.push({ path, args });
    return createAutoMock(registry, `${path}()`);
  });

  return new Proxy(call, {
    get(target, prop) {
      if (typeof prop === 'symbol') {
        if (prop === Symbol.toPrimitive) {
          return () => 'mocked';
        }
        if (prop === Symbol.iterator) {
          return function* emptyIterator() {
            return undefined;
          };
        }
        return undefined;
      }
      if (prop === 'then' || prop === 'constructor') {
        return undefined;
      }
      if (prop === 'toJSON') {
        return () => ({});
      }
      if (JEST_MEMBERS.has(prop)) {
        const value = (target as unknown as Record<string, unknown>)[prop];
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      }
      if (!cache.has(prop)) {
        cache.set(prop, createAutoMock(registry, `${path}.${prop}`));
      }
      return cache.get(prop);
    },
  }) as never;
}

export function createAutoMockRegistry(): RecordedCall[] {
  return [];
}
