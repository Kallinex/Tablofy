import { registerAs } from '@nestjs/config';
import { join } from 'node:path';

export interface UploadConfig {
  /** Absolute directory on disk where uploaded product images are stored. */
  directory: string;
  /**
   * Public base URL prepended to stored image paths. Empty means the API serves
   * the files itself and returns a root-relative URL (e.g. `/uploads/...`).
   */
  publicBaseUrl: string;
  /** Maximum accepted image size in bytes. */
  maxImageSizeBytes: number;
}

export const DEFAULT_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

function positiveInt(value: string | undefined, fallback: number): number {
  const raw = value?.trim() ?? '';
  // Require the whole string to be numeric. parseInt('10.5.6') is 10, which is a
  // valid positive int and would silently become a 10-byte limit that rejects
  // every real upload.
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default registerAs(
  'upload',
  (): UploadConfig => ({
    directory: process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'),
    publicBaseUrl: (process.env.UPLOAD_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    maxImageSizeBytes: positiveInt(
      process.env.UPLOAD_MAX_IMAGE_SIZE_BYTES,
      DEFAULT_MAX_IMAGE_SIZE_BYTES,
    ),
  }),
);
