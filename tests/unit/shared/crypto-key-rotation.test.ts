process.env.ENCRYPTION_KEY = 'a'.repeat(64);

import { encrypt, decrypt, CURRENT_KEY_VERSION } from '../../../src/shared/crypto';

describe('crypto key rotation', () => {
  describe('CURRENT_KEY_VERSION', () => {
    it('is set to 1', () => {
      expect(CURRENT_KEY_VERSION).toBe(1);
    });
  });

  describe('encrypt()', () => {
    it('prefixes output with v1:', () => {
      const result = encrypt('hello world');
      expect(result.startsWith('v1:')).toBe(true);
    });

    it('produces v1:iv:authTag:ciphertext format (4 parts)', () => {
      const result = encrypt('test data');
      const parts = result.split(':');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('v1');
    });

    it('produces different output for same plaintext (random IV)', () => {
      const a = encrypt('same text');
      const b = encrypt('same text');
      expect(a).not.toBe(b);
    });
  });

  describe('decrypt()', () => {
    it('decrypts v1-prefixed ciphertext', () => {
      const encrypted = encrypt('secret message');
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe('secret message');
    });

    it('decrypts legacy format without version prefix (backwards compat)', () => {
      // Manually create legacy format: iv:authTag:ciphertext (no v1 prefix)
      const encrypted = encrypt('legacy test');
      // Strip the v1: prefix to simulate legacy data
      const legacyFormat = encrypted.replace(/^v1:/, '');
      const parts = legacyFormat.split(':');
      expect(parts).toHaveLength(3); // iv:authTag:ciphertext
      const decrypted = decrypt(legacyFormat);
      expect(decrypted).toBe('legacy test');
    });

    it('throws on unsupported version', () => {
      const encrypted = encrypt('test');
      const badVersion = encrypted.replace(/^v1:/, 'v99:');
      expect(() => decrypt(badVersion)).toThrow('Unsupported encryption version: v99');
    });

    it('throws on invalid format (wrong number of parts)', () => {
      expect(() => decrypt('only:two')).toThrow('Invalid encrypted text format');
    });

    it('roundtrips unicode content', () => {
      const text = 'Kato David \u2014 RIS supplier \ud83c\uddfa\ud83c\uddec';
      expect(decrypt(encrypt(text))).toBe(text);
    });

    it('roundtrips empty string', () => {
      expect(decrypt(encrypt(''))).toBe('');
    });
  });
});
