import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExportStorageService } from '../export-storage.service';

describe('ExportStorageService startup and stale temp cleanup', () => {
  let storage: ExportStorageService;
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = path.join(os.tmpdir(), `export-storage-init-${process.pid}-${Date.now()}`);
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

  describe('onModuleInit', () => {
    it('creates the configured export root', async () => {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });

      expect(await fs.promises.stat(tempRoot).catch(() => null)).toBeNull();

      storage.onModuleInit();

      expect((await fs.promises.stat(tempRoot)).isDirectory()).toBe(true);
    });

    it('is idempotent when the root already exists', async () => {
      storage.onModuleInit();
      storage.onModuleInit();

      expect((await fs.promises.stat(tempRoot)).isDirectory()).toBe(true);
    });

    it('resolves the root from the EXPORT_DIR setting', () => {
      expect(storage.getExportRoot()).toBe(tempRoot);
    });
  });

  describe('stale temp file cleanup', () => {
    it('removes leftovers from earlier attempts of the same export', async () => {
      const tenantDir = path.join(tempRoot, 'tenant-a');
      await fs.promises.mkdir(tenantDir, { recursive: true });
      await fs.promises.writeFile(path.join(tenantDir, 'exp-1.csv.tmp-111-aaa'), 'partial');
      await fs.promises.writeFile(path.join(tenantDir, 'exp-1.csv.tmp-222-bbb'), 'partial');

      await storage.writeExport('tenant-a', 'exp-1', 'csv', Buffer.from('id\r\n1\r\n'));

      expect(await fs.promises.readdir(tenantDir)).toEqual(['exp-1.csv']);
    });

    it('leaves other files in the tenant directory untouched', async () => {
      const tenantDir = path.join(tempRoot, 'tenant-a');
      await fs.promises.mkdir(tenantDir, { recursive: true });
      await fs.promises.writeFile(path.join(tenantDir, 'exp-1.csv.tmp-111-aaa'), 'partial');
      await fs.promises.writeFile(path.join(tenantDir, 'exp-2.csv'), 'id\r\n1\r\n');
      await fs.promises.writeFile(path.join(tenantDir, 'exp-3.csv.tmp-999'), 'partial');

      await storage.writeExport('tenant-a', 'exp-1', 'csv', Buffer.from('id\r\n2\r\n'));

      expect((await fs.promises.readdir(tenantDir)).sort()).toEqual([
        'exp-1.csv',
        'exp-2.csv',
        'exp-3.csv.tmp-999',
      ]);
    });

    it('does not fail the write when cleanup cannot read the tenant directory', async () => {
      const readdir = jest
        .spyOn(fs.promises, 'readdir')
        .mockRejectedValue(new Error('EACCES') as never);

      try {
        await expect(
          storage.writeExport('tenant-a', 'exp-1', 'csv', Buffer.from('id\r\n1\r\n')),
        ).resolves.toEqual(
          expect.objectContaining({ relativePath: 'tenant-a/exp-1.csv', fileSize: 7 }),
        );
      } finally {
        readdir.mockRestore();
      }
    });

    it('still fails the write when the artifact cannot be persisted', async () => {
      const readdir = jest
        .spyOn(fs.promises, 'readdir')
        .mockRejectedValue(new Error('EACCES') as never);
      const writeFile = jest
        .spyOn(fs.promises, 'writeFile')
        .mockRejectedValue(new Error('ENOSPC') as never);

      try {
        await expect(
          storage.writeExport('tenant-a', 'exp-1', 'csv', Buffer.from('id\r\n1\r\n')),
        ).rejects.toThrow('ENOSPC');
      } finally {
        readdir.mockRestore();
        writeFile.mockRestore();
      }
    });

    it('cleans up its own temp file when persisting fails', async () => {
      const tenantDir = path.join(tempRoot, 'tenant-a');
      await fs.promises.mkdir(tenantDir, { recursive: true });
      const rename = jest
        .spyOn(fs.promises, 'rename')
        .mockRejectedValue(new Error('EXDEV') as never);

      try {
        await expect(
          storage.writeExport('tenant-a', 'exp-1', 'csv', Buffer.from('id\r\n1\r\n')),
        ).rejects.toThrow('EXDEV');
      } finally {
        rename.mockRestore();
      }

      expect(await fs.promises.readdir(tenantDir)).toEqual([]);
    });
  });

  describe('safeUnlink', () => {
    it('tolerates a temp file that no longer exists', async () => {
      const rename = jest
        .spyOn(fs.promises, 'rename')
        .mockRejectedValue(new Error('EXDEV') as never);
      const unlink = jest
        .spyOn(fs.promises, 'unlink')
        .mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }) as never);

      try {
        await expect(
          storage.writeExport('tenant-a', 'exp-1', 'csv', Buffer.from('id\r\n1\r\n')),
        ).rejects.toThrow('EXDEV');
        expect(unlink).toHaveBeenCalledTimes(1);
        expect(unlink.mock.calls[0][0]).toMatch(/exp-1\.csv\.tmp-/);
      } finally {
        rename.mockRestore();
        unlink.mockRestore();
      }
    });

    it('survives an unlink failure that is not a missing file', async () => {
      const rename = jest
        .spyOn(fs.promises, 'rename')
        .mockRejectedValue(new Error('EXDEV') as never);
      const unlink = jest
        .spyOn(fs.promises, 'unlink')
        .mockRejectedValue(Object.assign(new Error('busy'), { code: 'EPERM' }) as never);

      try {
        await expect(
          storage.writeExport('tenant-a', 'exp-1', 'csv', Buffer.from('id\r\n1\r\n')),
        ).rejects.toThrow('EXDEV');
      } finally {
        rename.mockRestore();
        unlink.mockRestore();
      }
    });
  });

  describe('identifier validation', () => {
    it('rejects a tenant id containing a path separator', async () => {
      await expect(
        storage.writeExport('tenant/../other', 'exp-1', 'csv', Buffer.from('id\r\n')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an export id containing a path separator', async () => {
      await expect(
        storage.writeExport('tenant-a', '../../escape', 'csv', Buffer.from('id\r\n')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
