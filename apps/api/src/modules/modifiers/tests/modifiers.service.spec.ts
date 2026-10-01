import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ModifiersService } from '../modifiers.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateModifierDto } from '../dto/create-modifier.dto';
import { UpdateModifierDto } from '../dto/update-modifier.dto';

const userId = 'user-1';
const modifierGroupId = 'mg-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('ModifiersService', () => {
  let service: ModifiersService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let events: MockEventEmitter;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModifiersService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<ModifiersService>(ModifiersService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    events = module.get(EventEmitter2) as unknown as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    events.reset();
  });

  const modifier = {
    id: 'm-1',
    tenantId: testTenantId,
    modifierGroupId,
    name: 'Extra cheese',
    price: 2,
    sortOrder: 0,
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('requires the group to belong to the tenant', async () => {
      prisma.modifierGroup.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          asDto<CreateModifierDto>({ name: 'Extra cheese', price: 2 }),
          modifierGroupId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.modifierGroup.findFirst.mock.calls[0][0].where).toMatchObject({
        id: modifierGroupId,
        tenantId: testTenantId,
      });
    });

    it('rejects a duplicate name in the group', async () => {
      prisma.modifierGroup.findFirst.mockResolvedValue({ id: modifierGroupId });
      prisma.modifier.findFirst.mockResolvedValue(modifier);
      await expect(
        service.create(
          asDto<CreateModifierDto>({ name: 'Extra cheese', price: 2 }),
          modifierGroupId,
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('applies defaults and emits', async () => {
      prisma.modifierGroup.findFirst.mockResolvedValue({ id: modifierGroupId });
      prisma.modifier.findFirst.mockResolvedValue(null);
      prisma.modifier.create.mockResolvedValue({ ...modifier, id: 'm-9' });

      await service.create(
        asDto<CreateModifierDto>({ name: 'Extra cheese', price: 2 }),
        modifierGroupId,
        testTenantId,
        userId,
      );

      expect(prisma.modifier.create.mock.calls[0][0].data.sortOrder).toBe(0);
      expect(events.emit).toHaveBeenCalledWith(
        'modifier.created',
        expect.objectContaining({ modifierId: 'm-9' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant and group', async () => {
      prisma.modifier.findMany.mockResolvedValue([modifier]);
      prisma.modifier.count.mockResolvedValue(1);

      await service.findAll({
        tenantId: testTenantId,
        modifierGroupId,
        search: 'che',
        isActive: true,
      });

      const where = prisma.modifier.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        tenantId: testTenantId,
        modifierGroupId,
        isActive: true,
        deletedAt: null,
      });
      expect(where.OR).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.modifier.findFirst.mockResolvedValue(null);
      await expect(service.findOne('m-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects a duplicated name in the group', async () => {
      prisma.modifier.findFirst
        .mockResolvedValueOnce(modifier)
        .mockResolvedValueOnce({ id: 'm-2' });
      await expect(
        service.update('m-1', asDto<UpdateModifierDto>({ name: 'Bacon' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('writes only provided fields', async () => {
      prisma.modifier.findFirst.mockResolvedValue(modifier);
      prisma.modifier.update.mockResolvedValue(modifier);

      await service.update('m-1', asDto<UpdateModifierDto>({ price: 3 }), testTenantId, userId);

      expect(prisma.modifier.update.mock.calls[0][0].data).toEqual({ price: 3 });
    });
  });

  describe('softDelete / restore', () => {
    it('soft-deletes and emits', async () => {
      prisma.modifier.findFirst.mockResolvedValue(modifier);
      prisma.modifier.update.mockResolvedValue({});

      await service.softDelete('m-1', testTenantId, userId);

      const data = prisma.modifier.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
    });

    it('restores a deleted modifier', async () => {
      prisma.modifier.findFirst.mockResolvedValue({ ...modifier, deletedAt: new Date() });
      prisma.modifier.update.mockResolvedValue(modifier);

      await service.restore('m-1', testTenantId, userId);

      expect(prisma.modifier.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws restoring a non-deleted modifier', async () => {
      prisma.modifier.findFirst.mockResolvedValue(null);
      await expect(service.restore('m-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
