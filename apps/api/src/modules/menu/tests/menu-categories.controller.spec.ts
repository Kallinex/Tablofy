import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MenuCategoriesController } from '../menu-categories.controller';
import { MenuCategoriesService } from '../menu-categories.service';
import { createControllerApp, TEST_USER } from '../../../test/helpers/controller-app';

describe('MenuCategoriesController', () => {
  let app: INestApplication;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'category-1' }),
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      findOne: jest.fn().mockResolvedValue({ id: 'category-1' }),
      update: jest.fn().mockResolvedValue({ id: 'category-1' }),
      softDelete: jest.fn().mockResolvedValue(undefined),
      restore: jest.fn().mockResolvedValue({ id: 'category-1' }),
    };

    app = await createControllerApp(MenuCategoriesController, [
      { provide: MenuCategoriesService, useValue: service },
    ]);
  });

  afterEach(async () => {
    await app.close();
  });

  const base = '/restaurants/restaurant-1/menu-categories';

  it('creates a category scoped to the JWT tenant', async () => {
    const response = await request(app.getHttpServer())
      .post(base)
      .send({ name: 'Starters' })
      .set('user-agent', 'jest');

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Starters' }),
      'restaurant-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.objectContaining({ userAgent: 'jest' }),
    );
  });

  it('lists categories with tenant and filters', async () => {
    const response = await request(app.getHttpServer()).get(`${base}?isActive=true&page=2`);

    expect(response.statusCode).toBe(200);
    expect(service.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEST_USER.tenantId,
        restaurantId: 'restaurant-1',
        isActive: 'true',
        page: '2',
      }),
    );
  });

  it('reads one category with the JWT tenant', async () => {
    const response = await request(app.getHttpServer()).get(`${base}/category-1`);

    expect(response.statusCode).toBe(200);
    expect(service.findOne).toHaveBeenCalledWith('category-1', TEST_USER.tenantId);
  });

  it('updates a category', async () => {
    const response = await request(app.getHttpServer())
      .put(`${base}/category-1`)
      .send({ name: 'Small Plates' });

    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      'category-1',
      expect.objectContaining({ name: 'Small Plates' }),
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });

  it('soft deletes with HTTP 200 and a message', async () => {
    const response = await request(app.getHttpServer()).delete(`${base}/category-1`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Menu category deleted successfully' });
    expect(service.softDelete).toHaveBeenCalledWith(
      'category-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });

  it('restores with HTTP 200', async () => {
    const response = await request(app.getHttpServer()).post(`${base}/category-1/restore`);

    expect(response.statusCode).toBe(200);
    expect(service.restore).toHaveBeenCalledWith(
      'category-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });
});
