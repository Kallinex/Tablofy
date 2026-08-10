import { join } from 'path';
import { createRequire } from 'module';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ANY_AUTHENTICATED_KEY } from '../decorators/authenticated.decorator';

const req = createRequire(__filename);
const glob = req('glob') as typeof import('glob');

const GATE_KEYS = [ROLES_KEY, PERMISSIONS_KEY, IS_PUBLIC_KEY, ANY_AUTHENTICATED_KEY];

function metadataOn(cls: unknown, prototype: unknown, key: string, methodName?: string): unknown {
  return methodName
    ? Reflect.getMetadata(key, prototype, methodName)
    : Reflect.getMetadata(key, cls as object);
}

function collectUngatedHandlers(): { file: string; handler: string }[] {
  const srcRoot = join(__dirname, '..', '..');
  const files = glob.sync('**/*.controller.ts', { cwd: srcRoot }) as string[];
  const failures: { file: string; handler: string }[] = [];

  for (const file of files) {
    const mod = req(join(srcRoot, file));
    for (const exportedName of Object.keys(mod)) {
      const cls = mod[exportedName];
      if (typeof cls !== 'function' || typeof cls.prototype !== 'object') {
        continue;
      }

      const classGate = GATE_KEYS.some((key) => !!metadataOn(cls, cls.prototype, key));
      const proto = cls.prototype;
      let isController = false;

      for (const methodName of Object.getOwnPropertyNames(proto)) {
        if (methodName === 'constructor') continue;
        const isRoute = Reflect.hasMetadata(PATH_METADATA, proto, methodName);
        const hasMethod = Reflect.hasMetadata(METHOD_METADATA, proto, methodName);
        if (!isRoute && !hasMethod) continue;

        isController = true;
        const handlerGate = GATE_KEYS.some((key) => !!metadataOn(cls, proto, key, methodName));
        if (!classGate && !handlerGate) {
          failures.push({ file, handler: `${exportedName}.${methodName}` });
        }
      }

      if (!isController) continue;
    }
  }

  return failures;
}

describe('RBAC route coverage (deny-by-default tripwire)', () => {
  it('every route handler must carry Roles, Permissions, Authenticated or Public metadata', () => {
    const failures = collectUngatedHandlers();
    expect(failures).toEqual([]);
  });
});
