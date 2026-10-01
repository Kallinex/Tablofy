import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ModifierGroupsService } from '../modifier-groups.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateModifierGroupDto } from '../dto/create-modifier-group.dto';
import { UpdateModifierGroupDto } from '../dto/update-modifier-group.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('ModifierGroupsService', () => {
  let service: ModifierGroupsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModifierGroupsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<ModifierGroupsService>(ModifierGroupsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
  });

  const group = {
    id: 'mg-1',
    tenantId: testTenantId,
    restaurantId,
    name: 'Extras',
    minSelection: 0,
    isRequired: false,
    sortOrder: 0,
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the restaurant to belong to the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateModifierGroupDto>({ name: 'Extras' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a duplicate name', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.modifierGroup.findFirst.mockResolvedValue(group);
      await expect(
        service.create(
          asDto<CreateModifierGroupDto>({ name: 'Extras' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('applies defaults and emits', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.modifierGroup.findFirst.mockResolvedValue(null);
      prisma.modifierGroup.create.mockResolvedValue({ ...group, id: 'mg-9' });

      await service.create(
        asDto<CreateModifierGroupDto>({ name: 'Extras' }),
        restaurantId,
        testTenantId,
        userId,
      );

      const data = prisma.modifierGroup.create.mock.calls[0][0].data;
      expect(data.minSelection).toBe(0);
      expect(data.isRequired).toBe(false);
      expect(data.sortOrder).toBe(0);
      expect(events.emit).toHaveBeenCalledWith(
        'modifierGroup.created',
        expect.objectContaining({ modifierGroupId: 'mg-9' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant and restaurant with search', async () => {
      prisma.modifierGroup.findMany.mockResolvedValue([group]);
      prisma.modifierGroup.count.mockResolvedValue(1);

      await service.findAll({ tenantId: testTenantId, restaurantId, search: 'ex', isActive: true });

      const where = prisma.modifierGroup.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: testTenantId,
        restaurantId,
        isActive: true,
        deletedAt: null,
      });
      expect(where.OR).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.modifierGroup.findFirst.mockResolvedValue(null);
      await expect(service.findOne('mg-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects a duplicated name', async () => {
      prisma.modifierGroup.findFirst
        .mockResolvedValueOnce(group)
        .mockResolvedValueOnce({ id: 'mg-2' });
      await expect(
        service.update(
          'mg-1',
          asDto<UpdateModifierGroupDto>({ name: 'Sauces' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('writes only provided fields', async () => {
      prisma.modifierGroup.findFirst.mockResolvedValue(group);
      prisma.modifierGroup.update.mockResolvedValue(group);

      await service.update(
        'mg-1',
        asDto<UpdateModifierGroupDto>({ maxSelection: 5 }),
        testTenantId,
        userId,
      );

      expect(prisma.modifierGroup.update.mock.calls[0][0].data).toEqual({ maxSelection: 5 });
    });
  });

  describe('softDelete / restore', () => {
    it('refuses deletion while modifiers exist', async () => {
      prisma.modifierGroup.findFirst.mockResolvedValue(group);
      prisma.modifier.count.mockResolvedValue(1);
      await expect(service.softDelete('mg-1', testTenantId, userId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('soft-deletes when empty', async () => {
      prisma.modifierGroup.findFirst.mockResolvedValue(group);
      prisma.modifier.count.mockResolvedValue(0);
      prisma.modifierGroup.update.mockResolvedValue({});

      await service.softDelete('mg-1', testTenantId, userId);

      const data = prisma.modifierGroup.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
    });

    it('restores a deleted group', async () => {
      prisma.modifierGroup.findFirst.mockResolvedValue({ ...group, deletedAt: new Date() });
      prisma.modifierGroup.update.mockResolvedValue(group);

      await service.restore('mg-1', testTenantId, userId);

      expect(prisma.modifierGroup.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws restoring a non-deleted group', async () => {
      prisma.modifierGroup.findFirst.mockResolvedValue(null);
      await expect(service.restore('mg-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
