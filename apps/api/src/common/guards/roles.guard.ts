import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ANY_AUTHENTICATED_KEY } from '../decorators/authenticated.decorator';
import { CurrentUserData } from '../decorators/current-user.decorator';
import { hasPermissions } from '../rbac/role-permissions';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const anyAuthenticated = this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const hasRoles = !!requiredRoles && requiredRoles.length > 0;
    const hasPermissionCheck = !!requiredPermissions && requiredPermissions.length > 0;

    const request = context.switchToHttp().getRequest();
    const user = request.user as CurrentUserData | undefined;

    if (!hasRoles && !hasPermissionCheck) {
      if (anyAuthenticated) {
        if (!user) {
          throw new ForbiddenException('Access denied');
        }
        return true;
      }
      throw new ForbiddenException('Access denied');
    }

    if (!user) {
      throw new ForbiddenException('Access denied');
    }

    if (hasRoles && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    if (hasPermissionCheck && !hasPermissions(user.role, requiredPermissions)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
