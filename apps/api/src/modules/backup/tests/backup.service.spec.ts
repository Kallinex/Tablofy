import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs/promises';
import { BackupService } from '../backup.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { I18nService } from '../../../common/i18n/i18n.service';
import { CacheService } from '../../../common/services/cache.service';

describe('BackupService.restore', () => {
  const TENANT = 'tenant-a';
  const OTHER_TENANT = 'tenant-b';
  const RECORD = {
    id: 'backup-1',
    tenantId: TENANT,
    status: 'COMPLETED',
    filePath: 'C:/tmp/backup-1.json',
    checksum: 'abc',
  };

  let service: BackupService;
  let prisma: Record<
    string,
    { upsert: jest.Mock; findMany?: jest.Mock; deletePattern?: jest.Mock }
  >;
  let cache: { delete: jest.Mock; deletePattern: jest.Mock };
  let tempDir: string;
  let filePath: string;

  const upsertModel = (name: string) => {
    prisma[name] = { upsert: jest.fn().mockResolvedValue({}) };
  };

  const writeBackup = async (data: Record<string, unknown>): Promise<string> => {
    filePath = `${tempDir}/backup-1.json`;
    await fs.writeFile(filePath, JSON.stringify(data));
    return filePath;
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp('backup-restore-');
    filePath = `${tempDir}/backup-1.json`;
    prisma = {
      backupRecord: {
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockImplementation(async () => ({ ...RECORD, filePath })),
      },
    };
    for (const model of [
      'restaurant',
      'branch',
      'floor',
      'diningArea',
      'table',
      'menuCategory',
      'product',
      'customer',
      'order',
      'orderItem',
      'orderItemModifier',
      'orderStatusHistory',
      'orderNote',
      'payment',
    ]) {
      upsertModel(model);
    }
    cache = {
      delete: jest.fn().mockResolvedValue(undefined),
      deletePattern: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        { provide: PrismaService, useValue: prisma },
        { provide: I18nService, useValue: { t: jest.fn().mockReturnValue('restored') } },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(BackupService);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('restores the full dining graph plus order history and reports per-entity counts', async () => {
    await writeBackup({
      tenantId: TENANT,
      exportedAt: '2026-09-29T00:00:00.000Z',
      restaurants: [{ id: 'r1', name: 'Demo', slug: 'demo', tenantId: TENANT }],
      branches: [{ id: 'b1', restaurantId: 'r1', name: 'Main', slug: 'main' }],
      floors: [{ id: 'f1', restaurantId: 'r1', branchId: 'b1', name: 'G', level: 1 }],
      diningAreas: [{ id: 'a1', branchId: 'b1', floorId: 'f1', name: 'Hall' }],
      tables: [{ id: 't1', branchId: 'b1', diningAreaId: 'a1', number: '1', seats: 4 }],
      menuCategories: [
        { id: 'c1', restaurantId: 'r1', name: 'Starters', tenantId: TENANT },
        { id: 'c2', restaurantId: 'r1', name: 'Mains', tenantId: TENANT },
      ],
      products: [{ id: 'p1', restaurantId: 'r1', name: 'Koshari', basePrice: 120 }],
      customers: [{ id: 'cu1', firstName: 'Ali', lastName: 'Hassan' }],
      orders: [
        {
          id: 'o1',
          restaurantId: 'r1',
          branchId: 'b1',
          tableId: 't1',
          userId: 'ghost-user',
          serviceChargeId: 'ghost-sc',
          taxRateId: 'ghost-tax',
          orderNumber: 1,
          subtotal: 120,
          discount: 0,
          discountAmount: 0,
          serviceCharge: 0,
          serviceChargeRate: 0,
          taxAmount: 0,
          taxRate: 0,
          tip: 0,
          total: 120,
          paidAmount: 120,
        },
      ],
      orderItems: [
        {
          id: 'oi1',
          orderId: 'o1',
          productId: 'p1',
          productName: 'Koshari',
          quantity: 1,
          unitPrice: 120,
          discount: 0,
          taxAmount: 0,
          serviceCharge: 0,
          total: 120,
        },
      ],
      orderItemModifiers: [{ id: 'm1', orderItemId: 'oi1', name: 'Extra', quantity: 1, price: 10 }],
      orderStatusHistory: [
        { id: 'h1', orderId: 'o1', toStatus: 'SERVED', changedByUserId: 'ghost-user' },
      ],
      orderNotes: [
        { id: 'n1', orderId: 'o1', type: 'GENERAL', content: 'no onions', userId: 'ghost-user' },
      ],
      payments: [
        {
          id: 'pay1',
          orderId: 'o1',
          method: 'CASH',
          status: 'COMPLETED',
          amount: 120,
          amountRefunded: 0,
          tip: 0,
        },
      ],
    });

    const result = await service.restore(TENANT, 'backup-1', 'en');

    expect(result.restored).toEqual({
      restaurants: 1,
      branches: 1,
      floors: 1,
      diningAreas: 1,
      tables: 1,
      menuCategories: 2,
      products: 1,
      customers: 1,
      orders: 1,
      orderItems: 1,
      orderItemModifiers: 1,
      orderStatusHistory: 1,
      orderNotes: 1,
      payments: 1,
    });
    expect(result.notRestored).toEqual({});
    expect(prisma.menuCategory.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.product.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.customer.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.table.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.payment.upsert).toHaveBeenCalledTimes(1);
  });

  it('nulls optional FKs whose parents are not restored', async () => {
    await writeBackup({
      tenantId: TENANT,
      restaurants: [{ id: 'r1', name: 'Demo', slug: 'demo' }],
      branches: [{ id: 'b1', restaurantId: 'r1', name: 'Main', slug: 'main' }],
      orders: [
        {
          id: 'o1',
          restaurantId: 'r1',
          branchId: 'b1',
          tableId: 'ghost-table',
          userId: 'ghost-user',
          serviceChargeId: 'ghost-sc',
          taxRateId: 'ghost-tax',
          orderNumber: 1,
          subtotal: 10,
          discount: 0,
          discountAmount: 0,
          serviceCharge: 0,
          serviceChargeRate: 0,
          taxAmount: 0,
          taxRate: 0,
          tip: 0,
          total: 10,
          paidAmount: 0,
        },
      ],
      orderItems: [],
      orderItemModifiers: [],
      orderStatusHistory: [],
      orderNotes: [],
      payments: [],
    });

    await service.restore(TENANT, 'backup-1', 'en');

    const [orderArgs] = prisma.order.upsert.mock.calls[0];
    expect(orderArgs.create.userId).toBeNull();
    expect(orderArgs.create.serviceChargeId).toBeNull();
    expect(orderArgs.create.taxRateId).toBeNull();
    expect(orderArgs.create.tableId).toBeNull();
  });

  it('never writes restored rows into another tenant', async () => {
    await writeBackup({
      tenantId: TENANT,
      restaurants: [{ id: 'r1', name: 'Demo', slug: 'demo', tenantId: OTHER_TENANT }],
      branches: [
        { id: 'b1', restaurantId: 'r1', name: 'Main', slug: 'main', tenantId: OTHER_TENANT },
      ],
      menuCategories: [{ id: 'c1', restaurantId: 'r1', name: 'Starters', tenantId: OTHER_TENANT }],
      products: [
        { id: 'p1', restaurantId: 'r1', name: 'Koshari', basePrice: 120, tenantId: OTHER_TENANT },
      ],
      customers: [{ id: 'cu1', firstName: 'Ali', lastName: 'H', tenantId: OTHER_TENANT }],
      orders: [
        {
          id: 'o1',
          restaurantId: 'r1',
          branchId: 'b1',
          orderNumber: 1,
          tenantId: OTHER_TENANT,
          subtotal: 0,
          discount: 0,
          discountAmount: 0,
          serviceCharge: 0,
          serviceChargeRate: 0,
          taxAmount: 0,
          taxRate: 0,
          tip: 0,
          total: 0,
          paidAmount: 0,
        },
      ],
      orderItems: [
        {
          id: 'oi1',
          orderId: 'o1',
          productId: 'p1',
          productName: 'X',
          quantity: 1,
          unitPrice: 0,
          discount: 0,
          taxAmount: 0,
          serviceCharge: 0,
          total: 0,
          tenantId: OTHER_TENANT,
        },
      ],
      orderItemModifiers: [],
      orderStatusHistory: [],
      orderNotes: [],
      payments: [],
    });

    await service.restore(TENANT, 'backup-1', 'en');

    for (const model of [
      prisma.restaurant,
      prisma.branch,
      prisma.menuCategory,
      prisma.product,
      prisma.customer,
      prisma.order,
      prisma.orderItem,
    ]) {
      for (const [args] of model.upsert.mock.calls as [
        never,
        { create: { tenantId: string }; update: { tenantId: string } },
      ][]) {
        expect(args.create.tenantId).toBe(TENANT);
        expect(args.update.tenantId).toBe(TENANT);
      }
    }
  });

  it('refuses a backup file that belongs to a different tenant', async () => {
    await writeBackup({
      tenantId: OTHER_TENANT,
      menuCategories: [{ id: 'c1', restaurantId: 'r1', name: 'Starters' }],
      products: [],
      customers: [],
      orders: [],
    });

    await expect(service.restore(TENANT, 'backup-1', 'en')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.menuCategory.upsert).not.toHaveBeenCalled();
    expect(prisma.backupRecord.update).not.toHaveBeenCalled();
  });

  it('invalidates the menu and customer caches so restored rows are visible', async () => {
    await writeBackup({
      tenantId: TENANT,
      menuCategories: [{ id: 'c1', restaurantId: 'r1', name: 'Starters' }],
      products: [{ id: 'p1', restaurantId: 'r2', name: 'Koshari', basePrice: 120 }],
      customers: [],
      orders: [],
    });

    await service.restore(TENANT, 'backup-1', 'en');

    expect(cache.deletePattern).toHaveBeenCalledWith(TENANT, 'menu:r1:*');
    expect(cache.deletePattern).toHaveBeenCalledWith(TENANT, 'menu:r2:*');
    expect(cache.delete).toHaveBeenCalledWith(TENANT, 'customers:list');
  });

  it('marks the record as RESTORED only after the rows are written', async () => {
    await writeBackup({
      tenantId: TENANT,
      menuCategories: [{ id: 'c1', restaurantId: 'r1', name: 'Starters' }],
      products: [],
      customers: [],
      orders: [],
    });

    await service.restore(TENANT, 'backup-1', 'en');

    expect(prisma.backupRecord.update).toHaveBeenCalledWith({
      where: { id: 'backup-1' },
      data: { verificationStatus: 'RESTORED' },
    });
  });

  it('rejects a record that is not restorable', async () => {
    prisma.backupRecord.findFirst.mockResolvedValue({ ...RECORD, status: 'FAILED' });
    await expect(service.restore(TENANT, 'backup-1', 'en')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
