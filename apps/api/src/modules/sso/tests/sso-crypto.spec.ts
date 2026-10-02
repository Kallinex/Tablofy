import { deriveSsoKey, encryptSsoSecret, decryptSsoSecret } from '../sso-crypto';

describe('sso-crypto', () => {
  const key = deriveSsoKey('k'.repeat(32));

  it('rejects weak encryption keys', () => {
    expect(() => deriveSsoKey('')).toThrow(/32 characters/);
    expect(() => deriveSsoKey('short')).toThrow(/32 characters/);
  });

  it('round-trips a client secret', () => {
    const secret = 'super-secret-client-value';
    const ciphertext = encryptSsoSecret(secret, key);

    expect(ciphertext).not.toContain(secret);
    expect(ciphertext.split(':')).toHaveLength(3);
    expect(decryptSsoSecret(ciphertext, key)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const first = encryptSsoSecret('same', key);
    const second = encryptSsoSecret('same', key);
    expect(first).not.toBe(second);
  });

  it('rejects a ciphertext encrypted with a different key', () => {
    const ciphertext = encryptSsoSecret('secret', key);
    const otherKey = deriveSsoKey('x'.repeat(32));
    expect(() => decryptSsoSecret(ciphertext, otherKey)).toThrow();
  });

  it('rejects malformed ciphertext', () => {
    expect(() => decryptSsoSecret('not-a-valid-payload', key)).toThrow(/Malformed/);
  });
});
