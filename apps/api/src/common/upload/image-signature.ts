/**
 * Magic-byte sniffing for uploaded images.
 *
 * The `mimetype` reported by a client is attacker-controlled, so a file that
 * claims to be a PNG could actually be an executable or an HTML document. The
 * only reliable check is the leading byte signature of the buffer itself.
 */

export interface DetectedImageType {
  /** Canonical MIME type derived from the signature. */
  mimeType: string;
  /** Canonical file extension, including the leading dot. */
  extension: string;
}

function startsWith(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

const SIGNATURES: ReadonlyArray<{
  type: DetectedImageType;
  matches: (buffer: Buffer) => boolean;
}> = [
  {
    type: { mimeType: 'image/jpeg', extension: '.jpg' },
    matches: (buffer) => startsWith(buffer, [0xff, 0xd8, 0xff]),
  },
  {
    type: { mimeType: 'image/png', extension: '.png' },
    matches: (buffer) => startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    type: { mimeType: 'image/gif', extension: '.gif' },
    matches: (buffer) => startsWith(buffer, [0x47, 0x49, 0x46, 0x38]) && buffer.length >= 6,
  },
  {
    type: { mimeType: 'image/webp', extension: '.webp' },
    matches: (buffer) =>
      startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8),
  },
];

export function detectImageType(buffer: Buffer | undefined | null): DetectedImageType | null {
  if (!buffer || buffer.length === 0) {
    return null;
  }
  const match = SIGNATURES.find((signature) => signature.matches(buffer));
  return match ? { ...match.type } : null;
}
