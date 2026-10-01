import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Type } from '@nestjs/common';

export const TEST_USER = {
  id: 'user-1',
  email: 'owner@test.com',
  role: 'OWNER',
  tenantId: 'tenant-1',
} as Record<string, unknown>;

export interface ProviderOverride {
  provide: unknown;
  useValue: unknown;
}

/**
 * Boots a controller with stubbed providers and a pre-authenticated request,
 * so specs can assert real routing, param binding and HTTP status codes.
 */
export async function createControllerApp(
  controller: Type<unknown>,
  providers: ProviderOverride[],
  user: Record<string, unknown> = TEST_USER,
): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [controller],
    providers,
  }).compile();

  const app = module.createNestApplication();
  app.use((req: { user?: Record<string, unknown> }, _res: unknown, next: () => void) => {
    req.user = user;
    next();
  });
  await app.init();

  return app;
}
