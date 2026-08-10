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
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { QueryWebhookDto } from './dto/query-webhook.dto';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { buildPaginationMeta, calculateSkip } from '../../common/utils/pagination.util';
import { SsrfBlockedError } from '../../common/ssrf/ssrf-guard';
import { SsrfClientService } from '../../common/ssrf/ssrf-client.service';
import {
  isValidWebhookEventName,
  normalizeWebhookEventName,
  webhookEventCandidates,
} from './webhook-events';

const MAX_WEBHOOK_EVENTS = 50;
const MAX_WEBHOOK_HEADERS = 20;
const MAX_WEBHOOK_HEADER_VALUE_LENGTH = 256;
const MAX_WEBHOOK_METADATA_KEYS = 20;

@Injectable()
export class WebhooksService {
  private readonly maxRegistrationsPerTenant: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveryService: WebhookDeliveryService,
    private readonly auditLogsService: AuditLogsService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly ssrfClient: SsrfClientService,
  ) {
    this.maxRegistrationsPerTenant = this.configService.get(
      'webhook.maxRegistrationsPerTenant',
      50,
    );
    this.logger.setContext('WebhooksService');
  }

  private async assertSafeWebhookUrl(url: string): Promise<void> {
    try {
      await this.ssrfClient.assertUrlSafe(url);
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        throw new BadRequestException(`Webhook URL is not allowed: ${error.message}`);
      }
      throw error;
    }
  }

  private normalizeEvents(events: string[]): string[] {
    if (events.length === 0) {
      throw new BadRequestException('At least one webhook event is required');
    }
    if (events.length > MAX_WEBHOOK_EVENTS) {
      throw new BadRequestException(
        `At most ${MAX_WEBHOOK_EVENTS} webhook events are allowed per registration`,
      );
    }
    const invalid = events.filter((event) => !isValidWebhookEventName(event));
    if (invalid.length > 0) {
      throw new BadRequestException(`Unknown webhook event(s): ${invalid.join(', ')}`);
    }
    return events.map((event) => normalizeWebhookEventName(event) as string);
  }

  private assertHeaderBounds(headers?: Record<string, string>): void {
    if (!headers) return;
    const keys = Object.keys(headers);
    if (keys.length > MAX_WEBHOOK_HEADERS) {
      throw new BadRequestException(`At most ${MAX_WEBHOOK_HEADERS} webhook headers are allowed`);
    }
    for (const [key, value] of Object.entries(headers)) {
      if (key.length > 256 || value.length > MAX_WEBHOOK_HEADER_VALUE_LENGTH) {
        throw new BadRequestException(
          'Webhook header keys and values must be 256 characters or fewer',
        );
      }
    }
  }

  private assertMetadataBounds(metadata?: Record<string, unknown>): void {
    if (!metadata) return;
    const keys = Object.keys(metadata);
    if (keys.length > MAX_WEBHOOK_METADATA_KEYS) {
      throw new BadRequestException(
        `At most ${MAX_WEBHOOK_METADATA_KEYS} webhook metadata keys are allowed`,
      );
    }
    for (const [key, value] of Object.entries(metadata)) {
      if (key.length > 256) {
        throw new BadRequestException('Webhook metadata keys must be 256 characters or fewer');
      }
      if (value !== null && typeof value === 'object' && Array.isArray(value) === false) {
        continue;
      }
      if (value !== null && typeof value !== 'object' && String(value).length > 1000) {
        throw new BadRequestException('Webhook metadata values must be 1000 characters or fewer');
      }
    }
  }

  async create(dto: CreateWebhookDto, tenantId: string, userId: string) {
    await this.assertSafeWebhookUrl(dto.url);
    const events = this.normalizeEvents(dto.events);
    this.assertHeaderBounds(dto.headers);
    this.assertMetadataBounds(dto.metadata);

    const existing = await this.prisma.webhookRegistration.findFirst({
      where: { tenantId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('Webhook registration with this name already exists');
    }

    const count = await this.prisma.webhookRegistration.count({
      where: { tenantId, deletedAt: null },
    });
    if (count >= this.maxRegistrationsPerTenant) {
      throw new BadRequestException(
        `Maximum ${this.maxRegistrationsPerTenant} webhook registrations allowed`,
      );
    }

    const { secret, hash, prefix } = this.deliveryService.generateSecret();
    const encryptedSecret = this.deliveryService.encryptSecret(secret);

    const registration = await this.prisma.webhookRegistration.create({
      data: {
        tenantId,
        name: dto.name,
        url: dto.url,
        description: dto.description,
        events,
        secretHash: hash,
        secretPrefix: prefix,
        encryptedSecret,
        retryCount: dto.retryCount ?? 3,
        timeoutMs: dto.timeoutMs ?? 30000,
        headers: (dto.headers ?? {}) as object,
        metadata: (dto.metadata ?? {}) as object,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogsService.log({
      action: 'WEBHOOK_CREATED',
      resource: 'WebhookRegistration',
      resourceId: registration.id,
      userId,
      tenantId,
    });

    return { registration, secret };
  }

  async findAll(query: QueryWebhookDto, tenantId: string) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (query.event) where.events = { has: query.event };
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = calculateSkip(page, limit);

    const [data, total] = await Promise.all([
      this.prisma.webhookRegistration.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
      }),
      this.prisma.webhookRegistration.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string, tenantId: string) {
    const registration = await this.prisma.webhookRegistration.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!registration) {
      throw new NotFoundException('Webhook registration not found');
    }
    return registration;
  }

  async update(id: string, dto: UpdateWebhookDto, tenantId: string, userId: string) {
    await this.findOne(id, tenantId);

    if (dto.url !== undefined) {
      await this.assertSafeWebhookUrl(dto.url);
    }

    if (dto.events !== undefined) {
      this.normalizeEvents(dto.events);
    }
    this.assertHeaderBounds(dto.headers);
    this.assertMetadataBounds(dto.metadata);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.url !== undefined) data.url = dto.url;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.events !== undefined) {
      data.events = dto.events.map((event) => normalizeWebhookEventName(event) as string);
    }
    if (dto.retryCount !== undefined) data.retryCount = dto.retryCount;
    if (dto.timeoutMs !== undefined) data.timeoutMs = dto.timeoutMs;
    if (dto.headers !== undefined) data.headers = dto.headers;
    if (dto.metadata !== undefined) data.metadata = dto.metadata;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const registration = await this.prisma.webhookRegistration.update({
      where: { id },
      data,
    });

    await this.auditLogsService.log({
      action: 'WEBHOOK_UPDATED',
      resource: 'WebhookRegistration',
      resourceId: id,
      userId,
      tenantId,
    });

    return registration;
  }

  async remove(id: string, tenantId: string, userId: string) {
    await this.findOne(id, tenantId);

    await this.prisma.webhookRegistration.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'WEBHOOK_DELETED',
      resource: 'WebhookRegistration',
      resourceId: id,
      userId,
      tenantId,
    });
  }

  async rotateSecret(id: string, tenantId: string, userId: string) {
    await this.findOne(id, tenantId);
    const { secret, hash, prefix } = this.deliveryService.generateSecret();
    const encryptedSecret = this.deliveryService.encryptSecret(secret);

    await this.prisma.webhookRegistration.update({
      where: { id },
      data: { secretHash: hash, secretPrefix: prefix, encryptedSecret },
    });

    await this.auditLogsService.log({
      action: 'WEBHOOK_SECRET_ROTATED',
      resource: 'WebhookRegistration',
      resourceId: id,
      userId,
      tenantId,
    });

    return { secret, prefix };
  }

  async getDeliveries(id: string, tenantId: string, page = 1, limit = 20) {
    await this.findOne(id, tenantId);
    return this.deliveryService.getDeliveriesByWebhook(id, page, limit);
  }

  async getActiveWebhooksForEvent(eventType: string, tenantId: string) {
    const canonical = normalizeWebhookEventName(eventType);
    if (!canonical) return [];
    const candidates = webhookEventCandidates(canonical);
    return this.prisma.webhookRegistration.findMany({
      where: { tenantId, isActive: true, deletedAt: null, events: { hasSome: [...candidates] } },
    });
  }
}
