import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { InventoryController } from '../inventory.controller';
import { InventoryService } from '../inventory.service';

describe('InventoryController', () => {
  let controller: InventoryController;
  let service: { [key: string]: jest.Mock };

  beforeEach(async () => {
    service = {
      getLowStockItems: jest.fn().mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrevious: false },
      }),
      getCriticalStockItems: jest.fn().mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrevious: false },
      }),
      getOutOfStockItems: jest.fn().mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrevious: false },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [{ provide: InventoryService, useValue: service }],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
  });

  it('should forward page/limit verbatim so service defaults apply when absent', async () => {
    const user = { tenantId: 'tenant-1' } as never;
    await controller.getLowStockItems({}, user);
    await controller.getCriticalStockItems({}, user);
    await controller.getOutOfStockItems({}, user);

    expect(service.getLowStockItems).toHaveBeenCalledWith('tenant-1', undefined, undefined);
    expect(service.getCriticalStockItems).toHaveBeenCalledWith('tenant-1', undefined, undefined);
    expect(service.getOutOfStockItems).toHaveBeenCalledWith('tenant-1', undefined, undefined);
  });

  it('should forward explicit page/limit query values', async () => {
    const user = { tenantId: 'tenant-1' } as never;
    await controller.getLowStockItems({ page: 3, limit: 25 }, user);

    expect(service.getLowStockItems).toHaveBeenCalledWith('tenant-1', 3, 25);
  });

  it('should return the paginated envelope shape', async () => {
    const user = { tenantId: 'tenant-1' } as never;
    const result = await controller.getLowStockItems({}, user);

    expect(result).toEqual(
      expect.objectContaining({
        data: expect.any(Array),
        meta: expect.objectContaining({
          total: expect.any(Number),
          page: expect.any(Number),
          limit: expect.any(Number),
          totalPages: expect.any(Number),
          hasNext: expect.any(Boolean),
          hasPrevious: expect.any(Boolean),
        }),
      }),
    );
  });
});

describe('InventoryController DTO validation', () => {
  let app: INestApplication;
  let service: { getLowStockItems: jest.Mock };

  beforeAll(async () => {
    service = {
      getLowStockItems: jest.fn(),
      getCriticalStockItems: jest.fn(),
      getOutOfStockItems: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [{ provide: InventoryService, useValue: service }],
    }).compile();

    app = module.createNestApplication();
    app.use((req: { user?: Record<string, unknown> }, _res: unknown, next: () => void) => {
      req.user = { id: 'user-1', email: 'owner@test.com', role: 'OWNER', tenantId: 'tenant-1' };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects limit above the max allowed by QueryInventoryDto', async () => {
    const response = await request(app.getHttpServer()).get(
      '/inventory/low-stock?page=1&limit=101',
    );

    expect(response.statusCode).toBe(400);
    expect(service.getLowStockItems).not.toHaveBeenCalled();
  });

  it('accepts a valid page/limit', async () => {
    const response = await request(app.getHttpServer()).get('/inventory/low-stock?page=1&limit=20');

    expect(service.getLowStockItems).toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
  });
});
