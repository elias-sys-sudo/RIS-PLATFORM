// =============================================================================
// Collection-monitoring worker tests (issue #35)
// =============================================================================
//
// Verifies the worker delegates to collectionsService.startCollectionMonitoring
// and that the underlying service is idempotent on retry.
//
// =============================================================================

process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.AML_FLAG_THRESHOLD_UGX = '100000000';

import * as service from '../../../src/services/collections/collections.service';
import * as repo from '../../../src/services/collections/collections.repository';
import { pool, beginWithRls } from '../../../src/shared/database/pool';
import { CollectionStatus } from '../../../src/services/collections/collections.types';
import type {
  InvoiceForCollection,
  CollectionRecord,
} from '../../../src/services/collections/collections.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/collections/collections.repository');
jest.mock('../../../src/services/facilities/facilities.repository', () => ({
  getDrawdownByInvoiceId: jest.fn().mockResolvedValue(null),
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
jest.mock('../../../src/shared/crypto', () => ({
  decrypt: jest.fn(),
  encrypt: jest.fn(),
}));
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    }),
  },
  query: jest.fn(),
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedPool = pool as jest.Mocked<typeof pool>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const INVOICE_ID = 'inv-uuid-1';
const PAYMENT_ID = 'pay-uuid-1';
const BUYER_ID = 'buyer-uuid-1';
const SUPPLIER_ID = 'sup-uuid-1';
const COLLECTION_ID = 'col-uuid-1';

function makeInvoice(overrides: Partial<InvoiceForCollection> = {}): InvoiceForCollection {
  return {
    id: INVOICE_ID,
    face_value: '50000000',
    advance_amount: '42500000',
    status: 'funded',
    supplier_id: SUPPLIER_ID,
    buyer_id: BUYER_ID,
    due_date: '2026-04-30',
    ...overrides,
  };
}

function makeCollection(overrides: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id: COLLECTION_ID,
    invoice_id: INVOICE_ID,
    buyer_id: BUYER_ID,
    face_value: '50000000',
    amount_due: '50000000',
    days_overdue: 0,
    daily_penalty_rate: '0.001',
    penalty_amount: '0',
    status: CollectionStatus.PENDING,
    escalation_level: null,
    demand_notice_sent: false,
    sar_flagged: false,
    total_collected: null,
    last_payment_at: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  const freshClient = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
  mockedPool.connect.mockResolvedValue(freshClient as never);
});

// ---------------------------------------------------------------------------
// Worker happy path — creates collections row + audit + transitions invoice
// ---------------------------------------------------------------------------

describe('startCollectionMonitoring (worker handler)', () => {
  it('creates a collections row, transitions invoice funded → collecting, audits', async () => {
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice());
    mockedRepo.createPendingCollectionRecord.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID);

    const client = await mockedPool.connect();
    expect(beginWithRls).toHaveBeenCalledWith(client);

    // 1. INSERT collections row with status='pending', days_overdue=0, penalty=0
    expect(mockedRepo.createPendingCollectionRecord).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      expect.objectContaining({
        invoiceId: INVOICE_ID,
        buyerId: BUYER_ID,
        faceValue: '50000000',
        amountDue: '50000000',
        daysOverdue: 0,
        penaltyAmount: '0',
      }),
    );

    // 2. UPDATE invoices SET status='collecting' WHERE id=... AND status='funded'
    expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      'collecting',
      'funded',
    );

    // 3. INSERT audit_log COLLECTION_STARTED, no PII in metadata
    const auditCall = mockedRepo.createAuditEntry.mock.calls[0];
    expect(auditCall).toBeDefined();
    expect(auditCall[2]).toBe('COLLECTION_STARTED'); // action
    expect(auditCall[3]).toBe('collections'); // table_name
    expect(auditCall[4]).toBe(INVOICE_ID); // record_id
    const newValues = auditCall[6];
    expect(newValues).toMatchObject({
      status: 'collecting',
      paymentId: PAYMENT_ID,
    });
    // No buyer name, email, phone, or company name in metadata
    const auditJson = JSON.stringify(auditCall);
    expect(auditJson).not.toMatch(/email|phone|@|company_name/i);

    // 4. COMMIT (and not ROLLBACK)
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query).not.toHaveBeenCalledWith('ROLLBACK');
  });

  // ---------------------------------------------------------------------------
  // Worker idempotency — retry must not duplicate work
  // ---------------------------------------------------------------------------

  it('idempotency: a duplicate worker run does NOT create a second collections row or fire a second audit', async () => {
    // First run — collection row gets created
    mockedRepo.getCollectionByInvoiceId
      .mockResolvedValueOnce(null) // first call: no row
      .mockResolvedValueOnce(makeCollection()); // retry: row exists
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice());
    mockedRepo.createPendingCollectionRecord.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID);
    await service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID);

    expect(mockedRepo.createPendingCollectionRecord).toHaveBeenCalledTimes(1);
    expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledTimes(1);
    expect(mockedRepo.createAuditEntry).toHaveBeenCalledTimes(1);
  });

  it('idempotency: when a collections row already exists from the very first call, no work is done', async () => {
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(makeCollection());

    await service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID);

    expect(mockedRepo.createPendingCollectionRecord).not.toHaveBeenCalled();
    expect(mockedRepo.updateInvoiceStatus).not.toHaveBeenCalled();
    expect(mockedRepo.createAuditEntry).not.toHaveBeenCalled();
    expect(beginWithRls).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Worker safety — invoice no longer funded (status drift)
  // ---------------------------------------------------------------------------

  it('does not transition when invoice has already advanced past funded', async () => {
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice({ status: 'overdue' }));

    await service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID);

    expect(mockedRepo.createPendingCollectionRecord).not.toHaveBeenCalled();
    expect(mockedRepo.updateInvoiceStatus).not.toHaveBeenCalled();
    expect(mockedRepo.createAuditEntry).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Worker rollback safety — DB failure inside the txn
  // ---------------------------------------------------------------------------

  it('rolls back the transaction when the audit insert fails', async () => {
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice());
    mockedRepo.createPendingCollectionRecord.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockRejectedValue(new Error('audit insert failed'));

    await expect(service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID)).rejects.toThrow(
      'audit insert failed',
    );

    const client = await mockedPool.connect();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
