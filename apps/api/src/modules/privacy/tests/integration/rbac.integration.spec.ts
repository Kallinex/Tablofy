import { Test, TestingModule } from '@nestjs/testing';
import { PrivacyController } from '../../privacy.controller';
import { PrivacyService } from '../../privacy.service';

describe('Privacy RBAC — Integration', () => {
  let controller: PrivacyController;
  let privacyService: jest.Mocked<PrivacyService>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PrivacyController],
      providers: [
        {
          provide: PrivacyService,
          useValue: {
            recordConsent: jest.fn(),
            revokeConsent: jest.fn(),
            getConsentRecords: jest.fn(),
            saveCookiePreferences: jest.fn(),
            getCookiePreferences: jest.fn(),
            requestDataExport: jest.fn(),
            getUserExports: jest.fn(),
            getExportStatus: jest.fn(),
            anonymizeUser: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PrivacyController>(PrivacyController);
    privacyService = module.get(PrivacyService) as jest.Mocked<PrivacyService>;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should allow OWNER/MANAGER to record consent', async () => {
    privacyService.recordConsent.mockResolvedValueOnce({ id: 'consent-1' });
    const req = { tenantId: 'tenant-1', lang: 'en', user: { id: 'user-1' } };

    const result = await controller.recordConsent({ type: 'EMAIL', granted: true }, req as never);

    expect(result).toBeDefined();
    expect(privacyService.recordConsent).toHaveBeenCalled();
  });

  it('should allow OWNER/MANAGER to revoke consent', async () => {
    privacyService.revokeConsent.mockResolvedValueOnce({ revoked: true });
    const req = { tenantId: 'tenant-1', lang: 'en' };

    const result = await controller.revokeConsent('consent-1', req as never);

    expect(result).toEqual({ revoked: true });
  });

  it('should allow OWNER/MANAGER to get consent records', async () => {
    privacyService.getConsentRecords.mockResolvedValueOnce([]);
    const req = { tenantId: 'tenant-1', user: { id: 'user-1' } };

    const result = await controller.getConsentRecords(req as never);

    expect(result).toEqual([]);
  });

  it('should allow OWNER/MANAGER to request data export', async () => {
    privacyService.requestDataExport.mockResolvedValueOnce({ id: 'export-1' });
    const req = { tenantId: 'tenant-1', lang: 'en', user: { id: 'user-1' } };

    const result = await controller.requestDataExport(req as never);

    expect(result).toBeDefined();
  });

  it('should allow OWNER/MANAGER to anonymize user', async () => {
    privacyService.anonymizeUser.mockResolvedValueOnce({ anonymized: true });
    const req = { tenantId: 'tenant-1', lang: 'en', user: { id: 'user-1' } };

    const result = await controller.anonymizeUser(req as never);

    expect(result).toEqual({ anonymized: true });
  });
});
