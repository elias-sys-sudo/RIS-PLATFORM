import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../../src/shared/errors';

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
  },
}));

import { adminIpAllowlist } from '../../../src/shared/middleware/admin-ip-allowlist';

describe('adminIpAllowlist', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_ALLOWED_IPS;
    mockReq = { ip: '192.168.1.100' };
    mockRes = {};
    mockNext = jest.fn();
  });

  afterEach(() => {
    delete process.env.ADMIN_ALLOWED_IPS;
  });

  it('calls next() when ADMIN_ALLOWED_IPS is not set (dev mode)', () => {
    adminIpAllowlist(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('calls next() when client IP is in the allowlist', () => {
    process.env.ADMIN_ALLOWED_IPS = '192.168.1.100,10.0.0.1';

    adminIpAllowlist(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('throws ForbiddenError when client IP is not in the allowlist', () => {
    process.env.ADMIN_ALLOWED_IPS = '10.0.0.1,10.0.0.2';

    expect(() => adminIpAllowlist(mockReq as Request, mockRes as Response, mockNext)).toThrow(
      ForbiddenError,
    );
  });

  it('handles allowlist with spaces around IPs', () => {
    process.env.ADMIN_ALLOWED_IPS = ' 192.168.1.100 , 10.0.0.1 ';

    adminIpAllowlist(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('handles single IP in allowlist', () => {
    process.env.ADMIN_ALLOWED_IPS = '192.168.1.100';

    adminIpAllowlist(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('handles undefined req.ip gracefully', () => {
    process.env.ADMIN_ALLOWED_IPS = '10.0.0.1';
    const reqWithoutIp = { ...mockReq } as Request;
    Object.defineProperty(reqWithoutIp, 'ip', { value: undefined, writable: true });

    expect(() => adminIpAllowlist(reqWithoutIp, mockRes as Response, mockNext)).toThrow(
      ForbiddenError,
    );
  });
});
