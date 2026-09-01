/**
 * Jest globalTeardown — drops the test database created by global-setup.ts.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import dotenv from 'dotenv';

const TEMP_FILE = path.resolve(__dirname, '.test-db-meta');

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(TEMP_FILE)) {
    return;
  }

  dotenv.config({ path: '.env.local' });

  const meta = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf-8')) as {
    dbName: string;
    testConnStr: string;
  };

  const baseUrl =
    process.env.DATABASE_URL ?? 'postgresql://mms_user:mms_password@localhost:5432/mms_platform';
  const url = new URL(baseUrl);
  const adminConnStr = `postgresql://${url.username}:${encodeURIComponent(url.password)}@${url.hostname}:${url.port}/postgres`;

  const admin = new Client({ connectionString: adminConnStr });
  await admin.connect();

  // Terminate all connections to the test DB before dropping
  await admin.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [meta.dbName],
  );

  await admin.query(`DROP DATABASE IF EXISTS "${meta.dbName}"`);
  await admin.end();

  // Clean up temp file
  fs.unlinkSync(TEMP_FILE);
}
