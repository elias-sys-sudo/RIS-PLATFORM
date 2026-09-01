process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import crypto from 'crypto';
import * as service from '../../../src/services/verification/verification.service';
import * as repo from '../../../src/services/verification/verification.repository';
import { VerificationErrorCode } from '../../../src/services/verification/verification.types';
import type {
  InvoiceConfirmationRow,
  BuyerContact,
} from '../../../src/services/verification/verification.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/verification/verification.repository');
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
  encrypt: jest.fn((text: string) => `encrypted:${text}`),
  decrypt: jest.fn((text: string) => text.replace('encrypted:', '')),
  hashDocument: jest.fn((buf: Buffer) => buf.toString('hex')),
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;

// Mock transaction client
const mockClient = {
  query: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
} as unknown as import('pg').PoolClient;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const IP = '192.168.1.1';
const UA = 'jest-test-agent';
const USER_ID = 'credit-officer-1';
const INVOICE_ID = 'invoice-uuid-1';
const BUYER_ID = 'buyer-uuid-1';
const RAW_TOKEN = 'a'.repeat(64);

function tokenHash(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function makeInvoiceRow(overrides: Partial<InvoiceConfirmationRow> = {}): InvoiceConfirmationRow {
  return {
    id: INVOICE_ID,
    invoice_number: 'INV-001',
    supplier_id: 'supplier-uuid-1',
    buyer_id: BUYER_ID,
    face_value: '50000000',
    due_date: '2026-05-01',
    description: 'Test goods',
    status: 'submitted',
    confirmation_token_hash: tokenHash(RAW_TOKEN),
    confirmation_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    buyer_confirmed_at: null,
    created_at: new Date().toISOString(),
    // G1 — EFRIS fields: mock-valid ref passes verification via MockEfrisProvider.
    ura_efris_ref: 'EFRIS-TEST-001',
    efris_verified_at: null,
    ...overrides,
  };
}

function makeBuyerContact(): BuyerContact {
  return {
    contact_email_encrypted: 'encrypted:buyer@example.com',
    contact_phone_encrypted: 'encrypted:+256700000000',
    company_name: 'Test Buyer Ltd',
  };
}

const allTrue = {
  invoice_is_valid: true,
  amount_is_correct: true,
  due_date_is_correct: true,
  agrees_to_pay_ris: true,
};

// Mock queues
const mockQueueAdd = jest.fn().mockResolvedValue(undefined);
const mockQueue = { add: mockQueueAdd } as unknown as import('bullmq').Queue;
const mockRiskQueueAdd = jest.fn().mockResolvedValue(undefined);
const mockRiskQueue = { add: mockRiskQueueAdd } as unknown as import('bullmq').Queue;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  service.setNotificationQueue(mockQueue);
  service.setRiskScoringQueue(mockRiskQueue);

  mockedRepo.getClient.mockResolvedValue(mockClient);
  mockedRepo.storeConfirmationToken.mockResolvedValue(undefined);
  mockedRepo.storeConfirmationTokenWithClient.mockResolvedValue(undefined);
  mockedRepo.findBuyerEncryptedContact.mockResolvedValue(makeBuyerContact());
  mockedRepo.createAuditEntry.mockResolvedValue(undefined);
  mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);
  mockedRepo.findInvoiceByTokenHash.mockResolvedValue(makeInvoiceRow());
  mockedRepo.findInvoiceForConfirmationPage.mockResolvedValue({
    invoice_number: 'INV-001',
    face_value: '50000000',
    due_date: '2026-05-01',
    description: 'Test goods',
    supplier_name: 'Test Supplier Ltd',
    buyer_name: 'Test Buyer Ltd',
  });
  mockedRepo.confirmInvoice.mockResolvedValue(1);
  mockedRepo.confirmInvoiceWithClient.mockResolvedValue(1);
  mockedRepo.findInvoiceById.mockResolvedValue(makeInvoiceRow());
  mockedRepo.findPendingConfirmations.mockResolvedValue({
    rows: [],
    total: 0,
  });
  mockedRepo.findInvoicesPendingReminder.mockResolvedValue([]);
  mockedRepo.hasReminderBeenSent.mockResolvedValue(false);
});

