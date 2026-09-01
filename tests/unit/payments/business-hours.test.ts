jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn(),
      release: jest.fn(),
    }),
  },
  query: jest.fn(),
}));

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
  },
}));

jest.mock('../../../src/services/payments/payments.repository');
jest.mock('../../../src/services/collateral/collateral.service', () => ({
  checkCoverageRatio: jest.fn().mockResolvedValue({ sufficient: true, ratio: 1.0 }),
}));
jest.mock('../../../src/services/facilities/facilities.repository', () => ({
  getActiveFacilities: jest.fn().mockResolvedValue([{ available_amount: '999999999' }]),
}));

import * as paymentRepo from '../../../src/services/payments/payments.repository';
import * as paymentService from '../../../src/services/payments/payments.service';
import { PaymentStatus } from '../../../src/services/payments/payments.types';
import type { PaymentRecord } from '../../../src/services/payments/payments.types';

const repo = paymentRepo as jest.Mocked<typeof paymentRepo>;

const makePayment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'pay-001',
  invoice_id: 'inv-001',
  amount: '5000000',
  provider: 'EFT',
  status: PaymentStatus.PENDING_FIRST_AUTH,
  idempotency_key: 'idem-001',
  dual_auth_user_1: null,
  dual_auth_timestamp_1: null,
  dual_auth_user_2: null,
  dual_auth_timestamp_2: null,
  transaction_reference: null,
  provider_reference: null,
  funded_at: null,
  failure_reason: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('business hours enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Helper: create a Date at a specific UTC hour.
   * Since EAT = UTC+3, to test EAT hour X, we set UTC hour to (X - 3).
   */
  function utcDateAtHour(utcHour: number, dayOfWeek: number): Date {
    // Jan 6, 2025 is a Monday (dayOfWeek 1)
    // Jan 5, 2025 is a Sunday (dayOfWeek 0)
    // Jan 11, 2025 is a Saturday (dayOfWeek 6)
    const baseDates: Record<number, number> = {
      0: 5, // Sunday
      1: 6, // Monday
      2: 7, // Tuesday
      5: 10, // Friday
      6: 11, // Saturday
    };
    const day = baseDates[dayOfWeek] ?? 6;
    return new Date(Date.UTC(2025, 0, day, utcHour, 0, 0));
  }

  it('flags after-hours payment (before 07:00 EAT)', async () => {
    // EAT 06:00 = UTC 03:00 on a Monday
    const mockDate = utcDateAtHour(3, 1);
    jest.useFakeTimers().setSystemTime(mockDate);

    const recentTime = new Date(Date.now() - 5 * 60 * 1000);
    repo.getLast2faVerifiedAt.mockResolvedValue(recentTime);
    repo.getPaymentByIdForUpdate.mockResolvedValue(makePayment());
    repo.recordFirstAuthWithClient.mockResolvedValue(
      makePayment({ status: PaymentStatus.PENDING_SECOND_AUTH }),
    );
    repo.createAuditEntry.mockResolvedValue();
    repo.createAuditEntryWithClient.mockResolvedValue();

    await paymentService.authoriseFirstAuth('pay-001', 'user-001', '10.0.0.1', 'test-ua');

    // Should have called createAuditEntry with AFTER_HOURS_PAYMENT
    const afterHoursCall = repo.createAuditEntry.mock.calls.find(
      (call) => call[1] === 'AFTER_HOURS_PAYMENT',
    );
    expect(afterHoursCall).toBeDefined();

    jest.useRealTimers();
  });

  it('flags weekend payments', async () => {
    // Saturday at 10:00 EAT = UTC 07:00
    const mockDate = utcDateAtHour(7, 6);
    jest.useFakeTimers().setSystemTime(mockDate);

    const recentTime = new Date(Date.now() - 5 * 60 * 1000);
    repo.getLast2faVerifiedAt.mockResolvedValue(recentTime);
    repo.getPaymentByIdForUpdate.mockResolvedValue(makePayment());
    repo.recordFirstAuthWithClient.mockResolvedValue(
      makePayment({ status: PaymentStatus.PENDING_SECOND_AUTH }),
    );
    repo.createAuditEntry.mockResolvedValue();
    repo.createAuditEntryWithClient.mockResolvedValue();

    await paymentService.authoriseFirstAuth('pay-001', 'user-001', '10.0.0.1', 'test-ua');

    const afterHoursCall = repo.createAuditEntry.mock.calls.find(
      (call) => call[1] === 'AFTER_HOURS_PAYMENT',
    );
    expect(afterHoursCall).toBeDefined();

    jest.useRealTimers();
  });

  it('does NOT flag during business hours (Mon-Fri 07:00-19:59 EAT)', async () => {
    // Monday at 10:00 EAT = UTC 07:00
    const mockDate = utcDateAtHour(7, 1);
    jest.useFakeTimers().setSystemTime(mockDate);

    const recentTime = new Date(Date.now() - 5 * 60 * 1000);
    repo.getLast2faVerifiedAt.mockResolvedValue(recentTime);
    repo.getPaymentByIdForUpdate.mockResolvedValue(makePayment());
    repo.recordFirstAuthWithClient.mockResolvedValue(
      makePayment({ status: PaymentStatus.PENDING_SECOND_AUTH }),
    );
    repo.createAuditEntry.mockResolvedValue();
    repo.createAuditEntryWithClient.mockResolvedValue();

    await paymentService.authoriseFirstAuth('pay-001', 'user-001', '10.0.0.1', 'test-ua');

    const afterHoursCall = repo.createAuditEntry.mock.calls.find(
      (call) => call[1] === 'AFTER_HOURS_PAYMENT',
    );
    expect(afterHoursCall).toBeUndefined();

    jest.useRealTimers();
  });

  it('flags after 20:00 EAT', async () => {
    // Monday at 21:00 EAT = UTC 18:00
    const mockDate = utcDateAtHour(18, 1);
    jest.useFakeTimers().setSystemTime(mockDate);

    const recentTime = new Date(Date.now() - 5 * 60 * 1000);
    repo.getLast2faVerifiedAt.mockResolvedValue(recentTime);
    repo.getPaymentByIdForUpdate.mockResolvedValue(makePayment());
    repo.recordFirstAuthWithClient.mockResolvedValue(
      makePayment({ status: PaymentStatus.PENDING_SECOND_AUTH }),
    );
    repo.createAuditEntry.mockResolvedValue();
    repo.createAuditEntryWithClient.mockResolvedValue();

    await paymentService.authoriseFirstAuth('pay-001', 'user-001', '10.0.0.1', 'test-ua');

    const afterHoursCall = repo.createAuditEntry.mock.calls.find(
      (call) => call[1] === 'AFTER_HOURS_PAYMENT',
    );
    expect(afterHoursCall).toBeDefined();

    jest.useRealTimers();
  });

  it('does NOT block payment during after-hours (just flags)', async () => {
    // Sunday at 14:00 EAT = UTC 11:00
    const mockDate = utcDateAtHour(11, 0);
    jest.useFakeTimers().setSystemTime(mockDate);

    const recentTime = new Date(Date.now() - 5 * 60 * 1000);
    repo.getLast2faVerifiedAt.mockResolvedValue(recentTime);
    repo.getPaymentByIdForUpdate.mockResolvedValue(makePayment());
    repo.recordFirstAuthWithClient.mockResolvedValue(
      makePayment({ status: PaymentStatus.PENDING_SECOND_AUTH }),
    );
    repo.createAuditEntry.mockResolvedValue();
    repo.createAuditEntryWithClient.mockResolvedValue();

    // Should NOT throw — after hours is flagged, not blocked
    const result = await paymentService.authoriseFirstAuth('pay-001', 'user-001');

    expect(result.status).toBe(PaymentStatus.PENDING_SECOND_AUTH);

    jest.useRealTimers();
  });
});
