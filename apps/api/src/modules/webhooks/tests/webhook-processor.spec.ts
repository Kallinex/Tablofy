import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhookProcessor } from '../webhook-processor';
import { QueueService } from '../../queues/queue.service';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLoggerService } from '../../../common/logger/logger.service';
import { SsrfClientService } from '../../../common/ssrf/ssrf-client.service';
import { SsrfBlockedError } from '../../../common/ssrf/ssrf-guard';

const queueServiceMock = {
  registerWorker: jest.fn(),
  addJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
};

const deliveryServiceMock = {
  signPayload: jest.fn().mockReturnValue('sig'),
  decryptSecret: jest.fn().mockReturnValue('secret'),
  markDelivered: jest.fn().mockResolvedValue(undefined),
  markFailed: jest.fn().mockResolvedValue(undefined),
  generateSecret: jest.fn(),
  encryptSecret: jest.fn(),
  calculateBackoff: jest.fn().mockReturnValue(1000),
};

const configServiceMock = {
  get: jest.fn((key: string, defaultValue?: unknown) => {
    if (key === 'webhook.maxRetries') return 5;
    return defaultValue;
  }),
};

const loggerMock = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
};

const ssrfClientMock = {
  postJson: jest.fn(),
  assertUrlSafe: jest.fn(),
};

