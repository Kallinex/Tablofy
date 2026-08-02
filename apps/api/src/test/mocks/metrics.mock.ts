export interface MockMetrics {
  observeHttpDuration: jest.Mock;
  observeDbQuery: jest.Mock;
  observeRedisLatency: jest.Mock;
  observeBullJob: jest.Mock;
  setBullQueueDepth: jest.Mock;
  incrementOrdersCreated: jest.Mock;
  incrementOrdersCompleted: jest.Mock;
  addRevenue: jest.Mock;
  incrementInventoryMovements: jest.Mock;
  incrementKitchenTickets: jest.Mock;
  incrementPaymentsCompleted: jest.Mock;
  incrementPaymentsFailed: jest.Mock;
  incrementPaymentsRefunded: jest.Mock;
  incrementBullQueueDeadLetter: jest.Mock;
  getMetrics: jest.Mock;
}

export function createMockMetrics(): MockMetrics {
  return {
    observeHttpDuration: jest.fn(),
    observeDbQuery: jest.fn(),
    observeRedisLatency: jest.fn(),
    observeBullJob: jest.fn(),
    setBullQueueDepth: jest.fn(),
    incrementOrdersCreated: jest.fn(),
    incrementOrdersCompleted: jest.fn(),
    addRevenue: jest.fn(),
    incrementInventoryMovements: jest.fn(),
    incrementKitchenTickets: jest.fn(),
    incrementPaymentsCompleted: jest.fn(),
    incrementPaymentsFailed: jest.fn(),
    incrementPaymentsRefunded: jest.fn(),
    incrementBullQueueDeadLetter: jest.fn(),
    getMetrics: jest.fn().mockResolvedValue(''),
  };
}
