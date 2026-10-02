import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ProductImagesController } from '../product-images.controller';
import { ProductImagesService } from '../product-images.service';
import { ImageStorageService } from '../../../common/upload/image-storage.service';
import { createControllerApp, TEST_USER } from '../../../test/helpers/controller-app';

describe('ProductImagesController', () => {
  let app: INestApplication;
  let service: { [key: string]: jest.Mock };
  let storage: { save: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'image-1' }),
      findAll: jest.fn().mockResolvedValue([{ id: 'image-1' }]),
      findOne: jest.fn().mockResolvedValue({ id: 'image-1' }),
      update: jest.fn().mockResolvedValue({ id: 'image-1' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    storage = {
      save: jest.fn().mockResolvedValue({
        url: 'https://cdn.test/uploads/tenant-1/product-1/u.png',
        key: 'tenant-1/product-1/u.png',
      }),
    };

    app = await createControllerApp(ProductImagesController, [
      { provide: ProductImagesService, useValue: service },
      { provide: ImageStorageService, useValue: storage },
    ]);
  });

  afterEach(async () => {
    await app.close();
  });

  const base = '/restaurants/restaurant-1/products/product-1/images';

  it('adds an image for the product in the JWT tenant', async () => {
    const response = await request(app.getHttpServer())
      .post(base)
      .send({ url: 'https://cdn.test/a.png' })
      .set('user-agent', 'jest');

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://cdn.test/a.png' }),
      'product-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.objectContaining({ userAgent: 'jest' }),
    );
  });

  it('lists images for the product', async () => {
    const response = await request(app.getHttpServer()).get(base);

    expect(response.statusCode).toBe(200);
    expect(service.findAll).toHaveBeenCalledWith('product-1', TEST_USER.tenantId);
  });

  it('reads one image with the JWT tenant', async () => {
    const response = await request(app.getHttpServer()).get(`${base}/image-1`);

    expect(response.statusCode).toBe(200);
    expect(service.findOne).toHaveBeenCalledWith('image-1', TEST_USER.tenantId);
  });

  it('updates an image', async () => {
    const response = await request(app.getHttpServer())
      .put(`${base}/image-1`)
      .send({ isPrimary: true })
      .set('user-agent', 'jest');

    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      'image-1',
      expect.objectContaining({ isPrimary: true }),
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });

  it('removes an image with HTTP 200 and a message', async () => {
    const response = await request(app.getHttpServer()).delete(`${base}/image-1`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Product image deleted successfully' });
    expect(service.remove).toHaveBeenCalledWith(
      'image-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });

  it('stores an uploaded image and creates the record with its public URL', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const response = await request(app.getHttpServer())
      .post(`${base}/upload`)
      .field('altText', 'front view')
      .attach('file', png, { filename: 'photo.png', contentType: 'image/png' });

    expect(response.statusCode).toBe(201);
    expect(storage.save).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: 'photo.png', mimetype: 'image/png' }),
      { tenantId: TEST_USER.tenantId, productId: 'product-1' },
    );
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://cdn.test/uploads/tenant-1/product-1/u.png',
        altText: 'front view',
      }),
      'product-1',
      TEST_USER.tenantId,
      TEST_USER.id,
      expect.any(Object),
    );
  });

  it('rejects an upload that carries no file', async () => {
    const response = await request(app.getHttpServer())
      .post(`${base}/upload`)
      .field('altText', 'front view');

    expect(response.statusCode).toBe(400);
    expect(storage.save).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });
});
