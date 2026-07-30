import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('softDeleteWhere', () => {
    it('should add deletedAt: null to empty where clause', () => {
      const result = service.softDeleteWhere();
      expect(result).toEqual({ deletedAt: null });
    });

    it('should add deletedAt: null to existing where clause', () => {
      const result = service.softDeleteWhere({ tenantId: 'tenant-1' });
      expect(result).toEqual({ tenantId: 'tenant-1', deletedAt: null });
    });

    it('should not overwrite existing deletedAt filter', () => {
      const result = service.softDeleteWhere({ deletedAt: { not: null } });
      expect(result).toEqual({ deletedAt: { not: null } });
    });
  });
});
