import { detectImageType } from '../image-signature';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const gif = Buffer.from('GIF89a', 'ascii');
const webp = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);

describe('detectImageType', () => {
  it.each([
    ['jpeg', jpeg, 'image/jpeg', '.jpg'],
    ['png', png, 'image/png', '.png'],
    ['gif', gif, 'image/gif', '.gif'],
    ['webp', webp, 'image/webp', '.webp'],
  ])('detects %s by its magic bytes', (_label, buffer, mimeType, extension) => {
    expect(detectImageType(buffer as Buffer)).toEqual({ mimeType, extension });
  });

  it('returns null for unsupported content', () => {
    expect(detectImageType(Buffer.from('<html></html>'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF8'))).toBeNull();
    expect(detectImageType(Buffer.from([0x52, 0x49, 0x46, 0x46]))).toBeNull();
  });

  it('returns null for empty or missing buffers', () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(undefined)).toBeNull();
    expect(detectImageType(null)).toBeNull();
  });
});
