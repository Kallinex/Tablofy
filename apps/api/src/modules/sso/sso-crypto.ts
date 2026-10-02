import * as crypto from 'crypto';

const SSO_SECRET_SALT = 'sso-client-secret-salt';
const ALGORITHM = 'aes-256-gcm';

export function deriveSsoKey(encryptionKey: string): Buffer {
  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error('A strong SSO encryption key (min 32 characters) is required');
  }
  return crypto.scryptSync(encryptionKey, SSO_SECRET_SALT, 32);
}

export function encryptSsoSecret(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSsoSecret(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted SSO secret');
  }
  const [ivHex, tagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
