import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { WsAuthService, WsTokenPayload } from '../ws-auth.service';
import { RedisService } from '../../../redis/redis.service';
import { PrismaService } from '../../../prisma/prisma.service';

const VALID_TOKEN = 'valid.jwt.token';
const EXPIRED_TOKEN = 'expired.jwt.token';
const INVALID_TOKEN = 'not-a-jwt';

const ACTIVE_USER = {
  id: 'user-a',
  email: 'a@example.com',
  role: 'OWNER',
  tenantId: 'tenant-a',
  status: 'ACTIVE',
};

const INACTIVE_USER = { ...ACTIVE_USER, status: 'INACTIVE' };

function makePayload(overrides: Partial<WsTokenPayload> = {}): WsTokenPayload {
  return {
    sub: 'user-a',
    email: 'a@example.com',
    role: 'OWNER',
    tenantId: 'tenant-a',
    jti: 'jti-1',
    iss: 'tablofy',
    aud: 'tablofy-api',
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 900,
    ...overrides,
  };
}

interface MockSocketExtras {
  joined: string[];
  disconnected: boolean;
}

function makeSocket(): Socket & MockSocketExtras {
  const rooms = new Set<string>();
  const joined: string[] = [];
  let disconnected = false;
  const socket = {
    id: 'socket-1',
    handshake: {
      auth: {},
      headers: {},
      query: {},
    },
    data: {},
    rooms,
    joined,
    get disconnected() {
      return disconnected;
    },
    join(room: string) {
      joined.push(room);
      rooms.add(room);
    },
    leave(room: string) {
      rooms.delete(room);
    },
    disconnect(close?: boolean) {
      disconnected = close ?? true;
    },
  } as unknown as Socket & MockSocketExtras;
  return socket;
}

