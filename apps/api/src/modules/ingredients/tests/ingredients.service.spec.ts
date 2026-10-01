import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { IngredientsService } from '../ingredients.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreateIngredientDto, UpdateIngredientDto } from '../dto/ingredient.dto';

const userId = 'user-1';
const asDto = <T>(value: Record<string, unknown>) => value as unknown as T;

describe('IngredientsService', () => {
  let service: IngredientsService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngredientsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
      ],
    }).compile();

    service = module.get<IngredientsService>(IngredientsService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
  });

  const ingredient = {
    id: 'i-1',
    tenantId: testTenantId,
    name: 'Flour',
    unit: 'kg',
    costPerUnit: 2,
    isActive: true,
    deletedAt: null,
  };

  describe('create', () => {
    it('rejects a duplicate name inside the tenant', async () => {
      prisma.ingredient.findFirst.mockResolvedValue(ingredient);
      await expect(
        service.create(
          asDto<CreateIngredientDto>({ name: 'Flour', unit: 'kg', costPerUnit: 2 }),
          testTenantId,
          userId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.ingredient.findFirst.mock.calls[0][0].where).toMatchObject({
        tenantId: testTenantId,
        name: 'Flour',
      });
    });

    it('defaults isActive to true and logs', async () => {
      prisma.ingredient.findFirst.mockResolvedValue(null);
      prisma.ingredient.create.mockResolvedValue(ingredient);

      await service.create(
        asDto<CreateIngredientDto>({ name: 'Flour', unit: 'kg', costPerUnit: 2 }),
        testTenantId,
        userId,
      );

      expect(prisma.ingredient.create.mock.calls[0][0].data.isActive).toBe(true);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INGREDIENT_CREATED' }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes by tenant with search', async () => {
      prisma.ingredient.findMany.mockResolvedValue([ingredient]);
      prisma.ingredient.count.mockResolvedValue(1);

      await service.findAll({ tenantId: testTenantId, search: 'fl', isActive: true });

      const where = prisma.ingredient.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ tenantId: testTenantId, isActive: true, deletedAt: null });
      expect(where.OR).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('throws when not found', async () => {
      prisma.ingredient.findFirst.mockResolvedValue(null);
      await expect(service.findOne('i-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects a duplicated name', async () => {
      prisma.ingredient.findFirst
        .mockResolvedValueOnce(ingredient)
        .mockResolvedValueOnce({ id: 'i-2' });
      await expect(
        service.update('i-1', asDto<UpdateIngredientDto>({ name: 'Sugar' }), testTenantId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('writes only provided fields', async () => {
      prisma.ingredient.findFirst.mockResolvedValue(ingredient);
      prisma.ingredient.update.mockResolvedValue(ingredient);

      await service.update(
        'i-1',
        asDto<UpdateIngredientDto>({ stockLevel: 10 }),
        testTenantId,
        userId,
      );

      expect(prisma.ingredient.update.mock.calls[0][0].data).toEqual({ stockLevel: 10 });
    });
  });

  describe('softDelete / restore', () => {
    it('soft-deletes and deactivates', async () => {
      prisma.ingredient.findFirst.mockResolvedValue(ingredient);
      prisma.ingredient.update.mockResolvedValue({});

      await service.softDelete('i-1', testTenantId, userId);

      const data = prisma.ingredient.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.isActive).toBe(false);
    });

    it('restores a deleted ingredient', async () => {
      prisma.ingredient.findFirst.mockResolvedValue({ ...ingredient, deletedAt: new Date() });
      prisma.ingredient.update.mockResolvedValue(ingredient);

      await service.restore('i-1', testTenantId, userId);

      expect(prisma.ingredient.update.mock.calls[0][0].data).toEqual({
        deletedAt: null,
        isActive: true,
      });
    });

    it('throws restoring a non-deleted ingredient', async () => {
      prisma.ingredient.findFirst.mockResolvedValue(null);
      await expect(service.restore('i-1', testTenantId, userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
