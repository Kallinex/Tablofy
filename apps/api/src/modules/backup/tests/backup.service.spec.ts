import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { BackupService } from '../backup.service';
import { BackupRecordType } from '@prisma/client';
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

describe('BackupService.create/find/verify/deleteExpired', () => {
  const TENANT = 'tenant-a';
  const lang = 'en';

  let service: BackupService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let cache: Record<string, jest.Mock>;
  let i18n: { t: jest.Mock };
  let backupDir: string;
  let originalCwd: string;

  const collectModels = [
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
  ];

  beforeEach(async () => {
    originalCwd = process.cwd();
    backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-create-'));
    process.chdir(backupDir);

    prisma = {
      backupRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'backup-1', tenantId: TENANT }),
        update: jest.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
          id: 'backup-1',
          ...args.data,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    for (const model of collectModels) {
      prisma[model] = { findMany: jest.fn().mockResolvedValue([]) };
    }
    cache = { delete: jest.fn(), deletePattern: jest.fn() };
    i18n = { t: jest.fn().mockReturnValue('backup error') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        { provide: PrismaService, useValue: prisma },
        { provide: I18nService, useValue: i18n },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(BackupService);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(backupDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('refuses to start a second backup while one is still running', async () => {
      prisma.backupRecord.findFirst.mockResolvedValueOnce({
        id: 'backup-0',
        status: 'IN_PROGRESS',
      });

      await expect(service.create(TENANT, BackupRecordType.FULL, lang)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.backupRecord.create).not.toHaveBeenCalled();
    });

    it('writes a checksummed archive and marks the record COMPLETED', async () => {
      const result = await service.create(TENANT, BackupRecordType.FULL, lang);

      expect(result.status).toBe('COMPLETED');
      expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(result.fileSize).toBeGreaterThan(0);

      const written = await fs.readFile(result.filePath as string, 'utf-8');
      expect(JSON.parse(written).tenantId).toBe(TENANT);
      expect(JSON.parse(written).restaurants).toEqual([]);
    });

    it('collects every model listed in the archive', async () => {
      await service.create(TENANT, BackupRecordType.INCREMENTAL, lang);

      for (const model of collectModels) {
        expect(prisma[model].findMany).toHaveBeenCalled();
      }
      expect(prisma.backupRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT,
            type: BackupRecordType.INCREMENTAL,
            status: 'IN_PROGRESS',
            retentionDays: 30,
          }),
        }),
      );
    });

    it('marks the record FAILED and stores the error when writing fails', async () => {
      prisma.restaurant.findMany.mockRejectedValueOnce(new Error('database offline'));

      const result = await service.create(TENANT, BackupRecordType.FULL, lang);

      expect(result.status).toBe('FAILED');
      expect(result.errorMessage).toBe('database offline');
    });

    it('normalises a non-Error rejection into a stored error message', async () => {
      prisma.restaurant.findMany.mockRejectedValueOnce('socket hang up');

      const result = await service.create(TENANT, BackupRecordType.FULL, lang);

      expect(result.status).toBe('FAILED');
      expect(result.errorMessage).toBe('Unknown error');
    });
  });

  describe('findAll', () => {
    it('paginates and totals records for the tenant', async () => {
      prisma.backupRecord.findMany.mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }]);
      prisma.backupRecord.count.mockResolvedValueOnce(2);

      await expect(service.findAll(TENANT)).resolves.toEqual({
        data: [{ id: 'b1' }, { id: 'b2' }],
        total: 2,
        page: 1,
        limit: 20,
      });
      expect(prisma.backupRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('honours an explicit page and limit', async () => {
      await service.findAll(TENANT, 3, 5);

      expect(prisma.backupRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFound for a record that does not belong to the tenant', async () => {
      prisma.backupRecord.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne(TENANT, 'missing', lang)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.backupRecord.findFirst).toHaveBeenCalledWith({
        where: { id: 'missing', tenantId: TENANT },
      });
    });
  });

  describe('verify', () => {
    it('marks an intact archive VALID', async () => {
      const content = JSON.stringify({ tenantId: TENANT });
      const checksum = crypto.createHash('sha256').update(content).digest('hex');
      await fs.writeFile(path.join(backupDir, 'archive.json'), content);
      prisma.backupRecord.findFirst.mockResolvedValueOnce({
        id: 'backup-1',
        tenantId: TENANT,
        filePath: path.join(backupDir, 'archive.json'),
        checksum,
      });

      const result = await service.verify(TENANT, 'backup-1', lang);

      expect(result).toEqual({ valid: true, checksum, expectedChecksum: checksum });
      expect(prisma.backupRecord.update).toHaveBeenCalledWith({
        where: { id: 'backup-1' },
        data: { verifiedAt: expect.any(Date), verificationStatus: 'VALID' },
      });
    });

    it('marks a tampered archive INVALID', async () => {
      await fs.writeFile(path.join(backupDir, 'archive.json'), '{"tampered":true}');
      prisma.backupRecord.findFirst.mockResolvedValueOnce({
        id: 'backup-1',
        tenantId: TENANT,
        filePath: path.join(backupDir, 'archive.json'),
        checksum: 'a'.repeat(64),
      });

      const result = await service.verify(TENANT, 'backup-1', lang);

      expect(result.valid).toBe(false);
      expect(prisma.backupRecord.update).toHaveBeenCalledWith({
        where: { id: 'backup-1' },
        data: { verifiedAt: expect.any(Date), verificationStatus: 'INVALID' },
      });
    });

    it('rejects a record that has no stored file path', async () => {
      prisma.backupRecord.findFirst.mockResolvedValueOnce({
        id: 'backup-1',
        tenantId: TENANT,
        filePath: null,
      });

      await expect(service.verify(TENANT, 'backup-1', lang)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when the archive file is unreadable', async () => {
      prisma.backupRecord.findFirst.mockResolvedValueOnce({
        id: 'backup-1',
        tenantId: TENANT,
        filePath: path.join(backupDir, 'does-not-exist.json'),
        checksum: 'a'.repeat(64),
      });

      await expect(service.verify(TENANT, 'backup-1', lang)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.backupRecord.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteExpired', () => {
    it('unlinks each expired file and marks the records EXPIRED', async () => {
      const first = path.join(backupDir, 'expired-1.json');
      const second = path.join(backupDir, 'expired-2.json');
      await fs.writeFile(first, '{}');
      await fs.writeFile(second, '{}');
      prisma.backupRecord.findMany.mockResolvedValueOnce([
        { id: 'b1', filePath: first },
        { id: 'b2', filePath: second },
      ]);

      const removed = await service.deleteExpired();

      expect(removed).toBe(2);
      await expect(fs.stat(first)).rejects.toThrow();
      await expect(fs.stat(second)).rejects.toThrow();
      expect(prisma.backupRecord.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['b1', 'b2'] } },
        data: { status: 'EXPIRED' },
      });
    });

    it('still expires records whose file is already missing or pathless', async () => {
      prisma.backupRecord.findMany.mockResolvedValueOnce([
        { id: 'b1', filePath: path.join(backupDir, 'gone.json') },
        { id: 'b2', filePath: null },
      ]);

      const removed = await service.deleteExpired();

      expect(removed).toBe(2);
      expect(prisma.backupRecord.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['b1', 'b2'] } },
        data: { status: 'EXPIRED' },
      });
    });

    it('issues no update filter when nothing expired', async () => {
      const removed = await service.deleteExpired();

      expect(removed).toBe(0);
      expect(prisma.backupRecord.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [] } },
        data: { status: 'EXPIRED' },
      });
    });
  });
});
