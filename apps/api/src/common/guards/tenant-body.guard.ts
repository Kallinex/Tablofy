import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TenantBodyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const jwtTenantId = request.user?.tenantId as string | undefined;

    if (!jwtTenantId) {
      return true;
    }

    const bodyTenantId = request.body?.tenantId as string | undefined;
    const queryTenantId = request.query?.tenantId as string | undefined;

    if (bodyTenantId && bodyTenantId !== jwtTenantId) {
      throw new ForbiddenException('Cross-tenant access denied');
    }

    if (queryTenantId && queryTenantId !== jwtTenantId) {
      throw new ForbiddenException('Cross-tenant access denied');
    }

    return true;
  }
}
