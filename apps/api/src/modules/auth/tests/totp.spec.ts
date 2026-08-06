import { generateTotpSecret, generateTotp, verifyTotp, generateOtpauthUrl } from '../totp';

describe('TOTP (RFC 6238)', () => {
  it('should generate a base32 secret of the expected length', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret).toHaveLength(32);
  });

  it('should verify the RFC 6238 SHA-1 test vector at T=59', () => {
    // base32 of the ASCII secret "12345678901234567890"
    const asciiSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(verifyTotp(asciiSecret, '94287082', 1, 59 * 1000, 30, 8)).toBe(true);
  });

  it('should generate the expected 8-digit code at T=59 for the RFC vector', () => {
    const asciiSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(generateTotp(asciiSecret, 59 * 1000, 30, 8)).toBe('94287082');
  });
  it('should produce a stable 6-digit code within the same time step', () => {
    const secret = generateTotpSecret();
    const t1 = generateTotp(secret);
    const t2 = generateTotp(secret, Date.now());
    expect(t1).toBe(t2);
    expect(t1).toMatch(/^\d{6}$/);
  });

  it('should accept a valid code', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('should reject an invalid code', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    const invalid = (parseInt(code, 10) + 1) % 1000000;
    expect(verifyTotp(secret, invalid.toString().padStart(6, '0'))).toBe(false);
  });

  it('should accept codes within the window (previous/next step)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const prev = generateTotp(secret, now - 30 * 1000);
    const next = generateTotp(secret, now + 30 * 1000);
    expect(verifyTotp(secret, prev, 1, now)).toBe(true);
    expect(verifyTotp(secret, next, 1, now)).toBe(true);
  });

  it('should reject codes outside the window', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const farPast = generateTotp(secret, now - 3 * 30 * 1000);
    expect(verifyTotp(secret, farPast, 1, now)).toBe(false);
  });

  it('should reject non-numeric or malformed tokens', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, 'abc123')).toBe(false);
    expect(verifyTotp(secret, '12345')).toBe(false);
    expect(verifyTotp(secret, '1234567')).toBe(false);
  });

  it('should build a valid otpauth URL', () => {
    const url = generateOtpauthUrl('SECRETBASE32', 'owner@test.com');
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('secret=SECRETBASE32');
    expect(url).toContain('issuer=Tablofy');
    expect(url).toContain('owner%40test.com');
    expect(url).toContain('algorithm=SHA1');
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
  });
});
