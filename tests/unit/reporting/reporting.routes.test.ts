process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks — must be set BEFORE importing routes
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/reporting/reporting.service', () => ({
  generateReport: jest.fn(),
  validateRoleAccess: jest.fn(),
  exportToCsv: jest.fn(),
}));
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  pool: { connect: jest.fn() },
  query: jest.fn(),
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

// ---------------------------------------------------------------------------
// Auth mock factory: configurable role per test
// ---------------------------------------------------------------------------
let mockRole = 'management';
let mockUserId = 'user-1';

jest.mock('../../../src/shared/middleware/auth.middleware', () => ({
  authenticateJwt: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ): Promise<void> => {
    _req.user = { userId: mockUserId, role: mockRole, sessionId: 'sess-1' };
    next();
    return Promise.resolve();
  },
}));

import { reportingRouter } from '../../../src/services/reporting/reporting.routes';
import * as service from '../../../src/services/reporting/reporting.service';
import { globalErrorHandler } from '../../../src/shared/middleware/error-handler';
import { ReportType } from '../../../src/services/reporting/reporting.types';

const mockedService = service as jest.Mocked<typeof service>;

function createApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/reports', reportingRouter);
  app.use(globalErrorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'management';
  mockUserId = 'user-1';
});

// ===========================================================================
// Role-based access tests
// ===========================================================================
describe('role-based access', () => {
  it('supplier calling GET /reports/portfolio returns 403', async () => {
    mockRole = 'supplier';
    const res = await request(createApp()).get('/reports/portfolio');
    expect(res.status).toBe(403);
  });

  it('auditor calling GET /reports/audit-export returns 200', async () => {
    mockRole = 'auditor';
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.AUDIT_EXPORT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { entries: [], total_count: 0 },
    } as never);

    const res = await request(createApp()).get('/reports/audit-export');
    expect(res.status).toBe(200);
  });

  it('credit_officer calling GET /reports/regulatory returns 403', async () => {
    mockRole = 'credit_officer';
    const res = await request(createApp()).get('/reports/regulatory');
    expect(res.status).toBe(403);
  });

  it('finance_manager calling GET /reports/audit-export returns 403', async () => {
    mockRole = 'finance_manager';
    const res = await request(createApp()).get('/reports/audit-export');
    expect(res.status).toBe(403);
  });

  it('management can access portfolio', async () => {
    mockRole = 'management';
    mockedService.generateReport.mockResolvedValue({
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
    } as never);

    const res = await request(createApp()).get('/reports/portfolio');
    expect(res.status).toBe(200);
  });

  it('auditor can access portfolio', async () => {
    mockRole = 'auditor';
    mockedService.generateReport.mockResolvedValue({
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
    } as never);

    const res = await request(createApp()).get('/reports/portfolio');
    expect(res.status).toBe(200);
  });

  it('credit_officer can access aging', async () => {
    mockRole = 'credit_officer';
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.AGING_ANALYSIS,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { buckets: [] },
    } as never);

    const res = await request(createApp()).get('/reports/aging');
    expect(res.status).toBe(200);
  });

  it('compliance_officer can access regulatory', async () => {
    mockRole = 'compliance_officer';
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.REGULATORY,
      generatedAt: '2026-03-21T12:00:00Z',
      data: {
        aml_flags_raised: 0,
        sars_filed: 0,
        transactions_above_threshold: 0,
        kyc_approvals: 0,
        kyc_rejections: 0,
      },
    } as never);

    const res = await request(createApp()).get('/reports/regulatory');
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// CSV export headers
// ===========================================================================
describe('CSV export', () => {
  it('returns correct Content-Type for CSV audit export', async () => {
    mockRole = 'auditor';
    mockedService.generateReport.mockResolvedValue({
      reportType: ReportType.AUDIT_EXPORT,
      generatedAt: '2026-03-21T12:00:00Z',
      data: { entries: [], total_count: 0 },
    } as never);
    mockedService.exportToCsv.mockReturnValue('id,user_id,action\n');

    const res = await request(createApp()).get('/reports/audit-export?format=csv');

    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)['content-type']).toContain('text/csv');
    expect((res.headers as Record<string, string>)['content-disposition']).toContain(
      'audit_export',
    );
  });
});

// ===========================================================================
// Empty result set
// ===========================================================================
describe('empty result set', () => {
  it('returns 200 with empty report, not 404', async () => {
    mockRole = 'management';
    mockedService.generateReport.mockResolvedValue({
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
    } as never);

    const res = await request(createApp()).get('/reports/portfolio');
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toBeDefined();
  });
});

// ===========================================================================
// All routes exist
// ===========================================================================
describe('route existence', () => {
  const routeTests = [
    { path: '/reports/portfolio', role: 'management' },
    { path: '/reports/aging', role: 'credit_officer' },
    { path: '/reports/buyer-exposure', role: 'credit_officer' },
    { path: '/reports/profit', role: 'finance_manager' },
    { path: '/reports/facilities', role: 'finance_manager' },
    { path: '/reports/audit-export', role: 'auditor' },
    { path: '/reports/regulatory', role: 'compliance_officer' },
  ];

  routeTests.forEach(({ path, role }) => {
    it(`GET ${path} does not return 404`, async () => {
      mockRole = role;
      mockedService.generateReport.mockResolvedValue({
        reportType: ReportType.PORTFOLIO_SUMMARY,
        generatedAt: '2026-03-21T12:00:00Z',
        data: {},
      } as never);

      const res = await request(createApp()).get(path);
      expect(res.status).not.toBe(404);
    });
  });
});
