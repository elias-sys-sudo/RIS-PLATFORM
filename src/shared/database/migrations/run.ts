import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Run all SQL migration files in order.
 * Tracks applied migrations in a schema_migrations table to prevent re-runs.
 */
async function runMigrations(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname);
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const applied = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename',
      [],
    );
    const appliedSet = new Set(applied.rows.map((r) => r.filename));

    for (const file of files) {
      if (appliedSet.has(file)) {
        logMessage(`Skipping (already applied): ${file}`);
        continue;
      }

      logMessage(`Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logMessage(`Applied: ${file}`);
      } catch (err: unknown) {
        await client.query('ROLLBACK');
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logMessage(`Failed to apply ${file}: ${errorMessage}`);
        throw err;
      }
    }

    logMessage('All migrations applied successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

function logMessage(message: string): void {
  const timestamp = new Date().toISOString();
  process.stdout.write(`[${timestamp}] ${message}\n`);
}

runMigrations().catch((err: unknown) => {
  const errorMessage = err instanceof Error ? err.message : 'Unknown error';
  process.stderr.write(`Migration failed: ${errorMessage}\n`);
  process.exit(1);
});
