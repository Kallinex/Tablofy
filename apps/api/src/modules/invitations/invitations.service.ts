import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UsersService } from '../users/users.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { Invitation, InvitationStatus, UserRole } from '@prisma/client';
import * as crypto from 'crypto';
import { addDays } from 'date-fns';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly EXPIRY_DAYS = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly auditLogsService: AuditLogsService,
    private readonly usersService: UsersService,
  ) {}

  async create(
    dto: CreateInvitationDto,
    tenantId: string,
    invitedByUserId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Invitation> {
    const existingInvitation = await this.prisma.invitation.findFirst({
      where: {
        email: dto.email.toLowerCase(),
        tenantId,
        status: InvitationStatus.PENDING,
      },
    });

    if (existingInvitation) {
      throw new ConflictException('An invitation is already pending for this email');
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), tenantId },
    });

    if (existingUser) {
      throw new ConflictException('A user with this email already exists in this tenant');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = addDays(new Date(), this.EXPIRY_DAYS);

    const invitation = await this.prisma.invitation.create({
      data: {
        email: dto.email.toLowerCase(),
        token,
        role: dto.role ?? UserRole.STAFF,
        tenantId,
        invitedBy: invitedByUserId,
        expiresAt,
      },
    });

    await this.redisService.setTemporaryToken(
      `invitation:${token}`,
      { invitationId: invitation.id },
      this.EXPIRY_DAYS * 24 * 60 * 60,
    );

    await this.auditLogsService.log({
      action: 'INVITATION_CREATED',
      resource: 'Invitation',
      resourceId: invitation.id,
      userId: invitedByUserId,
      tenantId,
      newValues: { email: invitation.email, role: invitation.role },
      ...meta,
    });

    return invitation;
  }

  async findAllByTenant(params: {
    tenantId: string;
    page?: number;
    limit?: number;
    status?: InvitationStatus;
  }): Promise<{
    data: Invitation[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, page = 1, limit = 20, status } = params;

    const where: Record<string, unknown> = { tenantId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.invitation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invitation.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findByToken(token: string): Promise<Invitation> {
    const invitation = await this.prisma.invitation.findFirst({
      where: { token, status: InvitationStatus.PENDING },
    });

    if (!invitation) {
      throw new NotFoundException('Invalid or expired invitation');
    }

    if (invitation.expiresAt < new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new NotFoundException('Invitation has expired');
    }

    return invitation;
  }

  async accept(
    token: string,
    password: string,
    firstName: string,
    lastName: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const invitation = await this.findByToken(token);

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Invitation is no longer pending');
    }

    await this.usersService.create(
      {
        email: invitation.email,
        password,
        firstName,
        lastName,
        role: invitation.role,
      },
      invitation.invitedBy,
      invitation.tenantId,
      meta,
    );

    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });

    await this.redisService.deleteTemporaryToken(`invitation:${token}`);

    await this.auditLogsService.log({
      action: 'INVITATION_ACCEPTED',
      resource: 'Invitation',
      resourceId: invitation.id,
      userId: invitation.invitedBy,
      tenantId: invitation.tenantId,
      ...meta,
    });
  }

  async reject(
    token: string,
    userId: string,
    tenantId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const invitation = await this.findByToken(token);

    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.REJECTED },
    });

    await this.redisService.deleteTemporaryToken(`invitation:${token}`);

    await this.auditLogsService.log({
      action: 'INVITATION_REJECTED',
      resource: 'Invitation',
      resourceId: invitation.id,
      userId,
      tenantId,
      ...meta,
    });
  }

  async revoke(
    invitationId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, tenantId },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Invitation is not pending');
    }

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.EXPIRED },
    });

    await this.redisService.deleteTemporaryToken(`invitation:${invitation.token}`);

    await this.auditLogsService.log({
      action: 'INVITATION_REVOKED',
      resource: 'Invitation',
      resourceId: invitationId,
      userId,
      tenantId,
      ...meta,
    });
  }

  async revokeExpired(): Promise<number> {
    const result = await this.prisma.invitation.updateMany({
      where: {
        status: InvitationStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: { status: InvitationStatus.EXPIRED },
    });

    this.logger.log(`Revoked ${result.count} expired invitations`);
    return result.count;
  }
}
