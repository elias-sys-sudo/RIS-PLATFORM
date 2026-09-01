import type { Request, Response, NextFunction } from 'express';
import { xssSanitizeMiddleware } from '../../../src/shared/middleware/xss-sanitize';

function makeReq(method: string, body: unknown): Partial<Request> {
  return { method, body } as Partial<Request>;
}

const mockRes = {} as Response;
const mockNext: NextFunction = jest.fn();

describe('xssSanitizeMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('strips <script> tags from string fields', () => {
    const req = makeReq('POST', {
      name: 'Hello<script>alert("xss")</script>World',
    });
    xssSanitizeMiddleware(req as Request, mockRes, mockNext);
    expect((req.body as Record<string, string>).name).toBe('HelloWorld');
    expect(mockNext).toHaveBeenCalled();
  });

  it('strips <iframe> tags', () => {
    const req = makeReq('POST', {
      field: 'test<iframe src="evil.com"></iframe>value',
    });
    xssSanitizeMiddleware(req as Request, mockRes, mockNext);
    expect((req.body as Record<string, string>).field).toBe('testvalue');
  });

  it('strips javascript: URIs', () => {
    const req = makeReq('PUT', {
      url: 'javascript:alert(1)',
    });
    xssSanitizeMiddleware(req as Request, mockRes, mockNext);
    expect((req.body as Record<string, string>).url).toBe('alert(1)');
  });

  it('strips event handler attributes', () => {
    const req = makeReq('PATCH', {
      value: '<img onerror=alert(1) src=x>',
    });
    xssSanitizeMiddleware(req as Request, mockRes, mockNext);
    expect((req.body as Record<string, string>).value).toBe('');
  });

  it('does not modify GET requests', () => {
    const req = makeReq('GET', { name: '<script>evil</script>' });
    xssSanitizeMiddleware(req as Request, mockRes, mockNext);
    expect((req.body as Record<string, string>).name).toBe('<script>evil</script>');
  });

  it('handles nested objects', () => {
    const req = makeReq('POST', {
      outer: { inner: '<script>bad</script>clean' },
    });
    xssSanitizeMiddleware(req as Request, mockRes, mockNext);
    const body = req.body as Record<string, Record<string, string>>;
    expect(body.outer.inner).toBe('clean');
  });

  it('handles arrays', () => {
    const req = makeReq('POST', {
      items: ['<b>bold</b>', '<script>x</script>ok'],
    });
    xssSanitizeMiddleware(req as Request, mockRes, mockNext);
    const body = req.body as Record<string, string[]>;
    expect(body.items).toEqual(['bold', 'ok']);
  });

  it('preserves non-string values', () => {
    const req = makeReq('POST', {
      count: 42,
      active: true,
      data: null,
    });
    xssSanitizeMiddleware(req as Request, mockRes, mockNext);
    const body = req.body as Record<string, unknown>;
    expect(body.count).toBe(42);
    expect(body.active).toBe(true);
    expect(body.data).toBeNull();
  });

  it('applies lighter sanitisation to rich text "notes" field', () => {
    const req = makeReq('POST', {
      notes: '<b>Important</b> note <script>evil</script>',
    });
    xssSanitizeMiddleware(req as Request, mockRes, mockNext);
    const body = req.body as Record<string, string>;
    // Rich text keeps HTML tags but strips script
    expect(body.notes).toBe('<b>Important</b> note ');
  });

  it('calls next() even when body is undefined', () => {
    const req = makeReq('POST', undefined);
    xssSanitizeMiddleware(req as Request, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });
});
