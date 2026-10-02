import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as openidClient from 'openid-client';
import { SsoService } from '../sso.service';
import { deriveSsoKey, encryptSsoSecret } from '../sso-crypto';

jest.mock('openid-client', () => {
  const clientInstance = {
    authorizationUrl: jest.fn(),
    callback: jest.fn(),
  };
  const issuer = { Client: jest.fn(() => clientInstance) };
  return {
    Issuer: { discover: jest.fn().mockResolvedValue(issuer) },
    generators: {
      state: jest.fn(() => 'state-1'),
      nonce: jest.fn(() => 'nonce-1'),
      codeVerifier: jest.fn(() => 'verifier-1'),
      codeChallenge: jest.fn(() => 'challenge-1'),
    },
    __clientInstance: clientInstance,
  };
});

const ENCRYPTION_KEY = 'k'.repeat(32);
const encryptedSecret = encryptSsoSecret('client-secret', deriveSsoKey(ENCRYPTION_KEY));

const configMap: Record<string, unknown> = {
  'sso.enabled': true,
  'sso.encryptionKey': ENCRYPTION_KEY,
  'sso.callbackBaseUrl': 'https://api.test/api/v1',
  'sso.successRedirectUrl': 'https://app.test/sso',
  'sso.failureRedirectUrl': 'https://app.test/login',
  'sso.stateTtlSeconds': 600,
  'sso.exchangeCodeTtlSeconds': 60,
};

