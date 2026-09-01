process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';

import * as service from '../../../src/services/onboarding/onboarding.service';
import * as repo from '../../../src/services/onboarding/onboarding.repository';
import { KycStatus } from '../../../src/services/onboarding/onboarding.types';
import type {
  SupplierRecord,
  DocumentRecord,
} from '../../../src/services/onboarding/onboarding.types';
import { ForbiddenError, NotFoundError } from '../../../src/shared/errors';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/services/onboarding/onboarding.repository');

const mockedRepo = repo as jest.Mocked<typeof repo>;

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

function buildDocumentRecord(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    invoice_id: null,
    supplier_id: 'sup-1',
    document_type: 'certificate_of_incorporation',
    encrypted_path: '11111111-2222-3333-4444-555555555555.enc',
    file_hash: 'hash',
    file_size_bytes: 1024,
    mime_type: 'application/pdf',
    uploaded_by: 'user-1',
    created_at: '2026-02-01T10:00:00Z',
    expiry_date: null,
    review_status: 'pending',
    reviewed_by_user_id: null,
    reviewed_at: null,
    review_comments: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('getSupplierKycStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns shape matching KycStatus interface for the owning supplier', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      buildSupplierRecord({ kyc_status: KycStatus.UNDER_REVIEW }),
    );
    mockedRepo.findDocumentsBySupplierId.mockResolvedValue([
      buildDocumentRecord({ document_type: 'certificate_of_incorporation' }),
      buildDocumentRecord({
        id: '99999999-8888-7777-6666-555555555555',
        document_type: 'tax_registration',
        mime_type: 'image/png',
      }),
    ]);

    const result = await service.getSupplierKycStatus('sup-1', 'user-1', 'supplier');

    expect(result).toEqual({
      supplierId: 'sup-1',
      overallStatus: 'in_progress',
      documents: [
        expect.objectContaining({
          id: '11111111-2222-3333-4444-555555555555',
          type: 'certificate_of_incorporation',
          status: 'pending',
          uploadedAt: '2026-02-01T10:00:00Z',
          reviewerComments: null,
        }),
        expect.objectContaining({
          id: '99999999-8888-7777-6666-555555555555',
          type: 'tax_registration',
          status: 'pending',
          reviewerComments: null,
        }),
      ],
    });
    // fileName must not be the encrypted_path
    expect(result.documents[0].fileName).not.toContain('.enc');
    expect(result.documents[0].fileName.length).toBeGreaterThan(0);
  });

  it('per-document status comes from invoice_documents.review_status, not from supplier kyc_status', async () => {
    // After migration 039, document review state is per-row, NOT projected
    // from the supplier-level kyc_status. An APPROVED supplier with a
    // freshly uploaded doc should still see that doc as 'pending' until
    // a reviewer explicitly approves it.
    mockedRepo.findSupplierById.mockResolvedValue(
      buildSupplierRecord({ kyc_status: KycStatus.APPROVED }),
    );
    mockedRepo.findDocumentsBySupplierId.mockResolvedValue([
      buildDocumentRecord({ review_status: 'pending' }),
      buildDocumentRecord({
        id: '22222222-3333-4444-5555-666666666666',
        review_status: 'approved',
        review_comments: null,
      }),
      buildDocumentRecord({
        id: '33333333-4444-5555-6666-777777777777',
        review_status: 'rejected',
        review_comments: 'Document blurry — please re-upload',
      }),
    ]);

    const result = await service.getSupplierKycStatus('sup-1', 'user-1', 'supplier');

    expect(result.overallStatus).toBe('approved');
    expect(result.documents[0].status).toBe('pending');
    expect(result.documents[1].status).toBe('approved');
    expect(result.documents[2].status).toBe('rejected');
    expect(result.documents[2].reviewerComments).toBe('Document blurry — please re-upload');
  });

  it('forbids supplier A from fetching supplier B kyc', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord({ user_id: 'user-OTHER' }));

    await expect(service.getSupplierKycStatus('sup-1', 'user-1', 'supplier')).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('allows credit_officer to fetch any supplier kyc', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord({ user_id: 'user-OTHER' }));
    mockedRepo.findDocumentsBySupplierId.mockResolvedValue([]);

    const result = await service.getSupplierKycStatus('sup-1', 'staff-1', 'credit_officer');

    expect(result.supplierId).toBe('sup-1');
    expect(result.documents).toEqual([]);
  });

  it('allows compliance_officer and management to fetch any supplier kyc', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord({ user_id: 'user-OTHER' }));
    mockedRepo.findDocumentsBySupplierId.mockResolvedValue([]);

    await expect(
      service.getSupplierKycStatus('sup-1', 'staff-1', 'compliance_officer'),
    ).resolves.toBeDefined();
    await expect(
      service.getSupplierKycStatus('sup-1', 'staff-1', 'management'),
    ).resolves.toBeDefined();
  });

  it('allows finance_manager, auditor, legal to read KYC status (read-only)', async () => {
    // finance_manager needs read access to verify identity/bank docs before
    // disbursing, auditor for compliance trail, legal for case prep. Write
    // access (review/approve) is still restricted to the smaller
    // KYC_DOC_REVIEWER_ROLES set.
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord({ user_id: 'user-OTHER' }));
    mockedRepo.findDocumentsBySupplierId.mockResolvedValue([]);

    await expect(
      service.getSupplierKycStatus('sup-1', 'fm-1', 'finance_manager'),
    ).resolves.toBeDefined();
    await expect(service.getSupplierKycStatus('sup-1', 'aud-1', 'auditor')).resolves.toBeDefined();
    await expect(service.getSupplierKycStatus('sup-1', 'leg-1', 'legal')).resolves.toBeDefined();
  });

  it('still forbids a foreign supplier (cross-account) from reading another supplier KYC', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord({ user_id: 'user-OTHER' }));

    await expect(
      service.getSupplierKycStatus('sup-1', 'user-INTRUDER', 'supplier'),
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError for unknown supplier id', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(service.getSupplierKycStatus('sup-missing', 'user-1', 'supplier')).rejects.toThrow(
      NotFoundError,
    );
  });

  it('maps unknown backend document_type to additional', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord());
    mockedRepo.findDocumentsBySupplierId.mockResolvedValue([
      buildDocumentRecord({ document_type: 'some_unknown_type' }),
    ]);

    const result = await service.getSupplierKycStatus('sup-1', 'user-1', 'supplier');

    expect(result.documents[0].type).toBe('additional');
  });
});
