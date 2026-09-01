process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks — must be set BEFORE importing routes
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/facilities/facilities.service', () => ({
  getActiveFacilities: jest.fn(),
  getDashboard: jest.fn(),
  createDrawdown: jest.fn(),
  processRepayment: jest.fn(),
  setNotificationQueue: jest.fn(),
  calculateDailyInterest: jest.fn(),
  calculateUtilisation: jest.fn(),
  accrueInterest: jest.fn(),
  checkUtilisationAlerts: jest.fn(),
  checkMaturityAlerts: jest.fn(),
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

// Mock auth to always pass (must return Promise for asyncHandler)
jest.mock('../../../src/shared/middleware/auth.middleware', () => ({
  authenticateJwt: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ): Promise<void> => {
    _req.user = { userId: 'user-1', role: 'finance_manager', sessionId: 'sess-1' };
    next();
    return Promise.resolve();
  },
}));

import { facilitiesRouter } from '../../../src/services/facilities/facilities.routes';
import * as service from '../../../src/services/facilities/facilities.service';
import { globalErrorHandler } from '../../../src/shared/middleware/error-handler';

const mockedService = service as jest.Mocked<typeof service>;

function createApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/facilities', facilitiesRouter);
  app.use(globalErrorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// GET /facilities
// ===========================================================================
describe('GET /facilities', () => {
  it('returns 200 for finance_manager', async () => {
    mockedService.getActiveFacilities.mockResolvedValue([]);

    const res = await request(createApp()).get('/facilities');

    if (res.status !== 200) {
      // eslint-disable-next-line no-console
      console.log('GET /facilities error body:', res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });
});

// ===========================================================================
// GET /facilities/dashboard
// ===========================================================================
describe('GET /facilities/dashboard', () => {
  it('returns 200 with dashboard', async () => {
    const dashboard = {
      totalFacilities: 0,
      totalLimit: '0',
      totalDrawn: '0',
      totalAvailable: '0',
      overallUtilisation: 0,
      facilities: [],
    };
    mockedService.getDashboard.mockResolvedValue(dashboard);

    const res = await request(createApp()).get('/facilities/dashboard').expect(200);

    expect((res.body as { totalFacilities: number }).totalFacilities).toBe(0);
  });
});

// ===========================================================================
// POST /facilities/:id/drawdown
// ===========================================================================
describe('POST /facilities/:id/drawdown', () => {
  it('returns 201 on valid drawdown', async () => {
    mockedService.createDrawdown.mockResolvedValue({
      drawdownId: 'dd-1',
      facilityId: 'fac-1',
      invoiceId: 'inv-1',
      principal: '100000000',
    } as never);

    const res = await request(createApp())
      .post('/facilities/550e8400-e29b-41d4-a716-446655440000/drawdown')
      .send({
        invoiceId: '550e8400-e29b-41d4-a716-446655440001',
        principal: '100000000',
        bankFees: '500000',
        invoiceDueDate: '2026-06-01',
      })
      .expect(201);

    expect((res.body as { drawdownId: string }).drawdownId).toBe('dd-1');
  });

  it('returns 400 on missing required fields', async () => {
    await request(createApp())
      .post('/facilities/550e8400-e29b-41d4-a716-446655440000/drawdown')
      .send({})
      .expect(400);
  });
});

// ===========================================================================
// POST /facilities/:id/repay
// ===========================================================================
describe('POST /facilities/:id/repay', () => {
  it('returns 200 on valid repayment', async () => {
    mockedService.processRepayment.mockResolvedValue({
      drawdownId: 'dd-1',
      principal: '100000000',
      accruedInterest: '500000',
      bankFees: '200000',
      totalRepayment: '100700000',
    });

    const res = await request(createApp())
      .post('/facilities/550e8400-e29b-41d4-a716-446655440000/repay')
      .send({
        drawdownId: '550e8400-e29b-41d4-a716-446655440001',
      })
      .expect(200);

    expect((res.body as { totalRepayment: string }).totalRepayment).toBe('100700000');
  });

  it('returns 400 on missing drawdownId', async () => {
    await request(createApp())
      .post('/facilities/550e8400-e29b-41d4-a716-446655440000/repay')
      .send({})
      .expect(400);
  });
});
