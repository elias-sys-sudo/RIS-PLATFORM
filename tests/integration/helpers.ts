/**
 * Integration test helpers — builds a fully configured Express app and
 * provides authenticated request factories for supertest.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { SuperTest, Test } from 'supertest';
import {
  helmetMiddleware,
  createCorsMiddleware,
  generalRateLimiter,
  jsonBodyLimit,
  urlencodedBodyLimit,
} from '../../src/shared/middleware/security';
import { xssSanitizeMiddleware } from '../../src/shared/middleware/xss-sanitize';
import { globalErrorHandler } from '../../src/shared/middleware/error-handler';
import { asyncHandler } from '../../src/shared/middleware/async-handler';
import { checkConnection } from '../../src/shared/database/pool';

// Routes — import AFTER env-setup.ts has set all env vars
import { authRouter } from '../../src/services/auth/auth.routes';
import { onboardingRouter } from '../../src/services/onboarding/onboarding.routes';
import { invoicesRouter } from '../../src/services/invoices/invoices.routes';
import { verificationRouter } from '../../src/services/verification/verification.routes';
import { riskEngineRouter } from '../../src/services/risk-engine/risk-engine.routes';
import { pricingRouter } from '../../src/services/pricing/pricing.routes';
import { approvalsRouter } from '../../src/services/approvals/approvals.routes';
import { paymentsRouter } from '../../src/services/payments/payments.routes';
import { collectionsRouter } from '../../src/services/collections/collections.routes';
import { facilitiesRouter } from '../../src/services/facilities/facilities.routes';
import { reportingRouter } from '../../src/services/reporting/reporting.routes';
import {
  dashboardRouter,
  paymentHistoryRouter,
} from '../../src/services/dashboard/dashboard.routes';
import { documentsRouter } from '../../src/services/documents/documents.routes';
import { collateralRouter } from '../../src/services/collateral/collateral.routes';

// ==========================================================================
// Test user constants (match global-setup seed data)
// ==========================================================================

export const TEST_USERS = {
  admin: {
    userId: '00000000-0000-4000-a000-000000000001',
    role: 'management',
    email: 'admin@mmstest.ug',
  },
  creditOfficer: {
    userId: '00000000-0000-4000-a000-000000000002',
    role: 'credit_officer',
    email: 'credit@mmstest.ug',
  },
  supplier: {
    userId: '00000000-0000-4000-a000-000000000003',
    role: 'supplier',
    email: 'supplier@mmstest.ug',
  },
  financeManager: {
    userId: '00000000-0000-4000-a000-000000000004',
    role: 'finance_manager',
    email: 'finance@mmstest.ug',
  },
  auditor: {
    userId: '00000000-0000-4000-a000-000000000005',
    role: 'auditor',
    email: 'auditor@mmstest.ug',
  },
  compliance: {
    userId: '00000000-0000-4000-a000-000000000006',
    role: 'compliance_officer',
    email: 'compliance@mmstest.ug',
  },
  legal: {
    userId: '00000000-0000-4000-a000-000000000007',
    role: 'legal',
    email: 'legal@mmstest.ug',
  },
} as const;

export const TEST_IDS = {
  suppliers: {
    org1: '00000000-0000-4000-b000-000000000001',
    org2: '00000000-0000-4000-b000-000000000002',
  },
  buyers: {
    mtn: '00000000-0000-4000-c000-000000000001',
    stanbic: '00000000-0000-4000-c000-000000000002',
    roofings: '00000000-0000-4000-c000-000000000003',
  },
  invoices: {
    draft: '00000000-0000-4000-d000-000000000001',
    approved: '00000000-0000-4000-d000-000000000002',
    funded: '00000000-0000-4000-d000-000000000003',
    overdue: '00000000-0000-4000-d000-000000000004',
    collected: '00000000-0000-4000-d000-000000000005',
  },
  collections: {
    overdue: '00000000-0000-4000-e000-000000000001',
    collected: '00000000-0000-4000-e000-000000000002',
  },
  collateral: { main: '00000000-0000-4000-f000-000000000001' },
  documents: { pdf: '00000000-0000-4000-f100-000000000001' },
  payments: { funded: '00000000-0000-4000-f200-000000000001' },
} as const;

// ==========================================================================
// App builder
// ==========================================================================

let cachedApp: express.Express | null = null;

/**
 * Build a fully configured Express app using the project's actual middleware
 * and route stack. Does NOT start an HTTP server or create BullMQ workers.
 * The audit middleware writes to the test DB via the shared pool.
 */
