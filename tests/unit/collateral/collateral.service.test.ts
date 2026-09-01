process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/collateral/collateral.service';
import * as repo from '../../../src/services/collateral/collateral.repository';
import { NotFoundError, ForbiddenError, BusinessRuleError } from '../../../src/shared/errors';
import type { CollateralRecord } from '../../../src/services/collateral/collateral.types';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/services/collateral/collateral.repository');
jest.mock('../../../src/shared/risk-config', () => ({
  getRiskConfigNumber: jest.fn(),
}));
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;
import { getRiskConfigNumber } from '../../../src/shared/risk-config';
const mockedGetRiskConfigNumber = getRiskConfigNumber as jest.MockedFunction<
  typeof getRiskConfigNumber
>;

const TEST_IP = '127.0.0.1';
const TEST_UA = 'jest-test-agent';

function buildCollateral(overrides: Partial<CollateralRecord> = {}): CollateralRecord {
  return {
    id: 'col-1',
    invoice_id: 'inv-1',
    supplier_id: 'sup-1',
    collateral_type: 'bank_guarantee',
    value: '50000000',
    description: 'Office building',
    currency: 'UGX',
    expiry_date: null,
    is_active: true,
    enforceability_status: null,
    deleted_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('collateral.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // createCollateral
  // =========================================================================
  describe('createCollateral', () => {
    it('creates collateral and writes audit log', async () => {
      mockedRepo.getInvoiceStatus.mockResolvedValue({ status: 'scored', supplier_id: 'sup-1' });
      mockedRepo.validateInvoiceAccess.mockResolvedValue(true);
      mockedRepo.createCollateral.mockResolvedValue(buildCollateral({ id: 'mock-uuid-v4' }));
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.createCollateral(
        'user-1',
        'finance_manager',
        {
          invoice_id: 'inv-1',
          type: 'bank_guarantee',
          description: 'Office building',
          estimated_value: '50000000',
          currency: 'UGX',
          documents: [],
        },
        TEST_IP,
        TEST_UA,
      );

      expect(result.id).toBe('mock-uuid-v4');
      expect(mockedRepo.createCollateral).toHaveBeenCalled();
      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'COLLATERAL_CREATED',
        'collateral',
        'mock-uuid-v4',
        {},
        expect.objectContaining({ type: 'bank_guarantee' }),
        TEST_IP,
        TEST_UA,
      );
    });

    it('throws NotFoundError when invoice does not exist', async () => {
      mockedRepo.getInvoiceStatus.mockResolvedValue(null);

      await expect(
        service.createCollateral(
          'user-1',
          'finance_manager',
          {
            invoice_id: 'no-exist',
            type: 'bank_guarantee',
            description: 'test',
            estimated_value: '100',
            currency: 'UGX',
            documents: [],
          },
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when user lacks access', async () => {
      mockedRepo.getInvoiceStatus.mockResolvedValue({ status: 'scored', supplier_id: 'sup-1' });
      mockedRepo.validateInvoiceAccess.mockResolvedValue(false);

      await expect(
        service.createCollateral(
          'user-1',
          'supplier',
          {
            invoice_id: 'inv-1',
            type: 'bank_guarantee',
            description: 'test',
            estimated_value: '100',
            currency: 'UGX',
            documents: [],
          },
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // =========================================================================
  // listCollateral
  // =========================================================================
  describe('listCollateral', () => {
    it('returns paginated list', async () => {
      mockedRepo.validateInvoiceAccess.mockResolvedValue(true);
      mockedRepo.listByInvoice.mockResolvedValue({
        data: [buildCollateral()],
        total: 1,
      });

      const result = await service.listCollateral('user-1', 'finance_manager', 'inv-1', 1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('throws ForbiddenError for unauthorised access', async () => {
      mockedRepo.validateInvoiceAccess.mockResolvedValue(false);

      await expect(service.listCollateral('user-1', 'supplier', 'inv-1', 1, 20)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  // =========================================================================
  // getCollateral
  // =========================================================================
  describe('getCollateral', () => {
    it('returns collateral with documents', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral());
      mockedRepo.validateInvoiceAccess.mockResolvedValue(true);
      mockedRepo.getCollateralDocuments.mockResolvedValue([]);

      const result = await service.getCollateral('user-1', 'finance_manager', 'col-1');

      expect(result.collateral.id).toBe('col-1');
      expect(result.documents).toEqual([]);
    });

    it('throws NotFoundError when collateral does not exist', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(null);

      await expect(service.getCollateral('user-1', 'finance_manager', 'no-exist')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('skips access check and returns docs when invoice_id is null', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral({ invoice_id: null }));
      mockedRepo.getCollateralDocuments.mockResolvedValue([]);

      const result = await service.getCollateral('user-1', 'supplier', 'col-1');

      expect(result.collateral.invoice_id).toBeNull();
      expect(result.documents).toEqual([]);
      expect(mockedRepo.validateInvoiceAccess).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateCollateral
  // =========================================================================
  describe('updateCollateral', () => {
    it('updates value and logs old/new in audit', async () => {
      const existing = buildCollateral();
      mockedRepo.getCollateralById.mockResolvedValue(existing);
      mockedRepo.validateInvoiceAccess.mockResolvedValue(true);
      mockedRepo.updateCollateral.mockResolvedValue(buildCollateral({ value: '75000000' }));
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.updateCollateral(
        'user-1',
        'finance_manager',
        'col-1',
        { estimated_value: '75000000' },
        TEST_IP,
        TEST_UA,
      );

      expect(result.value).toBe('75000000');
      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'COLLATERAL_UPDATED',
        'collateral',
        'col-1',
        expect.objectContaining({ value: '50000000' }),
        expect.objectContaining({ value: '75000000' }),
        TEST_IP,
        TEST_UA,
      );
    });

    it('replaces documents when provided', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral());
      mockedRepo.validateInvoiceAccess.mockResolvedValue(true);
      mockedRepo.replaceDocuments.mockResolvedValue();
      mockedRepo.createAuditEntry.mockResolvedValue();

      await service.updateCollateral(
        'user-1',
        'finance_manager',
        'col-1',
        { documents: ['doc-1', 'doc-2'] },
        TEST_IP,
        TEST_UA,
      );

      expect(mockedRepo.replaceDocuments).toHaveBeenCalledWith('col-1', ['doc-1', 'doc-2']);
    });

    it('throws NotFoundError when collateral not found', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(null);

      await expect(
        service.updateCollateral(
          'user-1',
          'finance_manager',
          'no-exist',
          { description: 'updated' },
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('writes audit even when no fields changed (empty input)', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral());
      mockedRepo.validateInvoiceAccess.mockResolvedValue(true);
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.updateCollateral(
        'user-1',
        'finance_manager',
        'col-1',
        {},
        TEST_IP,
        TEST_UA,
      );

      expect(result.id).toBe('col-1');
      expect(mockedRepo.updateCollateral).not.toHaveBeenCalled();
      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'COLLATERAL_UPDATED',
        'collateral',
        'col-1',
        {},
        {},
        TEST_IP,
        TEST_UA,
      );
    });

    it('throws ForbiddenError when user lacks access to the invoice', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral());
      mockedRepo.validateInvoiceAccess.mockResolvedValue(false);

      await expect(
        service.updateCollateral(
          'user-1',
          'supplier',
          'col-1',
          { description: 'updated' },
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('skips access check when collateral has null invoice_id', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral({ invoice_id: null }));
      mockedRepo.updateCollateral.mockResolvedValue(
        buildCollateral({ invoice_id: null, description: 'new desc' }),
      );
      mockedRepo.createAuditEntry.mockResolvedValue();

      const result = await service.updateCollateral(
        'user-1',
        'supplier',
        'col-1',
        { description: 'new desc' },
        TEST_IP,
        TEST_UA,
      );

      expect(result.description).toBe('new desc');
      expect(mockedRepo.validateInvoiceAccess).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when updateCollateral repo returns null', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral());
      mockedRepo.validateInvoiceAccess.mockResolvedValue(true);
      mockedRepo.updateCollateral.mockResolvedValue(null);

      await expect(
        service.updateCollateral(
          'user-1',
          'finance_manager',
          'col-1',
          { estimated_value: '99999' },
          TEST_IP,
          TEST_UA,
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // =========================================================================
  // deleteCollateral
  // =========================================================================
  describe('deleteCollateral', () => {
    it('soft deletes collateral and writes audit', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral());
      mockedRepo.validateInvoiceAccess.mockResolvedValue(true);
      mockedRepo.getInvoiceStatus.mockResolvedValue({ status: 'scored', supplier_id: 'sup-1' });
      mockedRepo.softDelete.mockResolvedValue(
        buildCollateral({ deleted_at: new Date().toISOString() }),
      );
      mockedRepo.createAuditEntry.mockResolvedValue();

      await service.deleteCollateral('user-1', 'finance_manager', 'col-1', TEST_IP, TEST_UA);

      expect(mockedRepo.softDelete).toHaveBeenCalledWith('col-1');
      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'COLLATERAL_DELETED',
        'collateral',
        'col-1',
        expect.any(Object),
        expect.any(Object),
        TEST_IP,
        TEST_UA,
      );
    });

    it('throws NotFoundError when collateral does not exist', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(null);

      await expect(
        service.deleteCollateral('user-1', 'finance_manager', 'no-exist', TEST_IP, TEST_UA),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws BusinessRuleError when invoice is funded', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral());
      mockedRepo.validateInvoiceAccess.mockResolvedValue(true);
      mockedRepo.getInvoiceStatus.mockResolvedValue({ status: 'funded', supplier_id: 'sup-1' });

      await expect(
        service.deleteCollateral('user-1', 'finance_manager', 'col-1', TEST_IP, TEST_UA),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('throws ForbiddenError when supplier lacks access', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral());
      mockedRepo.validateInvoiceAccess.mockResolvedValue(false);

      await expect(
        service.deleteCollateral('user-1', 'supplier', 'col-1', TEST_IP, TEST_UA),
      ).rejects.toThrow(ForbiddenError);
    });

    it('skips access and funded check when invoice_id is null', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral({ invoice_id: null }));
      mockedRepo.softDelete.mockResolvedValue(
        buildCollateral({ invoice_id: null, deleted_at: new Date().toISOString() }),
      );
      mockedRepo.createAuditEntry.mockResolvedValue();

      await service.deleteCollateral('user-1', 'supplier', 'col-1', TEST_IP, TEST_UA);

      expect(mockedRepo.validateInvoiceAccess).not.toHaveBeenCalled();
      expect(mockedRepo.getInvoiceStatus).not.toHaveBeenCalled();
      expect(mockedRepo.softDelete).toHaveBeenCalledWith('col-1');
    });

    it('succeeds when invoice exists but status is not funded', async () => {
      mockedRepo.getCollateralById.mockResolvedValue(buildCollateral());
      mockedRepo.validateInvoiceAccess.mockResolvedValue(true);
      mockedRepo.getInvoiceStatus.mockResolvedValue({ status: 'approved', supplier_id: 'sup-1' });
      mockedRepo.softDelete.mockResolvedValue(
        buildCollateral({ deleted_at: new Date().toISOString() }),
      );
      mockedRepo.createAuditEntry.mockResolvedValue();

      await service.deleteCollateral('user-1', 'finance_manager', 'col-1', TEST_IP, TEST_UA);

      expect(mockedRepo.softDelete).toHaveBeenCalledWith('col-1');
      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'COLLATERAL_DELETED',
        'collateral',
        'col-1',
        expect.any(Object),
        expect.any(Object),
        TEST_IP,
        TEST_UA,
      );
    });
  });

  // =========================================================================
  // checkCoverageRatio
  // =========================================================================
  describe('checkCoverageRatio', () => {
    it('reads coverage threshold from risk_config, not hardcoded', async () => {
      mockedGetRiskConfigNumber.mockResolvedValue(0.6);
      mockedRepo.getTotalCollateralValueForInvoice.mockResolvedValue('55000000');
      const below = await service.checkCoverageRatio('inv-1', '100000000');
      expect(below.sufficient).toBe(false);
      expect(below.ratio).toBeCloseTo(0.55, 4);

      mockedRepo.getTotalCollateralValueForInvoice.mockResolvedValue('65000000');
      const above = await service.checkCoverageRatio('inv-1', '100000000');
      expect(above.sufficient).toBe(true);
      expect(above.ratio).toBeCloseTo(0.65, 4);

      expect(mockedGetRiskConfigNumber).toHaveBeenCalledWith('collateral_min_coverage_ratio');
    });

    it('falls back to 0.5 when risk_config read throws', async () => {
      mockedGetRiskConfigNumber.mockRejectedValue(new Error('db down'));
      mockedRepo.getTotalCollateralValueForInvoice.mockResolvedValue('50000000');
      const result = await service.checkCoverageRatio('inv-1', '100000000');
      expect(result.sufficient).toBe(true);
      expect(result.ratio).toBeCloseTo(0.5, 4);
    });

    it('treats threshold=0 as a deliberate "collateral check disabled" config', async () => {
      // Operator-configurable: setting collateral_min_coverage_ratio to 0 in
      // risk_config means "no collateral required" (e.g. fully-insured
      // receivables, staging UAT). Must NOT trigger the fallback safety net.
      mockedGetRiskConfigNumber.mockResolvedValue(0);
      mockedRepo.getTotalCollateralValueForInvoice.mockResolvedValue('0');
      const result = await service.checkCoverageRatio('inv-1', '100000000');
      expect(result.sufficient).toBe(true);
      expect(result.ratio).toBe(0);
    });

    it('still falls back to 0.5 when threshold is negative (invalid)', async () => {
      mockedGetRiskConfigNumber.mockResolvedValue(-1);
      mockedRepo.getTotalCollateralValueForInvoice.mockResolvedValue('60000000');
      const result = await service.checkCoverageRatio('inv-1', '100000000');
      // 0.6 > 0.5 fallback, so sufficient
      expect(result.sufficient).toBe(true);
    });
  });
});
