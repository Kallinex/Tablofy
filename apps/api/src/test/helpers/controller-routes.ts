import { join, relative } from 'path';
import { createRequire } from 'module';
import { RequestMethod } from '@nestjs/common';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import {
  CUSTOM_ROUTE_ARGS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ANY_AUTHENTICATED_KEY } from '../../common/decorators/authenticated.decorator';

const nodeRequire = createRequire(__filename);
const glob = nodeRequire('glob') as typeof import('glob');

export const API_SRC_ROOT = join(__dirname, '..', '..');

export type ArgSource =
  | 'param'
  | 'body'
  | 'query'
  | 'headers'
  | 'req'
  | 'res'
  | 'next'
  | 'session'
  | 'host'
  | 'ip'
  | 'file'
  | 'files'
  | 'rawBody'
  | 'custom';

export interface HandlerArg {
  index: number;
  source: ArgSource;
  /** Bound name for `@Param('id')` / `@Query('page')` style decorators. */
  data?: string;
}

export interface ControllerRoute {
  file: string;
  controllerName: string;
  controllerRef: new () => object;
  controllerPath: string;
  routePath: string;
  httpMethod: string;
  handlerName: string;
  roles: string[];
  permissions: string[];
  isPublic: boolean;
  anyAuthenticated: boolean;
  tenantIdFromPath: boolean;
  tenantIdFromBody: boolean;
  hasCurrentUser: boolean;
  routeArgs: HandlerArg[];
  /** Normalised absolute path, e.g. `/restaurants/:restaurantId/products/:id/restore`. */
  fullPath: string;
}

/** Nest stores METHOD_METADATA as a numeric `RequestMethod` enum value. */
export function httpMethodName(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  const name = RequestMethod[value as RequestMethod];
  return typeof name === 'string' ? name : 'UNKNOWN';
}

const PARAMTYPE_NAMES: Record<number, ArgSource> = {
  [RouteParamtypes.REQUEST]: 'req',
  [RouteParamtypes.RESPONSE]: 'res',
  [RouteParamtypes.NEXT]: 'next',
  [RouteParamtypes.BODY]: 'body',
  [RouteParamtypes.QUERY]: 'query',
  [RouteParamtypes.PARAM]: 'param',
  [RouteParamtypes.HEADERS]: 'headers',
  [RouteParamtypes.SESSION]: 'session',
  [RouteParamtypes.HOST]: 'host',
  [RouteParamtypes.IP]: 'ip',
  [RouteParamtypes.FILE]: 'file',
  [RouteParamtypes.FILES]: 'files',
  [RouteParamtypes.RAW_BODY]: 'rawBody',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Nest 11 stores route arguments on the controller class keyed by handler name,
 * with entries shaped as `` `${paramtype}:${index}` `` and custom decorators
 * keyed by `` `${uuid}__customRouteArgs__:${index}` ``.
 */
function readHandlerArgs(controller: new () => object, handler: string): HandlerArg[] {
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler);
  if (!isRecord(metadata)) {
    return [];
  }

  const args: HandlerArg[] = [];

  for (const [key, value] of Object.entries(metadata)) {
    const entry = isRecord(value) ? value : {};
    const declaredIndex = typeof entry.index === 'number' ? entry.index : Number.NaN;
    const index = Number.isNaN(declaredIndex)
      ? Number(key.slice(key.lastIndexOf(':') + 1))
      : declaredIndex;

    if (key.includes(CUSTOM_ROUTE_ARGS_METADATA)) {
      args.push({ index, source: 'custom' });
      continue;
    }

    const paramtype = Number(key.split(':')[0]);
    const source = PARAMTYPE_NAMES[paramtype];
    if (!source) {
      continue;
    }
    args.push({ index, source, data: typeof entry.data === 'string' ? entry.data : undefined });
  }

  return args.sort((a, b) => a.index - b.index);
}

export async function listControllerRoutes(): Promise<ControllerRoute[]> {
  const files = (glob.sync('**/*.controller.ts', { cwd: API_SRC_ROOT }) as string[]).sort();
  const routes: ControllerRoute[] = [];

  for (const file of files) {
    const loaded = (await import(join(API_SRC_ROOT, file))) as Record<string, unknown>;
    const filePath = relative(API_SRC_ROOT, join(API_SRC_ROOT, file)).replace(/\\/g, '/');

    for (const exported of Object.values(loaded)) {
      if (typeof exported !== 'function' || !Reflect.getMetadata(PATH_METADATA, exported)) {
        continue;
      }

      const controller = exported as new () => object;
      const classRoles = (Reflect.getMetadata(ROLES_KEY, controller) ?? []) as string[];
      const classPermissions = (Reflect.getMetadata(PERMISSIONS_KEY, controller) ?? []) as string[];
      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
      const classAuthenticated = Reflect.getMetadata(ANY_AUTHENTICATED_KEY, controller) === true;
      const controllerPath = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '/');

      for (const handlerName of Object.getOwnPropertyNames(controller.prototype)) {
        if (handlerName === 'constructor') {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, handlerName);
        if (!descriptor || typeof descriptor.value !== 'function') {
          continue;
        }

        const method = descriptor.value;
        const rawMethod = Reflect.getMetadata(METHOD_METADATA, method);
        const routePath = Reflect.getMetadata(PATH_METADATA, method);
        if (rawMethod === undefined && routePath === undefined) {
          continue;
        }

        const roles = (Reflect.getMetadata(ROLES_KEY, method) ?? classRoles) as string[];
        const permissions = (Reflect.getMetadata(PERMISSIONS_KEY, method) ??
          classPermissions) as string[];
        const isPublic =
          Reflect.getMetadata(IS_PUBLIC_KEY, method) === true ||
          (Reflect.getMetadata(IS_PUBLIC_KEY, method) === undefined && classPublic);
        const anyAuthenticated =
          Reflect.getMetadata(ANY_AUTHENTICATED_KEY, method) === true ||
          (Reflect.getMetadata(ANY_AUTHENTICATED_KEY, method) === undefined && classAuthenticated);

        const routeArgs = readHandlerArgs(controller, handlerName);
        const fullPath = `/${[controllerPath, routePath ?? ''].filter(Boolean).join('/')}`.replace(
          /\/{2,}/g,
          '/',
        );

        routes.push({
          file: filePath,
          controllerName: controller.name,
          controllerRef: controller,
          controllerPath,
          routePath: String(routePath ?? ''),
          httpMethod: httpMethodName(rawMethod),
          handlerName,
          roles,
          permissions,
          isPublic,
          anyAuthenticated,
          tenantIdFromPath: routeArgs.some(
            (arg) => arg.source === 'param' && arg.data === 'tenantId',
          ),
          tenantIdFromBody: routeArgs.some(
            (arg) => arg.source === 'body' && arg.data === 'tenantId',
          ),
          hasCurrentUser: routeArgs.some((arg) => arg.source === 'custom'),
          routeArgs,
          fullPath,
        });
      }
    }
  }

  return routes;
}
