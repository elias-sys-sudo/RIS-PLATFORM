process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.AML_FLAG_THRESHOLD_UGX = '100000000';

import * as service from '../../../src/services/compliance/aml-clearance.service';
import * as repo from '../../../src/services/compliance/aml-clearance.repository';
import { pool } from '../../../src/shared/database/pool';
import { BusinessRuleError, NotFoundError } from '../../../src/shared/errors';
import { ComplianceErrorCode } from '../../../src/services/compliance/aml-clearance.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/services/compliance/aml-clearance.repository');

jest.mock('../../../src/shared/crypto', () => ({
  encrypt: jest.fn((v: string) => `encrypted_${v}`),
  decrypt: jest.fn((v: string) => v.replace('encrypted_', '')),
}));

jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    audit: jest.fn(),
  },
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedPool = pool as jest.Mocked<typeof pool>;

function buildMockClient() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
}

const INVOICE_ID = '11111111-1111-1111-1111-111111111111';
const OFFICER_ID = '22222222-2222-2222-2222-222222222222';
const VALID_INPUT = {
  reason: 'Sanctions screening complete; trade pattern consistent.',
  sanctions_check_complete: true as const,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('aml-clearance.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // clearInvoice — happy path
  // =========================================================================
  describe('clearInvoice (happy path)', () => {
    it('writes the three columns inside a transaction and audits with no PII', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: INVOICE_ID,
        aml_flagged: true,
        aml_cleared_at: null,
      });
      mockedRepo.applyAmlClearanceWithClient.mockResolvedValue({
        aml_cleared_at: '2026-04-30T12:00:00Z',
      });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      const result = await service.clearInvoice(
        INVOICE_ID,
        OFFICER_ID,
        VALID_INPUT,
        '10.0.0.1',
        'TestAgent/1.0',
      );

      expect(result).toEqual({
        invoice_id: INVOICE_ID,
        aml_cleared_at: '2026-04-30T12:00:00Z',
        aml_cleared_by: OFFICER_ID,
      });
      expect(mockedRepo.applyAmlClearanceWithClient).toHaveBeenCalledWith(
        mockClient,
        INVOICE_ID,
        OFFICER_ID,
        VALID_INPUT.reason,
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('REFINEMENT 2 — audit metadata snapshot does NOT contain `reason`', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: INVOICE_ID,
        aml_flagged: true,
        aml_cleared_at: null,
      });
      mockedRepo.applyAmlClearanceWithClient.mockResolvedValue({
        aml_cleared_at: '2026-04-30T12:00:00Z',
      });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      await service.clearInvoice(INVOICE_ID, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0');

      const auditCall = mockedRepo.createAuditEntryWithClient.mock.calls[0];
      const newValues = auditCall[6] as Record<string, unknown>;

      // Allowlist: invoice_id, officer_id, threshold, sanctions_check_complete
      expect(newValues).toEqual({
        invoice_id: INVOICE_ID,
        officer_id: OFFICER_ID,
        threshold: '100000000',
        sanctions_check_complete: true,
      });
      expect(newValues).not.toHaveProperty('reason');
      expect(newValues).not.toHaveProperty('aml_clearance_reason');
      // Snapshot guard against future drift
      expect(Object.keys(newValues).sort()).toMatchInlineSnapshot(`
        [
          "invoice_id",
          "officer_id",
          "sanctions_check_complete",
          "threshold",
        ]
      `);
    });

    it('queues a notify-finance-manager-aml-cleared job after commit', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: INVOICE_ID,
        aml_flagged: true,
        aml_cleared_at: null,
      });
      mockedRepo.applyAmlClearanceWithClient.mockResolvedValue({
        aml_cleared_at: '2026-04-30T12:00:00Z',
      });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
      service.setNotificationQueue(mockQueue as never);

      await service.clearInvoice(INVOICE_ID, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0');

      expect(mockQueue.add).toHaveBeenCalledWith(
        'notify-finance-manager-aml-cleared',
        expect.objectContaining({ invoiceId: INVOICE_ID }),
        expect.objectContaining({ attempts: 3 }),
      );

      // Reset
      service.setNotificationQueue(null as never);
    });
  });

  // =========================================================================
  // REFINEMENT 3 — re-clearance rejection
  // =========================================================================
  describe('REFINEMENT 3 — reject re-clearance', () => {
    it('throws AML_ALREADY_CLEARED when aml_cleared_at is already set', async () => {
      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: INVOICE_ID,
        aml_flagged: true,
        aml_cleared_at: '2026-04-29T10:00:00Z',
      });

      await expect(
        service.clearInvoice(INVOICE_ID, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0'),
      ).rejects.toMatchObject({
        errorCode: ComplianceErrorCode.AML_ALREADY_CLEARED,
      });
      expect(mockedRepo.applyAmlClearanceWithClient).not.toHaveBeenCalled();
    });

    it('throws AML_ALREADY_CLEARED when concurrent UPDATE returns 0 rows', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: INVOICE_ID,
        aml_flagged: true,
        aml_cleared_at: null,
      });
      // Simulate: between SELECT and UPDATE another officer already cleared.
      mockedRepo.applyAmlClearanceWithClient.mockResolvedValue(null);

      await expect(
        service.clearInvoice(INVOICE_ID, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0'),
      ).rejects.toMatchObject({
        errorCode: ComplianceErrorCode.AML_ALREADY_CLEARED,
      });
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  // =========================================================================
  // Other guards
  // =========================================================================
  describe('guards', () => {
    it('throws NotFoundError when the invoice does not exist', async () => {
      mockedRepo.getInvoiceClearanceState.mockResolvedValue(null);

      await expect(
        service.clearInvoice(INVOICE_ID, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws INVOICE_NOT_FLAGGED when the invoice is not AML-flagged', async () => {
      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: INVOICE_ID,
        aml_flagged: false,
        aml_cleared_at: null,
      });

      await expect(
        service.clearInvoice(INVOICE_ID, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0'),
      ).rejects.toMatchObject({
        errorCode: ComplianceErrorCode.INVOICE_NOT_FLAGGED,
      });
    });
  });

  // =========================================================================
  // Transactional behaviour — rollback
  // =========================================================================
  describe('transactional behaviour', () => {
    it('ROLLBACK is issued when the audit-write fails', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: INVOICE_ID,
        aml_flagged: true,
        aml_cleared_at: null,
      });
      mockedRepo.applyAmlClearanceWithClient.mockResolvedValue({
        aml_cleared_at: '2026-04-30T12:00:00Z',
      });
      mockedRepo.createAuditEntryWithClient.mockRejectedValue(new Error('audit DB down'));

      await expect(
        service.clearInvoice(INVOICE_ID, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0'),
      ).rejects.toThrow('audit DB down');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
      // Should not have committed
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    });

    it('releases the client even when COMMIT fails', async () => {
      const mockClient = buildMockClient();
      mockClient.query = jest.fn().mockImplementation((q: string) => {
        if (q === 'COMMIT') {
          return Promise.reject(new Error('commit failed'));
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: INVOICE_ID,
        aml_flagged: true,
        aml_cleared_at: null,
      });
      mockedRepo.applyAmlClearanceWithClient.mockResolvedValue({
        aml_cleared_at: '2026-04-30T12:00:00Z',
      });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      await expect(
        service.clearInvoice(INVOICE_ID, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0'),
      ).rejects.toThrow('commit failed');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Cross-supplier isolation — compliance officer sees ANY supplier's invoice
  // =========================================================================
  describe('cross-supplier isolation', () => {
    it('clearance has NO supplier_id ownership constraint (compliance sees all)', async () => {
      const mockClient = buildMockClient();
      (mockedPool.connect as jest.Mock).mockResolvedValue(mockClient);

      // Two different supplier invoices — both succeed for the same officer.
      const supplierA = '33333333-3333-3333-3333-333333333333';
      const supplierB = '44444444-4444-4444-4444-444444444444';

      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: supplierA,
        aml_flagged: true,
        aml_cleared_at: null,
      });
      mockedRepo.applyAmlClearanceWithClient.mockResolvedValue({
        aml_cleared_at: '2026-04-30T12:00:00Z',
      });
      mockedRepo.createAuditEntryWithClient.mockResolvedValue();

      await service.clearInvoice(supplierA, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0');

      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: supplierB,
        aml_flagged: true,
        aml_cleared_at: null,
      });

      await service.clearInvoice(supplierB, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0');

      // Both invoices were updated. The repository SQL has no supplier_id
      // filter — that absence is the contract being asserted here. The
      // service does not pass a supplier_id at all.
      expect(mockedRepo.applyAmlClearanceWithClient).toHaveBeenCalledTimes(2);
      const firstArgs = mockedRepo.applyAmlClearanceWithClient.mock.calls[0];
      const secondArgs = mockedRepo.applyAmlClearanceWithClient.mock.calls[1];
      expect(firstArgs).toHaveLength(4); // (client, invoiceId, officerId, reason) — no supplierId
      expect(secondArgs).toHaveLength(4);
    });
  });

  // =========================================================================
  // listQueue
  // =========================================================================
  describe('listQueue', () => {
    it('returns rows from the repository unchanged', async () => {
      mockedRepo.listAmlQueue.mockResolvedValue([
        {
          invoice_id: INVOICE_ID,
          supplier_id: 'sup-1',
          buyer_id: 'buy-1',
          face_value: '150000000',
          aml_flagged_at: '2026-04-28T00:00:00Z',
          created_at: '2026-04-28T00:00:00Z',
          days_flagged: 2,
        },
      ]);

      const rows = await service.listQueue();

      expect(rows).toHaveLength(1);
      // Sanity: response carries no PII keys
      expect(rows[0]).not.toHaveProperty('supplier_company_name');
      expect(rows[0]).not.toHaveProperty('buyer_company_name');
    });
  });

  // =========================================================================
  // getDetail — REFINEMENT 4 — emits AML_DETAIL_VIEWED audit
  // =========================================================================
  describe('getDetail (REFINEMENT 4)', () => {
    it('decrypts company names AND writes AML_DETAIL_VIEWED audit entry', async () => {
      mockedRepo.getAmlDetail.mockResolvedValue({
        invoice_id: INVOICE_ID,
        supplier_id: 'sup-1',
        buyer_id: 'buy-1',
        face_value: '150000000',
        aml_flagged: true,
        aml_cleared_at: null,
        aml_cleared_by: null,
        aml_clearance_reason: null,
        status: 'approved',
        created_at: '2026-04-28T00:00:00Z',
        supplier_company_name_encrypted: 'encrypted_AcmeSupplier',
        buyer_company_name_encrypted: 'encrypted_BuyerCorp',
        invoice_number: 'INV-001',
      });
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.getDetail(
        INVOICE_ID,
        OFFICER_ID,
        'compliance_officer',
        '10.0.0.1',
        'TestAgent/1.0',
      );

      expect(result.supplier_company_name).toBe('AcmeSupplier');
      expect(result.buyer_company_name).toBe('BuyerCorp');

      // Audit log MUST have been written for the decryption read.
      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        OFFICER_ID,
        'AML_DETAIL_VIEWED',
        'invoices',
        INVOICE_ID,
        {},
        expect.objectContaining({
          invoice_id: INVOICE_ID,
          viewer_id: OFFICER_ID,
          viewer_role: 'compliance_officer',
        }),
        '10.0.0.1',
        'TestAgent/1.0',
      );
    });

    it('throws NotFoundError when the invoice does not exist', async () => {
      mockedRepo.getAmlDetail.mockResolvedValue(null);

      await expect(
        service.getDetail(
          INVOICE_ID,
          OFFICER_ID,
          'compliance_officer',
          '10.0.0.1',
          'TestAgent/1.0',
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // =========================================================================
  // BusinessRuleError type sanity
  // =========================================================================
  describe('error type sanity', () => {
    it('AML_ALREADY_CLEARED is thrown as a BusinessRuleError', async () => {
      mockedRepo.getInvoiceClearanceState.mockResolvedValue({
        id: INVOICE_ID,
        aml_flagged: true,
        aml_cleared_at: '2026-04-29T10:00:00Z',
      });

      await expect(
        service.clearInvoice(INVOICE_ID, OFFICER_ID, VALID_INPUT, '10.0.0.1', 'TestAgent/1.0'),
      ).rejects.toBeInstanceOf(BusinessRuleError);
    });
  });
});
