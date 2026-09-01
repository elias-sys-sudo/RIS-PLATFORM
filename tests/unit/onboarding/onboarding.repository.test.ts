const mockPoolConnect = jest.fn();

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: {
    connect: mockPoolConnect,
  },
}));

import * as repo from '../../../src/services/onboarding/onboarding.repository';
import { query } from '../../../src/shared/database/pool';

const mockedQuery = query as jest.MockedFunction<typeof query>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('onboarding repository', () => {
  describe('createSupplier', () => {
    it('executes parameterised INSERT with correct values', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createSupplier({
        id: 'sup-1',
        userId: 'user-1',
        companyNameEncrypted: 'enc:Test Co',
        registrationNumber: 'REG-1',
        taxIdEncrypted: 'enc:TAX-1',
        directorsEncrypted: 'enc:directors-json',
        bankName: 'Bank',
        bankAccountNumberEncrypted: 'enc:acc',
        bankAccountNameEncrypted: 'enc:name',
        bankBranch: 'Main',
        preferredPaymentMethod: 'EFT',
        mobileMoneyNumberEncrypted: null,
      });

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO suppliers');
      expect(sql).toContain('$1');
      expect(sql).not.toContain("'sup-1'"); // no string interpolation
      expect(params).toHaveLength(12);
      expect(params[0]).toBe('sup-1');
    });
  });

  describe('findSupplierById', () => {
    it('returns supplier record when found', async () => {
      const mockRow = { id: 'sup-1', company_name: 'Test' };
      mockedQuery.mockResolvedValue({
        rows: [mockRow],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findSupplierById('sup-1');

      expect(result).toEqual(mockRow);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM suppliers WHERE id = $1'),
        ['sup-1'],
      );
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findSupplierById('missing');

      expect(result).toBeNull();
    });
  });

  describe('emailExists', () => {
    it('returns true when email exists', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ count: '1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const exists = await repo.emailExists('test@test.com');

      expect(exists).toBe(true);
    });

    it('returns false when email does not exist', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ count: '0' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const exists = await repo.emailExists('new@test.com');

      expect(exists).toBe(false);
    });

    it('returns false when rows is empty (??  null coalescing branch)', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const exists = await repo.emailExists('ghost@test.com');

      expect(exists).toBe(false);
    });
  });

  describe('createAuditEntry', () => {
    it('writes audit log with all fields parameterised', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createAuditEntry(
        'user-1',
        'SUPPLIER_REGISTERED',
        'suppliers',
        'sup-1',
        null,
        { kycStatus: 'pending' },
        '127.0.0.1',
        'test-agent',
      );

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params).toHaveLength(8);
      expect(params[1]).toBe('SUPPLIER_REGISTERED');
    });
  });

  describe('updateKycStatus', () => {
    it('uses parameterised update', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await repo.updateKycStatus('sup-1', 'approved');

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE suppliers SET kyc_status = $1 WHERE id = $2'),
        ['approved', 'sup-1'],
      );
    });
  });

  describe('createBuyer', () => {
    it('inserts buyer with used_limit=0 and is_active=true', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createBuyer({
        id: 'buyer-1',
        companyName: 'Buyer Co',
        registrationNumber: 'BREG-1',
        creditRating: 'A',
        approvedLimit: '100000000',
        paymentScore: 85,
        contactEmailEncrypted: 'enc:email',
        contactPhoneEncrypted: 'enc:phone',
        risMarginRate: 0.03,
        paymentUndertakingSigned: false,
        paymentUndertakingDate: null,
        createdBy: 'officer-1',
      });

      const [sql] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO buyers');
      expect(sql).toContain('used_limit');
      // Verify used_limit is hardcoded to 0 in the SQL
      expect(sql).toMatch(/VALUES.*0/);
    });
  });

  describe('updateBuyer', () => {
    it('builds dynamic SET clause with parameterised values', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await repo.updateBuyer('buyer-1', {
        credit_rating: 'B',
        payment_score: 90,
      });

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('UPDATE buyers SET');
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('$3'); // id param
      expect(params).toContain('B');
      expect(params).toContain(90);
      expect(params).toContain('buyer-1');
    });

    it('does nothing when no fields provided', async () => {
      await repo.updateBuyer('buyer-1', {});

      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('skips non-allowlisted columns and does nothing when all are disallowed', async () => {
      // All keys are outside the allowlist — the continue branch fires for every entry
      // and setClauses stays empty, triggering the early return
      await repo.updateBuyer('buyer-1', {
        internal_field: 'evil',
        id: 'override-id',
        user_id: 'hack',
      });

      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('skips non-allowlisted columns but still updates the valid ones', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await repo.updateBuyer('buyer-1', {
        credit_rating: 'A',
        internal_field: 'ignored', // triggers continue
        payment_score: 95,
      });

      // Only credit_rating and payment_score should appear in the query
      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('credit_rating');
      expect(sql).toContain('payment_score');
      expect(params).toContain('A');
      expect(params).toContain(95);
      // internal_field must not be present
      expect(sql).not.toContain('internal_field');
    });
  });

  describe('listSuppliers', () => {
    it('paginates correctly with filter', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '5' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'sup-1' }, { id: 'sup-2' }],
          rowCount: 2,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.listSuppliers({ page: 2, limit: 2 }, 'approved');

      expect(result.total).toBe(5);
      expect(result.rows).toHaveLength(2);

      // Count query includes filter
      const [countSql, countParams] = mockedQuery.mock.calls[0];
      expect(countSql).toContain('kyc_status = $1');
      expect(countParams).toContain('approved');

      // Data query includes offset
      const [dataSql, dataParams] = mockedQuery.mock.calls[1];
      expect(dataSql).toContain('LIMIT');
      expect(dataSql).toContain('OFFSET');
      expect(dataParams).toContain(2); // offset = (2-1) * 2
    });

    it('paginates without filter', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '3' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'sup-1' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.listSuppliers({ page: 1, limit: 10 });

      expect(result.total).toBe(3);
      const [countSql] = mockedQuery.mock.calls[0];
      expect(countSql).not.toContain('WHERE');
    });

    it('returns 0 total when count row is missing (null coalescing branch)', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.listSuppliers({ page: 1, limit: 10 });

      expect(result.total).toBe(0);
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('findSupplierByUserId', () => {
    it('returns supplier by user_id', async () => {
      const mockRow = { id: 'sup-1', user_id: 'user-1' };
      mockedQuery.mockResolvedValue({
        rows: [mockRow],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findSupplierByUserId('user-1');

      expect(result).toEqual(mockRow);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), [
        'user-1',
      ]);
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findSupplierByUserId('missing');

      expect(result).toBeNull();
    });
  });

  describe('setSanctionsFlag', () => {
    it('updates sanctions_flag on supplier', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await repo.setSanctionsFlag('sup-1', true);

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE suppliers SET sanctions_flag = $1'),
        [true, 'sup-1'],
      );
    });
  });

  describe('setBuyerSanctionsFlag', () => {
    it('updates sanctions_flag on buyer', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await repo.setBuyerSanctionsFlag('buyer-1', true);

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE buyers SET sanctions_flag = $1'),
        [true, 'buyer-1'],
      );
    });
  });

  describe('createDocument', () => {
    it('inserts document with parameterised query', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createDocument({
        id: 'doc-1',
        invoiceId: null,
        supplierId: 'sup-1',
        documentType: 'certificate_of_incorporation',
        encryptedPath: 'doc-1.enc',
        fileHash: 'sha256-hash',
        fileSizeBytes: 5000,
        mimeType: 'application/pdf',
        uploadedBy: 'user-1',
      });

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO invoice_documents');
      expect(params).toHaveLength(9);
      expect(params[0]).toBe('doc-1');
    });
  });

  describe('findDocumentsBySupplierId', () => {
    it('returns documents ordered by created_at DESC', async () => {
      const docs = [{ id: 'doc-2' }, { id: 'doc-1' }];
      mockedQuery.mockResolvedValue({
        rows: docs,
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findDocumentsBySupplierId('sup-1');

      expect(result).toEqual(docs);
      const [sql] = mockedQuery.mock.calls[0];
      expect(sql).toContain('ORDER BY created_at DESC');
    });
  });

  describe('getDocumentTypeCounts', () => {
    it('returns distinct document types', async () => {
      mockedQuery.mockResolvedValue({
        rows: [
          { document_type: 'certificate_of_incorporation' },
          { document_type: 'tax_registration' },
        ],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getDocumentTypeCounts('sup-1');

      expect(result).toEqual(['certificate_of_incorporation', 'tax_registration']);
    });
  });

  describe('findBuyerById', () => {
    it('returns buyer when found', async () => {
      const mockRow = { id: 'buyer-1', company_name: 'Buyer Co' };
      mockedQuery.mockResolvedValue({
        rows: [mockRow],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findBuyerById('buyer-1');

      expect(result).toEqual(mockRow);
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findBuyerById('missing');

      expect(result).toBeNull();
    });
  });

  describe('listBuyers', () => {
    it('paginates correctly', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '10' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'b-1' }, { id: 'b-2' }],
          rowCount: 2,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.listBuyers({ page: 1, limit: 2 });

      expect(result.total).toBe(10);
      expect(result.rows).toHaveLength(2);
    });

    it('returns 0 total when count row is missing (null coalescing branch)', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.listBuyers({ page: 1, limit: 10 });

      expect(result.total).toBe(0);
    });
  });

  describe('createUser', () => {
    it('inserts user with parameterised query', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createUser({
        id: 'user-1',
        email: 'test@test.com',
        passwordHash: 'hashed',
        role: 'supplier',
      });

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO users');
      expect(params).toHaveLength(4);
    });
  });

  describe('registrationNumberExists', () => {
    it('returns true when exists', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ count: '1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const exists = await repo.registrationNumberExists('REG-001');

      expect(exists).toBe(true);
    });

    it('returns false when not exists', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ count: '0' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const exists = await repo.registrationNumberExists('REG-NEW');

      expect(exists).toBe(false);
    });

    it('returns false when rows is empty (??  null coalescing branch)', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const exists = await repo.registrationNumberExists('REG-GHOST');

      expect(exists).toBe(false);
    });
  });

  describe('buyerRegistrationNumberExists', () => {
    it('returns true when exists', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ count: '1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const exists = await repo.buyerRegistrationNumberExists('BREG-001');

      expect(exists).toBe(true);
    });

    it('returns false when not exists', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ count: '0' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const exists = await repo.buyerRegistrationNumberExists('BREG-NEW');

      expect(exists).toBe(false);
    });

    it('returns false when rows is empty (??  null coalescing branch)', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const exists = await repo.buyerRegistrationNumberExists('BREG-GHOST');

      expect(exists).toBe(false);
    });
  });

  describe('createAuditEntry with old_values', () => {
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
        'KYC_STATUS_CHANGED',
        'suppliers',
        'sup-1',
        { previousStatus: 'pending' },
        { newStatus: 'approved' },
        '127.0.0.1',
        'test-agent',
      );

      const [, params] = mockedQuery.mock.calls[0];
      // old_values should be JSON stringified
      expect(params[4]).toBe(JSON.stringify({ previousStatus: 'pending' }));
    });

    it('passes null for ipAddress and userAgent when omitted (??  null branches lines 389-390)', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createAuditEntry(
        'user-1',
        'SUPPLIER_REGISTERED',
        'suppliers',
        'sup-1',
        null,
        { id: 'sup-1' },
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
  // createUserWithClient
  // =========================================================================
  describe('createUserWithClient', () => {
    it('inserts user using the provided transaction client', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createUserWithClient(mockClient as never, {
        id: 'user-tx-1',
        email: 'tx@test.com',
        passwordHash: 'hashed',
        role: 'supplier',
      });

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO users');
      expect(params).toContain('user-tx-1');
      expect(params).toContain('tx@test.com');
      expect(params).toContain('supplier');
    });
  });

  // =========================================================================
  // createSupplierWithClient
  // =========================================================================
  describe('createSupplierWithClient', () => {
    it('inserts supplier using the provided transaction client', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createSupplierWithClient(mockClient as never, {
        id: 'sup-tx-1',
        userId: 'user-tx-1',
        companyName: 'TX Co Ltd',
        companyNameEncrypted: 'enc:TX Co Ltd',
        registrationNumber: 'REG-TX-1',
        taxIdEncrypted: 'enc:TAX-TX-1',
        directorsEncrypted: 'enc:directors-json',
        bankName: 'Stanbic',
        bankAccountNumberEncrypted: 'enc:acc-tx',
        bankAccountNameEncrypted: 'enc:name-tx',
        bankBranch: 'Kampala',
        preferredPaymentMethod: 'EFT',
        mobileMoneyNumberEncrypted: null,
        eligibilitySessionToken: '00000000-0000-0000-0000-000000000099',
        consentUrsbCheck: true,
        consentSupplierRefs: true,
        consentLitigationCheck: true,
        requiredFinancingAmount: null,
      });

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO suppliers');
      // 19 params after adding plaintext company_name alongside the encrypted column.
      expect(params).toHaveLength(19);
      expect(params[0]).toBe('sup-tx-1');
      // params[2] = plaintext company_name; params[3] = encrypted.
      expect(params[2]).toBe('TX Co Ltd');
      expect(params[3]).toBe('enc:TX Co Ltd');
    });

    it('handles null mobileMoneyNumberEncrypted', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createSupplierWithClient(mockClient as never, {
        id: 'sup-tx-2',
        userId: 'user-tx-2',
        companyName: 'TX Co 2',
        companyNameEncrypted: 'enc:TX Co 2',
        registrationNumber: 'REG-TX-2',
        taxIdEncrypted: 'enc:TAX-TX-2',
        directorsEncrypted: 'enc:empty-directors',
        bankName: 'DFCU',
        bankAccountNumberEncrypted: 'enc:acc',
        bankAccountNameEncrypted: 'enc:name',
        bankBranch: 'Entebbe',
        preferredPaymentMethod: 'EFT',
        mobileMoneyNumberEncrypted: null,
        eligibilitySessionToken: '00000000-0000-0000-0000-000000000098',
        consentUrsbCheck: true,
        consentSupplierRefs: true,
        consentLitigationCheck: true,
        requiredFinancingAmount: null,
      });

      const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      // mobileMoneyNumberEncrypted shifted from position 11 to 12 after the
      // plaintext company_name was inserted at position 2.
      expect(params[12]).toBeNull();
    });
  });

  // =========================================================================
  // updateKycStatusWithClient
  // =========================================================================
  describe('updateKycStatusWithClient', () => {
    it('updates KYC status using the provided transaction client', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.updateKycStatusWithClient(mockClient as never, 'sup-1', 'approved');

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE suppliers SET kyc_status = $1 WHERE id = $2');
      expect(params).toEqual(['approved', 'sup-1']);
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
        'SUPPLIER_KYC_APPROVED',
        'suppliers',
        'sup-1',
        { kyc_status: 'pending' },
        { kyc_status: 'approved' },
        '10.0.0.1',
        'TestAgent/1.0',
      );

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params).toContain('user-1');
      expect(params).toContain('SUPPLIER_KYC_APPROVED');
      // old_values should be serialised
      expect(params[4]).toBe(JSON.stringify({ kyc_status: 'pending' }));
    });

    it('passes null for old_values when oldValues is null (branch coverage)', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createAuditEntryWithClient(
        mockClient as never,
        null,
        'SUPPLIER_CREATED',
        'suppliers',
        'sup-1',
        null,
        { id: 'sup-1' },
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
        'TEST_ACTION',
        'suppliers',
        'sup-1',
        null,
        { key: 'val' },
        // ipAddress and userAgent intentionally omitted
      );

      const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
      // ipAddress ($7) and userAgent ($8) should fall through to null
      expect(params[6]).toBeNull();
      expect(params[7]).toBeNull();
    });
  });

  // =========================================================================
  // Eligibility pre-qualification
  // =========================================================================
  describe('createEligibilityCheck', () => {
    it('inserts eligibility check with parameterised query', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createEligibilityCheck({
        id: 'elig-1',
        sessionToken: 'token-1',
        registeredCompany: true,
        authorizedPerson: true,
        yearsInBusiness: 3,
        passed: true,
        ipAddress: '127.0.0.1',
        email: 'applicant@example.com',
        fundingRequirement: 50000000,
      });

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO eligibility_checks');
      expect(params).toHaveLength(9);
      expect(params[0]).toBe('elig-1');
      expect(params[1]).toBe('token-1');
      expect(params[7]).toBe('applicant@example.com');
    });
  });

  describe('findEligibilityByToken', () => {
    it('returns record when found', async () => {
      const mockRow = { id: 'elig-1', session_token: 'token-1', passed: true };
      mockedQuery.mockResolvedValue({
        rows: [mockRow],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findEligibilityByToken('token-1');

      expect(result).toEqual(mockRow);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE session_token = $1'),
        ['token-1'],
      );
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findEligibilityByToken('missing-token');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // WithClient transaction functions
  // =========================================================================
  describe('setUrsbVerifiedWithClient', () => {
    it('updates supplier URSB verification via client', async () => {
      const mc = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.setUrsbVerifiedWithClient(mc as never, 'sup-1', true, 'reviewer-1');

      const [sql, params] = mc.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE suppliers');
      expect(sql).toContain('ursb_verified = $1');
      expect(params).toContain(true);
      expect(params).toContain('reviewer-1');
      expect(params).toContain('sup-1');
    });
  });

  describe('setLitigationCheckWithClient', () => {
    it('updates supplier litigation check via client', async () => {
      const mc = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.setLitigationCheckWithClient(mc as never, 'sup-1', false, 'checker-1');

      const [sql, params] = mc.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE suppliers');
      expect(sql).toContain('litigation_flag = $2');
      expect(params).toContain('checker-1');
      expect(params).toContain(false);
    });
  });

  describe('setKycReviewerWithClient', () => {
    it('sets kyc_reviewer_id on supplier', async () => {
      const mc = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.setKycReviewerWithClient(mc as never, 'sup-1', 'reviewer-1');

      const [sql, params] = mc.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('kyc_reviewer_id = $1');
      expect(params[0]).toBe('reviewer-1');
      expect(params[1]).toBe('sup-1');
    });
  });

  describe('setKycApproverWithClient', () => {
    it('sets kyc_approver_id on supplier', async () => {
      const mc = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.setKycApproverWithClient(mc as never, 'sup-1', 'approver-1');

      const [sql, params] = mc.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('kyc_approver_id = $1');
      expect(params[0]).toBe('approver-1');
      expect(params[1]).toBe('sup-1');
    });
  });

  describe('getKycReviewer', () => {
    it('returns reviewer ID when found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ kyc_reviewer_id: 'reviewer-1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getKycReviewer('sup-1');

      expect(result).toBe('reviewer-1');
    });

    it('returns null when reviewer not set', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ kyc_reviewer_id: null }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getKycReviewer('sup-1');

      expect(result).toBeNull();
    });

    it('returns null when no rows returned', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getKycReviewer('missing');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Buyer onboarding request queries
  // =========================================================================
  describe('createBuyerOnboardingRequest', () => {
    it('inserts buyer request with parameterised query', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createBuyerOnboardingRequest({
        id: 'req-1',
        supplierId: 'sup-1',
        companyName: 'Buyer Co',
        registrationNumber: 'BREG-1',
        contactNameEncrypted: 'enc:name',
        contactEmailEncrypted: 'enc:email',
        contactPhoneEncrypted: 'enc:phone',
        reason: 'Need buyer',
      });

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO buyer_onboarding_requests');
      expect(params).toHaveLength(8);
    });
  });

  describe('createBuyerOnboardingRequestWithClient', () => {
    it('inserts buyer request via client', async () => {
      const mc = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createBuyerOnboardingRequestWithClient(mc as never, {
        id: 'req-1',
        supplierId: 'sup-1',
        companyName: 'Buyer Co',
        registrationNumber: null,
        contactNameEncrypted: null,
        contactEmailEncrypted: null,
        contactPhoneEncrypted: null,
        reason: 'Need buyer',
      });

      const [sql, params] = mc.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO buyer_onboarding_requests');
      expect(params).toHaveLength(8);
    });
  });

  describe('listBuyerOnboardingRequests', () => {
    it('lists requests with status filter', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '5' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'req-1' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.listBuyerOnboardingRequests({
        page: 1,
        limit: 10,
        status: 'pending',
      });

      expect(result.total).toBe(5);
      expect(result.rows).toHaveLength(1);
      const [countSql] = mockedQuery.mock.calls[0];
      expect(countSql).toContain('status = $1');
    });

    it('lists requests without status filter', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '3' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.listBuyerOnboardingRequests({ page: 1, limit: 10 });

      expect(result.total).toBe(3);
    });
  });

  describe('listBuyerOnboardingRequestsBySupplier', () => {
    it('lists requests for a specific supplier', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '2' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'req-1' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.listBuyerOnboardingRequestsBySupplier('sup-1', {
        page: 1,
        limit: 10,
      });

      expect(result.total).toBe(2);
      const [countSql, countParams] = mockedQuery.mock.calls[0];
      expect(countSql).toContain('supplier_id = $1');
      expect(countParams).toContain('sup-1');
    });
  });

  describe('getBuyerOnboardingRequestById', () => {
    it('returns request when found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ id: 'req-1', status: 'pending' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getBuyerOnboardingRequestById('req-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('req-1');
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getBuyerOnboardingRequestById('missing');

      expect(result).toBeNull();
    });
  });

  describe('getBuyerOnboardingRequestByIdForSupplier', () => {
    it('returns request when found with supplier ownership', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ id: 'req-1', supplier_id: 'sup-1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getBuyerOnboardingRequestByIdForSupplier('req-1', 'sup-1');

      expect(result).toBeDefined();
      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('supplier_id = $2');
      expect(params).toContain('sup-1');
    });

    it('returns null when supplier does not own the request', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getBuyerOnboardingRequestByIdForSupplier('req-1', 'wrong-sup');

      expect(result).toBeNull();
    });
  });

  describe('updateBuyerRequestStatusWithClient', () => {
    it('updates status via client with all fields', async () => {
      const mc = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.updateBuyerRequestStatusWithClient(
        mc as never,
        'req-1',
        'approved',
        'officer-1',
        'Looks good',
        'buyer-linked-1',
      );

      const [sql, params] = mc.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE buyer_onboarding_requests');
      expect(params).toContain('approved');
      expect(params).toContain('officer-1');
      expect(params).toContain('Looks good');
      expect(params).toContain('buyer-linked-1');
    });
  });

  // =========================================================================
  // UBO queries
  // =========================================================================
  describe('createUboWithClient', () => {
    it('inserts beneficial owner via client', async () => {
      const mc = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

      await repo.createUboWithClient(mc as never, 'sup-1', 'ubo-1', {
        fullNameEncrypted: 'enc:name',
        nationality: 'UG',
        idType: 'national_id',
        idNumberEncrypted: 'enc:id',
        ownershipPercentage: 50,
        isPep: false,
      });

      const [sql, params] = mc.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO beneficial_owners');
      expect(params).toHaveLength(8);
      expect(params[0]).toBe('ubo-1');
      expect(params[1]).toBe('sup-1');
    });
  });

  describe('getUbosBySupplier', () => {
    it('returns UBOs for a supplier', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ id: 'ubo-1', supplier_id: 'sup-1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getUbosBySupplier('sup-1');

      expect(result).toHaveLength(1);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE supplier_id = $1'), [
        'sup-1',
      ]);
    });
  });

  describe('updateUboWithClient', () => {
    it('returns rowCount after update', async () => {
      const mc = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      };

      const result = await repo.updateUboWithClient(mc as never, 'ubo-1', 'sup-1', {
        fullNameEncrypted: 'enc:updated',
        nationality: 'UG',
        idType: 'passport',
        idNumberEncrypted: 'enc:newid',
        ownershipPercentage: 60,
        isPep: true,
      });

      expect(result).toBe(1);
      const [sql] = mc.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE beneficial_owners');
      expect(sql).toContain('WHERE id = $7 AND supplier_id = $8');
    });

    it('returns 0 when rowCount is null', async () => {
      const mc = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: null }),
      };

      const result = await repo.updateUboWithClient(mc as never, 'ubo-1', 'sup-1', {
        fullNameEncrypted: 'enc:name',
        nationality: 'UG',
        idType: 'national_id',
        idNumberEncrypted: 'enc:id',
        ownershipPercentage: 50,
        isPep: false,
      });

      expect(result).toBe(0);
    });
  });

  describe('deleteUboWithClient', () => {
    it('returns rowCount after delete', async () => {
      const mc = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      };

      const result = await repo.deleteUboWithClient(mc as never, 'ubo-1', 'sup-1');

      expect(result).toBe(1);
      const [sql, params] = mc.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM beneficial_owners');
      expect(params).toContain('ubo-1');
      expect(params).toContain('sup-1');
    });

    it('returns 0 when rowCount is null', async () => {
      const mc = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: null }),
      };

      const result = await repo.deleteUboWithClient(mc as never, 'ubo-1', 'sup-1');

      expect(result).toBe(0);
    });
  });

  // =========================================================================
  // KYC Renewal queries
  // =========================================================================
  describe('getSuppliersWithExpiredKyc', () => {
    it('returns suppliers with expired KYC', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ id: 'sup-1', kyc_status: 'approved' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.getSuppliersWithExpiredKyc();

      expect(result).toHaveLength(1);
      const [sql] = mockedQuery.mock.calls[0];
      expect(sql).toContain('kyc_renewal_due_at < NOW()');
    });
  });

  describe('updateKycRenewalDate', () => {
    it('updates renewal date for supplier', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await repo.updateKycRenewalDate('sup-1', '2027-03-20');

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE suppliers SET kyc_renewal_due_at = $1'),
        ['2027-03-20', 'sup-1'],
      );
    });
  });

  // =========================================================================
  // PEP designation queries
  // =========================================================================
  describe('setPepDesignation', () => {
    it('sets PEP designation on supplier', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await repo.setPepDesignation('sup-1', true);

      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('pep_designation = $1'), [
        true,
        'sup-1',
      ]);
    });
  });

  describe('setBuyerPepDesignation', () => {
    it('sets PEP designation on buyer', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await repo.setBuyerPepDesignation('buyer-1', true);

      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('pep_designation = $1'), [
        true,
        'buyer-1',
      ]);
    });
  });

  // =========================================================================
  // Buyer queries — additional branches
  // =========================================================================
  describe('findBuyerById', () => {
    it('returns buyer when found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ id: 'buyer-1', company_name: 'Test Buyer' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findBuyerById('buyer-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('buyer-1');
    });

    it('returns null when not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.findBuyerById('missing');

      expect(result).toBeNull();
    });
  });

  describe('listBuyers', () => {
    it('paginates buyers correctly', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: '10' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'buyer-1' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.listBuyers({ page: 2, limit: 5 });

      expect(result.total).toBe(10);
      expect(result.rows).toHaveLength(1);
    });

    it('returns 0 total when count row is empty (null coalescing branch)', async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await repo.listBuyers({ page: 1, limit: 10 });

      expect(result.total).toBe(0);
    });
  });

  describe('registrationNumberExists', () => {
    it('returns true when registration number exists', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ count: '1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.registrationNumberExists('REG-1');

      expect(result).toBe(true);
    });

    it('returns false when not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ count: '0' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.registrationNumberExists('REG-NEW');

      expect(result).toBe(false);
    });

    it('returns false when rows empty (null coalescing)', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.registrationNumberExists('REG-X');

      expect(result).toBe(false);
    });
  });

  describe('buyerRegistrationNumberExists', () => {
    it('returns true when buyer registration number exists', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ count: '1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.buyerRegistrationNumberExists('BREG-1');

      expect(result).toBe(true);
    });

    it('returns false when not found', async () => {
      mockedQuery.mockResolvedValue({
        rows: [{ count: '0' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.buyerRegistrationNumberExists('BREG-NEW');

      expect(result).toBe(false);
    });

    it('returns false when rows empty (null coalescing)', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await repo.buyerRegistrationNumberExists('BREG-X');

      expect(result).toBe(false);
    });
  });

  describe('createUser', () => {
    it('inserts user with parameterised query', async () => {
      mockedQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await repo.createUser({
        id: 'user-1',
        email: 'test@test.com',
        passwordHash: 'hashed',
        role: 'supplier',
      });

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO users');
      expect(params).toHaveLength(4);
    });
  });

  describe('createAuditEntry — oldValues non-null branch', () => {
    it('serialises oldValues when not null', async () => {
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
        'suppliers',
        'sup-1',
        { previousStatus: 'pending' },
        { newStatus: 'approved' },
        '127.0.0.1',
        'test-agent',
      );

      const [, params] = mockedQuery.mock.calls[0];
      // oldValues param should be JSON-stringified
      expect(params[4]).toBe('{"previousStatus":"pending"}');
    });
  });

  describe('getClient', () => {
    it('returns a pool client', async () => {
      const fakeClient = { query: jest.fn(), release: jest.fn() };
      mockPoolConnect.mockResolvedValue(fakeClient);

      const client = await repo.getClient();

      expect(client).toBe(fakeClient);
      expect(mockPoolConnect).toHaveBeenCalled();
    });
  });
});
