process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

import { hashDocument } from '../../../src/shared/crypto';

describe('hashDocument', () => {
  it('should produce deterministic output for the same buffer', () => {
    const buffer = Buffer.from('test document content');
    const hash1 = hashDocument(buffer);
    const hash2 = hashDocument(buffer);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', () => {
    const buffer1 = Buffer.from('document A');
    const buffer2 = Buffer.from('document B');
    const hash1 = hashDocument(buffer1);
    const hash2 = hashDocument(buffer2);
    expect(hash1).not.toBe(hash2);
  });

  it('should handle an empty buffer without throwing', () => {
    const buffer = Buffer.alloc(0);
    const hash = hashDocument(buffer);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should handle a large 1MB buffer', () => {
    const buffer = Buffer.alloc(1024 * 1024);
    const hash = hashDocument(buffer);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should return exactly 64 hex characters (SHA-256 format)', () => {
    const buffer = Buffer.from('sha256 format check');
    const hash = hashDocument(buffer);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should match the known SHA-256 hash for "hello"', () => {
    const buffer = Buffer.from('hello');
    const hash = hashDocument(buffer);
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('should return a 64-char hex string for string content', () => {
    const buffer = Buffer.from('RIS Platform document');
    const hash = hashDocument(buffer);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
