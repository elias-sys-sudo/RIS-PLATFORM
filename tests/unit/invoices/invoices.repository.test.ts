import * as repo from '../../../src/services/invoices/invoices.repository';
import { query } from '../../../src/shared/database/pool';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('invoices repository', () => {
  describe('createInvoice', () => {
    it('inserts with status=submitted and 72hr SLA deadline', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createInvoice({
        id: 'inv-1',
        invoiceNumber: 'INV-001',
        supplierId: 'sup-1',
        buyerId: 'buyer-1',
        faceValue: '50000000',
        dueDate: '2026-05-01',
        description: 'Test',
        tenorDays: 45,
      });

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO invoices');
      expect(sql).toContain("'submitted'");
      expect(sql).toContain("INTERVAL '72 hours'");
      expect(sql).toContain('tenor_days');
      expect(sql).not.toContain("'inv-1'"); // no string interpolation
      expect(params).toHaveLength(8);
      expect(params[0]).toBe('inv-1');
      expect(params[4]).toBe('50000000');
      expect(params[7]).toBe(45);
    });
  });

  describe('findInvoiceById', () => {
    it('returns invoice when found', async () => {
      const mockRow = { id: 'inv-1', status: 'submitted' };
      mockedQuery.mockResolvedValue({
        rows: [mockRow],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findInvoiceById('inv-1');

      expect(result).toEqual(mockRow);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), ['inv-1']);
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findInvoiceById('missing');

      expect(result).toBeNull();
    });
  });

  describe('findInvoiceByNumberAndSupplier', () => {
    it('queries by invoice_number AND supplier_id', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await repo.findInvoiceByNumberAndSupplier('INV-001', 'sup-1');

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('invoice_number = $1 AND supplier_id = $2'),
        ['INV-001', 'sup-1'],
      );
    });
  });

  describe('findInvoicesBySupplier', () => {
    it('paginates supplier invoices', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '3' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'inv-1' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.findInvoicesBySupplier('sup-1', { page: 1, limit: 10 });

      expect(result.total).toBe(3);
      expect(result.rows).toHaveLength(1);
      expect(mockedQuery.mock.calls[0][1]).toContain('sup-1');
    });
  });

  describe('findAllInvoices', () => {
    it('applies status filter', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '5' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      await repo.findAllInvoices({ status: 'submitted' }, { page: 1, limit: 10 });

      const [countSql, countParams] = mockedQuery.mock.calls[0];
      expect(countSql).toContain('status = $1');
      expect(countParams).toContain('submitted');
    });

    it('applies buyer_id filter', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '2' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      await repo.findAllInvoices({ buyer_id: 'buyer-1' }, { page: 1, limit: 10 });

      const [countSql, countParams] = mockedQuery.mock.calls[0];
      expect(countSql).toContain('buyer_id = $1');
      expect(countParams).toContain('buyer-1');
    });

    it('applies date range filters', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '1' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      await repo.findAllInvoices(
        { date_from: '2026-01-01', date_to: '2026-12-31' },
        { page: 1, limit: 10 },
      );

      const [countSql] = mockedQuery.mock.calls[0];
      expect(countSql).toContain('created_at >= $1');
      expect(countSql).toContain('created_at <= $2');
    });

    it('works without filters', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '10' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const result = await repo.findAllInvoices({}, { page: 1, limit: 10 });

      expect(result.total).toBe(10);
      const [countSql] = mockedQuery.mock.calls[0];
      expect(countSql).not.toContain('WHERE');
    });

    it('handles an array of statuses via ANY($1::text[]) for the finance-manager view', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '7' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      const fmStatuses = ['approved', 'pending_first_auth', 'funded'];
      await repo.findAllInvoices({ status: fmStatuses }, { page: 1, limit: 10 });

      const [countSql, countParams] = mockedQuery.mock.calls[0];
      // Branch uses ANY(...::text[]) when the filter is an array
      expect(countSql).toContain('status = ANY($1::text[])');
      // Count query receives only the filter params (no limit/offset)
      expect(countParams).toEqual([fmStatuses]);

      // Data query is the second call — carries limit/offset as $2,$3
      const [dataSql, dataParams] = mockedQuery.mock.calls[1];
      expect(dataSql).toContain('status = ANY($1::text[])');
      expect(dataSql).toContain('LIMIT $2 OFFSET $3');
      expect(dataParams).toEqual([fmStatuses, 10, 0]);
    });
  });

  describe('updateInvoiceStatus', () => {
    it('updates status with parameterised query', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await repo.updateInvoiceStatus('inv-1', 'approved', 'scored');

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE invoices SET status = $1'),
        ['approved', 'inv-1', 'scored'],
      );
    });
  });

  describe('setAmlFlag', () => {
    it('sets aml_flagged on invoice', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await repo.setAmlFlag('inv-1', true);

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE invoices SET aml_flagged = $1'),
        [true, 'inv-1'],
      );
    });
  });

  describe('getInvoiceTimeline', () => {
    it('returns audit entries ordered by created_at ASC', async () => {
      const entries = [
        { id: 'a1', action: 'INVOICE_SUBMITTED' },
        { id: 'a2', action: 'VALIDATION_STEP' },
      ];
      mockedQuery.mockResolvedValue({
        rows: entries,
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getInvoiceTimeline('inv-1');

      expect(result).toEqual(entries);
      const [sql] = mockedQuery.mock.calls[0];
      expect(sql).toContain('ORDER BY created_at ASC');
      expect(sql).toContain('record_id = $1');
    });
  });

  describe('findBuyerWithLimits', () => {
    it('returns buyer with limit fields', async () => {
      const mockRow = {
        id: 'buyer-1',
        company_name: 'Buyer Co',
        is_active: true,
        approved_limit: '200000000',
        used_limit: '0',
      };
      mockedQuery.mockResolvedValue({
        rows: [mockRow],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findBuyerWithLimits('buyer-1');

      expect(result).toEqual(mockRow);
    });

    it('returns null when buyer not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findBuyerWithLimits('missing');

      expect(result).toBeNull();
    });
  });

  describe('findSupplierByUserId', () => {
    it('returns supplier id and kyc_status', async () => {
      const mockRow = { id: 'sup-1', kyc_status: 'approved' };
      mockedQuery.mockResolvedValue({
        rows: [mockRow],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findSupplierByUserId('user-1');

      expect(result).toEqual(mockRow);
    });
  });

  describe('findSupplierById', () => {
    it('returns supplier with user_id for ownership check', async () => {
      const mockRow = { id: 'sup-1', user_id: 'user-1', kyc_status: 'approved' };
      mockedQuery.mockResolvedValue({
        rows: [mockRow],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findSupplierById('sup-1');

      expect(result).toEqual(mockRow);
    });
  });

  describe('createAuditEntry', () => {
    it('inserts audit log with JSON-serialised values', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createAuditEntry(
        'user-1',
        'INVOICE_SUBMITTED',
        'invoices',
        'inv-1',
        null,
        { status: 'submitted' },
        '127.0.0.1',
        'test-agent',
      );

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params[4]).toBeNull(); // old_values
      expect(params[5]).toBe(JSON.stringify({ status: 'submitted' }));
    });

    it('serialises old_values when provided', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createAuditEntry(
        'user-1',
        'STATUS_CHANGED',
        'invoices',
        'inv-1',
        { previousStatus: 'submitted' },
        { newStatus: 'approved' },
        '127.0.0.1',
        'test-agent',
      );

      const [, params] = mockedQuery.mock.calls[0];
      expect(params[4]).toBe(JSON.stringify({ previousStatus: 'submitted' }));
    });
  });
});
