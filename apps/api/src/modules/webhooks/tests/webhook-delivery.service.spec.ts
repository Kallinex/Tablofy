import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhookDeliveryStatus } from '@prisma/client';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLoggerService } from '../../../common/logger/logger.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('WebhookDeliveryService', () => {
  let service: WebhookDeliveryService;
  let prisma: MockPrisma;
  let logger: {
    warn: jest.Mock;
    log: jest.Mock;
    error: jest.Mock;
    setContext: jest.Mock;
  };
  let config: { get: jest.Mock };

  beforeAll(async () => {
    logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), setContext: jest.fn() };
    config = {
      get: jest.fn((key: string, def?: unknown) => {
        const map: Record<string, unknown> = {
          'webhook.initialBackoffMs': 1000,
          'webhook.backoffFactor': 2,
          'webhook.maxBackoffMs': 3600000,
          'webhook.encryptionKey': 'unit-test-key',
        };
        return map[key] ?? def;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDeliveryService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: ConfigService, useValue: config },
        { provide: AppLoggerService, useValue: logger },
      ],
    }).compile();

    service = module.get<WebhookDeliveryService>(WebhookDeliveryService);
    prisma = module.get(PrismaService) as MockPrisma;
  });

  beforeEach(() => {
    prisma.reset();
    logger.warn.mockReset();
  });

  describe('secret handling', () => {
    it('round-trips an encrypted secret', () => {
      const encrypted = service.encryptSecret('super-secret');
      expect(encrypted.split(':')).toHaveLength(3);
      expect(service.decryptSecret(encrypted)).toBe('super-secret');
    });

    it('generates a secret with hash and prefix', () => {
      const { secret, hash, prefix } = service.generateSecret();
      expect(secret).toHaveLength(64);
      expect(hash).toHaveLength(64);
      expect(prefix).toBe(secret.substring(0, 8));
    });

    it('verifies valid signatures and rejects invalid ones', () => {
      const payload = '{"a":1}';
      const secret = 'shhh';
      const signature = service.signPayload(payload, secret);
      expect(service.verifySignature(payload, signature, secret)).toBe(true);
      expect(service.verifySignature(payload, 'deadbeef', secret)).toBe(false);
    });

    it('warns when no encryption key is configured', () => {
      const noKeyConfig = {
        get: jest.fn((_key: string, def?: unknown) => def),
      };
      new WebhookDeliveryService(
        prisma as unknown as PrismaService,
        noKeyConfig as unknown as ConfigService,
        logger as unknown as AppLoggerService,
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('WEBHOOK_ENCRYPTION_KEY'));
    });
  });

  describe('calculateBackoff', () => {
    it('grows exponentially', () => {
      expect(service.calculateBackoff(1)).toBe(1000);
      expect(service.calculateBackoff(2)).toBe(2000);
      expect(service.calculateBackoff(3)).toBe(4000);
    });

    it('caps at the maximum backoff', () => {
      expect(service.calculateBackoff(40)).toBe(3600000);
    });
  });

  describe('createDelivery', () => {
    it('persists a delivery and returns its id', async () => {
      prisma.webhookDelivery.create.mockResolvedValue({ id: 'd-1' });

      const id = await service.createDelivery(
        'wh-1',
        testTenantId,
        'order.created',
        'ev-1',
        { a: 1 },
        5,
      );

      expect(id).toBe('d-1');
      expect(prisma.webhookDelivery.create.mock.calls[0][0].data).toMatchObject({
        webhookId: 'wh-1',
        tenantId: testTenantId,
        eventType: 'order.created',
        eventId: 'ev-1',
        maxRetries: 5,
      });
    });
  });

  describe('markDelivered', () => {
    it('marks delivered and increments attempts', async () => {
      await service.markDelivered('d-1', 200, 'ok', 42);

      expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({
        status: WebhookDeliveryStatus.DELIVERED,
        statusCode: 200,
        attemptCount: { increment: 1 },
      });
    });
  });

  describe('markFailed', () => {
    it('is a no-op when the delivery is missing', async () => {
      prisma.webhookDelivery.findUnique.mockResolvedValue(null);
      await service.markFailed('d-1', 'boom', 500, 10);
      expect(prisma.webhookDelivery.update).not.toHaveBeenCalled();
    });

    it('schedules a retry before exhausting attempts', async () => {
      prisma.webhookDelivery.findUnique.mockResolvedValue({
        id: 'd-1',
        attemptCount: 0,
        maxRetries: 5,
      });

      await service.markFailed('d-1', 'boom', 500, 10);

      const data = prisma.webhookDelivery.update.mock.calls[0][0].data;
      expect(data.status).toBe('RETRYING');
      expect(data.attemptCount).toBe(1);
      expect(data.nextRetryAt).toBeInstanceOf(Date);
    });

    it('moves to the dead-letter queue once attempts are exhausted', async () => {
      prisma.webhookDelivery.findUnique.mockResolvedValue({
        id: 'd-1',
        attemptCount: 4,
        maxRetries: 5,
      });

      await service.markFailed('d-1', 'boom', 500, 10);

      expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({
        status: WebhookDeliveryStatus.DEAD_LETTER,
        attemptCount: 5,
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dead-letter'));
    });
  });

  describe('getPendingRetries', () => {
    it('queries due retries', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([]);
      await service.getPendingRetries(10);
      expect(prisma.webhookDelivery.findMany.mock.calls[0][0]).toMatchObject({
        where: { status: 'RETRYING' },
        take: 10,
      });
    });
  });

  describe('getDeliveriesByWebhook', () => {
    it('paginates deliveries', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([{ id: 'd-1' }]);
      prisma.webhookDelivery.count.mockResolvedValue(1);

      const result = await service.getDeliveriesByWebhook('wh-1', 1, 20);

      expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
      expect(prisma.webhookDelivery.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 20 });
    });
  });

  describe('cleanupOldDeliveries', () => {
    it('deletes old terminal deliveries and returns the count', async () => {
      prisma.webhookDelivery.deleteMany.mockResolvedValue({ count: 3 });

      const count = await service.cleanupOldDeliveries(7);

      expect(count).toBe(3);
      const where = prisma.webhookDelivery.deleteMany.mock.calls[0][0].where;
      expect(where.status.in).toEqual([
        WebhookDeliveryStatus.DELIVERED,
        WebhookDeliveryStatus.DEAD_LETTER,
      ]);
    });
  });
});
