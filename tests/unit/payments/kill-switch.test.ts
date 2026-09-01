process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/payments/payments.service';
import * as repo from '../../../src/services/payments/payments.repository';
import {
  PaymentStatus,
  PaymentProvider,
  PaymentErrorCode,
} from '../../../src/services/payments/payments.types';
import type {
  PaymentRecord,
  InvoiceForPayment,
} from '../../../src/services/payments/payments.types';
import { BusinessRuleError } from '../../../src/shared/errors';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
}));

jest.mock('../../../src/services/payments/payments.repository');
jest.mock('../../../src/services/collateral/collateral.service', () => ({
  checkCoverageRatio: jest.fn().mockResolvedValue({
    totalCollateral: '50000000',
    faceValue: '42500000',
    ratio: 1.18,
    sufficient: true,
  }),
}));
jest.mock('../../../src/services/facilities/facilities.repository', () => ({
  getActiveFacilities: jest.fn().mockResolvedValue([
    {
      id: 'facility-1',
      bank_name: 'Test Bank',
      total_limit: '1000000000',
      drawn_amount: '100000000',
      available_amount: '900000000',
      annual_rate: '0.15',
      maturity_date: '2027-12-31',
      status: 'active',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
  ]),
}));
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

import { pool } from '../../../src/shared/database/pool';

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedPool = pool as jest.Mocked<typeof pool>;

function buildMockClient() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
}

function buildInvoiceForPayment(overrides: Partial<InvoiceForPayment> = {}): InvoiceForPayment {
  return {
    id: 'inv-1',
    face_value: '10000000',
    advance_amount: '8500000',
    status: 'approved',
    supplier_id: 'sup-1',
    buyer_id: 'buy-1',
    preferred_payment_method: PaymentProvider.EFT,
    aml_flagged: false,
    aml_cleared_at: null,
    ...overrides,
  };
}

function buildPaymentRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'pay-1',
    invoice_id: 'inv-1',
    amount: '8500000',
    provider: PaymentProvider.EFT,
    status: PaymentStatus.PENDING_FIRST_AUTH,
    idempotency_key: 'idem-1',
    dual_auth_user_1: null,
    dual_auth_timestamp_1: null,
    dual_auth_user_2: null,
    dual_auth_timestamp_2: null,
    transaction_reference: null,
    provider_reference: null,
    funded_at: null,
    failure_reason: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Payment kill switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks payment initiation when kill switch is enabled', async () => {
    mockedRepo.getSystemSetting.mockResolvedValue('true');

    await expect(service.initiatePayment('inv-1')).rejects.toThrow(BusinessRuleError);
    await expect(service.initiatePayment('inv-1')).rejects.toMatchObject({
      errorCode: PaymentErrorCode.PAYMENTS_HALTED,
    });

    // Should not reach invoice lookup
    expect(mockedRepo.getInvoiceForPayment).not.toHaveBeenCalled();
  });

  it('allows payment initiation when kill switch is disabled', async () => {
    const mockClient = buildMockClient();
    (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

    mockedRepo.getSystemSetting.mockResolvedValue('false');

    const invoice = buildInvoiceForPayment();
    const createdPayment = buildPaymentRecord({ id: 'mock-uuid-v4' });
    mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
    mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);
    mockedRepo.createPaymentWithClient.mockResolvedValue();
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();
    mockedRepo.getPaymentById.mockResolvedValue(createdPayment);

    const result = await service.initiatePayment('inv-1');

    expect(result.id).toBe('mock-uuid-v4');
    expect(mockedRepo.getInvoiceForPayment).toHaveBeenCalledWith('inv-1');
  });

  it('allows payment initiation when kill switch setting does not exist', async () => {
    const mockClient = buildMockClient();
    (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

    mockedRepo.getSystemSetting.mockResolvedValue(null);

    const invoice = buildInvoiceForPayment();
    const createdPayment = buildPaymentRecord({ id: 'mock-uuid-v4' });
    mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
    mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);
    mockedRepo.createPaymentWithClient.mockResolvedValue();
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();
    mockedRepo.getPaymentById.mockResolvedValue(createdPayment);

    const result = await service.initiatePayment('inv-1');

    expect(result.id).toBe('mock-uuid-v4');
  });

  describe('activateKillSwitch (REQ-PAYMENT-010)', () => {
    it('flips the setting + force-fails executing payments + audits each one', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
      mockedRepo.setSystemSettingWithClient.mockResolvedValue();
      mockedRepo.failExecutingPaymentsWithClient.mockResolvedValue(['pay-A', 'pay-B']);
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      const result = await service.activateKillSwitch(
        'mgmt-user',
        'Emergency halt — incident #42',
        '10.0.0.1',
        'curl',
      );

      expect(result.activated).toBe(true);
      expect(result.suspendedPaymentIds).toEqual(['pay-A', 'pay-B']);
      expect(mockedRepo.setSystemSettingWithClient).toHaveBeenCalledWith(
        mockClient,
        'payment_kill_switch',
        'true',
      );
      // Per-payment PAYMENT_FAILED audit + the KILL_SWITCH_ACTIVATED audit = 3 calls.
      expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledTimes(3);
    });

    it('rolls back the transaction if the setting write fails', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
      mockedRepo.setSystemSettingWithClient.mockRejectedValueOnce(new Error('boom'));

      await expect(
        service.activateKillSwitch('mgmt-user', 'r'.repeat(25), 'ip', 'ua'),
      ).rejects.toThrow('boom');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('deactivateKillSwitch (REQ-PAYMENT-010)', () => {
    it('flips the setting to false + audits, does NOT auto-resume failed payments', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
      mockedRepo.setSystemSettingWithClient.mockResolvedValue();
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      await service.deactivateKillSwitch(
        'mgmt-user',
        'Incident resolved, payments resumed',
        '10.0.0.1',
        'curl',
      );

      expect(mockedRepo.setSystemSettingWithClient).toHaveBeenCalledWith(
        mockClient,
        'payment_kill_switch',
        'false',
      );
      expect(mockedRepo.failExecutingPaymentsWithClient).not.toHaveBeenCalled();
      expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
        mockClient,
        'mgmt-user',
        'KILL_SWITCH_DEACTIVATED',
        'system_settings',
        'payment_kill_switch',
        { active: true },
        expect.objectContaining({ active: false }),
        '10.0.0.1',
        'curl',
      );
    });
  });

  describe('isKillSwitchActive (REQ-PAYMENT-010)', () => {
    it('returns true when setting is "true"', async () => {
      mockedRepo.getSystemSetting.mockResolvedValueOnce('true');
      expect(await service.isKillSwitchActive()).toBe(true);
    });
    it('returns false when setting is "false"', async () => {
      mockedRepo.getSystemSetting.mockResolvedValueOnce('false');
      expect(await service.isKillSwitchActive()).toBe(false);
    });
    it('returns false when setting is missing', async () => {
      mockedRepo.getSystemSetting.mockResolvedValueOnce(null);
      expect(await service.isKillSwitchActive()).toBe(false);
    });
  });
});
