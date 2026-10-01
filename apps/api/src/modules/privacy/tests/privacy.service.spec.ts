import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConsentType, ExportFormat } from '@prisma/client';
import * as fs from 'fs/promises';
import { PrivacyService } from '../privacy.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { I18nService } from '../../../common/i18n/i18n.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 123 }),
}));

const fsMock = fs as unknown as {
  mkdir: jest.Mock;
  writeFile: jest.Mock;
  stat: jest.Mock;
};

const userId = 'user-1';
const lang = 'en';

describe('PrivacyService', () => {
  let service: PrivacyService;
  let prisma: MockPrisma;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrivacyService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: I18nService, useValue: { t: jest.fn((key: string) => key) } },
      ],
    }).compile();

    service = module.get<PrivacyService>(PrivacyService);
    prisma = module.get(PrismaService) as MockPrisma;
  });

  beforeEach(() => {
    prisma.reset();
    fsMock.mkdir.mockReset().mockResolvedValue(undefined);
    fsMock.writeFile.mockReset().mockResolvedValue(undefined);
    fsMock.stat.mockReset().mockResolvedValue({ size: 123 });
  });

  describe('recordConsent', () => {
    it('creates a scoped consent record', async () => {
      prisma.consentRecord.create.mockResolvedValue({ id: 'c-1' });

      await service.recordConsent(
        testTenantId,
        { type: 'DATA_PROCESSING', granted: true, userId, ipAddress: '1.2.3.4' },
        lang,
      );

      expect(prisma.consentRecord.create.mock.calls[0][0].data).toMatchObject({
        tenantId: testTenantId,
        type: ConsentType.DATA_PROCESSING,
        granted: true,
        userId,
      });
    });
  });

  describe('revokeConsent', () => {
    it('throws when the record is missing', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue(null);
      await expect(service.revokeConsent(testTenantId, 'c-1', lang)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('marks the record revoked', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue({ id: 'c-1' });
      prisma.consentRecord.update.mockResolvedValue({ id: 'c-1' });

      await service.revokeConsent(testTenantId, 'c-1', lang);

      const data = prisma.consentRecord.update.mock.calls[0][0].data;
      expect(data.granted).toBe(false);
      expect(data.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('getConsentRecords', () => {
    it('filters by user and customer', async () => {
      await service.getConsentRecords(testTenantId, userId, 'cust-1');

      expect(prisma.consentRecord.findMany.mock.calls[0][0].where).toEqual({
        tenantId: testTenantId,
        userId,
        customerId: 'cust-1',
      });
    });
  });

  describe('saveCookiePreferences', () => {
    it('updates an existing preference', async () => {
      prisma.cookiePreference.findFirst.mockResolvedValue({ id: 'cp-1' });
      prisma.cookiePreference.update.mockResolvedValue({ id: 'cp-1' });

      await service.saveCookiePreferences(testTenantId, { userId, analytics: true }, lang);

      expect(prisma.cookiePreference.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cp-1' } }),
      );
      expect(prisma.cookiePreference.create).not.toHaveBeenCalled();
    });

    it('creates a new preference keyed by visitor', async () => {
      prisma.cookiePreference.findFirst.mockResolvedValue(null);
      prisma.cookiePreference.create.mockResolvedValue({ id: 'cp-2' });

      await service.saveCookiePreferences(
        testTenantId,
        { visitorId: 'v-1', necessary: true },
        lang,
      );

      expect(prisma.cookiePreference.findFirst.mock.calls[0][0].where).toEqual({
        tenantId: testTenantId,
        visitorId: 'v-1',
      });
      expect(prisma.cookiePreference.create).toHaveBeenCalled();
    });
  });

  describe('getCookiePreferences', () => {
    it('scopes by visitor', async () => {
      await service.getCookiePreferences(testTenantId, undefined, 'v-1');
      expect(prisma.cookiePreference.findFirst.mock.calls[0][0].where).toEqual({
        tenantId: testTenantId,
        visitorId: 'v-1',
      });
    });
  });

  describe('requestDataExport', () => {
    it('creates a pending full export request', async () => {
      await service.requestDataExport(testTenantId, userId, ExportFormat.CSV, lang);

      expect(prisma.dataExportRequest.create.mock.calls[0][0].data).toMatchObject({
        tenantId: testTenantId,
        userId,
        format: ExportFormat.CSV,
        status: 'PENDING',
        requestType: 'FULL',
      });
    });
  });

  describe('getExportStatus', () => {
    it('throws when missing', async () => {
      prisma.dataExportRequest.findFirst.mockResolvedValue(null);
      await expect(service.getExportStatus(testTenantId, 'r-1', lang)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the request', async () => {
      prisma.dataExportRequest.findFirst.mockResolvedValue({ id: 'r-1' });
      await expect(service.getExportStatus(testTenantId, 'r-1', lang)).resolves.toEqual({
        id: 'r-1',
      });
    });
  });

  describe('getUserExports', () => {
    it('lists the user exports newest first', async () => {
      prisma.dataExportRequest.findMany.mockResolvedValue([{ id: 'r-1' }]);
      const result = await service.getUserExports(testTenantId, userId);
      expect(result).toHaveLength(1);
      expect(prisma.dataExportRequest.findMany.mock.calls[0][0].orderBy).toEqual({
        createdAt: 'desc',
      });
    });
  });

  describe('processDataExport', () => {
    const pending = { id: 'r-1', userId, tenantId: testTenantId, status: 'PENDING' };

    it('returns null when not found', async () => {
      prisma.dataExportRequest.findUnique.mockResolvedValue(null);
      await expect(service.processDataExport('r-1')).resolves.toBeNull();
    });

    it('returns null when already processed', async () => {
      prisma.dataExportRequest.findUnique.mockResolvedValue({ ...pending, status: 'COMPLETED' });
      await expect(service.processDataExport('r-1')).resolves.toBeNull();
    });

    it('writes the export file and completes the request', async () => {
      prisma.dataExportRequest.findUnique.mockResolvedValue(pending);
      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        email: 'a@b.c',
        firstName: 'A',
        lastName: 'B',
        phone: null,
        role: 'OWNER',
        createdAt: new Date(),
      });
      prisma.dataExportRequest.update.mockResolvedValue({ id: 'r-1', status: 'COMPLETED' });

      await service.processDataExport('r-1');

      expect(fsMock.mkdir).toHaveBeenCalled();
      expect(fsMock.writeFile).toHaveBeenCalled();
      expect(prisma.dataExportRequest.update.mock.calls[0][0].data).toMatchObject({
        status: 'COMPLETED',
        fileSize: 123,
      });
      expect(prisma.dataExportRequest.update.mock.calls[0][0].data.expiresAt).toBeInstanceOf(Date);
    });

    it('marks the request FAILED when file writing throws', async () => {
      prisma.dataExportRequest.findUnique.mockResolvedValue(pending);
      prisma.user.findUnique.mockResolvedValue(null);
      fsMock.writeFile.mockRejectedValue(new Error('disk full'));
      prisma.dataExportRequest.update.mockResolvedValue({ id: 'r-1', status: 'FAILED' });

      await service.processDataExport('r-1');

      expect(prisma.dataExportRequest.update.mock.calls[0][0].data).toMatchObject({
        status: 'FAILED',
        errorMessage: 'disk full',
      });
    });
  });

  describe('anonymizeUser', () => {
    it('throws when the user is not in the tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.anonymizeUser(testTenantId, userId, lang)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('redacts personal fields', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: userId });
      prisma.user.update.mockResolvedValue({ id: userId });

      await service.anonymizeUser(testTenantId, userId, lang);

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.email).toBe('redacted-user-1@anon.local');
      expect(data.phone).toBeNull();
      expect(data.lastName).toBe('[REDACTED]');
    });
  });
});
