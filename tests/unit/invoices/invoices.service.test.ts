process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.MIN_INVOICE_TENOR_DAYS = '7';
process.env.MAX_INVOICE_TENOR_DAYS = '90';
process.env.AML_FLAG_THRESHOLD_UGX = '100000000';

import * as service from '../../../src/services/invoices/invoices.service';
import * as repo from '../../../src/services/invoices/invoices.repository';
import { ValidationErrorCode } from '../../../src/services/invoices/invoices.types';
import type { InvoiceSubmission, BuyerLimits } from '../../../src/services/invoices/invoices.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/invoices/invoices.repository');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('invoice-uuid-1'),
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;

// Mock PoolClient for transaction support
const mockClient = {
  query: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const IP = '127.0.0.1';
const UA = 'jest-test-agent';
const USER_ID = 'user-supplier-1';

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function makeSubmission(overrides: Partial<InvoiceSubmission> = {}): InvoiceSubmission {
  return {
    invoice_number: 'INV-001',
    buyer_id: 'buyer-uuid-1',
    face_value: 50_000_000,
    due_date: futureDate(45),
    description: 'Test invoice for goods delivered',
    ura_efris_ref: 'EFRIS-TEST-001', // G1 — required at backend
    ...overrides,
  };
}

function makeBuyerLimits(overrides: Partial<BuyerLimits> = {}): BuyerLimits {
  return {
    id: 'buyer-uuid-1',
    company_name: 'Test Buyer Ltd',
    is_active: true,
    approved_limit: '200000000', // 200M UGX
    used_limit: '0',
    ...overrides,
  };
}

// Mock queue
const mockQueueAdd = jest.fn().mockResolvedValue(undefined);
const mockQueue = { add: mockQueueAdd } as unknown as import('bullmq').Queue;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  mockClient.query.mockResolvedValue(undefined);
  mockClient.release.mockReset();
  mockedRepo.getClient.mockResolvedValue(mockClient as never);

  // Default: all validations pass
  mockedRepo.findSupplierByUserId.mockResolvedValue({
    id: 'supplier-uuid-1',
    kyc_status: 'approved',
  });
  mockedRepo.findInvoiceByNumberAndSupplier.mockResolvedValue(null);
  mockedRepo.findBuyerWithLimits.mockResolvedValue(makeBuyerLimits());
  mockedRepo.createInvoiceWithClient.mockResolvedValue(undefined);
  mockedRepo.createAuditEntry.mockResolvedValue(undefined);
  mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);
  mockedRepo.setAmlFlagWithClient.mockResolvedValue(undefined);

  // AML/CFT checks — default: no structuring or velocity issues
  mockedRepo.get30DayRollingTotal.mockResolvedValue({ total: '0', count: 0 });
  mockedRepo.get6MonthVelocityAverage.mockResolvedValue({ total_count: 0, total_value: '0' });
  mockedRepo.getCurrentMonthCount.mockResolvedValue({ count: 0 });

  service.setNotificationQueue(mockQueue);
});

