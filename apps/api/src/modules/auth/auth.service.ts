import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { randomBytes, createHash } from 'crypto';
import { addHours, addDays, addMinutes, differenceInSeconds } from 'date-fns';
import * as bcrypt from 'bcrypt';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BCRYPT_ROUNDS } from '@tablofy/shared/constants';
const VERIFICATION_TOKEN_TTL_HOURS = 24;
const PASSWORD_RESET_TOKEN_TTL_HOURS = 1;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string | null;
  emailVerified: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async register(
    data: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      phone?: string;
      tenantName?: string;
    },
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const existingUser = await this.prisma.user.findFirst({
      where: { email: data.email.toLowerCase() },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    const result = await this.prisma.$transaction(async (tx) => {
      let tenantId: string | null = null;

      if (data.tenantName) {
        const slug = this.generateSlug(data.tenantName);
        const tenant = await tx.tenant.create({
          data: {
            name: data.tenantName,
            slug,
          },
        });
        tenantId = tenant.id;

        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            plan: 'FREE',
            status: 'ACTIVE',
          },
        });
      }

      const user = await tx.user.create({
        data: {
          email: data.email.toLowerCase(),
          password: hashedPassword,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          role: tenantId ? 'OWNER' : 'STAFF',
          tenantId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          tenantId: true,
          emailVerified: true,
        },
      });

      return user;
    });

    const tokens = await this.generateTokenPair(result, meta);

    await this.auditLogsService.log({
      action: 'USER_REGISTERED',
      resource: 'User',
      resourceId: result.id,
      userId: result.id,
      tenantId: result.tenantId ?? undefined,
      newValues: { email: result.email, role: result.role },
      ...meta,
    });

    return { user: result, tokens };
  }

  async login(
    email: string,
    password: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        password: true,
        role: true,
        tenantId: true,
        status: true,
        emailVerified: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingSeconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      await this.auditLogsService.log({
        action: 'LOGIN_BLOCKED_LOCKED',
        resource: 'User',
        resourceId: user.id,
        userId: user.id,
        tenantId: user.tenantId ?? undefined,
        newValues: { reason: 'Account locked', remainingSeconds },
        ...meta,
      });
      throw new UnauthorizedException(
        `Account is locked. Try again in ${Math.ceil(remainingSeconds / 60)} minute(s).`,
      );
    }

    if (user.lockedUntil && user.lockedUntil <= new Date()) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const newAttemptCount =
        (user.lockedUntil && user.lockedUntil <= new Date() ? 0 : user.failedLoginAttempts) + 1;
      const updateData: { failedLoginAttempts: number; lockedUntil?: Date | null } = {
        failedLoginAttempts: newAttemptCount,
      };

      if (newAttemptCount >= MAX_FAILED_LOGIN_ATTEMPTS) {
        updateData.lockedUntil = addMinutes(new Date(), LOCKOUT_DURATION_MINUTES);
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });

      await this.auditLogsService.log({
        action: 'LOGIN_FAILED',
        resource: 'User',
        resourceId: user.id,
        userId: user.id,
        tenantId: user.tenantId ?? undefined,
        newValues: {
          reason: 'Invalid password',
          failedAttempts: newAttemptCount,
          locked: newAttemptCount >= MAX_FAILED_LOGIN_ATTEMPTS,
        },
        ...meta,
      });

      if (newAttemptCount >= MAX_FAILED_LOGIN_ATTEMPTS) {
        throw new UnauthorizedException(
          `Account locked due to ${MAX_FAILED_LOGIN_ATTEMPTS} failed attempts. Try again in ${LOCKOUT_DURATION_MINUTES} minute(s).`,
        );
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    });

    if (user.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        include: { subscription: true },
      });
      if (!tenant || tenant.status !== 'ACTIVE') {
        throw new UnauthorizedException('Tenant account is disabled');
      }
      if (tenant.subscription?.status !== 'ACTIVE') {
        throw new UnauthorizedException('Subscription is not active');
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userWithoutPassword } = user;
    const tokens = await this.generateTokenPair(userWithoutPassword, meta);

    await this.auditLogsService.log({
      action: 'USER_LOGIN',
      resource: 'User',
      resourceId: user.id,
      userId: user.id,
      tenantId: user.tenantId ?? undefined,
      ...meta,
    });

    return { user: userWithoutPassword, tokens };
  }

  async refreshTokens(
    refreshTokenValue: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshTokenValue },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            tenantId: true,
            status: true,
            emailVerified: true,
          },
        },
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.revokedAt) {
      await this.auditLogsService.log({
        action: 'TOKEN_REUSE_DETECTED',
        resource: 'RefreshToken',
        resourceId: storedToken.id,
        userId: storedToken.userId,
        tenantId: storedToken.user.tenantId ?? undefined,
        newValues: { reason: 'Reuse of revoked token detected' },
        ...meta,
      });
      await this.revokeAllUserTokens(storedToken.userId);
      throw new UnauthorizedException('Token reuse detected. All sessions revoked.');
    }

    if (new Date() > storedToken.expiresAt) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (storedToken.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    const tokens = await this.generateTokenPair(
      {
        id: storedToken.user.id,
        email: storedToken.user.email,
        firstName: storedToken.user.firstName,
        lastName: storedToken.user.lastName,
        role: storedToken.user.role,
        tenantId: storedToken.user.tenantId,
      },
      meta,
    );

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    return tokens;
  }

  async logout(
    userId: string,
    refreshTokenValue?: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    if (refreshTokenValue) {
      await this.prisma.refreshToken.updateMany({
        where: { token: refreshTokenValue, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await this.redisService.deleteUserSessions(userId);

    await this.auditLogsService.log({
      action: 'USER_LOGOUT',
      resource: 'User',
      resourceId: userId,
      userId,
      ...meta,
    });
  }

  async logoutAllDevices(
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.revokeAllUserTokens(userId);
    await this.redisService.deleteUserSessions(userId);

    await this.auditLogsService.log({
      action: 'USER_LOGOUT_ALL_DEVICES',
      resource: 'User',
      resourceId: userId,
      userId,
      ...meta,
    });
  }

  async forgotPassword(
    email: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, tenantId: true },
    });

    if (!user) {
      return;
    }

    const token = this.generateSecureToken();

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        token: createHash('sha256').update(token).digest('hex'),
        type: 'PASSWORD_RESET',
        expiresAt: addHours(new Date(), PASSWORD_RESET_TOKEN_TTL_HOURS),
      },
    });

    this.logger.log(`Password reset token generated for user ${user.id}`);

    await this.auditLogsService.log({
      action: 'PASSWORD_RESET_REQUESTED',
      resource: 'User',
      resourceId: user.id,
      userId: user.id,
      tenantId: user.tenantId ?? undefined,
      ...meta,
    });
  }

  async resetPassword(
    token: string,
    newPassword: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const hashedToken = createHash('sha256').update(token).digest('hex');

    const verificationToken = await this.prisma.verificationToken.findUnique({
      where: { token: hashedToken },
      include: { user: { select: { id: true, tenantId: true } } },
    });

    if (!verificationToken) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (verificationToken.type !== 'PASSWORD_RESET') {
      throw new BadRequestException('Invalid token type');
    }

    if (new Date() > verificationToken.expiresAt) {
      throw new BadRequestException('Reset token has expired');
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: verificationToken.userId },
        data: {
          password: hashedPassword,
          lastPasswordChange: new Date(),
        },
      });

      await tx.verificationToken.delete({
        where: { id: verificationToken.id },
      });

      await tx.refreshToken.updateMany({
        where: { userId: verificationToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.redisService.deleteUserSessions(verificationToken.userId);

    await this.auditLogsService.log({
      action: 'PASSWORD_RESET_COMPLETED',
      resource: 'User',
      resourceId: verificationToken.userId,
      userId: verificationToken.userId,
      tenantId: verificationToken.user.tenantId ?? undefined,
      ...meta,
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, tenantId: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          lastPasswordChange: new Date(),
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.auditLogsService.log({
      action: 'PASSWORD_CHANGED',
      resource: 'User',
      resourceId: userId,
      userId,
      tenantId: user.tenantId ?? undefined,
      ...meta,
    });
  }

  async verifyEmail(
    token: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const hashedToken = createHash('sha256').update(token).digest('hex');

    const verificationToken = await this.prisma.verificationToken.findUnique({
      where: { token: hashedToken },
      include: { user: { select: { id: true, tenantId: true } } },
    });

    if (!verificationToken) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    if (verificationToken.type !== 'EMAIL_VERIFICATION') {
      throw new BadRequestException('Invalid token type');
    }

    if (new Date() > verificationToken.expiresAt) {
      throw new BadRequestException('Verification token has expired');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: verificationToken.userId },
        data: { emailVerified: true },
      });

      await tx.verificationToken.delete({
        where: { id: verificationToken.id },
      });
    });

    await this.auditLogsService.log({
      action: 'EMAIL_VERIFIED',
      resource: 'User',
      resourceId: verificationToken.userId,
      userId: verificationToken.userId,
      tenantId: verificationToken.user.tenantId ?? undefined,
      ...meta,
    });
  }

  async resendVerificationEmail(
    userId: string,
    _meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, emailVerified: true, tenantId: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    await this.prisma.verificationToken.deleteMany({
      where: { userId, type: 'EMAIL_VERIFICATION' },
    });

    const token = this.generateSecureToken();

    await this.prisma.verificationToken.create({
      data: {
        userId,
        token: createHash('sha256').update(token).digest('hex'),
        type: 'EMAIL_VERIFICATION',
        expiresAt: addHours(new Date(), VERIFICATION_TOKEN_TTL_HOURS),
      },
    });

    this.logger.log(`Email verification token generated for user ${userId}`);
  }

  async validateUserById(userId: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        emailVerified: true,
      },
    });
  }

  private async generateTokenPair(
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
      tenantId: string | null;
    },
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const jti = randomBytes(16).toString('hex');
    const sessionId = randomBytes(16).toString('hex');

    const accessExpiresIn = this.configService.get<string>('jwt.expiration', '15m');
    const refreshExpiresIn = this.configService.get<string>('jwt.refreshExpiration', '7d');

    const accessToken = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        jti,
        iss: 'tablofy',
        aud: 'tablofy-api',
      },
      { expiresIn: accessExpiresIn } as Record<string, unknown>,
    );

    const refreshExpiresAt = this.parseDuration(refreshExpiresIn);

    const refreshTokenRecord = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: randomBytes(40).toString('hex'),
        userAgent: meta?.userAgent,
        ipAddress: meta?.ipAddress,
        expiresAt: refreshExpiresAt,
      },
    });

    const sessionTtl = differenceInSeconds(refreshExpiresAt, new Date());
    await this.redisService.setSession(
      sessionId,
      {
        userId: user.id,
        accessTokenJti: jti,
        userAgent: meta?.userAgent,
        ipAddress: meta?.ipAddress,
        createdAt: new Date().toISOString(),
      },
      sessionTtl,
    );
    await this.redisService.addUserSession(user.id, sessionId);

    return {
      accessToken,
      refreshToken: refreshTokenRecord.token,
    };
  }

  private async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  }

  private generateSecureToken(): string {
    return randomBytes(32).toString('hex');
  }

  private parseDuration(duration: string): Date {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      return addDays(new Date(), 7);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const now = new Date();
    switch (unit) {
      case 's':
        return new Date(now.getTime() + value * 1000);
      case 'm':
        return new Date(now.getTime() + value * 60 * 1000);
      case 'h':
        return new Date(now.getTime() + value * 60 * 60 * 1000);
      case 'd':
        return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
      default:
        return addDays(now, 7);
    }
  }
}
