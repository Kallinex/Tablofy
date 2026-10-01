import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmService } from '../crm.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';

const TENANT = 'tenant-1';
const USER = 'user-1';

describe('CrmService timeline, templates, communications and event rules', () => {
  let service: CrmService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let cacheService: { get: jest.Mock; set: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let queue: { addJob: jest.Mock };
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }) },
      crmTimelineEntry: {
        create: jest.fn().mockResolvedValue({ id: 'tl-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      communicationTemplate: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({ id: 'tpl-1', name: 'Welcome', tenantId: TENANT }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'tpl-1', name: 'Welcome' }),
        update: jest.fn().mockResolvedValue({ id: 'tpl-1', name: 'Renamed' }),
      },
      communicationLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue({ id: 'log-1' }),
        update: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
      eventRule: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({ id: 'rule-1', name: 'R', tenantId: TENANT }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'rule-1' }),
        update: jest.fn().mockResolvedValue({ id: 'rule-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      eventLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    queue = { addJob: jest.fn().mockResolvedValue(undefined) };
    emitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: CacheService, useValue: cacheService },
        { provide: QueueService, useValue: queue },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get<CrmService>(CrmService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('timeline', () => {
    it('adds an entry, audits it and broadcasts the change', async () => {
      await service.addTimelineEntry(
        'cust-1',
        { type: 'NOTE', title: 'Called', description: 'Asked about menu' } as never,
        TENANT,
        USER,
      );

      expect(prisma.crmTimelineEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: TENANT, customerId: 'cust-1', title: 'Called' }),
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CRM_TIMELINE_ADD', resourceId: 'tl-1' }),
      );
      expect(emitter.emit).toHaveBeenCalledWith('crm.timeline.added', {
        tenantId: TENANT,
        customerId: 'cust-1',
        entry: { id: 'tl-1' },
      });
    });

    it('rejects a timeline entry for a customer in another tenant', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.addTimelineEntry('cust-1', { type: 'NOTE', title: 'x' } as never, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('paginates the timeline newest first', async () => {
      prisma.crmTimelineEntry.count.mockResolvedValue(30);

      const result = await service.getTimeline('cust-1', TENANT, 2, 10);

      expect(prisma.crmTimelineEntry.findMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', tenantId: TENANT },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });
      expect(result.meta).toEqual({ total: 30, page: 2, limit: 10, totalPages: 3 });
    });

    it('filters the timeline by event type', async () => {
      await service.getTimeline('cust-1', TENANT, 1, 20, 'NOTE' as never);

      const [args] = prisma.crmTimelineEntry.findMany.mock.calls[0];
      expect(args.where.type).toBe('NOTE');
    });

    it('swallows a write failure on a system entry', async () => {
      prisma.crmTimelineEntry.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.addSystemTimelineEntry('cust-1', TENANT, 'SYSTEM_EVENT' as never, 'Auto'),
      ).resolves.toBeUndefined();
    });

    it('swallows a non error rejection on a system entry', async () => {
      prisma.crmTimelineEntry.create.mockRejectedValue('plain string');

      await expect(
        service.addSystemTimelineEntry('cust-1', TENANT, 'SYSTEM_EVENT' as never, 'Auto'),
      ).resolves.toBeUndefined();
    });
  });

  describe('communication templates', () => {
    const dto = { name: 'Welcome', channel: 'EMAIL', subject: 'Hi', body: 'Hello' } as never;

    it('creates a template that is active by default', async () => {
      await service.createTemplate(dto, TENANT, USER);

      expect(prisma.communicationTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: TENANT, name: 'Welcome', isActive: true }),
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'COMM_TEMPLATE_CREATE' }),
      );
    });

    it('rejects a duplicate template name in the same tenant', async () => {
      prisma.communicationTemplate.findUnique.mockResolvedValue({ id: 'tpl-0' });

      await expect(service.createTemplate(dto, TENANT)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates a template and records the name change', async () => {
      await service.updateTemplate('tpl-1', { name: 'Renamed' } as never, TENANT, USER);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COMM_TEMPLATE_UPDATE',
          oldValues: { name: 'Welcome' },
          newValues: { name: 'Renamed' },
        }),
      );
    });

    it('rejects updating a template from another tenant', async () => {
      prisma.communicationTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTemplate('tpl-1', { name: 'x' } as never, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft deletes a template', async () => {
      await service.deleteTemplate('tpl-1', TENANT, USER);

      expect(prisma.communicationTemplate.update).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'COMM_TEMPLATE_DELETE' }),
      );
    });

    it('rejects deleting a template that does not exist', async () => {
      prisma.communicationTemplate.findFirst.mockResolvedValue(null);

      await expect(service.deleteTemplate('tpl-1', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lists templates and filters by channel', async () => {
      await service.listTemplates(TENANT);
      expect(prisma.communicationTemplate.findMany).toHaveBeenLastCalledWith({
        where: { tenantId: TENANT, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });

      await service.listTemplates(TENANT, 'SMS');
      const [args] = prisma.communicationTemplate.findMany.mock.calls[1];
      expect(args.where.channel).toBe('SMS');
    });

    it('returns a template owned by the tenant', async () => {
      await service.getTemplate('tpl-1', TENANT);

      expect(prisma.communicationTemplate.findFirst).toHaveBeenCalledWith({
        where: { id: 'tpl-1', tenantId: TENANT, deletedAt: null },
      });
    });

    it('rejects reading a template from another tenant', async () => {
      prisma.communicationTemplate.findFirst.mockResolvedValue(null);

      await expect(service.getTemplate('tpl-1', TENANT)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('communications', () => {
    it('queues the communication for processing', async () => {
      await service.sendCommunication(
        { customerId: 'cust-1', channel: 'EMAIL', recipient: 'a@b.c', body: 'Hi' } as never,
        TENANT,
        USER,
      );

      expect(prisma.communicationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'PENDING' }),
      });
      expect(emitter.emit).toHaveBeenCalledWith('crm.communication.sent', {
        tenantId: TENANT,
        log: { id: 'log-1' },
      });
      expect(queue.addJob).toHaveBeenCalledWith('notification-jobs', 'process-communication', {
        tenantId: TENANT,
        userId: USER,
        payload: { communicationId: 'log-1' },
      });
    });

    it('sends without a customer when none is supplied', async () => {
      await service.sendCommunication(
        { channel: 'SMS', recipient: '+100', body: 'Hi' } as never,
        TENANT,
      );

      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
      expect(prisma.communicationLog.create).toHaveBeenCalled();
    });

    it('rejects a communication to a customer in another tenant', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.sendCommunication({ customerId: 'cust-1', channel: 'EMAIL' } as never, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('paginates the communication log', async () => {
      prisma.communicationLog.count.mockResolvedValue(11);

      const result = await service.getCommunicationLogs(TENANT, 2, 5);

      expect(prisma.communicationLog.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        orderBy: { createdAt: 'desc' },
        skip: 5,
        take: 5,
      });
      expect(result.meta).toEqual({ total: 11, page: 2, limit: 5, totalPages: 3 });
    });

    it('filters the communication log by customer, channel and status', async () => {
      await service.getCommunicationLogs(TENANT, 1, 20, 'cust-1', 'EMAIL', 'SENT');

      const [args] = prisma.communicationLog.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: TENANT,
        customerId: 'cust-1',
        channel: 'EMAIL',
        status: 'SENT',
      });
    });

    it.each([
      ['SENT', 'sentAt'],
      ['DELIVERED', 'deliveredAt'],
      ['OPENED', 'openedAt'],
      ['CLICKED', 'clickedAt'],
    ])('stamps %s with the %s timestamp', async (status, field) => {
      await service.updateCommunicationStatus('log-1', status as never, TENANT);

      const [args] = prisma.communicationLog.update.mock.calls[0];
      expect(args.data[field]).toBeInstanceOf(Date);
    });

    it('leaves timestamps unset for a failed status', async () => {
      await service.updateCommunicationStatus('log-1', 'FAILED' as never, TENANT, {
        reason: 'bounced',
      });

      const [args] = prisma.communicationLog.update.mock.calls[0];
      expect(args.data).toEqual({ status: 'FAILED', metadata: { reason: 'bounced' } });
    });

    it('rejects updating a communication from another tenant', async () => {
      prisma.communicationLog.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCommunicationStatus('log-1', 'SENT' as never, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('event rules', () => {
    const ruleDto = {
      name: 'Birthday',
      event: 'customer.birthday',
      condition: { type: 'VIP' },
      action: { type: 'add_timeline_entry' },
    } as never;

    it('creates an active rule', async () => {
      await service.createEventRule(ruleDto, TENANT, USER);

      expect(prisma.eventRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: TENANT, name: 'Birthday', isActive: true }),
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EVENT_RULE_CREATE' }),
      );
    });

    it('rejects a duplicate rule name', async () => {
      prisma.eventRule.findUnique.mockResolvedValue({ id: 'rule-0' });

      await expect(service.createEventRule(ruleDto, TENANT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('updates a rule', async () => {
      await service.updateEventRule('rule-1', { name: 'Renamed' } as never, TENANT, USER);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EVENT_RULE_UPDATE' }),
      );
    });

    it('rejects updating a rule from another tenant', async () => {
      prisma.eventRule.findFirst.mockResolvedValue(null);

      await expect(
        service.updateEventRule('rule-1', { name: 'x' } as never, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft deletes a rule', async () => {
      await service.deleteEventRule('rule-1', TENANT, USER);

      expect(prisma.eventRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EVENT_RULE_DELETE' }),
      );
    });

    it('rejects deleting a rule that does not exist', async () => {
      prisma.eventRule.findFirst.mockResolvedValue(null);

      await expect(service.deleteEventRule('rule-1', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lists rules and filters by event', async () => {
      await service.listEventRules(TENANT);
      expect(prisma.eventRule.findMany).toHaveBeenLastCalledWith({
        where: { tenantId: TENANT, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });

      await service.listEventRules(TENANT, 'customer.birthday');
      const [args] = prisma.eventRule.findMany.mock.calls[1];
      expect(args.where.event).toBe('customer.birthday');
    });

    it('returns a rule owned by the tenant', async () => {
      await service.getEventRule('rule-1', TENANT);

      expect(prisma.eventRule.findFirst).toHaveBeenCalledWith({
        where: { id: 'rule-1', tenantId: TENANT, deletedAt: null },
      });
    });

    it('rejects reading a rule from another tenant', async () => {
      prisma.eventRule.findFirst.mockResolvedValue(null);

      await expect(service.getEventRule('rule-1', TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('processEvent', () => {
    it('runs a rule without a condition and logs success', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        { id: 'rule-1', name: 'R', condition: null, action: { type: 'unknown_action' } },
      ]);

      await service.processEvent('order.paid', { customerId: 'cust-1' }, TENANT);

      expect(prisma.eventLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ result: 'SUCCESS', ruleId: 'rule-1' }),
      });
    });

    it('skips a rule whose condition does not match', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          name: 'R',
          condition: { status: 'VIP' },
          action: { type: 'add_timeline_entry' },
        },
      ]);

      await service.processEvent('order.paid', { status: 'NORMAL' }, TENANT);

      expect(prisma.crmTimelineEntry.create).not.toHaveBeenCalled();
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });

    it('runs a rule whose condition matches', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          name: 'R',
          condition: { status: 'VIP' },
          action: { type: 'add_timeline_entry', title: 'VIP order' },
        },
      ]);

      await service.processEvent('order.paid', { status: 'VIP', customerId: 'cust-1' }, TENANT);

      expect(prisma.crmTimelineEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ title: 'VIP order', customerId: 'cust-1' }),
      });
    });

    it('reads the customer id from the configured payload field', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          name: 'R',
          condition: null,
          action: { type: 'add_timeline_entry', customerIdField: 'buyerId' },
        },
      ]);

      await service.processEvent('order.paid', { buyerId: 'cust-9' }, TENANT);

      expect(prisma.crmTimelineEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ customerId: 'cust-9', title: 'Automated event' }),
      });
    });

    it('skips the timeline action when no customer id can be resolved', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        { id: 'rule-1', name: 'R', condition: null, action: { type: 'add_timeline_entry' } },
      ]);

      await service.processEvent('order.paid', {}, TENANT);

      expect(prisma.crmTimelineEntry.create).not.toHaveBeenCalled();
    });

    it('queues a notification action', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          name: 'R',
          condition: null,
          action: { type: 'send_notification', title: 'Heads up', message: 'Your order is ready' },
        },
      ]);

      await service.processEvent('order.ready', { customerId: 'cust-1' }, TENANT);

      expect(queue.addJob).toHaveBeenCalledWith('notification-jobs', 'event-notification', {
        tenantId: TENANT,
        payload: { customerId: 'cust-1', title: 'Heads up', message: 'Your order is ready' },
      });
    });

    it('uses notification defaults when the action omits them', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          name: 'R',
          condition: null,
          action: { type: 'send_notification', customerIdField: 'buyerId' },
        },
      ]);

      await service.processEvent('order.ready', { buyerId: 'cust-9' }, TENANT);

      expect(queue.addJob).toHaveBeenCalledWith('notification-jobs', 'event-notification', {
        tenantId: TENANT,
        payload: { customerId: 'cust-9', title: 'Notification', message: 'Event triggered' },
      });
    });

    it('skips the notification when no customer id can be resolved', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        { id: 'rule-1', name: 'R', condition: null, action: { type: 'send_notification' } },
      ]);

      await service.processEvent('order.ready', {}, TENANT);

      expect(queue.addJob).not.toHaveBeenCalled();
    });

    it('treats a swallowed timeline write error as a successful rule run', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        { id: 'rule-1', name: 'R', condition: null, action: { type: 'add_timeline_entry' } },
      ]);
      prisma.crmTimelineEntry.create.mockRejectedValueOnce(new Error('write failed'));

      await service.processEvent('order.paid', { customerId: 'cust-1' }, TENANT);

      expect(prisma.eventLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ result: 'SUCCESS', ruleId: 'rule-1' }),
      });
    });

    it('logs a failure and continues with the next rule', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          name: 'Bad',
          condition: null,
          action: { type: 'send_notification' },
        },
        { id: 'rule-2', name: 'Good', condition: null, action: { type: 'unknown_action' } },
      ]);
      queue.addJob.mockRejectedValueOnce(new Error('queue failed'));

      await service.processEvent('order.paid', { customerId: 'cust-1' }, TENANT);

      expect(prisma.eventLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          result: 'FAILED',
          ruleId: 'rule-1',
          error: 'queue failed',
        }),
      });
      expect(prisma.eventLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ result: 'SUCCESS', ruleId: 'rule-2' }),
      });
    });

    it('records an unknown error message when the failure is not an Error', async () => {
      prisma.eventRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          name: 'Bad',
          condition: null,
          action: { type: 'send_notification' },
        },
      ]);
      queue.addJob.mockRejectedValueOnce('nope');

      await service.processEvent('order.paid', { customerId: 'cust-1' }, TENANT);

      expect(prisma.eventLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ result: 'FAILED', error: 'Unknown error' }),
      });
    });

    it('does nothing when the tenant has no active rules for the event', async () => {
      await service.processEvent('order.paid', {}, TENANT);

      expect(prisma.eventRule.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, event: 'order.paid', isActive: true, deletedAt: null },
      });
      expect(prisma.eventLog.create).not.toHaveBeenCalled();
    });
  });

  describe('event logs and analytics', () => {
    it('paginates the event log and filters by event', async () => {
      prisma.eventLog.count.mockResolvedValue(7);

      const result = await service.getEventLogs(TENANT, 1, 5, 'order.paid');

      const [args] = prisma.eventLog.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: TENANT, event: 'order.paid' });
      expect(result.meta).toEqual({ total: 7, page: 1, limit: 5, totalPages: 2 });
    });

    it('reads the crm analytics from cache', async () => {
      cacheService.get.mockResolvedValue({ timelineEntries: 1 });

      await expect(service.getCrmAnalytics(TENANT)).resolves.toEqual({ timelineEntries: 1 });
      expect(prisma.crmTimelineEntry.count).not.toHaveBeenCalled();
    });

    it('counts the crm entities and caches the result', async () => {
      prisma.crmTimelineEntry.count.mockResolvedValue(10);
      prisma.communicationLog.count.mockResolvedValue(5);
      prisma.eventRule.count.mockResolvedValue(2);
      prisma.eventLog.count.mockResolvedValue(20);

      const result = await service.getCrmAnalytics(TENANT);

      expect(result).toEqual({
        timelineEntries: 10,
        communicationsSent: 5,
        activeRules: 2,
        eventsProcessed: 20,
      });
      expect(cacheService.set).toHaveBeenCalledWith(TENANT, 'crm:analytics', result, 300);
    });
  });
});
