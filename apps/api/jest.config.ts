import type { Config } from 'jest';

const config: Config = {
  displayName: 'api',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.integration.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.jest.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@tablofy/shared/types$': '<rootDir>/../../libs/shared/types/src/index.ts',
    '^@tablofy/shared/constants$': '<rootDir>/../../libs/shared/constants/src/index.ts',
    '^@tablofy/shared/utils$': '<rootDir>/../../libs/shared/utils/src/index.ts',
    '^bullmq$': '<rootDir>/src/test/mocks/bullmq.mock.ts',
    '^uuid$': '<rootDir>/src/test/mocks/uuid.mock.ts',
  },
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/*.module.ts',
    '!<rootDir>/src/modules/payments/providers/*.ts',
    '!<rootDir>/src/**/*.interface.ts',
    '!<rootDir>/src/main.ts',
    '!<rootDir>/src/test/**',
  ],
  coverageDirectory: '<rootDir>/../../coverage',
  coverageReporters: ['text', 'lcov', 'clover'],
  coverageThreshold: {
    '**/src/common/decorators/current-user.decorator.ts': {
      branches: 46,
      functions: 95,
      lines: 82,
      statements: 82,
    },
    '**/src/common/decorators/public.decorator.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    '**/src/common/decorators/roles.decorator.ts': {
      branches: 90,
      functions: 0,
      lines: 65,
      statements: 70,
    },
    '**/src/common/decorators/skip-tenant.decorator.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    '**/src/common/filters/*.ts': { branches: 65, functions: 90, lines: 90, statements: 90 },
    '**/src/common/guards/*.ts': { branches: 65, functions: 40, lines: 85, statements: 85 },
    '**/src/common/interceptors/audit-log.interceptor.ts': {
      branches: 50,
      functions: 90,
      lines: 80,
      statements: 85,
    },
    '**/src/common/services/*.ts': { branches: 50, functions: 70, lines: 70, statements: 70 },
    '**/src/modules/audit-logs/audit-logs.service.ts': {
      branches: 76,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    '**/src/modules/auth/auth.service.ts': {
      branches: 72,
      functions: 95,
      lines: 90,
      statements: 90,
    },
    '**/src/modules/auth/auth.controller.ts': {
      branches: 50,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    '**/src/modules/auth/strategies/*.ts': {
      branches: 70,
      functions: 90,
      lines: 85,
      statements: 85,
    },
    '**/src/modules/barcodes/barcode.service.ts': {
      branches: 70,
      functions: 90,
      lines: 92,
      statements: 92,
    },
    '**/src/modules/crm/crm.service.ts': {
      branches: 85,
      functions: 95,
      lines: 90,
      statements: 90,
    },
    '**/src/modules/customer-analytics/customer-analytics.service.ts': {
      branches: 75,
      functions: 95,
      lines: 80,
      statements: 80,
    },
    '**/src/modules/customers/customers.service.ts': {
      branches: 75,
      functions: 95,
      lines: 80,
      statements: 80,
    },
    '**/src/modules/inventory/inventory.service.ts': {
      branches: 74,
      functions: 95,
      lines: 78,
      statements: 78,
    },
    '**/src/modules/inventory-analytics/inventory-analytics.service.ts': {
      branches: 65,
      functions: 95,
      lines: 70,
      statements: 70,
    },
    '**/src/modules/orders/orders.service.ts': {
      branches: 68,
      functions: 95,
      lines: 75,
      statements: 75,
    },
    '**/src/modules/orders/order-state-machine.ts': {
      branches: 90,
      functions: 70,
      lines: 85,
      statements: 85,
    },
    '**/src/modules/sales-analytics/sales-analytics.service.ts': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    '**/src/modules/tenants/tenants.service.ts': {
      branches: 60,
      functions: 95,
      lines: 88,
      statements: 88,
    },
    '**/src/modules/users/users.service.ts': {
      branches: 70,
      functions: 95,
      lines: 88,
      statements: 88,
    },
    '**/src/modules/payments/payments.service.ts': {
      branches: 70,
      functions: 95,
      lines: 82,
      statements: 82,
    },
    '**/src/modules/payments/payment-state-machine.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    '**/src/prisma/prisma.service.ts': { branches: 90, functions: 70, lines: 80, statements: 80 },
    '**/src/redis/redis.service.ts': {
      branches: 64,
      functions: 90,
      lines: 86,
      statements: 86,
    },
    // Config factories read process.env with `??`/`||` fallbacks, so a plain
    // `registerAs` export leaves every one of those branches untouched.
    '**/src/config/*.config.ts': { branches: 90, functions: 95, lines: 95, statements: 95 },
  },
  setupFiles: ['<rootDir>/src/test/setup/global-test-setup.ts'],
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
};

export default config;