// =========================================================================
// Validation Chain
// =========================================================================
describe('submitInvoice — validation chain', () => {
  // --- Step 1: Supplier active check ---
  it('1. supplier with kyc_status=pending → SUPPLIER_NOT_APPROVED', async () => {
    mockedRepo.findSupplierByUserId.mockResolvedValue({
      id: 'supplier-uuid-1',
      kyc_status: 'pending',
    });

    await expect(service.submitInvoice(USER_ID, makeSubmission(), IP, UA)).rejects.toThrow(
      'Supplier KYC status must be approved',
    );

    try {
      await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);
    } catch (err: unknown) {
      const bizErr = err as { errorCode: string };
      expect(bizErr.errorCode).toBe(ValidationErrorCode.SUPPLIER_NOT_APPROVED);
    }
  });

  it('supplier not found → SUPPLIER_NOT_APPROVED', async () => {
    mockedRepo.findSupplierByUserId.mockResolvedValue(null);

    await expect(service.submitInvoice(USER_ID, makeSubmission(), IP, UA)).rejects.toThrow(
      'Supplier KYC status must be approved',
    );
  });

  it('2. supplier with kyc_status=approved passes step 1', async () => {
    // Default mock already approved — should reach step 2+
    // Make it fail at step 2 to prove step 1 passed
    mockedRepo.findInvoiceByNumberAndSupplier.mockResolvedValue({
      id: 'existing',
    } as never);

    await expect(service.submitInvoice(USER_ID, makeSubmission(), IP, UA)).rejects.toThrow(
      'already exists',
    );
  });

  // --- Step 2: Duplicate check ---
  it('3. duplicate invoice_number + supplier_id → DUPLICATE_INVOICE', async () => {
    mockedRepo.findInvoiceByNumberAndSupplier.mockResolvedValue({
      id: 'existing-invoice',
    } as never);

    await expect(service.submitInvoice(USER_ID, makeSubmission(), IP, UA)).rejects.toThrow(
      'already exists',
    );

    try {
      await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);
    } catch (err: unknown) {
      const bizErr = err as { errorCode: string };
      expect(bizErr.errorCode).toBe(ValidationErrorCode.DUPLICATE_INVOICE);
    }
  });

  it('4. unique invoice_number passes step 2', async () => {
    // Default: findInvoiceByNumberAndSupplier returns null
    // Make it fail at step 3 to prove step 2 passed
    mockedRepo.findBuyerWithLimits.mockResolvedValue(null);

    await expect(service.submitInvoice(USER_ID, makeSubmission(), IP, UA)).rejects.toThrow(
      'does not exist or is not active',
    );
  });

  // --- Step 3: Buyer eligibility ---
  it('5. non-existent buyer_id → BUYER_NOT_APPROVED', async () => {
    mockedRepo.findBuyerWithLimits.mockResolvedValue(null);

    await expect(service.submitInvoice(USER_ID, makeSubmission(), IP, UA)).rejects.toThrow(
      'does not exist or is not active',
    );

    try {
      await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);
    } catch (err: unknown) {
      const bizErr = err as { errorCode: string };
      expect(bizErr.errorCode).toBe(ValidationErrorCode.BUYER_NOT_APPROVED);
    }
  });

  it('6. inactive buyer (is_active=false) → BUYER_NOT_APPROVED', async () => {
    mockedRepo.findBuyerWithLimits.mockResolvedValue(makeBuyerLimits({ is_active: false }));

    await expect(service.submitInvoice(USER_ID, makeSubmission(), IP, UA)).rejects.toThrow(
      'does not exist or is not active',
    );
  });

  it('7. active approved buyer passes step 3', async () => {
    // Default: buyer is active — make it fail at step 4
    const submission = makeSubmission({ due_date: futureDate(3) });

    await expect(service.submitInvoice(USER_ID, submission, IP, UA)).rejects.toThrow(
      'outside the allowed range',
    );
  });

  // --- Step 4: Tenor check ---
  it('8. due date 5 days from now → TENOR_OUT_OF_RANGE with actual_days', async () => {
    const submission = makeSubmission({ due_date: futureDate(5) });

    try {
      await service.submitInvoice(USER_ID, submission, IP, UA);
      fail('Should have thrown');
    } catch (err: unknown) {
      const bizErr = err as { errorCode: string; data: Record<string, unknown> };
      expect(bizErr.errorCode).toBe(ValidationErrorCode.TENOR_OUT_OF_RANGE);
      expect(bizErr.data.actual_days).toBeLessThanOrEqual(6);
      expect(bizErr.data.min_days).toBe(7);
      expect(bizErr.data.max_days).toBe(90);
    }
  });

  it('9. due date 95 days from now → TENOR_OUT_OF_RANGE', async () => {
    const submission = makeSubmission({ due_date: futureDate(95) });

    try {
      await service.submitInvoice(USER_ID, submission, IP, UA);
      fail('Should have thrown');
    } catch (err: unknown) {
      const bizErr = err as { errorCode: string; data: Record<string, unknown> };
      expect(bizErr.errorCode).toBe(ValidationErrorCode.TENOR_OUT_OF_RANGE);
      expect(bizErr.data.actual_days).toBeGreaterThanOrEqual(95);
    }
  });

  it('10. due date 45 days from now passes step 4', async () => {
    // Default: 45 days — make it fail at step 5
    mockedRepo.findBuyerWithLimits.mockResolvedValue(
      makeBuyerLimits({
        approved_limit: '1000000', // 1M UGX
        used_limit: '0',
      }),
    );
    // face_value = 50M UGX, limit = 1M UGX → exceeds
    await expect(service.submitInvoice(USER_ID, makeSubmission(), IP, UA)).rejects.toThrow(
      'exceeds available buyer credit limit',
    );
  });

  // --- Step 5: Credit limit check ---
  it('11. face_value exceeds buyer credit limit → CREDIT_LIMIT_EXCEEDED', async () => {
    mockedRepo.findBuyerWithLimits.mockResolvedValue(
      makeBuyerLimits({
        approved_limit: '10000000', // 10M UGX
        used_limit: '5000000', // 5M UGX used
      }),
    );

    // face_value=50M UGX, used=5M, limit=10M → total 55M > 10M → exceeded
    try {
      await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);
      fail('Should have thrown');
    } catch (err: unknown) {
      const bizErr = err as { errorCode: string; data: Record<string, unknown> };
      expect(bizErr.errorCode).toBe(ValidationErrorCode.CREDIT_LIMIT_EXCEEDED);
      expect(bizErr.data.limit).toBe('10000000');
      expect(bizErr.data.used).toBe('5000000');
      expect(bizErr.data.remaining).toBe('5000000');
    }
  });

  it('12. face_value within buyer credit limit passes step 5', async () => {
    // Default: limit=200M=20B cents, used=0, face=50M=5B cents → passes
    const result = await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);

    expect(result.invoiceId).toBe('invoice-uuid-1');
    expect(mockedRepo.createInvoiceWithClient).toHaveBeenCalled();
  });
});

