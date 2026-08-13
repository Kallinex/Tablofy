import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { BCRYPT_ROUNDS } from '@tablofy/shared/constants';
import { canAssignRole, canManageUser } from '../../common/rbac/role-policy';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private readonly defaultSelect = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    phone: true,
    role: true,
    status: true,
    avatarUrl: true,
    emailVerified: true,
    tenantId: true,
    lastLoginAt: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async create(
    dto: CreateUserDto,
    creatorId: string,
    tenantId: string,
    creatorRole: UserRole,
    meta?: { ipAddress?: string; userAgent?: string },
    tx?: Prisma.TransactionClient,
  ) {
    const targetRole = dto.role ?? UserRole.STAFF;
    if (!canAssignRole(creatorRole, targetRole)) {
      throw new ForbiddenException(`Role ${targetRole} cannot be assigned by ${creatorRole}`);
    }

    const db = tx ?? this.prisma;

    const existingUser = await db.user.findFirst({
      where: { email: dto.email.toLowerCase(), tenantId },
    });

    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      const user = await db.user.create({
        data: {
          email: dto.email.toLowerCase(),
          password: hashedPassword,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          role: targetRole,
          tenantId,
        },
        select: this.defaultSelect,
      });

      await this.auditLogsService.log({
        action: 'USER_CREATED',
        resource: 'User',
        resourceId: user.id,
        userId: creatorId,
        tenantId,
        newValues: { email: user.email, role: user.role },
        ...meta,
      });

      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target: unknown[] = Array.isArray(error.meta?.target)
          ? (error.meta.target as unknown[])
          : [];
        const isDuplicateEmailRace =
          target.length === 0 ||
          target.some((t) => typeof t === 'string' && (t === 'email' || t === 'tenantId'));
        if (isDuplicateEmailRace) {
          throw new ConflictException('A user with this email already exists');
        }
      }
      throw error;
    }
  }

  async findAll(params: {
    tenantId: string;
    page?: number;
    limit?: number;
    search?: string;
    role?: UserRole;
    status?: UserStatus;
  }) {
    const { tenantId, page = 1, limit = 20, search, role, status } = params;

    const where: Prisma.UserWhereInput = { tenantId, deletedAt: null };
    if (role) where.role = role;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: this.defaultSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: this.defaultSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    tenantId: string,
    editorId: string,
    editorRole: UserRole,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);

    if (!canManageUser(editorRole, existing.role)) {
      throw new ForbiddenException(
        `Users with role ${existing.role} cannot be managed by ${editorRole}`,
      );
    }

    if (dto.role !== undefined && !canAssignRole(editorRole, dto.role)) {
      throw new ForbiddenException(`Role ${dto.role} cannot be assigned by ${editorRole}`);
    }

    if (dto.email && dto.email.toLowerCase() !== existing.email) {
      const emailTaken = await this.prisma.user.findFirst({
        where: { email: dto.email.toLowerCase(), tenantId, id: { not: id } },
      });
      if (emailTaken) {
        throw new ConflictException('Email is already taken');
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.email !== undefined && { email: dto.email.toLowerCase() }),
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
        ...(dto.preferences !== undefined && {
          preferences: dto.preferences as unknown as Prisma.InputJsonValue,
        }),
      },
      select: this.defaultSelect,
    });

    await this.auditLogsService.log({
      action: 'USER_UPDATED',
      resource: 'User',
      resourceId: id,
      userId: editorId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    return user;
  }

  async softDelete(
    id: string,
    tenantId: string,
    deleterId: string,
    deleterRole: UserRole,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    if (!canManageUser(deleterRole, existing.role)) {
      throw new ForbiddenException(
        `Users with role ${existing.role} cannot be deleted by ${deleterRole}`,
      );
    }

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: UserStatus.INACTIVE },
    });

    await this.auditLogsService.log({
      action: 'USER_DELETED',
      resource: 'User',
      resourceId: id,
      userId: deleterId,
      tenantId,
      ...meta,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    restorerId: string,
    restorerRole: UserRole,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
      select: { ...this.defaultSelect, deletedAt: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.deletedAt) {
      throw new ConflictException('User is not deleted');
    }

    if (!canManageUser(restorerRole, user.role)) {
      throw new ForbiddenException(
        `Users with role ${user.role} cannot be restored by ${restorerRole}`,
      );
    }

    const restored = await this.prisma.user.update({
      where: { id },
      data: { deletedAt: null, status: UserStatus.ACTIVE },
      select: this.defaultSelect,
    });

    await this.auditLogsService.log({
      action: 'USER_RESTORED',
      resource: 'User',
      resourceId: id,
      userId: restorerId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
