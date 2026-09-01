process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import type { QueryResultRow } from 'pg';
import * as repo from '../../../src/services/payments/payments.repository';
import { query } from '../../../src/shared/database/pool';
import { PaymentStatus, PaymentProvider } from '../../../src/services/payments/payments.types';

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

const mockedQuery = query as jest.MockedFunction<typeof query>;

function mockQueryResult(rows: QueryResultRow[] = [], rowCount = 0) {
  return {
    rows,
    rowCount,
    command: 'SELECT' as const,
    oid: 0,
    fields: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('payments.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // createPayment
  // =========================================================================
  describe('createPayment', () => {
    it('inserts a payment record with idempotency_key', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 1));

      await repo.createPayment({
        id: 'pay-1',
        invoiceId: 'inv-1',
        amount: '5000000',
        provider: PaymentProvider.EFT,
        idempotencyKey: 'idem-key-1',
      });

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO payments');
      expect(params).toContain('pay-1');
      expect(params).toContain('inv-1');
      expect(params).toContain('5000000');
      expect(params).toContain(PaymentProvider.EFT);
      expect(params).toContain('idem-key-1');
    });
  });

  // =========================================================================
  // recordFirstAuth
  // =========================================================================
  describe('recordFirstAuth', () => {
    it('updates dual_auth_user_1 and status to pending_second_auth', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([{ id: 'pay-1' }], 1));

      const result = await repo.recordFirstAuth('pay-1', 'user-fm-1');

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('dual_auth_user_1');
      expect(params).toContain(PaymentStatus.PENDING_SECOND_AUTH);
      expect(params).toContain('pay-1');
      expect(params).toContain('user-fm-1');
      expect(result).toBeDefined();
    });

    it('returns null when payment not found', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.recordFirstAuth('no-exist', 'user-1');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // recordSecondAuth
  // =========================================================================
  describe('recordSecondAuth', () => {
    it('updates dual_auth_user_2 and status to executing', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([{ id: 'pay-1' }], 1));

      const result = await repo.recordSecondAuth('pay-1', 'user-fm-2');

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('dual_auth_user_2');
      expect(params).toContain(PaymentStatus.EXECUTING);
      expect(params).toContain('pay-1');
      expect(params).toContain('user-fm-2');
      expect(result).toBeDefined();
    });

    it('returns null when payment not found (null branch)', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.recordSecondAuth('no-exist', 'user-1');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // updatePaymentResult
  // =========================================================================
  describe('updatePaymentResult', () => {
    it('updates status to funded with references on success', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([{ id: 'pay-1' }], 1));

      await repo.updatePaymentResult('pay-1', {
        success: true,
        transactionReference: 'txn-ref-123',
        providerReference: 'prov-ref-456',
      });

      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(params).toContain(PaymentStatus.FUNDED);
      expect(sql).toContain('funded_at');
      expect(params).toContain('txn-ref-123');
      expect(params).toContain('prov-ref-456');
    });

    it('updates status to failed with failure_reason on failure', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([{ id: 'pay-1' }], 1));

      await repo.updatePaymentResult('pay-1', {
        success: false,
        transactionReference: '',
        providerReference: '',
        failureReason: 'Insufficient funds',
      });

      const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(params).toContain(PaymentStatus.FAILED);
      expect(params).toContain('Insufficient funds');
    });

    it('falls back to "Unknown error" when failureReason is undefined', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      await repo.updatePaymentResult('pay-1', {
        success: false,
        transactionReference: '',
        providerReference: '',
        // failureReason intentionally omitted to trigger ?? fallback
      });

      const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(params).toContain('Unknown error');
    });
  });

  // =========================================================================
  // getByIdempotencyKey
  // =========================================================================
  describe('getByIdempotencyKey', () => {
    it('returns existing payment when idempotency key matches', async () => {
      const row = {
        id: 'pay-1',
        invoice_id: 'inv-1',
        amount: '5000000',
        provider: 'EFT',
        status: 'funded',
        idempotency_key: 'idem-1',
        dual_auth_user_1: 'u1',
        dual_auth_timestamp_1: null,
        dual_auth_user_2: 'u2',
        dual_auth_timestamp_2: null,
        transaction_reference: 'txn-1',
        provider_reference: 'prov-1',
        funded_at: '2025-01-01',
        failure_reason: null,
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      };
      mockedQuery.mockResolvedValue(mockQueryResult([row], 1));

      const result = await repo.getByIdempotencyKey('idem-1');

      expect(result).toEqual(row);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('idempotency_key');
      expect(params).toContain('idem-1');
    });

    it('returns null when no match', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.getByIdempotencyKey('no-match');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getPaymentsPendingSLA
  // =========================================================================
  describe('getPaymentsPendingSLA', () => {
    it('returns payments within 6 hours of 72hr SLA breach', async () => {
      const row = {
        id: 'pay-1',
        invoice_id: 'inv-1',
        amount: '5000000',
        status: 'pending_first_auth',
        created_at: '2025-01-01',
        hours_pending: 67,
      };
      mockedQuery.mockResolvedValue(mockQueryResult([row], 1));

      const result = await repo.getPaymentsPendingSLA();

      expect(result).toHaveLength(1);
      expect(result[0].hours_pending).toBe(67);
      const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('72');
    });
  });

  // =========================================================================
  // getPaymentById
  // =========================================================================
  describe('getPaymentById', () => {
    it('returns payment when found', async () => {
      const row = {
        id: 'pay-1',
        invoice_id: 'inv-1',
        amount: '5000000',
        provider: 'EFT',
        status: 'pending_first_auth',
        idempotency_key: 'idem-1',
        dual_auth_user_1: null,
        dual_auth_timestamp_1: null,
        dual_auth_user_2: null,
        dual_auth_timestamp_2: null,
        transaction_reference: null,
        provider_reference: null,
        funded_at: null,
        failure_reason: null,
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      };
      mockedQuery.mockResolvedValue(mockQueryResult([row], 1));

      const result = await repo.getPaymentById('pay-1');

      expect(result).toEqual(row);
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.getPaymentById('no-exist');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getPaymentsByStatus
  // =========================================================================
  describe('getPaymentsByStatus', () => {
    it('returns payments matching status', async () => {
      const rows = [
        { id: 'pay-1', status: 'pending_first_auth' },
        { id: 'pay-2', status: 'pending_first_auth' },
      ];
      mockedQuery.mockResolvedValue(mockQueryResult(rows, 2));

      const result = await repo.getPaymentsByStatus(PaymentStatus.PENDING_FIRST_AUTH);

      expect(result).toHaveLength(2);
    });
  });

  // =========================================================================
  // getInvoiceForPayment
  // =========================================================================
  describe('getInvoiceForPayment', () => {
    it('SELECTs aml_cleared_at so the payment guard can read clearance state', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      await repo.getInvoiceForPayment('inv-1');

      const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('aml_cleared_at');
      expect(sql).toContain('aml_flagged');
    });

    it('returns invoice joined with supplier payment method', async () => {
      const row = {
        id: 'inv-1',
        face_value: '10000000',
        advance_amount: '8500000',
        status: 'approved',
        supplier_id: 'sup-1',
        buyer_id: 'buy-1',
        preferred_payment_method: 'EFT',
      };
      mockedQuery.mockResolvedValue(mockQueryResult([row], 1));

      const result = await repo.getInvoiceForPayment('inv-1');

      expect(result).toEqual(row);
      const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('preferred_payment_method');
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.getInvoiceForPayment('no-exist');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // updatePaymentResultWithClient
  // =========================================================================
  describe('updatePaymentResultWithClient', () => {
    it('updates to funded on success within transaction', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 1)),
      };

      await repo.updatePaymentResultWithClient(
        mockClient as unknown as import('pg').PoolClient,
        'pay-1',
        {
          success: true,
          transactionReference: 'txn-ref-123',
          providerReference: 'prov-ref-456',
        },
      );

      const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(params).toContain(PaymentStatus.FUNDED);
      expect(params).toContain('txn-ref-123');
    });

    it('updates to failed on failure within transaction', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 1)),
      };

      await repo.updatePaymentResultWithClient(
        mockClient as unknown as import('pg').PoolClient,
        'pay-1',
        {
          success: false,
          transactionReference: '',
          providerReference: '',
          failureReason: 'Network error',
        },
      );

      const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(params).toContain(PaymentStatus.FAILED);
      expect(params).toContain('Network error');
    });

    it('falls back to "Unknown error" when failureReason is undefined within transaction', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 1)),
      };

      await repo.updatePaymentResultWithClient(
        mockClient as unknown as import('pg').PoolClient,
        'pay-1',
        {
          success: false,
          transactionReference: '',
          providerReference: '',
          // failureReason intentionally omitted
        },
      );

      const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(params).toContain('Unknown error');
    });
  });

  // =========================================================================
  // getPaymentByInvoiceId
  // =========================================================================
  describe('getPaymentByInvoiceId', () => {
    it('returns payment by invoice id', async () => {
      const row = { id: 'pay-1', invoice_id: 'inv-1' };
      mockedQuery.mockResolvedValue(mockQueryResult([row], 1));

      const result = await repo.getPaymentByInvoiceId('inv-1');

      expect(result).toEqual(row);
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.getPaymentByInvoiceId('no-exist');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // createAuditEntry
  // =========================================================================
  describe('createAuditEntry', () => {
    it('inserts audit log entry', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 1));

      await repo.createAuditEntry(
        'user-1',
        'PAYMENT_CREATED',
        'payments',
        'pay-1',
        { before: 'none' },
        { after: 'pending_first_auth' },
      );

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO audit_logs');
    });

    it('passes null for ipAddress and userAgent when omitted (??  null branches)', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 1));

      await repo.createAuditEntry(
        null,
        'PAYMENT_FUNDED',
        'payments',
        'pay-1',
        {},
        { status: 'funded' },
        // ipAddress and userAgent intentionally omitted
      );

      const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(params[6]).toBeNull();
      expect(params[7]).toBeNull();
    });
  });

  // =========================================================================
  // createAuditEntryWithClient
  // =========================================================================
  describe('createAuditEntryWithClient', () => {
    it('inserts audit log entry using transaction client', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 1)),
      };

      await repo.createAuditEntryWithClient(
        mockClient as unknown as import('pg').PoolClient,
        'user-1',
        'PAYMENT_FUNDED',
        'payments',
        'pay-1',
        { before: 'executing' },
        { after: 'funded' },
      );

      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // updateInvoiceStatusWithClient
  // =========================================================================
  describe('updateInvoiceStatusWithClient', () => {
    it('updates invoice status within a transaction', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([{ id: 'inv-1' }], 1)),
      };

      const result = await repo.updateInvoiceStatusWithClient(
        mockClient as unknown as import('pg').PoolClient,
        'inv-1',
        'pending_first_auth',
        'approved',
      );

      expect(result).toBeDefined();
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE invoices');
      expect(params).toContain('pending_first_auth');
      expect(params).toContain('approved');
    });

    it('returns null when no row updated', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue(mockQueryResult([], 0)),
      };

      const result = await repo.updateInvoiceStatusWithClient(
        mockClient as unknown as import('pg').PoolClient,
        'inv-1',
        'pending_first_auth',
        'wrong_status',
      );

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getPaymentByTransactionRef
  // =========================================================================
  describe('getPaymentByTransactionRef', () => {
    it('returns payment by transaction reference', async () => {
      const row = {
        id: 'pay-1',
        transaction_reference: 'txn-ref-123',
      };
      mockedQuery.mockResolvedValue(mockQueryResult([row], 1));

      const result = await repo.getPaymentByTransactionRef('txn-ref-123');

      expect(result).toEqual(row);
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.getPaymentByTransactionRef('no-exist');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // checkWebhookIdempotency
  // =========================================================================
  describe('checkWebhookIdempotency', () => {
    it('returns true when the webhook event already exists', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([{ exists: true }], 1));

      const result = await repo.checkWebhookIdempotency('EFT', 'event-abc');

      expect(result).toBe(true);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('webhook_events');
      expect(params).toContain('EFT');
      expect(params).toContain('event-abc');
    });

    it('returns false when the webhook event has not been seen', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([{ exists: false }], 1));

      const result = await repo.checkWebhookIdempotency('EFT', 'new-event');

      expect(result).toBe(false);
    });

    it('returns false as fallback when rows is empty (??  false branch)', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.checkWebhookIdempotency('EFT', 'no-row');

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // recordWebhookEvent
  // =========================================================================
  describe('recordWebhookEvent', () => {
    it('inserts a webhook event record with ON CONFLICT DO NOTHING', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 1));

      await repo.recordWebhookEvent('EFT', 'event-xyz', {
        type: 'PAYMENT_SUCCESS',
        amount: 5000000,
      });

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO webhook_events');
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO NOTHING');
      expect(params).toContain('EFT');
      expect(params).toContain('event-xyz');
      expect(params).toContain('processed');
    });

    it('serialises the payload as JSON', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const payload = { ref: 'ref-1', status: 'SUCCESS' };
      await repo.recordWebhookEvent('EFT', 'evt-1', payload);

      const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(params[2]).toBe(JSON.stringify(payload));
    });
  });

  // =========================================================================
  // findOrphanedApprovedInvoices — PII-free orphan triage query
  // =========================================================================
  describe('findOrphanedApprovedInvoices', () => {
    const ORPHAN_ROWS = [
      {
        invoice_id: '11111111-1111-1111-1111-111111111111',
        supplier_id: '22222222-2222-2222-2222-222222222222',
        face_value: '5000000',
        approved_at: '2026-05-20T10:00:00.000Z',
        age_hours: 1.5,
      },
    ];

    it('uses the orphan-detection LEFT JOIN with the 5-minute grace WHERE clause', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult(ORPHAN_ROWS, 1));

      await repo.findOrphanedApprovedInvoices();

      const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('LEFT JOIN payments p ON p.invoice_id = i.id');
      expect(sql).toMatch(/WHERE\s+i\.status\s*=\s*'approved'/);
      expect(sql).toContain('p.id IS NULL');
      expect(sql).toContain("INTERVAL '5 minutes'");
      expect(params).toEqual([]);
    });

    it('SELECTs only non-PII columns — no company_name / email / phone (PII regression guard)', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult(ORPHAN_ROWS, 1));

      await repo.findOrphanedApprovedInvoices();

      const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];

      // Must contain the safe identifier + numeric columns.
      expect(sql).toMatch(/i\.id\s+AS\s+invoice_id/);
      expect(sql).toContain('i.supplier_id');
      expect(sql).toMatch(/i\.face_value::text\s+AS\s+face_value/);
      expect(sql).toMatch(/i\.updated_at\s+AS\s+approved_at/);
      expect(sql).toMatch(/EXTRACT\(EPOCH FROM \(NOW\(\) - i\.updated_at\)\) \/ 3600 AS age_hours/);

      // Must NOT leak any PII columns — these are the regression guards.
      expect(sql).not.toMatch(/s\.company_name/);
      expect(sql).not.toMatch(/b\.company_name/);
      expect(sql).not.toMatch(/email/i);
      expect(sql).not.toMatch(/phone/i);
    });

    it('returns the mocked rows unchanged', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult(ORPHAN_ROWS, 1));

      const result = await repo.findOrphanedApprovedInvoices();

      expect(result).toEqual(ORPHAN_ROWS);
    });

    it('returns an empty array when no orphans exist', async () => {
      mockedQuery.mockResolvedValue(mockQueryResult([], 0));

      const result = await repo.findOrphanedApprovedInvoices();

      expect(result).toEqual([]);
    });
  });
});
