import { UserRole } from '@prisma/client';

export const ALL_PERMISSIONS = [
  'orders:read',
  'orders:write',
  'orders:delete',
  'inventory:read',
  'inventory:write',
  'customers:read',
  'customers:write',
  'gift-cards:manage',
  'payments:manage',
  'users:manage',
  'reports:read',
  'analytics:read',
  'kitchen:manage',
  'settings:manage',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<UserRole, readonly string[]> = {
  [UserRole.SUPER_ADMIN]: ['*'],
  [UserRole.OWNER]: ['*'],
  [UserRole.MANAGER]: [
    'orders:read',
    'orders:write',
    'inventory:read',
    'inventory:write',
    'customers:read',
    'customers:write',
    'gift-cards:manage',
    'payments:manage',
    'reports:read',
    'analytics:read',
    'kitchen:manage',
  ],
  [UserRole.STAFF]: ['orders:read', 'orders:write', 'customers:read', 'inventory:read'],
  [UserRole.KITCHEN]: ['orders:read', 'kitchen:manage'],
  [UserRole.CASHIER]: ['orders:read', 'orders:write', 'payments:manage', 'customers:read'],
  [UserRole.WAITER]: ['orders:read', 'orders:write', 'customers:read'],
  [UserRole.VIEWER]: ['orders:read', 'inventory:read', 'reports:read', 'analytics:read'],
};

export function hasPermissions(role: string, required: readonly string[]): boolean {
  if (!required || required.length === 0) {
    return true;
  }

  const granted = ROLE_PERMISSIONS[role as UserRole] ?? [];

  if (granted.includes('*')) {
    return true;
  }

  return required.every((permission) => granted.includes(permission));
}
