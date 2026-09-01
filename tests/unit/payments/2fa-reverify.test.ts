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
import { PaymentStatus, PaymentErrorCode } from '../../../src/services/payments/payments.types';
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

describe('2FA re-verification for payments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('authoriseFirstAuth', () => {
    it('throws TWO_FA_REVERIFICATION_REQUIRED when 2FA never verified', async () => {
      repo.getLast2faVerifiedAt.mockResolvedValue(null);

      await expect(paymentService.authoriseFirstAuth('pay-001', 'user-001')).rejects.toMatchObject({
        errorCode: PaymentErrorCode.TWO_FA_REVERIFICATION_REQUIRED,
      });
    });

    it('throws TWO_FA_REVERIFICATION_REQUIRED when 2FA verified > 60 min ago', async () => {
      const oldTime = new Date(Date.now() - 61 * 60 * 1000);
      repo.getLast2faVerifiedAt.mockResolvedValue(oldTime);

      await expect(paymentService.authoriseFirstAuth('pay-001', 'user-001')).rejects.toMatchObject({
        errorCode: PaymentErrorCode.TWO_FA_REVERIFICATION_REQUIRED,
      });
    });

    it('proceeds when 2FA verified within 60 minutes', async () => {
      const recentTime = new Date(Date.now() - 30 * 60 * 1000);
      repo.getLast2faVerifiedAt.mockResolvedValue(recentTime);
      repo.getPaymentByIdForUpdate.mockResolvedValue(makePayment());
      repo.recordFirstAuthWithClient.mockResolvedValue(
        makePayment({ status: PaymentStatus.PENDING_SECOND_AUTH, dual_auth_user_1: 'user-001' }),
      );
      repo.createAuditEntry.mockResolvedValue();
      repo.createAuditEntryWithClient.mockResolvedValue();

      const result = await paymentService.authoriseFirstAuth('pay-001', 'user-001');

      expect(result.status).toBe(PaymentStatus.PENDING_SECOND_AUTH);
    });
  });

  describe('authoriseSecondAuth', () => {
    it('throws TWO_FA_REVERIFICATION_REQUIRED when 2FA expired', async () => {
      const oldTime = new Date(Date.now() - 90 * 60 * 1000);
      repo.getLast2faVerifiedAt.mockResolvedValue(oldTime);

      await expect(paymentService.authoriseSecondAuth('pay-001', 'user-002')).rejects.toMatchObject(
        {
          errorCode: PaymentErrorCode.TWO_FA_REVERIFICATION_REQUIRED,
        },
      );
    });

    it('proceeds when 2FA verified within window', async () => {
      const recentTime = new Date(Date.now() - 5 * 60 * 1000);
      repo.getLast2faVerifiedAt.mockResolvedValue(recentTime);
      repo.getPaymentByIdForUpdate.mockResolvedValue(
        makePayment({
          status: PaymentStatus.PENDING_SECOND_AUTH,
          dual_auth_user_1: 'user-001',
        }),
      );
      repo.recordSecondAuthWithClient.mockResolvedValue(
        makePayment({
          status: PaymentStatus.EXECUTING,
          dual_auth_user_1: 'user-001',
          dual_auth_user_2: 'user-002',
        }),
      );
      repo.createAuditEntry.mockResolvedValue();
      repo.createAuditEntryWithClient.mockResolvedValue();

      const result = await paymentService.authoriseSecondAuth('pay-001', 'user-002');

      expect(result.status).toBe(PaymentStatus.EXECUTING);
    });
  });
});
