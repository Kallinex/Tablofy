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

  describe('onModuleInit', () => {
    it('should connect successfully', async () => {
      jest.spyOn(service, '$connect').mockResolvedValueOnce(undefined);
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it('should throw if $connect fails', async () => {
      jest.spyOn(service, '$connect').mockRejectedValueOnce(new Error('Connection refused'));
      await expect(service.onModuleInit()).rejects.toThrow('Connection refused');
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect successfully', async () => {
      jest.spyOn(service, '$disconnect').mockResolvedValueOnce(undefined);
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });

    it('should not throw if $disconnect fails', async () => {
      jest.spyOn(service, '$disconnect').mockRejectedValueOnce(new Error('Disconnect error'));
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});
