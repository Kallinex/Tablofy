export function createMockCache() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    deletePattern: jest.fn().mockResolvedValue(undefined),
    invalidateTenantCache: jest.fn().mockResolvedValue(undefined),
    getOrSet: jest
      .fn()
      .mockImplementation(
        async (_tenantId: string, _key: string, factory: () => Promise<unknown>) => {
          return factory();
        },
      ),
    reset() {
      for (const key of Object.keys(this)) {
        if (jest.isMockFunction((this as Record<string, unknown>)[key])) {
          ((this as Record<string, unknown>)[key] as jest.Mock).mockClear();
        }
      }
    },
  };
}

export type MockCache = ReturnType<typeof createMockCache>;
