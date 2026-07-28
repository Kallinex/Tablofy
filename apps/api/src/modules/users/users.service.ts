import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { BCRYPT_ROUNDS } from '@tablofy/shared/constants';

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
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existingUser = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), tenantId },
    });

    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role: dto.role ?? 'STAFF',
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
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.findOne(id, tenantId);

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
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.findOne(id, tenantId);

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
