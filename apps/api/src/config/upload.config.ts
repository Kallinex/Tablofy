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
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