// =========================================================================
// Full flow
// =========================================================================
describe('submitInvoice — full flow', () => {
  it('13. all 5 validations pass → invoice created with status=submitted', async () => {
    const result = await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);

    expect(result.invoiceId).toBe('invoice-uuid-1');
    expect(mockedRepo.createInvoiceWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        id: 'invoice-uuid-1',
        invoiceNumber: 'INV-001',
        supplierId: 'supplier-uuid-1',
        buyerId: 'buyer-uuid-1',
        dueDate: expect.any(String) as unknown as string,
        description: 'Test invoice for goods delivered',
      }),
    );
  });

  it('14. Bull job queued for buyer confirmation email', async () => {
    await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send-buyer-confirmation',
      expect.objectContaining({
        invoiceId: 'invoice-uuid-1',
        buyerId: 'buyer-uuid-1',
      }),
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  });

  it('15. face_value above 100M UGX → AML_FLAG audit record, invoice still proceeds', async () => {
    const submission = makeSubmission({ face_value: 150_000_000 }); // 150M UGX

    const result = await service.submitInvoice(USER_ID, submission, IP, UA);

    // Invoice still created
    expect(result.invoiceId).toBe('invoice-uuid-1');

    // AML flag set
    expect(mockedRepo.setAmlFlagWithClient).toHaveBeenCalledWith(
      mockClient,
      'invoice-uuid-1',
      true,
    );

    // AML audit entry
    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      USER_ID,
      'AML_FLAG',
      'invoices',
      'invoice-uuid-1',
      null,
      expect.objectContaining({
        reason: 'Invoice face value exceeds AML threshold',
      }),
      IP,
      UA,
    );

    // Compliance notification queued
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'notify-compliance-aml',
      expect.objectContaining({ invoiceId: 'invoice-uuid-1' }),
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  });

  it('16. face_value below 100M UGX → no AML flag', async () => {
    const submission = makeSubmission({ face_value: 50_000_000 }); // 50M UGX

    await service.submitInvoice(USER_ID, submission, IP, UA);

    expect(mockedRepo.setAmlFlagWithClient).not.toHaveBeenCalled();
  });

  it('no queue configured → logs warning, does not throw', async () => {
    service.setNotificationQueue(null as unknown as import('bullmq').Queue);

    // Should not throw
    const result = await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);
    expect(result.invoiceId).toBe('invoice-uuid-1');

    // Re-set queue for subsequent tests
    service.setNotificationQueue(mockQueue);
  });
});

// =========================================================================
// Access control
// =========================================================================
/**
 * Helper: build a minimal enriched detail row for the new service.
 * The detail orchestrator pulls 4 collateral repos in parallel; default them empty.
 */
