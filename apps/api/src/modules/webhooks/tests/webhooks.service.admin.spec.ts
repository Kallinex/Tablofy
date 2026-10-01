import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { WebhooksService } from '../webhooks.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AppLoggerService } from '../../../common/logger/logger.service';
import { SsrfClientService } from '../../../common/ssrf/ssrf-client.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';

describe('WebhooksService listing, removal and secret rotation', () => {
  let service: WebhooksService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;

  const deliveryService = {
    generateSecret: jest.fn(),
    encryptSecret: jest.fn(),
    getDeliveriesByWebhook: jest.fn(),
  };

  const registration = {
    id: 'wh-1',
    tenantId: 'tenant-1',
    name: 'Order hook',
    url: 'https://example.com/hook',
    events: ['order.created'],
    isActive: true,
    secretPrefix: 'whsec_ab',
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: WebhookDeliveryService, useValue: deliveryService },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) =>
              key === 'webhook.maxRegistrationsPerTenant' ? 50 : defaultValue,
            ),
          },
        },
        {
          provide: AppLoggerService,
          useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: SsrfClientService, useValue: { assertUrlSafe: jest.fn() } },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;

    prisma.reset();
    auditLogs.reset();
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('paginates newest first scoped to the tenant', async () => {
      prisma.webhookRegistration.findMany.mockResolvedValue([registration]);
      prisma.webhookRegistration.count.mockResolvedValue(1);

      const result = await service.findAll({}, 'tenant-1');

      const [args] = prisma.webhookRegistration.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: 'tenant-1', deletedAt: null });
      expect(args.skip).toBe(0);
      expect(args.take).toBe(20);
      expect(result.meta).toEqual(
        expect.objectContaining({ total: 1, page: 1, limit: 20, totalPages: 1 }),
      );
    });

    it('filters by event and active flag', async () => {
      prisma.webhookRegistration.count.mockResolvedValue(0);

      await service.findAll({ event: 'order.created', isActive: false }, 'tenant-1');

      const [args] = prisma.webhookRegistration.findMany.mock.calls[0];
      expect(args.where.events).toEqual({ has: 'order.created' });
      expect(args.where.isActive).toBe(false);
    });

    it('computes the offset from the requested page', async () => {
      await service.findAll({ page: 3, limit: 5 }, 'tenant-1');

      const [args] = prisma.webhookRegistration.findMany.mock.calls[0];
      expect(args.skip).toBe(10);
      expect(args.take).toBe(5);
    });
  });

  describe('findOne', () => {
    it('returns the registration scoped to the tenant', async () => {
      prisma.webhookRegistration.findFirst.mockResolvedValue(registration);

      await expect(service.findOne('wh-1', 'tenant-1')).resolves.toEqual(
        expect.objectContaining({ id: 'wh-1' }),
      );
      expect(prisma.webhookRegistration.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'wh-1' }) }),
      );
    });

    it('rejects reading a registration from another tenant', async () => {
      prisma.webhookRegistration.findFirst.mockResolvedValue(null);

      await expect(service.findOne('wh-1', 'tenant-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft deletes and deactivates the registration', async () => {
      prisma.webhookRegistration.findFirst.mockResolvedValue(registration);
      prisma.webhookRegistration.update.mockResolvedValue({ id: 'wh-1' });

      await service.remove('wh-1', 'tenant-1', 'user-1');

      expect(prisma.webhookRegistration.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { deletedAt: expect.any(Date), isActive: false },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WEBHOOK_DELETED', userId: 'user-1' }),
      );
    });

    it('refuses to remove a registration from another tenant', async () => {
      prisma.webhookRegistration.findFirst.mockResolvedValue(null);

      await expect(service.remove('wh-1', 'tenant-1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.webhookRegistration.update).not.toHaveBeenCalled();
    });
  });

  describe('rotateSecret', () => {
    it('stores the new hash, prefix and encrypted secret and returns the plaintext once', async () => {
      prisma.webhookRegistration.findFirst.mockResolvedValue(registration);
      deliveryService.generateSecret.mockReturnValue({
        secret: 'whsec_new',
        hash: 'hash-new',
        prefix: 'whsec_ne',
      });
      deliveryService.encryptSecret.mockReturnValue('encrypted-new');

      const result = await service.rotateSecret('wh-1', 'tenant-1', 'user-1');

      expect(result).toEqual({ secret: 'whsec_new', prefix: 'whsec_ne' });
      expect(prisma.webhookRegistration.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: {
          secretHash: 'hash-new',
          secretPrefix: 'whsec_ne',
          encryptedSecret: 'encrypted-new',
        },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WEBHOOK_SECRET_ROTATED' }),
      );
    });

    it('refuses to rotate a registration from another tenant', async () => {
      prisma.webhookRegistration.findFirst.mockResolvedValue(null);

      await expect(service.rotateSecret('wh-1', 'tenant-1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(deliveryService.generateSecret).not.toHaveBeenCalled();
    });
  });

  describe('getDeliveries', () => {
    it('delegates to the delivery service with the requested page', async () => {
      prisma.webhookRegistration.findFirst.mockResolvedValue(registration);
      deliveryService.getDeliveriesByWebhook.mockResolvedValue({ data: [], meta: { total: 0 } });

      const result = await service.getDeliveries('wh-1', 'tenant-1', 2, 10);

      expect(deliveryService.getDeliveriesByWebhook).toHaveBeenCalledWith('wh-1', 2, 10);
      expect(result).toEqual({ data: [], meta: { total: 0 } });
    });

    it('defaults to the first page of twenty', async () => {
      prisma.webhookRegistration.findFirst.mockResolvedValue(registration);
      deliveryService.getDeliveriesByWebhook.mockResolvedValue({ data: [] });

      await service.getDeliveries('wh-1', 'tenant-1');

      expect(deliveryService.getDeliveriesByWebhook).toHaveBeenCalledWith('wh-1', 1, 20);
    });

    it('refuses to list deliveries for a registration from another tenant', async () => {
      prisma.webhookRegistration.findFirst.mockResolvedValue(null);

      await expect(service.getDeliveries('wh-1', 'tenant-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(deliveryService.getDeliveriesByWebhook).not.toHaveBeenCalled();
    });
  });
});
