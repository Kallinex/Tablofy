import { UserRole } from '@prisma/client';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { PurchasingController } from '../purchasing.controller';

describe('PurchasingController role policy (P0-I)', () => {
  const VALID_ROLES = new Set<string>(Object.values(UserRole));

  function rolesByRoute(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const proto = PurchasingController.prototype as unknown as Record<string, unknown>;
    for (const methodName of Object.getOwnPropertyNames(proto)) {
      if (methodName === 'constructor') continue;
      const fn = proto[methodName] as object;
      const isRoute = Reflect.getMetadata(PATH_METADATA, fn) !== undefined;
      if (!isRoute) continue;
      const roles = Reflect.getMetadata(ROLES_KEY, fn) as string[] | undefined;
      if (roles && roles.length > 0) {
        map.set(`${PurchasingController.name}.${methodName}`, roles);
      }
    }
    return map;
  }

  it('no route references the non-existent PURCHASING role', () => {
    for (const [handler, roles] of rolesByRoute()) {
      expect(roles).not.toContain('PURCHASING');
      expect(roles).not.toContain('CHEF');
      void handler;
    }
  });

  it('every role referenced on purchasing routes exists in the UserRole enum', () => {
    const rolesByRouteMap = rolesByRoute();
    expect(rolesByRouteMap.size).toBeGreaterThan(0);
    const invalid: string[] = [];
    for (const [handler, roles] of rolesByRouteMap) {
      for (const role of roles) {
        if (!VALID_ROLES.has(role)) invalid.push(`${handler} references unknown role ${role}`);
      }
    }
    expect(invalid).toEqual([]);
  });

  it('PO mutation routes remain OWNER/MANAGER-only and GRN create keeps CASHIER', () => {
    const rolesByRouteMap = rolesByRoute();
    expect(rolesByRouteMap.get('PurchasingController.createPO')).toEqual(['OWNER', 'MANAGER']);
    expect(rolesByRouteMap.get('PurchasingController.updatePO')).toEqual(['OWNER', 'MANAGER']);
    expect(rolesByRouteMap.get('PurchasingController.submitPO')).toEqual(['OWNER', 'MANAGER']);
    expect(rolesByRouteMap.get('PurchasingController.orderPO')).toEqual(['OWNER', 'MANAGER']);
    expect(rolesByRouteMap.get('PurchasingController.receivePO')).toEqual(['OWNER', 'MANAGER']);
    expect(rolesByRouteMap.get('PurchasingController.createGRN')).toEqual([
      'OWNER',
      'MANAGER',
      'CASHIER',
    ]);
  });
});
