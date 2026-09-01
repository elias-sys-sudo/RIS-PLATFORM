process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import type { Request, Response, NextFunction } from 'express';
import * as controller from '../../../src/services/reporting/reporting.controller';
import * as service from '../../../src/services/reporting/reporting.service';
import { ReportType } from '../../../src/services/reporting/reporting.types';
import type { AuditExport } from '../../../src/services/reporting/reporting.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/reporting/reporting.service');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedService = service as jest.Mocked<typeof service>;

function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    params: {},
    body: {},
    query: {},
    user: { userId: 'user-1', role: 'management', sessionId: 'sess-1' },
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('test-agent'),
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

const next: NextFunction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// portfolioHandler
// ===========================================================================
describe('portfolioHandler', () => {
  it('returns 200 with portfolio summary', async () => {
    const mockResult = {
      reportType: ReportType.PORTFOLIO_SUMMARY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { total_funded: '5000000000' },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq();
    const res = makeRes();

    await controller.portfolioHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.PORTFOLIO_SUMMARY,
      'user-1',
      'management',
      {},
      '127.0.0.1',
      'test-agent',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: mockResult });
  });

  it('passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);

    const req = makeReq();
    const res = makeRes();

    await controller.portfolioHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ===========================================================================
// agingHandler
// ===========================================================================
describe('agingHandler', () => {
  it('returns 200 with aging analysis', async () => {
    const mockResult = {
      reportType: ReportType.AGING_ANALYSIS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { buckets: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      user: { userId: 'user-1', role: 'credit_officer', sessionId: 's-1' },
    });
    const res = makeRes();

    await controller.agingHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.AGING_ANALYSIS,
      'user-1',
      'credit_officer',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ===========================================================================
// buyerExposureHandler
// ===========================================================================
describe('buyerExposureHandler', () => {
  it('returns 200 with buyer exposure data', async () => {
    const mockResult = {
      reportType: ReportType.BUYER_EXPOSURE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: [],
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq();
    const res = makeRes();

    await controller.buyerExposureHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ===========================================================================
// profitHandler
// ===========================================================================
describe('profitHandler', () => {
  it('returns 200 with profit report', async () => {
    const mockResult = {
      reportType: ReportType.PROFIT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { invoices: [], summary: {} },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      user: { userId: 'user-1', role: 'finance_manager', sessionId: 's-1' },
    });
    const res = makeRes();

    await controller.profitHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ===========================================================================
// facilityHandler
// ===========================================================================
describe('facilityHandler', () => {
  it('returns 200 with facility report', async () => {
    const mockResult = {
      reportType: ReportType.FACILITY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { facilities: [], upcoming_maturities: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      user: { userId: 'user-1', role: 'finance_manager', sessionId: 's-1' },
    });
    const res = makeRes();

    await controller.facilityHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ===========================================================================
// auditExportHandler
// ===========================================================================
describe('auditExportHandler', () => {
  it('returns CSV with correct Content-Type and filename headers', async () => {
    const auditData: AuditExport = {
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
    const mockResult = {
      reportType: ReportType.AUDIT_EXPORT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: auditData,
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);
    mockedService.exportToCsv.mockReturnValue('id,user_id\na-1,u-1');

    const req = makeReq({
      user: { userId: 'user-1', role: 'auditor', sessionId: 's-1' },
      query: { format: 'csv' },
    });
    const res = makeRes();

    await controller.auditExportHandler(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('audit_export'),
    );
    expect(res.send).toHaveBeenCalled();
  });

  it('returns JSON when no format specified', async () => {
    const mockResult = {
      reportType: ReportType.AUDIT_EXPORT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { entries: [], total_count: 0 },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      user: { userId: 'user-1', role: 'auditor', sessionId: 's-1' },
      query: {},
    });
    const res = makeRes();

    await controller.auditExportHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: mockResult });
  });
});

// ===========================================================================
// applicationsReceivedHandler
// ===========================================================================
describe('applicationsReceivedHandler', () => {
  it('returns 200 with applications received data', async () => {
    const mockResult = {
      reportType: ReportType.APPLICATIONS_RECEIVED,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { total: 10, by_status: [], by_day: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      user: { userId: 'user-1', role: 'management', sessionId: 's-1' },
    });
    const res = makeRes();

    await controller.applicationsReceivedHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.APPLICATIONS_RECEIVED,
      'user-1',
      'management',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq();
    const res = makeRes();
    await controller.applicationsReceivedHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('uses empty strings when req.user is undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.APPLICATIONS_RECEIVED,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { total: 0, by_status: [], by_day: [] },
    } as never);
    const req = makeReq({ user: undefined });
    const res = makeRes();
    await controller.applicationsReceivedHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.APPLICATIONS_RECEIVED,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('uses "unknown" ip when req.ip is undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.APPLICATIONS_RECEIVED,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { total: 0, by_status: [], by_day: [] },
    } as never);
    const req = makeReq({ ip: undefined });
    const res = makeRes();
    await controller.applicationsReceivedHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.APPLICATIONS_RECEIVED,
      'user-1',
      'management',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });

  it('uses "unknown" ua when req.get returns undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.APPLICATIONS_RECEIVED,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { total: 0, by_status: [], by_day: [] },
    } as never);
    const req = makeReq({ get: jest.fn().mockReturnValue(undefined) });
    const res = makeRes();
    await controller.applicationsReceivedHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.APPLICATIONS_RECEIVED,
      'user-1',
      'management',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });
});

// ===========================================================================
// applicationsPipelineHandler
// ===========================================================================
describe('applicationsPipelineHandler', () => {
  it('returns 200 with applications pipeline data', async () => {
    const mockResult = {
      reportType: ReportType.APPLICATIONS_PIPELINE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { stages: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      user: { userId: 'user-1', role: 'credit_officer', sessionId: 's-1' },
    });
    const res = makeRes();

    await controller.applicationsPipelineHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq();
    const res = makeRes();
    await controller.applicationsPipelineHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('uses empty strings when req.user is undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.APPLICATIONS_PIPELINE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { stages: [] },
    } as never);
    const req = makeReq({ user: undefined });
    const res = makeRes();
    await controller.applicationsPipelineHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.APPLICATIONS_PIPELINE,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('uses "unknown" ip when req.ip is undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.APPLICATIONS_PIPELINE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { stages: [] },
    } as never);
    const req = makeReq({ ip: undefined });
    const res = makeRes();
    await controller.applicationsPipelineHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.APPLICATIONS_PIPELINE,
      'user-1',
      'management',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });

  it('uses "unknown" ua when req.get returns undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.APPLICATIONS_PIPELINE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { stages: [] },
    } as never);
    const req = makeReq({ get: jest.fn().mockReturnValue(undefined) });
    const res = makeRes();
    await controller.applicationsPipelineHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.APPLICATIONS_PIPELINE,
      'user-1',
      'management',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });
});

// ===========================================================================
// applicationsIncompleteHandler
// ===========================================================================
describe('applicationsIncompleteHandler', () => {
  it('returns 200 with incomplete applications data', async () => {
    const mockResult = {
      reportType: ReportType.APPLICATIONS_INCOMPLETE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: [],
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      user: { userId: 'user-1', role: 'compliance_officer', sessionId: 's-1' },
    });
    const res = makeRes();

    await controller.applicationsIncompleteHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq();
    const res = makeRes();
    await controller.applicationsIncompleteHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('uses empty strings when req.user is undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.APPLICATIONS_INCOMPLETE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: [],
    } as never);
    const req = makeReq({ user: undefined });
    const res = makeRes();
    await controller.applicationsIncompleteHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.APPLICATIONS_INCOMPLETE,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('uses "unknown" ip when req.ip is undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.APPLICATIONS_INCOMPLETE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: [],
    } as never);
    const req = makeReq({ ip: undefined });
    const res = makeRes();
    await controller.applicationsIncompleteHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.APPLICATIONS_INCOMPLETE,
      'user-1',
      'management',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });

  it('uses "unknown" ua when req.get returns undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.APPLICATIONS_INCOMPLETE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: [],
    } as never);
    const req = makeReq({ get: jest.fn().mockReturnValue(undefined) });
    const res = makeRes();
    await controller.applicationsIncompleteHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.APPLICATIONS_INCOMPLETE,
      'user-1',
      'management',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });
});

