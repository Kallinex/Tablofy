import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebhookEventEmitter } from '../webhook-event-emitter';

const queueServiceMock = {
  addJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
  getQueue: jest.fn(),
  registerWorker: jest.fn(),
};

const webhooksServiceMock = {
  getActiveWebhooksForEvent: jest.fn().mockResolvedValue([]),
};

const deliveryServiceMock = {
  createDelivery: jest.fn().mockResolvedValue('delivery-1'),
  generateSecret: jest.fn(),
  encryptSecret: jest.fn(),
};

const loggerMock = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe('WebhookEventEmitter', () => {
  let emitter: WebhookEventEmitter;
  let eventEmitter: EventEmitter2;

  beforeEach(() => {
    jest.clearAllMocks();
    webhooksServiceMock.getActiveWebhooksForEvent.mockResolvedValue([]);
    eventEmitter = new EventEmitter2({ wildcard: true, delimiter: '.', maxListeners: 20 });
    emitter = new WebhookEventEmitter(
      eventEmitter as never,
      queueServiceMock as never,
      webhooksServiceMock as never,
      deliveryServiceMock as never,
      loggerMock as never,
    );
  });

  it('dispatches when an order.created event is emitted through the emitter', async () => {
    webhooksServiceMock.getActiveWebhooksForEvent.mockResolvedValue([
      { id: 'wh-1', retryCount: 3 },
    ]);

    eventEmitter.emit('order.created', { tenantId: 't1', orderId: 'o1' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(webhooksServiceMock.getActiveWebhooksForEvent).toHaveBeenCalledWith(
      'order.created',
      't1',
    );
    expect(queueServiceMock.addJob).toHaveBeenCalledWith(
      'webhook-delivery',
      'deliver-order.created',
      expect.objectContaining({
        tenantId: 't1',
        payload: expect.objectContaining({ eventType: 'order.created' }),
      }),
    );
  });

  it('dispatches an order.created event to matching registrations', async () => {
    const registration = {
      id: 'wh-1',
      retryCount: 3,
    };
    webhooksServiceMock.getActiveWebhooksForEvent.mockResolvedValue([registration]);

    await emitter.handleEvent('order.created', { tenantId: 't1', orderId: 'o1' });

    expect(webhooksServiceMock.getActiveWebhooksForEvent).toHaveBeenCalledWith(
      'order.created',
      't1',
    );
    expect(deliveryServiceMock.createDelivery).toHaveBeenCalledWith(
      'wh-1',
      't1',
      'order.created',
      expect.any(String),
      expect.objectContaining({ orderId: 'o1' }),
      3,
    );
    expect(queueServiceMock.addJob).toHaveBeenCalledWith(
      'webhook-delivery',
      'deliver-order.created',
      expect.objectContaining({
        tenantId: 't1',
        payload: expect.objectContaining({
          webhookId: 'wh-1',
          deliveryId: 'delivery-1',
          eventType: 'order.created',
        }),
      }),
    );
  });

  it('normalizes legacy plural event names before dispatch', async () => {
    webhooksServiceMock.getActiveWebhooksForEvent.mockResolvedValue([
      { id: 'wh-1', retryCount: 3 },
    ]);

    await emitter.handleEvent('orders.completed', { tenantId: 't1', orderId: 'o1' });

    expect(webhooksServiceMock.getActiveWebhooksForEvent).toHaveBeenCalledWith(
      'order.completed',
      't1',
    );
    expect(queueServiceMock.addJob).toHaveBeenCalledWith(
      'webhook-delivery',
      'deliver-order.completed',
      expect.anything(),
    );
  });

  it('ignores unknown event names', async () => {
    await emitter.handleEvent('customers.created', { tenantId: 't1' });
    expect(webhooksServiceMock.getActiveWebhooksForEvent).not.toHaveBeenCalled();
    expect(queueServiceMock.addJob).not.toHaveBeenCalled();
  });

  it('ignores events without a tenantId', async () => {
    await emitter.handleEvent('order.created', { orderId: 'o1' });
    expect(webhooksServiceMock.getActiveWebhooksForEvent).not.toHaveBeenCalled();
    expect(queueServiceMock.addJob).not.toHaveBeenCalled();
  });

  it('does not dispatch when no registrations match', async () => {
    await emitter.handleEvent('order.created', { tenantId: 't1' });
    expect(deliveryServiceMock.createDelivery).not.toHaveBeenCalled();
    expect(queueServiceMock.addJob).not.toHaveBeenCalled();
  });

  it('dispatches one delivery per matching registration', async () => {
    webhooksServiceMock.getActiveWebhooksForEvent.mockResolvedValue([
      { id: 'wh-1', retryCount: 3 },
      { id: 'wh-2', retryCount: 5 },
    ]);

    await emitter.handleEvent('payments.completed', { tenantId: 't1' });

    expect(deliveryServiceMock.createDelivery).toHaveBeenCalledTimes(2);
    expect(queueServiceMock.addJob).toHaveBeenCalledTimes(2);
  });

  it('uses the emitted event name and ignores any payload.eventType field', async () => {
    webhooksServiceMock.getActiveWebhooksForEvent.mockResolvedValue([
      { id: 'wh-1', retryCount: 3 },
    ]);

    await emitter.handleEvent('order.updated', {
      tenantId: 't1',
      eventType: 'order.cancelled',
    });

    expect(webhooksServiceMock.getActiveWebhooksForEvent).toHaveBeenCalledWith(
      'order.updated',
      't1',
    );
  });

  it('logs and swallows errors from webhook lookup', async () => {
    webhooksServiceMock.getActiveWebhooksForEvent.mockRejectedValue(new Error('boom'));

    await expect(emitter.handleEvent('order.created', { tenantId: 't1' })).resolves.toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalled();
  });
});