export function createTestApp(): express.Express {
  if (cachedApp !== null) {
    return cachedApp;
  }

  const app = express();

  // Security middleware (same order as server.ts)
  app.use(helmetMiddleware);
  app.use(createCorsMiddleware());
  // NOTE: rate limiter window is relaxed via env-setup.ts (1000 req/15min)
  app.use(generalRateLimiter);
  app.use(jsonBodyLimit);
  app.use(urlencodedBodyLimit);
  app.use(cookieParser());

  // XSS sanitisation
  app.use(xssSanitizeMiddleware);

  // Audit middleware (writes to DB — omitted to avoid noise in tests)
  // app.use(auditMiddleware); // skip in integration tests to reduce DB noise

  // Routes (same mount paths as server.ts)
  app.use('/auth', authRouter);
  app.use('/onboarding', onboardingRouter);
  app.use('/invoices', invoicesRouter);
  app.use('/verify', verificationRouter);
  app.use('/invoices', riskEngineRouter);
  app.use('/invoices', pricingRouter);
  app.use('/invoices', approvalsRouter);
  app.use('/payments/history', paymentHistoryRouter);
  app.use('/payments', paymentsRouter);
  app.use('/collections', collectionsRouter);
  app.use('/facilities', facilitiesRouter);
  app.use('/reports', reportingRouter);
  app.use('/dashboard', dashboardRouter);
  app.use('/documents', documentsRouter);
  app.use('/collateral', collateralRouter);

  // Health check
  app.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const dbHealthy = await checkConnection();
      const status = dbHealthy ? 'ok' : 'degraded';
      res.status(dbHealthy ? 200 : 503).json({
        status,
        database: dbHealthy ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
      });
    }),
  );

  // Error handler (must be last)
  app.use(globalErrorHandler);

  cachedApp = app;
  return app;
}

// ==========================================================================
// JWT helpers
// ==========================================================================

interface TestUser {
  userId: string;
  role: string;
  email: string;
}

/**
 * Generate a valid JWT for a test user, bypassing the login flow.
 * Uses the same JWT_SECRET and HS256 algorithm as production.
 */
export function generateTestToken(user: TestUser): string {
  const secret = process.env.JWT_SECRET;
  if (secret === undefined || secret === '') {
    throw new Error('JWT_SECRET not set in test environment');
  }

  return jwt.sign(
    {
      userId: user.userId,
      role: user.role,
      sessionId: `test-session-${user.userId}`,
      type: 'full' as const,
    },
    secret,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

// ==========================================================================
// Request helpers
// ==========================================================================

/**
 * Returns a supertest agent pre-configured with a valid JWT Authorization header.
 * The auth middleware will verify the JWT signature and check the session in Redis.
 *
 * IMPORTANT: For this to work, a matching session must exist in Redis.
 * Call `ensureTestSession(user)` before making requests.
 */
export function authenticatedRequest(user: TestUser): SuperTest<Test> {
  const app = createTestApp();
  const token = generateTestToken(user);
  return request(app).set('Authorization', `Bearer ${token}`) as unknown as SuperTest<Test>;
}

/**
 * Returns a supertest agent with NO Authorization header — for testing auth rejection.
 */
export function unauthenticatedRequest(): SuperTest<Test> {
  const app = createTestApp();
  return request(app) as unknown as SuperTest<Test>;
}

/**
 * Make a single request with authentication.
 * Use when you need to chain .get()/.post() etc.
 */
export function authAgent(user: TestUser): { token: string; app: express.Express } {
  const app = createTestApp();
  const token = generateTestToken(user);
  return { token, app };
}

// ==========================================================================
// Redis session helpers
// ==========================================================================

let redisClient: Awaited<ReturnType<typeof import('redis').createClient>> | null = null;

/**
 * Get or create a Redis client for session management in tests.
 */
async function getRedis(): Promise<typeof redisClient> {
  if (redisClient !== null) {
    return redisClient;
  }
  const { createClient } = await import('redis');
  redisClient = createClient({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379/1',
  });
  await redisClient.connect();
  return redisClient;
}

/**
 * Create a session in Redis for a test user so the auth middleware
 * can find it when verifying the JWT.
 */
export async function ensureTestSession(user: TestUser): Promise<void> {
  const redis = await getRedis();
  if (redis === null) {
    return;
  }
  const sessionData = JSON.stringify({
    userId: user.userId,
    role: user.role,
    sessionId: `test-session-${user.userId}`,
    createdAt: new Date().toISOString(),
  });
  await redis.set(
    `session:test-session-${user.userId}`,
    sessionData,
    { EX: 3600 }, // 1 hour
  );
}

/**
 * Ensure sessions exist for ALL test users AND wire Redis into the auth service.
 * Call this in beforeAll.
 */
export async function ensureAllTestSessions(): Promise<void> {
  const redis = await getRedis();
  if (redis === null) {
    return;
  }

  // Wire the Redis client into the auth service so getSession() works
  const { setRedisClient: setAuthRedis } = await import('../../src/services/auth/auth.service');
  setAuthRedis(redis as Parameters<typeof setAuthRedis>[0]);

  for (const user of Object.values(TEST_USERS)) {
    await ensureTestSession(user);
  }
}

/**
 * Close the Redis client. Call this in afterAll.
 */
export async function closeTestRedis(): Promise<void> {
  if (redisClient !== null) {
    await redisClient.quit();
    redisClient = null;
  }
}
