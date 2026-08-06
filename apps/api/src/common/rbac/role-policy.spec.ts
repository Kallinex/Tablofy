import { UserRole } from '@prisma/client';
import { canAssignRole, canManageUser, TENANT_ASSIGNABLE_ROLES } from './role-policy';

describe('role-policy', () => {
  it('should never include SUPER_ADMIN in tenant-assignable roles', () => {
    expect(TENANT_ASSIGNABLE_ROLES).not.toContain(UserRole.SUPER_ADMIN);
  });

  it('should allow SUPER_ADMIN to assign any role', () => {
    expect(canAssignRole(UserRole.SUPER_ADMIN, UserRole.SUPER_ADMIN)).toBe(true);
    expect(canAssignRole(UserRole.SUPER_ADMIN, UserRole.OWNER)).toBe(true);
  });

  it('should prevent any tenant role from assigning SUPER_ADMIN', () => {
    for (const actor of [
      UserRole.OWNER,
      UserRole.MANAGER,
      UserRole.STAFF,
      UserRole.KITCHEN,
      UserRole.CASHIER,
      UserRole.WAITER,
      UserRole.VIEWER,
    ]) {
      expect(canAssignRole(actor, UserRole.SUPER_ADMIN)).toBe(false);
    }
  });

  it('should allow OWNER to assign MANAGER and below', () => {
    expect(canAssignRole(UserRole.OWNER, UserRole.MANAGER)).toBe(true);
    expect(canAssignRole(UserRole.OWNER, UserRole.OWNER)).toBe(true);
    expect(canAssignRole(UserRole.OWNER, UserRole.STAFF)).toBe(true);
  });

  it('should prevent MANAGER from assigning OWNER or MANAGER', () => {
    expect(canAssignRole(UserRole.MANAGER, UserRole.OWNER)).toBe(false);
    expect(canAssignRole(UserRole.MANAGER, UserRole.MANAGER)).toBe(false);
    expect(canAssignRole(UserRole.MANAGER, UserRole.SUPER_ADMIN)).toBe(false);
  });

  it('should allow MANAGER to assign operational staff roles', () => {
    expect(canAssignRole(UserRole.MANAGER, UserRole.STAFF)).toBe(true);
    expect(canAssignRole(UserRole.MANAGER, UserRole.CASHIER)).toBe(true);
    expect(canAssignRole(UserRole.MANAGER, UserRole.WAITER)).toBe(true);
    expect(canAssignRole(UserRole.MANAGER, UserRole.VIEWER)).toBe(true);
  });

  it('should prevent non-management roles from managing anyone', () => {
    for (const actor of [
      UserRole.STAFF,
      UserRole.KITCHEN,
      UserRole.CASHIER,
      UserRole.WAITER,
      UserRole.VIEWER,
    ]) {
      expect(canManageUser(actor, UserRole.STAFF)).toBe(false);
      expect(canAssignRole(actor, UserRole.STAFF)).toBe(false);
    }
  });

  it('should mirror assignment policy for management', () => {
    expect(canManageUser(UserRole.MANAGER, UserRole.OWNER)).toBe(false);
    expect(canManageUser(UserRole.MANAGER, UserRole.STAFF)).toBe(true);
    expect(canManageUser(UserRole.OWNER, UserRole.MANAGER)).toBe(true);
    expect(canManageUser(UserRole.OWNER, UserRole.SUPER_ADMIN)).toBe(false);
  });
});
