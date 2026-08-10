import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from '../api-keys.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLoggerService } from '../../../common/logger/logger.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;

  const mockLogger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: AppLoggerService, useValue: mockLogger },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                'apiKeys.keyPrefix': 'tab_',
                'apiKeys.keyLength': 48,
                'apiKeys.maxKeysPerTenant': 20,
                'apiKeys.rateLimitPerMin': 60,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    jest.clearAllMocks();
  });

  describe('generateApiKey', () => {
    it('should return a prefixed raw key with a sha256 hash and last chars', () => {
      const { rawKey, prefix, hash, lastChars } = service.generateApiKey();

      expect(rawKey.startsWith('tab_')).toBe(true);
      expect(prefix.startsWith('tab_')).toBe(true);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(lastChars).toBe(rawKey.slice(-4));
      expect(service.hashKey(rawKey)).toBe(hash);
    });
  });

  describe('create', () => {
    it('should reject a duplicate key name', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1' });

      await expect(
        service.create({ name: 'billing', scopes: ['orders'] } as never, testTenantId, testUserId),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject when the tenant has reached the key limit', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);
      prisma.apiKey.count.mockResolvedValue(20);

      await expect(
        service.create({ name: 'billing', scopes: ['orders'] } as never, testTenantId, testUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should store only the hash and return the raw key once', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);
      prisma.apiKey.count.mockResolvedValue(0);
      prisma.apiKey.create.mockResolvedValue({});

      const result = await service.create(
        { name: 'billing', scopes: ['orders', 'payments'] } as never,
        testTenantId,
        testUserId,
      );

      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: testTenantId,
            keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            keyPrefix: expect.stringMatching(/^tab_/),
            createdById: testUserId,
            scopes: ['orders', 'payments'],
          }),
        }),
      );
      expect(service.hashKey(result.key)).toBe(
        (prisma.apiKey.create.mock.calls[0][0] as { data: { keyHash: string } }).data.keyHash,
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'API_KEY_CREATED' }),
      );
    });
  });

  describe('validateApiKey', () => {
    it('should reject an unknown key hash', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(service.validateApiKey('tab_unknown')).resolves.toEqual({ valid: false });
    });

    it('should reject an expired key', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: 'key-1',
        tenantId: testTenantId,
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await service.validateApiKey('tab_validkeyvalue');

      expect(result).toEqual({ valid: false });
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it('should accept a valid key, update lastUsedAt, and return scopes', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: 'key-1',
        tenantId: testTenantId,
        scopes: ['orders'],
        expiresAt: null,
      });

      const result = await service.validateApiKey('tab_validkeyvalue');

      expect(result).toEqual({ valid: true, tenantId: testTenantId, scopes: ['orders'] });
      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'key-1' },
          data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('remove and rotate', () => {
    it('should soft-delete and deactivate the key', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1', keyPrefix: 'tab_abc' });

      await service.remove('key-1', testTenantId, testUserId);

      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'key-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date), isActive: false }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'API_KEY_DELETED' }),
      );
    });

    it('should throw NotFoundException for an unknown key', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(service.remove('missing', testTenantId, testUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should rotate the hash and return the new raw key', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1', keyPrefix: 'tab_old' });

      const result = await service.rotate('key-1', testTenantId, testUserId);

      expect(result.key).toBeDefined();
      expect(result.key.startsWith('tab_')).toBe(true);
      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ keyHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'API_KEY_ROTATED' }),
      );
    });
  });
});
