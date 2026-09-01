import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import express, { RequestHandler } from 'express';

/**
 * Build the list of allowed origins from CORS_ALLOWED_ORIGINS env var.
 * Used by both Helmet CSP and CORS middleware.
 */
function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS ?? '';
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/**
 * Helmet middleware with strict security headers.
 * CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff.
 * connectSrc includes CORS_ALLOWED_ORIGINS so the frontend can reach the API.
 */
export const helmetMiddleware: RequestHandler = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", ...getAllowedOrigins()],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

/**
 * CORS middleware with configurable whitelist from environment.
 */
export function createCorsMiddleware(): RequestHandler {
  const allowedOrigins = getAllowedOrigins();

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no Origin header (server-to-server, mobile clients).
      // Explicitly reject empty-string Origin — browsers never send this legitimately.
      if (origin === undefined) {
        callback(null, true);
      } else if (origin !== '' && allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Disposition', 'Content-Length'],
    maxAge: 86400,
  });
}

/**
 * Rate limiter for credential-presenting endpoints (POST /auth/login,
 * POST /auth/2fa/verify): 10 FAILED requests per 15 minutes per IP.
 *
 * Successful logins do NOT count — anti-credential-stuffing protection
 * only cares about failed attempts, and counting successes punishes
 * legitimate users who log in/out frequently (UAT, role switching).
 *
 * Mounted per-route in auth.routes.ts; do NOT apply at router-level —
 * doing so locks users out of /logout, /refresh, /sessions, /activity
 * after a few minutes of normal SPA use.
 */
export const authRateLimiter: RequestHandler = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS ?? '900000', 10),
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX ?? '10', 10),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many failed sign-in attempts — please try again in a few minutes',
  },
});

/**
 * Production-mode flag for rate-limiter defaults. The public-facing limiters
 * below ship strict limits in production (real anti-abuse posture) but
 * relax 20× in non-prod so operators / QA / staging can iterate without
 * locking themselves out. Either default is overridable per-env via the
 * RATE_LIMIT_* env vars.
 */
const IS_PROD_RATE_LIMITS = process.env.NODE_ENV === 'production';

function envInt(envKey: string, prodDefault: number, nonProdDefault: number): number {
  const raw = process.env[envKey];
  if (raw !== undefined && raw !== '') return parseInt(raw, 10);
  return IS_PROD_RATE_LIMITS ? prodDefault : nonProdDefault;
}

/**
 * Rate limiter for public supplier registration.
 *   prod default:     5 requests per hour per IP (DoS + spam vector — bcrypt cost-12 + DB writes)
 *   non-prod default: 100 requests per hour per IP (UAT operator iteration)
 *   override:         RATE_LIMIT_REG_MAX, RATE_LIMIT_REG_WINDOW_MS
 */
export const registrationRateLimiter: RequestHandler = rateLimit({
  windowMs: envInt('RATE_LIMIT_REG_WINDOW_MS', 60 * 60 * 1000, 60 * 60 * 1000),
  max: envInt('RATE_LIMIT_REG_MAX', 5, 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many registration attempts. Please try again later.',
  },
});

/**
 * Rate limiter for public eligibility check.
 *   prod default:     20 requests per hour per IP (unauth oracle — free signal otherwise)
 *   non-prod default: 200 requests per hour per IP (UAT operator iteration)
 *   override:         RATE_LIMIT_ELIG_MAX, RATE_LIMIT_ELIG_WINDOW_MS
 */
export const eligibilityRateLimiter: RequestHandler = rateLimit({
  windowMs: envInt('RATE_LIMIT_ELIG_WINDOW_MS', 60 * 60 * 1000, 60 * 60 * 1000),
  max: envInt('RATE_LIMIT_ELIG_MAX', 20, 200),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many eligibility checks. Please try again later.',
  },
});

/**
 * General rate limiter: 100 requests per minute.
 */
export const generalRateLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many requests — please try again later',
  },
});

/**
 * Rate limiter for invoice submission: 10 per supplier per hour.
 * Keyed by authenticated userId (supplier).
 */
export const invoiceSubmitRateLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req: express.Request) => `invoice-submit:${req.user?.userId ?? req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Invoice submission limit exceeded — max 10 per hour',
  },
});

/**
 * Rate limiter for document uploads: 20 per supplier per hour.
 * Keyed by authenticated userId (supplier).
 */
export const documentUploadRateLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req: express.Request) => `doc-upload:${req.user?.userId ?? req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Document upload limit exceeded — max 20 per hour',
  },
});

/**
 * Rate limiter for forgot-password / resend-verification.
 *   prod default:     3 requests per email per hour (anti-enumeration + anti-spam)
 *   non-prod default: 30 requests per email per hour
 *   override:         RATE_LIMIT_FORGOT_MAX, RATE_LIMIT_FORGOT_WINDOW_MS
 * Keyed by request body email so per-address limit, not per-IP.
 */
export const forgotPasswordRateLimiter: RequestHandler = rateLimit({
  windowMs: envInt('RATE_LIMIT_FORGOT_WINDOW_MS', 60 * 60 * 1000, 60 * 60 * 1000),
  max: envInt('RATE_LIMIT_FORGOT_MAX', 3, 30),
  keyGenerator: (req: express.Request) => {
    const email = (req.body as { email?: string })?.email ?? '';
    return `forgot-pw:${email.toLowerCase().trim()}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many requests — please try again later',
  },
});

/**
 * Rate limiter for buyer confirmation.
 *   prod default:     5 per token per hour (anti-bruteforce of guessable tokens)
 *   non-prod default: 50 per token per hour
 *   override:         RATE_LIMIT_BUYER_CONFIRM_MAX, RATE_LIMIT_BUYER_CONFIRM_WINDOW_MS
 */
export const buyerConfirmRateLimiter: RequestHandler = rateLimit({
  windowMs: envInt('RATE_LIMIT_BUYER_CONFIRM_WINDOW_MS', 60 * 60 * 1000, 60 * 60 * 1000),
  max: envInt('RATE_LIMIT_BUYER_CONFIRM_MAX', 5, 50),
  keyGenerator: (req: express.Request) => `buyer-confirm:${req.params.token ?? req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Confirmation attempt limit exceeded — max 5 per hour',
  },
});

/**
 * Request body size limits.
 * 10MB for file uploads (multipart), 1MB for JSON.
 * The verify callback captures the raw bytes on req.rawBody — required for
 * webhook HMAC verification (JSON.stringify of a parsed body is not stable).
 */
export const jsonBodyLimit: RequestHandler = express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
});
export const urlencodedBodyLimit: RequestHandler = express.urlencoded({
  extended: true,
  limit: '1mb',
});
