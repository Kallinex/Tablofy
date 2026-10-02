import { BadRequestException } from '@nestjs/common';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import { extname } from 'node:path';

export const DEFAULT_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const EXTENSIONS_BY_MIME: Record<AllowedImageMimeType, readonly string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
};

export function isAllowedImageMimeType(value: string): value is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Builds the Multer options used for product-image uploads.
 *
 * Multer keeps files in memory when no storage engine is configured; the
 * controller then validates the true file type (magic bytes) before persisting.
 * `limits.fileSize` is enforced by Multer itself so an oversized body is
 * rejected before it can exhaust the process heap.
 */
export function buildImageUploadOptions(
  maxFileSizeBytes: number = DEFAULT_MAX_IMAGE_SIZE_BYTES,
): MulterModuleOptions {
  return {
    limits: { fileSize: maxFileSizeBytes, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (!isAllowedImageMimeType(file.mimetype)) {
        callback(
          new BadRequestException(
            `Unsupported image type "${file.mimetype}". Allowed types: ${ALLOWED_IMAGE_MIME_TYPES.join(
              ', ',
            )}.`,
          ),
          false,
        );
        return;
      }

      const extension = extname(file.originalname).toLowerCase();
      if (!EXTENSIONS_BY_MIME[file.mimetype].includes(extension)) {
        callback(
          new BadRequestException(
            `File extension "${extension || '(none)'}" does not match the declared image type "${
              file.mimetype
            }".`,
          ),
          false,
        );
        return;
      }

      callback(null, true);
    },
  };
}
