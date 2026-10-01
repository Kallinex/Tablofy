import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ProductsController } from '../products.controller';
import { ProductsService } from '../products.service';
import { createControllerApp, TEST_USER } from '../../../test/helpers/controller-app';

describe('ProductsController', () => {
  let app: INestApplication;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'product-1' }),
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      findOne: jest.fn().mockResolvedValue({ id: 'product-1' }),
      update: jest.fn().mockResolvedValue({ id: 'product-1' }),
      softDelete: jest.fn().mockResolvedValue(undefined),
      restore: jest.fn().mockResolvedValue({ id: 'product-1' }),
    };

    app = await createControllerApp(ProductsController, [
      { provide: ProductsService, useValue: service },
    ]);
  });

  afterEach(async () => {
    await app.close();
  });

  const base = '/restaurants/restaurant-1/products';

  it('creates a product scoped to the JWT tenant', async () => {
    const response = await request(app.getHttpServer())
      .post(base)
      .send({ name: 'Coffee', sku: 'COF-1', basePrice: 250 })
      .set('user-agent', 'jest');

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Coffee' }),
      'restaurant-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.objectContaining({ userAgent: 'jest' }),
    );
  });

  it('lists products with full query filters', async () => {
    const response = await request(app.getHttpServer()).get(
      `${base}?page=1&limit=20&search=latte&isActive=true&isFeatured=true&menuCategoryId=cat-1`,
    );

    expect(response.statusCode).toBe(200);
    expect(service.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEST_USER.tenantId,
        restaurantId: 'restaurant-1',
        page: '1',
        limit: '20',
        search: 'latte',
        isActive: 'true',
        isFeatured: 'true',
        menuCategoryId: 'cat-1',
      }),
    );
  });

  it('reads a product with the JWT tenant', async () => {
    const response = await request(app.getHttpServer()).get(`${base}/product-1`);

    expect(response.statusCode).toBe(200);
    expect(service.findOne).toHaveBeenCalledWith('product-1', TEST_USER.tenantId);
  });

  it('updates a product with audit context', async () => {
    const response = await request(app.getHttpServer())
      .put(`${base}/product-1`)
      .send({ name: 'Latte' });

    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      'product-1',
      expect.objectContaining({ name: 'Latte' }),
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });

  it('soft deletes with HTTP 200 and a confirmation message', async () => {
    const response = await request(app.getHttpServer()).delete(`${base}/product-1`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Product deleted successfully' });
    expect(service.softDelete).toHaveBeenCalledWith(
      'product-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });

  it('restores a product with HTTP 200', async () => {
    const response = await request(app.getHttpServer()).post(`${base}/product-1/restore`);

    expect(response.statusCode).toBe(200);
    expect(service.restore).toHaveBeenCalledWith(
      'product-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });
});
