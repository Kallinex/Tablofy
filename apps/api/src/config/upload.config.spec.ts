import 'reflect-metadata';
import { join } from 'node:path';
import uploadConfig, { DEFAULT_MAX_IMAGE_SIZE_BYTES } from './upload.config';

const UPLOAD_ENV_KEYS = [
  'UPLOAD_DIR',
  'UPLOAD_PUBLIC_BASE_URL',
  'UPLOAD_MAX_IMAGE_SIZE_BYTES',
] as const;

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key] as string;
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key] as string;
      }
    }
  }
}

const read = (extra: Record<string, string | undefined> = {}) => {
  let result!: ReturnType<typeof uploadConfig>;
  withEnv({ ...Object.fromEntries(UPLOAD_ENV_KEYS.map((k) => [k, undefined])), ...extra }, () => {
    result = uploadConfig();
  });
  return result;
};

describe('upload.config', () => {
  it('exports the documented 5 MiB default', () => {
    expect(DEFAULT_MAX_IMAGE_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  describe('directory', () => {
    it('defaults to <cwd>/uploads', () => {
      expect(read().directory).toBe(join(process.cwd(), 'uploads'));
    });

    it('uses UPLOAD_DIR when provided', () => {
      expect(read({ UPLOAD_DIR: '/srv/tablofy/uploads' }).directory).toBe('/srv/tablofy/uploads');
    });

    it('does not trim UPLOAD_DIR, so a deliberate path is preserved verbatim', () => {
      expect(read({ UPLOAD_DIR: '/srv/uploads ' }).directory).toBe('/srv/uploads ');
    });
  });

  describe('publicBaseUrl', () => {
    it('defaults to empty, meaning the API serves the files itself', () => {
      expect(read().publicBaseUrl).toBe('');
    });

    it('uses the configured base URL as-is', () => {
      expect(read({ UPLOAD_PUBLIC_BASE_URL: 'https://cdn.example.com' }).publicBaseUrl).toBe(
        'https://cdn.example.com',
      );
    });

    it('strips trailing slashes so paths are never doubled up', () => {
      const strip = (value: string) => read({ UPLOAD_PUBLIC_BASE_URL: value }).publicBaseUrl;

      expect(strip('https://cdn.example.com/')).toBe('https://cdn.example.com');
      expect(strip('https://cdn.example.com///')).toBe('https://cdn.example.com');
    });

    it('leaves a base URL without a trailing slash untouched', () => {
      expect(read({ UPLOAD_PUBLIC_BASE_URL: 'https://cdn.example.com/assets' }).publicBaseUrl).toBe(
        'https://cdn.example.com/assets',
      );
    });
  });

  describe('maxImageSizeBytes', () => {
    it('defaults to 5 MiB when unset', () => {
      expect(read().maxImageSizeBytes).toBe(DEFAULT_MAX_IMAGE_SIZE_BYTES);
    });

    it('accepts a positive override', () => {
      expect(read({ UPLOAD_MAX_IMAGE_SIZE_BYTES: '1048576' }).maxImageSizeBytes).toBe(1048576);
      expect(read({ UPLOAD_MAX_IMAGE_SIZE_BYTES: '1' }).maxImageSizeBytes).toBe(1);
    });

    it('falls back to the default for zero, negative and unparseable values', () => {
      // A zero or negative limit would reject every upload, so a bad value must
      // not silently disable image uploads in production.
      const fallback = ['0', '-1', '-2048', 'abc', '', ' '];

      for (const value of fallback) {
        expect(read({ UPLOAD_MAX_IMAGE_SIZE_BYTES: value }).maxImageSizeBytes).toBe(
          DEFAULT_MAX_IMAGE_SIZE_BYTES,
        );
      }
    });

    it('rejects a partially numeric value instead of parsing a prefix of it', () => {
      // parseInt('10.5.6') is 10, which is a valid positive int and would be
      // accepted as a 10-byte limit, rejecting every real upload. Requiring a
      // fully numeric string makes that fall back to the default instead.
      const parse = (value: string) =>
        read({ UPLOAD_MAX_IMAGE_SIZE_BYTES: value }).maxImageSizeBytes;

      expect(parse('10.5.6')).toBe(DEFAULT_MAX_IMAGE_SIZE_BYTES);
      expect(parse('1024abc')).toBe(DEFAULT_MAX_IMAGE_SIZE_BYTES);
      expect(parse('10,5')).toBe(DEFAULT_MAX_IMAGE_SIZE_BYTES);
    });
  });
});
