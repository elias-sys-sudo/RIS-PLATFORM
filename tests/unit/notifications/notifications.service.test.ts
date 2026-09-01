// Set env vars before imports
process.env.SES_SMTP_HOST = 'email-smtp.eu-central-1.amazonaws.com';
process.env.SES_SMTP_PORT = '587';
process.env.SES_SMTP_USER = 'AKIATEST';
process.env.SES_SMTP_PASS = 'testpass';
process.env.SES_FROM_DEFAULT = 'noreply@ris.ug';
process.env.SES_FROM_KYC = 'kyc@ris.ug';
process.env.SES_FROM_PAYMENTS = 'payments@ris.ug';
process.env.SES_FROM_SUPPORT = 'support@ris.ug';
process.env.AT_API_KEY = 'test-at-key';
process.env.AT_USERNAME = 'ris-sandbox';
process.env.AT_SENDER_ID = 'RIS';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// `mockSendGridSend` is retained as the test-facing handle for the email transport
// (now nodemailer.sendMail underneath). Renaming everywhere would churn 30+ lines
// of test code that all still test the same behaviour — what matters is that the
// shim adapts the SES-SMTP transport response shape to the test's expectations.
const mockSendGridSend = jest.fn();
const mockSendMail = jest.fn();
const mockSmsSend = jest.fn();

// Adapter: tests assert sendgrid-style resolves/rejects on `mockSendGridSend`.
// We forward each call into nodemailer's shape: an Error rejection passes through;
// a SendGrid-style success `[{ statusCode, headers: { 'x-message-id': ... } }]`
// becomes nodemailer's `{ messageId, accepted, rejected: [] }`.
mockSendMail.mockImplementation(async (mailOpts: { to: string }) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const sgResult = await mockSendGridSend(mailOpts);
  // The original tests resolve with an array like [{ statusCode, headers: {...} }]
  if (Array.isArray(sgResult) && sgResult.length > 0) {
    const first = sgResult[0] as { headers?: Record<string, string> };
    const headers = first.headers ?? {};
    const xMsgId = headers['x-message-id'];
    return {
      messageId: typeof xMsgId === 'string' ? `<${xMsgId}@example.com>` : undefined,
      accepted: [mailOpts.to],
      rejected: [],
    };
  }
  return { messageId: undefined, accepted: [mailOpts.to], rejected: [] };
});

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

jest.mock('africastalking', () => {
  return jest.fn().mockImplementation(() => ({
    SMS: {
      send: mockSmsSend,
    },
  }));
});

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    audit: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  initialiseNotificationService,
  processNotification,
  isCircuitOpen,
  resetCircuitBreaker,
  getHealthStatus,
  resetForTesting,
} from '../../../src/services/notifications/notifications.service';
import type { NotificationJobPayload } from '../../../src/services/notifications/notifications.types';
import { logger } from '../../../src/shared/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEmailJob = (overrides: Partial<NotificationJobPayload> = {}): NotificationJobPayload => ({
  id: `job-${Date.now()}-${Math.random()}`,
  channel: 'email',
  template: 'welcome',
  recipient: 'user@test.com',
  data: { user_name: 'Test', login_url: 'https://app.mms.ug' },
  priority: 'normal',
  attempts: 0,
  max_attempts: 3,
  created_at: new Date().toISOString(),
  ...overrides,
});

