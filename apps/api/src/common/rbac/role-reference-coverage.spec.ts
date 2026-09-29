import { join } from 'path';
import { createRequire } from 'module';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '@prisma/client';

const req = createRequire(__filename);
const glob = req('glob') as typeof import('glob');

const VALID_ROLES = new Set<string>(Object.values(UserRole));

interface RouteRef {
  file: string;
  handler: string;
  roles: string[];
}

function collectRoleRoutes(): RouteRef[] {
  const srcRoot = join(__dirname, '..', '..');
  const files = glob.sync('**/*.controller.ts', { cwd: srcRoot }) as string[];
  const routes: RouteRef[] = [];

  for (const file of files) {
    const mod = req(join(srcRoot, file));
    for (const exportedName of Object.keys(mod)) {
      const cls = mod[exportedName];
      if (typeof cls !== 'function' || typeof cls.prototype !== 'object') {
        continue;
      }

      const proto = cls.prototype;
      for (const methodName of Object.getOwnPropertyNames(proto)) {
        if (methodName === 'constructor') continue;
        const fn = proto[methodName] as object;
        if (Reflect.getMetadata(PATH_METADATA, fn) === undefined) continue;

        const roles = (Reflect.getMetadata(ROLES_KEY, fn) as string[] | undefined) || [];
        if (roles.length > 0) {
          routes.push({ file, handler: `${exportedName}.${methodName}`, roles });
        }
      }
    }
  }

  return routes;
}

describe('Global role reference coverage (P0-I residual closure)', () => {
  const routes = collectRoleRoutes();

  it('scans a non-vacuous set of role-guarded routes across all controllers', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('no route references the non-existent PURCHASING or CHEF roles', () => {
    const offenders = routes.filter((r) =>
      r.roles.some((role) => role === 'PURCHASING' || role === 'CHEF'),
    );
    expect(offenders).toEqual([]);
  });

  it('every role referenced on any route exists in the UserRole enum', () => {
    const invalid: string[] = [];
    for (const route of routes) {
      for (const role of route.roles) {
        if (!VALID_ROLES.has(role)) {
          invalid.push(`${route.handler} (${route.file}) references unknown role ${role}`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it('recipes mutation routes are open to OWNER, MANAGER and KITCHEN staff', () => {
    const recipeRoutes = routes.filter((r) => r.handler.startsWith('RecipesController.'));
    const mutationRoutes = recipeRoutes.filter((r) => {
      const roles = r.roles;
      return roles.includes('KITCHEN') && roles.includes('OWNER') && roles.includes('MANAGER');
    });
    expect(mutationRoutes.length).toBeGreaterThanOrEqual(5);
  });
});
