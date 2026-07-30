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

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface ErrorResponse {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
  correlationId: string;
  requestId?: string;
  errors?: ApiErrorDetail[];
}

export interface EnvelopeResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasNext?: boolean;
    hasPrevious?: boolean;
  };
  message?: string;
  timestamp: string;
}

export type WebhookEventType =
  | 'orders.created'
  | 'orders.updated'
  | 'orders.completed'
  | 'orders.cancelled'
  | 'customers.created'
  | 'customers.updated'
  | 'customers.deleted'
  | 'inventory.low_stock'
  | 'inventory.out_of_stock'
  | 'inventory.received'
  | 'payments.completed'
  | 'payments.failed'
  | 'payments.refunded'
  | 'loyalty.points_earned'
  | 'loyalty.points_redeemed'
  | 'loyalty.tier_changed'
  | 'campaigns.sent'
  | 'campaigns.opened'
  | 'campaigns.clicked'
  | 'suppliers.created'
  | 'suppliers.updated'
  | 'transfers.created'
  | 'transfers.completed';

export type WebhookDeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED' | 'RETRYING' | 'DEAD_LETTER';

export type ApiKeyScope =
  | 'orders:read'
  | 'orders:write'
  | 'menu:read'
  | 'menu:write'
  | 'inventory:read'
  | 'inventory:write'
  | 'customers:read'
  | 'customers:write'
  | 'payments:read'
  | 'payments:write'
  | 'restaurants:read'
  | 'restaurants:write'
  | 'reports:read'
  | 'webhooks:read'
  | 'webhooks:write'
  | 'admin:all';

export type IntegrationProviderType =
  | 'quickbooks'
  | 'xero'
  | 'stripe'
  | 'paymob'
  | 'whatsapp'
  | 'email'
  | 'sms';

export interface WebhookPayload<T = Record<string, unknown>> {
  eventType: WebhookEventType;
  eventId: string;
  tenantId: string;
  timestamp: string;
  data: T;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}
