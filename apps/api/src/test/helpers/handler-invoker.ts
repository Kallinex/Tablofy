import { createAutoMock, createAutoMockRegistry, RecordedCall } from './auto-mock';
import { TEST_USER } from './controller-app';
import { ControllerRoute, HandlerArg } from './controller-routes';

/** A dependency that was actually called by a handler. */
export interface CallSummary {
  method: string;
  args: unknown[];
}

/** Sentinel passed for any client-controlled `tenantId` route parameter. */
export const FOREIGN_TENANT_SENTINEL = 'foreign-tenant-should-be-rejected';
export const RESTAURANT_SENTINEL = 'restaurant-sentinel';

export interface InvokedController {
  calls: RecordedCall[];
  /** The dependency method invoked, e.g. `findOne`. */
  invoke: (route: ControllerRoute) => Promise<CallSummary | null>;
}

function buildArg(arg: HandlerArg): unknown {
  switch (arg.source) {
    case 'param':
      if (arg.data === 'tenantId') {
        return FOREIGN_TENANT_SENTINEL;
      }
      if (arg.data === 'restaurantId') {
        return RESTAURANT_SENTINEL;
      }
      return `sentinel-${arg.data ?? 'id'}`;
    case 'body':
      return {};
    case 'query':
      return arg.data ? '1' : {};
    case 'headers':
      return { 'user-agent': 'jest', 'x-api-key': 'test-api-key', authorization: 'Bearer test' };
    case 'req':
      return {
        user: { ...TEST_USER },
        ip: '127.0.0.1',
        headers: {
          'user-agent': 'jest',
          'x-api-key': 'test-api-key',
          authorization: 'Bearer test',
        },
        query: {},
        params: {},
        body: {},
      };
    case 'res':
      return { status: () => undefined, json: () => undefined, send: () => undefined };
    case 'next':
      return () => undefined;
    case 'session':
      return {};
    case 'file':
      return {
        fieldname: 'file',
        originalname: 'sample.png',
        encoding: '7bit',
        mimetype: 'image/png',
        size: 8,
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      };
    case 'files':
      return [
        {
          fieldname: 'file',
          originalname: 'sample.png',
          encoding: '7bit',
          mimetype: 'image/png',
          size: 8,
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        },
      ];
    default:
      return { ...TEST_USER };
  }
}

/**
 * Instantiates a controller with auto-mocked dependencies and invokes handlers
 * directly with synthetic arguments derived from Nest's route-argument metadata.
 *
 * Direct invocation is deliberate: it executes each handler body (the coverage
 * goal) without depending on HTTP serialisation, guards, or decorators from
 * third-party packages such as `@nestjs/terminus`.
 */
export function createInvokedController(
  controller: new (...args: never[]) => object,
): InvokedController {
  const calls = createAutoMockRegistry();
  const paramTypes =
    (Reflect.getMetadata('design:paramtypes', controller) as unknown[] | undefined) ?? [];
  const deps = paramTypes.map(() => createAutoMock(calls, 'dep'));
  const instance = new controller(...(deps as never[]));
  const prototype = controller.prototype as Record<string, unknown>;

  return {
    calls,
    invoke: async (route: ControllerRoute) => {
      const handler = prototype[route.handlerName] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof handler !== 'function') {
        throw new Error(`handler ${route.handlerName} is not a function`);
      }

      const args = new Array<unknown>(route.routeArgs.length);
      for (const arg of route.routeArgs) {
        args[arg.index] = buildArg(arg);
      }
      const before = calls.length;
      await handler.apply(instance, args);

      const first = calls[before];
      if (!first) {
        return null;
      }
      const method = first.path.split('.').pop()?.replace(/\(\)$/, '') ?? first.path;
      return { method, args: first.args };
    },
  };
}
