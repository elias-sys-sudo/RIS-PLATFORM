process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import type { Request, Response, NextFunction } from 'express';
import * as controller from '../../../src/services/facilities/facilities.controller';
import * as service from '../../../src/services/facilities/facilities.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/facilities/facilities.service');
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
    user: { userId: 'user-1', role: 'finance_manager' },
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('test-agent'),
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

const next: NextFunction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// GET /facilities
// ===========================================================================
describe('listFacilitiesHandler', () => {
  it('returns 200 with facilities list', async () => {
    const facilities = [{ id: 'fac-1' }];
    mockedService.getActiveFacilities.mockResolvedValue(facilities as never);

    const req = makeReq();
    const res = makeRes();

    await controller.listFacilitiesHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: facilities });
  });

  it('passes errors to next', async () => {
    const err = new Error('fail');
    mockedService.getActiveFacilities.mockRejectedValue(err);

    const req = makeReq();
    const res = makeRes();

    await controller.listFacilitiesHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ===========================================================================
// GET /facilities/dashboard
// ===========================================================================
describe('dashboardHandler', () => {
  it('returns 200 with dashboard data', async () => {
    const dashboard = { totalFacilities: 2 };
    mockedService.getDashboard.mockResolvedValue(dashboard as never);

    const req = makeReq();
    const res = makeRes();

    await controller.dashboardHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(dashboard);
  });
});

// ===========================================================================
// POST /facilities/:id/drawdown
// ===========================================================================
describe('drawdownHandler', () => {
  it('calls service with correct params and returns 201', async () => {
    const result = { drawdownId: 'dd-1', facilityId: 'fac-1' };
    mockedService.createDrawdown.mockResolvedValue(result as never);

    const req = makeReq({
      params: { id: 'fac-1' },
      body: {
        invoiceId: 'inv-1',
        principal: '100000000',
        bankFees: '500000',
        invoiceDueDate: '2026-06-01',
      },
    });
    const res = makeRes();

    await controller.drawdownHandler(req, res, next);

    expect(mockedService.createDrawdown).toHaveBeenCalledWith(
      'fac-1',
      'inv-1',
      '100000000',
      '500000',
      '2026-06-01',
      'user-1',
      '127.0.0.1',
      'test-agent',
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(result);
  });
});

// ===========================================================================
// POST /facilities/:id/repay
// ===========================================================================
describe('repayHandler', () => {
  it('calls service with correct params and returns 200', async () => {
    const result = { totalRepayment: '100700000' };
    mockedService.processRepayment.mockResolvedValue(result as never);

    const req = makeReq({
      params: { id: 'fac-1' },
      body: { drawdownId: 'dd-1' },
    });
    const res = makeRes();

    await controller.repayHandler(req, res, next);

    expect(mockedService.processRepayment).toHaveBeenCalledWith(
      'fac-1',
      'dd-1',
      'user-1',
      '127.0.0.1',
      'test-agent',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(result);
  });

  it('passes errors to next', async () => {
    const err = new Error('repay fail');
    mockedService.processRepayment.mockRejectedValue(err);

    const req = makeReq({
      params: { id: 'fac-1' },
      body: { drawdownId: 'dd-1' },
    });
    const res = makeRes();

    await controller.repayHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('uses empty string for userId and unknown for ip/ua when req values are undefined', async () => {
    const result = { totalRepayment: '100700000' };
    mockedService.processRepayment.mockResolvedValue(result as never);

    const req = makeReq({
      params: { id: 'fac-1' },
      body: { drawdownId: 'dd-1' },
      user: undefined,
      ip: undefined,
      get: jest.fn().mockReturnValue(undefined),
    });
    const res = makeRes();

    await controller.repayHandler(req, res, next);

    expect(mockedService.processRepayment).toHaveBeenCalledWith(
      'fac-1',
      'dd-1',
      '',
      'unknown',
      'unknown',
    );
  });
});

// ===========================================================================
// dashboardHandler error path
// ===========================================================================
describe('dashboardHandler error path', () => {
  it('passes errors to next', async () => {
    const err = new Error('dashboard fail');
    mockedService.getDashboard.mockRejectedValue(err);

    const req = makeReq();
    const res = makeRes();

    await controller.dashboardHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ===========================================================================
// drawdownHandler error path
// ===========================================================================
describe('drawdownHandler error path', () => {
  it('passes errors to next', async () => {
    const err = new Error('drawdown fail');
    mockedService.createDrawdown.mockRejectedValue(err);

    const req = makeReq({
      params: { id: 'fac-1' },
      body: {
        invoiceId: 'inv-1',
        principal: '100000000',
        bankFees: '500000',
        invoiceDueDate: '2026-06-01',
      },
    });
    const res = makeRes();

    await controller.drawdownHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('uses empty string for userId when req.user is undefined', async () => {
    const result = { drawdownId: 'dd-1', facilityId: 'fac-1' };
    mockedService.createDrawdown.mockResolvedValue(result as never);

    const req = makeReq({
      params: { id: 'fac-1' },
      body: {
        invoiceId: 'inv-1',
        principal: '100000000',
        bankFees: '500000',
        invoiceDueDate: '2026-06-01',
      },
      user: undefined,
      ip: undefined,
    });
    const res = makeRes();

    await controller.drawdownHandler(req, res, next);

    expect(mockedService.createDrawdown).toHaveBeenCalledWith(
      'fac-1',
      'inv-1',
      '100000000',
      '500000',
      '2026-06-01',
      '',
      'unknown',
      expect.any(String),
    );
  });
});

// ===========================================================================
// BullMQ job handlers
// ===========================================================================
describe('handleInterestAccrualJob', () => {
  it('calls service.accrueInterest with today date', async () => {
    mockedService.accrueInterest.mockResolvedValue(undefined);

    await controller.handleInterestAccrualJob();

    expect(mockedService.accrueInterest).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('propagates errors from accrueInterest', async () => {
    const err = new Error('accrual failed');
    mockedService.accrueInterest.mockRejectedValue(err);

    await expect(controller.handleInterestAccrualJob()).rejects.toThrow('accrual failed');
  });
});

describe('handleUtilisationCheckJob', () => {
  it('calls checkUtilisationAlerts and checkMaturityAlerts', async () => {
    mockedService.checkUtilisationAlerts.mockResolvedValue(undefined);
    mockedService.checkMaturityAlerts.mockResolvedValue(undefined);

    await controller.handleUtilisationCheckJob();

    expect(mockedService.checkUtilisationAlerts).toHaveBeenCalled();
    expect(mockedService.checkMaturityAlerts).toHaveBeenCalled();
  });

  it('propagates errors from checkUtilisationAlerts', async () => {
    const err = new Error('utilisation check failed');
    mockedService.checkUtilisationAlerts.mockRejectedValue(err);

    await expect(controller.handleUtilisationCheckJob()).rejects.toThrow(
      'utilisation check failed',
    );
  });
});
