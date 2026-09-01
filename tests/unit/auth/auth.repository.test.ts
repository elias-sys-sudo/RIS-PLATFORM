// Set env vars before imports
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';

import type { PoolClient, QueryResult } from 'pg';

// ---------------------------------------------------------------------------
// Mock the database pool
// ---------------------------------------------------------------------------

const mockQuery = jest.fn();
const mockPoolConnect = jest.fn();

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: (...args: unknown[]) => mockQuery(...args),
  pool: { connect: (...args: unknown[]) => mockPoolConnect(...args) },
}));

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  findUserByEmail,
  incrementFailedLogin,
  resetFailedLogin,
  lockAccount,
  recordLogin,
  createAuditEntry,
  getClient,
  invalidateResetTokens,
  createResetToken,
  findValidResetToken,
  markResetTokenUsed,
  updatePasswordHash,
  fetchUserProfile,
  findUserById,
  listBuyersForSupplier,
  incrementFailedLoginWithClient,
  lockAccountWithClient,
  createAuditEntryWithClient,
} from '../../../src/services/auth/auth.repository';

function makeMockClient(): PoolClient & { query: jest.Mock } {
  const clientQuery = jest.fn();
  return {
    query: clientQuery,
    release: jest.fn(),
  } as unknown as PoolClient & { query: jest.Mock };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('auth.repository', () => {
  describe('findUserByEmail', () => {
    it('returns user when found', async () => {
      const user = { id: 'u1', email: 'test@test.com', role: 'supplier' };
      mockQuery.mockResolvedValue({ rows: [user] } as unknown as QueryResult);

      const result = await findUserByEmail('test@test.com');

      expect(result).toEqual(user);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE email = $1'), [
        'test@test.com',
      ]);
    });

    it('returns null when user not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);
      const result = await findUserByEmail('nobody@test.com');
      expect(result).toBeNull();
    });
  });

  describe('incrementFailedLogin', () => {
    it('returns the new failed_login_count', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ failed_login_count: 3 }],
      } as unknown as QueryResult);

      const count = await incrementFailedLogin('u1');

      expect(count).toBe(3);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('failed_login_count + 1'), [
        'u1',
      ]);
    });

    it('returns 0 when query returns no rows', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      const count = await incrementFailedLogin('u1');

      expect(count).toBe(0);
    });
  });

  describe('resetFailedLogin', () => {
    it('resets count and clears locked_until', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      await resetFailedLogin('u1');

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('failed_login_count = 0'), [
        'u1',
      ]);
    });
  });

  describe('lockAccount', () => {
    it('sets locked_until timestamp', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);
      const lockDate = new Date();

      await lockAccount('u1', lockDate);

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('locked_until = $1'), [
        lockDate,
        'u1',
      ]);
    });
  });

  describe('recordLogin', () => {
    it('updates last_login_at', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      await recordLogin('u1');

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('last_login_at'), ['u1']);
    });
  });

  describe('createAuditEntry', () => {
    it('inserts audit log entry with correct parameters', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      await createAuditEntry('u1', 'LOGIN_SUCCESS', '127.0.0.1', 'jest', { key: 'value' });

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), [
        'u1',
        'LOGIN_SUCCESS',
        'users',
        'u1',
        '{"key":"value"}',
        '127.0.0.1',
        'jest',
      ]);
    });

    it('handles null userId for anonymous events', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      await createAuditEntry(null, 'LOGIN_FAILED', '127.0.0.1', 'jest', {
        reason: 'user_not_found',
      });

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), [
        null,
        'LOGIN_FAILED',
        'users',
        null,
        expect.any(String),
        '127.0.0.1',
        'jest',
      ]);
    });

    it('uses null for missing ipAddress and userAgent', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      await createAuditEntry('u1', 'LOGIN_SUCCESS');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining([null, null]),
      );
    });

    it('uses empty object when metadata is omitted', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      await createAuditEntry('u1', 'LOGOUT');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['{}', null, null]),
      );
    });
  });

  // =========================================================================
  // getClient
  // =========================================================================
  describe('getClient', () => {
    it('returns a pool client', async () => {
      const mockClient = makeMockClient();
      mockPoolConnect.mockResolvedValue(mockClient);

      const client = await getClient();

      expect(client).toBe(mockClient);
      expect(mockPoolConnect).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Password reset token functions
  // =========================================================================
  describe('invalidateResetTokens', () => {
    it('marks existing tokens as used', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 2 } as unknown as QueryResult);

      await invalidateResetTokens('u1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE password_reset_tokens'),
        ['u1'],
      );
    });
  });

  describe('createResetToken', () => {
    it('inserts a new reset token', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);
      const expiresAt = new Date(Date.now() + 3600_000);

      await createResetToken('u1', 'hashed-token-abc', expiresAt);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO password_reset_tokens'),
        ['u1', 'hashed-token-abc', expiresAt],
      );
    });
  });

  describe('findValidResetToken', () => {
    it('returns the token record when found', async () => {
      const tokenRecord = { id: 'tok-1', user_id: 'u1', token_hash: 'abc' };
      mockQuery.mockResolvedValue({ rows: [tokenRecord] } as unknown as QueryResult);

      const result = await findValidResetToken('abc');

      expect(result).toEqual(tokenRecord);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE token_hash = $1'), [
        'abc',
      ]);
    });

    it('returns null when no valid token exists', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      const result = await findValidResetToken('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('markResetTokenUsed', () => {
    it('sets used_at on the token', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      await markResetTokenUsed('tok-1');

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('SET used_at = NOW()'), [
        'tok-1',
      ]);
    });
  });

  describe('updatePasswordHash', () => {
    it('updates the password hash for a user', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      await updatePasswordHash('u1', 'new-hash-xyz');

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('SET password_hash = $1'), [
        'new-hash-xyz',
        'u1',
      ]);
    });
  });

  describe('fetchUserProfile', () => {
    it('returns user profile when found', async () => {
      const profile = {
        id: 'u1',
        email: 'user@test.com',
        role: 'supplier',
        first_name_encrypted: 'enc-first',
        last_name_encrypted: 'enc-last',
      };
      mockQuery.mockResolvedValue({ rows: [profile] } as unknown as QueryResult);

      const result = await fetchUserProfile('u1');

      expect(result).toEqual(profile);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT id, email, role'), [
        'u1',
      ]);
    });

    it('returns null when user not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      const result = await fetchUserProfile('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findUserById', () => {
    it('returns user when found', async () => {
      const user = { id: 'u1', email: 'user@test.com', role: 'supplier', is_active: true };
      mockQuery.mockResolvedValue({ rows: [user] } as unknown as QueryResult);

      const result = await findUserById('u1');

      expect(result).toEqual(user);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), ['u1']);
    });

    it('returns null when user not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as unknown as QueryResult);

      const result = await findUserById('no-such-id');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // listBuyersForSupplier
  // =========================================================================
  describe('listBuyersForSupplier', () => {
    const buyerRow = {
      id: 'b1',
      company_name: 'Buyer Co',
      contact_email_encrypted: 'enc-email',
      contact_phone_encrypted: 'enc-phone',
      is_active: true,
      total_invoices: 3,
      total_outstanding: '5000000',
    };

    it('returns paginated buyers without filters', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as QueryResult)
        .mockResolvedValueOnce({ rows: [buyerRow] } as unknown as QueryResult);

      const result = await listBuyersForSupplier('sup-1', { page: 1, limit: 20 });

      expect(result).toEqual({ rows: [buyerRow], total: 1 });
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('applies search filter when provided', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as unknown as QueryResult)
        .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult);

      await listBuyersForSupplier('sup-1', { page: 1, limit: 10, search: 'Buyer' });

      const countCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countCall[1]).toContain('%Buyer%');
    });

    it('applies active status filter', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '2' }] } as unknown as QueryResult)
        .mockResolvedValueOnce({ rows: [buyerRow] } as unknown as QueryResult);

      await listBuyersForSupplier('sup-1', { page: 1, limit: 10, status: 'active' });

      const countCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countCall[1]).toContain(true);
    });

    it('applies inactive status filter', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as QueryResult)
        .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult);

      await listBuyersForSupplier('sup-1', { page: 2, limit: 5, status: 'inactive' });

      const countCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countCall[1]).toContain(false);
    });

    it('applies both search and status filters together', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as unknown as QueryResult)
        .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult);

      await listBuyersForSupplier('sup-1', {
        page: 1,
        limit: 10,
        search: 'Corp',
        status: 'active',
      });

      const countCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countCall[1]).toContain('%Corp%');
      expect(countCall[1]).toContain(true);
    });

    it('defaults total to 0 when count row is empty', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult)
        .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult);

      const result = await listBuyersForSupplier('sup-1', { page: 1, limit: 10 });

      expect(result.total).toBe(0);
    });
  });

  // =========================================================================
  // Transaction-aware WithClient variants
  // =========================================================================
  describe('incrementFailedLoginWithClient', () => {
    it('returns the updated failed_login_count', async () => {
      const client = makeMockClient();
      client.query.mockResolvedValue({ rows: [{ failed_login_count: 4 }] });

      const count = await incrementFailedLoginWithClient(client, 'u1');

      expect(count).toBe(4);
      expect(client.query).toHaveBeenCalledWith(expect.stringContaining('failed_login_count + 1'), [
        'u1',
      ]);
    });

    it('returns 0 when query returns no rows', async () => {
      const client = makeMockClient();
      client.query.mockResolvedValue({ rows: [] });

      const count = await incrementFailedLoginWithClient(client, 'u1');

      expect(count).toBe(0);
    });
  });

  describe('lockAccountWithClient', () => {
    it('sets locked_until within a transaction', async () => {
      const client = makeMockClient();
      client.query.mockResolvedValue({ rows: [] });
      const lockDate = new Date(Date.now() + 900_000);

      await lockAccountWithClient(client, 'u1', lockDate);

      expect(client.query).toHaveBeenCalledWith(expect.stringContaining('SET locked_until = $1'), [
        lockDate,
        'u1',
      ]);
    });
  });

  describe('createAuditEntryWithClient', () => {
    it('inserts audit log via client within a transaction', async () => {
      const client = makeMockClient();
      client.query.mockResolvedValue({ rows: [] });

      await createAuditEntryWithClient(client, 'u1', 'LOGIN_SUCCESS', '10.0.0.1', 'TestAgent', {
        extra: 'data',
      });

      expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), [
        'u1',
        'LOGIN_SUCCESS',
        'users',
        'u1',
        '{"extra":"data"}',
        '10.0.0.1',
        'TestAgent',
      ]);
    });

    it('handles null userId and omitted optional args', async () => {
      const client = makeMockClient();
      client.query.mockResolvedValue({ rows: [] });

      await createAuditEntryWithClient(client, null, 'LOGIN_FAILED');

      expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), [
        null,
        'LOGIN_FAILED',
        'users',
        null,
        '{}',
        null,
        null,
      ]);
    });
  });
});
