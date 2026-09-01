process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/dashboard/dashboard.service';
import * as repo from '../../../src/services/dashboard/dashboard.repository';
import type { DashboardSummary } from '../../../src/services/dashboard/dashboard.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/services/dashboard/dashboard.repository');

const mockedRepo = repo as jest.Mocked<typeof repo>;

const TEST_IP = '127.0.0.1';
const TEST_UA = 'jest-test-agent';

function buildSummary(
  overrides: Partial<DashboardSummary> & { totalInvoices?: number } = {},
): DashboardSummary {
  const { totalInvoices, ...rest } = overrides;
  const baseStats = {
    total_invoices: totalInvoices ?? 10,
    total_face_value: 100_000_000,
    total_funded: 80_000_000,
    collection_rate: 40,
    overdue_count: 2,
    overdue_amount: 20_000_000,
    avg_tenor_days: 30,
    active_facilities: 1,
  };
  return {
    period: '30d',
    cached_at: new Date().toISOString(),
    stats: { ...baseStats, ...(rest.stats ?? {}) },
    trends: {
      total_face_value_change: 0,
      total_funded_change: 0,
      collection_rate_change: 0,
      overdue_amount_change: 0,
      ...(rest.trends ?? {}),
    },
    invoice_status_breakdown: rest.invoice_status_breakdown ?? [],
    payment_method_breakdown: rest.payment_method_breakdown ?? [],
    trend_data: rest.trend_data ?? [],
    escalation_overview: rest.escalation_overview ?? { none: 0, reminder: 0, formal: 0, legal: 0 },
    recent_activity: rest.recent_activity ?? [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('dashboard.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getDashboardSummary
  // =========================================================================
  describe('getDashboardSummary', () => {
    it('returns summary from repository', async () => {
      const summary = buildSummary();
      mockedRepo.getDashboardSummary.mockResolvedValue(summary);
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.getDashboardSummary('user-1', null, 'all', TEST_IP, TEST_UA);

      expect(result.stats.total_invoices).toBe(10);
      expect(result.stats.total_face_value).toBe(100_000_000);
      expect(mockedRepo.getDashboardSummary).toHaveBeenCalledWith(null, 'all');
    });

    it('supports period filter', async () => {
      const summary = buildSummary({ totalInvoices: 3 });
      mockedRepo.getDashboardSummary.mockResolvedValue(summary);
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.getDashboardSummary('user-1', 'sup-1', '7d', TEST_IP, TEST_UA);

      expect(result.stats.total_invoices).toBe(3);
      expect(mockedRepo.getDashboardSummary).toHaveBeenCalledWith('sup-1', '7d');
    });

    it('writes audit log entry', async () => {
      mockedRepo.getDashboardSummary.mockResolvedValue(buildSummary());
      mockedRepo.createAuditEntry.mockResolvedValue();

      // Use unique supplier/period to avoid cache hit from prior test
      await service.getDashboardSummary('user-1', 'unique-sup', '90d', TEST_IP, TEST_UA);

      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'DASHBOARD_SUMMARY_VIEWED',
        'dashboard',
        expect.any(String),
        {},
        { period: '90d' },
        TEST_IP,
        TEST_UA,
      );
    });

    it('supports 30d period filter', async () => {
      const summary = buildSummary({ totalInvoices: 5 });
      mockedRepo.getDashboardSummary.mockResolvedValue(summary);
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.getDashboardSummary(
        'user-1',
        'sup-30d',
        '30d',
        TEST_IP,
        TEST_UA,
      );

      expect(result.stats.total_invoices).toBe(5);
      expect(mockedRepo.getDashboardSummary).toHaveBeenCalledWith('sup-30d', '30d');
    });

    it('supports 12m period filter', async () => {
      const summary = buildSummary({ totalInvoices: 50 });
      mockedRepo.getDashboardSummary.mockResolvedValue(summary);
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.getDashboardSummary(
        'user-1',
        'sup-12m',
        '12m',
        TEST_IP,
        TEST_UA,
      );

      expect(result.stats.total_invoices).toBe(50);
      expect(mockedRepo.getDashboardSummary).toHaveBeenCalledWith('sup-12m', '12m');
    });

    it('returns zeros (not errors) when no data exists', async () => {
      const empty = buildSummary({
        totalInvoices: 0,
        stats: {
          total_invoices: 0,
          total_face_value: 0,
          total_funded: 0,
          collection_rate: 0,
          overdue_count: 0,
          overdue_amount: 0,
          avg_tenor_days: 0,
          active_facilities: 0,
        },
      });
      mockedRepo.getDashboardSummary.mockResolvedValue(empty);
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.getDashboardSummary(
        'user-1',
        'sup-empty',
        'all',
        TEST_IP,
        TEST_UA,
      );

      expect(result.stats.total_invoices).toBe(0);
      expect(result.stats.total_face_value).toBe(0);
      expect(result.stats.overdue_amount).toBe(0);
      expect(result.stats.overdue_count).toBe(0);
    });

    it('returns cached data on second call (repo called only once)', async () => {
      const summary = buildSummary({ totalInvoices: 42 });
      mockedRepo.getDashboardSummary.mockResolvedValue(summary);
      mockedRepo.createAuditEntry.mockResolvedValue();

      const supplierId = 'sup-cache-test';
      const period = '7d' as const;

      await service.getDashboardSummary('user-1', supplierId, period, TEST_IP, TEST_UA);
      const secondResult = await service.getDashboardSummary(
        'user-2',
        supplierId,
        period,
        TEST_IP,
        TEST_UA,
      );

      expect(secondResult.stats.total_invoices).toBe(42);
      expect(mockedRepo.getDashboardSummary).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // getPaymentHistory
  // =========================================================================
  describe('getPaymentHistory', () => {
    it('returns paginated payment history', async () => {
      mockedRepo.getPaymentHistory.mockResolvedValue({
        data: [],
        total: 0,
      });
      mockedRepo.getPaymentSummary.mockResolvedValue({
        total_paid: '0',
        payment_count: 0,
        last_payment_date: null,
        by_method: [],
      });
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.getPaymentHistory(
        'user-1',
        'finance_manager',
        { supplierId: 'sup-1' },
        TEST_IP,
        TEST_UA,
      );

      expect(result.pagination.page).toBe(1);
      expect(result.data).toEqual([]);
    });

    it('throws ForbiddenError for unauthorised roles', async () => {
      const { ForbiddenError } = await import('../../../src/shared/errors');

      await expect(
        service.getPaymentHistory(
          'user-1',
          'unknown_role',
          { supplierId: 'sup-1' },
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows supplier role access', async () => {
      mockedRepo.getPaymentHistory.mockResolvedValue({ data: [], total: 0 });
      mockedRepo.getPaymentSummary.mockResolvedValue({
        total_paid: '0',
        payment_count: 0,
        last_payment_date: null,
        by_method: [],
      });
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.getPaymentHistory(
        'user-1',
        'supplier',
        { supplierId: 'sup-1' },
        TEST_IP,
        TEST_UA,
      );

      expect(result.data).toEqual([]);
    });

    it('caps limit at 100', async () => {
      mockedRepo.getPaymentHistory.mockResolvedValue({ data: [], total: 0 });
      mockedRepo.getPaymentSummary.mockResolvedValue({
        total_paid: '0',
        payment_count: 0,
        last_payment_date: null,
        by_method: [],
      });
      mockedRepo.createAuditEntry.mockResolvedValue();

      await service.getPaymentHistory(
        'user-1',
        'finance_manager',
        { supplierId: 'sup-1', limit: 500 },
        TEST_IP,
        TEST_UA,
      );

      expect(mockedRepo.getPaymentHistory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      );
    });

    it.each(['management', 'credit_officer', 'auditor', 'legal', 'compliance_officer'])(
      'allows %s role access',
      async (role) => {
        mockedRepo.getPaymentHistory.mockResolvedValue({ data: [], total: 0 });
        mockedRepo.getPaymentSummary.mockResolvedValue({
          total_paid: '0',
          payment_count: 0,
          last_payment_date: null,
          by_method: [],
        });
        mockedRepo.createAuditEntry.mockResolvedValue();

        const result = await service.getPaymentHistory(
          'user-1',
          role,
          { supplierId: 'sup-1' },
          TEST_IP,
          TEST_UA,
        );

        expect(result.data).toEqual([]);
      },
    );

    it('uses custom page and limit for pagination', async () => {
      mockedRepo.getPaymentHistory.mockResolvedValue({ data: [], total: 50 });
      mockedRepo.getPaymentSummary.mockResolvedValue({
        total_paid: '0',
        payment_count: 0,
        last_payment_date: null,
        by_method: [],
      });
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.getPaymentHistory(
        'user-1',
        'finance_manager',
        { supplierId: 'sup-1', page: 3, limit: 10 },
        TEST_IP,
        TEST_UA,
      );

      expect(mockedRepo.getPaymentHistory).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, limit: 10 }),
      );
      expect(result.pagination.page).toBe(3);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(50);
      expect(result.pagination.total_pages).toBe(5);
    });

    it('audit log includes correct from/to in new_values', async () => {
      mockedRepo.getPaymentHistory.mockResolvedValue({ data: [], total: 0 });
      mockedRepo.getPaymentSummary.mockResolvedValue({
        total_paid: '0',
        payment_count: 0,
        last_payment_date: null,
        by_method: [],
      });
      mockedRepo.createAuditEntry.mockResolvedValue();

      await service.getPaymentHistory(
        'user-1',
        'finance_manager',
        { supplierId: 'sup-1', from: '2025-01-01', to: '2025-06-30' },
        TEST_IP,
        TEST_UA,
      );

      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'PAYMENT_HISTORY_VIEWED',
        'payments',
        'sup-1',
        {},
        { period: '2025-01-01 to 2025-06-30' },
        TEST_IP,
        TEST_UA,
      );
    });
  });

  // =========================================================================
  // setRedisClient
  // =========================================================================
  describe('setRedisClient', () => {
    it('stores redis client without error', () => {
      const mockClient = { get: jest.fn(), setEx: jest.fn() } as never;
      expect(() => service.setRedisClient(mockClient)).not.toThrow();
    });
  });
});
