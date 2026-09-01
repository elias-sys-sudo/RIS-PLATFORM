process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';

import * as service from '../../../src/services/onboarding/onboarding.service';
import * as repo from '../../../src/services/onboarding/onboarding.repository';
import { KycStatus } from '../../../src/services/onboarding/onboarding.types';
import type { SupplierRecord } from '../../../src/services/onboarding/onboarding.types';
import { BusinessRuleError } from '../../../src/shared/errors';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: {
    connect: jest.fn(),
  },
}));

jest.mock('../../../src/services/onboarding/onboarding.repository');

const mockedRepo = repo as jest.Mocked<typeof repo>;

function buildMockClient() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
}

function buildSupplierRecord(overrides: Partial<SupplierRecord> = {}): SupplierRecord {
  return {
    id: 'sup-1',
    user_id: 'user-1',
    company_name: 'Test Company',
    company_name_encrypted: null,
    registration_number: 'REG-001',
    tax_id: 'TAX-001',
    tax_id_encrypted: null,
    directors: [],
    directors_encrypted: null,
    bank_name: 'Test Bank',
    bank_account_number_encrypted: 'enc-acc',
    bank_account_name_encrypted: 'enc-name',
    bank_branch: 'Main',
    preferred_payment_method: 'EFT' as SupplierRecord['preferred_payment_method'],
    mobile_money_number_encrypted: null,
    kyc_status: KycStatus.UNDER_REVIEW,
    sanctions_flag: false,
    risk_tier: 'standard',
    required_financing_amount: null,
    consent_ursb_check: true,
    consent_supplier_refs: true,
    consent_litigation_check: true,
    ursb_verified: false,
    ursb_verified_at: null,
    ursb_verified_by: null,
    litigation_checked: false,
    litigation_checked_at: null,
    litigation_checked_by: null,
    litigation_flag: false,
    eligibility_session_token: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('KYC maker-checker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records reviewer ID when transitioning to under_review', async () => {
    const mockClient = buildMockClient();
    mockedRepo.getClient.mockResolvedValue(mockClient as never);
    mockedRepo.findSupplierById.mockResolvedValue(
      buildSupplierRecord({ kyc_status: KycStatus.DOCUMENTS_SUBMITTED }),
    );
    mockedRepo.updateKycStatusWithClient.mockResolvedValue();
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();
    mockedRepo.setKycReviewerWithClient.mockResolvedValue();

    await service.updateKycStatus(
      'sup-1',
      { status: KycStatus.UNDER_REVIEW, comments: 'Reviewing' },
      'reviewer-1',
      '127.0.0.1',
      'test-agent',
    );

    expect(mockedRepo.setKycReviewerWithClient).toHaveBeenCalledWith(
      mockClient,
      'sup-1',
      'reviewer-1',
    );
  });

  it('allows approval by a different compliance officer', async () => {
    const mockClient = buildMockClient();
    mockedRepo.getClient.mockResolvedValue(mockClient as never);
    mockedRepo.findSupplierById.mockResolvedValue(
      buildSupplierRecord({ kyc_status: KycStatus.UNDER_REVIEW }),
    );
    mockedRepo.getKycReviewer.mockResolvedValue('reviewer-1');
    mockedRepo.updateKycStatusWithClient.mockResolvedValue();
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();
    mockedRepo.setKycApproverWithClient.mockResolvedValue();

    await service.updateKycStatus(
      'sup-1',
      { status: KycStatus.APPROVED, comments: 'All good' },
      'approver-2',
      '127.0.0.1',
      'test-agent',
    );

    expect(mockedRepo.setKycApproverWithClient).toHaveBeenCalledWith(
      mockClient,
      'sup-1',
      'approver-2',
    );
    expect(mockedRepo.updateKycStatusWithClient).toHaveBeenCalledWith(
      mockClient,
      'sup-1',
      KycStatus.APPROVED,
    );
  });

  it('rejects approval when same user reviewed and tries to approve', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      buildSupplierRecord({ kyc_status: KycStatus.UNDER_REVIEW }),
    );
    mockedRepo.getKycReviewer.mockResolvedValue('same-user');

    await expect(
      service.updateKycStatus(
        'sup-1',
        { status: KycStatus.APPROVED, comments: 'Self-approve attempt' },
        'same-user',
        '127.0.0.1',
        'test-agent',
      ),
    ).rejects.toThrow(BusinessRuleError);

    await expect(
      service.updateKycStatus(
        'sup-1',
        { status: KycStatus.APPROVED, comments: 'Self-approve attempt' },
        'same-user',
        '127.0.0.1',
        'test-agent',
      ),
    ).rejects.toMatchObject({ errorCode: 'KYC_SAME_REVIEWER_APPROVER' });

    // Must not reach the transaction
    expect(mockedRepo.getClient).not.toHaveBeenCalled();
  });

  it('allows rejection by the same reviewer (only approval requires different user)', async () => {
    const mockClient = buildMockClient();
    mockedRepo.getClient.mockResolvedValue(mockClient as never);
    mockedRepo.findSupplierById.mockResolvedValue(
      buildSupplierRecord({ kyc_status: KycStatus.UNDER_REVIEW }),
    );
    mockedRepo.updateKycStatusWithClient.mockResolvedValue();
    mockedRepo.createAuditEntryWithClient.mockResolvedValue();

    // Rejection does not call enforceKycMakerChecker, so same user is fine
    await service.updateKycStatus(
      'sup-1',
      { status: KycStatus.REJECTED, comments: 'Documents unclear' },
      'reviewer-1',
      '127.0.0.1',
      'test-agent',
    );

    expect(mockedRepo.updateKycStatusWithClient).toHaveBeenCalledWith(
      mockClient,
      'sup-1',
      KycStatus.REJECTED,
    );
  });
});
