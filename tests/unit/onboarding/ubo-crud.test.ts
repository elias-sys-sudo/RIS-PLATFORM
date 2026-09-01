process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';

import * as service from '../../../src/services/onboarding/onboarding.service';
import * as repo from '../../../src/services/onboarding/onboarding.repository';
import * as crypto from '../../../src/shared/crypto';
import { NotFoundError } from '../../../src/shared/errors';
import type {
  SupplierRecord,
  CreateUboInput,
  BeneficialOwnerRecord,
} from '../../../src/services/onboarding/onboarding.types';
import { KycStatus, PaymentMethod } from '../../../src/services/onboarding/onboarding.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/onboarding/onboarding.repository');
jest.mock('../../../src/shared/crypto');
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
  },
}));
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('ubo-uuid-1'),
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedCrypto = crypto as jest.Mocked<typeof crypto>;

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const IP = '127.0.0.1';
const UA = 'jest-test-agent';

function makeSupplierRecord(overrides: Partial<SupplierRecord> = {}): SupplierRecord {
  return {
    id: 'supplier-uuid-1',
    user_id: 'user-uuid-1',
    company_name: 'Test Supplier Ltd',
    company_name_encrypted: null,
    registration_number: 'REG-001',
    tax_id: 'TAX-001',
    tax_id_encrypted: null,
    directors: [{ name: 'Director', id_type: 'national_id', id_number: 'NID-1' }],
    directors_encrypted: null,
    bank_name: 'Stanbic Bank Uganda',
    bank_account_number_encrypted: 'enc:bank_acc',
    bank_account_name_encrypted: 'enc:bank_name',
    bank_branch: 'Kampala Main',
    preferred_payment_method: PaymentMethod.EFT,
    mobile_money_number_encrypted: 'enc:momo',
    kyc_status: KycStatus.APPROVED,
    sanctions_flag: false,
    risk_tier: 'standard',
    required_financing_amount: null,
    consent_ursb_check: true,
    consent_supplier_refs: true,
    consent_litigation_check: true,
    ursb_verified: true,
    ursb_verified_at: '2026-01-01T00:00:00Z',
    ursb_verified_by: 'officer-1',
    litigation_checked: true,
    litigation_checked_at: '2026-01-01T00:00:00Z',
    litigation_checked_by: 'officer-1',
    litigation_flag: false,
    eligibility_session_token: '00000000-0000-0000-0000-000000000099',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeUboRecord(overrides: Partial<BeneficialOwnerRecord> = {}): BeneficialOwnerRecord {
  return {
    id: 'ubo-uuid-1',
    supplier_id: 'supplier-uuid-1',
    full_name_encrypted: 'enc:John Owner',
    nationality: 'Ugandan',
    id_type: 'national_id',
    id_number_encrypted: 'enc:NID-999',
    ownership_percentage: 50,
    is_pep: false,
    verified_at: null,
    verified_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const validUboInput: CreateUboInput = {
  full_name: 'John Owner',
  nationality: 'Ugandan',
  id_type: 'national_id',
  id_number: 'NID-999',
  ownership_percentage: 50,
  is_pep: false,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.getClient.mockResolvedValue(mockClient as never);
  mockedCrypto.encrypt.mockImplementation((val: string) => `enc:${val}`);
  mockedCrypto.decrypt.mockImplementation((val: string) => val.replace('enc:', ''));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('addBeneficialOwner', () => {
  it('encrypts PII, creates record, and writes audit log', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord());
    mockedRepo.createUboWithClient.mockResolvedValue();
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();

    const result = await service.addBeneficialOwner(
      'supplier-uuid-1',
      validUboInput,
      'user-uuid-1',
      IP,
      UA,
    );

    expect(result.uboId).toBe('ubo-uuid-1');
    expect(mockedCrypto.encrypt).toHaveBeenCalledWith('John Owner');
    expect(mockedCrypto.encrypt).toHaveBeenCalledWith('NID-999');
    expect(mockedRepo.createUboWithClient).toHaveBeenCalledWith(
      mockClient,
      'supplier-uuid-1',
      'ubo-uuid-1',
      expect.objectContaining({
        fullNameEncrypted: 'enc:John Owner',
        idNumberEncrypted: 'enc:NID-999',
        ownershipPercentage: 50,
      }),
    );
    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      'user-uuid-1',
      'UBO_CREATED',
      'beneficial_owners',
      'ubo-uuid-1',
      null,
      expect.objectContaining({ supplierId: 'supplier-uuid-1' }),
      IP,
      UA,
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('throws NotFoundError when supplier does not exist', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(
      service.addBeneficialOwner('bad-id', validUboInput, 'user-1', IP, UA),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rolls back on repository error', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord());
    mockedRepo.createUboWithClient.mockRejectedValue(new Error('DB error'));

    await expect(
      service.addBeneficialOwner('supplier-uuid-1', validUboInput, 'user-1', IP, UA),
    ).rejects.toThrow('DB error');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('listBeneficialOwners', () => {
  it('fetches and decrypts UBO records', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord());
    mockedRepo.getUbosBySupplier.mockResolvedValue([makeUboRecord()]);

    const result = await service.listBeneficialOwners('supplier-uuid-1');

    expect(result).toHaveLength(1);
    expect(result[0].full_name).toBe('John Owner');
    expect(result[0].id_number).toBe('NID-999');
    expect(mockedCrypto.decrypt).toHaveBeenCalledWith('enc:John Owner');
    expect(mockedCrypto.decrypt).toHaveBeenCalledWith('enc:NID-999');
  });

  it('throws NotFoundError when supplier does not exist', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(service.listBeneficialOwners('bad-id')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns empty array when no UBOs exist', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord());
    mockedRepo.getUbosBySupplier.mockResolvedValue([]);

    const result = await service.listBeneficialOwners('supplier-uuid-1');
    expect(result).toEqual([]);
  });
});

describe('updateBeneficialOwner', () => {
  it('encrypts PII, updates record, and writes audit log', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord());
    mockedRepo.updateUboWithClient.mockResolvedValue(1);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();

    await service.updateBeneficialOwner(
      'ubo-uuid-1',
      'supplier-uuid-1',
      validUboInput,
      'user-1',
      IP,
      UA,
    );

    expect(mockedRepo.updateUboWithClient).toHaveBeenCalledWith(
      mockClient,
      'ubo-uuid-1',
      'supplier-uuid-1',
      expect.objectContaining({ fullNameEncrypted: 'enc:John Owner' }),
    );
    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      'user-1',
      'UBO_UPDATED',
      'beneficial_owners',
      'ubo-uuid-1',
      null,
      expect.any(Object),
      IP,
      UA,
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('throws NotFoundError when UBO not found (rowCount=0)', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord());
    mockedRepo.updateUboWithClient.mockResolvedValue(0);

    await expect(
      service.updateBeneficialOwner('ubo-bad', 'supplier-uuid-1', validUboInput, 'user-1', IP, UA),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('removeBeneficialOwner', () => {
  it('deletes record with ownership check and writes audit log', async () => {
    mockedRepo.deleteUboWithClient.mockResolvedValue(1);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();

    await service.removeBeneficialOwner('ubo-uuid-1', 'supplier-uuid-1', 'user-1', IP, UA);

    expect(mockedRepo.deleteUboWithClient).toHaveBeenCalledWith(
      mockClient,
      'ubo-uuid-1',
      'supplier-uuid-1',
    );
    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      'user-1',
      'UBO_DELETED',
      'beneficial_owners',
      'ubo-uuid-1',
      null,
      expect.objectContaining({ supplierId: 'supplier-uuid-1' }),
      IP,
      UA,
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('throws NotFoundError when UBO not found (rowCount=0)', async () => {
    mockedRepo.deleteUboWithClient.mockResolvedValue(0);

    await expect(
      service.removeBeneficialOwner('ubo-bad', 'supplier-uuid-1', 'user-1', IP, UA),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rolls back on repository error', async () => {
    mockedRepo.deleteUboWithClient.mockRejectedValue(new Error('DB error'));

    await expect(
      service.removeBeneficialOwner('ubo-uuid-1', 'supplier-uuid-1', 'user-1', IP, UA),
    ).rejects.toThrow('DB error');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});
