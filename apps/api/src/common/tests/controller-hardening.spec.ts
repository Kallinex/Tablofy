import { listControllerRoutes } from '../../test/helpers/controller-routes';

/**
 * A route may only bind `:tenantId` from the path when it proves the caller owns
 * that tenant. `payments.controller.ts::providerStatus` is the single reviewed
 * case: it compares the path tenant against the JWT tenant and throws
 * ForbiddenException on mismatch (covered in payments.controller.spec.ts).
 */
const ALLOWED_PATH_TENANT_SCOPES = new Set(['modules/payments/payments.controller.ts']);

describe('Controller hardening (deny-by-default tripwire)', () => {
  let routes: Awaited<ReturnType<typeof listControllerRoutes>>;

  beforeAll(async () => {
    routes = await listControllerRoutes();
  });

  it('audits every controller in the API surface', () => {
    expect(new Set(routes.map((r) => r.controllerName)).size).toBeGreaterThanOrEqual(70);

    const byController = new Map<string, number>();
    for (const route of routes) {
      byController.set(route.controllerName, (byController.get(route.controllerName) ?? 0) + 1);
    }
    const empty = [...byController.entries()].filter(([, count]) => count === 0);
    expect(empty).toEqual([]);
  });

  it('resolves route metadata for the whole API surface', () => {
    expect(routes.length).toBeGreaterThanOrEqual(400);

    // Guards against the tripwire silently degrading into a no-op.
    expect(routes.filter((r) => r.roles.length > 0).length).toBeGreaterThan(300);
    expect(routes.filter((r) => r.permissions.length > 0).length).toBeGreaterThan(0);
    expect(routes.filter((r) => r.isPublic).length).toBeGreaterThan(0);
    expect(routes.filter((r) => r.anyAuthenticated).length).toBeGreaterThan(0);
    expect(routes.filter((r) => r.httpMethod === 'POST').length).toBeGreaterThan(100);
  });

  it('resolves handler arguments for the whole API surface', () => {
    // Guards against Nest metadata key changes silently disabling the checks below.
    expect(routes.filter((r) => r.routeArgs.length > 0).length).toBeGreaterThanOrEqual(
      Math.floor(routes.length * 0.9),
    );
    expect(routes.filter((r) => r.hasCurrentUser).length).toBeGreaterThan(100);
    expect(
      routes.filter((r) => r.routeArgs.some((a) => a.source === 'param')).length,
    ).toBeGreaterThan(200);
    expect(
      routes.filter((r) => r.routeArgs.some((a) => a.source === 'body')).length,
    ).toBeGreaterThan(50);
  });

  it('never binds a raw :tenantId path parameter except in reviewed controllers', () => {
    const offenders = routes.filter(
      (r) => r.tenantIdFromPath && !ALLOWED_PATH_TENANT_SCOPES.has(r.file),
    );
    expect(offenders.map((r) => `${r.controllerName}.${r.handlerName}`)).toEqual([]);
  });

  it('never binds tenantId from the request body (body/query are guarded by TenantBodyGuard)', () => {
    const offenders = routes.filter((r) => r.tenantIdFromBody);
    expect(offenders.map((r) => `${r.controllerName}.${r.handlerName}`)).toEqual([]);
  });

  it('never mixes @Public() with @Roles()/@Permissions() on the same handler', () => {
    const offenders = routes.filter(
      (r) => r.isPublic && (r.roles.length > 0 || r.permissions.length > 0),
    );
    expect(
      offenders.map((r) => `${r.controllerName}.${r.handlerName} (${r.roles.join('/')})`),
    ).toEqual([]);
  });

  it('requires every route handler to declare roles, permissions, @Public or @Authenticated', () => {
    const offenders = routes.filter(
      (r) =>
        r.roles.length === 0 && r.permissions.length === 0 && !r.isPublic && !r.anyAuthenticated,
    );
    expect(offenders.map((r) => `${r.controllerName}.${r.handlerName}`)).toEqual([]);
  });

  it('keeps every mutating route behind an explicit authorization decision', () => {
    const mutating = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    const offenders = routes.filter(
      (r) =>
        mutating.has(r.httpMethod) &&
        r.roles.length === 0 &&
        r.permissions.length === 0 &&
        !r.isPublic &&
        !r.anyAuthenticated,
    );
    expect(offenders.map((r) => `${r.controllerName}.${r.handlerName}`)).toEqual([]);
  });
});
