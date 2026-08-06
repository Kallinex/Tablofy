import { UserRole } from '@prisma/client';

export const TENANT_ASSIGNABLE_ROLES: readonly UserRole[] = [
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.STAFF,
  UserRole.KITCHEN,
  UserRole.CASHIER,
  UserRole.WAITER,
  UserRole.VIEWER,
];

const ALL_ROLES = Object.values(UserRole) as UserRole[];

const ASSIGNABLE_BY: Record<UserRole, ReadonlySet<UserRole>> = {
  SUPER_ADMIN: new Set(ALL_ROLES),
  OWNER: new Set([
    UserRole.OWNER,
    UserRole.MANAGER,
    UserRole.STAFF,
    UserRole.KITCHEN,
    UserRole.CASHIER,
    UserRole.WAITER,
    UserRole.VIEWER,
  ]),
  MANAGER: new Set([
    UserRole.STAFF,
    UserRole.KITCHEN,
    UserRole.CASHIER,
    UserRole.WAITER,
    UserRole.VIEWER,
  ]),
  STAFF: new Set<UserRole>(),
  KITCHEN: new Set<UserRole>(),
  CASHIER: new Set<UserRole>(),
  WAITER: new Set<UserRole>(),
  VIEWER: new Set<UserRole>(),
};

const MANAGEABLE_BY: Record<UserRole, ReadonlySet<UserRole>> = {
  SUPER_ADMIN: new Set(ALL_ROLES),
  OWNER: new Set([
    UserRole.OWNER,
    UserRole.MANAGER,
    UserRole.STAFF,
    UserRole.KITCHEN,
    UserRole.CASHIER,
    UserRole.WAITER,
    UserRole.VIEWER,
  ]),
  MANAGER: new Set([
    UserRole.STAFF,
    UserRole.KITCHEN,
    UserRole.CASHIER,
    UserRole.WAITER,
    UserRole.VIEWER,
  ]),
  STAFF: new Set<UserRole>(),
  KITCHEN: new Set<UserRole>(),
  CASHIER: new Set<UserRole>(),
  WAITER: new Set<UserRole>(),
  VIEWER: new Set<UserRole>(),
};

export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return ASSIGNABLE_BY[actorRole].has(targetRole);
}

export function canManageUser(actorRole: UserRole, targetRole: UserRole): boolean {
  return MANAGEABLE_BY[actorRole].has(targetRole);
}
