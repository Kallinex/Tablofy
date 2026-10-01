import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BranchSettingsService } from '../branch-settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { UpdateBranchSettingsDto } from '../dto/update-branch-settings.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const branchId = 'br-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('BranchSettingsService', () => {
  let service: BranchSettingsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchSettingsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<BranchSettingsService>(BranchSettingsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
  });

  const branch = {
    id: branchId,
    tenantId: testTenantId,
    restaurantId,
    metadata: { tax: { rate: 14 } },
  };

  describe('getSettings', () => {
    it('scopes by tenant, restaurant and branch', async () => {
      prisma.branch.findFirst.mockResolvedValue(branch);

      const result = await service.getSettings(restaurantId, branchId, testTenantId);

      expect(prisma.branch.findFirst.mock.calls[0][0].where).toEqual({
        id: branchId,
        restaurantId,
        tenantId: testTenantId,
        deletedAt: null,
      });
      expect(result).toBe(branch);
    });

    it('throws when the branch is missing', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);
      await expect(
        service.getSettings(restaurantId, branchId, testTenantId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateSettings', () => {
    it('throws when the branch is missing', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);
      await expect(
        service.updateSettings(
          restaurantId,
          branchId,
          asDto<UpdateBranchSettingsDto>({}),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('merges settings into existing metadata and logs old/new', async () => {
      prisma.branch.findFirst.mockResolvedValue(branch);
      prisma.branch.update.mockResolvedValue({ ...branch, metadata: {} });

      await service.updateSettings(
        restaurantId,
        branchId,
        asDto<UpdateBranchSettingsDto>({ orders: { autoAccept: true } }),
        testTenantId,
        userId,
      );

      const data = prisma.branch.update.mock.calls[0][0].data;
      expect(data.metadata).toEqual({
        tax: { rate: 14 },
        orders: { autoAccept: true },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BRANCH_SETTINGS_UPDATED',
          oldValues: { metadata: { tax: { rate: 14 } } },
          newValues: { metadata: { tax: { rate: 14 }, orders: { autoAccept: true } } },
        }),
      );
    });
  });
});
