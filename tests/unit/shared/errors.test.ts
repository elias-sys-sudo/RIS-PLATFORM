/**
 * Unit tests for shared error classes and the index barrel.
 * Targets 100% coverage on:
 *   - src/shared/errors/auth.error.ts   (line 8 branch 0 — default message)
 *   - src/shared/errors/payment.error.ts (line 11 branch 0 — default transactionContext)
 *   - src/shared/errors/index.ts         (re-export barrel — anonymous_0 factory smoke-test)
 */

import { RisError } from '../../../src/shared/errors/ris.error';
import { ValidationError } from '../../../src/shared/errors/validation.error';
import { AuthError } from '../../../src/shared/errors/auth.error';
import { ForbiddenError } from '../../../src/shared/errors/forbidden.error';
import { NotFoundError } from '../../../src/shared/errors/not-found.error';
import { BusinessRuleError } from '../../../src/shared/errors/business.error';
import { PaymentError } from '../../../src/shared/errors/payment.error';

// Import via the index barrel — this exercises the anonymous re-export factory (anonymous_0).
import * as errorsIndex from '../../../src/shared/errors';

// ===========================================================================
// RisError (base)
// ===========================================================================
describe('RisError', () => {
  it('sets all properties correctly', () => {
    const err = new RisError('base error', 409, 'CONFLICT');
    expect(err.message).toBe('base error');
    expect(err.statusCode).toBe(409);
    expect(err.errorCode).toBe('CONFLICT');
    expect(err.isOperational).toBe(true);
    expect(err.name).toBe('RisError');
    expect(err).toBeInstanceOf(Error);
  });

  it('accepts isOperational = false', () => {
    const err = new RisError('fatal', 500, 'FATAL', false);
    expect(err.isOperational).toBe(false);
  });
});

// ===========================================================================
// AuthError
// ===========================================================================
describe('AuthError', () => {
  it('uses custom message when provided', () => {
    const err = new AuthError('Token expired');
    expect(err.message).toBe('Token expired');
    expect(err.statusCode).toBe(401);
    expect(err.errorCode).toBe('AUTH_ERROR');
    expect(err).toBeInstanceOf(RisError);
  });

  // Covers line 8 branch 0: default parameter when no message is passed
  it('uses default message when no argument is supplied', () => {
    const err = new AuthError();
    expect(err.message).toBe('Authentication required');
    expect(err.statusCode).toBe(401);
    expect(err.errorCode).toBe('AUTH_ERROR');
  });
});

// ===========================================================================
// ValidationError
// ===========================================================================
describe('ValidationError', () => {
  it('stores field-level errors', () => {
    const fields = [{ field: 'email', message: '"email" is required' }];
    const err = new ValidationError('Validation failed', fields);
    expect(err.statusCode).toBe(400);
    expect(err.errorCode).toBe('VALIDATION_ERROR');
    expect(err.fields).toEqual(fields);
  });

  it('defaults to empty fields array when not provided', () => {
    const err = new ValidationError('Bad input');
    expect(err.fields).toEqual([]);
  });
});

// ===========================================================================
// ForbiddenError
// ===========================================================================
describe('ForbiddenError', () => {
  it('uses custom message when provided', () => {
    const err = new ForbiddenError('Access denied to resource');
    expect(err.message).toBe('Access denied to resource');
    expect(err.statusCode).toBe(403);
    expect(err.errorCode).toBe('FORBIDDEN');
  });

  it('uses default message when no argument is supplied', () => {
    const err = new ForbiddenError();
    expect(err.message).toBe('You do not have permission to perform this action');
    expect(err.statusCode).toBe(403);
  });
});

// ===========================================================================
// NotFoundError
// ===========================================================================
describe('NotFoundError', () => {
  it('constructs message from entityType and entityId', () => {
    const err = new NotFoundError('Invoice', 'inv-abc-123');
    expect(err.message).toBe('Invoice not found');
    expect(err.statusCode).toBe(404);
    expect(err.errorCode).toBe('NOT_FOUND');
    expect(err.entityType).toBe('Invoice');
    expect(err.entityId).toBe('inv-abc-123');
  });
});

// ===========================================================================
// BusinessRuleError
// ===========================================================================
describe('BusinessRuleError', () => {
  it('stores data when provided', () => {
    const data = { max: 90, requested: 120 };
    const err = new BusinessRuleError('TENOR_EXCEEDED', 'Tenor too long', data);
    expect(err.statusCode).toBe(422);
    expect(err.errorCode).toBe('TENOR_EXCEEDED');
    expect(err.message).toBe('Tenor too long');
    expect(err.data).toEqual(data);
  });

  it('defaults to empty data object when not provided', () => {
    const err = new BusinessRuleError('LIMIT_EXCEEDED', 'Limit exceeded');
    expect(err.data).toEqual({});
  });
});

// ===========================================================================
// PaymentError
// ===========================================================================
describe('PaymentError', () => {
  it('stores transactionContext when provided', () => {
    const ctx = { txId: 'tx-001', provider: 'mtn' };
    const err = new PaymentError('MTN timeout', ctx);
    expect(err.message).toBe('MTN timeout');
    expect(err.statusCode).toBe(500);
    expect(err.errorCode).toBe('PAYMENT_ERROR');
    expect(err.isOperational).toBe(true);
    expect(err.transactionContext).toEqual(ctx);
  });

  // Covers line 11 branch 0: default parameter — empty transactionContext
  it('defaults transactionContext to empty object when not provided', () => {
    const err = new PaymentError('Provider unreachable');
    expect(err.transactionContext).toEqual({});
    expect(err.statusCode).toBe(500);
  });
});

// ===========================================================================
// errors/index.ts barrel — exercises the anonymous re-export factory
// ===========================================================================
describe('errors index barrel', () => {
  it('exports RisError', () => {
    expect(errorsIndex.RisError).toBeDefined();
    const err = new errorsIndex.RisError('test', 500, 'TEST');
    expect(err).toBeInstanceOf(Error);
  });

  it('exports ValidationError', () => {
    expect(errorsIndex.ValidationError).toBeDefined();
    const err = new errorsIndex.ValidationError('v');
    expect(err.statusCode).toBe(400);
  });

  it('exports AuthError', () => {
    expect(errorsIndex.AuthError).toBeDefined();
    const err = new errorsIndex.AuthError();
    expect(err.statusCode).toBe(401);
  });

  it('exports ForbiddenError', () => {
    expect(errorsIndex.ForbiddenError).toBeDefined();
    const err = new errorsIndex.ForbiddenError();
    expect(err.statusCode).toBe(403);
  });

  it('exports NotFoundError', () => {
    expect(errorsIndex.NotFoundError).toBeDefined();
    const err = new errorsIndex.NotFoundError('User', 'u-1');
    expect(err.statusCode).toBe(404);
  });

  it('exports BusinessRuleError', () => {
    expect(errorsIndex.BusinessRuleError).toBeDefined();
    const err = new errorsIndex.BusinessRuleError('CODE', 'msg');
    expect(err.statusCode).toBe(422);
  });

  it('exports PaymentError', () => {
    expect(errorsIndex.PaymentError).toBeDefined();
    const err = new errorsIndex.PaymentError('fail');
    expect(err.statusCode).toBe(500);
  });
});
