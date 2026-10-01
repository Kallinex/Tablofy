import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { PaymentsController } from '../payments.controller';
import { PaymentsService } from '../payments.service';

describe('PaymentsController routes', () => {
  let app: INestApplication;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      charge: jest.fn().mockResolvedValue({ id: 'payment-1', status: 'PENDING' }),
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      reconcile: jest
        .fn()
        .mockResolvedValue({ localPayments: 2, providerMatches: 2, mismatches: 0 }),
      findOne: jest.fn().mockRejectedValue(new NotFoundException('Payment not found')),
      refund: jest.fn().mockResolvedValue({}),
      partialRefund: jest.fn().mockResolvedValue({}),
      voidPayment: jest.fn().mockResolvedValue({}),
      splitPayment: jest.fn().mockResolvedValue({}),
      getProviderForTenant: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: service }],
    }).compile();

    app = module.createNestApplication();
    app.use((req: { user?: Record<string, unknown> }, _res: unknown, next: () => void) => {
      req.user = { id: 'user-1', email: 'owner@test.com', role: 'OWNER', tenantId: 'tenant-1' };
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should route GET reconcile to the reconcile handler, not :id', async () => {
    const response = await request(app.getHttpServer()).get(
      '/restaurants/restaurant-1/payments/reconcile',
    );

    expect(response.statusCode).toBe(200);
    expect(service.reconcile).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(String),
      expect.any(String),
    );
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('should still bind GET :id to findOne', async () => {
    const response = await request(app.getHttpServer()).get(
      '/restaurants/restaurant-1/payments/payment-1',
    );

    expect(response.statusCode).toBe(404);
    expect(service.findOne).toHaveBeenCalledWith('payment-1', 'tenant-1');
    expect(service.reconcile).not.toHaveBeenCalled();
  });

  it('should route GET providers/:tenantId/status to providerStatus', async () => {
    const response = await request(app.getHttpServer()).get(
      '/restaurants/restaurant-1/payments/providers/tenant-1/status',
    );

    expect(response.statusCode).toBe(200);
    expect(service.getProviderForTenant).toHaveBeenCalledWith('tenant-1');
  });

  it('should reject a provider status lookup for another tenant', async () => {
    const response = await request(app.getHttpServer()).get(
      '/restaurants/restaurant-1/payments/providers/tenant-9/status',
    );

    expect(response.statusCode).toBe(403);
    expect(service.getProviderForTenant).not.toHaveBeenCalled();
  });

  it('should route POST to charge', async () => {
    const response = await request(app.getHttpServer())
      .post('/restaurants/restaurant-1/payments')
      .send({ orderId: 'order-1', method: 'CARD', amount: 25 });

    expect(response.statusCode).toBe(201);
    expect(service.charge).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ orderId: 'order-1' }),
      'tenant-1',
      'user-1',
    );
  });
});