const prismaMock = {
  webhookRegistration: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  webhookDelivery: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const registration = {
  id: 'wh-1',
  tenantId: 'tenant-1',
  name: 'Order created',
  url: 'https://example.com/hook',
  isActive: true,
  timeoutMs: 30000,
  headers: {},
  encryptedSecret: null,
  secretHash: 'hash',
};

const delivery = {
  id: 'del-1',
  webhookId: 'wh-1',
  tenantId: 'tenant-1',
  status: 'PENDING',
  attemptCount: 0,
  maxRetries: 5,
  payload: { event: 'order.created', orderId: 'o-1' },
};

describe('WebhookProcessor', () => {
  let processor: WebhookProcessor;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookProcessor,
        { provide: QueueService, useValue: queueServiceMock },
        { provide: WebhookDeliveryService, useValue: deliveryServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: AppLoggerService, useValue: loggerMock },
        { provide: SsrfClientService, useValue: ssrfClientMock },
      ],
    }).compile();

    processor = module.get(WebhookProcessor);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.webhookRegistration.findUnique.mockResolvedValue(registration);
    prismaMock.webhookDelivery.findUnique.mockResolvedValue(delivery);
    prismaMock.webhookRegistration.update.mockResolvedValue(registration);
    prismaMock.webhookDelivery.update.mockResolvedValue(delivery);
  });

  const job = {
    data: {
      tenantId: 'tenant-1',
      payload: {
        webhookId: 'wh-1',
        deliveryId: 'del-1',
        eventType: 'order.created',
        eventId: 'evt-1',
      },
    },
  };

  it('registers delivery workers on init', () => {
    processor.onModuleInit();
    expect(queueServiceMock.registerWorker).toHaveBeenCalledWith(
      'webhook-delivery',
      expect.any(Function),
      10,
    );
    expect(queueServiceMock.registerWorker).toHaveBeenCalledWith(
      'webhook-retry',
      expect.any(Function),
      5,
    );
  });

  it('marks a delivery as delivered on 2xx response', async () => {
    ssrfClientMock.postJson.mockResolvedValue({ status: 200, data: { ok: true } });

    const result = await processor.processDelivery(job);

    expect(ssrfClientMock.postJson).toHaveBeenCalledWith(
      registration.url,
      delivery.payload,
      expect.objectContaining({
        headers: expect.any(Object),
        timeoutMs: 30000,
        validateStatus: expect.any(Function),
      }),
    );
    expect(deliveryServiceMock.markDelivered).toHaveBeenCalledWith(
      'del-1',
      200,
      JSON.stringify({ ok: true }),
      expect.any(Number),
    );
    expect(prismaMock.webhookRegistration.update).toHaveBeenCalledWith({
      where: { id: 'wh-1' },
      data: { lastDeliveredAt: expect.any(Date) },
    });
    expect(result).toEqual({ delivered: true, statusCode: 200 });
  });

  it('accepts every status in validateStatus so non-2xx responses can be inspected and retried', async () => {
    let capturedValidateStatus: ((status: number) => boolean) | undefined;
    ssrfClientMock.postJson.mockImplementation(
      (_url: string, _body: unknown, options: { validateStatus: (status: number) => boolean }) => {
        capturedValidateStatus = options.validateStatus;
        return Promise.resolve({ status: 200, data: {} });
      },
    );

    await processor.processDelivery(job);

    expect(capturedValidateStatus).toBeDefined();
    expect(capturedValidateStatus!(204)).toBe(true);
    expect(capturedValidateStatus!(500)).toBe(true);
  });

  it('schedules a retry on non-2xx response when attempts remain', async () => {
    ssrfClientMock.postJson.mockResolvedValue({ status: 500, data: { error: 'boom' } });

    const result = await processor.processDelivery(job);

    expect(deliveryServiceMock.markFailed).toHaveBeenCalledWith(
      'del-1',
      expect.stringContaining('HTTP 500'),
      500,
      expect.any(Number),
    );
    expect(queueServiceMock.addJob).toHaveBeenCalledWith(
      'webhook-retry',
      'retry-webhook',
      {
        tenantId: 'tenant-1',
        payload: {
          webhookId: 'wh-1',
          deliveryId: 'del-1',
          eventType: 'order.created',
          eventId: 'evt-1',
        },
      },
      { delay: 1000 },
    );
    expect(result).toEqual({ delivered: false, statusCode: 500 });
  });

  it('fails fast without retry when the SSRF guard blocks the URL', async () => {
    ssrfClientMock.postJson.mockRejectedValue(new SsrfBlockedError('Blocked address (127.0.0.1)'));

    const result = await processor.processDelivery(job);

    expect(deliveryServiceMock.markFailed).toHaveBeenCalledWith(
      'del-1',
      expect.stringContaining('Blocked by SSRF guard'),
      null,
      expect.any(Number),
    );
    expect(queueServiceMock.addJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      delivered: false,
      ssrfBlocked: true,
      error: expect.stringContaining('Blocked address'),
    });
  });

  it('schedules a retry on transient errors when attempts remain', async () => {
    ssrfClientMock.postJson.mockRejectedValue(new Error('ECONNRESET'));

    const result = await processor.processDelivery(job);

    expect(deliveryServiceMock.markFailed).toHaveBeenCalledWith(
      'del-1',
      'ECONNRESET',
      null,
      expect.any(Number),
    );
    expect(queueServiceMock.addJob).toHaveBeenCalledWith(
      'webhook-retry',
      'retry-webhook',
      {
        tenantId: 'tenant-1',
        payload: {
          webhookId: 'wh-1',
          deliveryId: 'del-1',
          eventType: 'order.created',
          eventId: 'evt-1',
        },
      },
      { delay: 1000 },
    );
    expect(result).toEqual({ delivered: false, error: 'ECONNRESET' });
  });

  it('returns early when the registration is missing or inactive', async () => {
    prismaMock.webhookRegistration.findUnique.mockResolvedValue(null);
    expect(await processor.processDelivery(job)).toEqual({ delivered: false, reason: 'inactive' });

    prismaMock.webhookRegistration.findUnique.mockResolvedValue({
      ...registration,
      isActive: false,
    });
    expect(await processor.processDelivery(job)).toEqual({ delivered: false, reason: 'inactive' });
    expect(ssrfClientMock.postJson).not.toHaveBeenCalled();
  });

  it('returns early when the delivery is missing', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValue(null);
    expect(await processor.processDelivery(job)).toEqual({ delivered: false, reason: 'not_found' });
    expect(ssrfClientMock.postJson).not.toHaveBeenCalled();
  });

  it('strips hop-by-hop, spoofed, and platform headers from tenant-supplied headers', async () => {
    ssrfClientMock.postJson.mockResolvedValue({ status: 200, data: {} });
    prismaMock.webhookRegistration.findUnique.mockResolvedValue({
      ...registration,
      headers: {
        'X-Custom-Header': 'keep-me',
        Host: 'evil.example.com',
        'X-Forwarded-For': '6.6.6.6',
        'X-Real-IP': '6.6.6.6',
        'Content-Type': 'text/html',
        'X-Webhook-Signature': 'forged',
        'X-Webhook-Tenant-Id': 'other-tenant',
        'X-Client-IP': '6.6.6.6',
      },
    });

    await processor.processDelivery(job);

    const headers = (
      ssrfClientMock.postJson.mock.calls[0][2] as { headers?: Record<string, string> }
    ).headers;

    expect(headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Webhook-Event': 'order.created',
      'X-Webhook-Delivery-Id': 'del-1',
      'X-Webhook-Tenant-Id': 'tenant-1',
      'User-Agent': 'Tablofy-Webhook/1.0',
      'X-Custom-Header': 'keep-me',
    });
    expect(headers).not.toHaveProperty('Host');
    expect(headers).not.toHaveProperty('X-Forwarded-For');
    expect(headers).not.toHaveProperty('X-Real-IP');
    expect(headers).not.toHaveProperty('X-Client-IP');
  });

  it('signs the exact serialized payload', async () => {
    ssrfClientMock.postJson.mockResolvedValue({ status: 200, data: {} });
    await processor.processDelivery(job);
    expect(deliveryServiceMock.signPayload).toHaveBeenCalledWith(
      JSON.stringify(delivery.payload),
      'hash',
    );
  });

  it('decrypts the configured secret when present', async () => {
    ssrfClientMock.postJson.mockResolvedValue({ status: 200, data: {} });
    prismaMock.webhookRegistration.findUnique.mockResolvedValue({
      ...registration,
      encryptedSecret: 'iv:tag:enc',
    });
    await processor.processDelivery(job);
    expect(deliveryServiceMock.decryptSecret).toHaveBeenCalledWith('iv:tag:enc');
  });

  it('marks delivery as failed without retry when attempts exhausted', async () => {
    ssrfClientMock.postJson.mockResolvedValue({ status: 503, data: { error: 'down' } });
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce({ ...delivery, attemptCount: 4 });

    const result = await processor.processDelivery(job);

    expect(deliveryServiceMock.markFailed).toHaveBeenCalled();
    expect(queueServiceMock.addJob).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: false, statusCode: 503 });
  });

  it('marks delivery failed when SSRF blocks the request', async () => {
    ssrfClientMock.postJson.mockRejectedValue(new SsrfBlockedError('blocked private address'));

    const result = await processor.processDelivery(job);

    expect(deliveryServiceMock.markFailed).toHaveBeenCalledWith(
      'del-1',
      expect.stringContaining('Blocked by SSRF guard'),
      null,
      expect.any(Number),
    );
    expect(queueServiceMock.addJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      delivered: false,
      error: expect.stringContaining('blocked private address'),
      ssrfBlocked: true,
    });
  });

  it('marks delivery failed on generic network error and schedules retry when possible', async () => {
    ssrfClientMock.postJson.mockRejectedValue(new Error('ECONNREFUSED'));
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce({ ...delivery, attemptCount: 1 });

    const result = await processor.processDelivery(job);

    expect(deliveryServiceMock.markFailed).toHaveBeenCalledWith(
      'del-1',
      'ECONNREFUSED',
      null,
      expect.any(Number),
    );
    expect(queueServiceMock.addJob).toHaveBeenCalled();
    expect(result).toEqual({ delivered: false, error: 'ECONNREFUSED' });
  });

  it('marks delivery failed on non-Error rejection', async () => {
    ssrfClientMock.postJson.mockRejectedValue('timeout');

    const result = await processor.processDelivery(job);

    expect(deliveryServiceMock.markFailed).toHaveBeenCalledWith(
      'del-1',
      'timeout',
      null,
      expect.any(Number),
    );
    expect(result).toEqual({ delivered: false, error: 'timeout' });
  });

  describe('processRetry', () => {
    it('skips retry if the delivery no longer exists', async () => {
      prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(null);

      const result = await processor.processRetry(job);

      expect(result).toEqual({ skipped: true, reason: 'not_retrying' });
      expect(ssrfClientMock.postJson).not.toHaveBeenCalled();
    });

    it('skips retry if the delivery is not in RETRYING status', async () => {
      prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce({
        ...delivery,
        status: 'FAILED',
      });

      const result = await processor.processRetry(job);

      expect(result).toEqual({ skipped: true, reason: 'not_retrying' });
      expect(ssrfClientMock.postJson).not.toHaveBeenCalled();
    });

    it('delegates to processDelivery when the retry is valid', async () => {
      prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce({
        ...delivery,
        status: 'RETRYING',
      });
      ssrfClientMock.postJson.mockResolvedValue({ status: 200, data: { ok: true } });

      const result = await processor.processRetry(job);

      expect(result).toEqual({ delivered: true, statusCode: 200 });
      expect(ssrfClientMock.postJson).toHaveBeenCalled();
    });
  });
});
