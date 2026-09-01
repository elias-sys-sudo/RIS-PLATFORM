jest.mock('../../../src/services/risk-engine/risk-engine.service');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

import type { Request, Response, NextFunction } from 'express';
import * as controller from '../../../src/services/risk-engine/risk-engine.controller';
import * as service from '../../../src/services/risk-engine/risk-engine.service';
import { RiskRecommendation } from '../../../src/services/risk-engine/risk-engine.types';
import type { RiskScoreRecord } from '../../../src/services/risk-engine/risk-engine.types';

const mockedService = service as jest.Mocked<typeof service>;

function makeRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('risk-engine.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // handleScoreInvoiceJob
  // -----------------------------------------------------------------------
  describe('handleScoreInvoiceJob', () => {
    it('calls service.scoreInvoice with invoiceId', async () => {
      mockedService.scoreInvoice.mockResolvedValue({
        invoiceId: 'inv-1',
        factors: [],
        finalScore: 78,
        recommendation: RiskRecommendation.AUTO_APPROVE,
        maxAdvancePct: 0.95,
        riskPremiumRate: 0.005,
      });

      await controller.handleScoreInvoiceJob('inv-1');

      expect(mockedService.scoreInvoice).toHaveBeenCalledWith('inv-1');
    });

    it('propagates errors from service', async () => {
      mockedService.scoreInvoice.mockRejectedValue(new Error('test error'));

      await expect(controller.handleScoreInvoiceJob('inv-1')).rejects.toThrow('test error');
    });
  });

  // -----------------------------------------------------------------------
  // getRiskScoreHandler
  // -----------------------------------------------------------------------
  describe('getRiskScoreHandler', () => {
    it('returns 200 with risk score', async () => {
      const mockScore = {
        id: 'rs-1',
        invoice_id: 'inv-1',
        final_score: 78,
      } as RiskScoreRecord;
      mockedService.getRiskScore.mockResolvedValue(mockScore);

      const req = { params: { id: 'inv-1' } } as unknown as Request;
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.getRiskScoreHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockScore);
    });

    it('calls next with error on failure', async () => {
      const err = new Error('not found');
      mockedService.getRiskScore.mockRejectedValue(err);

      const req = { params: { id: 'inv-1' } } as unknown as Request;
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await controller.getRiskScoreHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });
});
