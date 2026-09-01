jest.mock('../../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
  },
}));

import { Request, Response, NextFunction } from 'express';
import { globalErrorHandler } from '../../../../src/shared/middleware/error-handler';
import { ValidationError } from '../../../../src/shared/errors/validation.error';
import { NotFoundError } from '../../../../src/shared/errors/not-found.error';
import { BusinessRuleError } from '../../../../src/shared/errors/business.error';
import { PaymentError } from '../../../../src/shared/errors/payment.error';
import { RisError } from '../../../../src/shared/errors/ris.error';
import { AuthError } from '../../../../src/shared/errors/auth.error';
import { logger } from '../../../../src/shared/logger';

function createMockRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const mockReq = {} as Request;
const mockNext = jest.fn() as NextFunction;

describe('globalErrorHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles ValidationError with fields', () => {
    const fields = [{ field: 'email', message: 'required' }];
    const err = new ValidationError('Validation failed', fields);
    const res = createMockRes();

    globalErrorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'VALIDATION_ERROR',
      message: 'Validation failed',
      fields,
    });
  });

  it('handles ValidationError without fields', () => {
    const err = new ValidationError('Bad input');
    const res = createMockRes();

    globalErrorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'VALIDATION_ERROR',
      message: 'Bad input',
      fields: [],
    });
  });

  it('handles NotFoundError', () => {
    const err = new NotFoundError('Invoice', 'inv-123');
    const res = createMockRes();

    globalErrorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'NOT_FOUND',
      message: 'Invoice not found',
    });
  });

  it('handles BusinessRuleError with data', () => {
    const data = { maxTenor: 90, requestedTenor: 120 };
    const err = new BusinessRuleError('TENOR_EXCEEDED', 'Tenor too long', data);
    const res = createMockRes();

    globalErrorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: 'TENOR_EXCEEDED',
      message: 'Tenor too long',
      data,
    });
  });

  it('handles BusinessRuleError without data', () => {
    const err = new BusinessRuleError('LIMIT_EXCEEDED', 'Limit exceeded');
    const res = createMockRes();

    globalErrorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: 'LIMIT_EXCEEDED',
      message: 'Limit exceeded',
      data: {},
    });
  });

  it('handles PaymentError — logs and returns generic 500', () => {
    const err = new PaymentError('MTN timeout', { txId: 'tx-1' });
    const res = createMockRes();

    globalErrorHandler(err, mockReq, res, mockNext);

    expect(logger.error).toHaveBeenCalledWith('Payment error occurred', {
      component: 'payment',
      errorCode: 'PAYMENT_ERROR',
      errorMessage: 'MTN timeout',
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'PAYMENT_ERROR',
      message: 'A payment processing error occurred',
    });
  });

  it('handles generic RisError (e.g. AuthError)', () => {
    const err = new AuthError('Token expired');
    const res = createMockRes();

    globalErrorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'AUTH_ERROR',
      message: 'Token expired',
    });
  });

  it('handles base RisError directly', () => {
    const err = new RisError('Custom error', 409, 'CONFLICT');
    const res = createMockRes();

    globalErrorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'CONFLICT',
      message: 'Custom error',
    });
  });

  it('handles unknown Error — logs and returns generic 500', () => {
    const err = new Error('Something broke');
    const res = createMockRes();

    globalErrorHandler(err, mockReq, res, mockNext);

    expect(logger.error).toHaveBeenCalledWith('Unhandled error', {
      component: 'error-handler',
      errorMessage: 'Something broke',
      errorName: 'Error',
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  it('handles unknown TypeError', () => {
    const err = new TypeError('Cannot read properties of undefined');
    const res = createMockRes();

    globalErrorHandler(err, mockReq, res, mockNext);

    expect(logger.error).toHaveBeenCalledWith('Unhandled error', {
      component: 'error-handler',
      errorMessage: 'Cannot read properties of undefined',
      errorName: 'TypeError',
    });
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
