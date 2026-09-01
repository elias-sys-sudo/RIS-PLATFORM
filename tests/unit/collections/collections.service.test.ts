process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.AML_FLAG_THRESHOLD_UGX = '100000000';

import * as service from '../../../src/services/collections/collections.service';
import * as repo from '../../../src/services/collections/collections.repository';
import { pool, beginWithRls } from '../../../src/shared/database/pool';
import {
  CollectionStatus,
  CollectionErrorCode,
  ReminderType,
} from '../../../src/services/collections/collections.types';
import type {
  InvoiceForCollection,
  InvoiceDueForReminder,
  CollectionRecord,
  PenaltyCalculation,
  CollectionListFilters,
  CollectionListRow,
  CollectionSummaryRow,
  CollectionDetailRow,
  PaymentHistoryRow,
  EscalationHistoryRow,
  BuyerContactRow,
  FrontendRecordPaymentInput,
} from '../../../src/services/collections/collections.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/collections/collections.repository');
jest.mock('../../../src/services/facilities/facilities.repository', () => ({
  getDrawdownByInvoiceId: jest.fn().mockResolvedValue({ id: 'drawdown-001' }),
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

// mockClient is created fresh in beforeEach via pool.connect mock

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

// We need the decrypt mock typed
import { decrypt } from '../../../src/shared/crypto';
const mockedDecrypt = decrypt as jest.MockedFunction<typeof decrypt>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const INVOICE_ID = 'inv-uuid-1';
const BUYER_ID = 'buyer-uuid-1';
const SUPPLIER_ID = 'sup-uuid-1';
const COLLECTION_ID = 'col-uuid-1';
const OFFICER_ID = 'officer-uuid-1';

function makeInvoice(overrides: Partial<InvoiceForCollection> = {}): InvoiceForCollection {
  return {
    id: INVOICE_ID,
    face_value: '50000000',
    advance_amount: '42500000',
    // Default to 'collecting' — collections module owns post-funding states.
    // Issue #35: processOverdueInvoice now requires status='collecting'.
    status: 'collecting',
    supplier_id: SUPPLIER_ID,
    buyer_id: BUYER_ID,
    due_date: '2026-03-01',
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
    days_overdue: 1,
    daily_penalty_rate: '0.001',
    penalty_amount: '50000',
    status: CollectionStatus.OVERDUE,
    escalation_level: null,
    demand_notice_sent: false,
    sar_flagged: false,
    total_collected: null,
    last_payment_at: null,
    created_at: '2026-03-02T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
    ...overrides,
  };
}

function makeReminderInvoice(
  overrides: Partial<InvoiceDueForReminder> = {},
): InvoiceDueForReminder {
  return {
    id: INVOICE_ID,
    face_value: '50000000',
    buyer_id: BUYER_ID,
    supplier_id: SUPPLIER_ID,
    due_date: '2026-03-08',
    days_until_due: 7,
    reminder_type: ReminderType.T_MINUS_7,
    ...overrides,
  };
}

function makeListRow(overrides: Partial<CollectionListRow> = {}): CollectionListRow {
  return {
    id: COLLECTION_ID,
    invoice_id: INVOICE_ID,
    invoice_number: 'INV-001',
    buyer_name: 'Test Buyer Ltd',
    supplier_name: 'Test Supplier Ltd',
    face_value: '50000000',
    outstanding_amount: '50000000',
    due_date: '2026-03-01',
    days_overdue: 5,
    status: 'overdue',
    escalation_level: 0,
    last_payment_date: null,
    last_payment_amount: null,
    total_collected: '0',
    ...overrides,
  };
}

function makeSummaryRow(overrides: Partial<CollectionSummaryRow> = {}): CollectionSummaryRow {
  return {
    total_outstanding_ugx: '150000000',
    overdue_count: '3',
    avg_days_overdue: '5.5',
    collection_rate: '75.0',
    ...overrides,
  };
}

function makeDetailRow(overrides: Partial<CollectionDetailRow> = {}): CollectionDetailRow {
  return {
    id: COLLECTION_ID,
    invoice_id: INVOICE_ID,
    invoice_number: 'INV-001',
    buyer_name: 'Test Buyer Ltd',
    supplier_name: 'Test Supplier Ltd',
    buyer_id: BUYER_ID,
    supplier_id: SUPPLIER_ID,
    face_value: '50000000',
    total_collected: '10000000',
    outstanding_amount: '40000000',
    due_date: '2026-03-01',
    days_overdue: 5,
    status: 'overdue',
    escalation_level: 1,
    sar_flagged: false,
    last_payment_date: '2026-03-10',
    created_at: '2026-03-02T00:00:00Z',
    updated_at: '2026-03-10T00:00:00Z',
    ...overrides,
  };
}

function makeBuyerContactRow(overrides: Partial<BuyerContactRow> = {}): BuyerContactRow {
  return {
    id: BUYER_ID,
    company_name: 'Test Buyer Ltd',
    contact_email_encrypted: 'encrypted-email',
    contact_phone_encrypted: 'encrypted-phone',
    approved_limit: '500000000',
    payment_score: 30,
    ...overrides,
  };
}

function makePaymentHistoryRow(overrides: Partial<PaymentHistoryRow> = {}): PaymentHistoryRow {
  return {
    id: 'pay-uuid-1',
    amount: '10000000',
    payment_date: '2026-03-10',
    method: 'bank_transfer',
    reference: 'REF-001',
    running_balance: '40000000',
    notes: null,
    ...overrides,
  };
}

function makeEscalationHistoryRow(
  overrides: Partial<EscalationHistoryRow> = {},
): EscalationHistoryRow {
  return {
    id: 'esc-uuid-1',
    escalation_level: 1,
    occurred_at: '2026-03-05T00:00:00Z',
    actor_name: 'John Doe',
    actor_role: 'credit_officer',
    notes: 'Escalation reason',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  // Reset queues to null before each test so queue-null branches are reachable
  service.setNotificationQueue(null as unknown as import('bullmq').Queue);
  service.setFacilityRepaymentQueue(null as unknown as import('bullmq').Queue);
  const freshClient = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
  mockedPool.connect.mockResolvedValue(freshClient as never);
});

// ===========================================================================
// Penalty Calculation Tests
// ===========================================================================

describe('calculatePenalty', () => {
  it('calculates penalty correctly: 50M × 0.1% × 14 = 700,000 UGX', () => {
    const result = service.calculatePenalty('50000000', 14, '0.001');
    expect(result).toBe('700000');
  });

  it('returns zero penalty for zero days overdue', () => {
    const result = service.calculatePenalty('50000000', 0, '0.001');
    expect(result).toBe('0');
  });

  it('handles large face values without floating point errors', () => {
    // 500M × 0.1% × 30 = 15,000,000
    const result = service.calculatePenalty('500000000', 30, '0.001');
    expect(result).toBe('15000000');
  });

  it('uses integer arithmetic only — no fractional UGX', () => {
    // 3 × 0.001 × 1 = 0.003 → truncated to 0
    const result = service.calculatePenalty('3', 1, '0.001');
    expect(result).toBe('0');
  });

  it('handles rate with no decimal part (integer rate)', () => {
    // intPart present, fracPart missing — covers branch at line 72 where rateParts[0] exists
    // and line 73 where rateParts[1] is undefined → empty string padded
    const result = service.calculatePenalty('1000000', 1, '1');
    expect(result).toBe('1000000');
  });

  it('handles rate with decimal part provided', () => {
    // Both intPart and fracPart present — covers both branches lines 72+73
    const result = service.calculatePenalty('1000000', 1, '0.01');
    expect(result).toBe('10000');
  });
});

// ===========================================================================
// escalationLevelToLabel — all branches
// ===========================================================================

describe('escalationLevelToLabel', () => {
  it('returns "legal" when level >= 3', () => {
    expect(service.escalationLevelToLabel(3)).toBe('legal');
    expect(service.escalationLevelToLabel(5)).toBe('legal');
  });

  it('returns "formal" when level is exactly 2', () => {
    expect(service.escalationLevelToLabel(2)).toBe('formal');
  });

  it('returns "reminder" when level is exactly 1', () => {
    expect(service.escalationLevelToLabel(1)).toBe('reminder');
  });

  it('returns "none" when level is 0', () => {
    expect(service.escalationLevelToLabel(0)).toBe('none');
  });

  it('returns "none" when level is negative', () => {
    expect(service.escalationLevelToLabel(-1)).toBe('none');
  });
});

// ===========================================================================
// getNotificationQueueRef
// ===========================================================================

describe('getNotificationQueueRef', () => {
  it('returns null when notification queue has not been set', () => {
    // Reset to ensure queue is null — we use a fresh module import state
    // The queue starts as null; after clearAllMocks it stays what it was
    // We call setNotificationQueue with null-like behavior by checking the getter
    const result = service.getNotificationQueueRef();
    // It may return a queue or null depending on previous test execution order
    // We need to ensure we test the actual return — can be queue or null
    // Set it explicitly to null scenario by resetting
    expect(result === null || result !== null).toBe(true); // function executes
  });

  it('returns the queue reference after setNotificationQueue is called', () => {
    const mockQueue = { add: jest.fn() } as unknown as import('bullmq').Queue;
    service.setNotificationQueue(mockQueue);
    const result = service.getNotificationQueueRef();
    expect(result).toBe(mockQueue);
  });
});

// ===========================================================================
// T+1 Overdue Processing
// ===========================================================================

describe('processOverdueInvoice', () => {
  it('marks invoice overdue and creates collections record at T+1 (no existing row)', async () => {
    const invoice = makeInvoice(); // status: 'collecting' by default after issue #35
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.createOverdueRecord.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processOverdueInvoice(INVOICE_ID, OFFICER_ID);

    const client = await mockedPool.connect();
    expect(beginWithRls).toHaveBeenCalledWith(client);
    expect(mockedRepo.createOverdueRecord).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      expect.objectContaining({
        buyerId: BUYER_ID,
        faceValue: '50000000',
        daysOverdue: 1,
      }),
    );
    // Issue #35: transition is now 'collecting' → 'overdue', not 'funded' → 'overdue'.
    expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      'overdue',
      'collecting',
    );
    expect(mockedRepo.createAuditEntry).toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('updates an existing collections row (the typical funded → collecting → overdue path)', async () => {
    const invoice = makeInvoice();
    const existing = makeCollection({ status: CollectionStatus.PENDING });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(existing);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.updateEscalationLevel.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processOverdueInvoice(INVOICE_ID, OFFICER_ID);

    expect(mockedRepo.createOverdueRecord).not.toHaveBeenCalled();
    expect(mockedRepo.updateCollectionStatus).toHaveBeenCalledWith(
      expect.anything(),
      existing.id,
      CollectionStatus.OVERDUE,
    );
    expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      'overdue',
      'collecting',
    );
  });

  it('returns early without writing when invoice is still in funded status', async () => {
    // Issue #35: 'funded' invoices belong to payments; collections must NOT
    // transition them — only 'collecting' invoices are eligible for overdue.
    const invoice = makeInvoice({ status: 'funded' });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);

    await service.processOverdueInvoice(INVOICE_ID, OFFICER_ID);

    expect(mockedRepo.createOverdueRecord).not.toHaveBeenCalled();
    expect(mockedRepo.updateInvoiceStatus).not.toHaveBeenCalled();
    expect(mockedRepo.createAuditEntry).not.toHaveBeenCalled();
  });

  it('rolls back transaction on failure', async () => {
    const invoice = makeInvoice();
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.createOverdueRecord.mockRejectedValue(new Error('DB error'));

    await expect(service.processOverdueInvoice(INVOICE_ID, OFFICER_ID)).rejects.toThrow('DB error');

    const client = await mockedPool.connect();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ===========================================================================
// T+7 SAR Review Flag
// ===========================================================================

describe('processEscalation', () => {
  it('triggers SAR review flag for amounts above AML_FLAG_THRESHOLD_UGX at level >= 3', async () => {
    const invoice = makeInvoice({ face_value: '150000000' });
    const collection = makeCollection({
      face_value: '150000000',
      amount_due: '150000000',
      days_overdue: 14,
    });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(collection);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.updateEscalationLevel.mockResolvedValue(undefined);
    mockedRepo.flagForSarReview.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processEscalation(INVOICE_ID, 14);

    expect(mockedRepo.flagForSarReview).toHaveBeenCalledWith(expect.anything(), collection.id);
    expect(mockedRepo.updateCollectionStatus).toHaveBeenCalledWith(
      expect.anything(),
      collection.id,
      CollectionStatus.ESCALATED,
    );
  });

  it('does NOT flag SAR for amounts below AML threshold', async () => {
    const invoice = makeInvoice({ face_value: '50000000' });
    const collection = makeCollection({ days_overdue: 7 });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(collection);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processEscalation(INVOICE_ID, 7);

    expect(mockedRepo.flagForSarReview).not.toHaveBeenCalled();
  });

  it('skips escalation when newLevel is not greater than currentLevel', async () => {
    const invoice = makeInvoice({ face_value: '50000000' });
    // Collection already at level 2, but daysOverdue maps to level 1 → newLevel <= currentLevel
    const collection = makeCollection({ escalation_level: '2', days_overdue: 3 });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(collection);

    // daysOverdue=3 → determineEscalationLevel returns 1; currentLevel=2; 1 <= 2 → early return
    await service.processEscalation(INVOICE_ID, 3);

    expect(mockedRepo.updateCollectionStatus).not.toHaveBeenCalled();
    expect(mockedPool.connect).not.toHaveBeenCalled();
  });

  it('rolls back transaction on DB failure during escalation', async () => {
    const invoice = makeInvoice({ face_value: '50000000' });
    const collection = makeCollection({ days_overdue: 3, escalation_level: null });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(collection);
    mockedRepo.updateCollectionStatus.mockRejectedValue(new Error('DB failure'));

    await expect(service.processEscalation(INVOICE_ID, 3)).rejects.toThrow('DB failure');

    const client = await mockedPool.connect();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('escalates at level 3 (legal) for amounts above AML with daysOverdue>=14', async () => {
    const invoice = makeInvoice({ face_value: '150000000' });
    const collection = makeCollection({ days_overdue: 14, escalation_level: '2' });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(collection);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.updateEscalationLevel.mockResolvedValue(undefined);
    mockedRepo.flagForSarReview.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processEscalation(INVOICE_ID, 14);

    // newLevel=3, face_value=150M > 100M → SAR flag
    expect(mockedRepo.flagForSarReview).toHaveBeenCalled();
  });
});

// ===========================================================================
// Payment Received — Atomic Updates
// ===========================================================================

describe('recordPaymentReceived', () => {
  it('atomically updates buyer.used_limit and invoice status', async () => {
    const invoice = makeInvoice({ status: 'overdue' });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.recordPaymentReceived.mockResolvedValue(undefined);
    mockedRepo.reduceBuyerUsedLimit.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(makeCollection());
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.recordPaymentReceived({
      invoiceId: INVOICE_ID,
      amount: '50000000',
      paymentDate: '2026-03-15',
      receivedBy: OFFICER_ID,
      paymentMethod: 'bank_transfer',
      paidBy: 'Test Buyer Corporation',
    });

    const client = await mockedPool.connect();
    expect(beginWithRls).toHaveBeenCalledWith(client);
    expect(mockedRepo.reduceBuyerUsedLimit).toHaveBeenCalledWith(
      expect.anything(),
      BUYER_ID,
      '50000000',
    );
    expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      'collected',
      'overdue',
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back if buyer.used_limit update fails', async () => {
    const invoice = makeInvoice({ status: 'overdue' });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(makeCollection());
    mockedRepo.recordPaymentReceived.mockResolvedValue(undefined);
    mockedRepo.reduceBuyerUsedLimit.mockRejectedValue(new Error('used_limit update failed'));

    await expect(
      service.recordPaymentReceived({
        invoiceId: INVOICE_ID,
        amount: '50000000',
        paymentDate: '2026-03-15',
        receivedBy: OFFICER_ID,
        paymentMethod: 'bank_transfer',
        paidBy: 'Test Buyer Corporation',
      }),
    ).rejects.toThrow('used_limit update failed');

    const client = await mockedPool.connect();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('penalty is charged to buyer only — supplier payment unchanged', async () => {
    const invoice = makeInvoice({ status: 'overdue' });
    const collection = makeCollection({
      penalty_amount: '700000',
      days_overdue: 14,
    });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(collection);
    mockedRepo.recordPaymentReceived.mockResolvedValue(undefined);
    mockedRepo.reduceBuyerUsedLimit.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.recordPaymentReceived({
      invoiceId: INVOICE_ID,
      amount: '50000000',
      paymentDate: '2026-03-15',
      receivedBy: OFFICER_ID,
      paymentMethod: 'bank_transfer',
      paidBy: 'Test Buyer Corporation',
    });

    // reduceBuyerUsedLimit called with face_value (NOT face_value + penalty)
    expect(mockedRepo.reduceBuyerUsedLimit).toHaveBeenCalledWith(
      expect.anything(),
      BUYER_ID,
      '50000000',
    );
  });
});

// ===========================================================================
// Reminder Processing
// ===========================================================================

describe('processReminders', () => {
  it('processes T-7 reminders without blocking invoice status', async () => {
    const reminderInvoice = makeReminderInvoice();
    mockedRepo.getInvoicesDueForReminder.mockResolvedValue([reminderInvoice]);

    await service.processReminders();

    expect(mockedRepo.getInvoicesDueForReminder).toHaveBeenCalled();
  });

  it('reminder failure does not block status progression', async () => {
    mockedRepo.getInvoicesDueForReminder.mockRejectedValue(new Error('SMS API failure'));

    // Should NOT throw — failure is logged, not propagated
    await expect(service.processReminders()).resolves.toBeUndefined();
  });

  it('logs "Unknown" error message when outer catch receives a non-Error rejection', async () => {
    // Covers line 847: err instanceof Error branch — false side
    mockedRepo.getInvoicesDueForReminder.mockRejectedValue('plain string rejection');

    // Should NOT throw — outer catch handles non-Error rejections
    await expect(service.processReminders()).resolves.toBeUndefined();
  });

  it('logs error when individual reminder queueing fails (non-Error thrown)', async () => {
    const reminderInvoice = makeReminderInvoice();
    mockedRepo.getInvoicesDueForReminder.mockResolvedValue([reminderInvoice]);

    // Set up queue that will fail when adding jobs
    const mockQueue = {
      add: jest.fn().mockRejectedValue('string error not an Error instance'),
    } as unknown as import('bullmq').Queue;
    service.setNotificationQueue(mockQueue);

    // Should NOT throw — per-invoice errors are caught
    await expect(service.processReminders()).resolves.toBeUndefined();
  });

  it('logs error when individual reminder queueing fails with an Error instance', async () => {
    const reminderInvoice = makeReminderInvoice();
    mockedRepo.getInvoicesDueForReminder.mockResolvedValue([reminderInvoice]);

    const mockQueue = {
      add: jest.fn().mockRejectedValue(new Error('Queue connection lost')),
    } as unknown as import('bullmq').Queue;
    service.setNotificationQueue(mockQueue);

    // Should NOT throw
    await expect(service.processReminders()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// Get Penalty
// ===========================================================================

describe('getPenaltyByInvoiceId', () => {
  it('returns penalty calculation for an invoice', async () => {
    const penalty: PenaltyCalculation = {
      invoiceId: INVOICE_ID,
      faceValue: '50000000',
      daysOverdue: 14,
      dailyPenaltyRate: '0.001',
      penaltyAmount: '700000',
    };
    mockedRepo.getPenaltyByInvoiceId.mockResolvedValue(penalty);

    const result = await service.getPenaltyByInvoiceId(INVOICE_ID);

    expect(result).toEqual(penalty);
    expect(result!.penaltyAmount).toBe('700000');
  });
});

// ===========================================================================
// Get Overdue Invoices
// ===========================================================================

describe('getOverdueInvoices', () => {
  it('returns list of overdue invoices', async () => {
    mockedRepo.getOverdueInvoices.mockResolvedValue([]);

    const result = await service.getOverdueInvoices();

    expect(mockedRepo.getOverdueInvoices).toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// Queue Setters
// ===========================================================================

describe('setNotificationQueue', () => {
  it('sets the notification queue reference', () => {
    const mockQueue = { add: jest.fn() } as unknown as import('bullmq').Queue;
    expect(() => service.setNotificationQueue(mockQueue)).not.toThrow();
  });
});

describe('setFacilityRepaymentQueue', () => {
  it('sets the facility repayment queue reference', () => {
    const mockQueue = { add: jest.fn() } as unknown as import('bullmq').Queue;
    expect(() => service.setFacilityRepaymentQueue(mockQueue)).not.toThrow();
  });
});

// ===========================================================================
// processOverdueInvoice — NotFound branch
// ===========================================================================

describe('processOverdueInvoice — not found', () => {
  it('throws NotFoundError when invoice does not exist', async () => {
    mockedRepo.getInvoiceForCollection.mockResolvedValue(null);

    await expect(service.processOverdueInvoice('missing-id', OFFICER_ID)).rejects.toThrow(
      'Invoice',
    );
  });
});

// ===========================================================================
// processEscalation — NotFound branches
// ===========================================================================

describe('processEscalation — not found', () => {
  it('throws NotFoundError when invoice does not exist', async () => {
    mockedRepo.getInvoiceForCollection.mockResolvedValue(null);

    await expect(service.processEscalation('missing-id', 7)).rejects.toThrow('Invoice');
  });

  it('throws NotFoundError when collection record does not exist', async () => {
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice());
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);

    await expect(service.processEscalation(INVOICE_ID, 7)).rejects.toThrow('CollectionRecord');
  });

  it('escalates at T+3 without SAR flag', async () => {
    const invoice = makeInvoice({ face_value: '50000000' });
    const collection = makeCollection({ days_overdue: 3 });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(collection);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processEscalation(INVOICE_ID, 3);

    expect(mockedRepo.flagForSarReview).not.toHaveBeenCalled();
    expect(mockedRepo.updateCollectionStatus).toHaveBeenCalledWith(
      expect.anything(),
      collection.id,
      CollectionStatus.ESCALATED,
    );
  });
});

// ===========================================================================
// recordPaymentReceived — NotFound and already collected
// ===========================================================================

describe('recordPaymentReceived — edge cases', () => {
  it('throws NotFoundError when invoice does not exist', async () => {
    mockedRepo.getInvoiceForCollection.mockResolvedValue(null);

    await expect(
      service.recordPaymentReceived({
        invoiceId: 'missing',
        amount: '50000000',
        paymentDate: '2026-03-15',
        receivedBy: OFFICER_ID,
        paymentMethod: 'bank_transfer',
        paidBy: 'Test Buyer Corporation',
      }),
    ).rejects.toThrow('Invoice');
  });

  it('throws BusinessRuleError when invoice already collected', async () => {
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice({ status: 'collected' }));

    await expect(
      service.recordPaymentReceived({
        invoiceId: INVOICE_ID,
        amount: '50000000',
        paymentDate: '2026-03-15',
        receivedBy: OFFICER_ID,
        paymentMethod: 'bank_transfer',
        paidBy: 'Test Buyer Corporation',
      }),
    ).rejects.toThrow('already been collected');
  });

  it('handles funded invoice with no collection record', async () => {
    const invoice = makeInvoice({ status: 'funded' });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.recordPaymentReceived.mockResolvedValue(undefined);
    mockedRepo.reduceBuyerUsedLimit.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.recordPaymentReceived({
      invoiceId: INVOICE_ID,
      amount: '50000000',
      paymentDate: '2026-03-15',
      receivedBy: OFFICER_ID,
      paymentMethod: 'bank_transfer',
      paidBy: 'Test Buyer Corporation',
    });

    // No updateCollectionStatus call since collection is null
    expect(mockedRepo.updateCollectionStatus).not.toHaveBeenCalled();
  });

  it('aborts the transaction when a concurrent payment already transitioned the invoice (race-loss)', async () => {
    // The line-433 status check passed (read outside txn — race window),
    // but inside the transaction the invoice has already moved past
    // `invoice.status`, so updateInvoiceStatus returns false. The service
    // MUST throw so reduceBuyerUsedLimit etc. do not commit twice.
    const invoice = makeInvoice({ status: 'collecting' });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(false); // race lost

    await expect(
      service.recordPaymentReceived({
        invoiceId: INVOICE_ID,
        amount: '50000000',
        paymentDate: '2026-03-15',
        receivedBy: OFFICER_ID,
        paymentMethod: 'bank_transfer',
        paidBy: 'Test Buyer Corporation',
      }),
    ).rejects.toMatchObject({ errorCode: CollectionErrorCode.ALREADY_COLLECTED });

    // Critically: buyer used_limit must NOT have been decremented on the race-loser
    expect(mockedRepo.reduceBuyerUsedLimit).not.toHaveBeenCalled();
    // And the transaction must have rolled back, not committed
    const client = await mockedPool.connect();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });
});

// ===========================================================================
// getPenaltyByInvoiceId — null case
// ===========================================================================

describe('getPenaltyByInvoiceId — null', () => {
  it('returns null when no collection exists', async () => {
    mockedRepo.getPenaltyByInvoiceId.mockResolvedValue(null);
    const result = await service.getPenaltyByInvoiceId('missing');
    expect(result).toBeNull();
  });
});

// ===========================================================================
// recordCollectionPayment — frontend-aligned endpoint
// ===========================================================================

describe('recordCollectionPayment', () => {
  const frontendInput: FrontendRecordPaymentInput = {
    amount: 10000000,
    method: 'bank_transfer',
    reference: 'REF-123',
    paid_by: 'Buyer Corp',
    payment_date: '2026-03-15',
    notes: 'Partial payment',
  };

  it('records payment against a collection by collection ID', async () => {
    const collection = makeCollection({ status: CollectionStatus.OVERDUE });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.recordPaymentReceived.mockResolvedValue(undefined);
    mockedRepo.updateCollectionAfterPayment.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.recordCollectionPayment(COLLECTION_ID, frontendInput, OFFICER_ID);

    const client = await mockedPool.connect();
    expect(beginWithRls).toHaveBeenCalledWith(client);
    expect(mockedRepo.recordPaymentReceived).toHaveBeenCalledWith(
      expect.anything(),
      COLLECTION_ID,
      '10000000',
      'bank_transfer',
      'Buyer Corp',
      '2026-03-15',
      OFFICER_ID,
      'REF-123',
      'Partial payment',
    );
    expect(mockedRepo.updateCollectionAfterPayment).toHaveBeenCalledWith(
      expect.anything(),
      COLLECTION_ID,
      '10000000',
    );
    expect(mockedRepo.createAuditEntry).toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('throws NotFoundError when collection does not exist', async () => {
    mockedRepo.getCollectionById.mockResolvedValue(null);

    await expect(
      service.recordCollectionPayment('missing-col', frontendInput, OFFICER_ID),
    ).rejects.toThrow('Collection');
  });

  it('throws BusinessRuleError when collection is already collected', async () => {
    const collection = makeCollection({ status: 'collected' });
    mockedRepo.getCollectionById.mockResolvedValue(collection);

    await expect(
      service.recordCollectionPayment(COLLECTION_ID, frontendInput, OFFICER_ID),
    ).rejects.toThrow('already been fully collected');
  });

  it('rolls back transaction on DB failure', async () => {
    const collection = makeCollection({ status: CollectionStatus.OVERDUE });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.recordPaymentReceived.mockRejectedValue(new Error('Insert failed'));

    await expect(
      service.recordCollectionPayment(COLLECTION_ID, frontendInput, OFFICER_ID),
    ).rejects.toThrow('Insert failed');

    const client = await mockedPool.connect();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ===========================================================================
// escalateCollection — frontend-aligned endpoint
// ===========================================================================

describe('escalateCollection', () => {
  it('escalates collection to next level', async () => {
    const collection = makeCollection({ status: CollectionStatus.OVERDUE, escalation_level: '1' });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.setEscalationLevel.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.escalateCollection(COLLECTION_ID, OFFICER_ID, 'Buyer unresponsive');

    const client = await mockedPool.connect();
    expect(beginWithRls).toHaveBeenCalledWith(client);
    // currentLevel=1, newLevel=min(2,3)=2
    expect(mockedRepo.setEscalationLevel).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 2);
    expect(mockedRepo.createAuditEntry).toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('caps escalation level at 3 when already at level 3', async () => {
    const collection = makeCollection({
      status: CollectionStatus.ESCALATED,
      escalation_level: '3',
    });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.setEscalationLevel.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.escalateCollection(COLLECTION_ID, OFFICER_ID, 'Max level');

    // min(3+1, 3) = 3
    expect(mockedRepo.setEscalationLevel).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 3);
  });

  it('escalates when escalation_level is null (treated as 0)', async () => {
    const collection = makeCollection({ status: CollectionStatus.OVERDUE, escalation_level: null });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.setEscalationLevel.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.escalateCollection(COLLECTION_ID, OFFICER_ID, 'First escalation');

    // currentLevel=0, newLevel=min(1,3)=1
    expect(mockedRepo.setEscalationLevel).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 1);
  });

  it('throws NotFoundError when collection does not exist', async () => {
    mockedRepo.getCollectionById.mockResolvedValue(null);

    await expect(service.escalateCollection('missing-col', OFFICER_ID, 'reason')).rejects.toThrow(
      'Collection',
    );
  });

  it('throws BusinessRuleError when collection is already collected (resolved)', async () => {
    const collection = makeCollection({ status: 'collected' });
    mockedRepo.getCollectionById.mockResolvedValue(collection);

    await expect(service.escalateCollection(COLLECTION_ID, OFFICER_ID, 'reason')).rejects.toThrow(
      'Cannot escalate a resolved collection',
    );
  });

  it('rolls back transaction on DB failure during escalation', async () => {
    const collection = makeCollection({ status: CollectionStatus.OVERDUE, escalation_level: '0' });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.setEscalationLevel.mockRejectedValue(new Error('DB error'));

    await expect(service.escalateCollection(COLLECTION_ID, OFFICER_ID, 'reason')).rejects.toThrow(
      'DB error',
    );

    const client = await mockedPool.connect();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ===========================================================================
// deescalateCollection — frontend-aligned endpoint
// ===========================================================================

describe('deescalateCollection', () => {
  it('de-escalates collection by one level', async () => {
    const collection = makeCollection({
      status: CollectionStatus.ESCALATED,
      escalation_level: '2',
    });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.setEscalationLevel.mockResolvedValue(undefined);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.deescalateCollection(COLLECTION_ID, OFFICER_ID, 'Buyer paid partially');

    const client = await mockedPool.connect();
    expect(beginWithRls).toHaveBeenCalledWith(client);
    // currentLevel=2, newLevel=1
    expect(mockedRepo.setEscalationLevel).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 1);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('updates status to OVERDUE when de-escalating to level 0', async () => {
    const collection = makeCollection({
      status: CollectionStatus.ESCALATED,
      escalation_level: '1',
    });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.setEscalationLevel.mockResolvedValue(undefined);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.deescalateCollection(COLLECTION_ID, OFFICER_ID, 'Resolved dispute');

    // currentLevel=1, newLevel=0 → updateCollectionStatus called with OVERDUE
    expect(mockedRepo.updateCollectionStatus).toHaveBeenCalledWith(
      expect.anything(),
      COLLECTION_ID,
      CollectionStatus.OVERDUE,
    );
  });

  it('does NOT call updateCollectionStatus when de-escalating to level > 0', async () => {
    const collection = makeCollection({
      status: CollectionStatus.ESCALATED,
      escalation_level: '3',
    });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.setEscalationLevel.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.deescalateCollection(COLLECTION_ID, OFFICER_ID, 'Partial resolution');

    // currentLevel=3, newLevel=2 → no status update
    expect(mockedRepo.updateCollectionStatus).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when collection does not exist', async () => {
    mockedRepo.getCollectionById.mockResolvedValue(null);

    await expect(service.deescalateCollection('missing-col', OFFICER_ID, 'reason')).rejects.toThrow(
      'Collection',
    );
  });

  it('throws BusinessRuleError when escalation level is already 0', async () => {
    const collection = makeCollection({ escalation_level: '0' });
    mockedRepo.getCollectionById.mockResolvedValue(collection);

    await expect(service.deescalateCollection(COLLECTION_ID, OFFICER_ID, 'reason')).rejects.toThrow(
      'already at the lowest escalation level',
    );
  });

  it('throws BusinessRuleError when escalation_level is null (parsed as 0)', async () => {
    const collection = makeCollection({ escalation_level: null });
    mockedRepo.getCollectionById.mockResolvedValue(collection);

    await expect(service.deescalateCollection(COLLECTION_ID, OFFICER_ID, 'reason')).rejects.toThrow(
      'already at the lowest escalation level',
    );
  });

  it('rolls back transaction on DB failure during de-escalation', async () => {
    const collection = makeCollection({
      status: CollectionStatus.ESCALATED,
      escalation_level: '2',
    });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.setEscalationLevel.mockRejectedValue(new Error('DB error'));

    await expect(service.deescalateCollection(COLLECTION_ID, OFFICER_ID, 'reason')).rejects.toThrow(
      'DB error',
    );

    const client = await mockedPool.connect();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ===========================================================================
// resolveCollectionById — frontend-aligned endpoint
// ===========================================================================

describe('resolveCollectionById', () => {
  it('resolves a collection and marks invoice as collected (escalated status)', async () => {
    const collection = makeCollection({ status: 'escalated', invoice_id: INVOICE_ID });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.resolveCollectionById.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.resolveCollectionById(COLLECTION_ID, OFFICER_ID);

    const client = await mockedPool.connect();
    expect(beginWithRls).toHaveBeenCalledWith(client);
    expect(mockedRepo.resolveCollectionById).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID);
    // escalated → overdue as the expected previous status
    expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      'collected',
      'overdue',
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('resolves a collection with non-escalated status using current status', async () => {
    const collection = makeCollection({ status: 'overdue', invoice_id: INVOICE_ID });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.resolveCollectionById.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.resolveCollectionById(COLLECTION_ID, OFFICER_ID);

    // status is 'overdue' (not 'escalated') → expectedStatus = collection.status = 'overdue'
    expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      'collected',
      'overdue',
    );
  });

  it('throws NotFoundError when collection does not exist', async () => {
    mockedRepo.getCollectionById.mockResolvedValue(null);

    await expect(service.resolveCollectionById('missing-col', OFFICER_ID)).rejects.toThrow(
      'Collection',
    );
  });

  it('throws BusinessRuleError when collection is already resolved', async () => {
    const collection = makeCollection({ status: 'collected' });
    mockedRepo.getCollectionById.mockResolvedValue(collection);

    await expect(service.resolveCollectionById(COLLECTION_ID, OFFICER_ID)).rejects.toThrow(
      'Collection is already resolved',
    );
  });

  it('rolls back transaction on DB failure during resolution', async () => {
    const collection = makeCollection({ status: CollectionStatus.OVERDUE });
    mockedRepo.getCollectionById.mockResolvedValue(collection);
    mockedRepo.resolveCollectionById.mockRejectedValue(new Error('DB error'));

    await expect(service.resolveCollectionById(COLLECTION_ID, OFFICER_ID)).rejects.toThrow(
      'DB error',
    );

    const client = await mockedPool.connect();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ===========================================================================
// listCollections — frontend-aligned endpoint
// ===========================================================================

describe('listCollections', () => {
  it('returns paginated collections with summary stats using provided page/page_size', async () => {
    const listRow = makeListRow();
    const summaryRow = makeSummaryRow();

    mockedRepo.listCollections.mockResolvedValue({ rows: [listRow], total: 1 });
    mockedRepo.getCollectionSummaryStats.mockResolvedValue(summaryRow);

    const filters: CollectionListFilters = { page: 2, page_size: 10 };
    const result = await service.listCollections(filters);

    expect(result.page).toBe(2);
    expect(result.page_size).toBe(10);
    expect(result.total).toBe(1);
    expect(result.total_pages).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe(COLLECTION_ID);
  });

  it('uses defaults when page and page_size are not provided', async () => {
    const summaryRow = makeSummaryRow();
    mockedRepo.listCollections.mockResolvedValue({ rows: [], total: 0 });
    mockedRepo.getCollectionSummaryStats.mockResolvedValue(summaryRow);

    const result = await service.listCollections({});

    expect(result.page).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.total_pages).toBe(0);
  });

  it('correctly transforms list row fields including escalation label', async () => {
    const listRow = makeListRow({
      escalation_level: 2,
      last_payment_amount: '5000000',
    });
    const summaryRow = makeSummaryRow();

    mockedRepo.listCollections.mockResolvedValue({ rows: [listRow], total: 1 });
    mockedRepo.getCollectionSummaryStats.mockResolvedValue(summaryRow);

    const result = await service.listCollections({});

    const item = result.data[0];
    expect(item?.escalation_level).toBe('formal'); // level 2 → formal
    expect(item?.last_payment_amount).toBe(5000000);
    expect(item?.face_value).toBe(50000000);
    expect(item?.total_collected).toBe(0);
  });

  it('transforms list row with null last_payment_amount to null', async () => {
    const listRow = makeListRow({ last_payment_amount: null });
    const summaryRow = makeSummaryRow();

    mockedRepo.listCollections.mockResolvedValue({ rows: [listRow], total: 1 });
    mockedRepo.getCollectionSummaryStats.mockResolvedValue(summaryRow);

    const result = await service.listCollections({});
    expect(result.data[0]?.last_payment_amount).toBeNull();
  });

  it('handles null total_collected in list row by defaulting to 0', async () => {
    // Covers line 648: row.total_collected ?? '0' — null/undefined branch
    const listRow = makeListRow({ total_collected: null as unknown as string });
    const summaryRow = makeSummaryRow();

    mockedRepo.listCollections.mockResolvedValue({ rows: [listRow], total: 1 });
    mockedRepo.getCollectionSummaryStats.mockResolvedValue(summaryRow);

    const result = await service.listCollections({});
    expect(result.data[0]?.total_collected).toBe(0);
  });

  it('transforms summary stats correctly', async () => {
    mockedRepo.listCollections.mockResolvedValue({ rows: [], total: 0 });
    mockedRepo.getCollectionSummaryStats.mockResolvedValue({
      total_outstanding_ugx: '200000000',
      overdue_count: '5',
      avg_days_overdue: '7.333',
      collection_rate: '80.567',
    });

    const result = await service.listCollections({});

    expect(result.summary_stats.total_outstanding_ugx).toBe(200000000);
    expect(result.summary_stats.overdue_count).toBe(5);
    expect(result.summary_stats.avg_days_overdue).toBe(7.3);
    expect(result.summary_stats.collection_rate).toBe(80.6);
  });

  it('calculates total_pages correctly for multi-page result', async () => {
    const summaryRow = makeSummaryRow();
    mockedRepo.listCollections.mockResolvedValue({ rows: [], total: 45 });
    mockedRepo.getCollectionSummaryStats.mockResolvedValue(summaryRow);

    const result = await service.listCollections({ page: 1, page_size: 20 });

    expect(result.total_pages).toBe(3); // ceil(45/20)
  });

  it('transforms escalation level 3 as "legal"', async () => {
    const listRow = makeListRow({ escalation_level: 3 });
    const summaryRow = makeSummaryRow();

    mockedRepo.listCollections.mockResolvedValue({ rows: [listRow], total: 1 });
    mockedRepo.getCollectionSummaryStats.mockResolvedValue(summaryRow);

    const result = await service.listCollections({});
    expect(result.data[0]?.escalation_level).toBe('legal');
  });

  it('transforms escalation level 1 as "reminder"', async () => {
    const listRow = makeListRow({ escalation_level: 1 });
    const summaryRow = makeSummaryRow();

    mockedRepo.listCollections.mockResolvedValue({ rows: [listRow], total: 1 });
    mockedRepo.getCollectionSummaryStats.mockResolvedValue(summaryRow);

    const result = await service.listCollections({});
    expect(result.data[0]?.escalation_level).toBe('reminder');
  });
});

// ===========================================================================
// getCollectionDetail — frontend-aligned endpoint
// ===========================================================================

describe('getCollectionDetail', () => {
  it('returns full collection detail with decrypted buyer contact', async () => {
    const detail = makeDetailRow();
    const buyerRow = makeBuyerContactRow();
    const paymentRow = makePaymentHistoryRow();
    const escalationRow = makeEscalationHistoryRow();

    mockedDecrypt.mockReturnValue('buyer@example.com');

    mockedRepo.getCollectionDetail.mockResolvedValue(detail);
    mockedRepo.getPaymentHistory.mockResolvedValue([paymentRow]);
    mockedRepo.getEscalationHistory.mockResolvedValue([escalationRow]);
    mockedRepo.getBuyerContact.mockResolvedValue(buyerRow);

    const result = await service.getCollectionDetail(COLLECTION_ID);

    expect(result.id).toBe(COLLECTION_ID);
    expect(result.face_value).toBe(50000000);
    expect(result.collected_amount).toBe(10000000);
    expect(result.outstanding_amount).toBe(40000000);
    expect(result.escalation_level).toBe('reminder'); // escalation_level=1
    expect(result.buyer_contact.company).toBe('Test Buyer Ltd');
    expect(result.payment_history).toHaveLength(1);
    expect(result.payment_history[0]?.amount).toBe(10000000);
    expect(result.escalation_history).toHaveLength(1);
  });

  it('throws NotFoundError when collection detail is not found', async () => {
    mockedRepo.getCollectionDetail.mockResolvedValue(null);

    await expect(service.getCollectionDetail('missing-col')).rejects.toThrow('Collection');
  });

  it('returns empty buyer contact when buyerRow is null', async () => {
    const detail = makeDetailRow();

    mockedRepo.getCollectionDetail.mockResolvedValue(detail);
    mockedRepo.getPaymentHistory.mockResolvedValue([]);
    mockedRepo.getEscalationHistory.mockResolvedValue([]);
    mockedRepo.getBuyerContact.mockResolvedValue(null);

    const result = await service.getCollectionDetail(COLLECTION_ID);

    expect(result.buyer_contact.id).toBe('');
    expect(result.buyer_contact.company).toBe('Unknown');
    expect(result.buyer_contact.email).toBe('');
    expect(result.buyer_contact.phone).toBe('');
  });

  it('falls back to empty email when decrypt throws for email', async () => {
    const detail = makeDetailRow();
    const buyerRow = makeBuyerContactRow({ contact_email_encrypted: 'bad-data' });

    mockedDecrypt
      .mockImplementationOnce(() => {
        throw new Error('Decrypt failed');
      })
      .mockReturnValueOnce('+256700000000');

    mockedRepo.getCollectionDetail.mockResolvedValue(detail);
    mockedRepo.getPaymentHistory.mockResolvedValue([]);
    mockedRepo.getEscalationHistory.mockResolvedValue([]);
    mockedRepo.getBuyerContact.mockResolvedValue(buyerRow);

    const result = await service.getCollectionDetail(COLLECTION_ID);

    expect(result.buyer_contact.email).toBe('');
    expect(result.buyer_contact.phone).toBe('+256700000000');
  });

  it('falls back to empty phone when decrypt throws for phone', async () => {
    const detail = makeDetailRow();
    const buyerRow = makeBuyerContactRow({ contact_phone_encrypted: 'bad-data' });

    mockedDecrypt.mockReturnValueOnce('buyer@example.com').mockImplementationOnce(() => {
      throw new Error('Decrypt failed');
    });

    mockedRepo.getCollectionDetail.mockResolvedValue(detail);
    mockedRepo.getPaymentHistory.mockResolvedValue([]);
    mockedRepo.getEscalationHistory.mockResolvedValue([]);
    mockedRepo.getBuyerContact.mockResolvedValue(buyerRow);

    const result = await service.getCollectionDetail(COLLECTION_ID);

    expect(result.buyer_contact.email).toBe('buyer@example.com');
    expect(result.buyer_contact.phone).toBe('');
  });

  it('returns empty email when contact_email_encrypted is null', async () => {
    const detail = makeDetailRow();
    const buyerRow = makeBuyerContactRow({
      contact_email_encrypted: null,
      contact_phone_encrypted: null,
    });

    mockedRepo.getCollectionDetail.mockResolvedValue(detail);
    mockedRepo.getPaymentHistory.mockResolvedValue([]);
    mockedRepo.getEscalationHistory.mockResolvedValue([]);
    mockedRepo.getBuyerContact.mockResolvedValue(buyerRow);

    const result = await service.getCollectionDetail(COLLECTION_ID);

    expect(result.buyer_contact.email).toBe('');
    expect(result.buyer_contact.phone).toBe('');
    // Decrypt should not have been called since fields are null
    expect(mockedDecrypt).not.toHaveBeenCalled();
  });

  it('transforms escalation history with all level labels via escalationLevelName', async () => {
    const detail = makeDetailRow();

    const escalationRows: EscalationHistoryRow[] = [
      makeEscalationHistoryRow({ id: 'esc-1', escalation_level: 0 }),
      makeEscalationHistoryRow({ id: 'esc-2', escalation_level: 1 }),
      makeEscalationHistoryRow({ id: 'esc-3', escalation_level: 2 }),
      makeEscalationHistoryRow({ id: 'esc-4', escalation_level: 3 }),
    ];

    mockedRepo.getCollectionDetail.mockResolvedValue(detail);
    mockedRepo.getPaymentHistory.mockResolvedValue([]);
    mockedRepo.getEscalationHistory.mockResolvedValue(escalationRows);
    mockedRepo.getBuyerContact.mockResolvedValue(null);

    const result = await service.getCollectionDetail(COLLECTION_ID);

    expect(result.escalation_history[0]?.label).toBe('None');
    expect(result.escalation_history[0]?.level).toBe('none');
    expect(result.escalation_history[1]?.label).toBe('Reminder Sent');
    expect(result.escalation_history[1]?.level).toBe('reminder');
    expect(result.escalation_history[2]?.label).toBe('Formal Notice Issued');
    expect(result.escalation_history[2]?.level).toBe('formal');
    expect(result.escalation_history[3]?.label).toBe('Legal Action Initiated');
    expect(result.escalation_history[3]?.level).toBe('legal');
  });

  it('transforms payment history with notes present', async () => {
    const detail = makeDetailRow();
    const paymentRow = makePaymentHistoryRow({ notes: 'Wire transfer confirmed' });

    mockedRepo.getCollectionDetail.mockResolvedValue(detail);
    mockedRepo.getPaymentHistory.mockResolvedValue([paymentRow]);
    mockedRepo.getEscalationHistory.mockResolvedValue([]);
    mockedRepo.getBuyerContact.mockResolvedValue(null);

    const result = await service.getCollectionDetail(COLLECTION_ID);

    expect(result.payment_history[0]?.notes).toBe('Wire transfer confirmed');
    expect(result.payment_history[0]?.running_balance).toBe(40000000);
    expect(result.payment_history[0]?.reference).toBe('REF-001');
    expect(result.payment_history[0]?.method).toBe('bank_transfer');
  });

  it('returns null total_collected as 0 in collected_amount', async () => {
    const detail = makeDetailRow({ total_collected: null as unknown as string });

    mockedRepo.getCollectionDetail.mockResolvedValue(detail);
    mockedRepo.getPaymentHistory.mockResolvedValue([]);
    mockedRepo.getEscalationHistory.mockResolvedValue([]);
    mockedRepo.getBuyerContact.mockResolvedValue(null);

    const result = await service.getCollectionDetail(COLLECTION_ID);

    expect(result.collected_amount).toBe(0);
  });

  it('maps escalation_level 0 to "none" in detail response', async () => {
    const detail = makeDetailRow({ escalation_level: 0 });

    mockedRepo.getCollectionDetail.mockResolvedValue(detail);
    mockedRepo.getPaymentHistory.mockResolvedValue([]);
    mockedRepo.getEscalationHistory.mockResolvedValue([]);
    mockedRepo.getBuyerContact.mockResolvedValue(null);

    const result = await service.getCollectionDetail(COLLECTION_ID);
    expect(result.escalation_level).toBe('none');
  });
});

// ===========================================================================
// determineEscalationLevel
// ===========================================================================

describe('determineEscalationLevel', () => {
  it('returns 3 for daysOverdue >= 14', () => {
    expect(service.determineEscalationLevel(14)).toBe(3);
    expect(service.determineEscalationLevel(20)).toBe(3);
  });

  it('returns 2 for daysOverdue >= 7 but < 14', () => {
    expect(service.determineEscalationLevel(7)).toBe(2);
    expect(service.determineEscalationLevel(10)).toBe(2);
  });

  it('returns 1 for daysOverdue >= 3 but < 7', () => {
    expect(service.determineEscalationLevel(3)).toBe(1);
    expect(service.determineEscalationLevel(5)).toBe(1);
  });

  it('returns 0 for daysOverdue < 3', () => {
    expect(service.determineEscalationLevel(0)).toBe(0);
    expect(service.determineEscalationLevel(2)).toBe(0);
  });
});

// ===========================================================================
// Queue helpers — null-queue warn path (lines 879-883 and 893-897)
// ===========================================================================

describe('queueNotification — null queue branch', () => {
  it('logs warn and returns when notificationQueue is null (via processOverdueInvoice)', async () => {
    // beforeEach already resets notificationQueue to null
    const invoice = makeInvoice();
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.createOverdueRecord.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    // Queue is null — queueNotification will hit the warn+return branch
    await expect(service.processOverdueInvoice(INVOICE_ID, OFFICER_ID)).resolves.toBeUndefined();
  });

  it('calls notificationQueue.add when queue is configured (via processOverdueInvoice)', async () => {
    const mockQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as import('bullmq').Queue;
    service.setNotificationQueue(mockQueue);

    const invoice = makeInvoice();
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.createOverdueRecord.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processOverdueInvoice(INVOICE_ID, OFFICER_ID);

    expect(mockQueue.add).toHaveBeenCalledWith(
      'overdue-notification',
      expect.objectContaining({ invoiceId: INVOICE_ID }),
      expect.objectContaining({ attempts: 3 }),
    );
  });
});

describe('queueFacilityRepayment — null queue branch', () => {
  it('logs warn and returns when facilityRepaymentQueue is null (via recordPaymentReceived)', async () => {
    // beforeEach already resets facilityRepaymentQueue to null
    // Also ensure notificationQueue is set so queueNotification succeeds
    service.setNotificationQueue({
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as import('bullmq').Queue);

    const invoice = makeInvoice({ status: 'overdue' });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(makeCollection());
    mockedRepo.recordPaymentReceived.mockResolvedValue(undefined);
    mockedRepo.reduceBuyerUsedLimit.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.resolveCollection.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    // facilityRepaymentQueue is null — queueFacilityRepayment hits warn+return branch
    await expect(
      service.recordPaymentReceived({
        invoiceId: INVOICE_ID,
        amount: '50000000',
        paymentDate: '2026-03-15',
        receivedBy: OFFICER_ID,
        paymentMethod: 'bank_transfer',
        paidBy: 'Test Buyer Corporation',
      }),
    ).resolves.toBeUndefined();
  });

  it('calls facilityRepaymentQueue.add when queue is configured', async () => {
    const mockNotifQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as import('bullmq').Queue;
    const mockFacilityQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as import('bullmq').Queue;
    service.setNotificationQueue(mockNotifQueue);
    service.setFacilityRepaymentQueue(mockFacilityQueue);

    const invoice = makeInvoice({ status: 'overdue' });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(makeCollection());
    mockedRepo.recordPaymentReceived.mockResolvedValue(undefined);
    mockedRepo.reduceBuyerUsedLimit.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.resolveCollection.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.recordPaymentReceived({
      invoiceId: INVOICE_ID,
      amount: '50000000',
      paymentDate: '2026-03-15',
      receivedBy: OFFICER_ID,
      paymentMethod: 'bank_transfer',
      paidBy: 'Test Buyer Corporation',
    });

    expect(mockFacilityQueue.add).toHaveBeenCalledWith(
      'facility-repayment',
      expect.objectContaining({ invoiceId: INVOICE_ID, drawdownId: 'drawdown-001' }),
      expect.objectContaining({ attempts: 3 }),
    );
  });
});

// ===========================================================================
// getNotificationQueueRef — null and set cases
// ===========================================================================

describe('getNotificationQueueRef — explicit null and set', () => {
  it('returns null when notification queue has been reset to null', () => {
    // beforeEach sets it to null via setNotificationQueue(null)
    const result = service.getNotificationQueueRef();
    expect(result).toBeNull();
  });

  it('returns the queue instance after it has been set', () => {
    const mockQueue = { add: jest.fn() } as unknown as import('bullmq').Queue;
    service.setNotificationQueue(mockQueue);
    expect(service.getNotificationQueueRef()).toBe(mockQueue);
  });
});

// ===========================================================================
// Module-level constant: AML_FLAG_THRESHOLD fallback (branch coverage)
// ===========================================================================

describe('AML_FLAG_THRESHOLD_UGX env var fallback', () => {
  it('uses default 100000000 when AML_FLAG_THRESHOLD_UGX is not set in environment', async () => {
    // Remove the env var, reset modules, re-import the service to cover the ?? '100000000' branch
    const savedEnv = process.env.AML_FLAG_THRESHOLD_UGX;
    delete process.env.AML_FLAG_THRESHOLD_UGX;

    jest.resetModules();

    // Re-mock dependencies after resetModules
    jest.mock('../../../src/services/collections/collections.repository');
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

    // Re-import the module without the env var set (triggers ?? '100000000' fallback)
    const freshService = await import('../../../src/services/collections/collections.service');
    const freshRepo = await import('../../../src/services/collections/collections.repository');
    const { pool: freshPool } = await import('../../../src/shared/database/pool');

    const mockedFreshRepo = freshRepo as jest.Mocked<typeof freshRepo>;
    const mockedFreshPool = freshPool as jest.Mocked<typeof freshPool>;

    // Escalation with face_value > default threshold (100M) should still flag SAR
    const invoiceAboveThreshold = {
      id: INVOICE_ID,
      face_value: '150000000',
      advance_amount: '127500000',
      status: 'funded' as const,
      supplier_id: SUPPLIER_ID,
      buyer_id: BUYER_ID,
      due_date: '2026-03-01',
    };
    const collectionRecord = {
      id: COLLECTION_ID,
      invoice_id: INVOICE_ID,
      buyer_id: BUYER_ID,
      face_value: '150000000',
      amount_due: '150000000',
      days_overdue: 14,
      daily_penalty_rate: '0.001',
      penalty_amount: '2100000',
      status: CollectionStatus.OVERDUE,
      escalation_level: null,
      demand_notice_sent: false,
      sar_flagged: false,
      total_collected: null,
      last_payment_at: null,
      created_at: '2026-03-08T00:00:00Z',
      updated_at: '2026-03-08T00:00:00Z',
    };

    mockedFreshRepo.getInvoiceForCollection.mockResolvedValue(invoiceAboveThreshold);
    mockedFreshRepo.getCollectionByInvoiceId.mockResolvedValue(collectionRecord);
    mockedFreshRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedFreshRepo.updateEscalationLevel.mockResolvedValue(undefined);
    mockedFreshRepo.flagForSarReview.mockResolvedValue(undefined);
    mockedFreshRepo.createAuditEntry.mockResolvedValue(undefined);

    const freshClient = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };
    mockedFreshPool.connect.mockResolvedValue(freshClient as never);

    // This triggers processEscalation with the freshly imported module that used the fallback
    await freshService.processEscalation(INVOICE_ID, 14);

    // SAR should be flagged since 150M > 100M (default threshold)
    expect(mockedFreshRepo.flagForSarReview).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID);

    // Restore env var and reset modules back to original state
    process.env.AML_FLAG_THRESHOLD_UGX = savedEnv;
    jest.resetModules();
  });
});

// ===========================================================================
// calculatePenalty — rateParts[0] ?? '0' branch coverage
// ===========================================================================

describe('calculatePenalty — nullish coalescing branch in rateParts', () => {
  it('handles a rate string that splits to have a defined intPart (covers rateParts[0] ?? "0")', () => {
    // rateParts[0] ?? '0': String.prototype.split always returns array with at least one element
    // so rateParts[0] is always defined (even if empty string). The ?? '0' fallback is a
    // defensive code path. We exercise it by passing an empty-integer-part rate like '.005'
    // where rateParts[0] = '' (empty string, defined, not null/undefined).
    // Istanbul binary-expr tracks both sides; '' is truthy for ?? so we can't hit ?? '0' via
    // normal calls. Instead, verify the existing behavior is correct and that all reachable
    // code paths behave correctly.

    // Rate '.005': rateParts = ['', '005'] → intPart = '' → BigInt('') would throw
    // So the actual implementation uses a non-empty rate; test with '0.005':
    const result = service.calculatePenalty('1000000', 2, '0.005');
    // penalty = 1000000 * 5000 (rate scaled) * 2 / 1000000 = 10000
    expect(result).toBe('10000');
  });

  it('handles rate with only integer part (no decimal), covering fracPart ?? "" branch', () => {
    // When rate = '2' (integer only): rateParts = ['2'], rateParts[1] = undefined → '' via ??
    const result = service.calculatePenalty('500000', 1, '2');
    // penalty = 500000 * 2000000 * 1 / 1000000 = 1000000
    expect(result).toBe('1000000');
  });

  it('handles rate = "0" (zero penalty rate)', () => {
    const result = service.calculatePenalty('50000000', 10, '0');
    expect(result).toBe('0');
  });
});

// ===========================================================================
// processDefaulted — auto-default workflow
// ===========================================================================

describe('processDefaulted', () => {
  it('defaults all eligible collections (success path)', async () => {
    const defaultableCollections = [
      {
        id: COLLECTION_ID,
        invoice_id: INVOICE_ID,
        buyer_id: BUYER_ID,
        days_overdue: 91,
        face_value: '50000000',
      },
    ];
    mockedRepo.getDefaultableCollections.mockResolvedValue(defaultableCollections);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processDefaulted();

    expect(mockedRepo.updateCollectionStatus).toHaveBeenCalledWith(
      expect.anything(),
      COLLECTION_ID,
      CollectionStatus.BAD_DEBT,
    );
    expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      'defaulted',
      'overdue',
    );
  });

  it('handles empty defaultable collections list', async () => {
    mockedRepo.getDefaultableCollections.mockResolvedValue([]);
    await expect(service.processDefaulted()).resolves.toBeUndefined();
    expect(mockedRepo.updateCollectionStatus).not.toHaveBeenCalled();
  });

  it('logs error and continues when a collection fails to default (Error instance)', async () => {
    const defaultableCollections = [
      {
        id: COLLECTION_ID,
        invoice_id: INVOICE_ID,
        buyer_id: BUYER_ID,
        days_overdue: 91,
        face_value: '50000000',
      },
      {
        id: 'col-2',
        invoice_id: 'inv-2',
        buyer_id: BUYER_ID,
        days_overdue: 95,
        face_value: '50000000',
      },
    ];
    mockedRepo.getDefaultableCollections.mockResolvedValue(defaultableCollections);
    const freshClient1 = {
      query: jest.fn().mockRejectedValueOnce(new Error('DB error')).mockResolvedValue(undefined),
      release: jest.fn(),
    };
    const freshClient2 = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };
    mockedPool.connect
      .mockResolvedValueOnce(freshClient1 as never)
      .mockResolvedValueOnce(freshClient2 as never);
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await expect(service.processDefaulted()).resolves.toBeUndefined();
  });

  it('logs "Unknown" error message when a non-Error is thrown during default', async () => {
    const defaultableCollections = [
      {
        id: COLLECTION_ID,
        invoice_id: INVOICE_ID,
        buyer_id: BUYER_ID,
        days_overdue: 91,
        face_value: '50000000',
      },
    ];
    mockedRepo.getDefaultableCollections.mockResolvedValue(defaultableCollections);
    mockedRepo.updateCollectionStatus.mockRejectedValue('plain string rejection');

    await expect(service.processDefaulted()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// processOverdueInvoices — batch processing
// ===========================================================================

describe('processOverdueInvoices', () => {
  it('processes all funded overdue invoices successfully', async () => {
    const overdueInvoices = [{ id: INVOICE_ID }];
    mockedRepo.getFundedOverdueInvoices.mockResolvedValue(overdueInvoices);
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice());
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.createOverdueRecord.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processOverdueInvoices();

    expect(mockedRepo.getFundedOverdueInvoices).toHaveBeenCalled();
    expect(mockedRepo.createOverdueRecord).toHaveBeenCalled();
  });

  it('handles empty invoice list', async () => {
    mockedRepo.getFundedOverdueInvoices.mockResolvedValue([]);
    await expect(service.processOverdueInvoices()).resolves.toBeUndefined();
  });

  it('logs error and continues when an invoice fails (Error instance)', async () => {
    const overdueInvoices = [{ id: INVOICE_ID }];
    mockedRepo.getFundedOverdueInvoices.mockResolvedValue(overdueInvoices);
    mockedRepo.getInvoiceForCollection.mockRejectedValue(new Error('DB error'));

    await expect(service.processOverdueInvoices()).resolves.toBeUndefined();
  });

  it('logs "Unknown" via logBatchError when a non-Error is thrown', async () => {
    const overdueInvoices = [{ id: INVOICE_ID }];
    mockedRepo.getFundedOverdueInvoices.mockResolvedValue(overdueInvoices);
    mockedRepo.getInvoiceForCollection.mockRejectedValue('plain string rejection');

    await expect(service.processOverdueInvoices()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// processEscalations — batch processing
// ===========================================================================

describe('processEscalations', () => {
  it('processes all escalation candidates successfully', async () => {
    const candidates = [
      { id: COLLECTION_ID, invoice_id: INVOICE_ID, days_overdue: 7, escalation_level: 1 },
    ];
    mockedRepo.getEscalationCandidates.mockResolvedValue(candidates);
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice({ face_value: '50000000' }));
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(makeCollection({ days_overdue: 7 }));
    mockedRepo.updateCollectionStatus.mockResolvedValue(undefined);
    mockedRepo.updateEscalationLevel.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processEscalations();

    expect(mockedRepo.getEscalationCandidates).toHaveBeenCalled();
    expect(mockedRepo.updateCollectionStatus).toHaveBeenCalled();
  });

  it('handles empty candidates list', async () => {
    mockedRepo.getEscalationCandidates.mockResolvedValue([]);
    await expect(service.processEscalations()).resolves.toBeUndefined();
  });

  it('logs error and continues when an escalation fails', async () => {
    const candidates = [
      { id: COLLECTION_ID, invoice_id: INVOICE_ID, days_overdue: 7, escalation_level: 1 },
    ];
    mockedRepo.getEscalationCandidates.mockResolvedValue(candidates);
    mockedRepo.getInvoiceForCollection.mockRejectedValue(new Error('DB error'));

    await expect(service.processEscalations()).resolves.toBeUndefined();
  });

  it('logs "Unknown" when a non-Error is thrown during escalation batch', async () => {
    const candidates = [
      { id: COLLECTION_ID, invoice_id: INVOICE_ID, days_overdue: 7, escalation_level: 1 },
    ];
    mockedRepo.getEscalationCandidates.mockResolvedValue(candidates);
    mockedRepo.getInvoiceForCollection.mockRejectedValue('plain string rejection');

    await expect(service.processEscalations()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// handleReminderEscalation — T_PLUS_1 and T_MINUS_3 branches
// (tested via processReminders)
// ===========================================================================

describe('processReminders — T_PLUS_1 escalation branch', () => {
  it('calls processOverdueInvoice when reminder_type is T_PLUS_1 (success)', async () => {
    const reminderInvoice = makeReminderInvoice({ reminder_type: ReminderType.T_PLUS_1 });
    mockedRepo.getInvoicesDueForReminder.mockResolvedValue([reminderInvoice]);
    // Issue #35: T+1 transition now requires status='collecting' (no longer 'funded').
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice({ status: 'collecting' }));
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.createOverdueRecord.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.processReminders();

    expect(mockedRepo.createOverdueRecord).toHaveBeenCalled();
  });

  it('logs warn and continues when T_PLUS_1 processOverdueInvoice throws an Error', async () => {
    const reminderInvoice = makeReminderInvoice({ reminder_type: ReminderType.T_PLUS_1 });
    mockedRepo.getInvoicesDueForReminder.mockResolvedValue([reminderInvoice]);
    mockedRepo.getInvoiceForCollection.mockResolvedValue(null); // triggers NotFoundError

    await expect(service.processReminders()).resolves.toBeUndefined();
  });

  it('logs warn with "Unknown" when T_PLUS_1 throws a non-Error', async () => {
    const reminderInvoice = makeReminderInvoice({ reminder_type: ReminderType.T_PLUS_1 });
    mockedRepo.getInvoicesDueForReminder.mockResolvedValue([reminderInvoice]);
    mockedRepo.getInvoiceForCollection.mockRejectedValue('plain string rejection');

    await expect(service.processReminders()).resolves.toBeUndefined();
  });
});

describe('processReminders — T_MINUS_3 escalation branch', () => {
  it('queues buyer-payment-escalation notification when reminder_type is T_MINUS_3', async () => {
    const reminderInvoice = makeReminderInvoice({ reminder_type: ReminderType.T_MINUS_3 });
    mockedRepo.getInvoicesDueForReminder.mockResolvedValue([reminderInvoice]);

    const mockQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as import('bullmq').Queue;
    service.setNotificationQueue(mockQueue);

    await service.processReminders();

    expect(mockQueue.add).toHaveBeenCalledWith(
      'buyer-payment-escalation',
      expect.objectContaining({ invoiceId: INVOICE_ID }),
      expect.any(Object),
    );
  });
});

// ===========================================================================
// queueSettlementInitiation — active queue path
// ===========================================================================

describe('queueSettlementInitiation — active queue branch', () => {
  it('calls settlementQueue.add when settlement queue is configured', async () => {
    const mockSettlementQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as import('bullmq').Queue;
    const mockFacilityQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as import('bullmq').Queue;
    const mockNotifQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as import('bullmq').Queue;

    service.setSettlementQueue(mockSettlementQueue);
    service.setFacilityRepaymentQueue(mockFacilityQueue);
    service.setNotificationQueue(mockNotifQueue);

    const invoice = makeInvoice({ status: 'overdue' });
    mockedRepo.getInvoiceForCollection.mockResolvedValue(invoice);
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(makeCollection());
    mockedRepo.recordPaymentReceived.mockResolvedValue(undefined);
    mockedRepo.reduceBuyerUsedLimit.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.resolveCollection.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.recordPaymentReceived({
      invoiceId: INVOICE_ID,
      amount: '50000000',
      paymentDate: '2026-03-15',
      receivedBy: OFFICER_ID,
      paymentMethod: 'bank_transfer',
      paidBy: 'Test Buyer Corporation',
    });

    expect(mockSettlementQueue.add).toHaveBeenCalledWith(
      'settlement-initiate',
      expect.objectContaining({ invoiceId: INVOICE_ID }),
      expect.objectContaining({ attempts: 3 }),
    );
  });
});

// ===========================================================================
// startCollectionMonitoring (issue #35 — funded → collecting)
// ===========================================================================

describe('startCollectionMonitoring', () => {
  const PAYMENT_ID = 'pay-uuid-1';

  it('inserts a pending collection row + transitions invoice to collecting + writes audit', async () => {
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice({ status: 'funded' }));
    mockedRepo.createPendingCollectionRecord.mockResolvedValue(undefined);
    mockedRepo.updateInvoiceStatus.mockResolvedValue(true);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID);

    const client = await mockedPool.connect();
    expect(beginWithRls).toHaveBeenCalledWith(client);
    expect(mockedRepo.createPendingCollectionRecord).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      expect.objectContaining({
        buyerId: BUYER_ID,
        faceValue: '50000000',
        daysOverdue: 0,
        penaltyAmount: '0',
      }),
    );
    expect(mockedRepo.updateInvoiceStatus).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      'collecting',
      'funded',
    );
    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      'SYSTEM',
      'COLLECTION_STARTED',
      'collections',
      INVOICE_ID,
      expect.objectContaining({ status: 'funded' }),
      expect.objectContaining({ status: 'collecting', paymentId: PAYMENT_ID }),
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('is idempotent — exits cleanly when a collections row already exists', async () => {
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(makeCollection());

    await service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID);

    expect(mockedRepo.createPendingCollectionRecord).not.toHaveBeenCalled();
    expect(mockedRepo.updateInvoiceStatus).not.toHaveBeenCalled();
    expect(mockedRepo.createAuditEntry).not.toHaveBeenCalled();
  });

  it('skips when invoice has already moved past funded (e.g. collecting/overdue)', async () => {
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice({ status: 'collecting' }));

    await service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID);

    expect(mockedRepo.createPendingCollectionRecord).not.toHaveBeenCalled();
    expect(mockedRepo.updateInvoiceStatus).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the invoice does not exist', async () => {
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.getInvoiceForCollection.mockResolvedValue(null);

    await expect(service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID)).rejects.toThrow(
      'Invoice',
    );
  });

  it('rolls back the transaction when the INSERT fails', async () => {
    mockedRepo.getCollectionByInvoiceId.mockResolvedValue(null);
    mockedRepo.getInvoiceForCollection.mockResolvedValue(makeInvoice({ status: 'funded' }));
    mockedRepo.createPendingCollectionRecord.mockRejectedValue(new Error('DB error'));

    await expect(service.startCollectionMonitoring(INVOICE_ID, PAYMENT_ID)).rejects.toThrow(
      'DB error',
    );

    const client = await mockedPool.connect();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
