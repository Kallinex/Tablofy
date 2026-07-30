export function createMockRedis() {
  let store: Record<string, string> = {};

  return {
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
    getClient: jest.fn().mockResolvedValue({
      keys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1),
      pipeline: jest.fn().mockReturnValue({
        del: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    }),
    ping: jest.fn().mockResolvedValue('PONG'),
    blacklistToken: jest.fn().mockResolvedValue(undefined),
    isTokenBlacklisted: jest.fn().mockResolvedValue(false),
    setSession: jest.fn().mockResolvedValue(undefined),
    getSession: jest.fn().mockResolvedValue(null),
    deleteSession: jest.fn().mockResolvedValue(undefined),
    getUserSessionIds: jest.fn().mockResolvedValue([]),
    addUserSession: jest.fn().mockResolvedValue(undefined),
    removeUserSession: jest.fn().mockResolvedValue(undefined),
    deleteUserSessions: jest.fn().mockResolvedValue(undefined),
    setTemporaryToken: jest.fn().mockResolvedValue(undefined),
    getTemporaryToken: jest.fn().mockResolvedValue(null),
    deleteTemporaryToken: jest.fn().mockResolvedValue(undefined),
    incrementCounter: jest.fn().mockResolvedValue(1),
    getCounter: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockImplementation((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    get: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(store[key] ?? null);
    }),
    del: jest.fn().mockImplementation((...keys: string[]) => {
      for (const key of keys) delete store[key];
      return Promise.resolve();
    }),
    exists: jest.fn().mockResolvedValue(false),
    setHash: jest.fn().mockResolvedValue(undefined),
    getHash: jest.fn().mockResolvedValue(null),
    getAllHash: jest.fn().mockResolvedValue({}),
    reset() {
      store = {};
      for (const key of Object.keys(this)) {
        if (jest.isMockFunction((this as Record<string, unknown>)[key])) {
          ((this as Record<string, unknown>)[key] as jest.Mock).mockClear();
        }
      }
    },
  };
}

export type MockRedis = ReturnType<typeof createMockRedis>;
