process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as repo from '../../../src/services/reporting/reporting.repository';
import { query } from '../../../src/shared/database/pool';

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

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// getPortfolioSummary
// ===========================================================================
describe('getPortfolioSummary', () => {
  it('passes role parameter in WHERE clause', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            total_funded: '5000000000',
            total_collected: '3000000000',
            total_outstanding: '1500000000',
            total_overdue: '500000000',
            annualised_yield: '18.50',
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [
          { status: 'funded', count: '10' },
          { status: 'collected', count: '5' },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ buyer_id: 'b-1', buyer_name: 'Acme Ltd', total_exposure: '1000000000' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    const result = await repo.getPortfolioSummary('management', {});

    expect(result).toBeDefined();
    expect(result.total_funded).toBe('5000000000');
    expect(result.invoice_counts_by_status).toHaveLength(2);
    expect(result.top_buyers).toHaveLength(1);

    // Verify role was passed as SQL parameter
    const firstCallParams = mockedQuery.mock.calls[0][1];
    expect(firstCallParams).toContain('management');
  });

  it('returns empty arrays when no data', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            total_funded: '0',
            total_collected: '0',
            total_outstanding: '0',
            total_overdue: '0',
            annualised_yield: '0',
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

    const result = await repo.getPortfolioSummary('auditor', {});

    expect(result.invoice_counts_by_status).toHaveLength(0);
    expect(result.top_buyers).toHaveLength(0);
    expect(result.total_funded).toBe('0');
  });
});

// ===========================================================================
// getAgingAnalysis
// ===========================================================================
describe('getAgingAnalysis', () => {
  it('returns aging buckets with role parameter', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { bucket: 'Current (31+ days)', count: '12', total_amount: '3000000000' },
        { bucket: 'Watch (8-30 days)', count: '5', total_amount: '1000000000' },
        { bucket: 'Critical (1-7 days)', count: '2', total_amount: '500000000' },
        { bucket: 'Due Today', count: '1', total_amount: '200000000' },
        { bucket: 'Overdue 1-7 days', count: '3', total_amount: '600000000' },
        { bucket: 'Overdue 7+ days', count: '1', total_amount: '150000000' },
      ],
      rowCount: 6,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getAgingAnalysis('credit_officer', {});

    expect(result.buckets).toHaveLength(6);
    expect(result.buckets[0].bucket).toBe('Current (31+ days)');
    const params = mockedQuery.mock.calls[0][1];
    expect(params).toContain('credit_officer');
  });

  it('returns empty buckets when no invoices', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getAgingAnalysis('management', {});
    expect(result.buckets).toHaveLength(0);
  });
});

// ===========================================================================
// getBuyerExposure
// ===========================================================================
describe('getBuyerExposure', () => {
  it('returns buyer exposure rows with role parameter', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          buyer_id: 'b-1',
          buyer_name: 'Acme Ltd',
          used_limit: '500000000',
          approved_limit: '1000000000',
          utilisation_pct: 50,
          avg_days_to_pay: 25,
          overdue_incident_count: 2,
        },
      ],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getBuyerExposure('credit_officer', {});

    expect(result).toHaveLength(1);
    expect(result[0].buyer_id).toBe('b-1');
    expect(result[0].utilisation_pct).toBe(50);
    const params = mockedQuery.mock.calls[0][1];
    expect(params).toContain('credit_officer');
  });
});

