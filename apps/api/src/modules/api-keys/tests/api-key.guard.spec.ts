import { Test } from '@nestjs/testing';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { ApiKeysService } from '../api-keys.service';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let apiKeysService: { validateApiKey: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };

  const request = {
    headers: {} as Record<string, string>,
    method: 'GET',
  } as {
    headers: Record<string, string>;
    method: string;
    tenantId?: string;
    apiKeyInfo?: unknown;
  };

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };

  beforeEach(async () => {
    request.headers = {};
    request.method = 'GET';
    delete request.tenantId;
    delete request.apiKeyInfo;

    apiKeysService = { validateApiKey: jest.fn() };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        { provide: ApiKeysService, useValue: apiKeysService },
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
  });

  it('should reject requests with no authorization header', async () => {
    await expect(guard.canActivate(context as never)).rejects.toThrow(UnauthorizedException);
    expect(apiKeysService.validateApiKey).not.toHaveBeenCalled();
  });

  it('should reject a malformed authorization header', async () => {
    request.headers.authorization = 'Bearer';

    await expect(guard.canActivate(context as never)).rejects.toThrow(UnauthorizedException);
    expect(apiKeysService.validateApiKey).not.toHaveBeenCalled();
  });

  it('should reject a bearer token instead of passing it through', async () => {
    request.headers.authorization = 'Bearer any.arbitrary.token';

    await expect(guard.canActivate(context as never)).rejects.toThrow(UnauthorizedException);
    expect(apiKeysService.validateApiKey).not.toHaveBeenCalled();
  });

  it('should reject an invalid API key', async () => {
    request.headers.authorization = 'ApiKey tab_invalid';
    apiKeysService.validateApiKey.mockResolvedValue({ valid: false });

    await expect(guard.canActivate(context as never)).rejects.toThrow(UnauthorizedException);
  });

  it('should allow a valid API key with the required default scope', async () => {
    request.headers.authorization = 'ApiKey tab_valid';
    apiKeysService.validateApiKey.mockResolvedValue({
      valid: true,
      tenantId: 'tenant-1',
      scopes: ['read'],
    });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.tenantId).toBe('tenant-1');
  });

  it('should reject a valid API key that lacks the required scope', async () => {
    request.headers.authorization = 'ApiKey tab_valid';
    apiKeysService.validateApiKey.mockResolvedValue({
      valid: true,
      tenantId: 'tenant-1',
      scopes: ['orders'],
    });

    await expect(guard.canActivate(context as never)).rejects.toThrow(ForbiddenException);
  });

  it('should reject a valid API key with no scopes when scopes are required', async () => {
    request.headers.authorization = 'ApiKey tab_valid';
    apiKeysService.validateApiKey.mockResolvedValue({
      valid: true,
      tenantId: 'tenant-1',
      scopes: [],
    });

    await expect(guard.canActivate(context as never)).rejects.toThrow(ForbiddenException);
  });

  it('should honor explicit @Scopes metadata over the method default', async () => {
    request.headers.authorization = 'ApiKey tab_valid';
    reflector.getAllAndOverride.mockReturnValue(['payments']);
    apiKeysService.validateApiKey.mockResolvedValue({
      valid: true,
      tenantId: 'tenant-1',
      scopes: ['payments'],
    });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });
});