function mockEnrichedDetail(overrides: Record<string, unknown> = {}): void {
  mockedRepo.getEnrichedInvoiceDetail.mockResolvedValue({
    id: 'invoice-1',
    invoice_number: 'INV-001',
    supplier_id: 'supplier-uuid-1',
    supplier_name: 'Acme Ltd',
    buyer_id: 'buyer-1',
    buyer_name: 'Buyer Co',
    face_value: '5000000000',
    advance_amount: null,
    discount_amount: null,
    net_payment_to_supplier: null,
    advance_percentage: null,
    discount_rate: null,
    tenor_days: 30,
    status: 'submitted',
    risk_score: null,
    risk_recommendation: null,
    due_date: '2026-05-01',
    funded_at: null,
    collected_at: null,
    created_at: '2026-03-20',
    updated_at: '2026-03-20',
    bank_details_captured_at: null,
    description: 'Test',
    sla_deadline: '2026-03-23',
    buyer_confirmed_at: null,
    aml_flagged: false,
    buyer_credit_score: null,
    tenor_score: null,
    track_record_score: null,
    concentration_score: null,
    collateral_score: null,
    registration_number: null,
    buyer_credit_limit: null,
    buyer_email_enc: null,
    buyer_phone_enc: null,
    supplier_email: null,
    dual_auth_user_1_id: null,
    dual_auth_user_1_name: null,
    dual_auth_user_1_at: null,
    dual_auth_user_2_id: null,
    dual_auth_user_2_name: null,
    dual_auth_user_2_at: null,
    approved_at: null,
    pricing_accepted_at: null,
    ...overrides,
  } as never);
  mockedRepo.getInvoiceApprovalHistory.mockResolvedValue([]);
  mockedRepo.getInvoiceDocumentRefs.mockResolvedValue([]);
  mockedRepo.getInvoiceCollateralRefs.mockResolvedValue([]);
  mockedRepo.getInvoiceTimeline.mockResolvedValue([]);
}

describe('getInvoiceDetail — ownership', () => {
  it('17. supplier A cannot see supplier B invoice → ForbiddenError', async () => {
    mockEnrichedDetail({ supplier_id: 'supplier-B' });
    mockedRepo.findSupplierByUserId.mockResolvedValue({
      id: 'supplier-A',
      kyc_status: 'approved',
    });

    await expect(service.getInvoiceDetail('invoice-1', 'user-A', 'supplier')).rejects.toThrow(
      'You do not have permission',
    );
  });

  it('supplier can see their own invoice', async () => {
    mockEnrichedDetail({ supplier_id: 'supplier-uuid-1' });
    mockedRepo.findSupplierByUserId.mockResolvedValue({
      id: 'supplier-uuid-1',
      kyc_status: 'approved',
    });

    const detail = await service.getInvoiceDetail('invoice-1', USER_ID, 'supplier');

    expect(detail.id).toBe('invoice-1');
    expect(detail.supplier_info.id).toBe('supplier-uuid-1');
    expect(detail.buyer_info.id).toBe('buyer-1');
  });

  it('invoice not found → NotFoundError', async () => {
    mockedRepo.getEnrichedInvoiceDetail.mockResolvedValue(null);

    await expect(service.getInvoiceDetail('missing', USER_ID, 'supplier')).rejects.toThrow(
      'Invoice',
    );
  });
});

