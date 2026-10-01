import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ProductAvailabilityController } from '../product-availability.controller';
import { ProductAvailabilityService } from '../product-availability.service';
import { createControllerApp, TEST_USER } from '../../../test/helpers/controller-app';

describe('ProductAvailabilityController', () => {
  let app: INestApplication;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'avail-1' }),
      findAll: jest.fn().mockResolvedValue([{ id: 'avail-1' }]),
      findOne: jest.fn().mockResolvedValue({ id: 'avail-1' }),
      update: jest.fn().mockResolvedValue({ id: 'avail-1' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    app = await createControllerApp(ProductAvailabilityController, [
      { provide: ProductAvailabilityService, useValue: service },
    ]);
  });

  afterEach(async () => {
    await app.close();
  });

  const base = '/restaurants/restaurant-1/products/product-1/availability';

  it('creates a schedule for the product in the JWT tenant', async () => {
    const response = await request(app.getHttpServer())
      .post(base)
      .send({ dayOfWeek: 1, startTime: '09:00' })
      .set('user-agent', 'jest');

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ dayOfWeek: 1 }),
      'product-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.objectContaining({ userAgent: 'jest' }),
    );
  });

  it('lists schedules for the product', async () => {
    const response = await request(app.getHttpServer()).get(base);

    expect(response.statusCode).toBe(200);
    expect(service.findAll).toHaveBeenCalledWith('product-1', TEST_USER.tenantId);
  });

  it('reads one schedule with the JWT tenant', async () => {
    const response = await request(app.getHttpServer()).get(`${base}/avail-1`);

    expect(response.statusCode).toBe(200);
    expect(service.findOne).toHaveBeenCalledWith('avail-1', TEST_USER.tenantId);
  });

  it('updates a schedule', async () => {
    const response = await request(app.getHttpServer())
      .put(`${base}/avail-1`)
      .send({ isActive: false });

    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      'avail-1',
      expect.objectContaining({ isActive: false }),
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });

  it('removes a schedule with HTTP 200 and a message', async () => {
    const response = await request(app.getHttpServer()).delete(`${base}/avail-1`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Product availability deleted successfully' });
    expect(service.remove).toHaveBeenCalledWith(
      'avail-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });
});
