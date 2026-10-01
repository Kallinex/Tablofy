import { HttpException } from '@nestjs/common';
import { listControllerRoutes } from '../../test/helpers/controller-routes';
import {
  createInvokedController,
  FOREIGN_TENANT_SENTINEL,
  RESTAURANT_SENTINEL,
} from '../../test/helpers/handler-invoker';
import { TEST_USER } from '../../test/helpers/controller-app';

/**
 * Executes every handler of every controller against auto-mocked dependencies.
 *
 * This is behavioural, not just metadata coverage: each handler body runs, so
 * param handling, tenant propagation and delegation are all exercised. Failures
 * are aggregated so a single run reports every broken controller.
 */
describe('Controller handler execution contract', () => {
  it('executes every handler without unexpected errors and scopes by the JWT tenant', async () => {
    const routes = await listControllerRoutes();
    const limit = Number(process.env.ROUTE_AUDIT_LIMIT ?? '0');
    const audited = limit > 0 ? routes.slice(0, limit) : routes;
    const crashes: string[] = [];
    const tenantLeaks: string[] = [];
    const noDelegation: string[] = [];

    let executed = 0;
    let rejectedWithHttpException = 0;

    for (const route of audited) {
      const label = `${route.controllerName}.${route.handlerName} (${route.httpMethod} ${route.fullPath})`;
      const controller = createInvokedController(route.controllerRef as new () => object);
      const before = controller.calls.length;
      let rejected = false;

      try {
        await controller.invoke(route);
        executed += 1;
      } catch (error) {
        if (error instanceof HttpException) {
          rejected = true;
          rejectedWithHttpException += 1;
        } else {
          crashes.push(`${label} -> ${(error as Error).message}`);
          continue;
        }
      }

      const forwarded = controller.calls.slice(before).flatMap((call) => call.args);

      if (route.tenantIdFromPath && forwarded.includes(FOREIGN_TENANT_SENTINEL)) {
        tenantLeaks.push(`${label} -> forwarded the client-supplied tenant id`);
      }

      // A handler that rejected deliberately (for example the ownership check in
      // PaymentsController.providerStatus) never reaches its dependency.
      if (controller.calls.length === before && !route.isPublic && !rejected) {
        noDelegation.push(`${label} -> never called a dependency`);
      }
    }

    expect({
      crashes,
      tenantLeaks,
      noDelegation,
      executed,
      rejectedWithHttpException,
    }).toEqual({
      crashes: [],
      tenantLeaks: [],
      noDelegation: [],
      executed,
      rejectedWithHttpException,
    });

    // Sanity floor: the audit must actually be executing handlers.
    expect(executed).toBeGreaterThanOrEqual(Math.floor(audited.length * 0.9));
  });

  it('never forwards an unauthenticated tenant scope to a dependency', async () => {
    const routes = await listControllerRoutes();
    const nonPublic = routes.filter((r) => !r.isPublic && r.hasCurrentUser);
    const missingTenant: string[] = [];

    for (const route of nonPublic) {
      const controller = createInvokedController(route.controllerRef as new () => object);
      let summary: Awaited<ReturnType<typeof controller.invoke>> = null;

      try {
        summary = await controller.invoke(route);
      } catch (error) {
        if (!(error instanceof HttpException)) {
          throw error;
        }
        continue;
      }

      if (!summary) {
        continue;
      }
      const forwardsTenant = summary.args.some(
        (arg) => arg === TEST_USER.tenantId || arg === RESTAURANT_SENTINEL,
      );
      const forwardsUser = summary.args.some(
        (arg) => arg === TEST_USER.id || (arg as Record<string, unknown>)?.userId === TEST_USER.id,
      );
      const forwardsObjectScope = summary.args.some(
        (arg) =>
          typeof arg === 'object' &&
          arg !== null &&
          Object.values(arg as Record<string, unknown>).includes(TEST_USER.tenantId),
      );
      const forwardsNested = summary.args.some((arg) => {
        try {
          return JSON.stringify(arg)?.includes(TEST_USER.tenantId) ?? false;
        } catch {
          return false;
        }
      });

      if (!forwardsTenant && !forwardsObjectScope && !forwardsUser && !forwardsNested) {
        missingTenant.push(
          `${route.controllerName}.${route.handlerName} -> ${summary.method}(${summary.args
            .map((a) => JSON.stringify(a)?.slice(0, 80))
            .join(', ')})`,
        );
      }
    }

    expect(missingTenant).toEqual([]);
  });

  it('uses the authenticated user fixture for tenant scoping', () => {
    expect(TEST_USER.tenantId).toBe('tenant-1');
  });
});
