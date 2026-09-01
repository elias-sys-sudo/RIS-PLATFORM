import * as service from '../../../src/services/payments/payments-orphans.service';
import * as repo from '../../../src/services/payments/payments.repository';
import { RisError } from '../../../src/shared/errors';
import { PaymentErrorCode } from '../../../src/services/payments/payments.types';

jest.mock('../../../src/services/payments/payments.repository');

const mockedRepo = repo as jest.Mocked<typeof repo>;

describe('payments-orphans.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listOrphanedApprovedInvoices', () => {
    it('returns repository rows unchanged on the happy path', async () => {
      const rows = [
        {
          invoice_id: 'inv-1',
          supplier_id: 'sup-1',
          face_value: '10000000',
          approved_at: '2026-05-20T10:00:00Z',
          age_hours: 3.5,
        },
      ];
      mockedRepo.findOrphanedApprovedInvoices.mockResolvedValue(rows);

      await expect(service.listOrphanedApprovedInvoices()).resolves.toEqual(rows);
    });

    it('wraps repo errors in a typed RisError with ORPHAN_QUERY_FAILED', async () => {
      mockedRepo.findOrphanedApprovedInvoices.mockRejectedValue(new Error('boom'));

      const result = service.listOrphanedApprovedInvoices();
      await expect(result).rejects.toBeInstanceOf(RisError);
      await expect(result).rejects.toMatchObject({
        errorCode: PaymentErrorCode.ORPHAN_QUERY_FAILED,
      });
    });

    it('handles non-Error thrown values', async () => {
      mockedRepo.findOrphanedApprovedInvoices.mockRejectedValue('string-thrown-value');

      await expect(service.listOrphanedApprovedInvoices()).rejects.toBeInstanceOf(RisError);
    });
  });
});