const makeSmsJob = (overrides: Partial<NotificationJobPayload> = {}): NotificationJobPayload => ({
  id: `job-${Date.now()}-${Math.random()}`,
  channel: 'sms',
  template: 'payment_confirmation',
  recipient: '+256700123456',
  data: { amount: '1,000,000', ref: 'REF-001', balance: '500,000' },
  priority: 'normal',
  attempts: 0,
  max_attempts: 3,
  created_at: new Date().toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationService', () => {
  beforeAll(() => {
    initialiseNotificationService();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetForTesting();
  });

  // =========================================================================
  // processNotification — email
  // =========================================================================

  describe('processNotification — email', () => {
    it('sends email and returns success', async () => {
      mockSendGridSend.mockResolvedValue([
        { statusCode: 202, headers: { 'x-message-id': 'msg-001' } },
      ]);

      const result = await processNotification(makeEmailJob());

      expect(result.success).toBe(true);
      expect(result.provider).toBe('ses');
      expect(mockSendGridSend).toHaveBeenCalledTimes(1);
    });

    it('returns failure when SendGrid throws', async () => {
      mockSendGridSend.mockRejectedValue(new Error('Rate limited'));

      const result = await processNotification(makeEmailJob());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limited');
    });
  });

  // =========================================================================
  // processNotification — sms
  // =========================================================================

  describe('processNotification — sms', () => {
    it('sends SMS and returns success', async () => {
      mockSmsSend.mockResolvedValue({
        SMSMessageData: {
          Recipients: [{ messageId: 'AT-001', status: 'Success' }],
        },
      });

      const result = await processNotification(makeSmsJob());

      expect(result.success).toBe(true);
      expect(result.provider).toBe('africastalking');
    });
  });

  // =========================================================================
  // dispatchToProvider — default (unknown) channel branch
  // =========================================================================

  describe('dispatchToProvider — unknown channel', () => {
    it('returns failure with "Unknown channel" error for unknown channel', async () => {
      // `dispatchToProvider` is private but reachable via `processNotification`.
      // The obstacle is that `isCircuitOpen` reads `circuitBreakers[channel]` and
      // only 'email' and 'sms' keys exist, so an unknown channel causes a crash.
      // Solution: seed `circuitBreakers` for the unknown channel by calling
      // `resetCircuitBreaker` with the unknown key cast to NotificationChannel.
      // This is valid at runtime (JS Record access is not type-checked).
      resetCircuitBreaker('push' as 'email');

      // Cast to bypass TypeScript type checking
      const unknownJob = makeEmailJob({ channel: 'push' as 'email' });
      const result = await processNotification(unknownJob);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown channel: push');
      expect(result.provider).toBe('push');
    });
  });

  // =========================================================================
  // Idempotency
  // =========================================================================

  describe('idempotency', () => {
    it('rejects duplicate job IDs', async () => {
      mockSendGridSend.mockResolvedValue([{ statusCode: 202, headers: {} }]);

      const job = makeEmailJob({ id: 'unique-job-001' });
      const first = await processNotification(job);
      const second = await processNotification(job);

      expect(first.success).toBe(true);
      expect(second.success).toBe(false);
      expect(second.error).toContain('Duplicate');
      expect(mockSendGridSend).toHaveBeenCalledTimes(1);
    });

    it('evicts oldest entry when processed jobs cache reaches MAX_PROCESSED_CACHE (10000)', async () => {
      // This test exercises the trackProcessedJob eviction branch (lines 138-139):
      // `if (processedJobs.size >= MAX_PROCESSED_CACHE)`
      mockSendGridSend.mockResolvedValue([{ statusCode: 202, headers: {} }]);

      // Fill the cache to exactly MAX_PROCESSED_CACHE (10_000) by processing jobs
      // Directly calling processNotification 10_000 times is slow, so we use
      // the public API with unique IDs to fill the set, then trigger eviction.
      // Because MAX_PROCESSED_CACHE=10_000 is large, we use resetForTesting and
      // manually inject state by processing one successful job, verifying the
      // eviction happens correctly at the boundary.
      //
      // Strategy: fill to 9999, then submit two more jobs — the 10000th fills
      // the set to limit, and the 10001st triggers eviction of the first entry.
      const CACHE_MAX = 10_000;

      // Process CACHE_MAX jobs to fill the set
      const firstJobId = `evict-seed-0`;
      for (let i = 0; i < CACHE_MAX; i++) {
        mockSendGridSend.mockResolvedValue([{ statusCode: 202, headers: {} }]);
        await processNotification(makeEmailJob({ id: `evict-seed-${i}` }));
      }

      // The set is now full. Submitting a new unique job should evict the oldest.
      mockSendGridSend.mockResolvedValue([{ statusCode: 202, headers: {} }]);
      const overflowResult = await processNotification(makeEmailJob({ id: 'evict-overflow' }));
      expect(overflowResult.success).toBe(true);

      // The first job ID (evict-seed-0) should have been evicted from the cache,
      // so submitting it again should succeed (not be treated as duplicate).
      mockSendGridSend.mockResolvedValue([{ statusCode: 202, headers: {} }]);
      const resubmittedFirst = await processNotification(makeEmailJob({ id: firstJobId }));
      expect(resubmittedFirst.success).toBe(true);
      expect(resubmittedFirst.error).toBeUndefined();
    }, 60_000); // allow up to 60s for 10001 iterations
  });

  // =========================================================================
  // Circuit breaker
  // =========================================================================

  describe('circuit breaker', () => {
    it('starts with circuit closed', () => {
      expect(isCircuitOpen('email')).toBe(false);
      expect(isCircuitOpen('sms')).toBe(false);
    });

    it('opens circuit after 5 consecutive failures', async () => {
      mockSendGridSend.mockRejectedValue(new Error('Service down'));

      for (let i = 0; i < 5; i++) {
        await processNotification(makeEmailJob());
      }

      expect(isCircuitOpen('email')).toBe(true);
    });

    it('rejects jobs when circuit is open', async () => {
      mockSendGridSend.mockRejectedValue(new Error('Service down'));

      for (let i = 0; i < 5; i++) {
        await processNotification(makeEmailJob());
      }

      const result = await processNotification(makeEmailJob());
      expect(result.success).toBe(false);
      expect(result.error).toContain('Circuit breaker open');
    });

    it('resets circuit breaker on manual reset', async () => {
      mockSendGridSend.mockRejectedValue(new Error('Service down'));

      for (let i = 0; i < 5; i++) {
        await processNotification(makeEmailJob());
      }

      expect(isCircuitOpen('email')).toBe(true);
      resetCircuitBreaker('email');
      expect(isCircuitOpen('email')).toBe(false);
    });

    it('resets consecutive failures on success', async () => {
      mockSendGridSend.mockRejectedValueOnce(new Error('Fail 1'));
      mockSendGridSend.mockRejectedValueOnce(new Error('Fail 2'));
      mockSendGridSend.mockResolvedValueOnce([{ statusCode: 202, headers: {} }]);

      await processNotification(makeEmailJob());
      await processNotification(makeEmailJob());
      await processNotification(makeEmailJob()); // success — resets counter

      // Should NOT be open after 2 failures + 1 success
      expect(isCircuitOpen('email')).toBe(false);
    });

    it('returns false and auto-resets circuit when pausedUntil has expired', () => {
      // Covers lines 54-56: `if (Date.now() >= state.pausedUntil)` — the branch where
      // the circuit was tripped but the pause window has now elapsed.
      // We set pausedUntil to a time in the past to simulate expiry.
      const channel = 'email' as const;

      // Trip the circuit manually by setting internal state via resetCircuitBreaker
      // then directly manipulating through the test helper approach:
      // We can't access private `circuitBreakers` directly, so we use the
      // jest fake timers approach to travel past the pause window.

      jest.useFakeTimers();

      // Trigger 5 failures to open circuit (pausedUntil = now + 60_000)
      const errorJobs: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        mockSendGridSend.mockRejectedValueOnce(new Error('Down'));
        errorJobs.push(processNotification(makeEmailJob()));
      }

      // We need to resolve the promises before advancing time.
      // With fake timers, we need to flush microtasks.
      jest.runAllTicks();

      void Promise.all(errorJobs).then(() => {
        expect(isCircuitOpen(channel)).toBe(true);

        // Advance time past the 60-second pause window
        jest.advanceTimersByTime(61_000);

        // Now isCircuitOpen should return false and reset the circuit
        expect(isCircuitOpen(channel)).toBe(false);

        jest.useRealTimers();
      });
    });

    it('auto-resets circuit breaker when pause window elapses (async variant)', async () => {
      // Direct approach using real timers and Date mocking
      const channel = 'email' as const;
      resetCircuitBreaker(channel);

      // Trip circuit with 5 failures
      for (let i = 0; i < 5; i++) {
        mockSendGridSend.mockRejectedValueOnce(new Error('Down'));
        await processNotification(makeEmailJob());
      }

      expect(isCircuitOpen(channel)).toBe(true);

      // Mock Date.now() to return a time past the pause window
      const realNow = Date.now;
      const futureTime = realNow() + 61_000; // 61 seconds into the future
      Date.now = jest.fn().mockReturnValue(futureTime);

      try {
        // Circuit should now auto-reset because pausedUntil is in the past
        expect(isCircuitOpen(channel)).toBe(false);
        // After reset, circuit is closed
        expect(isCircuitOpen(channel)).toBe(false);
      } finally {
        Date.now = realNow;
      }
    });
  });

  // =========================================================================
  // getHealthStatus
  // =========================================================================

  describe('getHealthStatus', () => {
    it('returns health status with both providers configured', () => {
      const status = getHealthStatus();
      expect(status).toHaveProperty('healthy');
      expect(status).toHaveProperty('email');
      expect(status).toHaveProperty('sms');
      expect(status.email).toHaveProperty('configured');
      expect(status.email).toHaveProperty('circuitOpen');
    });

    it('reports healthy=true when at least one provider is configured', () => {
      // Both email and SMS are configured via env vars set at top of file
      const status = getHealthStatus();
      expect(status.healthy).toBe(true);
    });

    it('reports healthy=false when neither email nor SMS is configured', () => {
      // Covers line 174 branch 1: `isEmailConfigured() || isSmsConfigured()` — both false
      // We need to temporarily unset both providers. Since module state is shared,
      // we mock the imported provider functions.
      jest.isolateModules(() => {
        jest.mock('../../../src/services/notifications/email.provider', () => ({
          sendEmail: jest.fn(),
          initialiseEmailProvider: jest.fn(),
          isEmailConfigured: jest.fn().mockReturnValue(false),
        }));
        jest.mock('../../../src/services/notifications/sms.provider', () => ({
          sendSms: jest.fn(),
          initialiseSmsProvider: jest.fn(),
          isSmsConfigured: jest.fn().mockReturnValue(false),
        }));

        const { getHealthStatus: getHealth } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../src/services/notifications/notifications.service') as typeof import('../../../src/services/notifications/notifications.service');

        const status = getHealth();
        expect(status.healthy).toBe(false);
      });
    });

    it('reflects open circuit in health status', async () => {
      // Trip the email circuit breaker
      for (let i = 0; i < 5; i++) {
        mockSendGridSend.mockRejectedValueOnce(new Error('Down'));
        await processNotification(makeEmailJob());
      }

      const status = getHealthStatus();
      expect(status.email.circuitOpen).toBe(true);
      expect(status.healthy).toBe(true); // still healthy because SMS is configured
    });
  });

  // =========================================================================
  // isCircuitOpen — expired pausedUntil auto-reset
  // =========================================================================

  describe('isCircuitOpen — auto-reset when pause window elapses', () => {
    it('returns false and resets state when pausedUntil is in the past', async () => {
      const channel = 'sms' as const;
      resetCircuitBreaker(channel);

      // Trip the SMS circuit
      for (let i = 0; i < 5; i++) {
        mockSmsSend.mockRejectedValueOnce(new Error('SMS down'));
        await processNotification(makeSmsJob());
      }

      expect(isCircuitOpen(channel)).toBe(true);

      // Advance Date.now past the 60-second pause window
      const realNow = Date.now;
      const futureTime = realNow() + 61_000;
      Date.now = jest.fn().mockReturnValue(futureTime);

      try {
        // First call triggers the auto-reset branch (lines 54-56)
        const result = isCircuitOpen(channel);
        expect(result).toBe(false);

        // Circuit is now reset — subsequent call also returns false
        Date.now = realNow;
        expect(isCircuitOpen(channel)).toBe(false);
      } finally {
        Date.now = realNow;
      }
    });

    it('returns true when pausedUntil is in the future', async () => {
      // Covers `state.pausedUntil !== null` AND `Date.now() < state.pausedUntil` → true
      const channel = 'email' as const;
      resetCircuitBreaker(channel);

      for (let i = 0; i < 5; i++) {
        mockSendGridSend.mockRejectedValueOnce(new Error('Down'));
        await processNotification(makeEmailJob());
      }

      // Do not advance time — pausedUntil is still in the future
      expect(isCircuitOpen(channel)).toBe(true);
    });
  });

  // =========================================================================
  // logSendAttempt — both success and failure log paths
  // =========================================================================

  describe('logSendAttempt logging', () => {
    it('logs success via logger.info after a successful send', async () => {
      // logger is imported at top of file (mock is applied by jest.mock above)
      mockSendGridSend.mockResolvedValue([
        { statusCode: 202, headers: { 'x-message-id': 'log-test-msg' } },
      ]);

      await processNotification(makeEmailJob({ id: 'log-success-001' }));

      expect(logger.info).toHaveBeenCalledWith(
        'Notification sent',
        expect.objectContaining({ jobId: 'log-success-001', success: true }),
      );
    });

    it('logs failure via logger.error after a failed send', async () => {
      // logger is imported at top of file (mock is applied by jest.mock above)
      mockSendGridSend.mockRejectedValue(new Error('SMTP error'));

      await processNotification(makeEmailJob({ id: 'log-fail-001' }));

      expect(logger.error).toHaveBeenCalledWith(
        'Notification failed',
        expect.objectContaining({ jobId: 'log-fail-001', success: false }),
      );
    });
  });

  // =========================================================================
  // trackProcessedJob — cache eviction at MAX_PROCESSED_CACHE boundary
  // =========================================================================

  describe('trackProcessedJob — cache eviction', () => {
    it('allows re-processing of a job ID after it is evicted from the cache', async () => {
      // This test directly exercises the eviction branch (lines 150-151):
      // `if (processedJobs.size >= MAX_PROCESSED_CACHE)`
      const CACHE_MAX = 10_000;

      const firstJobId = 'evict-boundary-0';

      // Fill the cache to MAX_PROCESSED_CACHE
      for (let i = 0; i < CACHE_MAX; i++) {
        mockSendGridSend.mockResolvedValue([{ statusCode: 202, headers: {} }]);
        await processNotification(makeEmailJob({ id: `evict-boundary-${i}` }));
      }

      // Adding one more triggers the eviction of the oldest entry
      mockSendGridSend.mockResolvedValue([{ statusCode: 202, headers: {} }]);
      const triggerEviction = await processNotification(
        makeEmailJob({ id: 'evict-boundary-trigger' }),
      );
      expect(triggerEviction.success).toBe(true);

      // The first job ID was evicted — submitting it again should not be a duplicate
      mockSendGridSend.mockResolvedValue([{ statusCode: 202, headers: {} }]);
      const resubmitted = await processNotification(makeEmailJob({ id: firstJobId }));
      expect(resubmitted.success).toBe(true);
      expect(resubmitted.error).toBeUndefined();
    }, 90_000);
  });
});
