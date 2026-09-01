const mockPoolConnect = jest.fn();

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: mockPoolConnect },
}));

import * as repo from '../../../src/services/verification/verification.repository';
import { query } from '../../../src/shared/database/pool';

const mockedQuery = query as jest.MockedFunction<typeof query>;

beforeEach(() => {
  jest.clearAllMocks();
});

const emptyResult = { rows: [], rowCount: 0, command: 'SELECT' as const, oid: 0, fields: [] };

describe('verification repository', () => {
  // =========================================================================
  // storeConfirmationToken
  // =========================================================================
  describe('storeConfirmationToken', () => {
    it('updates invoice with token hash and expiry using parameterised query', async () => {
      mockedQuery.mockResolvedValue({ ...emptyResult, command: 'UPDATE', rowCount: 1 });

      await repo.storeConfirmationToken('inv-1', 'abc123hash', '2026-03-22T10:00:00Z');

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('UPDATE invoices');
      expect(sql).toContain('confirmation_token_hash = $1');
      expect(sql).toContain('confirmation_token_expires_at = $2');
      expect(sql).toContain('WHERE id = $3');
      expect(params).toEqual(['abc123hash', '2026-03-22T10:00:00Z', 'inv-1']);
    });
  });

  // =========================================================================
  // findInvoiceByTokenHash
  // =========================================================================
  describe('findInvoiceByTokenHash', () => {
    it('returns invoice when token hash matches', async () => {
      const mockRow = { id: 'inv-1', status: 'submitted' };
      mockedQuery.mockResolvedValue({ ...emptyResult, rows: [mockRow], rowCount: 1 });

      const result = await repo.findInvoiceByTokenHash('hashvalue');

      expect(result).toEqual(mockRow);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE confirmation_token_hash = $1'),
        ['hashvalue'],
      );
    });

    it('returns null when no match', async () => {
      mockedQuery.mockResolvedValue(emptyResult);

      const result = await repo.findInvoiceByTokenHash('nonexistent');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // confirmInvoice
  // =========================================================================
  describe('confirmInvoice', () => {
    it('updates status to buyer_confirmed with IP and user agent', async () => {
      mockedQuery.mockResolvedValue({ ...emptyResult, command: 'UPDATE', rowCount: 1 });

      const rowCount = await repo.confirmInvoice('inv-1', '192.168.1.1', 'Mozilla/5.0');

      expect(rowCount).toBe(1);
      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain("status = 'buyer_confirmed'");
      expect(sql).toContain('buyer_confirmed_at = NOW()');
      expect(sql).toContain('buyer_confirmation_ip = $1');
      expect(sql).toContain('buyer_confirmed_at IS NULL');
      expect(params).toEqual(['192.168.1.1', 'Mozilla/5.0', 'inv-1']);
    });

    it('returns 0 when already confirmed (race condition)', async () => {
      mockedQuery.mockResolvedValue({ ...emptyResult, command: 'UPDATE', rowCount: 0 });

      const rowCount = await repo.confirmInvoice('inv-1', '192.168.1.1', 'agent');

      expect(rowCount).toBe(0);
    });

    it('returns 0 when rowCount is null', async () => {
      mockedQuery.mockResolvedValue({ ...emptyResult, command: 'UPDATE', rowCount: null });

      const rowCount = await repo.confirmInvoice('inv-1', '127.0.0.1', 'agent');

      expect(rowCount).toBe(0);
    });
  });

  // =========================================================================
  // findInvoiceForConfirmationPage
  // =========================================================================
  describe('findInvoiceForConfirmationPage', () => {
    it('joins invoices to suppliers for display data', async () => {
      const mockRow = {
        invoice_number: 'INV-001',
        face_value: '50000000',
        due_date: '2026-05-01',
        description: 'Test',
        supplier_name: 'Supplier Ltd',
      };
      mockedQuery.mockResolvedValue({ ...emptyResult, rows: [mockRow], rowCount: 1 });

      const result = await repo.findInvoiceForConfirmationPage('inv-1');

      expect(result).toEqual(mockRow);
      const [sql] = mockedQuery.mock.calls[0];
      expect(sql).toContain('JOIN suppliers');
      expect(sql).toContain('supplier_name');
    });

    it('returns null when invoice not found', async () => {
      mockedQuery.mockResolvedValue(emptyResult);

      const result = await repo.findInvoiceForConfirmationPage('missing');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // findInvoiceById
  // =========================================================================
  describe('findInvoiceById', () => {
    it('returns invoice by primary key', async () => {
      const mockRow = { id: 'inv-1', status: 'submitted' };
      mockedQuery.mockResolvedValue({ ...emptyResult, rows: [mockRow], rowCount: 1 });

      const result = await repo.findInvoiceById('inv-1');

      expect(result).toEqual(mockRow);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), ['inv-1']);
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue(emptyResult);

      const result = await repo.findInvoiceById('missing');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // findPendingConfirmations
  // =========================================================================
  describe('findPendingConfirmations', () => {
    it('returns paginated pending confirmations', async () => {
      mockedQuery
        .mockResolvedValueOnce({ ...emptyResult, rows: [{ count: '5' }] })
        .mockResolvedValueOnce({
          ...emptyResult,
          rows: [
            {
              id: 'inv-1',
              invoice_number: 'INV-001',
              face_value: '50000000',
              due_date: '2026-05-01',
              submitted_at: '2026-03-20T10:00:00Z',
              supplier_name: 'Supplier A',
              buyer_name: 'Buyer A',
              hours_since_submission: '24.5',
            },
          ],
        });

      const result = await repo.findPendingConfirmations({
        page: 1,
        limit: 20,
      });

      expect(result.total).toBe(5);
      expect(result.rows).toHaveLength(1);

      const [countSql] = mockedQuery.mock.calls[0];
      expect(countSql).toContain("status = 'submitted'");
      expect(countSql).toContain('buyer_confirmed_at IS NULL');

      const [dataSql, dataParams] = mockedQuery.mock.calls[1];
      expect(dataSql).toContain('JOIN suppliers');
      expect(dataSql).toContain('JOIN buyers');
      expect(dataSql).toContain('LIMIT $1 OFFSET $2');
      expect(dataParams).toEqual([20, 0]);
    });

    it('calculates offset correctly for page 2', async () => {
      mockedQuery
        .mockResolvedValueOnce({ ...emptyResult, rows: [{ count: '25' }] })
        .mockResolvedValueOnce({ ...emptyResult, rows: [] });

      await repo.findPendingConfirmations({ page: 2, limit: 10 });

      const [, dataParams] = mockedQuery.mock.calls[1];
      expect(dataParams).toEqual([10, 10]);
    });

    it('returns 0 total when count row is absent (??  null coalescing branch)', async () => {
      mockedQuery
        .mockResolvedValueOnce({ ...emptyResult, rows: [] })
        .mockResolvedValueOnce({ ...emptyResult, rows: [] });

      const result = await repo.findPendingConfirmations({ page: 1, limit: 10 });

      expect(result.total).toBe(0);
    });
  });

  // =========================================================================
  // findBuyerEncryptedContact
  // =========================================================================
  describe('findBuyerEncryptedContact', () => {
    it('returns encrypted contact details', async () => {
      const mockRow = {
        contact_email_encrypted: 'enc:email',
        contact_phone_encrypted: 'enc:phone',
        company_name: 'Buyer Ltd',
      };
      mockedQuery.mockResolvedValue({ ...emptyResult, rows: [mockRow], rowCount: 1 });

      const result = await repo.findBuyerEncryptedContact('buyer-1');

      expect(result).toEqual(mockRow);
    });

    it('returns null when buyer not found', async () => {
      mockedQuery.mockResolvedValue(emptyResult);

      const result = await repo.findBuyerEncryptedContact('missing');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // findInvoicesPendingReminder
  // =========================================================================
  describe('findInvoicesPendingReminder', () => {
    it('queries with correct time window parameters', async () => {
      mockedQuery.mockResolvedValue({ ...emptyResult, rows: [] });

      await repo.findInvoicesPendingReminder(24, 36);

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain("status = 'submitted'");
      expect(sql).toContain('buyer_confirmed_at IS NULL');
      expect(sql).toContain('MAKE_INTERVAL');
      expect(params).toEqual([24, 36]);
    });

    it('returns matching invoices', async () => {
      const mockRows = [
        {
          id: 'inv-1',
          buyer_id: 'b-1',
          invoice_number: 'INV-1',
          face_value: '10000000',
          created_at: '2026-03-19T10:00:00Z',
          contact_email_encrypted: 'enc:email',
        },
      ];
      mockedQuery.mockResolvedValue({ ...emptyResult, rows: mockRows });

      const result = await repo.findInvoicesPendingReminder(24, 36);

      expect(result).toEqual(mockRows);
    });
  });

  // =========================================================================
  // hasReminderBeenSent
  // =========================================================================
  describe('hasReminderBeenSent', () => {
    it('returns true when reminder exists in audit_logs', async () => {
      mockedQuery.mockResolvedValue({ ...emptyResult, rows: [{ count: '1' }] });

      const result = await repo.hasReminderBeenSent('inv-1', 'CONFIRMATION_REMINDER_T2');

      expect(result).toBe(true);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('audit_logs'), [
        'inv-1',
        'CONFIRMATION_REMINDER_T2',
      ]);
    });

    it('returns false when no reminder in audit_logs', async () => {
      mockedQuery.mockResolvedValue({ ...emptyResult, rows: [{ count: '0' }] });

      const result = await repo.hasReminderBeenSent('inv-1', 'CONFIRMATION_REMINDER_T2');

      expect(result).toBe(false);
    });

    it('returns false when rows is empty (??  null coalescing branch)', async () => {
      // rows[0] is undefined — triggers the ?? '0' fallback on line 215
      mockedQuery.mockResolvedValue({ ...emptyResult, rows: [] });

      const result = await repo.hasReminderBeenSent('inv-missing', 'SOME_ACTION');

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // createAuditEntry
  // =========================================================================
  describe('createAuditEntry', () => {
    it('inserts parameterised audit log entry', async () => {
      mockedQuery.mockResolvedValue({ ...emptyResult, command: 'INSERT', rowCount: 1 });

      await repo.createAuditEntry(
        'user-1',
        'BUYER_CONFIRMED',
        'invoices',
        'inv-1',
        { status: 'submitted' },
        { status: 'buyer_confirmed' },
        '127.0.0.1',
        'agent',
      );

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params).toHaveLength(8);
      expect(params[0]).toBe('user-1');
      expect(params[1]).toBe('BUYER_CONFIRMED');
      expect(params[4]).toBe(JSON.stringify({ status: 'submitted' }));
      expect(params[5]).toBe(JSON.stringify({ status: 'buyer_confirmed' }));
    });

    it('handles null old_values', async () => {
      mockedQuery.mockResolvedValue({ ...emptyResult, command: 'INSERT', rowCount: 1 });

      await repo.createAuditEntry(
        null,
        'TOKEN_GENERATED',
        'invoices',
        'inv-1',
        null,
        { buyerId: 'buyer-1' },
        'system',
        'system',
      );

      const [, params] = mockedQuery.mock.calls[0];
      expect(params[0]).toBeNull();
      expect(params[4]).toBeNull();
    });

    it('passes null for ipAddress and userAgent when omitted (??  null branches)', async () => {
      mockedQuery.mockResolvedValue({ ...emptyResult, command: 'INSERT', rowCount: 1 });

      await repo.createAuditEntry(
        'user-1',
        'TOKEN_GENERATED',
        'invoices',
        'inv-1',
        null,
        { buyerId: 'buyer-1' },
        // ipAddress and userAgent intentionally omitted
      );

      const [, params] = mockedQuery.mock.calls[0];
      expect(params[6]).toBeNull();
      expect(params[7]).toBeNull();
    });
  });

  // =========================================================================
  // getClient
  // =========================================================================
  describe('getClient', () => {
    it('acquires and returns a client from the pool', async () => {
      const fakeClient = { query: jest.fn(), release: jest.fn() };
      mockPoolConnect.mockResolvedValue(fakeClient);

      const client = await repo.getClient();

      expect(client).toBe(fakeClient);
      expect(mockPoolConnect).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // storeConfirmationTokenWithClient
  // =========================================================================
  describe('storeConfirmationTokenWithClient', () => {
    it('updates invoice using the provided transaction client', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.storeConfirmationTokenWithClient(
        mockClient as never,
        'inv-tx-1',
        'token-hash-xyz',
        '2026-03-30T00:00:00Z',
      );

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE invoices');
      expect(sql).toContain('confirmation_token_hash = $1');
      expect(params).toEqual(['token-hash-xyz', '2026-03-30T00:00:00Z', 'inv-tx-1']);
    });
  });

  // =========================================================================
  // confirmInvoiceWithClient
  // =========================================================================
  describe('confirmInvoiceWithClient', () => {
    it('updates status to buyer_confirmed using the transaction client', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      const count = await repo.confirmInvoiceWithClient(
        mockClient as never,
        'inv-tx-1',
        '10.0.0.1',
        'TestAgent/1.0',
      );

      expect(count).toBe(1);
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("status = 'buyer_confirmed'");
      expect(sql).toContain('buyer_confirmed_at IS NULL');
      expect(params).toEqual(['10.0.0.1', 'TestAgent/1.0', 'inv-tx-1']);
    });

    it('returns 0 when rowCount is null (??  0 branch)', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: null }) };

      const count = await repo.confirmInvoiceWithClient(
        mockClient as never,
        'inv-tx-already',
        '127.0.0.1',
        'agent',
      );

      expect(count).toBe(0);
    });

    it('returns 0 when already confirmed (rowCount 0 branch)', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };

      const count = await repo.confirmInvoiceWithClient(
        mockClient as never,
        'inv-tx-race',
        '127.0.0.1',
        'agent',
      );

      expect(count).toBe(0);
    });
  });

  // =========================================================================
  // createAuditEntryWithClient
  // =========================================================================
  describe('createAuditEntryWithClient', () => {
    it('inserts audit log using the provided transaction client', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createAuditEntryWithClient(
        mockClient as never,
        'user-1',
        'BUYER_CONFIRMED',
        'invoices',
        'inv-tx-1',
        { status: 'submitted' },
        { status: 'buyer_confirmed' },
        '10.0.0.1',
        'agent/1.0',
      );

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params).toContain('user-1');
      expect(params).toContain('BUYER_CONFIRMED');
      expect(params[4]).toBe(JSON.stringify({ status: 'submitted' }));
    });

    it('passes null for old_values when oldValues is null (branch coverage)', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createAuditEntryWithClient(
        mockClient as never,
        null,
        'TOKEN_GENERATED',
        'invoices',
        'inv-tx-1',
        null,
        { tokenGenerated: true },
      );

      const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBeNull();
      expect(params[4]).toBeNull();
    });

    it('passes null for ipAddress and userAgent when omitted (??  null branches)', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createAuditEntryWithClient(
        mockClient as never,
        'user-1',
        'TOKEN_GENERATED',
        'invoices',
        'inv-tx-1',
        null,
        { tokenGenerated: true },
        // ipAddress and userAgent intentionally omitted
      );

      const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(params[6]).toBeNull();
      expect(params[7]).toBeNull();
    });
  });
});