describe('listInvoices', () => {
  it('18. credit officer sees all invoices', async () => {
    mockedRepo.findEnrichedAllInvoices.mockResolvedValue({
      rows: [
        { id: 'inv-1', face_value: '100', created_at: '2026-03-20' } as never,
        { id: 'inv-2', face_value: '200', created_at: '2026-03-20' } as never,
      ],
      total: 2,
    });

    const result = await service.listInvoices(
      'officer-1',
      'credit_officer',
      {},
      { page: 1, limit: 20 },
    );

    expect(result.data).toHaveLength(2);
    expect(mockedRepo.findEnrichedAllInvoices).toHaveBeenCalled();
    expect(mockedRepo.findEnrichedInvoicesBySupplier).not.toHaveBeenCalled();
  });

  it('supplier sees only own invoices', async () => {
    mockedRepo.findSupplierByUserId.mockResolvedValue({
      id: 'supplier-uuid-1',
      kyc_status: 'approved',
    });
    mockedRepo.findEnrichedInvoicesBySupplier.mockResolvedValue({
      rows: [{ id: 'inv-1', face_value: '100', created_at: '2026-03-20' } as never],
      total: 1,
    });

    const result = await service.listInvoices(USER_ID, 'supplier', {}, { page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(mockedRepo.findEnrichedInvoicesBySupplier).toHaveBeenCalledWith('supplier-uuid-1', {
      page: 1,
      limit: 20,
    });
  });

  it('supplier not found → NotFoundError', async () => {
    mockedRepo.findSupplierByUserId.mockResolvedValue(null);

    await expect(
      service.listInvoices(USER_ID, 'supplier', {}, { page: 1, limit: 20 }),
    ).rejects.toThrow('Supplier');
  });
});

describe('getInvoiceTimeline', () => {
  it('19. returns all audit entries for the invoice', async () => {
    mockedRepo.findInvoiceById.mockResolvedValue({
      id: 'invoice-1',
    } as never);
    const timelineEntries = [
      { id: 'a1', action: 'INVOICE_SUBMITTED', created_at: '2026-03-20' },
      { id: 'a2', action: 'VALIDATION_SUPPLIER_ACTIVE_CHECK', created_at: '2026-03-20' },
    ];
    mockedRepo.getInvoiceTimeline.mockResolvedValue(timelineEntries as never);

    const result = await service.getInvoiceTimeline('invoice-1', 'credit_officer');

    expect(result).toEqual(timelineEntries);
    expect(mockedRepo.getInvoiceTimeline).toHaveBeenCalledWith('invoice-1');
  });

  it('supplier cannot view timeline → ForbiddenError', async () => {
    await expect(service.getInvoiceTimeline('invoice-1', 'supplier')).rejects.toThrow(
      'Only staff can view',
    );
  });

  it('invoice not found → NotFoundError', async () => {
    mockedRepo.findInvoiceById.mockResolvedValue(null);

    await expect(service.getInvoiceTimeline('missing', 'credit_officer')).rejects.toThrow(
      'Invoice',
    );
  });
});

// =========================================================================
// Audit
// =========================================================================
describe('audit logging', () => {
  it('20. each of the 5 validation steps logged individually', async () => {
    await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);

    // On successful path, audit entries are written via createAuditEntryWithClient
    // call signature: (client, userId, action, table, resourceId, oldValues, newValues, ip, ua)
    const auditCalls = mockedRepo.createAuditEntryWithClient.mock.calls;
    const validationActions = auditCalls
      .map((call) => call[2] as string)
      .filter((action) => action.startsWith('VALIDATION_'));

    expect(validationActions).toEqual([
      'VALIDATION_SUPPLIER_ACTIVE_CHECK',
      'VALIDATION_DUPLICATE_CHECK',
      'VALIDATION_BUYER_ELIGIBILITY',
      'VALIDATION_TENOR_CHECK',
      'VALIDATION_CREDIT_LIMIT_CHECK',
    ]);

    // Each validation result has passed=true
    for (const call of auditCalls) {
      const action = call[2] as string;
      if (action.startsWith('VALIDATION_')) {
        const newValues = call[6] as Record<string, unknown>;
        expect(newValues.passed).toBe(true);
      }
    }
  });

  it('failed validation steps also logged before throwing', async () => {
    mockedRepo.findSupplierByUserId.mockResolvedValue({
      id: 'supplier-uuid-1',
      kyc_status: 'pending',
    });

    try {
      await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);
    } catch {
      // expected
    }

    const auditCalls = mockedRepo.createAuditEntry.mock.calls;
    const validationActions = auditCalls
      .map((call) => call[1] as string)
      .filter((action) => action.startsWith('VALIDATION_'));

    // Only step 1 logged (failed at step 1)
    expect(validationActions).toEqual(['VALIDATION_SUPPLIER_ACTIVE_CHECK']);

    const newValues = auditCalls[0][5] as Record<string, unknown>;
    expect(newValues.passed).toBe(false);
    expect(newValues.errorCode).toBe(ValidationErrorCode.SUPPLIER_NOT_APPROVED);
  });

  it('21. INVOICE_SUBMITTED action logged on success', async () => {
    await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);

    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      USER_ID,
      'INVOICE_SUBMITTED',
      'invoices',
      'invoice-uuid-1',
      null,
      expect.objectContaining({
        invoiceNumber: 'INV-001',
        supplierId: 'supplier-uuid-1',
        buyerId: 'buyer-uuid-1',
        status: 'submitted',
      }),
      IP,
      UA,
    );
  });
});

// =========================================================================
// Monetary conversion
// =========================================================================
describe('monetary values', () => {
  it('22. face_value stored as BIGINT raw UGX: 50,000,000 UGX stored as 50000000', async () => {
    const submission = makeSubmission({ face_value: 50_000_000 });

    await service.submitInvoice(USER_ID, submission, IP, UA);

    expect(mockedRepo.createInvoiceWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        faceValue: '50000000',
      }),
    );
  });

  it('small amount: 100 UGX stored as 100', async () => {
    const submission = makeSubmission({ face_value: 100 });

    await service.submitInvoice(USER_ID, submission, IP, UA);

    expect(mockedRepo.createInvoiceWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        faceValue: '100',
      }),
    );
  });

  it('API returns face_value as raw UGX integer', async () => {
    mockEnrichedDetail({ id: 'inv-1', face_value: '50000000' });

    const detail = await service.getInvoiceDetail('inv-1', 'officer-1', 'credit_officer');

    expect(detail.face_value).toBe(50_000_000);
  });
});
