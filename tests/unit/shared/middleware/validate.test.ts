/**
 * Unit tests for src/shared/middleware/validate.ts
 *
 * Coverage targets:
 *   - line 57 branch 0 (query schema fails validation → errors pushed)
 *   - lines 58-59 (the error-push block inside query validation)
 *   - anonymous_4 (the inner middleware function returned by validate())
 */

process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-256-bits-long-for-testing-purposes-1234';

jest.mock('../../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { validate } from '../../../../src/shared/middleware/validate';
import { ValidationError } from '../../../../src/shared/errors/validation.error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests — anonymous_4 (the returned middleware function)
// ---------------------------------------------------------------------------
describe('validate middleware (anonymous_4 — inner function)', () => {
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
  });

  // -------------------------------------------------------------------------
  // Body validation
  // -------------------------------------------------------------------------
  it('calls next() and strips unknown body fields when body schema passes', () => {
    const schema = Joi.object({ name: Joi.string().required() });
    const middleware = validate({ body: schema });

    const req = makeReq({ body: { name: 'Alice', extra: 'ignored' } });
    middleware(req, makeRes(), next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    // stripUnknown: true removes 'extra'
    expect((req as unknown as { body: Record<string, unknown> }).body).toEqual({ name: 'Alice' });
  });

  it('throws ValidationError with field details when body schema fails', () => {
    const schema = Joi.object({ amount: Joi.number().required() });
    const middleware = validate({ body: schema });

    const req = makeReq({ body: { amount: 'not-a-number' } });

    expect(() => middleware(req, makeRes(), next as unknown as NextFunction)).toThrow(
      ValidationError,
    );

    expect(next).not.toHaveBeenCalled();
  });

  it('includes multiple body field errors when abortEarly is false', () => {
    const schema = Joi.object({
      name: Joi.string().required(),
      email: Joi.string().email().required(),
    });
    const middleware = validate({ body: schema });

    const req = makeReq({ body: {} });

    let thrown: ValidationError | undefined;
    try {
      middleware(req, makeRes(), next as unknown as NextFunction);
    } catch (err: unknown) {
      thrown = err as ValidationError;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    expect(thrown?.fields.length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // Params validation
  // -------------------------------------------------------------------------
  it('calls next() when params schema passes', () => {
    const schema = Joi.object({ id: Joi.string().uuid().required() });
    const middleware = validate({ params: schema });

    const req = makeReq({
      params: { id: 'a3bb189e-8bf9-3888-9912-ace4e6543002' },
    });
    middleware(req, makeRes(), next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws ValidationError with params. prefix when params schema fails', () => {
    const schema = Joi.object({ id: Joi.string().uuid().required() });
    const middleware = validate({ params: schema });

    const req = makeReq({ params: { id: 'not-a-uuid' } });

    let thrown: ValidationError | undefined;
    try {
      middleware(req, makeRes(), next as unknown as NextFunction);
    } catch (err: unknown) {
      thrown = err as ValidationError;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    expect(thrown?.fields[0].field).toMatch(/^params\./);
  });

  // -------------------------------------------------------------------------
  // Query validation — covers line 57 branch 0, lines 58-59
  // -------------------------------------------------------------------------
  it('calls next() and strips unknown query fields when query schema passes', () => {
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
    });
    const middleware = validate({ query: schema });

    const req = makeReq({
      query: { page: '2', unknown: 'ignored' } as unknown as Request['query'],
    });
    middleware(req, makeRes(), next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws ValidationError with query. prefix when query schema fails (branch 0 + lines 58-59)', () => {
    // This is the primary target: query validation fails → errors pushed with 'query.' prefix
    const schema = Joi.object({
      limit: Joi.number().integer().max(100).required(),
    });
    const middleware = validate({ query: schema });

    const req = makeReq({ query: { limit: 'notanumber' } as unknown as Request['query'] });

    let thrown: ValidationError | undefined;
    try {
      middleware(req, makeRes(), next as unknown as NextFunction);
    } catch (err: unknown) {
      thrown = err as ValidationError;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    expect(thrown?.fields.length).toBeGreaterThan(0);
    expect(thrown?.fields[0].field).toMatch(/^query\./);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws ValidationError with query. prefix for missing required query field', () => {
    const schema = Joi.object({ status: Joi.string().required() });
    const middleware = validate({ query: schema });

    const req = makeReq({ query: {} as unknown as Request['query'] });

    let thrown: ValidationError | undefined;
    try {
      middleware(req, makeRes(), next as unknown as NextFunction);
    } catch (err: unknown) {
      thrown = err as ValidationError;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    expect(thrown?.fields[0].field).toBe('query.status');
  });

  // -------------------------------------------------------------------------
  // Combined body + params + query
  // -------------------------------------------------------------------------
  it('accumulates errors from body, params, and query together', () => {
    const bodySchema = Joi.object({ name: Joi.string().required() });
    const paramsSchema = Joi.object({ id: Joi.string().uuid().required() });
    const querySchema = Joi.object({ page: Joi.number().required() });

    const middleware = validate({ body: bodySchema, params: paramsSchema, query: querySchema });

    const req = makeReq({
      body: {},
      params: { id: 'bad-id' },
      query: { page: 'nan' } as unknown as Request['query'],
    });

    let thrown: ValidationError | undefined;
    try {
      middleware(req, makeRes(), next as unknown as NextFunction);
    } catch (err: unknown) {
      thrown = err as ValidationError;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    // At minimum: name (body), id (params), page (query)
    expect(thrown?.fields.length).toBeGreaterThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // No schemas provided — should call next() with no errors
  // -------------------------------------------------------------------------
  it('calls next() when no schemas are provided', () => {
    const middleware = validate({});
    const req = makeReq();
    middleware(req, makeRes(), next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
