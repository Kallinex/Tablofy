export const BCRYPT_ROUNDS = 12;

export const USER_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  STAFF: 'STAFF',
  KITCHEN: 'KITCHEN',
  CASHIER: 'CASHIER',
  WAITER: 'WAITER',
  VIEWER: 'VIEWER',
} as const;

export const USER_STATUSES = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
  PENDING: 'PENDING',
} as const;

export const PLAN_TYPES = {
  FREE: 'FREE',
  BASIC: 'BASIC',
  STANDARD: 'STANDARD',
  PREMIUM: 'PREMIUM',
  ENTERPRISE: 'ENTERPRISE',
} as const;

export const SUBSCRIPTION_STATUSES = {
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELED: 'CANCELED',
  TRIALING: 'TRIALING',
  PAUSED: 'PAUSED',
} as const;

export const CURRENCIES = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  EGP: 'EGP',
  SAR: 'SAR',
  AED: 'AED',
} as const;

export const PLAN_LIMITS = {
  FREE: { maxUsers: 5, maxProducts: 100, maxTables: 10 },
  BASIC: { maxUsers: 15, maxProducts: 500, maxTables: 30 },
  STANDARD: { maxUsers: 50, maxProducts: 2000, maxTables: 100 },
  PREMIUM: { maxUsers: 200, maxProducts: 10000, maxTables: 500 },
  ENTERPRISE: { maxUsers: -1, maxProducts: -1, maxTables: -1 },
} as const;

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,
  SORT_BY: 'createdAt',
  SORT_ORDER: 'desc',
} as const;

export const HTTP_STATUS_MESSAGES = {
  OK: 'Success',
  CREATED: 'Resource created successfully',
  NO_CONTENT: 'Resource deleted successfully',
  BAD_REQUEST: 'Bad request',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Resource not found',
  CONFLICT: 'Resource already exists',
  UNPROCESSABLE_ENTITY: 'Validation failed',
  INTERNAL_SERVER_ERROR: 'Internal server error',
} as const;

export const TENANT_STATUSES = {
  ACTIVE: 'ACTIVE',
  TRIALING: 'TRIALING',
  PAST_DUE: 'PAST_DUE',
  CANCELED: 'CANCELED',
  SUSPENDED: 'SUSPENDED',
} as const;

export const TABLE_STATUSES = {
  AVAILABLE: 'AVAILABLE',
  OCCUPIED: 'OCCUPIED',
  RESERVED: 'RESERVED',
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
} as const;

export const BRANCH_TYPES = {
  MAIN: 'MAIN',
  BRANCH: 'BRANCH',
  FRANCHISE: 'FRANCHISE',
} as const;

export const PAYMENT_METHODS = {
  CASH: 'CASH',
  CREDIT_CARD: 'CREDIT_CARD',
  DEBIT_CARD: 'DEBIT_CARD',
  MOBILE_PAYMENT: 'MOBILE_PAYMENT',
  BANK_TRANSFER: 'BANK_TRANSFER',
} as const;

export const PAYMENT_STATUSES = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;

export const DAY_OF_WEEK = {
  MONDAY: 'MONDAY',
  TUESDAY: 'TUESDAY',
  WEDNESDAY: 'WEDNESDAY',
  THURSDAY: 'THURSDAY',
  FRIDAY: 'FRIDAY',
  SATURDAY: 'SATURDAY',
  SUNDAY: 'SUNDAY',
} as const;

export const CACHE_TTL = {
  SHORT: 60,
  MEDIUM: 300,
  LONG: 3600,
} as const;

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/;
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
