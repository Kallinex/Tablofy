export function createMockEventEmitter() {
  return {
    emit: jest.fn().mockReturnValue(true),
    emitAsync: jest.fn().mockResolvedValue([true]),
    on: jest.fn().mockReturnValue(undefined),
    once: jest.fn().mockReturnValue(undefined),
    off: jest.fn().mockReturnValue(undefined),
    removeAllListeners: jest.fn().mockReturnValue(undefined),
    listeners: jest.fn().mockReturnValue([]),
    reset() {
      for (const key of Object.keys(this)) {
        if (jest.isMockFunction((this as Record<string, unknown>)[key])) {
          ((this as Record<string, unknown>)[key] as jest.Mock).mockClear();
        }
      }
    },
  };
}

export type MockEventEmitter = ReturnType<typeof createMockEventEmitter>;
