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
  let prisma: {
    menuCategory: { upsert: jest.Mock };
    product: { upsert: jest.Mock };
    customer: { upsert: jest.Mock };
    backupRecord: { update: jest.Mock; findFirst: jest.Mock };
  };
  let cache: { delete: jest.Mock; deletePattern: jest.Mock };
  let tempDir: string;
  let filePath: string;

  const writeBackup = async (data: Record<string, unknown>): Promise<string> => {
    filePath = `${tempDir}/backup-1.json`;
    await fs.writeFile(filePath, JSON.stringify(data));
    return filePath;
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp('backup-restore-');
    filePath = `${tempDir}/backup-1.json`;
    prisma = {
      menuCategory: { upsert: jest.fn().mockResolvedValue({}) },
      product: { upsert: jest.fn().mockResolvedValue({}) },
      customer: { upsert: jest.fn().mockResolvedValue({}) },
      backupRecord: {
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockImplementation(async () => ({ ...RECORD, filePath })),
      },
    };
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

  it('restores categories, products and customers and reports per-entity counts', async () => {
    await writeBackup({
      tenantId: TENANT,
      exportedAt: '2026-09-29T00:00:00.000Z',
      menuCategories: [
        { id: 'c1', restaurantId: 'r1', name: 'Starters', tenantId: TENANT },
        { id: 'c2', restaurantId: 'r1', name: 'Mains', tenantId: TENANT },
      ],
      products: [{ id: 'p1', restaurantId: 'r1', name: 'Koshari', basePrice: 120 }],
      customers: [{ id: 'cu1', firstName: 'Ali', lastName: 'Hassan' }],
      orders: [{ id: 'o1' }, { id: 'o2' }],
    });

    const result = await service.restore(TENANT, 'backup-1', 'en');

    expect(result.restored).toEqual({ menuCategories: 2, products: 1, customers: 1 });
    expect(result.notRestored).toEqual({ orders: 2 });
    expect(prisma.menuCategory.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.product.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.customer.upsert).toHaveBeenCalledTimes(1);
  });

  it('never writes restored rows into another tenant', async () => {
    await writeBackup({
      tenantId: TENANT,
      menuCategories: [{ id: 'c1', restaurantId: 'r1', name: 'Starters', tenantId: OTHER_TENANT }],
      products: [
        { id: 'p1', restaurantId: 'r1', name: 'Koshari', basePrice: 120, tenantId: OTHER_TENANT },
      ],
      customers: [{ id: 'cu1', firstName: 'Ali', lastName: 'H', tenantId: OTHER_TENANT }],
      orders: [],
    });

    await service.restore(TENANT, 'backup-1', 'en');

    for (const mock of [
      prisma.menuCategory.upsert,
      prisma.product.upsert,
      prisma.customer.upsert,
    ]) {
      for (const [args] of mock.mock.calls) {
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