// ===========================================================================
// getProfitReport
// ===========================================================================
describe('getProfitReport', () => {
  it('returns per-invoice and aggregated profit data', async () => {
    mockedQuery
      // 1) per-invoice query
      .mockResolvedValueOnce({
        rows: [
          {
            invoice_id: 'inv-1',
            face_value: '1000000000',
            discount_amount: '50000000',
            penalty_income: '0',
            bank_interest_cost: '10000000',
            net_ris_profit: '40000000',
            profit_margin_pct: 4.0,
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      // 2) write-offs query (G + B from earlier gap analysis)
      .mockResolvedValueOnce({
        rows: [{ total_write_offs: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      // 3) summary query
      .mockResolvedValueOnce({
        rows: [
          {
            total_face_value: '1000000000',
            total_discount: '50000000',
            total_penalty_income: '0',
            total_revenue: '50000000',
            total_bank_interest: '10000000',
            total_net_profit: '40000000',
            avg_profit_margin_pct: 4.0,
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    const result = await repo.getProfitReport('finance_manager', {});

    expect(result.invoices).toHaveLength(1);
    expect(result.summary.total_net_profit).toBe('40000000');
    const params = mockedQuery.mock.calls[0][1];
    expect(params).toContain('finance_manager');
  });
});

// ===========================================================================
// getFacilityReport
// ===========================================================================
describe('getFacilityReport', () => {
  it('returns facility rows and upcoming maturities', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            facility_id: 'fac-1',
            bank_name: 'Stanbic',
            total_limit: '5000000000',
            drawn_amount: '2000000000',
            available_amount: '3000000000',
            utilisation_pct: 40,
            interest_accrued: '50000000',
            maturity_date: '2027-06-30',
            status: 'active',
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            facility_id: 'fac-1',
            bank_name: 'Stanbic',
            maturity_date: '2027-06-30',
            days_remaining: 90,
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    const result = await repo.getFacilityReport('finance_manager', {});

    expect(result.facilities).toHaveLength(1);
    expect(result.upcoming_maturities).toHaveLength(1);
    const params = mockedQuery.mock.calls[0][1];
    expect(params).toContain('finance_manager');
  });
});

// ===========================================================================
// getAuditExport
// ===========================================================================
describe('getAuditExport', () => {
  it('returns audit entries filtered by date range', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-1',
            user_id: 'user-1',
            action: 'INVOICE_APPROVED',
            table_name: 'invoices',
            record_id: 'inv-1',
            old_values: null,
            new_values: '{"status":"approved"}',
            ip_address: '127.0.0.1',
            user_agent: 'test-agent',
            created_at: '2026-03-21T12:00:00Z',
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ total_count: '1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    const result = await repo.getAuditExport('auditor', {
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });

    expect(result.entries).toHaveLength(1);
    expect(result.total_count).toBe(1);
    const params = mockedQuery.mock.calls[0][1];
    expect(params).toContain('auditor');
  });

  it('filters by action type when provided', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ total_count: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    await repo.getAuditExport('auditor', {
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      actionType: 'PAYMENT_EXECUTED',
    });

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('action');
    const params = mockedQuery.mock.calls[0][1];
    expect(params).toContain('PAYMENT_EXECUTED');
  });

  it('filters by userId when provided', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ total_count: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    await repo.getAuditExport('auditor', {
      userId: 'user-42',
    });

    const params = mockedQuery.mock.calls[0][1];
    expect(params).toContain('user-42');
  });

  it('returns empty entries, not error, when no results', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ total_count: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    const result = await repo.getAuditExport('auditor', {});

    expect(result.entries).toHaveLength(0);
    expect(result.total_count).toBe(0);
  });
});

// ===========================================================================
// getRegulatoryReport
// ===========================================================================
describe('getRegulatoryReport', () => {
  it('returns regulatory metrics with role parameter', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          aml_flags_raised: '5',
          sars_filed: '2',
          transactions_above_threshold: '15',
          kyc_approvals: '100',
          kyc_rejections: '8',
        },
      ],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getRegulatoryReport('compliance_officer', {});

    expect(result.aml_flags_raised).toBe(5);
    expect(result.sars_filed).toBe(2);
    const params = mockedQuery.mock.calls[0][1];
    expect(params).toContain('compliance_officer');
  });
});

// ===========================================================================
// getApplicationsReceived
// ===========================================================================
describe('getApplicationsReceived', () => {
  const emptyResult = { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };

  it('returns applications received with no filters', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ total: '42' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [
          { status: 'approved', count: '20' },
          { status: 'pending', count: '22' },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ date: '2026-03-01', count: '10' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    const result = await repo.getApplicationsReceived({});

    expect(result.total).toBe(42);
    expect(result.by_status).toHaveLength(2);
    expect(result.by_day).toHaveLength(1);
    // No WHERE clause when no filters
    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('WHERE');
  });

  it('applies startDate filter', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ total: '5' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    await repo.getApplicationsReceived({ startDate: '2026-01-01' });

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('WHERE');
    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-01-01');
  });

  it('applies endDate filter', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ total: '3' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    await repo.getApplicationsReceived({ endDate: '2026-12-31' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-12-31');
  });

  it('applies status filter', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ total: '1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    await repo.getApplicationsReceived({ status: 'pending' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('pending');
  });

  it('applies all filters together', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ total: '1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    await repo.getApplicationsReceived({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'approved',
    });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(3);
  });

  it('returns zero total when no rows', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    const result = await repo.getApplicationsReceived({});
    expect(result.total).toBe(0);
  });

  it('skips empty string filters', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ total: '5' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    await repo.getApplicationsReceived({ startDate: '', endDate: '', status: '' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(0);
  });
});

