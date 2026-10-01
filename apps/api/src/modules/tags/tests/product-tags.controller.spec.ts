import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ProductTagsController } from '../product-tags.controller';
import { ProductTagsService } from '../product-tags.service';
import { createControllerApp, TEST_USER } from '../../../test/helpers/controller-app';

describe('ProductTagsController', () => {
  let app: INestApplication;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'tag-1' }),
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      findOne: jest.fn().mockResolvedValue({ id: 'tag-1' }),
      update: jest.fn().mockResolvedValue({ id: 'tag-1' }),
      softDelete: jest.fn().mockResolvedValue(undefined),
      restore: jest.fn().mockResolvedValue({ id: 'tag-1' }),
    };

    app = await createControllerApp(ProductTagsController, [
      { provide: ProductTagsService, useValue: service },
    ]);
  });

  afterEach(async () => {
    await app.close();
  });

  const base = '/restaurants/restaurant-1/tags';

  it('creates a tag scoped to the JWT tenant, not the path', async () => {
    const response = await request(app.getHttpServer())
      .post(base)
      .send({ name: 'Vegan' })
      .set('user-agent', 'jest');

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Vegan' }),
      'restaurant-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.objectContaining({ userAgent: 'jest' }),
    );
  });

  it('lists tags with tenant and pagination filters', async () => {
    const response = await request(app.getHttpServer()).get(`${base}?page=2&limit=5&search=veg`);

    expect(response.statusCode).toBe(200);
    expect(service.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEST_USER.tenantId,
        restaurantId: 'restaurant-1',
        page: '2',
        limit: '5',
        search: 'veg',
      }),
    );
  });

  it('reads a single tag with the JWT tenant', async () => {
    const response = await request(app.getHttpServer()).get(`${base}/tag-1`);

    expect(response.statusCode).toBe(200);
    expect(service.findOne).toHaveBeenCalledWith('tag-1', TEST_USER.tenantId);
  });

  it('updates a tag and forwards the audit context', async () => {
    const response = await request(app.getHttpServer())
      .put(`${base}/tag-1`)
      .send({ name: 'Vegan Options' });

    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      'tag-1',
      expect.objectContaining({ name: 'Vegan Options' }),
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.objectContaining({ ipAddress: expect.anything() }),
    );
  });

  it('soft deletes with HTTP 200 and returns a confirmation message', async () => {
    const response = await request(app.getHttpServer()).delete(`${base}/tag-1`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Product tag deleted successfully' });
    expect(service.softDelete).toHaveBeenCalledWith(
      'tag-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });

  it('restores a soft-deleted tag with HTTP 200', async () => {
    const response = await request(app.getHttpServer()).post(`${base}/tag-1/restore`);

    expect(response.statusCode).toBe(200);
    expect(service.restore).toHaveBeenCalledWith(
      'tag-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });
});
