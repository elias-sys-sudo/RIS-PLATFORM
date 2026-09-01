process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as repo from '../../../src/services/collections/collections.repository';
import { query } from '../../../src/shared/database/pool';
import { CollectionStatus } from '../../../src/services/collections/collections.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

const mockClient = {
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  release: jest.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const INVOICE_ID = 'inv-uuid-1';
const COLLECTION_ID = 'col-uuid-1';
const BUYER_ID = 'buyer-uuid-1';

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// createOverdueRecord
// ===========================================================================

describe('createOverdueRecord', () => {
  it('inserts a collections record with parameterised query', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await repo.createOverdueRecord(mockClient as never, INVOICE_ID, {
      id: COLLECTION_ID,
      invoiceId: INVOICE_ID,
      buyerId: BUYER_ID,
      faceValue: '50000000',
      amountDue: '50000000',
      daysOverdue: 1,
      dailyPenaltyRate: '0.001',
      penaltyAmount: '50000',
    });

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO collections'),
      expect.arrayContaining([COLLECTION_ID, INVOICE_ID, BUYER_ID]),
    );
  });
});

// ===========================================================================
// updateCollectionStatus
// ===========================================================================

describe('updateCollectionStatus', () => {
  it('updates status with parameterised query', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await repo.updateCollectionStatus(
      mockClient as never,
      COLLECTION_ID,
      CollectionStatus.ESCALATED,
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE collections'),
      expect.arrayContaining([CollectionStatus.ESCALATED, COLLECTION_ID]),
    );
  });
});

// ===========================================================================
// recordPaymentReceived
// ===========================================================================

describe('recordPaymentReceived', () => {
  it('inserts payment record with parameterised query', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await repo.recordPaymentReceived(
      mockClient as never,
      COLLECTION_ID,
      '50000000',
      'bank_transfer',
      'Test Buyer Corporation',
      '2026-03-15',
      'officer-uuid-1',
      'REF-001',
      'Full settlement',
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO collection_payments'),
      expect.arrayContaining([COLLECTION_ID, '50000000', 'bank_transfer']),
    );
  });
});

// ===========================================================================
// getInvoicesDueForReminder
// ===========================================================================

describe('getInvoicesDueForReminder', () => {
  it('returns invoices matching reminder trigger points', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: INVOICE_ID,
          face_value: '50000000',
          buyer_id: BUYER_ID,
          supplier_id: 'sup-1',
          due_date: '2026-03-08',
          days_until_due: 7,
          reminder_type: 'T_MINUS_7',
        },
      ],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never);

    const result = await repo.getInvoicesDueForReminder();

    expect(result).toHaveLength(1);
    expect(result[0].reminder_type).toBe('T_MINUS_7');
  });
});

// ===========================================================================
// getPenaltyByInvoiceId
// ===========================================================================

describe('getPenaltyByInvoiceId', () => {
  it('returns penalty calculation for an invoice', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          invoiceId: INVOICE_ID,
          faceValue: '50000000',
          daysOverdue: 14,
          dailyPenaltyRate: '0.001',
          penaltyAmount: '700000',
        },
      ],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never);

    const result = await repo.getPenaltyByInvoiceId(INVOICE_ID);

    expect(result).not.toBeNull();
    expect(result!.penaltyAmount).toBe('700000');
  });

  it('returns null when no collection record exists', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never);

    const result = await repo.getPenaltyByInvoiceId(INVOICE_ID);

    expect(result).toBeNull();
  });
});

// ===========================================================================
// reduceBuyerUsedLimit
// ===========================================================================

describe('reduceBuyerUsedLimit', () => {
  it('reduces buyer used_limit by face_value with parameterised query', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await repo.reduceBuyerUsedLimit(mockClient as never, BUYER_ID, '50000000');

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE buyers'),
      expect.arrayContaining([BUYER_ID]),
    );
  });
});

// ===========================================================================
// getOverdueInvoices
// ===========================================================================

describe('getOverdueInvoices', () => {
  it('returns overdue collection records', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: COLLECTION_ID,
          invoice_id: INVOICE_ID,
          buyer_id: BUYER_ID,
          face_value: '50000000',
          amount_due: '50000000',
          days_overdue: 5,
          penalty_amount: '250000',
          status: 'overdue',
          escalation_level: null,
          sar_flagged: false,
        },
      ],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never);

    const result = await repo.getOverdueInvoices();

    expect(result).toHaveLength(1);
    expect(result[0].invoice_id).toBe(INVOICE_ID);
  });
});

// ===========================================================================
// createAuditEntry
// ===========================================================================

describe('createAuditEntry', () => {
  it('inserts audit log with parameterised query', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await repo.createAuditEntry(
      mockClient as never,
      'user-1',
      'PAYMENT_RECEIVED',
      'collections',
      COLLECTION_ID,
      null,
      { status: 'collected' },
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining(['user-1', 'PAYMENT_RECEIVED']),
    );
  });

  it('handles non-null oldValues', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await repo.createAuditEntry(
      mockClient as never,
      'user-1',
      'STATUS_CHANGE',
      'collections',
      COLLECTION_ID,
      { status: 'overdue' },
      { status: 'collected' },
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining(['user-1', 'STATUS_CHANGE', 'collections', COLLECTION_ID]),
    );
  });
});

// ===========================================================================
// getInvoiceForCollection
// ===========================================================================

describe('getInvoiceForCollection', () => {
  it('returns invoice when found', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: INVOICE_ID,
          face_value: '50000000',
          advance_amount: '42500000',
          status: 'funded',
          supplier_id: 'sup-1',
          buyer_id: BUYER_ID,
          due_date: '2026-03-01',
        },
      ],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never);

    const result = await repo.getInvoiceForCollection(INVOICE_ID);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(INVOICE_ID);
  });

  it('returns null when not found', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never);

    const result = await repo.getInvoiceForCollection('missing');
    expect(result).toBeNull();
  });
});

// ===========================================================================
// getCollectionByInvoiceId
// ===========================================================================

describe('getCollectionByInvoiceId', () => {
  it('returns collection record when found', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          id: COLLECTION_ID,
          invoice_id: INVOICE_ID,
          buyer_id: BUYER_ID,
          face_value: '50000000',
          amount_due: '50000000',
          days_overdue: 5,
          daily_penalty_rate: '0.001',
          penalty_amount: '250000',
          status: 'overdue',
          escalation_level: null,
          demand_notice_sent: false,
          sar_flagged: false,
          created_at: '2026-03-02',
          updated_at: '2026-03-02',
        },
      ],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never);

    const result = await repo.getCollectionByInvoiceId(INVOICE_ID);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(COLLECTION_ID);
  });

  it('returns null when not found', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never);

    const result = await repo.getCollectionByInvoiceId('missing');
    expect(result).toBeNull();
  });
});

// ===========================================================================
// flagForSarReview
// ===========================================================================

describe('flagForSarReview', () => {
  it('updates sar_flagged to true', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await repo.flagForSarReview(mockClient as never, COLLECTION_ID);

    expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('sar_flagged = true'), [
      COLLECTION_ID,
    ]);
  });
});

// ===========================================================================
// updateInvoiceStatus
// ===========================================================================

describe('updateInvoiceStatus', () => {
  it('updates invoice status with expected current status guard', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await repo.updateInvoiceStatus(mockClient as never, INVOICE_ID, 'collected', 'overdue');

    expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE invoices'), [
      'collected',
      INVOICE_ID,
      'overdue',
    ]);
  });
});
