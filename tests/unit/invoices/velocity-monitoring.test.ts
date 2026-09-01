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
// Velocity Monitoring Tests
// =========================================================================
describe('submitInvoice — velocity monitoring', () => {
  it('allows submission for new supplier with no baseline (avgMonthly = 0)', async () => {
    // 0 invoices in 6 months => avgMonthly = 0 => skip check
    mockedRepo.get6MonthVelocityAverage.mockResolvedValue({
      total_count: 0,
      total_value: '0',
    });

    const result = await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);
    expect(result.invoiceId).toBe('invoice-uuid-1');
    // getCurrentMonthCount should not be called if avg is 0
  });

  it('allows submission when current month count is below 3x average', async () => {
    // 12 invoices in 6 months => avg = 2/month
    // current month count = 4 < 2*3 = 6 => no spike
    mockedRepo.get6MonthVelocityAverage.mockResolvedValue({
      total_count: 12,
      total_value: '100000000',
    });
    mockedRepo.getCurrentMonthCount.mockResolvedValue({ count: 4 });

    const result = await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);
    expect(result.invoiceId).toBe('invoice-uuid-1');
  });

  it('throws VELOCITY_SPIKE_DETECTED when current month >= 3x average', async () => {
    // 6 invoices in 6 months => avg = 1/month (ceil(6/6)=1)
    // current month count = 3 >= 1*3 = 3 => spike detected
    mockedRepo.get6MonthVelocityAverage.mockResolvedValue({
      total_count: 6,
      total_value: '50000000',
    });
    mockedRepo.getCurrentMonthCount.mockResolvedValue({ count: 3 });

    await expect(service.submitInvoice(USER_ID, makeSubmission(), IP, UA)).rejects.toMatchObject({
      errorCode: 'VELOCITY_SPIKE_DETECTED',
    });

    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      USER_ID,
      'VELOCITY_SPIKE_DETECTED',
      'invoices',
      'supplier-uuid-1',
      null,
      expect.objectContaining({
        currentMonthCount: 3,
        avgMonthly: 1,
        multiplier: 3,
      }),
      IP,
      UA,
    );
  });

  it('allows when current month count is just below 3x threshold', async () => {
    // 12 invoices in 6 months => avg = 2/month (ceil(12/6)=2)
    // current month count = 5 < 2*3 = 6 => no spike
    mockedRepo.get6MonthVelocityAverage.mockResolvedValue({
      total_count: 12,
      total_value: '100000000',
    });
    mockedRepo.getCurrentMonthCount.mockResolvedValue({ count: 5 });

    const result = await service.submitInvoice(USER_ID, makeSubmission(), IP, UA);
    expect(result.invoiceId).toBe('invoice-uuid-1');
  });

  it('uses ceiling division for average monthly calculation', async () => {
    // 7 invoices in 6 months => avg = ceil(7/6) = 2
    // current month = 6 >= 2*3 = 6 => spike
    mockedRepo.get6MonthVelocityAverage.mockResolvedValue({
      total_count: 7,
      total_value: '70000000',
    });
    mockedRepo.getCurrentMonthCount.mockResolvedValue({ count: 6 });

    await expect(service.submitInvoice(USER_ID, makeSubmission(), IP, UA)).rejects.toMatchObject({
      errorCode: 'VELOCITY_SPIKE_DETECTED',
    });
  });
});