// ===========================================================================
// companyPlHandler
// ===========================================================================
describe('companyPlHandler', () => {
  it('returns 200 with company P&L data', async () => {
    const mockResult = {
      reportType: ReportType.COMPANY_PL,
      generatedAt: '2026-03-21T12:00:00Z',
      data: {
        total_face_value_discounted: '0',
        total_discount_earned: '0',
        total_bank_interest_cost: '0',
        gross_profit: '0',
      },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      user: { userId: 'user-1', role: 'finance_manager', sessionId: 's-1' },
    });
    const res = makeRes();

    await controller.companyPlHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq();
    const res = makeRes();
    await controller.companyPlHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('uses empty strings when req.user is undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.COMPANY_PL,
      generatedAt: '2026-03-21T12:00:00Z',
      data: {},
    } as never);
    const req = makeReq({ user: undefined });
    const res = makeRes();
    await controller.companyPlHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.COMPANY_PL,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('uses "unknown" ip when req.ip is undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.COMPANY_PL,
      generatedAt: '2026-03-21T12:00:00Z',
      data: {},
    } as never);
    const req = makeReq({ ip: undefined });
    const res = makeRes();
    await controller.companyPlHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.COMPANY_PL,
      'user-1',
      'management',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });

  it('uses "unknown" ua when req.get returns undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.COMPANY_PL,
      generatedAt: '2026-03-21T12:00:00Z',
      data: {},
    } as never);
    const req = makeReq({ get: jest.fn().mockReturnValue(undefined) });
    const res = makeRes();
    await controller.companyPlHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.COMPANY_PL,
      'user-1',
      'management',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });
});

