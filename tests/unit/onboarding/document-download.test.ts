process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';

import * as fs from 'fs';
import * as service from '../../../src/services/onboarding/onboarding.service';
import * as repo from '../../../src/services/onboarding/onboarding.repository';
import { KycStatus } from '../../../src/services/onboarding/onboarding.types';
import type {
  SupplierRecord,
  DocumentRecord,
} from '../../../src/services/onboarding/onboarding.types';
import { ForbiddenError, NotFoundError, RisError } from '../../../src/shared/errors';
import * as cryptoModule from '../../../src/shared/crypto';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/services/onboarding/onboarding.repository');
jest.mock('fs');
jest.mock('../../../src/shared/crypto', () => {
  const actual = jest.requireActual<typeof cryptoModule>('../../../src/shared/crypto');
  return {
    ...actual,
    decrypt: jest.fn(),
    encrypt: jest.fn((s: string) => `enc:${s}`),
  };
});

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedDecrypt = cryptoModule.decrypt as jest.MockedFunction<typeof cryptoModule.decrypt>;

const DOC_ID = '11111111-2222-3333-4444-555555555555';
const SUPPLIER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OWNER_USER_ID = 'user-1';
const OTHER_USER_ID = 'user-OTHER';
const STAFF_USER_ID = 'staff-1';

function buildSupplierRecord(overrides: Partial<SupplierRecord> = {}): SupplierRecord {
  return {
    id: SUPPLIER_ID,
    user_id: OWNER_USER_ID,
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
    id: DOC_ID,
    invoice_id: null,
    supplier_id: SUPPLIER_ID,
    document_type: 'certificate_of_incorporation',
    encrypted_path: `${DOC_ID}.enc`,
    file_hash: 'hash',
    file_size_bytes: 1024,
    mime_type: 'application/pdf',
    uploaded_by: OWNER_USER_ID,
    created_at: '2026-02-01T10:00:00Z',
    expiry_date: null,
    review_status: 'pending',
    reviewed_by_user_id: null,
    reviewed_at: null,
    review_comments: null,
    ...overrides,
  };
}