// =========================================================================
// Token Generation
// =========================================================================
describe('generateConfirmationToken', () => {
  it('generates a 64-char hex token and stores SHA-256 hash (not raw)', async () => {
    const rawToken = await service.generateConfirmationToken(INVOICE_ID, BUYER_ID, IP, UA);

    expect(rawToken).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(rawToken)).toBe(true);

    const storedHash = mockedRepo.storeConfirmationTokenWithClient.mock.calls[0][2] as string;
    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    expect(storedHash).toBe(expectedHash);
    expect(storedHash).not.toBe(rawToken);
  });

  it('sets 48-hour expiry', async () => {
    const before = Date.now();
    await service.generateConfirmationToken(INVOICE_ID, BUYER_ID, IP, UA);
    const after = Date.now();

    const expiryStr = mockedRepo.storeConfirmationTokenWithClient.mock.calls[0][3] as string;
    const expiryMs = new Date(expiryStr).getTime();
    const expectedMin = before + 48 * 60 * 60 * 1000;
    const expectedMax = after + 48 * 60 * 60 * 1000;

    expect(expiryMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiryMs).toBeLessThanOrEqual(expectedMax);
  });

  it('queues confirmation email to buyer', async () => {
    await service.generateConfirmationToken(INVOICE_ID, BUYER_ID, IP, UA);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send-buyer-confirmation-email',
      expect.objectContaining({
        invoiceId: INVOICE_ID,
        buyerId: BUYER_ID,
      }),
      { attempts: 3, backoff: { type: 'exponential', delay: 30000 } },
    );
  });

  it('writes CONFIRMATION_TOKEN_GENERATED audit entry', async () => {
    await service.generateConfirmationToken(INVOICE_ID, BUYER_ID, IP, UA);

    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      null,
      'CONFIRMATION_TOKEN_GENERATED',
      'invoices',
      INVOICE_ID,
      null,
      expect.objectContaining({ buyerId: BUYER_ID }),
      IP,
      UA,
    );
  });

  it('warns but does not throw when notification queue is null', async () => {
    service.setNotificationQueue(null as unknown as import('bullmq').Queue);

    await expect(
      service.generateConfirmationToken(INVOICE_ID, BUYER_ID, IP, UA),
    ).resolves.toBeDefined();

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('warns when buyer contact is not found', async () => {
    mockedRepo.findBuyerEncryptedContact.mockResolvedValue(null);

    await expect(
      service.generateConfirmationToken(INVOICE_ID, BUYER_ID, IP, UA),
    ).resolves.toBeDefined();

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Confirmation Page
// =========================================================================
describe('getConfirmationPageData', () => {
  it('returns invoice details for valid token', async () => {
    const data = await service.getConfirmationPageData(RAW_TOKEN);

    expect(data.invoice_number).toBe('INV-001');
    expect(data.face_value).toBe(50000000);
    expect(data.supplier_name).toBe('Test Supplier Ltd');
    expect(data.ris_bank_details).toBeDefined();
    expect(data.ris_bank_details.length).toBeGreaterThan(0);
  });

  it('throws NotFoundError for non-existent token', async () => {
    mockedRepo.findInvoiceByTokenHash.mockResolvedValue(null);

    await expect(service.getConfirmationPageData('b'.repeat(64))).rejects.toThrow('not found');
  });

  it('throws TOKEN_EXPIRED for expired token', async () => {
    mockedRepo.findInvoiceByTokenHash.mockResolvedValue(
      makeInvoiceRow({
        confirmation_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    await expect(service.getConfirmationPageData(RAW_TOKEN)).rejects.toThrow('expired');
  });

  it('throws TOKEN_ALREADY_USED for used token', async () => {
    mockedRepo.findInvoiceByTokenHash.mockResolvedValue(
      makeInvoiceRow({
        buyer_confirmed_at: new Date().toISOString(),
      }),
    );

    await expect(service.getConfirmationPageData(RAW_TOKEN)).rejects.toThrow(
      'already been confirmed',
    );
  });

  it('throws NotFoundError when invoice page data is null', async () => {
    mockedRepo.findInvoiceForConfirmationPage.mockResolvedValue(null);

    await expect(service.getConfirmationPageData(RAW_TOKEN)).rejects.toThrow('not found');
  });
});

// =========================================================================
// Confirm Invoice
// =========================================================================
describe('confirmInvoice', () => {
  it('confirms with all 4 booleans true → buyer_confirmed, IP recorded', async () => {
    const result = await service.confirmInvoice(RAW_TOKEN, allTrue, IP, UA);

    expect(result.invoiceId).toBe(INVOICE_ID);
    expect(mockedRepo.confirmInvoiceWithClient).toHaveBeenCalledWith(
      mockClient,
      INVOICE_ID,
      IP,
      UA,
    );
  });

  it('writes BUYER_CONFIRMED audit with old/new status', async () => {
    await service.confirmInvoice(RAW_TOKEN, allTrue, IP, UA);

    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      null,
      'BUYER_CONFIRMED',
      'invoices',
      INVOICE_ID,
      { status: 'submitted' },
      { status: 'buyer_confirmed', buyerIp: IP },
      IP,
      UA,
    );
  });

  it('queues risk scoring Bull job after confirmation', async () => {
    await service.confirmInvoice(RAW_TOKEN, allTrue, IP, UA);

    expect(mockRiskQueueAdd).toHaveBeenCalledWith(
      'score-invoice',
      expect.objectContaining({ invoiceId: INVOICE_ID }),
      expect.objectContaining({ attempts: 3, backoff: { type: 'exponential', delay: 30000 } }),
    );
  });

  it('rejects when invoice_is_valid is false', async () => {
    await expect(
      service.confirmInvoice(RAW_TOKEN, { ...allTrue, invoice_is_valid: false }, IP, UA),
    ).rejects.toThrow('All confirmation fields must be true');
  });

  it('rejects when amount_is_correct is false', async () => {
    await expect(
      service.confirmInvoice(RAW_TOKEN, { ...allTrue, amount_is_correct: false }, IP, UA),
    ).rejects.toThrow('All confirmation fields must be true');
  });

  it('rejects when due_date_is_correct is false', async () => {
    await expect(
      service.confirmInvoice(RAW_TOKEN, { ...allTrue, due_date_is_correct: false }, IP, UA),
    ).rejects.toThrow('All confirmation fields must be true');
  });

  it('rejects when agrees_to_pay_ris is false', async () => {
    await expect(
      service.confirmInvoice(RAW_TOKEN, { ...allTrue, agrees_to_pay_ris: false }, IP, UA),
    ).rejects.toThrow('All confirmation fields must be true');
  });

  it('includes missing fields list in error data', async () => {
    try {
      await service.confirmInvoice(
        RAW_TOKEN,
        {
          invoice_is_valid: false,
          amount_is_correct: true,
          due_date_is_correct: false,
          agrees_to_pay_ris: true,
        },
        IP,
        UA,
      );
      fail('Should have thrown');
    } catch (err: unknown) {
      const error = err as { errorCode: string; data: { missing: string[] } };
      expect(error.errorCode).toBe(VerificationErrorCode.CONFIRMATION_INCOMPLETE);
      expect(error.data.missing).toContain('invoice_is_valid');
      expect(error.data.missing).toContain('due_date_is_correct');
      expect(error.data.missing).not.toContain('amount_is_correct');
    }
  });

  it('throws TOKEN_ALREADY_USED on race condition (rowCount=0)', async () => {
    mockedRepo.confirmInvoiceWithClient.mockResolvedValue(0);

    await expect(service.confirmInvoice(RAW_TOKEN, allTrue, IP, UA)).rejects.toThrow(
      'already been confirmed',
    );
  });

  it('throws NotFoundError for non-existent token', async () => {
    mockedRepo.findInvoiceByTokenHash.mockResolvedValue(null);

    await expect(service.confirmInvoice('c'.repeat(64), allTrue, IP, UA)).rejects.toThrow(
      'not found',
    );
  });

  it('throws TOKEN_EXPIRED for expired token', async () => {
    mockedRepo.findInvoiceByTokenHash.mockResolvedValue(
      makeInvoiceRow({
        confirmation_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    await expect(service.confirmInvoice(RAW_TOKEN, allTrue, IP, UA)).rejects.toThrow('expired');
  });

  it('throws TOKEN_ALREADY_USED for used token', async () => {
    mockedRepo.findInvoiceByTokenHash.mockResolvedValue(
      makeInvoiceRow({
        buyer_confirmed_at: new Date().toISOString(),
      }),
    );

    await expect(service.confirmInvoice(RAW_TOKEN, allTrue, IP, UA)).rejects.toThrow(
      'already been confirmed',
    );
  });

  it('warns but does not throw when risk scoring queue is null', async () => {
    service.setRiskScoringQueue(null as unknown as import('bullmq').Queue);

    await expect(service.confirmInvoice(RAW_TOKEN, allTrue, IP, UA)).resolves.toEqual({
      invoiceId: INVOICE_ID,
    });

    expect(mockRiskQueueAdd).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Resend Confirmation
// =========================================================================
describe('resendConfirmation', () => {
  it('generates new token for submitted invoice', async () => {
    await service.resendConfirmation(INVOICE_ID, USER_ID, IP, UA);

    expect(mockedRepo.storeConfirmationTokenWithClient).toHaveBeenCalled();
  });

  it('writes CONFIRMATION_RESENT audit', async () => {
    await service.resendConfirmation(INVOICE_ID, USER_ID, IP, UA);

    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      USER_ID,
      'CONFIRMATION_RESENT',
      'invoices',
      INVOICE_ID,
      null,
      { resentBy: USER_ID },
      IP,
      UA,
    );
  });

  it('throws NotFoundError for missing invoice', async () => {
    mockedRepo.findInvoiceById.mockResolvedValue(null);

    await expect(service.resendConfirmation('missing-id', USER_ID, IP, UA)).rejects.toThrow(
      'not found',
    );
  });

  it('throws INVOICE_NOT_SUBMITTED for non-submitted invoice', async () => {
    mockedRepo.findInvoiceById.mockResolvedValue(makeInvoiceRow({ status: 'buyer_confirmed' }));

    await expect(service.resendConfirmation(INVOICE_ID, USER_ID, IP, UA)).rejects.toThrow(
      'submitted invoices',
    );
  });

  it('throws TOKEN_ALREADY_USED for already confirmed invoice', async () => {
    mockedRepo.findInvoiceById.mockResolvedValue(
      makeInvoiceRow({
        buyer_confirmed_at: new Date().toISOString(),
      }),
    );

    await expect(service.resendConfirmation(INVOICE_ID, USER_ID, IP, UA)).rejects.toThrow(
      'already been confirmed',
    );
  });
});

// =========================================================================
// Pending Confirmations List
// =========================================================================
describe('listPendingConfirmations', () => {
  it('returns paginated results', async () => {
    mockedRepo.findPendingConfirmations.mockResolvedValue({
      rows: [
        {
          id: 'inv-1',
          invoice_number: 'INV-001',
          supplier_name: 'Supplier A',
          buyer_name: 'Buyer A',
          face_value: '50000000',
          due_date: '2026-05-01',
          submitted_at: '2026-03-20T10:00:00Z',
          hours_since_submission: '12.5',
        },
      ],
      total: 1,
    });

    const result = await service.listPendingConfirmations({
      page: 1,
      limit: 20,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].face_value).toBe(50000000);
    expect(result.data[0].hours_since_submission).toBe(12.5);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });
});

// =========================================================================
// Reminder Processing
// =========================================================================
function reminderMock(
  targetMin: number,
  rows: {
    id: string;
    buyer_id: string;
    invoice_number: string;
    face_value: string;
    created_at: string;
    contact_email_encrypted: string;
  }[],
) {
  return (mockedRepo.findInvoicesPendingReminder as jest.Mock).mockImplementation((min: number) => {
    if (min === targetMin) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}

describe('processReminders', () => {
  it('sends T+2 day reminder for unconfirmed invoices', async () => {
    reminderMock(48, [
      {
        id: 'inv-reminder-1',
        buyer_id: 'buyer-1',
        invoice_number: 'INV-R1',
        face_value: '10000000',
        created_at: new Date().toISOString(),
        contact_email_encrypted: 'encrypted:buyer@test.com',
      },
    ]);

    await service.processReminders();

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send-confirmation-reminder',
      expect.objectContaining({
        invoiceId: 'inv-reminder-1',
        buyerId: 'buyer-1',
        reminderType: 'CONFIRMATION_REMINDER_T2',
      }),
      { attempts: 3, backoff: { type: 'exponential', delay: 30000 } },
    );
  });

  it('sends T+5 day second reminder', async () => {
    reminderMock(120, [
      {
        id: 'inv-reminder-2',
        buyer_id: 'buyer-2',
        invoice_number: 'INV-R2',
        face_value: '20000000',
        created_at: new Date().toISOString(),
        contact_email_encrypted: 'encrypted:buyer2@test.com',
      },
    ]);

    await service.processReminders();

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send-confirmation-reminder',
      expect.objectContaining({
        invoiceId: 'inv-reminder-2',
        buyerId: 'buyer-2',
        reminderType: 'CONFIRMATION_REMINDER_T5',
      }),
      { attempts: 3, backoff: { type: 'exponential', delay: 30000 } },
    );
  });

  it('creates CONFIRMATION_OVERDUE at T+7 days and notifies credit officer', async () => {
    reminderMock(168, [
      {
        id: 'inv-overdue-1',
        buyer_id: 'buyer-3',
        invoice_number: 'INV-OD1',
        face_value: '30000000',
        created_at: new Date().toISOString(),
        contact_email_encrypted: 'encrypted:buyer3@test.com',
      },
    ]);

    await service.processReminders();

    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      null,
      'CONFIRMATION_OVERDUE',
      'invoices',
      'inv-overdue-1',
      null,
      { invoiceNumber: 'INV-OD1' },
      'system',
      'system',
    );

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'notify-credit-officer-overdue',
      expect.objectContaining({
        invoiceId: 'inv-overdue-1',
        invoiceNumber: 'INV-OD1',
      }),
      { attempts: 3, backoff: { type: 'exponential', delay: 30000 } },
    );
  });

  it('does not send duplicate T+2 reminder', async () => {
    reminderMock(48, [
      {
        id: 'inv-dup-1',
        buyer_id: 'buyer-4',
        invoice_number: 'INV-DUP1',
        face_value: '5000000',
        created_at: new Date().toISOString(),
        contact_email_encrypted: 'encrypted:buyer4@test.com',
      },
    ]);

    (mockedRepo.hasReminderBeenSent as jest.Mock).mockImplementation(
      (_id: string, action: string) => Promise.resolve(action === 'CONFIRMATION_REMINDER_T2'),
    );

    await service.processReminders();

    const reminderCalls = mockQueueAdd.mock.calls.filter(
      (c: unknown[]) => c[0] === 'send-confirmation-reminder',
    );
    expect(reminderCalls).toHaveLength(0);
  });

  it('does not send duplicate overdue alert', async () => {
    reminderMock(168, [
      {
        id: 'inv-dup-od',
        buyer_id: 'buyer-5',
        invoice_number: 'INV-DUP-OD',
        face_value: '5000000',
        created_at: new Date().toISOString(),
        contact_email_encrypted: 'encrypted:buyer5@test.com',
      },
    ]);

    (mockedRepo.hasReminderBeenSent as jest.Mock).mockImplementation(
      (_id: string, action: string) => Promise.resolve(action === 'CONFIRMATION_OVERDUE'),
    );

    await service.processReminders();

    const overdueCalls = mockQueueAdd.mock.calls.filter(
      (c: unknown[]) => c[0] === 'notify-credit-officer-overdue',
    );
    expect(overdueCalls).toHaveLength(0);
  });

  it('writes audit entry for each reminder sent', async () => {
    reminderMock(48, [
      {
        id: 'inv-audit-1',
        buyer_id: 'buyer-6',
        invoice_number: 'INV-AUD1',
        face_value: '8000000',
        created_at: new Date().toISOString(),
        contact_email_encrypted: 'encrypted:buyer6@test.com',
      },
    ]);

    await service.processReminders();

    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      null,
      'CONFIRMATION_REMINDER_T2',
      'invoices',
      'inv-audit-1',
      null,
      expect.objectContaining({
        reminderType: 'CONFIRMATION_REMINDER_T2',
        hoursSinceSubmission: 48,
      }),
      'system',
      'system',
    );
  });

  it('handles empty reminder windows gracefully', async () => {
    mockedRepo.findInvoicesPendingReminder.mockResolvedValue([]);

    await expect(service.processReminders()).resolves.toBeUndefined();

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

// =========================================================================
// generateConfirmationToken — transaction rollback (lines 85-86)
// =========================================================================
describe('generateConfirmationToken — transaction rollback', () => {
  it('rolls back and rethrows when storeConfirmationTokenWithClient throws', async () => {
    mockedRepo.storeConfirmationTokenWithClient.mockRejectedValue(new Error('DB write failed'));

    await expect(service.generateConfirmationToken(INVOICE_ID, BUYER_ID, IP, UA)).rejects.toThrow(
      'DB write failed',
    );

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

// =========================================================================
// raiseDispute
// =========================================================================
describe('raiseDispute', () => {
  const DISPUTE_INPUT = { reason: 'Wrong amount', dispute_type: 'pricing' as const };
  const DISPUTE_RECORD = {
    id: 'dispute-uuid-1',
    invoice_id: INVOICE_ID,
    buyer_id: BUYER_ID,
    dispute_reason: 'Wrong amount',
    dispute_type: 'pricing',
    status: 'open',
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    mockedRepo.createDisputeWithClient.mockResolvedValue(DISPUTE_RECORD);
  });

  it('creates a dispute and commits the transaction', async () => {
    const result = await service.raiseDispute(RAW_TOKEN, DISPUTE_INPUT, IP, UA);

    expect(result.id).toBe('dispute-uuid-1');
    expect(mockedRepo.createDisputeWithClient).toHaveBeenCalledWith(
      mockClient,
      INVOICE_ID,
      BUYER_ID,
      'Wrong amount',
      'pricing',
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('defaults disputeType to "general" when not provided', async () => {
    await service.raiseDispute(RAW_TOKEN, { reason: 'Other issue' }, IP, UA);

    expect(mockedRepo.createDisputeWithClient).toHaveBeenCalledWith(
      mockClient,
      INVOICE_ID,
      BUYER_ID,
      'Other issue',
      'general',
    );
  });

  it('throws NotFoundError when token is invalid', async () => {
    mockedRepo.findInvoiceByTokenHash.mockResolvedValue(null);

    await expect(service.raiseDispute(RAW_TOKEN, DISPUTE_INPUT, IP, UA)).rejects.toThrow(
      'ConfirmationToken',
    );
  });

  it('throws BusinessRuleError when invoice is not in submitted status', async () => {
    mockedRepo.findInvoiceByTokenHash.mockResolvedValue(
      makeInvoiceRow({ status: 'buyer_confirmed' }),
    );

    await expect(service.raiseDispute(RAW_TOKEN, DISPUTE_INPUT, IP, UA)).rejects.toThrow(
      'not in submitted status',
    );
  });

  it('rolls back and releases client on error', async () => {
    mockedRepo.createDisputeWithClient.mockRejectedValue(new Error('DB error'));

    await expect(service.raiseDispute(RAW_TOKEN, DISPUTE_INPUT, IP, UA)).rejects.toThrow(
      'DB error',
    );
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('queues dispute notification when queue is configured', async () => {
    await service.raiseDispute(RAW_TOKEN, DISPUTE_INPUT, IP, UA);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'invoice-dispute',
      expect.objectContaining({ invoiceId: INVOICE_ID, disputeId: 'dispute-uuid-1' }),
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('logs warning but succeeds when notification queue is not configured', async () => {
    // Temporarily remove the queue
    service.setNotificationQueue(null as unknown as import('bullmq').Queue);

    const result = await service.raiseDispute(RAW_TOKEN, DISPUTE_INPUT, IP, UA);

    expect(result.id).toBe('dispute-uuid-1');
    // Restore the queue for subsequent tests
    service.setNotificationQueue(mockQueue);
  });
});

// =========================================================================
// validateToken — line 313: confirmation_token_expires_at is empty string
// (covers the '' branch of the triple-condition check on line 308-311)
// =========================================================================
describe('validateToken edge cases', () => {
  it('throws TOKEN_EXPIRED when confirmation_token_expires_at is empty string', async () => {
    mockedRepo.findInvoiceByTokenHash.mockResolvedValue(
      makeInvoiceRow({
        confirmation_token_expires_at: '',
      }),
    );

    await expect(service.getConfirmationPageData(RAW_TOKEN)).rejects.toThrow('no expiry');
  });

  it('throws TOKEN_EXPIRED when confirmation_token_expires_at is undefined', async () => {
    mockedRepo.findInvoiceByTokenHash.mockResolvedValue(
      makeInvoiceRow({
        confirmation_token_expires_at: undefined as unknown as string,
      }),
    );

    await expect(service.getConfirmationPageData(RAW_TOKEN)).rejects.toThrow('no expiry');
  });
});