// ===========================================================================
// getApplicationsPipeline
// ===========================================================================
describe('getApplicationsPipeline', () => {
  it('returns pipeline stages', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { kyc_status: 'approved', count: '15', avg_days: '2.5' },
        { kyc_status: 'pending', count: '8', avg_days: '5.0' },
      ],
      rowCount: 2,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getApplicationsPipeline();

    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].kyc_status).toBe('approved');
    expect(result.stages[0].count).toBe(15);
    expect(result.stages[0].avg_days_in_status).toBe(2.5);
  });

  it('returns empty stages when no suppliers', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getApplicationsPipeline();
    expect(result.stages).toHaveLength(0);
  });
});

// ===========================================================================
// getIncompleteApplications
// ===========================================================================
describe('getIncompleteApplications', () => {
  it('returns incomplete applications with missing doc types', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'sup-1', kyc_status: 'pending', days_in_status: '10' },
          { id: 'sup-2', kyc_status: 'documents_submitted', days_in_status: '5' },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [
          { supplier_id: 'sup-1', document_type: 'financial_statements' },
          { supplier_id: 'sup-1', document_type: 'tax_clearance' },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

    const result = await repo.getIncompleteApplications();

    expect(result).toHaveLength(2);
    // sup-1 uploaded 2 of 3 required, missing business_registration
    expect(result[0].supplier_id).toBe('sup-1');
    expect(result[0].missing_doc_types).toEqual(['business_registration']);
    // sup-2 uploaded nothing, missing all 3
    expect(result[1].supplier_id).toBe('sup-2');
    expect(result[1].missing_doc_types).toHaveLength(3);
  });

  it('returns empty array when no incomplete suppliers', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getIncompleteApplications();
    expect(result).toHaveLength(0);
    // Second query should not be called
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// getCompanyPl
// ===========================================================================
describe('getCompanyPl', () => {
  it('returns company P&L with no filters', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          total_face: '10000000000',
          total_discount: '500000000',
          total_interest: '100000000',
          gross_profit: '400000000',
        },
      ],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getCompanyPl({});

    expect(result.total_face_value_discounted).toBe('10000000000');
    expect(result.total_discount_earned).toBe('500000000');
    expect(result.total_bank_interest_cost).toBe('100000000');
    expect(result.gross_profit).toBe('400000000');
  });

  it('applies startDate filter', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ total_face: '0', total_discount: '0', total_interest: '0', gross_profit: '0' }],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    await repo.getCompanyPl({ startDate: '2026-01-01' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-01-01');
  });

  it('applies endDate filter', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ total_face: '0', total_discount: '0', total_interest: '0', gross_profit: '0' }],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    await repo.getCompanyPl({ endDate: '2026-12-31' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-12-31');
  });

  it('applies both date filters', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ total_face: '0', total_discount: '0', total_interest: '0', gross_profit: '0' }],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    await repo.getCompanyPl({ startDate: '2026-01-01', endDate: '2026-12-31' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(2);
  });

  it('skips empty string date filters', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ total_face: '0', total_discount: '0', total_interest: '0', gross_profit: '0' }],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    await repo.getCompanyPl({ startDate: '', endDate: '' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(0);
  });
});