// Plaintext payload encoded the same way the upload path stores it (base64).
const PLAINTEXT_BYTES = Buffer.from('%PDF-1.4 fake-pdf-bytes', 'utf8');
const PLAINTEXT_BASE64 = PLAINTEXT_BYTES.toString('base64');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('getSupplierDocumentFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('encrypted-blob-on-disk');
    mockedDecrypt.mockReturnValue(PLAINTEXT_BASE64);
  });

  it('returns the decrypted buffer + mime type for the owning supplier', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDocumentRecord());

    const result = await service.getSupplierDocumentFile(
      SUPPLIER_ID,
      DOC_ID,
      OWNER_USER_ID,
      'supplier',
    );

    expect(result.mimeType).toBe('application/pdf');
    expect(result.fileName).toBe('certificate_of_incorporation_11111111.pdf');
    expect(result.buffer.equals(PLAINTEXT_BYTES)).toBe(true);
    expect(mockedRepo.findDocumentByIdAndSupplier).toHaveBeenCalledWith(DOC_ID, SUPPLIER_ID);
  });

  it('falls back to user-id resolution when supplier passes their user.id', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);
    mockedRepo.findSupplierByUserId.mockResolvedValue(buildSupplierRecord());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDocumentRecord());

    const result = await service.getSupplierDocumentFile(
      OWNER_USER_ID,
      DOC_ID,
      OWNER_USER_ID,
      'supplier',
    );

    expect(result.mimeType).toBe('application/pdf');
    expect(mockedRepo.findSupplierByUserId).toHaveBeenCalledWith(OWNER_USER_ID);
  });

  it('throws NotFoundError when the document id is unknown', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(null);

    await expect(
      service.getSupplierDocumentFile(SUPPLIER_ID, DOC_ID, OWNER_USER_ID, 'supplier'),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError (no info leak) when the doc belongs to a different supplier', async () => {
    // Repo enforces (id, supplier_id) scoping, so a doc owned by another
    // supplier returns null even though the row exists. Service must surface
    // the same NotFoundError as a truly missing id — not Forbidden.
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(null);

    await expect(
      service.getSupplierDocumentFile(SUPPLIER_ID, DOC_ID, OWNER_USER_ID, 'supplier'),
    ).rejects.toThrow(NotFoundError);
  });

  it("forbids supplier B from fetching supplier A's document", async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord({ user_id: OWNER_USER_ID }));

    await expect(
      service.getSupplierDocumentFile(SUPPLIER_ID, DOC_ID, OTHER_USER_ID, 'supplier'),
    ).rejects.toThrow(ForbiddenError);

    // Hard rule: never reach the repo / disk if auth fails.
    expect(mockedRepo.findDocumentByIdAndSupplier).not.toHaveBeenCalled();
    expect(mockedFs.readFileSync).not.toHaveBeenCalled();
  });

  it("allows credit_officer to download any supplier's document", async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord({ user_id: OTHER_USER_ID }));
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDocumentRecord());

    const result = await service.getSupplierDocumentFile(
      SUPPLIER_ID,
      DOC_ID,
      STAFF_USER_ID,
      'credit_officer',
    );

    expect(result.buffer.equals(PLAINTEXT_BYTES)).toBe(true);
  });

  it("allows compliance_officer to download any supplier's document", async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord({ user_id: OTHER_USER_ID }));
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDocumentRecord());

    const result = await service.getSupplierDocumentFile(
      SUPPLIER_ID,
      DOC_ID,
      STAFF_USER_ID,
      'compliance_officer',
    );

    expect(result.mimeType).toBe('application/pdf');
  });

  it('allows auditor (read-only) to download for compliance review trails', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord({ user_id: OTHER_USER_ID }));
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDocumentRecord());

    const result = await service.getSupplierDocumentFile(
      SUPPLIER_ID,
      DOC_ID,
      STAFF_USER_ID,
      'auditor',
    );

    expect(result.mimeType).toBe('application/pdf');
  });

  it('forbids supplier role from downloading another supplier’s KYC docs', async () => {
    // finance_manager / auditor / legal were ADDED to the allowlist so they
    // can verify identity + bank docs before disbursement / audit / legal
    // case prep. The only restricted-role from outside that set is `supplier`
    // (they can only see their own docs) and any unknown role.
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord({ user_id: OTHER_USER_ID }));

    await expect(
      service.getSupplierDocumentFile(SUPPLIER_ID, DOC_ID, STAFF_USER_ID, 'supplier'),
    ).rejects.toThrow(ForbiddenError);
    expect(mockedRepo.findDocumentByIdAndSupplier).not.toHaveBeenCalled();
  });

  it('returns the correct extension for image/png documents', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(
      buildDocumentRecord({
        mime_type: 'image/png',
        document_type: 'id_document',
      }),
    );

    const result = await service.getSupplierDocumentFile(
      SUPPLIER_ID,
      DOC_ID,
      OWNER_USER_ID,
      'supplier',
    );

    expect(result.mimeType).toBe('image/png');
    expect(result.fileName).toBe('id_document_11111111.png');
  });

  it('throws NotFoundError when the encrypted blob is missing on disk', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDocumentRecord());
    mockedFs.existsSync.mockReturnValue(false);

    await expect(
      service.getSupplierDocumentFile(SUPPLIER_ID, DOC_ID, OWNER_USER_ID, 'supplier'),
    ).rejects.toThrow(NotFoundError);
  });

  it('wraps decrypt failures in DOCUMENT_DECRYPT_FAILED RisError', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(buildSupplierRecord());
    mockedRepo.findDocumentByIdAndSupplier.mockResolvedValue(buildDocumentRecord());
    mockedDecrypt.mockImplementation(() => {
      throw new Error('Invalid auth tag length');
    });

    await expect(
      service.getSupplierDocumentFile(SUPPLIER_ID, DOC_ID, OWNER_USER_ID, 'supplier'),
    ).rejects.toMatchObject({
      errorCode: 'DOCUMENT_DECRYPT_FAILED',
    });
    await expect(
      service.getSupplierDocumentFile(SUPPLIER_ID, DOC_ID, OWNER_USER_ID, 'supplier'),
    ).rejects.toBeInstanceOf(RisError);
  });

  it('throws NotFoundError for an unknown supplier id', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(
      service.getSupplierDocumentFile('sup-missing', DOC_ID, OWNER_USER_ID, 'supplier'),
    ).rejects.toThrow(NotFoundError);
  });
});