const makeConnection = (overrides: Record<string, unknown> = {}) => ({
  id: 'conn-1',
  tenantId: 'tenant-1',
  name: 'Acme SSO',
  type: 'OIDC',
  issuerUrl: 'https://idp.test',
  clientId: 'client-id',
  clientSecretEncrypted: encryptedSecret,
  scopes: 'openid email profile',
  allowedEmailDomains: ['acme.com'],
  autoProvision: true,
  defaultRole: 'STAFF',
  enabled: true,
  metadata: null,
  createdBy: 'user-1',
  lastUsedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

describe('SsoService', () => {
  let service: SsoService;
  let prisma: {
    ssoConnection: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  };
  let config: { get: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let authService: { issueTokensForUser: jest.Mock };
  let audit: { log: jest.Mock };
  let clientInstance: { authorizationUrl: jest.Mock; callback: jest.Mock };

  beforeEach(() => {
    prisma = {
      ssoConnection: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(makeConnection()),
        delete: jest.fn().mockResolvedValue(makeConnection()),
      },
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    config = {
      get: jest.fn((key: string, def?: unknown) => (key in configMap ? configMap[key] : def)),
    };
    redis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    authService = {
      issueTokensForUser: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    service = new SsoService(
      prisma as never,
      config as never,
      redis as never,
      authService as never,
      audit as never,
    );

    clientInstance = (openidClient as unknown as { __clientInstance: typeof clientInstance })
      .__clientInstance;
    clientInstance.authorizationUrl.mockReturnValue('https://idp.test/authorize?state=s');
    clientInstance.callback.mockReset();
  });

  describe('connection management', () => {
    it('refuses every operation when SSO is disabled', async () => {
      config.get.mockImplementation((key: string, def?: unknown) =>
        key === 'sso.enabled' ? false : (undefined ?? def),
      );

      await expect(
        service.createConnection('tenant-1', 'user-1', {
          name: 'x',
          issuerUrl: 'https://idp.test',
          clientId: 'c',
          clientSecret: 's',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(() => service.redirectUri()).not.toThrow();
    });

    it('creates a connection and hides the client secret', async () => {
      prisma.ssoConnection.findUnique.mockResolvedValue(null);
      prisma.ssoConnection.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(makeConnection({ ...data, id: 'conn-1' })),
      );

      const result = await service.createConnection('tenant-1', 'user-1', {
        name: 'Acme SSO',
        issuerUrl: 'https://idp.test',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        allowedEmailDomains: ['Acme.com'],
        defaultRole: 'MANAGER',
      });

      const created = prisma.ssoConnection.create.mock.calls[0][0].data;
      expect(created.clientSecretEncrypted).not.toBe('client-secret');
      expect(created.allowedEmailDomains).toEqual(['acme.com']);
      expect(created.defaultRole).toBe('MANAGER');
      expect(result).not.toHaveProperty('clientSecretEncrypted');
      expect(result).toMatchObject({ hasClientSecret: true, type: 'OIDC' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SSO_CONNECTION_CREATED' }),
      );
    });

    it('rejects a second connection for the same tenant', async () => {
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());

      await expect(
        service.createConnection('tenant-1', 'user-1', {
          name: 'x',
          issuerUrl: 'https://idp.test',
          clientId: 'c',
          clientSecret: 's',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a non-https issuer', async () => {
      prisma.ssoConnection.findUnique.mockResolvedValue(null);

      await expect(
        service.createConnection('tenant-1', 'user-1', {
          name: 'x',
          issuerUrl: 'http://idp.test',
          clientId: 'c',
          clientSecret: 's',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an invalid issuer url', async () => {
      prisma.ssoConnection.findUnique.mockResolvedValue(null);

      await expect(
        service.createConnection('tenant-1', 'user-1', {
          name: 'x',
          issuerUrl: 'not a url',
          clientId: 'c',
          clientSecret: 's',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lists and gets connections with scopes split into an array', async () => {
      prisma.ssoConnection.findMany.mockResolvedValue([makeConnection()]);
      const list = await service.listConnections('tenant-1');
      expect(list[0].scopes).toEqual(['openid', 'email', 'profile']);

      prisma.ssoConnection.findFirst.mockResolvedValue(makeConnection());
      const one = await service.getConnection('tenant-1', 'conn-1');
      expect(one.id).toBe('conn-1');
    });

    it('throws when a connection is missing', async () => {
      prisma.ssoConnection.findFirst.mockResolvedValue(null);
      await expect(service.getConnection('tenant-1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('updates a connection including a new secret', async () => {
      prisma.ssoConnection.findFirst.mockResolvedValue(makeConnection());
      prisma.ssoConnection.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => Promise.resolve(makeConnection(data)),
      );

      const result = await service.updateConnection('tenant-1', 'user-1', 'conn-1', {
        name: 'Renamed',
        clientSecret: 'new-secret',
        scopes: [],
        allowedEmailDomains: ['New.com'],
        enabled: false,
      });

      const data = prisma.ssoConnection.update.mock.calls[0][0].data;
      expect(data.clientSecretEncrypted).not.toBe('new-secret');
      expect(data.scopes).toBe('openid email profile');
      expect(data.allowedEmailDomains).toEqual(['new.com']);
      expect(result.enabled).toBe(false);
    });

    it('deletes a connection', async () => {
      prisma.ssoConnection.findFirst.mockResolvedValue(makeConnection());
      const result = await service.deleteConnection('tenant-1', 'user-1', 'conn-1');
      expect(result).toEqual({ deleted: true });
      expect(prisma.ssoConnection.delete).toHaveBeenCalledWith({ where: { id: 'conn-1' } });
    });
  });

  describe('discoverByEmail', () => {
    it('returns unavailable when SSO is disabled', async () => {
      config.get.mockImplementation((key: string, def?: unknown) =>
        key === 'sso.enabled' ? false : (def ?? undefined),
      );
      expect(await service.discoverByEmail('a@acme.com')).toEqual({ available: false });
    });

    it('returns unavailable for a malformed email', async () => {
      expect(await service.discoverByEmail('nope')).toEqual({ available: false });
    });

    it('matches a connection by allowed domain', async () => {
      prisma.ssoConnection.findMany.mockResolvedValue([
        { id: 'conn-1', name: 'Acme', allowedEmailDomains: ['acme.com'] },
        { id: 'conn-2', name: 'Other', allowedEmailDomains: ['other.com'] },
      ]);

      expect(await service.discoverByEmail('user@acme.com')).toEqual({
        available: true,
        connectionId: 'conn-1',
        name: 'Acme',
      });
    });

    it('treats an empty allow-list as any domain', async () => {
      prisma.ssoConnection.findMany.mockResolvedValue([
        { id: 'conn-1', name: 'Acme', allowedEmailDomains: null },
      ]);
      expect(await service.discoverByEmail('user@any.com')).toMatchObject({ available: true });
    });

    it('returns unavailable when no connection matches', async () => {
      prisma.ssoConnection.findMany.mockResolvedValue([
        { id: 'conn-1', name: 'Acme', allowedEmailDomains: ['acme.com'] },
      ]);
      expect(await service.discoverByEmail('user@other.com')).toEqual({ available: false });
    });
  });

  describe('beginAuthorization', () => {
    it('stores state and returns the authorization url', async () => {
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());

      const result = await service.beginAuthorization('conn-1', '/dashboard');
      expect(result.url).toBe('https://idp.test/authorize?state=s');

      const [key, value, ttl] = redis.set.mock.calls[0];
      expect(key).toContain('sso:state:');
      expect(JSON.parse(value)).toMatchObject({
        connectionId: 'conn-1',
        redirectPath: '/dashboard',
      });
      expect(ttl).toBe(600);
    });

    it('drops an unsafe redirect path', async () => {
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());
      await service.beginAuthorization('conn-1', '//evil.com');
      expect(JSON.parse(redis.set.mock.calls[0][1]).redirectPath).toBeUndefined();
    });

    it('refuses a disabled connection', async () => {
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection({ enabled: false }));
      await expect(service.beginAuthorization('conn-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('handleCallback', () => {
    const seedState = () =>
      redis.get.mockResolvedValue(
        JSON.stringify({
          connectionId: 'conn-1',
          codeVerifier: 'verifier-1',
          nonce: 'nonce-1',
          redirectPath: '/dashboard',
        }),
      );

    it('rejects an IdP error response', async () => {
      await expect(
        service.handleCallback({ error: 'access_denied', error_description: 'no' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a callback missing state or code', async () => {
      await expect(service.handleCallback({ state: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an unknown/expired state', async () => {
      redis.get.mockResolvedValue(null);
      await expect(service.handleCallback({ state: 'x', code: 'c' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a failed token exchange', async () => {
      seedState();
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());
      clientInstance.callback.mockRejectedValue(new Error('bad code'));

      await expect(service.handleCallback({ state: 's', code: 'c' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a forbidden email domain', async () => {
      seedState();
      prisma.ssoConnection.findFirst.mockResolvedValue(null);
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());
      clientInstance.callback.mockResolvedValue({
        claims: () => ({ email: 'user@evil.com', email_verified: true }),
      });

      await expect(service.handleCallback({ state: 's', code: 'c' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects an unverified email', async () => {
      seedState();
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());
      clientInstance.callback.mockResolvedValue({
        claims: () => ({ email: 'user@acme.com', email_verified: false }),
      });

      await expect(service.handleCallback({ state: 's', code: 'c' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('errors when the IdP returns no email', async () => {
      seedState();
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());
      clientInstance.callback.mockResolvedValue({ claims: () => ({}) });

      await expect(service.handleCallback({ state: 's', code: 'c' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('signs in an existing active user and redirects with a one-time code', async () => {
      seedState();
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());
      clientInstance.callback.mockResolvedValue({
        claims: () => ({ email: 'user@acme.com', email_verified: true }),
      });
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'user@acme.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'STAFF',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
      });

      const result = await service.handleCallback({ state: 's', code: 'c' });
      expect(result.redirectUrl).toMatch(/^https:\/\/app\.test\/sso\?code=[a-f0-9]{64}$/);
      expect(authService.issueTokensForUser).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalled(); // state consumed
      const codeCall = redis.set.mock.calls.find((call) => String(call[0]).startsWith('sso:code:'));
      expect(codeCall).toBeTruthy();
    });

    it('rejects an inactive user', async () => {
      seedState();
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());
      clientInstance.callback.mockResolvedValue({
        claims: () => ({ email: 'user@acme.com', email_verified: true }),
      });
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'user@acme.com',
        tenantId: 'tenant-1',
        status: 'SUSPENDED',
      });

      await expect(service.handleCallback({ state: 's', code: 'c' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects an email belonging to another tenant', async () => {
      seedState();
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());
      clientInstance.callback.mockResolvedValue({
        claims: () => ({ email: 'user@acme.com', email_verified: true }),
      });
      prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'user-9' });

      await expect(service.handleCallback({ state: 's', code: 'c' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses to auto-provision when disabled', async () => {
      seedState();
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection({ autoProvision: false }));
      clientInstance.callback.mockResolvedValue({
        claims: () => ({ email: 'user@acme.com', email_verified: true }),
      });
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.handleCallback({ state: 's', code: 'c' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('provisions a new user from claims', async () => {
      seedState();
      prisma.ssoConnection.findUnique.mockResolvedValue(makeConnection());
      clientInstance.callback.mockResolvedValue({
        claims: () => ({
          email: 'new@acme.com',
          email_verified: true,
          given_name: 'Grace',
          family_name: 'Hopper',
        }),
      });
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-new',
        email: 'new@acme.com',
        firstName: 'Grace',
        lastName: 'Hopper',
        role: 'STAFF',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
      });

      const result = await service.handleCallback({ state: 's', code: 'c' });
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'new@acme.com', emailVerified: true }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SSO_USER_PROVISIONED' }),
      );
      expect(result.redirectUrl).toContain('code=');
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('rejects an unknown code', async () => {
      redis.get.mockResolvedValue(null);
      await expect(service.exchangeAuthorizationCode('missing')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('returns the user and tokens then deletes the code', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ tokens: { accessToken: 'a', refreshToken: 'r' }, userId: 'user-1' }),
      );
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@acme.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'STAFF',
        tenantId: 'tenant-1',
        emailVerified: true,
      });

      const result = await service.exchangeAuthorizationCode('abc');
      expect(result.tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
      expect(result.user.id).toBe('user-1');
      expect(redis.del).toHaveBeenCalled();
    });

    it('rejects a code whose user vanished', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ tokens: { accessToken: 'a', refreshToken: 'r' }, userId: 'gone' }),
      );
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.exchangeAuthorizationCode('abc')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('redirect helpers', () => {
    it('builds a failure redirect with an error code', () => {
      expect(service.failureRedirect('sso_failed')).toBe('https://app.test/login?error=sso_failed');
    });

    it('returns an empty failure redirect when unconfigured', () => {
      config.get.mockImplementation((key: string, def?: unknown) =>
        key === 'sso.failureRedirectUrl' ? '' : (def ?? undefined),
      );
      expect(service.failureRedirect()).toBe('');
    });

    it('exposes the callback redirect uri', () => {
      expect(service.redirectUri()).toBe('https://api.test/api/v1/auth/sso/callback');
    });
  });
});
