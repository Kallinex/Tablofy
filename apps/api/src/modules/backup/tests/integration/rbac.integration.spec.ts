import { Test, TestingModule } from '@nestjs/testing';
import { BackupController } from '../../backup.controller';
import { BackupService } from '../../backup.service';

describe('Backup RBAC — Integration', () => {
  let controller: BackupController;
  let backupService: jest.Mocked<BackupService>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BackupController],
      providers: [
        {
          provide: BackupService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            verify: jest.fn(),
            restore: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<BackupController>(BackupController);
    backupService = module.get(BackupService) as jest.Mocked<BackupService>;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should allow OWNER role to create backup', async () => {
    backupService.create.mockResolvedValueOnce({ id: 'backup-1' });
    const req = { tenantId: 'tenant-1', lang: 'en' };

    const result = await controller.create(req as never);

    expect(result).toEqual({ id: 'backup-1' });
    expect(backupService.create).toHaveBeenCalledWith('tenant-1', 'FULL', 'en');
  });

  it('should allow OWNER role to list backups', async () => {
    backupService.findAll.mockResolvedValueOnce({
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
    });
    const req = { tenantId: 'tenant-1' };

    const result = await controller.findAll(req as never, 1, 20);

    expect(result).toBeDefined();
    expect(backupService.findAll).toHaveBeenCalledWith('tenant-1', 1, 20);
  });

  it('should allow OWNER role to verify backup', async () => {
    backupService.verify.mockResolvedValueOnce({ verified: true });
    const req = { tenantId: 'tenant-1', lang: 'en' };

    const result = await controller.verify('backup-1', req as never);

    expect(result).toEqual({ verified: true });
  });

  it('should allow OWNER role to restore backup', async () => {
    backupService.restore.mockResolvedValueOnce({ restored: true });
    const req = { tenantId: 'tenant-1', lang: 'en' };

    const result = await controller.restore('backup-1', req as never);

    expect(result).toEqual({ restored: true });
  });

  it('should throw when service rejects (non-OWNER simulated)', async () => {
    backupService.create.mockRejectedValueOnce(new Error('Forbidden'));

    await expect(controller.create({ tenantId: 'tenant-1', lang: 'en' } as never)).rejects.toThrow(
      'Forbidden',
    );
  });
});
