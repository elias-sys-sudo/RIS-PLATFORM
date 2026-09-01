process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.MIN_INVOICE_TENOR_DAYS = '7';
process.env.MAX_INVOICE_TENOR_DAYS = '90';
process.env.AML_FLAG_THRESHOLD_UGX = '100000000';

import * as service from '../../../src/services/invoices/invoices.service';
import * as repo from '../../../src/services/invoices/invoices.repository';
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
    face_value: 20_000_000,
    due_date: futureDate(45),
    description: 'Test invoice',
    ura_efris_ref: 'EFRIS-TEST-001',
    ...overrides,
  };
}

function makeBuyerLimits(overrides: Partial<BuyerLimits> = {}): BuyerLimits {
  return {
    id: 'buyer-uuid-1',
    company_name: 'Test Buyer Ltd',
    is_active: true,
    approved_limit: '500000000',
    used_limit: '0',
    ...overrides,
  };
}

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

  // Default: no structuring or velocity issues
  mockedRepo.get30DayRollingTotal.mockResolvedValue({ total: '0', count: 0 });
  mockedRepo.get6MonthVelocityAverage.mockResolvedValue({ total_count: 0, total_value: '0' });
  mockedRepo.getCurrentMonthCount.mockResolvedValue({ count: 0 });

  service.setNotificationQueue(mockQueue);
});

// =========================================================================
// Structuring Detection Tests
// =========================================================================
describe('submitInvoice — structuring detection', () => {
  it('allows submission when combined 30-day total is below threshold', async () => {
    mockedRepo.get30DayRollingTotal.mockResolvedValue({
      total: '30000000',
      count: 2,
    });

    const result = await service.submitInvoice(
      USER_ID,
      makeSubmission({ face_value: 20_000_000 }),
      IP,
      UA,
    );

    expect(result.invoiceId).toBe('invoice-uuid-1');
  });

  it('allows submission when individual invoice exceeds threshold (not structuring)', async () => {
    // Individual invoice >= threshold is not structuring, it is normal AML flag
    mockedRepo.get30DayRollingTotal.mockResolvedValue({
      total: '0',
      count: 0,
    });

    // face_value >= 100M triggers AML flag but NOT structuring error
    const result = await service.submitInvoice(
      USER_ID,
      makeSubmission({ face_value: 150_000_000 }),
      IP,
      UA,
    );

    expect(result.invoiceId).toBe('invoice-uuid-1');
  });

  it('throws STRUCTURING_RISK_DETECTED when combined total exceeds threshold but individual does not', async () => {
    // Previous 30-day total is 85M, new invoice is 20M => combined 105M >= 100M threshold
    // But individual 20M < 100M threshold => structuring risk
    mockedRepo.get30DayRollingTotal.mockResolvedValue({
      total: '85000000',
      count: 5,
    });

    await expect(
      service.submitInvoice(USER_ID, makeSubmission({ face_value: 20_000_000 }), IP, UA),
    ).rejects.toMatchObject({
      errorCode: 'STRUCTURING_RISK_DETECTED',
    });

    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      USER_ID,
      'STRUCTURING_RISK_DETECTED',
      'invoices',
      'supplier-uuid-1',
      null,
      expect.objectContaining({
        buyerId: 'buyer-uuid-1',
        combinedTotal: '105000000',
        invoiceCount: 6,
        threshold: '100000000',
      }),
      IP,
      UA,
    );
  });

  it('does not flag when combined total is exactly at threshold but individual is also at threshold', async () => {
    // individual = 100M >= threshold, combined = 200M >= threshold
    // Not structuring because individual is NOT below threshold
    mockedRepo.get30DayRollingTotal.mockResolvedValue({
      total: '100000000',
      count: 1,
    });

    const result = await service.submitInvoice(
      USER_ID,
      makeSubmission({ face_value: 100_000_000 }),
      IP,
      UA,
    );

    expect(result.invoiceId).toBe('invoice-uuid-1');
  });
});
