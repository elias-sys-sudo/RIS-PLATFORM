import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { PoolClient } from 'pg';

// Mock dependencies
jest.mock('../../../src/services/invoices/invoices.repository');
jest.mock('../../../src/shared/database/pool', () => ({
  pool: { connect: jest.fn() },
  beginWithRls: jest.fn(),
}));
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    audit: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import * as repo from '../../../src/services/invoices/invoices.repository';
import * as service from '../../../src/services/invoices/invoices.service';
import { InvoiceStatus } from '../../../src/services/invoices/invoices.types';
import { NotFoundError } from '../../../src/shared/errors';

const mockRepo = jest.mocked(repo);

function buildMockClient(): PoolClient {
  return {
    query: jest.fn<() => Promise<{ rows: unknown[] }>>().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  } as unknown as PoolClient;
}

const IP = '127.0.0.1';
const UA = 'test-agent';

function buildSubmittedInvoice(overrides: Record<string, unknown> = {}): {
  id: string;
  invoice_number: string;
  supplier_id: string;
  buyer_id: string;
  face_value: string;
  due_date: string;
  description: string;
  status: InvoiceStatus;
  sla_deadline: string;
  buyer_confirmed_at: string | null;
  aml_flagged: boolean;
  created_at: string;
  updated_at: string;
} {
  return {
    id: 'invoice-1',
    invoice_number: 'INV-001',
    supplier_id: 'supplier-1',
    buyer_id: 'buyer-1',
    face_value: '5000000',
    due_date: '2025-06-01',
    description: 'Test invoice',
    status: InvoiceStatus.SUBMITTED,
    sla_deadline: '2025-01-04T00:00:00Z',
    buyer_confirmed_at: null,
    aml_flagged: false,
    created_at: new Date().toISOString(), // just submitted
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Invoice Cooling-Off Period', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('withdrawInvoice', () => {
    it('successfully withdraws a recently submitted invoice', async () => {
      const mockClient = buildMockClient();
      mockRepo.getClient.mockResolvedValue(mockClient);
      mockRepo.findSupplierByUserId.mockResolvedValue({
        id: 'supplier-1',
        kyc_status: 'approved',
      });
      mockRepo.findInvoiceByIdForSupplier.mockResolvedValue(buildSubmittedInvoice());
      mockRepo.withdrawInvoiceWithClient.mockResolvedValue();
      mockRepo.createAuditEntryWithClient.mockResolvedValue();

      await service.withdrawInvoice('invoice-1', 'user-1', 'Changed my mind', IP, UA);

      expect(mockRepo.withdrawInvoiceWithClient).toHaveBeenCalledWith(
        mockClient,
        'invoice-1',
        'Changed my mind',
      );
      expect(mockRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
        mockClient,
        'user-1',
        'INVOICE_WITHDRAWN',
        'invoices',
        'invoice-1',
        expect.objectContaining({ status: InvoiceStatus.SUBMITTED }),
        expect.objectContaining({ status: InvoiceStatus.WITHDRAWN }),
        IP,
        UA,
      );
    });

    it('throws NotFoundError when invoice does not exist for supplier', async () => {
      mockRepo.findSupplierByUserId.mockResolvedValue({
        id: 'supplier-1',
        kyc_status: 'approved',
      });
      mockRepo.findInvoiceByIdForSupplier.mockResolvedValue(null);

      await expect(
        service.withdrawInvoice('nonexistent', 'user-1', 'Reason', IP, UA),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws ForbiddenError when user is not a supplier', async () => {
      mockRepo.findSupplierByUserId.mockResolvedValue(null);

      await expect(
        service.withdrawInvoice('invoice-1', 'non-supplier', 'Reason', IP, UA),
      ).rejects.toThrow();
    });

    it('throws BusinessRuleError when invoice is not in submitted status', async () => {
      mockRepo.findSupplierByUserId.mockResolvedValue({
        id: 'supplier-1',
        kyc_status: 'approved',
      });
      mockRepo.findInvoiceByIdForSupplier.mockResolvedValue(
        buildSubmittedInvoice({ status: InvoiceStatus.SCORED }),
      );

      await expect(
        service.withdrawInvoice('invoice-1', 'user-1', 'Reason', IP, UA),
      ).rejects.toMatchObject({ errorCode: 'INVOICE_WRONG_STATUS' });
    });

    it('throws BusinessRuleError when buyer has already confirmed', async () => {
      mockRepo.findSupplierByUserId.mockResolvedValue({
        id: 'supplier-1',
        kyc_status: 'approved',
      });
      mockRepo.findInvoiceByIdForSupplier.mockResolvedValue(
        buildSubmittedInvoice({ buyer_confirmed_at: '2025-01-02T00:00:00Z' }),
      );

      await expect(
        service.withdrawInvoice('invoice-1', 'user-1', 'Reason', IP, UA),
      ).rejects.toMatchObject({ errorCode: 'INVOICE_ALREADY_CONFIRMED' });
    });

    it('throws BusinessRuleError when cooling-off period (48h) has expired', async () => {
      mockRepo.findSupplierByUserId.mockResolvedValue({
        id: 'supplier-1',
        kyc_status: 'approved',
      });
      // Submitted 49 hours ago
      const pastDate = new Date(Date.now() - 49 * 3_600_000).toISOString();
      mockRepo.findInvoiceByIdForSupplier.mockResolvedValue(
        buildSubmittedInvoice({ created_at: pastDate }),
      );

      await expect(
        service.withdrawInvoice('invoice-1', 'user-1', 'Reason', IP, UA),
      ).rejects.toMatchObject({ errorCode: 'COOLING_OFF_EXPIRED' });
    });

    it('allows withdrawal within the 48h cooling-off window', async () => {
      const mockClient = buildMockClient();
      mockRepo.getClient.mockResolvedValue(mockClient);
      mockRepo.findSupplierByUserId.mockResolvedValue({
        id: 'supplier-1',
        kyc_status: 'approved',
      });
      // Submitted 47 hours ago — still within window
      const recentDate = new Date(Date.now() - 47 * 3_600_000).toISOString();
      mockRepo.findInvoiceByIdForSupplier.mockResolvedValue(
        buildSubmittedInvoice({ created_at: recentDate }),
      );
      mockRepo.withdrawInvoiceWithClient.mockResolvedValue();
      mockRepo.createAuditEntryWithClient.mockResolvedValue();

      await expect(
        service.withdrawInvoice('invoice-1', 'user-1', 'Within window', IP, UA),
      ).resolves.toBeUndefined();

      expect(mockRepo.withdrawInvoiceWithClient).toHaveBeenCalled();
    });

    it('rolls back on error', async () => {
      const mockClient = buildMockClient();
      mockRepo.getClient.mockResolvedValue(mockClient);
      mockRepo.findSupplierByUserId.mockResolvedValue({
        id: 'supplier-1',
        kyc_status: 'approved',
      });
      mockRepo.findInvoiceByIdForSupplier.mockResolvedValue(buildSubmittedInvoice());
      mockRepo.withdrawInvoiceWithClient.mockRejectedValue(new Error('DB error'));

      await expect(
        service.withdrawInvoice('invoice-1', 'user-1', 'Reason', IP, UA),
      ).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
