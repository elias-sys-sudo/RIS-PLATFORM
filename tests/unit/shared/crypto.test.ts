process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

import { encrypt, decrypt } from '../../../src/shared/crypto';

describe('encrypt / decrypt', () => {
  it('encrypt returns v1:iv:authTag:ciphertext format', () => {
    const result = encrypt('hello');
    const parts = result.split(':');
    expect(parts).toHaveLength(4);
    // Version prefix
    expect(parts[0]).toBe('v1');
    // IV = 12 bytes = 24 hex chars
    expect(parts[1]).toMatch(/^[0-9a-f]{24}$/);
    // authTag = 16 bytes = 32 hex chars
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/);
    // ciphertext is non-empty hex
    expect(parts[3]).toMatch(/^[0-9a-f]+$/);
  });

  it('roundtrips encrypt then decrypt', () => {
    const plaintext = 'RIS Platform secret data 🇺🇬';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('decrypt throws on invalid format (missing colons)', () => {
    expect(() => decrypt('no-colons-here')).toThrow('Invalid encrypted text format');
  });

  it('decrypt throws on invalid IV length', () => {
    // IV too short (4 hex = 2 bytes instead of 16 bytes)
    const badIv = 'aabb';
    const goodTag = 'a'.repeat(32);
    const ciphertext = 'ff';
    expect(() => decrypt(`${badIv}:${goodTag}:${ciphertext}`)).toThrow('Invalid IV length');
  });

  it('decrypt throws on invalid auth tag length', () => {
    const goodIv = 'a'.repeat(32); // 16 bytes
    const badTag = 'bb'; // 1 byte
    const ciphertext = 'ff';
    expect(() => decrypt(`${goodIv}:${badTag}:${ciphertext}`)).toThrow('Invalid auth tag length');
  });

  it('decrypt throws on tampered ciphertext', () => {
    const encrypted = encrypt('original text');
    const parts = encrypted.split(':');
    // Flip last hex char of ciphertext (parts[3] for v1 format)
    const lastChar = parts[3].slice(-1);
    const flipped = lastChar === '0' ? '1' : '0';
    parts[3] = parts[3].slice(0, -1) + flipped;
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('encrypt handles empty string', () => {
    const encrypted = encrypt('');
    expect(encrypted.split(':')).toHaveLength(4);
    expect(encrypted.startsWith('v1:')).toBe(true);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  it('encrypt handles long string (1000+ chars) and roundtrips', () => {
    const longStr = 'A'.repeat(1200);
    const encrypted = encrypt(longStr);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(longStr);
  });

  it('produces unique ciphertexts for same plaintext (random IV)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
    // But both decrypt to original
    expect(decrypt(a)).toBe('same');
    expect(decrypt(b)).toBe('same');
  });
});

describe('getKey validation', () => {
  it('throws when ENCRYPTION_KEY is missing', () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      // getKey is called inside encrypt, so calling encrypt triggers validation
      expect(() => encrypt('test')).toThrow(
        'ENCRYPTION_KEY must be set and be exactly 64 hex characters',
      );
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });

  it('throws when ENCRYPTION_KEY is empty string', () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = '';
    try {
      expect(() => encrypt('test')).toThrow(
        'ENCRYPTION_KEY must be set and be exactly 64 hex characters',
      );
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });

  it('throws when ENCRYPTION_KEY is wrong length', () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'tooshort';
    try {
      expect(() => encrypt('test')).toThrow(
        'ENCRYPTION_KEY must be set and be exactly 64 hex characters',
      );
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });
});
