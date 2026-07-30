import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { QueryApiKeyDto } from './dto/query-api-key.dto';
import { buildPaginationMeta, calculateSkip } from '../../common/utils/pagination.util';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  private readonly keyPrefix: string;
  private readonly keyLength: number;
  private readonly maxKeysPerTenant: number;
  private readonly rateLimitPerMin: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.keyPrefix = this.configService.get('apiKeys.keyPrefix', 'tab_');
    this.keyLength = this.configService.get('apiKeys.keyLength', 48);
    this.maxKeysPerTenant = this.configService.get('apiKeys.maxKeysPerTenant', 20);
    this.rateLimitPerMin = this.configService.get('apiKeys.rateLimitPerMin', 60);
    this.logger.setContext('ApiKeysService');
  }

  generateApiKey(): { rawKey: string; prefix: string; hash: string; lastChars: string } {
    const rawKey =
      this.keyPrefix +
      crypto.randomBytes(this.keyLength).toString('base64url').substring(0, this.keyLength);
    const prefix = rawKey.substring(0, this.keyPrefix.length + 8);
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const lastChars = rawKey.slice(-4);
    return { rawKey, prefix, hash, lastChars };
  }

  hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  async create(dto: CreateApiKeyDto, tenantId: string, userId: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { tenantId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('API key with this name already exists');
    }

    const count = await this.prisma.apiKey.count({
      where: { tenantId, deletedAt: null },
    });
    if (count >= this.maxKeysPerTenant) {
      throw new BadRequestException(`Maximum ${this.maxKeysPerTenant} API keys allowed`);
    }

    const { rawKey, prefix, hash, lastChars } = this.generateApiKey();

    await this.prisma.apiKey.create({
      data: {
        tenantId,
        name: dto.name,
        keyPrefix: prefix,
        keyHash: hash,
        keyLastChars: lastChars,
        scopes: dto.scopes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        rateLimitPerMin: dto.rateLimitPerMin ?? this.rateLimitPerMin,
        metadata: (dto.metadata ?? {}) as object,
        createdById: userId,
      },
    });

    await this.auditLogsService.log({
      action: 'API_KEY_CREATED',
      resource: 'ApiKey',
      resourceId: prefix,
      userId,
      tenantId,
    });

    return { key: rawKey, prefix, lastChars, scopes: dto.scopes };
  }

  async findAll(query: QueryApiKeyDto, tenantId: string) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.scope) where.scopes = { has: query.scope };

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = calculateSkip(page, limit);

    const [data, total] = await Promise.all([
      this.prisma.apiKey.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          keyLastChars: true,
          scopes: true,
          isActive: true,
          expiresAt: true,
          lastUsedAt: true,
          rateLimitPerMin: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.apiKey.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string, tenantId: string) {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        keyLastChars: true,
        scopes: true,
        isActive: true,
        expiresAt: true,
        lastUsedAt: true,
        rateLimitPerMin: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }
    return apiKey;
  }

  async update(id: string, dto: UpdateApiKeyDto, tenantId: string, userId: string) {
    await this.findOne(id, tenantId);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.scopes !== undefined) data.scopes = dto.scopes;
    if (dto.rateLimitPerMin !== undefined) data.rateLimitPerMin = dto.rateLimitPerMin;
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);
    if (dto.metadata !== undefined) data.metadata = dto.metadata;

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        expiresAt: true,
        rateLimitPerMin: true,
        updatedAt: true,
      },
    });

    await this.auditLogsService.log({
      action: 'API_KEY_UPDATED',
      resource: 'ApiKey',
      resourceId: updated.keyPrefix,
      userId,
      tenantId,
    });

    return updated;
  }

  async remove(id: string, tenantId: string, userId: string) {
    await this.findOne(id, tenantId);

    await this.prisma.apiKey.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'API_KEY_DELETED',
      resource: 'ApiKey',
      resourceId: id,
      userId,
      tenantId,
    });
  }

  async rotate(id: string, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    const { rawKey, prefix, hash, lastChars } = this.generateApiKey();

    await this.prisma.apiKey.update({
      where: { id },
      data: { keyPrefix: prefix, keyHash: hash, keyLastChars: lastChars },
    });

    await this.auditLogsService.log({
      action: 'API_KEY_ROTATED',
      resource: 'ApiKey',
      resourceId: existing.keyPrefix,
      userId,
      tenantId,
    });

    return { key: rawKey, prefix, lastChars };
  }

  async validateApiKey(
    rawKey: string,
  ): Promise<{ valid: boolean; tenantId?: string; scopes?: string[] }> {
    const hash = this.hashKey(rawKey);
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { keyHash: hash, isActive: true, deletedAt: null },
    });

    if (!apiKey) return { valid: false };

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return { valid: false };
    }

    await this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return { valid: true, tenantId: apiKey.tenantId, scopes: apiKey.scopes };
  }
}
