import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ImageStorageService } from '../image-storage.service';

const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

describe('ImageStorageService', () => {
  let directory: string;
  let service: ImageStorageService;

  const build = (publicBaseUrl: string) =>
    new ImageStorageService({
      get: jest.fn((key: string) => {
        if (key === 'upload.directory') return directory;
        if (key === 'upload.publicBaseUrl') return publicBaseUrl;
        return undefined;
      }),
    } as unknown as ConfigService);

  beforeEach(() => {
    directory = join(tmpdir(), `tablofy-upload-${randomUUID()}`);
    service = build('https://cdn.test/');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes a valid image under tenant/product and returns its public URL', async () => {
    const stored = await service.save(
      { buffer: pngBuffer },
      { tenantId: 'tenant-1', productId: 'prod-1' },
    );

    expect(stored.key).toMatch(/^tenant-1\/prod-1\/[0-9a-f-]+\.png$/);
    expect(stored.url).toBe(`https://cdn.test/uploads/${stored.key}`);
    const onDisk = await readFile(join(directory, stored.key));
    expect(onDisk.equals(pngBuffer)).toBe(true);
  });

  it('returns a root-relative URL when no public base URL is configured', async () => {
    const relative = build('');

    const stored = await relative.save({ buffer: pngBuffer }, { tenantId: 't', productId: 'p' });

    expect(stored.url).toBe(`/uploads/${stored.key}`);
  });

  it('rejects a buffer that is not a real image', async () => {
    await expect(
      service.save({ buffer: Buffer.from('not an image') }, { tenantId: 't', productId: 'p' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(existsSync(directory)).toBe(false);
  });

  it('sanitises tenant and product segments to prevent path traversal', async () => {
    const stored = await service.save(
      { buffer: pngBuffer },
      { tenantId: '../evil', productId: '..\\etc' },
    );

    const [tenantSegment, productSegment] = stored.key.split('/');
    expect(tenantSegment).toBe('___evil');
    expect(productSegment).toBe('___etc');
    expect(existsSync(join(directory, tenantSegment, productSegment))).toBe(true);
  });
});
