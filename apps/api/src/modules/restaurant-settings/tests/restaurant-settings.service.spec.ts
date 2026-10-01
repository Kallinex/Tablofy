import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RestaurantSettingsService } from '../restaurant-settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { UpdateRestaurantSettingsDto } from '../dto/update-restaurant-settings.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('RestaurantSettingsService', () => {
  let service: RestaurantSettingsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantSettingsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<RestaurantSettingsService>(RestaurantSettingsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
  });

  const restaurant = {
    id: restaurantId,
    tenantId: testTenantId,
    metadata: { receipt: { footer: 'Thanks' } },
  };

  describe('getSettings', () => {
    it('scopes by tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(restaurant);

      const result = await service.getSettings(restaurantId, testTenantId);

      expect(prisma.restaurant.findFirst.mock.calls[0][0].where).toEqual({
        id: restaurantId,
        tenantId: testTenantId,
        deletedAt: null,
      });
      expect(result).toBe(restaurant);
    });

    it('throws when the restaurant is missing', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(service.getSettings(restaurantId, testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateSettings', () => {
    it('throws when the restaurant is missing', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(
        service.updateSettings(
          restaurantId,
          asDto<UpdateRestaurantSettingsDto>({}),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('merges settings into existing metadata and logs old/new', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(restaurant);
      prisma.restaurant.update.mockResolvedValue({ ...restaurant, metadata: {} });

      await service.updateSettings(
        restaurantId,
        asDto<UpdateRestaurantSettingsDto>({ notifications: { email: true } }),
        testTenantId,
        userId,
      );

      const data = prisma.restaurant.update.mock.calls[0][0].data;
      expect(data.metadata).toEqual({
        receipt: { footer: 'Thanks' },
        notifications: { email: true },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESTAURANT_SETTINGS_UPDATED' }),
      );
    });

    it('starts from an empty object when metadata is null', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ ...restaurant, metadata: null });
      prisma.restaurant.update.mockResolvedValue({ ...restaurant, metadata: {} });

      await service.updateSettings(
        restaurantId,
        asDto<UpdateRestaurantSettingsDto>({ custom: { foo: 'bar' } }),
        testTenantId,
        userId,
      );

      expect(prisma.restaurant.update.mock.calls[0][0].data.metadata).toEqual({
        custom: { foo: 'bar' },
      });
    });
  });
});
