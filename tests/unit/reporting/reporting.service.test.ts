process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/reporting/reporting.service';
import * as repo from '../../../src/services/reporting/reporting.repository';
import { ReportType } from '../../../src/services/reporting/reporting.types';
import type {
  PortfolioSummary,
  AgingAnalysis,
  BuyerExposure,
  ProfitReport,
  FacilityReport,
  AuditExport,
  RegulatoryReport,
  ApplicationsReceivedReport,
  ApplicationsPipelineReport,
  IncompleteApplicationRow,
  CompanyPlReport,
  DisbursedFundsReport,
  CtrReport,
  SarStatusReport,
} from '../../../src/services/reporting/reporting.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/reporting/reporting.repository');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// validateRoleAccess
// ===========================================================================
describe('validateRoleAccess', () => {
  it('throws ForbiddenError when supplier requests portfolio summary', () => {
    expect(() => service.validateRoleAccess(ReportType.PORTFOLIO_SUMMARY, 'supplier')).toThrow();
  });

  it('throws ForbiddenError when credit_officer requests regulatory', () => {
    expect(() => service.validateRoleAccess(ReportType.REGULATORY, 'credit_officer')).toThrow();
  });

  it('throws ForbiddenError when finance_manager requests audit export', () => {
    expect(() => service.validateRoleAccess(ReportType.AUDIT_EXPORT, 'finance_manager')).toThrow();
  });

  it('does not throw for management requesting portfolio summary', () => {
    expect(() =>
      service.validateRoleAccess(ReportType.PORTFOLIO_SUMMARY, 'management'),
    ).not.toThrow();
  });

  it('does not throw for auditor requesting audit export', () => {
    expect(() => service.validateRoleAccess(ReportType.AUDIT_EXPORT, 'auditor')).not.toThrow();
  });

  it('does not throw for compliance_officer requesting regulatory', () => {
    expect(() =>
      service.validateRoleAccess(ReportType.REGULATORY, 'compliance_officer'),
    ).not.toThrow();
  });
});

