process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/payments/payments.service';
import * as repo from '../../../src/services/payments/payments.repository';
import { pool } from '../../../src/shared/database/pool';
import {
  PaymentStatus,
  PaymentProvider,
  PaymentErrorCode,
} from '../../../src/services/payments/payments.types';
import type {
  PaymentRecord,
  InvoiceForPayment,
  IPaymentProvider,
  PaymentProviderResult,
} from '../../../src/services/payments/payments.types';
import { BusinessRuleError, NotFoundError } from '../../../src/shared/errors';

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

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedPool = pool as jest.Mocked<typeof pool>;

function buildMockClient() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
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

function buildMockProvider(result?: Partial<PaymentProviderResult>): IPaymentProvider {
  return {
    name: PaymentProvider.EFT,
    execute: jest.fn().mockResolvedValue({
      success: true,
      transactionReference: 'txn-ref-123',
      providerReference: 'prov-ref-456',
      ...result,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('payments.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // initiatePayment — Step 1: On approval, create payment record
  // =========================================================================
  describe('initiatePayment', () => {
    it('creates payment record from approved invoice and transitions invoice status', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const invoice = buildInvoiceForPayment();
      const createdPayment = buildPaymentRecord({
        id: 'mock-uuid-v4',
        invoice_id: 'inv-1',
      });
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
      mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);
      mockedRepo.createPaymentWithClient.mockResolvedValue();
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue({ id: 'inv-1' });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();
      mockedRepo.getPaymentById.mockResolvedValue(createdPayment);

      const result = await service.initiatePayment('inv-1');

      expect(mockedRepo.getInvoiceForPayment).toHaveBeenCalledWith('inv-1');
      expect(mockedRepo.createPaymentWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          invoiceId: 'inv-1',
          amount: '8500000',
          provider: PaymentProvider.EFT,
          idempotencyKey: 'mock-uuid-v4',
        }),
      );
      // ROOT CAUSE fix: payment insert MUST be paired with invoice transition.
      expect(mockedRepo.updateInvoiceStatusWithClient).toHaveBeenCalledWith(
        expect.anything(),
        'inv-1',
        PaymentStatus.PENDING_FIRST_AUTH,
        'approved',
      );
      expect(result.invoice_id).toBe('inv-1');
      expect(result.status).toBe(PaymentStatus.PENDING_FIRST_AUTH);
    });

    it('runs createPayment → updateInvoiceStatus → audit → COMMIT in that order', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const invoice = buildInvoiceForPayment();
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
      mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);
      mockedRepo.createPaymentWithClient.mockResolvedValue();
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue({ id: 'inv-1' });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();
      mockedRepo.getPaymentById.mockResolvedValue(buildPaymentRecord({ id: 'mock-uuid-v4' }));

      await service.initiatePayment('inv-1');

      const createOrder = (mockedRepo.createPaymentWithClient as jest.Mock).mock
        .invocationCallOrder[0];
      const updateOrder = (mockedRepo.updateInvoiceStatusWithClient as jest.Mock).mock
        .invocationCallOrder[0];
      const auditOrder = (mockedRepo.createAuditEntryWithClient as jest.Mock).mock
        .invocationCallOrder[0];
      const commitCall = (mockClient.query.mock.calls as unknown[][]).find(
        (c) => c[0] === 'COMMIT',
      );
      expect(createOrder).toBeLessThan(updateOrder);
      expect(updateOrder).toBeLessThan(auditOrder);
      expect(commitCall).toBeDefined();

      // Audit captures the transition from approved → pending_first_auth.
      expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
        expect.anything(),
        null,
        'PAYMENT_CREATED',
        'payments',
        expect.any(String),
        expect.objectContaining({ invoiceStatus: 'approved' }),
        expect.objectContaining({
          invoiceStatus: PaymentStatus.PENDING_FIRST_AUTH,
          paymentStatus: PaymentStatus.PENDING_FIRST_AUTH,
        }),
      );
    });

    it('is idempotent — COMMITs payment row even when invoice already transitioned', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const invoice = buildInvoiceForPayment();
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
      mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);
      mockedRepo.createPaymentWithClient.mockResolvedValue();
      // WHERE guard didn't match — another worker already transitioned.
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue(null);
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();
      mockedRepo.getPaymentById.mockResolvedValue(buildPaymentRecord({ id: 'mock-uuid-v4' }));

      await expect(service.initiatePayment('inv-1')).resolves.toBeDefined();

      const commitCall = (mockClient.query.mock.calls as unknown[][]).find(
        (c) => c[0] === 'COMMIT',
      );
      const rollbackCall = (mockClient.query.mock.calls as unknown[][]).find(
        (c) => c[0] === 'ROLLBACK',
      );
      expect(commitCall).toBeDefined();
      expect(rollbackCall).toBeUndefined();
    });

    it('ROLLBACKs and skips audit when invoice transition rejects', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const invoice = buildInvoiceForPayment();
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
      mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);
      mockedRepo.createPaymentWithClient.mockResolvedValue();
      mockedRepo.updateInvoiceStatusWithClient.mockRejectedValue(new Error('DB error'));

      await expect(service.initiatePayment('inv-1')).rejects.toThrow('DB error');

      const rollbackCall = (mockClient.query.mock.calls as unknown[][]).find(
        (c) => c[0] === 'ROLLBACK',
      );
      const commitCall = (mockClient.query.mock.calls as unknown[][]).find(
        (c) => c[0] === 'COMMIT',
      );
      expect(rollbackCall).toBeDefined();
      expect(commitCall).toBeUndefined();
      expect(mockedRepo.createAuditEntryWithClient).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when invoice not found', async () => {
      mockedRepo.getInvoiceForPayment.mockResolvedValue(null);

      await expect(service.initiatePayment('no-exist')).rejects.toThrow(NotFoundError);
    });

    it('throws BusinessRuleError when invoice not approved', async () => {
      const invoice = buildInvoiceForPayment({ status: 'scored' });
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);

      await expect(service.initiatePayment('inv-1')).rejects.toThrow(BusinessRuleError);
    });

    it('returns existing payment on idempotency key match (no duplicate)', async () => {
      const invoice = buildInvoiceForPayment();
      const existingPayment = buildPaymentRecord();
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
      // Simulate: payment already exists for this invoice
      mockedRepo.getPaymentByInvoiceId.mockResolvedValue(existingPayment);

      const result = await service.initiatePayment('inv-1');

      expect(mockedRepo.createPaymentWithClient).not.toHaveBeenCalled();
      expect(result.id).toBe('pay-1');
    });
  });

  // =========================================================================
  // authoriseFirstAuth — Step 2: finance_manager records first auth
  // =========================================================================
  describe('authoriseFirstAuth', () => {
    it('records first auth by finance_manager', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord();
      mockedRepo.getLast2faVerifiedAt.mockResolvedValue(new Date());
      mockedRepo.getPaymentByIdForUpdate.mockResolvedValue(payment);
      mockedRepo.recordFirstAuthWithClient.mockResolvedValue(
        buildPaymentRecord({
          status: PaymentStatus.PENDING_SECOND_AUTH,
          dual_auth_user_1: 'fm-1',
        }),
      );
      mockedRepo.createAuditEntry.mockResolvedValue();
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      const result = await service.authoriseFirstAuth('pay-1', 'fm-1');

      expect(result.status).toBe(PaymentStatus.PENDING_SECOND_AUTH);
      expect(mockedRepo.recordFirstAuthWithClient).toHaveBeenCalledWith(
        expect.anything(),
        'pay-1',
        'fm-1',
      );
    });

    it('throws when payment not found', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      mockedRepo.getLast2faVerifiedAt.mockResolvedValue(new Date());
      mockedRepo.getPaymentByIdForUpdate.mockResolvedValue(null);
      mockedRepo.createAuditEntry.mockResolvedValue();

      await expect(service.authoriseFirstAuth('no-exist', 'fm-1')).rejects.toThrow(NotFoundError);
    });

    it('throws when payment not in pending_first_auth status', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.EXECUTING,
      });
      mockedRepo.getLast2faVerifiedAt.mockResolvedValue(new Date());
      mockedRepo.getPaymentByIdForUpdate.mockResolvedValue(payment);
      mockedRepo.createAuditEntry.mockResolvedValue();

      await expect(service.authoriseFirstAuth('pay-1', 'fm-1')).rejects.toThrow(BusinessRuleError);
    });
  });

  // =========================================================================
  // authoriseSecondAuth — Step 3: different finance_manager
  // =========================================================================
  describe('authoriseSecondAuth', () => {
    it('records second auth by different finance_manager', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.PENDING_SECOND_AUTH,
        dual_auth_user_1: 'fm-1',
      });
      mockedRepo.getLast2faVerifiedAt.mockResolvedValue(new Date());
      mockedRepo.getPaymentByIdForUpdate.mockResolvedValue(payment);
      mockedRepo.recordSecondAuthWithClient.mockResolvedValue(
        buildPaymentRecord({
          status: PaymentStatus.EXECUTING,
          dual_auth_user_1: 'fm-1',
          dual_auth_user_2: 'fm-2',
        }),
      );
      mockedRepo.createAuditEntry.mockResolvedValue();
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      const result = await service.authoriseSecondAuth('pay-1', 'fm-2');

      expect(result.status).toBe(PaymentStatus.EXECUTING);
      expect(mockedRepo.recordSecondAuthWithClient).toHaveBeenCalledWith(
        expect.anything(),
        'pay-1',
        'fm-2',
      );
    });

    it('blocks same user from both auth steps', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.PENDING_SECOND_AUTH,
        dual_auth_user_1: 'fm-1',
      });
      mockedRepo.getLast2faVerifiedAt.mockResolvedValue(new Date());
      mockedRepo.getPaymentByIdForUpdate.mockResolvedValue(payment);
      mockedRepo.createAuditEntry.mockResolvedValue();

      await expect(service.authoriseSecondAuth('pay-1', 'fm-1')).rejects.toThrow(BusinessRuleError);
    });

    it('throws when payment not in pending_second_auth status', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.PENDING_FIRST_AUTH,
      });
      mockedRepo.getLast2faVerifiedAt.mockResolvedValue(new Date());
      mockedRepo.getPaymentByIdForUpdate.mockResolvedValue(payment);
      mockedRepo.createAuditEntry.mockResolvedValue();

      await expect(service.authoriseSecondAuth('pay-1', 'fm-2')).rejects.toThrow(BusinessRuleError);
    });
  });

  // =========================================================================
  // executePayment — Step 4: call provider with idempotency key
  // =========================================================================
  describe('executePayment', () => {
    it('executes payment via provider and updates status to funded', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.EXECUTING,
        dual_auth_user_1: 'fm-1',
        dual_auth_user_2: 'fm-2',
      });
      const provider = buildMockProvider();

      mockedRepo.getPaymentById.mockResolvedValue(payment);
      mockedRepo.getByIdempotencyKey.mockResolvedValue(null);
      mockedRepo.updatePaymentResultWithClient.mockResolvedValue();
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue({ id: 'inv-1' });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      service.registerProvider(provider);

      const result = await service.executePayment('pay-1');

      expect(provider.execute).toHaveBeenCalledWith(payment, 'idem-1');
      expect(result.success).toBe(true);
      expect(result.transactionReference).toBe('txn-ref-123');
    });

    it('marks payment as failed on provider failure', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.EXECUTING,
        dual_auth_user_1: 'fm-1',
        dual_auth_user_2: 'fm-2',
      });
      const provider = buildMockProvider({
        success: false,
        failureReason: 'Insufficient funds',
        transactionReference: '',
        providerReference: '',
      });

      mockedRepo.getPaymentById.mockResolvedValue(payment);
      mockedRepo.getByIdempotencyKey.mockResolvedValue(null);
      mockedRepo.updatePaymentResultWithClient.mockResolvedValue();
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      service.registerProvider(provider);

      const result = await service.executePayment('pay-1');

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('Insufficient funds');
    });

    it('returns existing result when idempotency key already processed', async () => {
      const existingPayment = buildPaymentRecord({
        status: PaymentStatus.FUNDED,
        transaction_reference: 'txn-existing',
        provider_reference: 'prov-existing',
      });

      mockedRepo.getPaymentById.mockResolvedValue(
        buildPaymentRecord({
          status: PaymentStatus.EXECUTING,
          dual_auth_user_1: 'fm-1',
          dual_auth_user_2: 'fm-2',
        }),
      );
      // Already processed with this idempotency key
      mockedRepo.getByIdempotencyKey.mockResolvedValue(existingPayment);

      const result = await service.executePayment('pay-1');

      expect(result.success).toBe(true);
      expect(result.transactionReference).toBe('txn-existing');
    });

    it('throws when payment not in executing status', async () => {
      const payment = buildPaymentRecord({
        status: PaymentStatus.PENDING_FIRST_AUTH,
      });
      mockedRepo.getPaymentById.mockResolvedValue(payment);

      await expect(service.executePayment('pay-1')).rejects.toThrow(BusinessRuleError);
    });

    it('rolls back transaction on provider API exception', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.EXECUTING,
        dual_auth_user_1: 'fm-1',
        dual_auth_user_2: 'fm-2',
      });
      const provider: IPaymentProvider = {
        name: PaymentProvider.EFT,
        execute: jest.fn().mockRejectedValue(new Error('Network timeout')),
      };

      mockedRepo.getPaymentById.mockResolvedValue(payment);
      mockedRepo.getByIdempotencyKey.mockResolvedValue(null);
      mockedRepo.updatePaymentResultWithClient.mockResolvedValue();
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      service.registerProvider(provider);

      const result = await service.executePayment('pay-1');

      expect(result.success).toBe(false);
      expect(result.failureReason).toContain('Network timeout');
    });
  });

  // =========================================================================
  // checkSlaBreaches — Step 6: escalation when nearing 72hr SLA
  // =========================================================================
  describe('checkSlaBreaches', () => {
    it('triggers escalation for payments nearing SLA breach', async () => {
      const breachPayment = {
        id: 'pay-1',
        invoice_id: 'inv-1',
        amount: '8500000',
        status: PaymentStatus.PENDING_FIRST_AUTH,
        created_at: '2025-01-01T00:00:00Z',
        hours_pending: 67,
      };
      mockedRepo.getPaymentsPendingSLA.mockResolvedValue([breachPayment]);
      mockedRepo.createAuditEntry.mockResolvedValue();

      // Should not throw
      await service.checkSlaBreaches();

      expect(mockedRepo.getPaymentsPendingSLA).toHaveBeenCalled();
      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        null,
        'PAYMENT_SLA_BREACH',
        'payments',
        'pay-1',
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('does nothing when no SLA breaches', async () => {
      mockedRepo.getPaymentsPendingSLA.mockResolvedValue([]);

      await service.checkSlaBreaches();

      expect(mockedRepo.createAuditEntry).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getPendingPayments
  // =========================================================================
  describe('getPendingPayments', () => {
    it('returns enriched payments in pending auth states', async () => {
      const enrichedPayments = [
        {
          ...buildPaymentRecord(),
          invoice_number: 'INV-1',
          supplier_name: 'S',
          buyer_name: 'B',
          dual_auth_user_1_name: null,
          dual_auth_user_2_name: null,
        },
        {
          ...buildPaymentRecord({ id: 'pay-2' }),
          invoice_number: 'INV-2',
          supplier_name: 'S',
          buyer_name: 'B',
          dual_auth_user_1_name: null,
          dual_auth_user_2_name: null,
        },
      ];
      mockedRepo.getEnrichedPaymentsByStatuses.mockResolvedValueOnce(enrichedPayments);

      const result = await service.getPendingPayments();

      expect(result).toHaveLength(2);
    });
  });

  // =========================================================================
  // getPaymentDetails
  // =========================================================================
  describe('getPaymentDetails', () => {
    it('returns enriched payment when found', async () => {
      const payment = {
        ...buildPaymentRecord(),
        invoice_number: 'INV-1',
        supplier_name: 'S',
        buyer_name: 'B',
        dual_auth_user_1_name: null,
        dual_auth_user_2_name: null,
      };
      mockedRepo.getEnrichedPaymentById.mockResolvedValue(payment);

      const result = await service.getPaymentDetails('pay-1');

      expect(result).toEqual(payment);
    });

    it('throws NotFoundError when not found', async () => {
      mockedRepo.getEnrichedPaymentById.mockResolvedValue(null);

      await expect(service.getPaymentDetails('no-exist')).rejects.toThrow(NotFoundError);
    });
  });

  // =========================================================================
  // setNotificationQueue
  // =========================================================================
  describe('setNotificationQueue', () => {
    it('stores queue reference without error', () => {
      const mockQueue = { add: jest.fn() } as never;
      expect(() => service.setNotificationQueue(mockQueue)).not.toThrow();
    });
  });

  // =========================================================================
  // initiatePayment — PaymentError when creation fails
  // =========================================================================
  describe('initiatePayment — edge cases', () => {
    it('throws PaymentError when getPaymentById returns null after create', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const invoice = buildInvoiceForPayment();
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
      mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);
      mockedRepo.createPaymentWithClient.mockResolvedValue();
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue({ id: 'inv-1' });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();
      mockedRepo.getPaymentById.mockResolvedValue(null);

      await expect(service.initiatePayment('inv-1')).rejects.toThrow('Payment creation failed');
    });
  });

  // =========================================================================
  // authoriseFirstAuth — PaymentError when update fails
  // =========================================================================
  describe('authoriseFirstAuth — edge cases', () => {
    it('throws PaymentError when recordFirstAuthWithClient returns null', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord();
      mockedRepo.getLast2faVerifiedAt.mockResolvedValue(new Date());
      mockedRepo.getPaymentByIdForUpdate.mockResolvedValue(payment);
      mockedRepo.recordFirstAuthWithClient.mockResolvedValue(null);
      mockedRepo.createAuditEntry.mockResolvedValue();

      await expect(service.authoriseFirstAuth('pay-1', 'fm-1')).rejects.toThrow(
        'First auth update failed',
      );
    });
  });

  // =========================================================================
  // authoriseSecondAuth — additional edge cases
  // =========================================================================
  describe('authoriseSecondAuth — edge cases', () => {
    it('throws NotFoundError when payment not found', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      mockedRepo.getLast2faVerifiedAt.mockResolvedValue(new Date());
      mockedRepo.getPaymentByIdForUpdate.mockResolvedValue(null);
      mockedRepo.createAuditEntry.mockResolvedValue();

      await expect(service.authoriseSecondAuth('no-exist', 'fm-2')).rejects.toThrow(NotFoundError);
    });

    it('throws PaymentError when recordSecondAuthWithClient returns null', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.PENDING_SECOND_AUTH,
        dual_auth_user_1: 'fm-1',
      });
      mockedRepo.getLast2faVerifiedAt.mockResolvedValue(new Date());
      mockedRepo.getPaymentByIdForUpdate.mockResolvedValue(payment);
      mockedRepo.recordSecondAuthWithClient.mockResolvedValue(null);
      mockedRepo.createAuditEntry.mockResolvedValue();

      await expect(service.authoriseSecondAuth('pay-1', 'fm-2')).rejects.toThrow(
        'Second auth update failed',
      );
    });
  });

  // =========================================================================
  // executePayment — additional edge cases
  // =========================================================================
  describe('executePayment — edge cases', () => {
    it('throws NotFoundError when payment not found', async () => {
      mockedRepo.getPaymentById.mockResolvedValue(null);

      await expect(service.executePayment('no-exist')).rejects.toThrow(NotFoundError);
    });

    it('throws PaymentError when no provider registered', async () => {
      const payment = buildPaymentRecord({
        status: PaymentStatus.EXECUTING,
        provider: 'UNKNOWN_PROVIDER' as PaymentProvider,
      });
      mockedRepo.getPaymentById.mockResolvedValue(payment);
      mockedRepo.getByIdempotencyKey.mockResolvedValue(null);

      await expect(service.executePayment('pay-1')).rejects.toThrow('No provider registered');
    });
  });

  // =========================================================================
  // handleSuccessfulPayment — transaction rollback
  // =========================================================================
  describe('executePayment — successful payment rollback', () => {
    it('rolls back transaction and returns failure on DB error in handleSuccessfulPayment', async () => {
      const successClient = buildMockClient();
      const failClient = buildMockClient();
      // First connect: handleSuccessfulPayment transaction
      // Second connect: handleFailedPayment transaction (called from catch block)
      (mockedPool.connect as jest.Mock)
        .mockResolvedValueOnce(successClient)
        .mockResolvedValueOnce(failClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.EXECUTING,
        dual_auth_user_1: 'fm-1',
        dual_auth_user_2: 'fm-2',
      });
      const provider = buildMockProvider();

      mockedRepo.getPaymentById.mockResolvedValue(payment);
      mockedRepo.getByIdempotencyKey.mockResolvedValue(null);
      // First call (success path) rejects; second call (failure recording) succeeds
      mockedRepo.updatePaymentResultWithClient
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce(undefined);
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      service.registerProvider(provider);

      const result = await service.executePayment('pay-1');

      // The error is caught by executePayment's catch block
      // and returns a failed result instead of throwing
      expect(result.success).toBe(false);
      expect(result.failureReason).toContain('DB connection lost');
      expect(successClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(successClient.release).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // executePayment — line 505: queueSupplierNotification when queue IS null
  // line 235 branch 1: existingByKey.status !== FUNDED (other status returned)
  // line 236 branch 1: existingByKey is null (covered elsewhere but make explicit)
  // line 256 branch 1: err is not an Error instance (covers `err instanceof Error` false branch)
  // line 305 branch 1: MTN webhook isSuccess=true → handleSuccessful
  // line 351 branch 1: Airtel webhook isSuccess=true → handleSuccessful (already covered)
  // line 504 branch 0: notificationQueue IS null in queueSupplierNotification
  // line 533 branch 1: notificationQueue IS null in queueSlaEscalation
  // =========================================================================
  describe('executePayment — idempotency key already processed but not funded', () => {
    it('does NOT early-return when existing payment by idempotency key has non-funded status', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.EXECUTING,
        dual_auth_user_1: 'fm-1',
        dual_auth_user_2: 'fm-2',
      });
      const provider = buildMockProvider({
        success: true,
        transactionReference: 'new-txn-ref',
        providerReference: 'new-prov-ref',
      });

      // existingByKey has status EXECUTING (not FUNDED) → branch 1 of line 232
      const existingNonFunded = buildPaymentRecord({
        status: PaymentStatus.EXECUTING,
        transaction_reference: 'old-txn',
      });

      mockedRepo.getPaymentById.mockResolvedValue(payment);
      mockedRepo.getByIdempotencyKey.mockResolvedValue(existingNonFunded);
      mockedRepo.updatePaymentResultWithClient.mockResolvedValue();
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue({ id: 'inv-1' });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      service.registerProvider(provider);
      // notification queue is null → covers line 504 branch 0
      service.setNotificationQueue(null as never);

      const result = await service.executePayment('pay-1');

      // Should have called provider.execute (no early-return)
      expect(provider.execute).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('queueSlaEscalation — null notification queue (line 533 branch 1)', () => {
    it('logs warning and returns without queuing when notification queue is null', async () => {
      service.setNotificationQueue(null as never);

      const breachPayment = {
        id: 'pay-breach',
        invoice_id: 'inv-breach',
        amount: '8500000',
        status: PaymentStatus.PENDING_FIRST_AUTH,
        created_at: '2025-01-01T00:00:00Z',
        hours_pending: 67,
      };
      mockedRepo.getPaymentsPendingSLA.mockResolvedValue([breachPayment]);
      mockedRepo.createAuditEntry.mockResolvedValue();

      // should not throw
      await service.checkSlaBreaches();

      expect(mockedRepo.createAuditEntry).toHaveBeenCalled();
    });
  });

  describe('executePayment — non-Error exception (line 256 branch 1)', () => {
    it('handles non-Error thrown values (e.g. string) during provider.execute', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.EXECUTING,
        dual_auth_user_1: 'fm-1',
        dual_auth_user_2: 'fm-2',
      });
      const provider: IPaymentProvider = {
        name: PaymentProvider.EFT,
        // Throw a non-Error (string) to hit the `err instanceof Error` false branch
        execute: jest.fn().mockRejectedValue('non-error-string'),
      };

      mockedRepo.getPaymentById.mockResolvedValue(payment);
      mockedRepo.getByIdempotencyKey.mockResolvedValue(null);
      mockedRepo.updatePaymentResultWithClient.mockResolvedValue();
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      service.registerProvider(provider);

      const result = await service.executePayment('pay-1');

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('Unknown error');
    });
  });

  // =========================================================================
  // Queue operations when notification queue IS configured
  // =========================================================================
  describe('queue operations — configured', () => {
    it('queues supplier notification after successful payment', async () => {
      const mockNotifQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockNotifQueue as never);

      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const payment = buildPaymentRecord({
        status: PaymentStatus.EXECUTING,
        dual_auth_user_1: 'fm-1',
        dual_auth_user_2: 'fm-2',
      });
      const provider = buildMockProvider();

      mockedRepo.getPaymentById.mockResolvedValue(payment);
      mockedRepo.getByIdempotencyKey.mockResolvedValue(null);
      mockedRepo.updatePaymentResultWithClient.mockResolvedValue();
      mockedRepo.updateInvoiceStatusWithClient.mockResolvedValue({ id: 'inv-1' });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      service.registerProvider(provider);

      await service.executePayment('pay-1');

      expect(mockNotifQueue.add).toHaveBeenCalledWith(
        'payment-funded',
        expect.objectContaining({ paymentId: 'pay-1', invoiceId: 'inv-1' }),
        expect.objectContaining({ attempts: 3 }),
      );

      // Clean up
      service.setNotificationQueue(null as never);
    });

    it('queues SLA escalation when breaches found and queue configured', async () => {
      const mockNotifQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockNotifQueue as never);

      const breachPayment = {
        id: 'pay-1',
        invoice_id: 'inv-1',
        amount: '8500000',
        status: PaymentStatus.PENDING_FIRST_AUTH,
        created_at: '2025-01-01T00:00:00Z',
        hours_pending: 67,
      };
      mockedRepo.getPaymentsPendingSLA.mockResolvedValue([breachPayment]);
      mockedRepo.createAuditEntry.mockResolvedValue();

      await service.checkSlaBreaches();

      expect(mockNotifQueue.add).toHaveBeenCalledWith(
        'payment-sla-escalation',
        expect.objectContaining({
          paymentId: 'pay-1',
          invoiceId: 'inv-1',
          escalatedTo: 'management',
        }),
        expect.objectContaining({ attempts: 3 }),
      );

      // Clean up
      service.setNotificationQueue(null as never);
    });
  });

  // =========================================================================
  // MTN/Airtel webhook — missing reason/message fallback branches
  // (line 305: payload.reason ?? 'MTN callback: failed')
  // (line 351: payload.transaction.message ?? 'Airtel callback: failed')
  // =========================================================================
  // =========================================================================
  // executePayment — null transaction_reference/provider_reference branches
  // (lines 235, 236: existingByKey.transaction_reference ?? '' and
  //  existingByKey.provider_reference ?? '')
  // =========================================================================
  describe('executePayment — idempotency FUNDED with null references', () => {
    it('falls back to empty string when funded payment has null transaction_reference and provider_reference', async () => {
      const existingFundedNullRefs = buildPaymentRecord({
        status: PaymentStatus.FUNDED,
        transaction_reference: null,
        provider_reference: null,
      });

      mockedRepo.getPaymentById.mockResolvedValue(
        buildPaymentRecord({
          status: PaymentStatus.EXECUTING,
          dual_auth_user_1: 'fm-1',
          dual_auth_user_2: 'fm-2',
        }),
      );
      mockedRepo.getByIdempotencyKey.mockResolvedValue(existingFundedNullRefs);

      const result = await service.executePayment('pay-1');

      expect(result.success).toBe(true);
      // Both ?? '' branches covered: null refs fall back to ''
      expect(result.transactionReference).toBe('');
      expect(result.providerReference).toBe('');
    });
  });

  // =========================================================================
  // AML gate — three-column atomic clearance behaviour (issue #37)
  // =========================================================================
  describe('AML gate — aml_cleared_at semantics', () => {
    it('proceeds when aml_flagged=false (no AML concern at all)', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const invoice = buildInvoiceForPayment({
        face_value: '500000000', // well over threshold
        aml_flagged: false,
        aml_cleared_at: null,
      });
      const createdPayment = buildPaymentRecord({ id: 'mock-uuid-v4' });
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
      mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);
      mockedRepo.createPaymentWithClient.mockResolvedValue();
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();
      mockedRepo.getPaymentById.mockResolvedValue(createdPayment);

      const result = await service.initiatePayment('inv-1');
      expect(result.id).toBe('mock-uuid-v4');
    });

    it('throws AML_FLAG_REQUIRED when flagged + uncleared + over threshold', async () => {
      const invoice = buildInvoiceForPayment({
        face_value: '150000000',
        aml_flagged: true,
        aml_cleared_at: null,
      });
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
      mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);

      await expect(service.initiatePayment('inv-1')).rejects.toMatchObject({
        errorCode: PaymentErrorCode.AML_FLAG_REQUIRED,
      });
    });

    it('proceeds when flagged but ALREADY CLEARED — issue #37 fix', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const invoice = buildInvoiceForPayment({
        face_value: '150000000',
        aml_flagged: true,
        aml_cleared_at: '2026-04-30T10:00:00Z',
      });
      const createdPayment = buildPaymentRecord({ id: 'mock-uuid-v4' });
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
      mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);
      mockedRepo.createPaymentWithClient.mockResolvedValue();
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();
      mockedRepo.getPaymentById.mockResolvedValue(createdPayment);

      const result = await service.initiatePayment('inv-1');
      // Without the fix the gate would have thrown AML_FLAG_REQUIRED.
      expect(result.id).toBe('mock-uuid-v4');
    });

    it('proceeds when flagged + uncleared + UNDER threshold (gate non-applicable)', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      const invoice = buildInvoiceForPayment({
        face_value: '50000000', // under 100M threshold
        aml_flagged: true,
        aml_cleared_at: null,
      });
      const createdPayment = buildPaymentRecord({ id: 'mock-uuid-v4' });
      mockedRepo.getInvoiceForPayment.mockResolvedValue(invoice);
      mockedRepo.getPaymentByInvoiceId.mockResolvedValue(null);
      mockedRepo.createPaymentWithClient.mockResolvedValue();
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();
      mockedRepo.getPaymentById.mockResolvedValue(createdPayment);

      const result = await service.initiatePayment('inv-1');
      expect(result.id).toBe('mock-uuid-v4');
    });
  });

  // =========================================================================
  // handleTerminalWorkerFailure — non-negotiable #12 (audit + notify on
  // worker retries exhausted; no PII; 30_000ms backoff)
  // =========================================================================
  describe('handleTerminalWorkerFailure', () => {
    it('writes a PAYMENT_INITIATION_FAILED audit row with no PII', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();
      service.setNotificationQueue(null as never);

      await service.handleTerminalWorkerFailure('inv-9', 'PROVIDER_TIMEOUT');

      expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
        expect.anything(),
        null, // system action — no user
        'PAYMENT_INITIATION_FAILED',
        'invoices',
        'inv-9',
        expect.objectContaining({ status: 'approved' }),
        expect.objectContaining({
          errorCode: 'PROVIDER_TIMEOUT',
          retriesExhausted: true,
        }),
      );
      // PII guard — audit newValues must not contain supplier/buyer/email/phone fields.
      const auditCall = (mockedRepo.createAuditEntryWithClient as jest.Mock).mock
        .calls[0] as unknown[];
      const newValues = auditCall[6];
      expect(JSON.stringify(newValues)).not.toMatch(/supplier|buyer|company|email|phone|bank/i);
    });

    it('enqueues finance_manager notification with 30_000ms exponential backoff', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
      const mockNotifQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockNotifQueue as never);
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      await service.handleTerminalWorkerFailure('inv-10', 'WORKER_EXHAUSTED');

      expect(mockNotifQueue.add).toHaveBeenCalledWith(
        'payment_failed',
        expect.objectContaining({
          invoiceId: 'inv-10',
          type: 'finance_manager_notify',
          reason: 'worker_retries_exhausted',
        }),
        { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );

      service.setNotificationQueue(null as never);
    });

    it('logs warn and does NOT throw when notificationQueue is null', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();
      service.setNotificationQueue(null as never);

      await expect(
        service.handleTerminalWorkerFailure('inv-11', 'CODE_X'),
      ).resolves.toBeUndefined();
    });

    it('ROLLBACKs and re-throws when audit insert fails', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);
      mockedRepo.createAuditEntryWithClient.mockRejectedValue(new Error('DB error'));
      service.setNotificationQueue(null as never);

      await expect(service.handleTerminalWorkerFailure('inv-12', 'CODE_X')).rejects.toThrow(
        'DB error',
      );

      const queryCalls = mockClient.query.mock.calls as unknown[][];
      const rollback = queryCalls.find((c) => c[0] === 'ROLLBACK');
      const commit = queryCalls.find((c) => c[0] === 'COMMIT');
      expect(rollback).toBeDefined();
      expect(commit).toBeUndefined();
    });
  });
});
