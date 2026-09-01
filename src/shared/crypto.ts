import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Current encryption key version. Bump when rotating keys. */
export const CURRENT_KEY_VERSION = 1;

/**
 * Retrieve the AES-256 encryption key from environment.
 * Key must be exactly 64 hex characters (256 bits).
 */
function getKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (keyHex === undefined || keyHex === '' || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be set and be exactly 64 hex characters (256 bits)');
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns a versioned string: v1:iv:authTag:ciphertext (all hex-encoded).
 * The version prefix enables future key rotation by adding v2 support.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `v${CURRENT_KEY_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string previously encrypted with encrypt().
 * Supports versioned format (v1:iv:authTag:ciphertext) and
 * legacy unversioned format (iv:authTag:ciphertext) for backwards compatibility.
 */
export function decrypt(encryptedText: string): string {
  const { key, iv, authTag, ciphertext } = parseEncryptedText(encryptedText);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Parse encrypted text, detecting version prefix.
 * v1 and legacy (no prefix) both use ENCRYPTION_KEY.
 */
function parseEncryptedText(text: string): {
  key: Buffer;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: string;
} {
  const parts = text.split(':');
  const hasVersionPrefix = parts[0].startsWith('v') && parts.length === 4;

  if (hasVersionPrefix) {
    return parseVersionedText(parts);
  }
  return parseLegacyText(parts);
}

/**
 * Parse versioned format: vN:iv:authTag:ciphertext
 */
function parseVersionedText(parts: string[]): {
  key: Buffer;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: string;
} {
  const version = parseInt(parts[0].slice(1), 10);

  if (version !== 1) {
    throw new Error(`Unsupported encryption version: v${String(version)}`);
  }

  const key = getKey();
  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');

  validateBuffers(iv, authTag);

  return { key, iv, authTag, ciphertext: parts[3] };
}

/**
 * Parse legacy format: iv:authTag:ciphertext (no version prefix).
 */
function parseLegacyText(parts: string[]): {
  key: Buffer;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: string;
} {
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const key = getKey();
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');

  validateBuffers(iv, authTag);

  return { key, iv, authTag, ciphertext: parts[2] };
}

/** Legacy IV length for backward compatibility with existing encrypted data. */
const LEGACY_IV_LENGTH = 16;

/**
 * Validate IV and auth tag buffer lengths.
 * Accepts both current (12-byte) and legacy (16-byte) IV lengths for backward compatibility.
 */
function validateBuffers(iv: Buffer, authTag: Buffer): void {
  if (iv.length !== IV_LENGTH && iv.length !== LEGACY_IV_LENGTH) {
    throw new Error('Invalid IV length');
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }
}

/**
 * Compute a SHA-256 hash of a buffer for document integrity verification.
 */
export function hashDocument(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