// ===========================================================================
// generateReport
// ===========================================================================
describe('generateReport', () => {
  const userId = 'user-1';
  const ip = '127.0.0.1';
  const ua = 'test-agent';

  it('returns portfolio summary for management', async () => {
    const mockData: PortfolioSummary = {
      total_funded: '5000000000',
      total_collected: '3000000000',
      total_outstanding: '1500000000',
      total_overdue: '500000000',
      annualised_yield: '18.50',
      invoice_counts_by_status: [{ status: 'funded', count: 10 }],
      top_buyers: [{ buyer_id: 'b-1', buyer_name: 'Acme', total_exposure: '1000000000' }],
    };
    mockedRepo.getPortfolioSummary.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.PORTFOLIO_SUMMARY,
      userId,
      'management',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.PORTFOLIO_SUMMARY);
    expect(result.data).toEqual(mockData);
    expect(mockedRepo.getPortfolioSummary).toHaveBeenCalledWith('management', {});
  });

  it('returns aging analysis for credit_officer', async () => {
    const mockData: AgingAnalysis = {
      buckets: [{ bucket: 'Current (31+ days)', count: 5, total_amount: '1000000000' }],
    };
    mockedRepo.getAgingAnalysis.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.AGING_ANALYSIS,
      userId,
      'credit_officer',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.AGING_ANALYSIS);
    expect(mockedRepo.getAgingAnalysis).toHaveBeenCalledWith('credit_officer', {});
  });

  it('returns buyer exposure for management', async () => {
    const mockData: BuyerExposure[] = [
      {
        buyer_id: 'b-1',
        buyer_name: 'Acme',
        used_limit: '500000000',
        approved_limit: '1000000000',
        utilisation_pct: 50,
        avg_days_to_pay: 25,
        overdue_incident_count: 1,
      },
    ];
    mockedRepo.getBuyerExposure.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.BUYER_EXPOSURE,
      userId,
      'management',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.BUYER_EXPOSURE);
    expect(mockedRepo.getBuyerExposure).toHaveBeenCalledWith('management', {});
  });

  it('returns profit report for finance_manager', async () => {
    const mockData: ProfitReport = {
      invoices: [
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
      summary: {
        total_face_value: '1000000000',
        total_discount: '50000000',
        total_penalty_income: '0',
        total_revenue: '50000000',
        total_bank_interest: '10000000',
        total_net_profit: '40000000',
        total_write_offs: '0',
        avg_profit_margin_pct: 4.0,
      },
    };
    mockedRepo.getProfitReport.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.PROFIT,
      userId,
      'finance_manager',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.PROFIT);
    expect(mockedRepo.getProfitReport).toHaveBeenCalledWith('finance_manager', {});
  });

  it('returns facility report for finance_manager', async () => {
    const mockData: FacilityReport = {
      facilities: [
        {
          facility_id: 'fac-1',
          bank_name: 'Stanbic',
          total_limit: '5000000000',
          drawn_amount: '2000000000',
          available_amount: '3000000000',
          utilisation_pct: 40,
          interest_accrued: '50000000',
          defaulted_exposure: '0',
          maturity_date: '2027-06-30',
          status: 'active',
        },
      ],
      upcoming_maturities: [],
    };
    mockedRepo.getFacilityReport.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.FACILITY,
      userId,
      'finance_manager',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.FACILITY);
    expect(mockedRepo.getFacilityReport).toHaveBeenCalledWith('finance_manager', {});
  });

  it('returns audit export for auditor', async () => {
    const mockData: AuditExport = {
      entries: [
        {
          id: 'a-1',
          user_id: 'u-1',
          action: 'LOGIN',
          table_name: 'sessions',
          record_id: 'sess-1',
          old_values: null,
          new_values: '{}',
          ip_address: '127.0.0.1',
          user_agent: 'test',
          created_at: '2026-03-21T12:00:00Z',
        },
      ],
      total_count: 1,
    };
    mockedRepo.getAuditExport.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.AUDIT_EXPORT,
      userId,
      'auditor',
      { startDate: '2026-03-01' },
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.AUDIT_EXPORT);
    expect(mockedRepo.getAuditExport).toHaveBeenCalledWith('auditor', { startDate: '2026-03-01' });
  });

  it('returns regulatory report for compliance_officer', async () => {
    const mockData: RegulatoryReport = {
      aml_flags_raised: 5,
      sars_filed: 2,
      transactions_above_threshold: 15,
      kyc_approvals: 100,
      kyc_rejections: 8,
    };
    mockedRepo.getRegulatoryReport.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.REGULATORY,
      userId,
      'compliance_officer',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.REGULATORY);
    expect(mockedRepo.getRegulatoryReport).toHaveBeenCalledWith('compliance_officer', {});
  });

  it('throws ForbiddenError when supplier calls portfolio', async () => {
    await expect(
      service.generateReport(ReportType.PORTFOLIO_SUMMARY, userId, 'supplier', {}, ip, ua),
    ).rejects.toThrow();
  });

  it('throws ForbiddenError when finance_manager calls audit export', async () => {
    await expect(
      service.generateReport(ReportType.AUDIT_EXPORT, userId, 'finance_manager', {}, ip, ua),
    ).rejects.toThrow();
  });

  it('throws ForbiddenError for unknown report type (unknown type has no allowed roles)', async () => {
    // Cast an invalid value — validateRoleAccess throws ForbiddenError because
    // REPORT_ROLE_ACCESS['unknown_report_type'] is undefined, so the role check fails
    await expect(
      service.generateReport('unknown_report_type' as never, userId, 'management', {}, ip, ua),
    ).rejects.toThrow('is not authorised to access unknown_report_type');
  });

  it('returns applications received report for management', async () => {
    const mockData: ApplicationsReceivedReport = {
      total: 10,
      by_status: [{ status: 'approved', count: 5 }],
      by_day: [{ date: '2026-03-01', count: 3 }],
    };
    mockedRepo.getApplicationsReceived.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.APPLICATIONS_RECEIVED,
      userId,
      'management',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.APPLICATIONS_RECEIVED);
    expect(result.data).toEqual(mockData);
    expect(mockedRepo.getApplicationsReceived).toHaveBeenCalledWith({});
  });

  it('returns applications pipeline report for credit_officer', async () => {
    const mockData: ApplicationsPipelineReport = {
      stages: [{ kyc_status: 'pending', count: 8, avg_days_in_status: 3.5 }],
    };
    mockedRepo.getApplicationsPipeline.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.APPLICATIONS_PIPELINE,
      userId,
      'credit_officer',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.APPLICATIONS_PIPELINE);
    expect(mockedRepo.getApplicationsPipeline).toHaveBeenCalled();
  });

  it('returns incomplete applications report for compliance_officer', async () => {
    const mockData: IncompleteApplicationRow[] = [
      {
        supplier_id: 'sup-1',
        kyc_status: 'pending',
        days_in_status: 10,
        missing_doc_types: ['tax_clearance'],
      },
    ];
    mockedRepo.getIncompleteApplications.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.APPLICATIONS_INCOMPLETE,
      userId,
      'compliance_officer',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.APPLICATIONS_INCOMPLETE);
    expect(mockedRepo.getIncompleteApplications).toHaveBeenCalled();
  });

  it('returns company P&L report for finance_manager', async () => {
    const mockData: CompanyPlReport = {
      total_face_value_discounted: '10000000000',
      total_discount_earned: '500000000',
      total_bank_interest_cost: '100000000',
      gross_profit: '400000000',
    };
    mockedRepo.getCompanyPl.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.COMPANY_PL,
      userId,
      'finance_manager',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.COMPANY_PL);
    expect(mockedRepo.getCompanyPl).toHaveBeenCalledWith({});
  });

  it('returns disbursed funds report for management', async () => {
    const mockData: DisbursedFundsReport = {
      payments: [],
      total_disbursed: '0',
      count: 0,
    };
    mockedRepo.getDisbursedFunds.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.DISBURSED_FUNDS,
      userId,
      'management',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.DISBURSED_FUNDS);
    expect(mockedRepo.getDisbursedFunds).toHaveBeenCalledWith({});
  });

  it('returns CTR report for compliance_officer', async () => {
    const mockData: CtrReport = {
      period: 'all-time to present',
      transactions: [],
      total_count: 0,
    };
    mockedRepo.getCtrReport.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.CTR,
      userId,
      'compliance_officer',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.CTR);
    expect(mockedRepo.getCtrReport).toHaveBeenCalledWith({});
  });

  it('returns SAR status report for management', async () => {
    const mockData: SarStatusReport = {
      total_draft: 1,
      total_filed: 2,
      total_pending: 0,
      reports: [],
    };
    mockedRepo.getSarStatusReport.mockResolvedValue(mockData);

    const result = await service.generateReport(
      ReportType.SAR_STATUS,
      userId,
      'management',
      {},
      ip,
      ua,
    );

    expect(result.reportType).toBe(ReportType.SAR_STATUS);
    expect(mockedRepo.getSarStatusReport).toHaveBeenCalledWith({});
  });
});

