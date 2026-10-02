import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectImageType } from './image-signature';
import { UploadedImageFile } from './uploaded-image-file.interface';

export interface StoredImage {
  /** Publicly reachable URL for the stored image. */
  url: string;
  /** Storage key relative to the upload directory (e.g. `tenant/product/file.png`). */
  key: string;
}

/** Strips anything that could be used for path traversal from a path segment. */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

@Injectable()
export class ImageStorageService {
  constructor(private readonly configService: ConfigService) {}

  private get directory(): string {
    return this.configService.get<string>('upload.directory') ?? join(process.cwd(), 'uploads');
  }

  private get publicBaseUrl(): string {
    return (this.configService.get<string>('upload.publicBaseUrl') ?? '').replace(/\/+$/, '');
  }

  /**
   * Persists an uploaded image to disk after validating its magic bytes.
   *
   * @throws BadRequestException when the buffer is not a supported image.
   */
  async save(
    file: Pick<UploadedImageFile, 'buffer'>,
    scope: { tenantId: string; productId: string },
  ): Promise<StoredImage> {
    const detected = detectImageType(file?.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Uploaded file is not a valid image (expected JPEG, PNG, WebP or GIF).',
      );
    }

    const tenantSegment = sanitizeSegment(scope.tenantId);
    const productSegment = sanitizeSegment(scope.productId);
    const fileName = `${randomUUID()}${detected.extension}`;
    const key = `${tenantSegment}/${productSegment}/${fileName}`;
    const targetDirectory = join(this.directory, tenantSegment, productSegment);

    await mkdir(targetDirectory, { recursive: true });
    await writeFile(join(targetDirectory, fileName), file.buffer);

    return { url: `${this.publicBaseUrl}/uploads/${key}`, key };
  }
}
