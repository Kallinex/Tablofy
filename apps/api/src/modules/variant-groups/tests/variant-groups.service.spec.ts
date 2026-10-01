import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { VariantGroupsService } from '../variant-groups.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateVariantGroupDto } from '../dto/create-variant-group.dto';
import { UpdateVariantGroupDto } from '../dto/update-variant-group.dto';

const userId = 'user-1';
const restaurantId = 'r-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('VariantGroupsService', () => {
  let service: VariantGroupsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VariantGroupsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<VariantGroupsService>(VariantGroupsService);
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
    id: 'vg-1',
    tenantId: testTenantId,
    restaurantId,
    name: 'Size',
    type: 'SINGLE',
    sortOrder: 0,
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the restaurant to belong to the tenant', async () => {
      prisma.restaurant.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateVariantGroupDto>({ name: 'Size' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a duplicate name', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.variantGroup.findFirst.mockResolvedValue(group);
      await expect(
        service.create(
          asDto<CreateVariantGroupDto>({ name: 'Size' }),
          restaurantId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('applies defaults and emits', async () => {
      prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId });
      prisma.variantGroup.findFirst.mockResolvedValue(null);
      prisma.variantGroup.create.mockResolvedValue({ ...group, id: 'vg-9' });

      await service.create(
        asDto<CreateVariantGroupDto>({ name: 'Size' }),
        restaurantId,
        testTenantId,
        userId,
      );

      const data = prisma.variantGroup.create.mock.calls[0][0].data;
      expect(data.type).toBe('SINGLE');
      expect(data.sortOrder).toBe(0);
      expect(events.emit).toHaveBeenCalledWith(
        'variantGroup.created',
        expect.objectContaining({ variantGroupId: 'vg-9' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant and restaurant with search', async () => {
      prisma.variantGroup.findMany.mockResolvedValue([group]);
      prisma.variantGroup.count.mockResolvedValue(1);

      await service.findAll({ tenantId: testTenantId, restaurantId, search: 'si', isActive: true });

      const where = prisma.variantGroup.findMany.mock.calls[0][0].where;
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
      prisma.variantGroup.findFirst.mockResolvedValue(null);
      await expect(service.findOne('vg-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects a duplicated name', async () => {
      prisma.variantGroup.findFirst
        .mockResolvedValueOnce(group)
        .mockResolvedValueOnce({ id: 'vg-2' });
      await expect(
        service.update(
          'vg-1',
          asDto<UpdateVariantGroupDto>({ name: 'Color' }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('writes only provided fields', async () => {
      prisma.variantGroup.findFirst.mockResolvedValue(group);
      prisma.variantGroup.update.mockResolvedValue(group);

      await service.update(
        'vg-1',
        asDto<UpdateVariantGroupDto>({ type: 'MULTIPLE' }),
        testTenantId,
        userId,
      );

      expect(prisma.variantGroup.update.mock.calls[0][0].data).toEqual({ type: 'MULTIPLE' });
    });
  });

  describe('softDelete / restore', () => {
    it('refuses deletion while variants exist', async () => {
      prisma.variantGroup.findFirst.mockResolvedValue(group);
      prisma.productVariant.count.mockResolvedValue(1);
      await expect(service.softDelete('vg-1', testTenantId, userId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('soft-deletes when empty', async () => {
      prisma.variantGroup.findFirst.mockResolvedValue(group);
      prisma.productVariant.count.mockResolvedValue(0);
      prisma.variantGroup.update.mockResolvedValue({});

      await service.softDelete('vg-1', testTenantId, userId);

      const data = prisma.variantGroup.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
    });

    it('restores a deleted group', async () => {
      prisma.variantGroup.findFirst.mockResolvedValue({ ...group, deletedAt: new Date() });
      prisma.variantGroup.update.mockResolvedValue(group);

      await service.restore('vg-1', testTenantId, userId);

      expect(prisma.variantGroup.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws restoring a non-deleted group', async () => {
      prisma.variantGroup.findFirst.mockResolvedValue(null);
      await expect(service.restore('vg-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