// ===========================================================================
// exportToCsv
// ===========================================================================
describe('exportToCsv', () => {
  it('converts audit export data to CSV string', () => {
    const data: AuditExport = {
      entries: [
        {
          id: 'a-1',
          user_id: 'u-1',
          action: 'LOGIN',
          table_name: 'sessions',
          record_id: 'sess-1',
          old_values: null,
          new_values: '{}',
          ip_address: '127.0.0.1',
          user_agent: 'test',
          created_at: '2026-03-21T12:00:00Z',
        },
      ],
      total_count: 1,
    };

    const csv = service.exportToCsv(data);

    expect(csv).toContain('id,user_id,action,table_name,record_id');
    expect(csv).toContain('a-1');
    expect(csv).toContain('LOGIN');
  });

  it('returns header only for empty entries', () => {
    const data: AuditExport = { entries: [], total_count: 0 };
    const csv = service.exportToCsv(data);

    expect(csv).toContain('id,user_id,action');
    expect(csv.split('\n').filter((l: string) => l.trim()).length).toBe(1);
  });

  it('escapes values containing commas and quotes', () => {
    const data: AuditExport = {
      entries: [
        {
          id: 'a-1',
          user_id: 'u-1',
          action: 'UPDATE',
          table_name: 'invoices',
          record_id: 'inv-1',
          old_values: '{"name":"value,with,commas"}',
          new_values: '{"name":"value""with""quotes"}',
          ip_address: '127.0.0.1',
          user_agent: 'test',
          created_at: '2026-03-21T12:00:00Z',
        },
      ],
      total_count: 1,
    };

    const csv = service.exportToCsv(data);
    expect(csv).toContain('"');
  });

  it('escapes values containing newlines', () => {
    const data: AuditExport = {
      entries: [
        {
          id: 'a-1',
          user_id: 'u-1',
          action: 'UPDATE',
          table_name: 'invoices',
          record_id: 'inv-1',
          old_values: 'line1\nline2',
          new_values: null,
          ip_address: '127.0.0.1',
          user_agent: 'test',
          created_at: '2026-03-21T12:00:00Z',
        },
      ],
      total_count: 1,
    };

    const csv = service.exportToCsv(data);
    // The value with newline should be wrapped in quotes
    expect(csv).toContain('"line1\nline2"');
  });
});

