import { hasPermissions, ROLE_PERMISSIONS, ALL_PERMISSIONS } from './role-permissions';

describe('role-permissions', () => {
  it('should grant every permission to SUPER_ADMIN and OWNER', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermissions('SUPER_ADMIN', [permission])).toBe(true);
      expect(hasPermissions('OWNER', [permission])).toBe(true);
    }
  });

  it('should grant orders read/write to operational roles', () => {
    for (const role of ['OWNER', 'MANAGER', 'STAFF', 'CASHIER', 'WAITER']) {
      expect(hasPermissions(role, ['orders:read'])).toBe(true);
      expect(hasPermissions(role, ['orders:write'])).toBe(true);
    }
  });

  it('should only grant orders:delete to full-access roles', () => {
    expect(hasPermissions('OWNER', ['orders:delete'])).toBe(true);
    expect(hasPermissions('SUPER_ADMIN', ['orders:delete'])).toBe(true);
    for (const role of ['MANAGER', 'STAFF', 'KITCHEN', 'CASHIER', 'WAITER', 'VIEWER']) {
      expect(hasPermissions(role, ['orders:delete'])).toBe(false);
    }
  });

  it('should only grant payments:manage to cashier and full-access roles', () => {
    expect(hasPermissions('CASHIER', ['payments:manage'])).toBe(true);
    expect(hasPermissions('OWNER', ['payments:manage'])).toBe(true);
    expect(hasPermissions('WAITER', ['payments:manage'])).toBe(false);
    expect(hasPermissions('VIEWER', ['payments:manage'])).toBe(false);
  });

  it('should require every permission in the list', () => {
    expect(hasPermissions('CASHIER', ['orders:read', 'orders:write'])).toBe(true);
    expect(hasPermissions('CASHIER', ['orders:read', 'users:manage'])).toBe(false);
  });

  it('should deny unknown roles and empty grants', () => {
    expect(hasPermissions('UNKNOWN_ROLE', ['orders:read'])).toBe(false);
    expect(hasPermissions('VIEWER', ['users:manage'])).toBe(false);
  });

  it('should allow when no permissions are required', () => {
    expect(hasPermissions('VIEWER', [])).toBe(true);
  });

  it('should define a permission entry for every role', () => {
    const roles = Object.keys(ROLE_PERMISSIONS);
    expect(roles).toContain('SUPER_ADMIN');
    expect(roles).toContain('OWNER');
    expect(roles).toContain('MANAGER');
    expect(roles).toContain('STAFF');
    expect(roles).toContain('KITCHEN');
    expect(roles).toContain('CASHIER');
    expect(roles).toContain('WAITER');
    expect(roles).toContain('VIEWER');
  });
});
