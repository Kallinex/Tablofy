export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SoftDeletableEntity extends BaseEntity {
  deletedAt: Date | null;
}

export interface TenantEntity extends BaseEntity {
  tenantId: string;
}

export interface TenantSoftDeletableEntity extends TenantEntity {
  deletedAt: Date | null;
}

export type UserRole =
  | 'SUPER_ADMIN'
  | 'OWNER'
  | 'MANAGER'
  | 'STAFF'
  | 'KITCHEN'
  | 'CASHIER'
  | 'WAITER'
  | 'VIEWER';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';

export type PlanType = 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM' | 'ENTERPRISE';

export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIALING' | 'PAUSED';

export type Currency = 'USD' | 'EUR' | 'GBP' | 'EGP' | 'SAR' | 'AED';

export type SortOrder = 'asc' | 'desc';

export interface PaginatedQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  search?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  timestamp: string;
  errors?: string[];
}
