/**
 * Jest setupFiles script — runs in the test worker context BEFORE any test
 * modules are imported. Sets environment variables for the test database and
 * all required config.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load base config from .env.local first
dotenv.config({ path: '.env.local' });

// Read the test database connection string written by global-setup
const TEMP_FILE = path.resolve(__dirname, '.test-db-meta');
if (fs.existsSync(TEMP_FILE)) {
  const meta = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf-8')) as {
    dbName: string;
    testConnStr: string;
  };
  process.env.DATABASE_URL = meta.testConnStr;
}

// --- Override / ensure required env vars for integration tests ---
process.env.NODE_ENV = 'test';

// Use port 4001 so integration-test servers never collide with the dev server (4000)
// or with each other when multiple test workers run simultaneously.
process.env.PORT = process.env.TEST_PORT ?? '4001';

// JWT — must be ≥64 hex chars
if (
  process.env.JWT_SECRET === undefined ||
  process.env.JWT_SECRET === '' ||
  process.env.JWT_SECRET.length < 64
) {
  process.env.JWT_SECRET = 'a]1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
}

// Encryption key — exactly 64 hex chars
if (
  process.env.ENCRYPTION_KEY === undefined ||
  process.env.ENCRYPTION_KEY === '' ||
  !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)
) {
  process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
}

// CORS
if (process.env.CORS_ALLOWED_ORIGINS === undefined || process.env.CORS_ALLOWED_ORIGINS === '') {
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000';
}

// Redis (use DB 1 to avoid colliding with dev)
if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === '') {
  process.env.REDIS_URL = 'redis://localhost:6379/1';
}

// Notification providers
process.env.SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? 'SG.test-key-not-real';
process.env.SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL ?? 'test@ris.ug';
process.env.AT_API_KEY = process.env.AT_API_KEY ?? 'test-at-key';
process.env.AT_USERNAME = process.env.AT_USERNAME ?? 'sandbox';
process.env.AT_SENDER_ID = process.env.AT_SENDER_ID ?? 'RIS';

// Business rules
process.env.AML_FLAG_THRESHOLD_UGX = process.env.AML_FLAG_THRESHOLD_UGX ?? '100000000';
process.env.DUAL_AUTH_REQUIRED = process.env.DUAL_AUTH_REQUIRED ?? 'true';

// EFT
process.env.EFT_OUTPUT_DIR = process.env.EFT_OUTPUT_DIR ?? '/tmp/eft-test';
process.env.EFT_BANK_CODE = process.env.EFT_BANK_CODE ?? 'STANBIC';

// Rate limiting (relaxed for tests)
process.env.RATE_LIMIT_AUTH_MAX = '1000';
process.env.RATE_LIMIT_AUTH_WINDOW_MS = '900000';
