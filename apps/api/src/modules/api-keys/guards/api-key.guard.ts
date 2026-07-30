import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from '../api-keys.service';

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

    request.apiKeyInfo = result;
    request.tenantId = result.tenantId;
    return true;
  }
}
