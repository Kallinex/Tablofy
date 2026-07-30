export function createMockQueue() {
  return {
    add: jest.fn().mockResolvedValue({ id: 'mock-job-1', data: {} }),
    addJob: jest.fn().mockResolvedValue({ id: 'mock-job-1', data: {} }),
    addBulk: jest.fn().mockResolvedValue([]),
    getJob: jest.fn().mockResolvedValue(null),
    getJobs: jest.fn().mockResolvedValue([]),
    getActive: jest.fn().mockResolvedValue([]),
    getWaiting: jest.fn().mockResolvedValue([]),
    getCompleted: jest.fn().mockResolvedValue([]),
    getFailed: jest.fn().mockResolvedValue([]),
    getDelayed: jest.fn().mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue(undefined),
    drain: jest.fn().mockResolvedValue(undefined),
    clean: jest.fn().mockResolvedValue([]),
    obliterate: jest.fn().mockResolvedValue(undefined),
    isPaused: jest.fn().mockResolvedValue(false),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    reset() {
      for (const key of Object.keys(this)) {
        if (jest.isMockFunction((this as Record<string, unknown>)[key])) {
          ((this as Record<string, unknown>)[key] as jest.Mock).mockClear();
        }
      }
    },
  };
}

export type MockQueue = ReturnType<typeof createMockQueue>;