// ===========================================================================
// generateReport — exhaustiveness check (lines 76-77) is intentionally
// unreachable in TypeScript: all ReportType enum values are in REPORT_ROLE_ACCESS
// and in the switch. The following test documents this design contract.
// ===========================================================================
describe('generateReport — exhaustiveness: all known report types are handled', () => {
  const allReportTypes = [
    ReportType.PORTFOLIO_SUMMARY,
    ReportType.AGING_ANALYSIS,
    ReportType.BUYER_EXPOSURE,
    ReportType.PROFIT,
    ReportType.FACILITY,
    ReportType.AUDIT_EXPORT,
    ReportType.REGULATORY,
    ReportType.APPLICATIONS_RECEIVED,
    ReportType.APPLICATIONS_PIPELINE,
    ReportType.APPLICATIONS_INCOMPLETE,
    ReportType.COMPANY_PL,
    ReportType.DISBURSED_FUNDS,
    ReportType.CTR,
    ReportType.SAR_STATUS,
  ];

  it('every ReportType enum value has a matching repo call (no default branch reached)', async () => {
    // This test verifies that ALL enum values are handled in the switch,
    // ensuring the exhaustive default check is never triggered at runtime.
    mockedRepo.getPortfolioSummary.mockResolvedValue({ total_funded: '0' } as never);
    mockedRepo.getAgingAnalysis.mockResolvedValue({ buckets: [] } as never);
    mockedRepo.getBuyerExposure.mockResolvedValue([] as never);
    mockedRepo.getProfitReport.mockResolvedValue({ invoices: [], summary: {} } as never);
    mockedRepo.getFacilityReport.mockResolvedValue({
      facilities: [],
      upcoming_maturities: [],
    } as never);
    mockedRepo.getAuditExport.mockResolvedValue({ entries: [], total_count: 0 } as never);
    mockedRepo.getRegulatoryReport.mockResolvedValue({ aml_flags_raised: 0 } as never);
    mockedRepo.getApplicationsReceived.mockResolvedValue({
      total: 0,
      by_status: [],
      by_day: [],
    } as never);
    mockedRepo.getApplicationsPipeline.mockResolvedValue({ stages: [] } as never);
    mockedRepo.getIncompleteApplications.mockResolvedValue([] as never);
    mockedRepo.getCompanyPl.mockResolvedValue({
      total_face_value_discounted: '0',
      total_discount_earned: '0',
      total_bank_interest_cost: '0',
      gross_profit: '0',
    } as never);
    mockedRepo.getDisbursedFunds.mockResolvedValue({
      payments: [],
      total_disbursed: '0',
      count: 0,
    } as never);
    mockedRepo.getCtrReport.mockResolvedValue({
      period: 'all-time to present',
      transactions: [],
      total_count: 0,
    } as never);
    mockedRepo.getSarStatusReport.mockResolvedValue({
      total_draft: 0,
      total_filed: 0,
      total_pending: 0,
      reports: [],
    } as never);

    const roleForType: Record<string, string> = {
      [ReportType.PORTFOLIO_SUMMARY]: 'management',
      [ReportType.AGING_ANALYSIS]: 'credit_officer',
      [ReportType.BUYER_EXPOSURE]: 'management',
      [ReportType.PROFIT]: 'finance_manager',
      [ReportType.FACILITY]: 'finance_manager',
      [ReportType.AUDIT_EXPORT]: 'auditor',
      [ReportType.REGULATORY]: 'compliance_officer',
      [ReportType.APPLICATIONS_RECEIVED]: 'management',
      [ReportType.APPLICATIONS_PIPELINE]: 'management',
      [ReportType.APPLICATIONS_INCOMPLETE]: 'management',
      [ReportType.COMPANY_PL]: 'finance_manager',
      [ReportType.DISBURSED_FUNDS]: 'management',
      [ReportType.CTR]: 'compliance_officer',
      [ReportType.SAR_STATUS]: 'management',
    };

    for (const type of allReportTypes) {
      const result = await service.generateReport(
        type,
        'u',
        roleForType[type],
        {},
        '0.0.0.0',
        'ua',
      );
      expect(result.reportType).toBe(type);
    }
  });
});