// ===========================================================================
// disbursedFundsHandler
// ===========================================================================
describe('disbursedFundsHandler', () => {
  it('returns 200 with disbursed funds data', async () => {
    const mockResult = {
      reportType: ReportType.DISBURSED_FUNDS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { payments: [], total_disbursed: '0', count: 0 },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      user: { userId: 'user-1', role: 'finance_manager', sessionId: 's-1' },
    });
    const res = makeRes();

    await controller.disbursedFundsHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq();
    const res = makeRes();
    await controller.disbursedFundsHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('uses empty strings when req.user is undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.DISBURSED_FUNDS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { payments: [], total_disbursed: '0', count: 0 },
    } as never);
    const req = makeReq({ user: undefined });
    const res = makeRes();
    await controller.disbursedFundsHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.DISBURSED_FUNDS,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('uses "unknown" ip when req.ip is undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.DISBURSED_FUNDS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { payments: [], total_disbursed: '0', count: 0 },
    } as never);
    const req = makeReq({ ip: undefined });
    const res = makeRes();
    await controller.disbursedFundsHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.DISBURSED_FUNDS,
      'user-1',
      'management',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });

  it('uses "unknown" ua when req.get returns undefined', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.DISBURSED_FUNDS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { payments: [], total_disbursed: '0', count: 0 },
    } as never);
    const req = makeReq({ get: jest.fn().mockReturnValue(undefined) });
    const res = makeRes();
    await controller.disbursedFundsHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.DISBURSED_FUNDS,
      'user-1',
      'management',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });
});

