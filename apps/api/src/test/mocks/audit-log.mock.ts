export function createMockAuditLogs() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    reset() {
      for (const key of Object.keys(this)) {
        if (jest.isMockFunction((this as Record<string, unknown>)[key])) {
          ((this as Record<string, unknown>)[key] as jest.Mock).mockClear();
        }
      }
    },
  };
}

export type MockAuditLogs = ReturnType<typeof createMockAuditLogs>;
