import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from '../api-keys.service';
import { SCOPES_KEY } from '../decorators/scopes.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'] as string | undefined;

    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const [scheme, credentials] = authHeader.split(' ');
    if (!scheme || !credentials) {
      throw new UnauthorizedException('Invalid authorization format');
    }

    if (scheme.toLowerCase() === 'bearer') {
      return true;
    }

    if (scheme.toLowerCase() !== 'apikey') {
      throw new UnauthorizedException('Invalid authorization scheme');
    }

    const result = await this.apiKeysService.validateApiKey(credentials);
    if (!result.valid) {
      throw new UnauthorizedException('Invalid or expired API key');
    }

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const effectiveScopes = requiredScopes ?? this.getDefaultScopesByMethod(context);

    if (effectiveScopes.length > 0 && result.scopes) {
      const hasScope = effectiveScopes.some((s) => result.scopes?.includes(s));
      if (!hasScope) {
        throw new ForbiddenException('API key scope insufficient');
      }
    }

    request.apiKeyInfo = result;
    request.tenantId = result.tenantId;
    return true;
  }

  private getDefaultScopesByMethod(context: ExecutionContext): string[] {
    const request = context.switchToHttp().getRequest<{ method: string }>();
    const readMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (readMethods.includes(request.method.toUpperCase())) {
      return ['read'];
    }
    return ['write'];
  }
}
