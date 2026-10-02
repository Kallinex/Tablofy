import { BadRequestException } from '@nestjs/common';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  buildImageUploadOptions,
  isAllowedImageMimeType,
} from '../image-upload.options';

interface FakeFile {
  originalname: string;
  mimetype: string;
}

function runFilter(file: FakeFile) {
  const options = buildImageUploadOptions(2048);
  const callback = jest.fn();
  options.fileFilter?.({} as never, file as never, callback);
  return callback;
}

describe('buildImageUploadOptions', () => {
  it('enforces a single file and the configured size limit', () => {
    expect(buildImageUploadOptions(2048).limits).toEqual({ fileSize: 2048, files: 1 });
  });

  it('accepts an allowed MIME type whose extension matches', () => {
    const callback = runFilter({ originalname: 'photo.PNG', mimetype: 'image/png' });

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('rejects a MIME type outside the allowlist', () => {
    const callback = runFilter({ originalname: 'payload.svg', mimetype: 'image/svg+xml' });

    expect(callback.mock.calls[0][0]).toBeInstanceOf(BadRequestException);
    expect(callback.mock.calls[0][1]).toBe(false);
  });

  it('rejects an extension that does not match the declared type', () => {
    const callback = runFilter({ originalname: 'photo.exe', mimetype: 'image/png' });

    expect(callback.mock.calls[0][0]).toBeInstanceOf(BadRequestException);
    expect(callback.mock.calls[0][1]).toBe(false);
  });

  it('rejects a file with no extension', () => {
    const callback = runFilter({ originalname: 'photo', mimetype: 'image/jpeg' });

    expect(callback.mock.calls[0][0]).toBeInstanceOf(BadRequestException);
    expect(callback.mock.calls[0][1]).toBe(false);
  });
});

describe('isAllowedImageMimeType', () => {
  it('recognises every allowed type', () => {
    for (const mime of ALLOWED_IMAGE_MIME_TYPES) {
      expect(isAllowedImageMimeType(mime)).toBe(true);
    }
  });

  it('rejects unknown and non-image types', () => {
    expect(isAllowedImageMimeType('application/pdf')).toBe(false);
    expect(isAllowedImageMimeType('image/bmp')).toBe(false);
  });
});
