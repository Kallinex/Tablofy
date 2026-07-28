import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_TENANT_CHECK_KEY } from '../decorators/skip-tenant.decorator';
import { CurrentUserData } from '../decorators/current-user.decorator';
import { USER_ROLES } from '@tablofy/shared/constants';

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skipTenantCheck = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipTenantCheck) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as CurrentUserData | undefined;

    if (!user) {
      throw new ForbiddenException('Access denied');
    }

    if (user.role === USER_ROLES.SUPER_ADMIN) {
      return true;
    }

    if (!user.tenantId) {
      this.logger.warn(
        `User ${user.id} with role ${user.role} attempted access without tenant context`,
      );
      throw new ForbiddenException('No tenant context available');
    }

    const tenantIdFromParams = request.params?.tenantId as string | undefined;

    if (tenantIdFromParams && tenantIdFromParams !== user.tenantId) {
      this.logger.warn(
        `User ${user.id} from tenant ${user.tenantId} attempted to access tenant ${tenantIdFromParams}`,
      );
      throw new ForbiddenException('Access denied to this tenant');
    }

    request.tenantId = user.tenantId;

    return true;
  }
}
