import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { Socket } from 'socket.io';
import { USER_ROLES } from '@tablofy/shared/constants';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface WsTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
  jti: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface WsUser {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

export const WS_TOKEN_ISSUER = 'tablofy';
export const WS_TOKEN_AUDIENCE = 'tablofy-api';

@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();
      return token.length > 0 ? token : null;
    }
    return null;
  }

  async authenticate(client: Socket): Promise<boolean> {
    const token = this.extractToken(client);
    if (!token) {
      return this.reject(client, 'Missing WebSocket authentication token');
    }

    let payload: WsTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<WsTokenPayload>(token, {
        secret: this.configService.get<string>('jwt.secret'),
      });
    } catch {
      return this.reject(client, 'Invalid or expired WebSocket token');
    }

    if (payload.iss !== WS_TOKEN_ISSUER || payload.aud !== WS_TOKEN_AUDIENCE) {
      return this.reject(client, 'Invalid WebSocket token claims');
    }

    try {
      const isBlacklisted = await this.redisService.isTokenBlacklisted(payload.jti);
      if (isBlacklisted) {
        return this.reject(client, 'WebSocket token has been revoked');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, tenantId: true, status: true },
      });

      if (!user) {
        return this.reject(client, 'User not found');
      }

      if (user.status !== 'ACTIVE') {
        return this.reject(client, 'Account is not active');
      }

      if (user.tenantId) {
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: user.tenantId },
          include: { subscription: true },
        });
        if (!tenant || tenant.status !== 'ACTIVE') {
          return this.reject(client, 'Tenant account is disabled');
        }
        if (tenant.subscription?.status !== 'ACTIVE') {
          return this.reject(client, 'Subscription is not active');
        }
      }

      const wsUser: WsUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      };
      client.data.user = wsUser;
      client.data.tenantId = user.tenantId;
      return true;
    } catch (error) {
      this.logger.error(
        `WebSocket authentication error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.reject(client, 'WebSocket authentication failed');
    }
  }

  resolveRequestedTenantId(client: Socket): string | null {
    const value = client.handshake.query?.tenantId;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    return null;
  }

  async joinAuthorizedRoom(client: Socket, requestedTenantId?: string | null): Promise<boolean> {
    const user = client.data.user as WsUser | undefined;
    if (!user) {
      return this.reject(client, 'Unauthenticated WebSocket client');
    }

    if (user.role === USER_ROLES.SUPER_ADMIN) {
      if (requestedTenantId) {
        client.join(`tenant:${requestedTenantId}`);
      } else if (user.tenantId) {
        client.join(`tenant:${user.tenantId}`);
      }
      return true;
    }

    if (!user.tenantId) {
      return this.reject(client, 'No tenant context available');
    }

    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      this.logger.warn(
        `User ${user.id} attempted to join tenant room ${requestedTenantId} (authorized tenant ${user.tenantId})`,
      );
      return this.reject(client, 'Access denied to this tenant');
    }

    client.join(`tenant:${user.tenantId}`);
    return true;
  }

  assertTenantAllowed(client: Socket, tenantId: string): boolean {
    const user = client.data.user as WsUser | undefined;
    if (!user) {
      return false;
    }
    if (user.role === USER_ROLES.SUPER_ADMIN) {
      return true;
    }
    if (tenantId === user.tenantId) {
      return true;
    }
    this.logger.warn(
      `User ${user.id} attempted to join tenant room ${tenantId} (authorized tenant ${user.tenantId})`,
    );
    return false;
  }

  private reject(client: Socket, reason: string): false {
    this.logger.warn(`Rejecting WebSocket client ${client.id}: ${reason}`);
    try {
      client.disconnect(true);
    } catch {
      // Client may already be closed; nothing else to do.
    }
    return false;
  }
}
