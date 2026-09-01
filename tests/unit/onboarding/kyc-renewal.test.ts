process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';

import * as service from '../../../src/services/onboarding/onboarding.service';
import * as repo from '../../../src/services/onboarding/onboarding.repository';
import { NotFoundError } from '../../../src/shared/errors';
import type { SupplierRecord } from '../../../src/services/onboarding/onboarding.types';
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

const mockedRepo = repo as jest.Mocked<typeof repo>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeSupplierRecord(
  overrides: Partial<SupplierRecord & { kyc_renewal_due_at: string | null }> = {},
): SupplierRecord & { kyc_renewal_due_at: string | null } {
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
    kyc_renewal_due_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('checkKycExpiry', () => {
  it('returns false when kyc_renewal_due_at is null', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord({ kyc_renewal_due_at: null }));

    const result = await service.checkKycExpiry('supplier-uuid-1');
    expect(result).toBe(false);
  });

  it('returns true when kyc_renewal_due_at is in the past', async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ kyc_renewal_due_at: pastDate }),
    );

    const result = await service.checkKycExpiry('supplier-uuid-1');
    expect(result).toBe(true);
  });

  it('returns false when kyc_renewal_due_at is in the future', async () => {
    const futureDate = new Date(Date.now() + 86_400_000 * 30).toISOString();
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ kyc_renewal_due_at: futureDate }),
    );

    const result = await service.checkKycExpiry('supplier-uuid-1');
    expect(result).toBe(false);
  });

  it('throws NotFoundError when supplier does not exist', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(service.checkKycExpiry('bad-id')).rejects.toBeInstanceOf(NotFoundError);
  });
});