// ===========================================================================
// regulatoryHandler
// ===========================================================================
describe('regulatoryHandler', () => {
  it('returns 200 with regulatory report', async () => {
    const mockResult = {
      reportType: ReportType.REGULATORY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { aml_flags_raised: 5 },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      user: { userId: 'user-1', role: 'compliance_officer', sessionId: 's-1' },
    });
    const res = makeRes();

    await controller.regulatoryHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ===========================================================================
// Error paths — catch blocks
// ===========================================================================
describe('error handling', () => {
  it('agingHandler passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq();
    const res = makeRes();
    await controller.agingHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('buyerExposureHandler passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq();
    const res = makeRes();
    await controller.buyerExposureHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('profitHandler passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq();
    const res = makeRes();
    await controller.profitHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('facilityHandler passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq();
    const res = makeRes();
    await controller.facilityHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('auditExportHandler passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq({
      user: { userId: 'user-1', role: 'auditor', sessionId: 's-1' },
    });
    const res = makeRes();
    await controller.auditExportHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('regulatoryHandler passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.generateReport.mockRejectedValue(err);
    const req = makeReq();
    const res = makeRes();
    await controller.regulatoryHandler(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ===========================================================================
// Fallback defaults — missing user/ip
// ===========================================================================
describe('fallback defaults', () => {
  it('uses empty string when req.user is undefined', async () => {
    const mockResult = {
      reportType: ReportType.PORTFOLIO_SUMMARY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: {},
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({ user: undefined, ip: undefined });
    const res = makeRes();
    await controller.portfolioHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.PORTFOLIO_SUMMARY,
      '',
      '',
      {},
      'unknown',
      'test-agent',
    );
  });

  it('handles missing user-agent header', async () => {
    const mockResult = {
      reportType: ReportType.PORTFOLIO_SUMMARY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: {},
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = makeRes();
    await controller.portfolioHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.PORTFOLIO_SUMMARY,
      'user-1',
      'management',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });

  it('extracts all filter types from query string', async () => {
    const mockResult = {
      reportType: ReportType.AGING_ANALYSIS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { buckets: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      query: {
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        userId: 'u-1',
        actionType: 'LOGIN',
        buyerId: 'b-1',
        status: 'funded',
      },
    });
    const res = makeRes();
    await controller.agingHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.AGING_ANALYSIS,
      'user-1',
      'management',
      {
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        userId: 'u-1',
        actionType: 'LOGIN',
        buyerId: 'b-1',
        status: 'funded',
      },
      '127.0.0.1',
      'test-agent',
    );
  });

  it('returns undefined for non-string query params', async () => {
    const mockResult = {
      reportType: ReportType.AGING_ANALYSIS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { buckets: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      query: { startDate: 123 },
    });
    const res = makeRes();
    await controller.agingHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.AGING_ANALYSIS,
      'user-1',
      'management',
      expect.objectContaining({ startDate: undefined }),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('passes query filters through to service', async () => {
    const mockResult = {
      reportType: ReportType.AGING_ANALYSIS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { buckets: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({
      query: { startDate: '2026-01-01', endDate: '2026-03-31' },
    });
    const res = makeRes();
    await controller.agingHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.AGING_ANALYSIS,
      'user-1',
      'management',
      expect.objectContaining({ startDate: '2026-01-01', endDate: '2026-03-31' }),
      '127.0.0.1',
      'test-agent',
    );
  });
});

// ===========================================================================
// Missing user / ip on every handler — covers branch 1 (req.user undefined)
// for lines 62-64, 89-91, 116-118, 136-138, 156-158, 185, 198-200
// ===========================================================================
describe('missing req.user — all handlers', () => {
  it('agingHandler uses empty strings for userId/role when req.user is undefined', async () => {
    const mockResult = {
      reportType: ReportType.AGING_ANALYSIS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { buckets: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({ user: undefined });
    const res = makeRes();
    await controller.agingHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.AGING_ANALYSIS,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('buyerExposureHandler uses empty strings when req.user is undefined', async () => {
    const mockResult = {
      reportType: ReportType.BUYER_EXPOSURE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: [],
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({ user: undefined });
    const res = makeRes();
    await controller.buyerExposureHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.BUYER_EXPOSURE,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('profitHandler uses empty strings when req.user is undefined', async () => {
    const mockResult = {
      reportType: ReportType.PROFIT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { invoices: [], summary: {} },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({ user: undefined });
    const res = makeRes();
    await controller.profitHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.PROFIT,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('facilityHandler uses empty strings when req.user is undefined', async () => {
    const mockResult = {
      reportType: ReportType.FACILITY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { facilities: [], upcoming_maturities: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({ user: undefined });
    const res = makeRes();
    await controller.facilityHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.FACILITY,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('auditExportHandler uses empty strings when req.user is undefined', async () => {
    const mockResult = {
      reportType: ReportType.AUDIT_EXPORT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { entries: [], total_count: 0 },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({ user: undefined, query: {} });
    const res = makeRes();
    await controller.auditExportHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.AUDIT_EXPORT,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });

  it('regulatoryHandler uses empty strings when req.user is undefined', async () => {
    const mockResult = {
      reportType: ReportType.REGULATORY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { aml_flags_raised: 0 },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq({ user: undefined });
    const res = makeRes();
    await controller.regulatoryHandler(req, res, next);

    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.REGULATORY,
      '',
      '',
      expect.any(Object),
      '127.0.0.1',
      'test-agent',
    );
  });
});

// ===========================================================================
// Missing ip / user-agent on every handler — covers ip ?? 'unknown' branch
// and req.get('user-agent') ?? 'unknown' branch for each handler
// ===========================================================================
describe('missing req.ip — all handlers', () => {
  const makeNoIpReq = (extra: Record<string, unknown> = {}) => makeReq({ ip: undefined, ...extra });

  it('agingHandler uses "unknown" ip when req.ip is undefined (line 64)', async () => {
    const mockResult = {
      reportType: ReportType.AGING_ANALYSIS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { buckets: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);
    const req = makeNoIpReq();
    const res = makeRes();
    await controller.agingHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.AGING_ANALYSIS,
      'user-1',
      'management',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });

  it('buyerExposureHandler uses "unknown" ip when req.ip is undefined (line 91)', async () => {
    const mockResult = {
      reportType: ReportType.BUYER_EXPOSURE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: [],
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);
    const req = makeNoIpReq();
    const res = makeRes();
    await controller.buyerExposureHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.BUYER_EXPOSURE,
      'user-1',
      'management',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });

  it('profitHandler uses "unknown" ip when req.ip is undefined (line 118)', async () => {
    const mockResult = {
      reportType: ReportType.PROFIT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { invoices: [], summary: {} },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);
    const req = makeNoIpReq({
      user: { userId: 'user-1', role: 'finance_manager', sessionId: 's-1' },
    });
    const res = makeRes();
    await controller.profitHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.PROFIT,
      'user-1',
      'finance_manager',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });

  it('facilityHandler uses "unknown" ip when req.ip is undefined (line 138)', async () => {
    const mockResult = {
      reportType: ReportType.FACILITY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { facilities: [], upcoming_maturities: [] },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);
    const req = makeNoIpReq({
      user: { userId: 'user-1', role: 'finance_manager', sessionId: 's-1' },
    });
    const res = makeRes();
    await controller.facilityHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.FACILITY,
      'user-1',
      'finance_manager',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });

  it('auditExportHandler uses "unknown" ip when req.ip is undefined (line 158)', async () => {
    const mockResult = {
      reportType: ReportType.AUDIT_EXPORT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { entries: [], total_count: 0 },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);
    const req = makeNoIpReq({
      user: { userId: 'user-1', role: 'auditor', sessionId: 's-1' },
      query: {},
    });
    const res = makeRes();
    await controller.auditExportHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.AUDIT_EXPORT,
      'user-1',
      'auditor',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });

  it('regulatoryHandler uses "unknown" ip when req.ip is undefined (line 200)', async () => {
    const mockResult = {
      reportType: ReportType.REGULATORY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { aml_flags_raised: 0 },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);
    const req = makeNoIpReq({
      user: { userId: 'user-1', role: 'compliance_officer', sessionId: 's-1' },
    });
    const res = makeRes();
    await controller.regulatoryHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.REGULATORY,
      'user-1',
      'compliance_officer',
      expect.any(Object),
      'unknown',
      'test-agent',
    );
  });
});

// ===========================================================================
// auditExportHandler — non-Error thrown (line 185 branch: instanceof Error false)
// ===========================================================================
describe('auditExportHandler — non-Error thrown in catch', () => {
  it('logs and forwards non-Error exception (line 185 false branch)', async () => {
    // Throw a non-Error value (string) to hit `err instanceof Error` false branch
    mockedService.generateReport.mockRejectedValue('plain string error');

    const req = makeReq({
      user: { userId: 'user-1', role: 'auditor', sessionId: 's-1' },
      query: {},
    });
    const res = makeRes();

    await controller.auditExportHandler(req, res, next);

    expect(next).toHaveBeenCalledWith('plain string error');
  });
});

// ===========================================================================
// Empty result set returns empty report, not 404
// ===========================================================================
describe('empty result handling', () => {
  it('returns 200 with empty data, not 404', async () => {
    const mockResult = {
      reportType: ReportType.PORTFOLIO_SUMMARY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: {
        total_funded: '0',
        total_collected: '0',
        total_outstanding: '0',
        total_overdue: '0',
        annualised_yield: '0',
        invoice_counts_by_status: [],
        top_buyers: [],
      },
    };
    mockedService.generateReport.mockResolvedValue(mockResult as never);

    const req = makeReq();
    const res = makeRes();

    await controller.portfolioHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: mockResult });
  });
});

// ===========================================================================
// missing user-agent — req.get('user-agent') ?? 'unknown' right branch
// Covers lines 65, 92, 119, 139, 159, 201
// ===========================================================================
describe('missing user-agent — all handlers', () => {
  const makeNoUaReq = (extra: Record<string, unknown> = {}) =>
    makeReq({ get: jest.fn().mockReturnValue(undefined), ...extra });

  it('agingHandler uses "unknown" ua when req.get returns undefined (line 65)', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.AGING_ANALYSIS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { buckets: [] },
    } as never);
    const req = makeNoUaReq();
    const res = makeRes();
    await controller.agingHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.AGING_ANALYSIS,
      'user-1',
      'management',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });

  it('buyerExposureHandler uses "unknown" ua when req.get returns undefined (line 92)', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.BUYER_EXPOSURE,
      generatedAt: '2026-03-21T12:00:00Z',
      data: [],
    } as never);
    const req = makeNoUaReq();
    const res = makeRes();
    await controller.buyerExposureHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.BUYER_EXPOSURE,
      'user-1',
      'management',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });

  it('profitHandler uses "unknown" ua when req.get returns undefined (line 119)', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.PROFIT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { invoices: [], summary: {} },
    } as never);
    const req = makeNoUaReq({
      user: { userId: 'user-1', role: 'finance_manager', sessionId: 's-1' },
    });
    const res = makeRes();
    await controller.profitHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.PROFIT,
      'user-1',
      'finance_manager',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });

  it('facilityHandler uses "unknown" ua when req.get returns undefined (line 139)', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.FACILITY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { facilities: [], upcoming_maturities: [] },
    } as never);
    const req = makeNoUaReq({
      user: { userId: 'user-1', role: 'finance_manager', sessionId: 's-1' },
    });
    const res = makeRes();
    await controller.facilityHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.FACILITY,
      'user-1',
      'finance_manager',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });

  it('auditExportHandler uses "unknown" ua when req.get returns undefined (line 159)', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.AUDIT_EXPORT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { entries: [], total_count: 0 },
    } as never);
    const req = makeNoUaReq({
      user: { userId: 'user-1', role: 'auditor', sessionId: 's-1' },
      query: {},
    });
    const res = makeRes();
    await controller.auditExportHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.AUDIT_EXPORT,
      'user-1',
      'auditor',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });

  it('regulatoryHandler uses "unknown" ua when req.get returns undefined (line 201)', async () => {
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.REGULATORY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { aml_flags_raised: 0 },
    } as never);
    const req = makeNoUaReq({
      user: { userId: 'user-1', role: 'compliance_officer', sessionId: 's-1' },
    });
    const res = makeRes();
    await controller.regulatoryHandler(req, res, next);
    expect(mockedService.generateReport).toHaveBeenCalledWith(
      ReportType.REGULATORY,
      'user-1',
      'compliance_officer',
      expect.any(Object),
      '127.0.0.1',
      'unknown',
    );
  });
});
