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

/**
 * QueueService test double that also records the BullMQ worker handlers
 * registered by processor constructors, so specs can invoke them directly.
 */
export function createMockQueueService() {
  const handlers = new Map<string, (job: unknown) => Promise<unknown>>();

  const service = {
    registerWorker: jest.fn((name: string, handler: (job: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    }),
    add: jest.fn().mockResolvedValue({ id: 'mock-job-1', data: {} }),
    addJob: jest.fn().mockResolvedValue({ id: 'mock-job-1', data: {} }),
    addBulk: jest.fn().mockResolvedValue([]),
    getJob: jest.fn().mockResolvedValue(null),
    getHandler(name: string): (job: unknown) => Promise<unknown> {
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error(`No worker registered for queue: ${name}`);
      }
      return handler;
    },
    registeredNames(): string[] {
      return Array.from(handlers.keys());
    },
    reset() {
      for (const key of Object.keys(service)) {
        if (jest.isMockFunction((service as Record<string, unknown>)[key])) {
          ((service as Record<string, unknown>)[key] as jest.Mock).mockClear();
        }
      }
    },
  };

  return service;
}

export type MockQueueService = ReturnType<typeof createMockQueueService>;
