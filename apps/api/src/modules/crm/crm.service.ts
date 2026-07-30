import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { Prisma, TimelineEventType, CommunicationStatus } from '@prisma/client';
import { CreateTimelineEntryDto } from './dto/create-timeline-entry.dto';
import { CreateCommunicationDto } from './dto/create-communication.dto';
import { CreateCommunicationTemplateDto } from './dto/create-communication-template.dto';
import { UpdateCommunicationTemplateDto } from './dto/update-communication-template.dto';
import { CreateEventRuleDto } from './dto/create-event-rule.dto';
import { UpdateEventRuleDto } from './dto/update-event-rule.dto';

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Timeline ──

  async addTimelineEntry(
    customerId: string,
    dto: CreateTimelineEntryDto,
    tenantId: string,
    userId?: string,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const entry = await this.prisma.crmTimelineEntry.create({
      data: {
        tenantId,
        customerId,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        metadata: dto.metadata as Prisma.InputJsonValue,
        referenceId: dto.referenceId,
        referenceType: dto.referenceType,
      },
    });

    await this.auditLogsService.log({
      action: 'CRM_TIMELINE_ADD',
      resource: 'CrmTimelineEntry',
      resourceId: entry.id,
      userId,
      tenantId,
    });

    this.eventEmitter.emit('crm.timeline.added', { tenantId, customerId, entry });

    return entry;
  }

  async getTimeline(
    customerId: string,
    tenantId: string,
    page = 1,
    limit = 20,
    type?: TimelineEventType,
  ) {
    const where: Record<string, unknown> = { customerId, tenantId };
    if (type) where.type = type;

    const [data, total] = await Promise.all([
      this.prisma.crmTimelineEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.crmTimelineEntry.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async addSystemTimelineEntry(
    customerId: string,
    tenantId: string,
    type: TimelineEventType,
    title: string,
    description?: string,
    referenceId?: string,
    referenceType?: string,
    metadata?: Record<string, unknown>,
  ) {
    try {
      await this.prisma.crmTimelineEntry.create({
        data: {
          tenantId,
          customerId,
          type,
          title,
          description,
          referenceId,
          referenceType,
          metadata: metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to add timeline entry: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  // ── Communication Templates ──

  async createTemplate(dto: CreateCommunicationTemplateDto, tenantId: string, userId?: string) {
    const existing = await this.prisma.communicationTemplate.findUnique({
      where: { tenantId_name: { tenantId, name: dto.name } },
    });
    if (existing) throw new BadRequestException('Template with this name already exists');

    const template = await this.prisma.communicationTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        channel: dto.channel,
        subject: dto.subject,
        body: dto.body,
        variables: dto.variables as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogsService.log({
      action: 'COMM_TEMPLATE_CREATE',
      resource: 'CommunicationTemplate',
      resourceId: template.id,
      userId,
      tenantId,
    });

    return template;
  }

  async updateTemplate(
    id: string,
    dto: UpdateCommunicationTemplateDto,
    tenantId: string,
    userId?: string,
  ) {
    const template = await this.prisma.communicationTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!template) throw new NotFoundException('Template not found');

    const updated = await this.prisma.communicationTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        channel: dto.channel,
        subject: dto.subject,
        body: dto.body,
        variables: dto.variables as Prisma.InputJsonValue,
        isActive: dto.isActive,
      },
    });

    await this.auditLogsService.log({
      action: 'COMM_TEMPLATE_UPDATE',
      resource: 'CommunicationTemplate',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: template.name },
      newValues: { name: updated.name },
    });

    return updated;
  }

  async deleteTemplate(id: string, tenantId: string, userId?: string) {
    const template = await this.prisma.communicationTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!template) throw new NotFoundException('Template not found');

    await this.prisma.communicationTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'COMM_TEMPLATE_DELETE',
      resource: 'CommunicationTemplate',
      resourceId: id,
      userId,
      tenantId,
    });
  }

  async listTemplates(tenantId: string, channel?: string) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (channel) where.channel = channel;

    return this.prisma.communicationTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTemplate(id: string, tenantId: string) {
    const template = await this.prisma.communicationTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  // ── Communication Logs ──

  async sendCommunication(dto: CreateCommunicationDto, tenantId: string, userId?: string) {
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId },
      });
      if (!customer) throw new NotFoundException('Customer not found');
    }

    const log = await this.prisma.communicationLog.create({
      data: {
        tenantId,
        customerId: dto.customerId,
        channel: dto.channel,
        recipient: dto.recipient,
        subject: dto.subject,
        body: dto.body,
        status: CommunicationStatus.PENDING,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
    });

    await this.auditLogsService.log({
      action: 'COMM_SEND',
      resource: 'CommunicationLog',
      resourceId: log.id,
      userId,
      tenantId,
    });

    this.eventEmitter.emit('crm.communication.sent', { tenantId, log });

    await this.queueService.addJob('notification-jobs', 'process-communication', {
      tenantId,
      userId,
      payload: { communicationId: log.id },
    });

    return log;
  }

  async getCommunicationLogs(
    tenantId: string,
    page = 1,
    limit = 20,
    customerId?: string,
    channel?: string,
    status?: string,
  ) {
    const where: Record<string, unknown> = { tenantId };
    if (customerId) where.customerId = customerId;
    if (channel) where.channel = channel;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.communicationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.communicationLog.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async updateCommunicationStatus(
    id: string,
    status: CommunicationStatus,
    tenantId: string,
    metadata?: Record<string, unknown>,
  ) {
    const log = await this.prisma.communicationLog.findFirst({
      where: { id, tenantId },
    });
    if (!log) throw new NotFoundException('Communication log not found');

    const updateData: Record<string, unknown> = { status };
    if (status === 'SENT') updateData.sentAt = new Date();
    if (status === 'DELIVERED') updateData.deliveredAt = new Date();
    if (status === 'OPENED') updateData.openedAt = new Date();
    if (status === 'CLICKED') updateData.clickedAt = new Date();
    if (metadata) updateData.metadata = metadata;

    return this.prisma.communicationLog.update({
      where: { id },
      data: updateData,
    });
  }

  // ── Event Rules ──

  async createEventRule(dto: CreateEventRuleDto, tenantId: string, userId?: string) {
    const existing = await this.prisma.eventRule.findUnique({
      where: { tenantId_name: { tenantId, name: dto.name } },
    });
    if (existing) throw new BadRequestException('Event rule with this name already exists');

    const rule = await this.prisma.eventRule.create({
      data: {
        tenantId,
        name: dto.name,
        event: dto.event,
        condition: dto.condition as Prisma.InputJsonValue,
        action: dto.action as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
        description: dto.description,
      },
    });

    await this.auditLogsService.log({
      action: 'EVENT_RULE_CREATE',
      resource: 'EventRule',
      resourceId: rule.id,
      userId,
      tenantId,
    });

    return rule;
  }

  async updateEventRule(id: string, dto: UpdateEventRuleDto, tenantId: string, userId?: string) {
    const rule = await this.prisma.eventRule.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('Event rule not found');

    const updated = await this.prisma.eventRule.update({
      where: { id },
      data: {
        name: dto.name,
        event: dto.event,
        condition: dto.condition as Prisma.InputJsonValue,
        action: dto.action as Prisma.InputJsonValue,
        isActive: dto.isActive,
        description: dto.description,
      },
    });

    await this.auditLogsService.log({
      action: 'EVENT_RULE_UPDATE',
      resource: 'EventRule',
      resourceId: id,
      userId,
      tenantId,
    });

    return updated;
  }

  async deleteEventRule(id: string, tenantId: string, userId?: string) {
    const rule = await this.prisma.eventRule.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('Event rule not found');

    await this.prisma.eventRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'EVENT_RULE_DELETE',
      resource: 'EventRule',
      resourceId: id,
      userId,
      tenantId,
    });
  }

  async listEventRules(tenantId: string, event?: string) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (event) where.event = event;

    return this.prisma.eventRule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getEventRule(id: string, tenantId: string) {
    const rule = await this.prisma.eventRule.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('Event rule not found');
    return rule;
  }

  async processEvent(event: string, payload: Record<string, unknown>, tenantId: string) {
    const rules = await this.prisma.eventRule.findMany({
      where: { tenantId, event, isActive: true, deletedAt: null },
    });

    for (const rule of rules) {
      try {
        if (rule.condition) {
          const condition = rule.condition as Record<string, unknown>;
          if (!this.evaluateCondition(condition, payload)) continue;
        }

        await this.executeAction(rule.action as Record<string, unknown>, payload, tenantId);

        await this.prisma.eventLog.create({
          data: {
            tenantId,
            event,
            ruleId: rule.id,
            ruleName: rule.name,
            payload: payload as Prisma.InputJsonValue,
            result: 'SUCCESS',
          },
        });
      } catch (error) {
        this.logger.error(
          `Event rule ${rule.name} failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );

        await this.prisma.eventLog.create({
          data: {
            tenantId,
            event,
            ruleId: rule.id,
            ruleName: rule.name,
            payload: payload as Prisma.InputJsonValue,
            result: 'FAILED',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }
  }

  private evaluateCondition(
    condition: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    for (const [key, value] of Object.entries(condition)) {
      const payloadValue = payload[key];
      if (payloadValue !== value) return false;
    }
    return true;
  }

  private async executeAction(
    action: Record<string, unknown>,
    payload: Record<string, unknown>,
    tenantId: string,
  ) {
    const actionType = action.type as string;

    switch (actionType) {
      case 'add_timeline_entry': {
        const customerId = (
          action.customerIdField ? payload[action.customerIdField as string] : payload.customerId
        ) as string;
        if (customerId) {
          await this.addSystemTimelineEntry(
            customerId,
            tenantId,
            TimelineEventType.SYSTEM_EVENT,
            (action.title as string) || 'Automated event',
            action.description as string,
            payload.referenceId as string,
            payload.referenceType as string,
            payload as Record<string, unknown>,
          );
        }
        break;
      }
      case 'send_notification': {
        const customerId2 = (
          action.customerIdField ? payload[action.customerIdField as string] : payload.customerId
        ) as string;
        if (customerId2) {
          await this.queueService.addJob('notification-jobs', 'event-notification', {
            tenantId,
            payload: {
              customerId: customerId2,
              title: action.title || 'Notification',
              message: action.message || 'Event triggered',
            },
          });
        }
        break;
      }
      default:
        this.logger.warn(`Unknown action type: ${actionType}`);
    }
  }

  // ── Event Logs ──

  async getEventLogs(tenantId: string, page = 1, limit = 20, event?: string) {
    const where: Record<string, unknown> = { tenantId };
    if (event) where.event = event;

    const [data, total] = await Promise.all([
      this.prisma.eventLog.findMany({
        where,
        orderBy: { processedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.eventLog.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── Analytics Helpers ──

  async getCrmAnalytics(tenantId: string) {
    const cacheKey = 'crm:analytics';
    const cached = await this.cacheService.get<Record<string, unknown>>(tenantId, cacheKey);
    if (cached) return cached;

    const [timelineCount, commCount, ruleCount, eventLogCount] = await Promise.all([
      this.prisma.crmTimelineEntry.count({ where: { tenantId } }),
      this.prisma.communicationLog.count({ where: { tenantId } }),
      this.prisma.eventRule.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.eventLog.count({ where: { tenantId } }),
    ]);

    const analytics = {
      timelineEntries: timelineCount,
      communicationsSent: commCount,
      activeRules: ruleCount,
      eventsProcessed: eventLogCount,
    };

    await this.cacheService.set(tenantId, cacheKey, analytics, 300);
    return analytics;
  }
}