// ===========================================================================
// getDisbursedFunds
// ===========================================================================
describe('getDisbursedFunds', () => {
  it('returns disbursed funds with no extra filters', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            invoice_id: 'inv-1',
            supplier_id: 'sup-1',
            buyer_id: 'buy-1',
            disbursed_amount: '5000000',
            disbursed_at: '2026-03-01',
            status: 'completed',
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ total: '5000000', cnt: '1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    const result = await repo.getDisbursedFunds({});

    expect(result.payments).toHaveLength(1);
    expect(result.total_disbursed).toBe('5000000');
    expect(result.count).toBe(1);
  });

  it('applies startDate filter', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce({
        rows: [{ total: '0', cnt: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    await repo.getDisbursedFunds({ startDate: '2026-01-01' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-01-01');
  });

  it('applies endDate filter', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce({
        rows: [{ total: '0', cnt: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    await repo.getDisbursedFunds({ endDate: '2026-12-31' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-12-31');
  });

  it('applies buyerId filter', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce({
        rows: [{ total: '0', cnt: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    await repo.getDisbursedFunds({ buyerId: 'buy-99' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('buy-99');
  });

  it('applies all filters together', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce({
        rows: [{ total: '0', cnt: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    await repo.getDisbursedFunds({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      buyerId: 'buy-1',
    });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    // base param ('completed') + 3 filters
    expect(params).toHaveLength(4);
  });

  it('returns defaults when no total rows', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

    const result = await repo.getDisbursedFunds({});

    expect(result.total_disbursed).toBe('0');
    expect(result.count).toBe(0);
  });

  it('skips empty string filters', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce({
        rows: [{ total: '0', cnt: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    await repo.getDisbursedFunds({ startDate: '', endDate: '', buyerId: '' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    // Only the base param ('completed')
    expect(params).toHaveLength(1);
  });
});

// ===========================================================================
// getCtrReport
// ===========================================================================
describe('getCtrReport', () => {
  it('returns CTR transactions with no filters', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ invoice_id: 'inv-1', amount: '100000000', status: 'filed', filed_at: '2026-03-15' }],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getCtrReport({});

    expect(result.transactions).toHaveLength(1);
    expect(result.total_count).toBe(1);
    expect(result.period).toBe('all-time to present');
  });

  it('applies startDate filter', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    });

    await repo.getCtrReport({ startDate: '2026-01-01' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-01-01');
    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('WHERE');
  });

  it('applies endDate filter', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    });

    await repo.getCtrReport({ endDate: '2026-12-31' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-12-31');
  });

  it('builds correct period label with both dates', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getCtrReport({
      startDate: '2026-01-01',
      endDate: '2026-03-31',
    });

    expect(result.period).toBe('2026-01-01 to 2026-03-31');
  });

  it('builds period label with only startDate', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getCtrReport({ startDate: '2026-01-01' });
    expect(result.period).toBe('2026-01-01 to present');
  });

  it('builds period label with only endDate', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await repo.getCtrReport({ endDate: '2026-03-31' });
    expect(result.period).toBe('all-time to 2026-03-31');
  });

  it('skips empty string filters', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    });

    await repo.getCtrReport({ startDate: '', endDate: '' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(0);
    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('WHERE');
  });
});

// ===========================================================================
// getSarStatusReport
// ===========================================================================
describe('getSarStatusReport', () => {
  it('returns SAR status report with no filters', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'sar-1',
            entity_type: 'supplier',
            reason: 'Suspicious pattern',
            status: 'filed',
            fia_reference: 'FIA-001',
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ total_draft: '2', total_filed: '3', total_pending: '1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    const result = await repo.getSarStatusReport({});

    expect(result.reports).toHaveLength(1);
    expect(result.total_draft).toBe(2);
    expect(result.total_filed).toBe(3);
    expect(result.total_pending).toBe(1);
  });

  it('applies startDate filter', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce({
        rows: [{ total_draft: '0', total_filed: '0', total_pending: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    await repo.getSarStatusReport({ startDate: '2026-01-01' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-01-01');
  });

  it('applies endDate filter', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce({
        rows: [{ total_draft: '0', total_filed: '0', total_pending: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    await repo.getSarStatusReport({ endDate: '2026-12-31' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-12-31');
  });

  it('returns zero counts when counts row is empty', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

    const result = await repo.getSarStatusReport({});

    expect(result.total_draft).toBe(0);
    expect(result.total_filed).toBe(0);
    expect(result.total_pending).toBe(0);
  });

  it('skips empty string filters', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
      .mockResolvedValueOnce({
        rows: [{ total_draft: '0', total_filed: '0', total_pending: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

    await repo.getSarStatusReport({ startDate: '', endDate: '' });

    const params = mockedQuery.mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(0);
    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('WHERE');
  });
});
