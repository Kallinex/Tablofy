import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_CHECK_KEY = 'skipTenantCheck';

export const SkipTenantCheck = (): PropertyDecorator & ClassDecorator & MethodDecorator =>
  SetMetadata(SKIP_TENANT_CHECK_KEY, true);
