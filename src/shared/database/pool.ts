import { AsyncLocalStorage } from 'async_hooks';
import { Pool, PoolClient, QueryResult, QueryResultRow, PoolConfig } from 'pg';
import { logger } from '../logger';

/**
 * RLS context propagated through the async request chain.
 * Set by authenticateJwt middleware; consumed by beginWithRls().
 */
export interface RlsContext {
  userId: string;
  role: string;
}

/**
 * AsyncLocalStorage that carries the authenticated user's identity through
 * every async hop of a request so beginWithRls() can activate the correct
 * PostgreSQL row-level security context without threading userId/role through
 * every repository call signature.
 */
export const rlsStore = new AsyncLocalStorage<RlsContext>();

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl && process.env.NODE_ENV !== 'test') {
  throw new Error('DATABASE_URL environment variable is required. Server will not start.');
}

const poolConfig: PoolConfig = {
  connectionString: databaseUrl,
  min: parseInt(process.env.DATABASE_POOL_MIN ?? '2', 10),
  max: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

const pool = new Pool(poolConfig);

pool.on('connect', () => {
  logger.info('Database pool: new client connected', { component: 'database' });
});

pool.on('error', (err: Error) => {
  logger.error('Database pool: unexpected error on idle client', {
    component: 'database',
    errorMessage: err.message,
  });
});

/**
 * Execute a parameterised SQL query against the database pool.
 * The params array is required to prevent accidental raw string queries.
 *
 * When an RLS context is present (authenticated HTTP request), the query runs
 * inside an implicit BEGIN/COMMIT block with SET LOCAL so PostgreSQL row-level
 * security policies see the correct `app.current_user_id` and
 * `app.current_user_role` — even for standalone reads that don't use a full
 * service-layer transaction.
 *
 * SET LOCAL is used (not SET) so the variables are scoped to the transaction
 * and cannot leak to the next request that reuses the same pooled connection.
 */
export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  const ctx = rlsStore.getStore();

  let result: QueryResult<T>;

  if (ctx !== undefined) {
    // Authenticated request: activate RLS for the duration of this query.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.current_user_id', $1, true),
                set_config('app.current_user_role', $2, true)`,
        [ctx.userId, ctx.role],
      );
      result = await client.query<T>(text, params as unknown[]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // System/background job — no RLS context; run directly on the pool.
    result = await pool.query<T>(text, params as unknown[]);
  }

  const duration = Date.now() - start;

  logger.debug('Query executed', {
    component: 'database',
    duration,
    rowCount: result.rowCount,
  });

  return result;
}

/**
 * Begin a transaction and activate PostgreSQL row-level security for the
 * currently authenticated user.
 *
 * Must replace every bare `client.query('BEGIN')` in service transaction blocks.
 * Uses SET LOCAL (via set_config with is_local=true) so the variables are
 * automatically cleared at COMMIT or ROLLBACK — no cleanup needed.
 *
 * If no RLS context is present (background jobs, health checks) the function
 * still starts the transaction; RLS policies will see NULL for the settings and
 * fall through to the non-supplier branch (officers/jobs bypass the supplier
 * isolation check by role, so this is safe for system operations).
 */
export async function beginWithRls(client: PoolClient): Promise<void> {
  await client.query('BEGIN');

  const ctx = rlsStore.getStore();
  if (ctx !== undefined) {
    await client.query(
      `SELECT set_config('app.current_user_id', $1, true),
              set_config('app.current_user_role', $2, true)`,
      [ctx.userId, ctx.role],
    );
  }
}

/**
 * Check if the database connection is healthy.
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Gracefully shut down the database pool.
 */
export async function closePool(): Promise<void> {
  await pool.end();
  logger.info('Database pool closed', { component: 'database' });
}

export { pool };
