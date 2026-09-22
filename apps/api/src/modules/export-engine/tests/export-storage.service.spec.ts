import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExportStorageService } from '../export-storage.service';

describe('ExportStorageService', () => {
  let storage: ExportStorageService;
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'export-storage-'));
    const config = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key === 'EXPORT_DIR' ? tempRoot : defaultValue,
      ),
    } as unknown as ConfigService;
    storage = new ExportStorageService(config);
  });

  afterEach(async () => {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  });

  describe('writeExport', () => {
    it('creates a real deterministic file inside the per-tenant root', async () => {
      const buffer = Buffer.from('id,status\r\n1,PAID\r\n');
      const result = await storage.writeExport('tenant-a', 'exp-123', 'csv', buffer);

      expect(result.relativePath).toBe('tenant-a/exp-123.csv');
      expect(path.isAbsolute(result.relativePath)).toBe(false);
      expect(result.fileSize).toBe(buffer.length);
      expect(result.fileSize).toBeGreaterThan(0);

      const absolute = path.join(tempRoot, 'tenant-a', 'exp-123.csv');
      expect(result.absolutePath).toBe(absolute);
      const onDisk = await fs.promises.readFile(absolute);
      expect(onDisk.toString()).toBe('id,status\r\n1,PAID\r\n');
      expect(onDisk.length).toBe(buffer.length);
    });

    it('rejects an empty export buffer (never persists an empty artifact)', async () => {
      await expect(
        storage.writeExport('tenant-a', 'exp-123', 'csv', Buffer.alloc(0)),
      ).rejects.toThrow(BadRequestException);
    });

    it('reprocess retry is idempotent: no duplicate final files and no temp litter', async () => {
      const buffer = Buffer.from('id\r\n1\r\n');
      await storage.writeExport('tenant-a', 'exp-123', 'csv', buffer);
      await storage.writeExport('tenant-a', 'exp-123', 'csv', buffer);

      const tenantDir = path.join(tempRoot, 'tenant-a');
      const entries = await fs.promises.readdir(tenantDir);
      expect(entries).toEqual(['exp-123.csv']);
      expect(entries.filter((e) => e.includes('.tmp-')).length).toBe(0);
    });

    it('does not allow the filename to escape the export root', async () => {
      await expect(
        storage.writeExport('../evil', 'exp-123', 'csv', Buffer.from('x')),
      ).rejects.toThrow(BadRequestException);
      await expect(
        storage.writeExport('tenant-a', '../escape', 'csv', Buffer.from('x')),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('readExport', () => {
    it('returns the exact bytes that were written', async () => {
      const buffer = Buffer.from('a,b\r\n1,2\r\n');
      await storage.writeExport('tenant-a', 'exp-123', 'csv', buffer);
      const read = await storage.readExport('tenant-a', 'tenant-a/exp-123.csv');
      expect(read.toString()).toBe('a,b\r\n1,2\r\n');
    });

    it('throws NotFoundException when the file is missing', async () => {
      await expect(storage.readExport('tenant-a', 'tenant-a/missing.csv')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects path traversal attempts', async () => {
      await expect(storage.readExport('tenant-a', '../secret.txt')).rejects.toThrow(
        BadRequestException,
      );
      await expect(storage.readExport('tenant-a', 'tenant-a/../../secret.txt')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects absolute path escape attempts', async () => {
      await expect(storage.readExport('tenant-a', '/etc/passwd')).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        storage.readExport('tenant-a', path.join(tempRoot, 'tenant-a', 'exp-123.csv')),
      ).rejects.toThrow(BadRequestException);
    });

    it('denies cross-tenant reads (tenant scope enforced)', async () => {
      await storage.writeExport('tenant-a', 'exp-123', 'csv', Buffer.from('x'));
      await expect(storage.readExport('tenant-b', 'tenant-a/exp-123.csv')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteExport', () => {
    it('removes the exact file that was written', async () => {
      await storage.writeExport('tenant-a', 'exp-123', 'csv', Buffer.from('a,b\r\n1,2\r\n'));

      await storage.deleteExport('tenant-a', 'tenant-a/exp-123.csv');

      await expect(
        fs.promises.stat(path.join(tempRoot, 'tenant-a', 'exp-123.csv')),
      ).rejects.toThrow('ENOENT');
    });

    it('is idempotent when the file is already gone', async () => {
      await expect(
        storage.deleteExport('tenant-a', 'tenant-a/missing.csv'),
      ).resolves.toBeUndefined();
    });

    it('rejects path traversal attempts', async () => {
      await expect(storage.deleteExport('tenant-a', '../secret.txt')).rejects.toThrow(
        BadRequestException,
      );
      await expect(storage.deleteExport('tenant-a', '/etc/passwd')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('denies cross-tenant deletion (tenant scope enforced)', async () => {
      await storage.writeExport('tenant-a', 'exp-123', 'csv', Buffer.from('x'));
      await expect(storage.deleteExport('tenant-b', 'tenant-a/exp-123.csv')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
