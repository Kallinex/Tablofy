import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { WebhooksService } from '../webhooks.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AppLoggerService } from '../../../common/logger/logger.service';
import { SsrfClientService } from '../../../common/ssrf/ssrf-client.service';
import { SsrfBlockedError } from '../../../common/ssrf/ssrf-guard';
import { CreateWebhookDto } from '../dto/create-webhook.dto';

const deliveryServiceMock = {
  generateSecret: jest.fn().mockReturnValue({ secret: 's', hash: 'h', prefix: 'p' }),
  encryptSecret: jest.fn().mockReturnValue('enc'),
  signPayload: jest.fn(),
  decryptSecret: jest.fn(),
  markDelivered: jest.fn(),
  markFailed: jest.fn(),
  getDeliveriesByWebhook: jest.fn(),
};

const auditLogsServiceMock = {
  log: jest.fn().mockResolvedValue(undefined),
};

const configServiceMock = {
  get: jest.fn((key: string, defaultValue?: unknown) => {
    if (key === 'webhook.maxRegistrationsPerTenant') return 50;
    return defaultValue;
  }),
};

const loggerMock = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const ssrfClientMock = {
  assertUrlSafe: jest.fn().mockResolvedValue(undefined),
  postJson: jest.fn(),
};

const prismaMock = {
  webhookRegistration: {
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({ id: 'wh-1', url: 'https://example.com/hook' }),
    update: jest.fn().mockResolvedValue({ id: 'wh-1' }),
    findMany: jest.fn().mockResolvedValue([]),
  },
  webhookDelivery: {
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
};

describe('WebhooksService', () => {
  let service: WebhooksService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WebhookDeliveryService, useValue: deliveryServiceMock },
        { provide: AuditLogsService, useValue: auditLogsServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: AppLoggerService, useValue: loggerMock },
        { provide: SsrfClientService, useValue: ssrfClientMock },
      ],
    }).compile();

    service = module.get(WebhooksService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ssrfClientMock.assertUrlSafe.mockResolvedValue(undefined);
    prismaMock.webhookRegistration.findFirst.mockResolvedValue(null);
    prismaMock.webhookRegistration.count.mockResolvedValue(0);
    prismaMock.webhookRegistration.create.mockResolvedValue({
      id: 'wh-1',
      url: 'https://example.com/hook',
    });
    prismaMock.webhookRegistration.update.mockResolvedValue({ id: 'wh-1' });
  });

  const dto: CreateWebhookDto = {
    name: 'Order hook',
    url: 'https://example.com/hook',
    events: ['order.created'],
    headers: { 'X-Custom': 'yes' },
    retryCount: 3,
    timeoutMs: 30000,
  };

  describe('create', () => {
    it('rejects a private/blocked URL before persisting anything', async () => {
      ssrfClientMock.assertUrlSafe.mockRejectedValue(
        new SsrfBlockedError('Blocked address (127.0.0.1)'),
      );

      await expect(service.create(dto, 'tenant-1', 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.webhookRegistration.create).not.toHaveBeenCalled();
      expect(deliveryServiceMock.generateSecret).not.toHaveBeenCalled();
    });

    it('rejects a blocked URL passed to update before persisting anything', async () => {
      prismaMock.webhookRegistration.findFirst.mockResolvedValue({ id: 'wh-1' });
      ssrfClientMock.assertUrlSafe.mockRejectedValue(
        new SsrfBlockedError('Blocked address (169.254.169.254)'),
      );

      await expect(
        service.update('wh-1', { url: 'https://169.254.169.254/' }, 'tenant-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.webhookRegistration.update).not.toHaveBeenCalled();
    });

    it('skips SSRF validation when update does not change the URL', async () => {
      prismaMock.webhookRegistration.findFirst.mockResolvedValue({ id: 'wh-1' });

      await service.update('wh-1', { name: 'Renamed' }, 'tenant-1', 'user-1');

      expect(ssrfClientMock.assertUrlSafe).not.toHaveBeenCalled();
      expect(prismaMock.webhookRegistration.update).toHaveBeenCalled();
    });

    it('accepts a legitimate public HTTPS URL', async () => {
      const result = await service.create(dto, 'tenant-1', 'user-1');

      expect(ssrfClientMock.assertUrlSafe).toHaveBeenCalledWith(dto.url);
      expect(prismaMock.webhookRegistration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ url: dto.url, tenantId: 'tenant-1' }),
      });
      expect(auditLogsServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WEBHOOK_CREATED' }),
      );
      expect(result).toMatchObject({ secret: 's' });
    });

    it('rethrows non-SSRF errors unchanged', async () => {
      ssrfClientMock.assertUrlSafe.mockRejectedValue(new Error('DNS outage'));

      await expect(service.create(dto, 'tenant-1', 'user-1')).rejects.toThrow('DNS outage');
      expect(prismaMock.webhookRegistration.create).not.toHaveBeenCalled();
    });
  });

  describe('event validation and bounds (F3)', () => {
    it('rejects empty events array before persisting', async () => {
      await expect(
        service.create({ ...dto, events: [] }, 'tenant-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.webhookRegistration.create).not.toHaveBeenCalled();
    });

    it('rejects unknown event names before persisting', async () => {
      await expect(
        service.create({ ...dto, events: ['customers.created'] }, 'tenant-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.webhookRegistration.create).not.toHaveBeenCalled();
    });

    it('stores canonical event names (normalizes legacy plural aliases)', async () => {
      await service.create(
        { ...dto, events: ['orders.completed', 'payments.completed'] },
        'tenant-1',
        'user-1',
      );

      expect(prismaMock.webhookRegistration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          events: ['order.completed', 'payments.completed'],
        }),
      });
    });

    it('rejects more than 50 events', async () => {
      const events = Array.from({ length: 51 }, (_, i) => `product.created-${i}`);
      await expect(service.create({ ...dto, events }, 'tenant-1', 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.webhookRegistration.create).not.toHaveBeenCalled();
    });

    it('rejects excessive header count', async () => {
      const headers: Record<string, string> = {};
      for (let i = 0; i < 21; i += 1) headers[`h-${i}`] = 'v';
      await expect(
        service.create({ ...dto, headers }, 'tenant-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects oversized header values', async () => {
      await expect(
        service.create({ ...dto, headers: { 'X-Long': 'v'.repeat(300) } }, 'tenant-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unknown events on update', async () => {
      prismaMock.webhookRegistration.findFirst.mockResolvedValue({ id: 'wh-1' });
      await expect(
        service.update('wh-1', { events: ['nonsense.event'] }, 'tenant-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.webhookRegistration.update).not.toHaveBeenCalled();
    });

    it('normalizes events to canonical on update', async () => {
      prismaMock.webhookRegistration.findFirst.mockResolvedValue({ id: 'wh-1' });

      await service.update('wh-1', { events: ['orders.completed'] }, 'tenant-1', 'user-1');

      expect(prismaMock.webhookRegistration.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: expect.objectContaining({ events: ['order.completed'] }),
      });
    });
  });

  describe('getActiveWebhooksForEvent (D1)', () => {
    it('matches canonical and legacy alias events via hasSome', async () => {
      prismaMock.webhookRegistration.findMany.mockResolvedValue([{ id: 'wh-1' }]);

      const result = await service.getActiveWebhooksForEvent('order.completed', 'tenant-1');

      expect(prismaMock.webhookRegistration.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          isActive: true,
          deletedAt: null,
          events: { hasSome: ['order.completed', 'orders.completed'] },
        },
      });
      expect(result).toEqual([{ id: 'wh-1' }]);
    });

    it('returns [] for unknown events without querying the DB', async () => {
      const result = await service.getActiveWebhooksForEvent('customers.created', 'tenant-1');
      expect(result).toEqual([]);
      expect(prismaMock.webhookRegistration.findMany).not.toHaveBeenCalled();
    });
  });
});
