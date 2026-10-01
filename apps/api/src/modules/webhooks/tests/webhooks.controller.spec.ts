import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { WebhooksController } from '../webhooks.controller';
import { WebhooksService } from '../webhooks.service';
import { createControllerApp, TEST_USER } from '../../../test/helpers/controller-app';

describe('WebhooksController', () => {
  let app: INestApplication;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'webhook-1' }),
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      findOne: jest.fn().mockResolvedValue({ id: 'webhook-1' }),
      update: jest.fn().mockResolvedValue({ id: 'webhook-1' }),
      remove: jest.fn().mockResolvedValue(undefined),
      rotateSecret: jest.fn().mockResolvedValue({ id: 'webhook-1', secret: 'rotated' }),
      getDeliveries: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    };

    app = await createControllerApp(WebhooksController, [
      { provide: WebhooksService, useValue: service },
    ]);
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a webhook registration for the JWT tenant', async () => {
    const response = await request(app.getHttpServer())
      .post('/webhooks')
      .send({ url: 'https://example.test/hook', events: ['order.created'] });

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.test/hook' }),
      TEST_USER.tenantId,
      TEST_USER.id,
    );
  });

  it('lists webhooks for the JWT tenant', async () => {
    const response = await request(app.getHttpServer()).get('/webhooks?page=3');

    expect(response.statusCode).toBe(200);
    expect(service.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ page: '3' }),
      TEST_USER.tenantId,
    );
  });

  it('reads a webhook with the JWT tenant', async () => {
    const response = await request(app.getHttpServer()).get('/webhooks/webhook-1');

    expect(response.statusCode).toBe(200);
    expect(service.findOne).toHaveBeenCalledWith('webhook-1', TEST_USER.tenantId);
  });

  it('updates a webhook', async () => {
    const response = await request(app.getHttpServer())
      .put('/webhooks/webhook-1')
      .send({ isActive: false });

    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      'webhook-1',
      expect.objectContaining({ isActive: false }),
      TEST_USER.tenantId,
      TEST_USER.id,
    );
  });

  it('deletes a webhook with HTTP 204 and no body', async () => {
    const response = await request(app.getHttpServer()).delete('/webhooks/webhook-1');

    expect(response.statusCode).toBe(204);
    expect(response.body).toEqual({});
    expect(service.remove).toHaveBeenCalledWith('webhook-1', TEST_USER.tenantId, TEST_USER.id);
  });

  it('rotates the signing secret', async () => {
    const response = await request(app.getHttpServer()).post('/webhooks/webhook-1/rotate-secret');

    expect(response.statusCode).toBe(201);
    expect(service.rotateSecret).toHaveBeenCalledWith(
      'webhook-1',
      TEST_USER.tenantId,
      TEST_USER.id,
    );
  });

  it('parses delivery pagination defaults', async () => {
    const response = await request(app.getHttpServer()).get('/webhooks/webhook-1/deliveries');

    expect(response.statusCode).toBe(200);
    expect(service.getDeliveries).toHaveBeenCalledWith('webhook-1', TEST_USER.tenantId, 1, 20);
  });

  it('honours explicit delivery pagination', async () => {
    const response = await request(app.getHttpServer()).get(
      '/webhooks/webhook-1/deliveries?page=4&limit=50',
    );

    expect(response.statusCode).toBe(200);
    expect(service.getDeliveries).toHaveBeenCalledWith('webhook-1', TEST_USER.tenantId, 4, 50);
  });
});