describe('WsAuthService', () => {
  let service: WsAuthService;
  let jwtService: { verifyAsync: jest.Mock };
  let redisService: { isTokenBlacklisted: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock }; tenant: { findUnique: jest.Mock } };

  const activeTenant = {
    id: 'tenant-a',
    status: 'ACTIVE',
    subscription: { status: 'ACTIVE' },
  };

  beforeEach(async () => {
    jwtService = {
      verifyAsync: jest.fn().mockImplementation(async (token: string) => {
        if (token === EXPIRED_TOKEN) {
          throw new Error('jwt expired');
        }
        if (token !== VALID_TOKEN) {
          throw new Error('invalid signature');
        }
        return makePayload();
      }),
    };
    redisService = {
      isTokenBlacklisted: jest.fn().mockResolvedValue(false),
    };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(ACTIVE_USER),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue(activeTenant),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        WsAuthService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
        { provide: JwtService, useValue: jwtService },
        { provide: RedisService, useValue: redisService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(WsAuthService);
  });

  describe('resolveRequestedTenantId', () => {
    it('returns a plain string tenant id from the handshake query', () => {
      const socket = makeSocket();
      socket.handshake.query.tenantId = 'tenant-a';
      expect(service.resolveRequestedTenantId(socket)).toBe('tenant-a');
    });

    it('returns null when tenantId is an array (never trusts untrusted shapes)', () => {
      const socket = makeSocket();
      socket.handshake.query.tenantId = ['tenant-a', 'tenant-b'];
      expect(service.resolveRequestedTenantId(socket)).toBeNull();
    });

    it('returns null when tenantId is empty', () => {
      const socket = makeSocket();
      socket.handshake.query.tenantId = '';
      expect(service.resolveRequestedTenantId(socket)).toBeNull();
    });

    it('returns null when tenantId is missing', () => {
      expect(service.resolveRequestedTenantId(makeSocket())).toBeNull();
    });

    it('returns null when tenantId is a non-string object', () => {
      const socket = makeSocket();
      socket.handshake.query.tenantId = { foo: 'bar' } as unknown as string;
      expect(service.resolveRequestedTenantId(socket)).toBeNull();
    });
  });

  describe('extractToken', () => {
    it('returns token from handshake.auth.token', () => {
      const socket = makeSocket();
      socket.handshake.auth.token = VALID_TOKEN;
      expect(service.extractToken(socket)).toBe(VALID_TOKEN);
    });

    it('returns token from Authorization Bearer header', () => {
      const socket = makeSocket();
      socket.handshake.headers.authorization = `Bearer ${VALID_TOKEN}`;
      expect(service.extractToken(socket)).toBe(VALID_TOKEN);
    });

    it('returns null when no token is provided', () => {
      expect(service.extractToken(makeSocket())).toBeNull();
    });
  });

  describe('authenticate', () => {
    it('rejects anonymous connection (missing token) and disconnects', async () => {
      const socket = makeSocket();
      const ok = await service.authenticate(socket);
      expect(ok).toBe(false);
      expect(socket.disconnected).toBe(true);
    });

    it('rejects an invalid JWT and disconnects', async () => {
      const socket = makeSocket();
      socket.handshake.auth.token = INVALID_TOKEN;
      expect(await service.authenticate(socket)).toBe(false);
      expect(socket.disconnected).toBe(true);
    });

    it('rejects an expired JWT and disconnects', async () => {
      const socket = makeSocket();
      socket.handshake.auth.token = EXPIRED_TOKEN;
      expect(await service.authenticate(socket)).toBe(false);
      expect(socket.disconnected).toBe(true);
    });

    it('rejects a revoked (blacklisted) token', async () => {
      redisService.isTokenBlacklisted.mockResolvedValue(true);
      const socket = makeSocket();
      socket.handshake.auth.token = VALID_TOKEN;
      expect(await service.authenticate(socket)).toBe(false);
      expect(socket.disconnected).toBe(true);
    });

    it('rejects a deleted (non-existent) user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const socket = makeSocket();
      socket.handshake.auth.token = VALID_TOKEN;
      expect(await service.authenticate(socket)).toBe(false);
      expect(socket.disconnected).toBe(true);
    });

    it('rejects an inactive user', async () => {
      prisma.user.findUnique.mockResolvedValue(INACTIVE_USER);
      const socket = makeSocket();
      socket.handshake.auth.token = VALID_TOKEN;
      expect(await service.authenticate(socket)).toBe(false);
      expect(socket.disconnected).toBe(true);
    });

    it('rejects a user whose tenant is disabled', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-a', status: 'SUSPENDED' });
      const socket = makeSocket();
      socket.handshake.auth.token = VALID_TOKEN;
      expect(await service.authenticate(socket)).toBe(false);
    });

    it('rejects a user whose subscription is inactive', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-a',
        status: 'ACTIVE',
        subscription: { status: 'PAST_DUE' },
      });
      const socket = makeSocket();
      socket.handshake.auth.token = VALID_TOKEN;
      expect(await service.authenticate(socket)).toBe(false);
    });

    it('rejects tokens with wrong issuer or audience', async () => {
      jwtService.verifyAsync.mockResolvedValue(makePayload({ iss: 'evil', aud: 'evil-api' }));
      const socket = makeSocket();
      socket.handshake.auth.token = VALID_TOKEN;
      expect(await service.authenticate(socket)).toBe(false);
    });

    it('accepts a valid active user and attaches trusted auth context', async () => {
      const socket = makeSocket();
      socket.handshake.auth.token = VALID_TOKEN;
      expect(await service.authenticate(socket)).toBe(true);
      expect(socket.data.user).toEqual({
        id: 'user-a',
        email: 'a@example.com',
        role: 'OWNER',
        tenantId: 'tenant-a',
      });
      expect(socket.data.tenantId).toBe('tenant-a');
      expect(socket.disconnected).toBe(false);
    });

    it('accepts a SUPER_ADMIN user without a tenant', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'super-1',
        email: 'root@example.com',
        role: 'SUPER_ADMIN',
        tenantId: null,
        status: 'ACTIVE',
      });
      jwtService.verifyAsync.mockResolvedValue(
        makePayload({ role: 'SUPER_ADMIN', tenantId: null }),
      );
      const socket = makeSocket();
      socket.handshake.auth.token = VALID_TOKEN;
      expect(await service.authenticate(socket)).toBe(true);
      expect(socket.data.user.role).toBe('SUPER_ADMIN');
    });
  });

  describe('joinAuthorizedRoom', () => {
    it('rejects a client with no authenticated user', async () => {
      const socket = makeSocket();
      expect(await service.joinAuthorizedRoom(socket, 'tenant-b')).toBe(false);
      expect(socket.disconnected).toBe(true);
    });

    it('rejects Tenant A user trying to join Tenant B room', async () => {
      const socket = makeSocket();
      socket.data.user = ACTIVE_USER;
      socket.data.tenantId = 'tenant-a';
      expect(await service.joinAuthorizedRoom(socket, 'tenant-b')).toBe(false);
      expect(socket.disconnected).toBe(true);
      expect(socket.joined).toEqual([]);
    });

    it('allows Tenant A user to join their own tenant room', async () => {
      const socket = makeSocket();
      socket.data.user = ACTIVE_USER;
      socket.data.tenantId = 'tenant-a';
      expect(await service.joinAuthorizedRoom(socket, 'tenant-a')).toBe(true);
      expect(socket.joined).toEqual(['tenant:tenant-a']);
    });

    it('joins the authenticated tenant when none requested', async () => {
      const socket = makeSocket();
      socket.data.user = ACTIVE_USER;
      socket.data.tenantId = 'tenant-a';
      expect(await service.joinAuthorizedRoom(socket)).toBe(true);
      expect(socket.joined).toEqual(['tenant:tenant-a']);
    });

    it('rejects a user with no tenant context', async () => {
      const socket = makeSocket();
      socket.data.user = { id: 'u', email: 'u@example.com', role: 'OWNER', tenantId: null };
      expect(await service.joinAuthorizedRoom(socket)).toBe(false);
      expect(socket.disconnected).toBe(true);
    });

    it('lets a SUPER_ADMIN join a requested tenant room', async () => {
      const socket = makeSocket();
      socket.data.user = {
        id: 'super',
        email: 'root@example.com',
        role: 'SUPER_ADMIN',
        tenantId: null,
      };
      expect(await service.joinAuthorizedRoom(socket, 'tenant-z')).toBe(true);
      expect(socket.joined).toEqual(['tenant:tenant-z']);
    });
  });

  describe('assertTenantAllowed', () => {
    it('returns false for an unauthenticated client', () => {
      expect(service.assertTenantAllowed(makeSocket(), 'tenant-a')).toBe(false);
    });

    it('returns true for a user joining their own tenant', () => {
      const socket = makeSocket();
      socket.data.user = ACTIVE_USER;
      expect(service.assertTenantAllowed(socket, 'tenant-a')).toBe(true);
    });

    it('returns false for a user joining another tenant', () => {
      const socket = makeSocket();
      socket.data.user = ACTIVE_USER;
      expect(service.assertTenantAllowed(socket, 'tenant-b')).toBe(false);
    });

    it('returns true for a SUPER_ADMIN joining any tenant', () => {
      const socket = makeSocket();
      socket.data.user = {
        id: 'super',
        email: 'root@example.com',
        role: 'SUPER_ADMIN',
        tenantId: null,
      };
      expect(service.assertTenantAllowed(socket, 'tenant-b')).toBe(true);
    });
  });
});
