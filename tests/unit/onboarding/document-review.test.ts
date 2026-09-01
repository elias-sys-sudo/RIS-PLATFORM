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
// Mocks — keep the surface tight to this feature only
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/services/onboarding/onboarding.repository');

jest.mock('../../../src/shared/logger', () => {
  const noop = jest.fn();
  return {
    logger: {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      audit: noop,
    },
  };
});

const mockedRepo = repo as jest.Mocked<typeof repo>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUPPLIER_ID = '8a194c5c-57aa-4915-b6fc-5d27472b6369';
const DOC_ID = '11111111-2222-3333-4444-555555555555';
const UPLOADER_USER_ID = 'b7770a31-b3b7-4f98-a261-82327482b6ce';
const REVIEWER_USER_ID = '6f19da00-0000-0000-0000-904f0ced2114';
const IP = '127.0.0.1';
const UA = 'jest';

function buildSupplier(overrides: Partial<SupplierRecord> = {}): SupplierRecord {
  return {
    id: SUPPLIER_ID,
    user_id: UPLOADER_USER_ID,
    company_name: 'Test Co',
    company_name_encrypted: null,
    registration_number: 'REG-001',
    tax_id: 'TAX-001',
    tax_id_encrypted: null,
    directors: [],
    directors_encrypted: null,
    bank_name: 'Bank',
    bank_account_number_encrypted: 'enc',
    bank_account_name_encrypted: 'enc',
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

function buildDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: DOC_ID,
    invoice_id: null,
    supplier_id: SUPPLIER_ID,
    document_type: 'certificate_of_incorporation',
    encrypted_path: `${DOC_ID}.enc`,
    file_hash: 'hash',
    file_size_bytes: 1024,
    mime_type: 'application/pdf',
    uploaded_by: UPLOADER_USER_ID,
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

describe('reviewSupplierDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Auto-approve helper queries this after every approve decision.
    // Default: return empty so auto-promote no-ops unless a test opts in.
    mockedRepo.getApprovedDocumentTypes.mockResolvedValue([]);
  });

  it('approves a pending document for an authorised credit officer', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplier());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDoc());
    mockedRepo.updateDocumentReview.mockResolvedValue(
      buildDoc({ review_status: 'approved', reviewed_by_user_id: REVIEWER_USER_ID }),
    );
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    await expect(
      service.reviewSupplierDocument(
        SUPPLIER_ID,
        DOC_ID,
        { decision: 'approved', comments: '' },
        REVIEWER_USER_ID,
        'credit_officer',
        IP,
        UA,
      ),
    ).resolves.toBeUndefined();

    expect(mockedRepo.updateDocumentReview).toHaveBeenCalledWith(
      DOC_ID,
      SUPPLIER_ID,
      'approved',
      REVIEWER_USER_ID,
      '',
    );
    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      REVIEWER_USER_ID,
      'KYC_DOCUMENT_REVIEWED',
      'invoice_documents',
      DOC_ID,
      expect.objectContaining({ reviewStatus: 'pending' }),
      expect.objectContaining({ reviewStatus: 'approved' }),
      IP,
      UA,
    );
  });

  it('rejects with feedback for compliance officer', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplier());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDoc());
    mockedRepo.updateDocumentReview.mockResolvedValue(
      buildDoc({ review_status: 'rejected', review_comments: 'Document blurry' }),
    );

    await service.reviewSupplierDocument(
      SUPPLIER_ID,
      DOC_ID,
      { decision: 'rejected', comments: 'Document blurry' },
      REVIEWER_USER_ID,
      'compliance_officer',
      IP,
      UA,
    );

    expect(mockedRepo.updateDocumentReview).toHaveBeenCalledWith(
      DOC_ID,
      SUPPLIER_ID,
      'rejected',
      REVIEWER_USER_ID,
      'Document blurry',
    );
  });

  it('allows management role too', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplier());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDoc());
    mockedRepo.updateDocumentReview.mockResolvedValue(buildDoc({ review_status: 'approved' }));

    await expect(
      service.reviewSupplierDocument(
        SUPPLIER_ID,
        DOC_ID,
        { decision: 'approved', comments: '' },
        REVIEWER_USER_ID,
        'management',
        IP,
        UA,
      ),
    ).resolves.toBeUndefined();
  });

  it('forbids supplier role from reviewing', async () => {
    await expect(
      service.reviewSupplierDocument(
        SUPPLIER_ID,
        DOC_ID,
        { decision: 'approved', comments: '' },
        REVIEWER_USER_ID,
        'supplier',
        IP,
        UA,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockedRepo.findSupplierById).not.toHaveBeenCalled();
  });

  it('forbids auditor role from reviewing (read-only access only)', async () => {
    await expect(
      service.reviewSupplierDocument(
        SUPPLIER_ID,
        DOC_ID,
        { decision: 'approved', comments: '' },
        REVIEWER_USER_ID,
        'auditor',
        IP,
        UA,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('forbids finance_manager role', async () => {
    await expect(
      service.reviewSupplierDocument(
        SUPPLIER_ID,
        DOC_ID,
        { decision: 'approved', comments: '' },
        REVIEWER_USER_ID,
        'finance_manager',
        IP,
        UA,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects maker-checker violation: reviewer === uploader', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplier());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(
      buildDoc({ uploaded_by: REVIEWER_USER_ID }),
    );

    await expect(
      service.reviewSupplierDocument(
        SUPPLIER_ID,
        DOC_ID,
        { decision: 'approved', comments: '' },
        REVIEWER_USER_ID,
        'credit_officer',
        IP,
        UA,
      ),
    ).rejects.toMatchObject({
      // BusinessRuleError exposes the error code on `errorCode`
      errorCode: 'KYC_DOC_SELF_REVIEW',
    });
    expect(mockedRepo.updateDocumentReview).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when supplier does not exist', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(
      service.reviewSupplierDocument(
        SUPPLIER_ID,
        DOC_ID,
        { decision: 'approved', comments: '' },
        REVIEWER_USER_ID,
        'credit_officer',
        IP,
        UA,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when document does not belong to supplier', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplier());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(null);

    await expect(
      service.reviewSupplierDocument(
        SUPPLIER_ID,
        DOC_ID,
        { decision: 'approved', comments: '' },
        REVIEWER_USER_ID,
        'credit_officer',
        IP,
        UA,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError on race: doc deleted between fetch and update', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplier());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDoc());
    mockedRepo.updateDocumentReview.mockResolvedValue(null);

    await expect(
      service.reviewSupplierDocument(
        SUPPLIER_ID,
        DOC_ID,
        { decision: 'approved', comments: '' },
        REVIEWER_USER_ID,
        'credit_officer',
        IP,
        UA,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
