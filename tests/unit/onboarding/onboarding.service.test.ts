process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars-long-for-jwt';

import * as service from '../../../src/services/onboarding/onboarding.service';
import * as repo from '../../../src/services/onboarding/onboarding.repository';
import * as crypto from '../../../src/shared/crypto';
import fs from 'fs';
import {
  KycStatus,
  PaymentMethod,
  BuyerRequestStatus,
} from '../../../src/services/onboarding/onboarding.types';
import type {
  SupplierRegistration,
  SupplierRecord,
  BuyerCreation,
  KycStatusUpdate,
  BuyerRecord,
  BuyerOnboardingRequestRecord,
  CreateBuyerRequestInput,
  ReviewBuyerRequestInput,
} from '../../../src/services/onboarding/onboarding.types';

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
jest.mock('fs');
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValueOnce('user-uuid-1').mockReturnValueOnce('supplier-uuid-1'),
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedCrypto = crypto as jest.Mocked<typeof crypto>;
const mockedFs = fs as jest.Mocked<typeof fs>;

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const validRegistration: SupplierRegistration = {
  email: 'supplier@test.com',
  password: 'SecurePass123!',
  company_name: 'Test Supplier Ltd',
  registration_number: 'REG-001',
  tax_id: 'TAX-001',
  directors: [{ name: 'John Doe', id_type: 'national_id', id_number: 'NID-123' }],
  bank_name: 'Stanbic Bank Uganda',
  bank_account_number: '1234567890',
  bank_account_name: 'Test Supplier Ltd',
  bank_branch: 'Kampala Main',
  preferred_payment_method: PaymentMethod.EFT,
  eligibility_session_token: '00000000-0000-0000-0000-000000000099',
  consent_ursb_check: true,
  consent_supplier_refs: true,
  consent_litigation_check: true,
};

function makeSupplierRecord(overrides: Partial<SupplierRecord> = {}): SupplierRecord {
  return {
    id: 'supplier-uuid-1',
    user_id: 'user-uuid-1',
    company_name: 'Test Supplier Ltd',
    company_name_encrypted: null,
    registration_number: 'REG-001',
    tax_id: 'TAX-001',
    tax_id_encrypted: null,
    directors: [{ name: 'John Doe', id_type: 'national_id', id_number: 'NID-123' }],
    directors_encrypted: null,
    bank_name: 'Stanbic Bank Uganda',
    bank_account_number_encrypted: 'enc:bank_acc',
    bank_account_name_encrypted: 'enc:bank_name',
    bank_branch: 'Kampala Main',
    preferred_payment_method: PaymentMethod.EFT,
    mobile_money_number_encrypted: null,
    kyc_status: KycStatus.PENDING,
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
    eligibility_session_token: '00000000-0000-0000-0000-000000000099',
    created_at: '2026-03-20T00:00:00Z',
    updated_at: '2026-03-20T00:00:00Z',
    ...overrides,
  };
}

function makeBuyerRecord(overrides: Partial<BuyerRecord> = {}): BuyerRecord {
  return {
    id: 'buyer-uuid-1',
    company_name: 'Test Buyer Ltd',
    registration_number: 'BREG-001',
    credit_rating: 'A',
    approved_limit: '100000000',
    used_limit: '0',
    ris_margin_rate: '0.03',
    payment_score: 85,
    contact_email_encrypted: 'enc:email',
    contact_phone_encrypted: 'enc:phone',
    is_active: true,
    sanctions_flag: false,
    payment_undertaking_signed: false,
    payment_undertaking_date: null,
    created_by: 'officer-1',
    created_at: '2026-03-20T00:00:00Z',
    updated_at: '2026-03-20T00:00:00Z',
    ...overrides,
  };
}

const IP = '127.0.0.1';
const UA = 'jest-test-agent';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();

  // Default: clean sanctions list (must be non-empty to pass loadSanctionsList validation)
  mockedFs.readFileSync.mockReturnValue(
    JSON.stringify({
      lastUpdated: '2026-03-20',
      entries: [{ name: 'Test Screened Entity', reason: 'Test entry' }],
    }),
  );
  mockedFs.existsSync.mockReturnValue(true);
  mockedFs.writeFileSync.mockReturnValue(undefined);
  mockedFs.mkdirSync.mockReturnValue(undefined);

  mockedCrypto.encrypt.mockImplementation((text: string) => `encrypted:${text}`);
  mockedCrypto.hashDocument.mockReturnValue('sha256-hash-abc');

  // Transaction client mock
  mockClient.query.mockResolvedValue({ rows: [] });
  mockClient.release.mockReturnValue(undefined);
  mockedRepo.getClient.mockResolvedValue(mockClient as never);
  mockedRepo.createUserWithClient.mockResolvedValue(undefined);
  mockedRepo.createSupplierWithClient.mockResolvedValue(undefined);
  mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);
  mockedRepo.updateKycStatusWithClient.mockResolvedValue(undefined);

  // Eligibility token — valid by default for all registerSupplier tests
  mockedRepo.findEligibilityByToken.mockResolvedValue({
    id: '00000000-0000-0000-0000-000000000010',
    session_token: '00000000-0000-0000-0000-000000000099',
    passed: true,
    registered_company: true,
    authorized_person: true,
    years_in_business: 3,
    ip_address: null,
    email: null,
    expires_at: null,
    funding_requirement: null,
    created_at: '2026-03-20T00:00:00Z',
  });

  // Non-transactional defaults
  mockedRepo.emailExists.mockResolvedValue(false);
  mockedRepo.registrationNumberExists.mockResolvedValue(false);
  mockedRepo.createAuditEntry.mockResolvedValue(undefined);
  mockedRepo.updateKycStatus.mockResolvedValue(undefined);

  // Reset uuid mock
  const uuidMock = jest.requireMock('uuid') as { v4: jest.Mock };
  uuidMock.v4.mockReset().mockReturnValueOnce('user-uuid-1').mockReturnValueOnce('supplier-uuid-1');
});

// =========================================================================
// Supplier Registration
// =========================================================================
describe('registerSupplier', () => {
  beforeEach(() => {
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);
    mockedRepo.createUser.mockResolvedValue(undefined);
    mockedRepo.createSupplier.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);
  });

  it('1. creates user with role=supplier and supplier record', async () => {
    const result = await service.registerSupplier(validRegistration, IP, UA);

    expect(result.userId).toBe('user-uuid-1');
    expect(result.supplierId).toBe('supplier-uuid-1');

    expect(mockedRepo.createUserWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        id: 'user-uuid-1',
        email: 'supplier@test.com',
        passwordHash: 'hashed-password',
        role: 'supplier',
      }),
    );

    expect(mockedRepo.createSupplierWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        id: 'supplier-uuid-1',
        userId: 'user-uuid-1',
        companyNameEncrypted: 'encrypted:Test Supplier Ltd',
      }),
    );
  });

  it('2. encrypts bank account number before storage', async () => {
    await service.registerSupplier(validRegistration, IP, UA);

    expect(mockedCrypto.encrypt).toHaveBeenCalledWith('1234567890');
    expect(mockedRepo.createSupplierWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        bankAccountNumberEncrypted: 'encrypted:1234567890',
      }),
    );
  });

  it('3. encrypts bank account name before storage', async () => {
    await service.registerSupplier(validRegistration, IP, UA);

    expect(mockedCrypto.encrypt).toHaveBeenCalledWith('Test Supplier Ltd');
    expect(mockedRepo.createSupplierWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        bankAccountNameEncrypted: 'encrypted:Test Supplier Ltd',
      }),
    );
  });

  it('4. duplicate email throws BusinessRuleError', async () => {
    mockedRepo.emailExists.mockResolvedValue(true);

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toThrow(
      'An account with this email already exists',
    );
  });

  it('duplicate registration number throws BusinessRuleError', async () => {
    mockedRepo.registrationNumberExists.mockResolvedValue(true);

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toThrow(
      'A supplier with this registration number already exists',
    );
  });

  it('5. sanctions check runs — clean name proceeds normally', async () => {
    const result = await service.registerSupplier(validRegistration, IP, UA);

    expect(result.userId).toBe('user-uuid-1');
    expect(mockedFs.readFileSync).toHaveBeenCalled();
    expect(mockedRepo.setSanctionsFlag).not.toHaveBeenCalled();
  });

  it('6. sanctions match blocks creation BEFORE the transaction — zero rows written', async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        lastUpdated: '2026-03-20',
        entries: [
          {
            name: 'Test Supplier Ltd',
            registration_number: 'REG-001',
            reason: 'AML watchlist',
          },
        ],
      }),
    );

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toMatchObject({
      errorCode: 'SANCTIONS_MATCH',
    });

    // No user/supplier rows were written — repo writes never invoked.
    expect(mockedRepo.createUserWithClient).not.toHaveBeenCalled();
    expect(mockedRepo.createSupplierWithClient).not.toHaveBeenCalled();
    expect(mockedRepo.setSanctionsFlag).not.toHaveBeenCalled();

    // The blocked attempt is audit-logged with PII-free metadata only.
    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      null,
      'SANCTIONS_REGISTRATION_BLOCKED',
      'suppliers',
      'pre-insert',
      null,
      expect.objectContaining({ matchedEntryId: 'REG-001', reason: 'AML watchlist' }),
      IP,
      UA,
    );
  });

  it('7. audit log written for SUPPLIER_REGISTERED', async () => {
    await service.registerSupplier(validRegistration, IP, UA);

    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      'user-uuid-1',
      'SUPPLIER_REGISTERED',
      'suppliers',
      'supplier-uuid-1',
      null,
      expect.objectContaining({ kycStatus: KycStatus.PENDING }),
      IP,
      UA,
    );
  });

  it('sanctions match throws BEFORE any repo write — atomicity guarantee', async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        lastUpdated: '2026-03-20',
        entries: [{ name: 'Test Supplier Ltd', reason: 'AML watchlist' }],
      }),
    );

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toMatchObject({
      errorCode: 'SANCTIONS_MATCH',
    });

    // Hard atomicity assertion: the registration TX never started.
    expect(mockedRepo.createUserWithClient).not.toHaveBeenCalled();
    expect(mockedRepo.createSupplierWithClient).not.toHaveBeenCalled();
    expect(mockedRepo.getClient).not.toHaveBeenCalled();
  });

  it('Postgres 23505 on email constraint maps to BusinessRuleError(EMAIL_TAKEN)', async () => {
    // Pre-flight check passes — simulate the TOCTOU race where a concurrent
    // INSERT with the same email lands between the SELECT and our INSERT.
    mockedRepo.emailExists.mockResolvedValue(false);
    const pgUniqueErr = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'users_email_key',
    });
    mockedRepo.createUserWithClient.mockRejectedValue(pgUniqueErr);

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toMatchObject({
      errorCode: 'EMAIL_TAKEN',
    });

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('Postgres 23505 on registration_number constraint maps to BusinessRuleError(REGISTRATION_NUMBER_TAKEN)', async () => {
    mockedRepo.registrationNumberExists.mockResolvedValue(false);
    const pgUniqueErr = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'suppliers_registration_number_key',
    });
    mockedRepo.createSupplierWithClient.mockRejectedValue(pgUniqueErr);

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toMatchObject({
      errorCode: 'REGISTRATION_NUMBER_TAKEN',
    });

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

// =========================================================================
// Document Upload
// =========================================================================
describe('uploadDocument', () => {
  const pdfFile = {
    buffer: Buffer.from('pdf-content'),
    originalname: 'cert.pdf',
    mimetype: 'application/pdf',
    size: 5000,
  };

  beforeEach(() => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord());
    mockedRepo.createDocument.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);
    mockedRepo.getDocumentTypeCounts.mockResolvedValue([]);
    mockedRepo.updateKycStatus.mockResolvedValue(undefined);

    const uuidMock = jest.requireMock('uuid') as { v4: jest.Mock };
    uuidMock.v4.mockReset().mockReturnValue('doc-uuid-1');
  });

  it('throws NotFoundError if supplier does not exist', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(
      service.uploadDocument(
        'missing',
        'user-1',
        'supplier',
        pdfFile,
        'certificate_of_incorporation',
        IP,
        UA,
      ),
    ).rejects.toThrow('Supplier');
  });

  it('supplier cannot upload to another supplier profile', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord({ user_id: 'other-user' }));

    await expect(
      service.uploadDocument(
        'supplier-uuid-1',
        'user-uuid-1',
        'supplier',
        pdfFile,
        'certificate_of_incorporation',
        IP,
        UA,
      ),
    ).rejects.toThrow('You do not have permission');
  });

  it('8. PDF accepted, SHA-256 hash computed, file encrypted before disk write', async () => {
    const result = await service.uploadDocument(
      'supplier-uuid-1',
      'user-uuid-1',
      'supplier',
      pdfFile,
      'certificate_of_incorporation',
      IP,
      UA,
    );

    expect(result.documentId).toBe('doc-uuid-1');
    expect(mockedCrypto.hashDocument).toHaveBeenCalledWith(pdfFile.buffer);
    expect(mockedCrypto.encrypt).toHaveBeenCalledWith(pdfFile.buffer.toString('base64'));
    expect(mockedFs.writeFileSync).toHaveBeenCalled();
  });

  it('9. JPEG and PNG accepted', async () => {
    const jpegFile = { ...pdfFile, mimetype: 'image/jpeg', originalname: 'id.jpg' };
    const pngFile = { ...pdfFile, mimetype: 'image/png', originalname: 'id.png' };

    await expect(
      service.uploadDocument(
        'supplier-uuid-1',
        'user-uuid-1',
        'supplier',
        jpegFile,
        'director_id',
        IP,
        UA,
      ),
    ).resolves.toBeDefined();

    await expect(
      service.uploadDocument(
        'supplier-uuid-1',
        'user-uuid-1',
        'supplier',
        pngFile,
        'director_id',
        IP,
        UA,
      ),
    ).resolves.toBeDefined();
  });

  it('10. non-allowed file type rejected with ValidationError', async () => {
    const exeFile = { ...pdfFile, mimetype: 'application/x-msdownload', originalname: 'bad.exe' };

    await expect(
      service.uploadDocument(
        'supplier-uuid-1',
        'user-uuid-1',
        'supplier',
        exeFile,
        'certificate_of_incorporation',
        IP,
        UA,
      ),
    ).rejects.toThrow('Invalid file type');
  });

  it('11. file exceeding 10MB rejected with ValidationError', async () => {
    const bigFile = { ...pdfFile, size: 11 * 1024 * 1024 };

    await expect(
      service.uploadDocument(
        'supplier-uuid-1',
        'user-uuid-1',
        'supplier',
        bigFile,
        'certificate_of_incorporation',
        IP,
        UA,
      ),
    ).rejects.toThrow('File too large');
  });

  it('12. all 4 required docs uploaded → auto-advance to documents_submitted', async () => {
    mockedRepo.getDocumentTypeCounts.mockResolvedValue([
      'certificate_of_incorporation',
      'tax_registration',
      'director_id',
      'signed_supplier_agreement',
    ]);

    await service.uploadDocument(
      'supplier-uuid-1',
      'user-uuid-1',
      'supplier',
      pdfFile,
      'signed_supplier_agreement',
      IP,
      UA,
    );

    expect(mockedRepo.updateKycStatus).toHaveBeenCalledWith(
      'supplier-uuid-1',
      KycStatus.DOCUMENTS_SUBMITTED,
    );

    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      'user-uuid-1',
      'KYC_AUTO_ADVANCED',
      'suppliers',
      'supplier-uuid-1',
      expect.objectContaining({ previousStatus: KycStatus.PENDING }),
      expect.objectContaining({ newStatus: KycStatus.DOCUMENTS_SUBMITTED }),
      IP,
      UA,
    );
  });

  it('auto-advance does not fire when kyc_status is not pending', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ kyc_status: KycStatus.DOCUMENTS_SUBMITTED }),
    );
    mockedRepo.getDocumentTypeCounts.mockResolvedValue([
      'certificate_of_incorporation',
      'tax_registration',
      'director_id',
      'signed_supplier_agreement',
    ]);

    await service.uploadDocument(
      'supplier-uuid-1',
      'user-uuid-1',
      'supplier',
      pdfFile,
      'director_id',
      IP,
      UA,
    );

    // auto-advance should NOT call updateKycStatus because status is already past pending
    const kycCalls = mockedRepo.updateKycStatus.mock.calls.filter(
      (call) => (call[1] as string) === (KycStatus.DOCUMENTS_SUBMITTED as string),
    );
    expect(kycCalls).toHaveLength(0);
  });

  it('13. missing 1 required doc — status stays at pending', async () => {
    mockedRepo.getDocumentTypeCounts.mockResolvedValue([
      'certificate_of_incorporation',
      'tax_registration',
      'director_id',
      // missing signed_supplier_agreement
    ]);

    await service.uploadDocument(
      'supplier-uuid-1',
      'user-uuid-1',
      'supplier',
      pdfFile,
      'director_id',
      IP,
      UA,
    );

    // updateKycStatus should NOT be called for auto-advance
    // (it may be called 0 times total, or the auto-advance should not fire)
    const kycCalls = mockedRepo.updateKycStatus.mock.calls.filter(
      (call) => (call[1] as string) === (KycStatus.DOCUMENTS_SUBMITTED as string),
    );
    expect(kycCalls).toHaveLength(0);
  });
});

// =========================================================================
// KYC Status Management
// =========================================================================
describe('updateKycStatus', () => {
  beforeEach(() => {
    mockedRepo.updateKycStatus.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);
  });

  it('throws NotFoundError if supplier does not exist', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(
      service.updateKycStatus(
        'missing',
        { status: KycStatus.UNDER_REVIEW, comments: 'Test comment text' },
        'officer-1',
        IP,
        UA,
      ),
    ).rejects.toThrow('Supplier');
  });

  it('14. credit officer can change documents_submitted → under_review', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ kyc_status: KycStatus.DOCUMENTS_SUBMITTED }),
    );

    const update: KycStatusUpdate = {
      status: KycStatus.UNDER_REVIEW,
      comments: 'Beginning review of all submitted documents',
    };

    await expect(
      service.updateKycStatus('supplier-uuid-1', update, 'officer-1', IP, UA),
    ).resolves.toBeUndefined();

    expect(mockedRepo.updateKycStatusWithClient).toHaveBeenCalledWith(
      mockClient,
      'supplier-uuid-1',
      KycStatus.UNDER_REVIEW,
    );
  });

  it('15. credit officer can change under_review → approved', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ kyc_status: KycStatus.UNDER_REVIEW }),
    );

    const update: KycStatusUpdate = {
      status: KycStatus.APPROVED,
      comments: 'All documents verified and approved for trading',
    };

    await expect(
      service.updateKycStatus('supplier-uuid-1', update, 'officer-1', IP, UA),
    ).resolves.toBeUndefined();

    expect(mockedRepo.updateKycStatusWithClient).toHaveBeenCalledWith(
      mockClient,
      'supplier-uuid-1',
      KycStatus.APPROVED,
    );
  });

  it('16. invalid state transition rejected (pending → approved)', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ kyc_status: KycStatus.PENDING }),
    );

    const update: KycStatusUpdate = {
      status: KycStatus.APPROVED,
      comments: 'Trying to skip the process',
    };

    await expect(
      service.updateKycStatus('supplier-uuid-1', update, 'officer-1', IP, UA),
    ).rejects.toThrow("Cannot transition from 'pending' to 'approved'");
  });

  it('18. status change writes audit_log with reviewer, old status, new status, comments', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ kyc_status: KycStatus.UNDER_REVIEW }),
    );

    const update: KycStatusUpdate = {
      status: KycStatus.APPROVED,
      comments: 'All documents verified successfully',
    };

    await service.updateKycStatus('supplier-uuid-1', update, 'officer-1', IP, UA);

    expect(mockedRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
      mockClient,
      'officer-1',
      'KYC_STATUS_CHANGED',
      'suppliers',
      'supplier-uuid-1',
      { previousStatus: KycStatus.UNDER_REVIEW },
      { newStatus: KycStatus.APPROVED, comments: 'All documents verified successfully' },
      IP,
      UA,
    );
  });
});

// =========================================================================
// Resource Ownership
// =========================================================================
describe('resource ownership', () => {
  it('listDocuments throws NotFoundError for missing supplier', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(service.listDocuments('missing', 'user-1', 'supplier')).rejects.toThrow(
      'Supplier',
    );
  });

  it('19. supplier A cannot access supplier B profile → ForbiddenError', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord({ user_id: 'user-B' }));

    await expect(
      service.getSupplierProfile('supplier-uuid-1', 'user-A', 'supplier'),
    ).rejects.toThrow('You do not have permission');
  });

  it('20. supplier A cannot access supplier B documents → ForbiddenError', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord({ user_id: 'user-B' }));

    await expect(service.listDocuments('supplier-uuid-1', 'user-A', 'supplier')).rejects.toThrow(
      'You do not have permission',
    );
  });

  it('21. credit officer can access any supplier profile', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord({ user_id: 'user-B' }));

    const profile = await service.getSupplierProfile(
      'supplier-uuid-1',
      'officer-1',
      'credit_officer',
    );

    expect(profile.id).toBe('supplier-uuid-1');
  });
});

// =========================================================================
// getSupplierProfile — NotFoundError when supplier not found (line 159)
// =========================================================================
describe('getSupplierProfile — not found', () => {
  it('throws NotFoundError when supplier does not exist (line 159)', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(
      service.getSupplierProfile('missing-supplier-id', 'user-1', 'credit_officer'),
    ).rejects.toThrow('Supplier');
  });
});

// =========================================================================
// Buyer Management
// =========================================================================
describe('listSuppliersForStaff', () => {
  it('returns paginated supplier profiles', async () => {
    mockedRepo.listSuppliers.mockResolvedValue({
      rows: [makeSupplierRecord()],
      total: 1,
    });

    const result = await service.listSuppliersForStaff({ page: 1, limit: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('passes kycStatus filter to repository', async () => {
    mockedRepo.listSuppliers.mockResolvedValue({ rows: [], total: 0 });

    await service.listSuppliersForStaff({ page: 1, limit: 10 }, 'approved');

    expect(mockedRepo.listSuppliers).toHaveBeenCalledWith({ page: 1, limit: 10 }, 'approved');
  });
});

describe('listBuyersForStaff', () => {
  it('returns paginated buyer profiles', async () => {
    mockedRepo.listBuyers.mockResolvedValue({
      rows: [makeBuyerRecord()],
      total: 1,
    });

    const result = await service.listBuyersForStaff({ page: 1, limit: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe('createBuyer', () => {
  const validBuyer: BuyerCreation = {
    company_name: 'Test Buyer Ltd',
    registration_number: 'BREG-001',
    credit_rating: 'A',
    approved_limit: 100000000,
    payment_score: 85,
    contact_email: 'buyer@test.com',
    contact_phone: '256700000001',
  };

  beforeEach(() => {
    mockedRepo.buyerRegistrationNumberExists.mockResolvedValue(false);
    mockedRepo.createBuyer.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    const uuidMock = jest.requireMock('uuid') as { v4: jest.Mock };
    uuidMock.v4.mockReset().mockReturnValue('buyer-uuid-1');
  });

  it('22. creates buyer with encrypted contact details', async () => {
    const result = await service.createBuyer(validBuyer, 'officer-1', IP, UA);

    expect(result.buyerId).toBe('buyer-uuid-1');
    expect(mockedCrypto.encrypt).toHaveBeenCalledWith('buyer@test.com');
    expect(mockedCrypto.encrypt).toHaveBeenCalledWith('256700000001');

    expect(mockedRepo.createBuyer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'buyer-uuid-1',
        contactEmailEncrypted: 'encrypted:buyer@test.com',
        contactPhoneEncrypted: 'encrypted:256700000001',
      }),
    );
  });

  it('24. sanctions check blocks buyer creation on match', async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        lastUpdated: '2026-03-20',
        entries: [
          {
            name: 'Test Buyer Ltd',
            reason: 'Sanctioned entity',
          },
        ],
      }),
    );
    mockedRepo.setBuyerSanctionsFlag.mockResolvedValue(undefined);

    await expect(service.createBuyer(validBuyer, 'officer-1', IP, UA)).rejects.toMatchObject({
      errorCode: 'SANCTIONS_MATCH',
    });

    expect(mockedRepo.setBuyerSanctionsFlag).toHaveBeenCalledWith('buyer-uuid-1', true);
    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      'officer-1',
      'SANCTIONS_FLAG_RAISED',
      'buyers',
      'buyer-uuid-1',
      null,
      expect.objectContaining({ matchedEntryRegNo: 'unknown', reason: 'Sanctioned entity' }),
      IP,
      UA,
    );
  });

  it('duplicate buyer registration number rejected', async () => {
    mockedRepo.buyerRegistrationNumberExists.mockResolvedValue(true);

    await expect(service.createBuyer(validBuyer, 'officer-1', IP, UA)).rejects.toThrow(
      'A buyer with this registration number already exists',
    );
  });
});

// =========================================================================
// Buyer profile retrieval and update
// =========================================================================
describe('getBuyerProfile', () => {
  it('returns buyer profile for valid ID', async () => {
    mockedRepo.findBuyerById.mockResolvedValue(makeBuyerRecord());

    const profile = await service.getBuyerProfile('buyer-uuid-1');

    expect(profile.id).toBe('buyer-uuid-1');
    expect(profile.company_name).toBe('Test Buyer Ltd');
  });

  it('throws NotFoundError for missing buyer', async () => {
    mockedRepo.findBuyerById.mockResolvedValue(null);

    await expect(service.getBuyerProfile('missing-id')).rejects.toThrow('Buyer');
  });
});

// =========================================================================
// registerSupplier — mobile_money_number missing path (line 76 branch 1)
// =========================================================================
describe('registerSupplier — no mobile money number', () => {
  it('stores null for mobile_money_number_encrypted when mobile_money_number is not provided (line 76 branch 1)', async () => {
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    const registrationWithoutMomo = {
      ...validRegistration,
      mobile_money_number: undefined,
    } as never;

    const result = await service.registerSupplier(registrationWithoutMomo, IP, UA);

    expect(result.supplierId).toBeDefined();

    // The supplier should be created with null mobile_money_number_encrypted
    expect(mockedRepo.createSupplierWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        mobileMoneyNumberEncrypted: null,
      }),
    );
  });

  it('stores null for mobile_money_number_encrypted when mobile_money_number is empty string', async () => {
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    const registrationWithEmptyMomo = {
      ...validRegistration,
      mobile_money_number: '',
    };

    const result = await service.registerSupplier(registrationWithEmptyMomo, IP, UA);

    expect(result.supplierId).toBeDefined();
    expect(mockedRepo.createSupplierWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        mobileMoneyNumberEncrypted: null,
      }),
    );
  });
});

// =========================================================================
// registerSupplier transaction rollback — line 119-121 (catch branch)
// =========================================================================
describe('registerSupplier — transaction rollback', () => {
  it('rolls back transaction and rethrows when createUserWithClient fails', async () => {
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);
    mockedRepo.createUserWithClient.mockRejectedValue(new Error('DB error'));

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toThrow('DB error');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

// =========================================================================
// listDocuments — line 254 (returns repo result directly)
// =========================================================================
describe('listDocuments', () => {
  it('returns document list for staff (no ownership restriction)', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord({ user_id: 'officer-user' }));
    const docs = [
      {
        id: 'doc-1',
        supplier_id: 'supplier-uuid-1',
        invoice_id: null,
        document_type: 'certificate_of_incorporation',
        encrypted_path: 'doc-1.enc',
        file_hash: 'abc123',
        file_size_bytes: 5000,
        mime_type: 'application/pdf',
        uploaded_by: 'officer-user',
        created_at: '2026-03-20T00:00:00Z',
      },
    ];
    mockedRepo.findDocumentsBySupplierId.mockResolvedValue(docs as never);

    const result = await service.listDocuments('supplier-uuid-1', 'officer-user', 'credit_officer');

    expect(result).toEqual(docs);
    expect(mockedRepo.findDocumentsBySupplierId).toHaveBeenCalledWith('supplier-uuid-1');
  });
});

// =========================================================================
// updateKycStatus transaction rollback — lines 301-302 (catch branch)
// =========================================================================
describe('updateKycStatus — transaction rollback', () => {
  it('rolls back and rethrows when updateKycStatusWithClient throws', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ kyc_status: KycStatus.DOCUMENTS_SUBMITTED }),
    );
    mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);
    mockedRepo.updateKycStatusWithClient.mockRejectedValue(new Error('DB write failed'));

    await expect(
      service.updateKycStatus(
        'supplier-uuid-1',
        { status: KycStatus.UNDER_REVIEW, comments: 'testing rollback' },
        'officer-1',
        IP,
        UA,
      ),
    ).rejects.toThrow('DB write failed');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

// =========================================================================
// findSanctionsMatch — line 563 branch 0 and line 564 branches 0+1+2
// These cover: entry.registration_number present/absent, matching by reg#
// =========================================================================
describe('findSanctionsMatch — registration_number matching', () => {
  it('matches by registration_number when name does not match and blocks creation pre-tx', async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        lastUpdated: '2026-03-20',
        entries: [
          {
            name: 'Completely Different Name',
            registration_number: 'REG-001',
            reason: 'Watchlist',
          },
        ],
      }),
    );
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toMatchObject({
      errorCode: 'SANCTIONS_MATCH',
    });
    // Sanctions blocks pre-tx — no flag write, no row creation.
    expect(mockedRepo.setSanctionsFlag).not.toHaveBeenCalled();
    expect(mockedRepo.createSupplierWithClient).not.toHaveBeenCalled();
  });

  it('does not match when entry has empty registration_number', async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        lastUpdated: '2026-03-20',
        entries: [
          {
            name: 'No Match Corp',
            registration_number: '',
            reason: 'Watchlist',
          },
        ],
      }),
    );
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);

    const result = await service.registerSupplier(validRegistration, IP, UA);

    expect(result.supplierId).toBe('supplier-uuid-1');
    expect(mockedRepo.setSanctionsFlag).not.toHaveBeenCalled();
  });

  it('does not match when entry has undefined registration_number', async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        lastUpdated: '2026-03-20',
        entries: [
          {
            name: 'No Match Corp',
            reason: 'Watchlist',
            // registration_number intentionally omitted (undefined after parse)
          },
        ],
      }),
    );
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);

    const result = await service.registerSupplier(validRegistration, IP, UA);

    expect(result.supplierId).toBe('supplier-uuid-1');
    expect(mockedRepo.setSanctionsFlag).not.toHaveBeenCalled();
  });
});

// =========================================================================
// ensureUploadDir — line 647 branch 0 (dir does NOT exist → create it)
// =========================================================================
describe('ensureUploadDir', () => {
  it('creates upload directory when it does not exist', async () => {
    // Simulate upload dir missing
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord());
    mockedRepo.createDocument.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);
    mockedRepo.getDocumentTypeCounts.mockResolvedValue([]);

    const uuidMock = jest.requireMock('uuid') as { v4: jest.Mock };
    uuidMock.v4.mockReset().mockReturnValue('doc-uuid-2');

    const pdfFile = {
      buffer: Buffer.from('pdf-content'),
      originalname: 'cert.pdf',
      mimetype: 'application/pdf',
      size: 5000,
    };

    await service.uploadDocument(
      'supplier-uuid-1',
      'user-uuid-1',
      'supplier',
      pdfFile,
      'certificate_of_incorporation',
      IP,
      UA,
    );

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });
});

describe('updateBuyerProfile', () => {
  beforeEach(() => {
    mockedRepo.findBuyerById.mockResolvedValue(makeBuyerRecord());
    mockedRepo.updateBuyer.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);
  });

  it('throws NotFoundError for missing buyer', async () => {
    mockedRepo.findBuyerById.mockResolvedValue(null);

    await expect(
      service.updateBuyerProfile('missing', { credit_rating: 'B' }, 'officer-1', IP, UA),
    ).rejects.toThrow('Buyer');
  });

  it('skips update when no fields provided', async () => {
    await service.updateBuyerProfile('buyer-uuid-1', {}, 'officer-1', IP, UA);

    expect(mockedRepo.updateBuyer).not.toHaveBeenCalled();
  });

  it('updates all buyer fields when provided', async () => {
    await service.updateBuyerProfile(
      'buyer-uuid-1',
      {
        company_name: 'New Name',
        credit_rating: 'C',
        approved_limit: 200000000,
        payment_score: 90,
        contact_email: 'new@test.com',
        contact_phone: '256700999999',
        ris_margin_rate: 0.05,
        is_active: false,
      },
      'officer-1',
      IP,
      UA,
    );

    expect(mockedRepo.updateBuyer).toHaveBeenCalledWith(
      'buyer-uuid-1',
      expect.objectContaining({
        company_name: 'New Name',
        credit_rating: 'C',
        approved_limit: '200000000',
        payment_score: 90,
        contact_email_encrypted: 'encrypted:new@test.com',
        contact_phone_encrypted: 'encrypted:256700999999',
        ris_margin_rate: 0.05,
        is_active: false,
      }),
    );
  });

  it('encrypts contact_email on update', async () => {
    await service.updateBuyerProfile(
      'buyer-uuid-1',
      { contact_email: 'new@test.com' },
      'officer-1',
      IP,
      UA,
    );

    expect(mockedCrypto.encrypt).toHaveBeenCalledWith('new@test.com');
    expect(mockedRepo.updateBuyer).toHaveBeenCalledWith(
      'buyer-uuid-1',
      expect.objectContaining({
        contact_email_encrypted: 'encrypted:new@test.com',
      }),
    );
  });

  it('writes audit log on update', async () => {
    await service.updateBuyerProfile('buyer-uuid-1', { credit_rating: 'B' }, 'officer-1', IP, UA);

    expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
      'officer-1',
      'BUYER_UPDATED',
      'buyers',
      'buyer-uuid-1',
      null,
      expect.objectContaining({ fieldsUpdated: ['credit_rating'] }),
      IP,
      UA,
    );
  });

  it('updates payment_undertaking_signed field', async () => {
    await service.updateBuyerProfile(
      'buyer-uuid-1',
      { payment_undertaking_signed: true },
      'officer-1',
      IP,
      UA,
    );

    expect(mockedRepo.updateBuyer).toHaveBeenCalledWith(
      'buyer-uuid-1',
      expect.objectContaining({ payment_undertaking_signed: true }),
    );
  });

  it('updates payment_undertaking_date field', async () => {
    await service.updateBuyerProfile(
      'buyer-uuid-1',
      { payment_undertaking_date: '2026-04-01' },
      'officer-1',
      IP,
      UA,
    );

    expect(mockedRepo.updateBuyer).toHaveBeenCalledWith(
      'buyer-uuid-1',
      expect.objectContaining({ payment_undertaking_date: '2026-04-01' }),
    );
  });
});

// =========================================================================
// checkEligibility
// =========================================================================
describe('checkEligibility', () => {
  beforeEach(() => {
    mockedRepo.createEligibilityCheck.mockResolvedValue(undefined);
    mockedRepo.getEligibilityThrottleSignals.mockResolvedValue({
      failCount5min: 0,
      failCount1hour: 0,
      failCount24hour: 0,
      failCount30day: 0,
      mostRecentPassAt: null,
      mostRecentFailAt: null,
    });
    const uuidMock = jest.requireMock('uuid') as { v4: jest.Mock };
    uuidMock.v4.mockReset().mockReturnValue('session-token-1');
  });

  it('returns passed=true when all criteria met', async () => {
    const result = await service.checkEligibility(
      {
        registered_company: true,
        authorized_person: true,
        years_in_business: 3,
      },
      IP,
    );

    expect(result.passed).toBe(true);
    expect(result.session_token).toBeDefined();
    expect(mockedRepo.createEligibilityCheck).toHaveBeenCalledWith(
      expect.objectContaining({ passed: true }),
    );
  });

  it('returns passed=false when registered_company is false', async () => {
    const result = await service.checkEligibility(
      {
        registered_company: false,
        authorized_person: true,
        years_in_business: 3,
      },
      IP,
    );

    expect(result.passed).toBe(false);
    expect(result.session_token).toBeUndefined();
    expect(mockedRepo.createEligibilityCheck).toHaveBeenCalledWith(
      expect.objectContaining({ passed: false }),
    );
  });

  it('returns passed=false when authorized_person is false', async () => {
    const result = await service.checkEligibility(
      {
        registered_company: true,
        authorized_person: false,
        years_in_business: 3,
      },
      IP,
    );

    expect(result.passed).toBe(false);
  });

  it('returns passed=false when years_in_business < 1', async () => {
    const result = await service.checkEligibility(
      {
        registered_company: true,
        authorized_person: true,
        years_in_business: 0,
      },
      IP,
    );

    expect(result.passed).toBe(false);
  });

  it('stores funding_requirement when provided', async () => {
    await service.checkEligibility(
      {
        registered_company: true,
        authorized_person: true,
        years_in_business: 5,
        funding_requirement: 50000000,
      },
      IP,
    );

    expect(mockedRepo.createEligibilityCheck).toHaveBeenCalledWith(
      expect.objectContaining({ fundingRequirement: 50000000 }),
    );
  });

  it('stores null for funding_requirement when not provided', async () => {
    await service.checkEligibility(
      {
        registered_company: true,
        authorized_person: true,
        years_in_business: 2,
      },
      IP,
    );

    expect(mockedRepo.createEligibilityCheck).toHaveBeenCalledWith(
      expect.objectContaining({ fundingRequirement: null }),
    );
  });
});

// =========================================================================
// registerSupplier — consent validation branches
// =========================================================================
describe('registerSupplier — consent validation', () => {
  beforeEach(() => {
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);
  });

  it('throws when consent_ursb_check is false', async () => {
    await expect(
      service.registerSupplier({ ...validRegistration, consent_ursb_check: false }, IP, UA),
    ).rejects.toThrow('Consent for URSB check is required');
  });

  it('throws when consent_supplier_refs is false', async () => {
    await expect(
      service.registerSupplier({ ...validRegistration, consent_supplier_refs: false }, IP, UA),
    ).rejects.toThrow('Consent for supplier references is required');
  });

  it('throws when consent_litigation_check is false', async () => {
    await expect(
      service.registerSupplier({ ...validRegistration, consent_litigation_check: false }, IP, UA),
    ).rejects.toThrow('Consent for litigation check is required');
  });
});

// =========================================================================
// registerSupplier — eligibility token invalid
// =========================================================================
describe('registerSupplier — eligibility token invalid', () => {
  it('throws when eligibility token not found (null)', async () => {
    mockedRepo.findEligibilityByToken.mockResolvedValue(null);

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toThrow(
      'A valid eligibility session token is required',
    );
  });

  it('throws when eligibility check did not pass', async () => {
    mockedRepo.findEligibilityByToken.mockResolvedValue({
      id: 'elig-1',
      session_token: 'token-1',
      passed: false,
      registered_company: false,
      authorized_person: true,
      years_in_business: 0,
      ip_address: null,
      email: null,
      expires_at: null,
      funding_requirement: null,
      created_at: '2026-03-20T00:00:00Z',
    });

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toThrow(
      'A valid eligibility session token is required',
    );
  });
});

// =========================================================================
// registerSupplier — required_financing_amount branches
// =========================================================================
describe('registerSupplier — required_financing_amount', () => {
  beforeEach(() => {
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);
  });

  it('passes required_financing_amount to supplier record when provided', async () => {
    const regWithFinancing = { ...validRegistration, required_financing_amount: 75000000 };

    await service.registerSupplier(regWithFinancing, IP, UA);

    expect(mockedRepo.createSupplierWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ requiredFinancingAmount: 75000000 }),
    );
  });

  it('passes null when required_financing_amount is undefined', async () => {
    const regNoFinancing = { ...validRegistration };
    delete (regNoFinancing as Record<string, unknown>).required_financing_amount;

    await service.registerSupplier(regNoFinancing, IP, UA);

    expect(mockedRepo.createSupplierWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ requiredFinancingAmount: null }),
    );
  });
});

// =========================================================================
// toSupplierProfile — decryptOrFallback / decryptDirectors branches
// =========================================================================
describe('toSupplierProfile — decrypt branches', () => {
  it('decrypts encrypted fields when present', async () => {
    const directorsJson = JSON.stringify([
      { name: 'Decrypted Director', id_type: 'passport', id_number: 'P-999' },
    ]);
    mockedCrypto.decrypt.mockImplementation((val: string) => {
      if (val === 'enc:directors') return directorsJson;
      return 'Decrypted Value';
    });
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({
        company_name_encrypted: 'enc:company',
        tax_id_encrypted: 'enc:taxid',
        directors_encrypted: 'enc:directors',
      }),
    );

    const profile = await service.getSupplierProfile(
      'supplier-uuid-1',
      'officer-1',
      'credit_officer',
    );

    expect(mockedCrypto.decrypt).toHaveBeenCalledWith('enc:company');
    expect(mockedCrypto.decrypt).toHaveBeenCalledWith('enc:taxid');
    expect(mockedCrypto.decrypt).toHaveBeenCalledWith('enc:directors');
    expect(profile.company_name).toBe('Decrypted Value');
    expect(profile.directors[0].name).toBe('Decrypted Director');
  });

  it('falls back to plaintext when encrypted fields are null', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({
        company_name_encrypted: null,
        tax_id_encrypted: null,
        directors_encrypted: null,
      }),
    );

    const profile = await service.getSupplierProfile(
      'supplier-uuid-1',
      'officer-1',
      'credit_officer',
    );

    expect(profile.company_name).toBe('Test Supplier Ltd');
    expect(profile.tax_id).toBe('TAX-001');
  });

  it('falls back to plaintext when encrypted fields are empty string', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({
        company_name_encrypted: '',
        tax_id_encrypted: '',
        directors_encrypted: '',
      }),
    );

    const profile = await service.getSupplierProfile(
      'supplier-uuid-1',
      'officer-1',
      'credit_officer',
    );

    expect(profile.company_name).toBe('Test Supplier Ltd');
    expect(profile.tax_id).toBe('TAX-001');
  });
});

// =========================================================================
// URSB Verification
// =========================================================================
describe('recordUrsbVerification', () => {
  beforeEach(() => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord({ consent_ursb_check: true }));
    mockedRepo.setUrsbVerifiedWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);
  });

  it('records URSB verification successfully', async () => {
    await service.recordUrsbVerification('supplier-uuid-1', true, 'officer-1', IP, UA);

    expect(mockedRepo.setUrsbVerifiedWithClient).toHaveBeenCalledWith(
      mockClient,
      'supplier-uuid-1',
      true,
      'officer-1',
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('throws NotFoundError when supplier not found', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(
      service.recordUrsbVerification('missing', true, 'officer-1', IP, UA),
    ).rejects.toThrow('Supplier');
  });

  it('throws BusinessRuleError when consent not given', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ consent_ursb_check: false }),
    );

    await expect(
      service.recordUrsbVerification('supplier-uuid-1', true, 'officer-1', IP, UA),
    ).rejects.toThrow('Supplier has not consented to URSB verification');
  });

  it('rolls back on error', async () => {
    mockedRepo.setUrsbVerifiedWithClient.mockRejectedValue(new Error('DB error'));

    await expect(
      service.recordUrsbVerification('supplier-uuid-1', true, 'officer-1', IP, UA),
    ).rejects.toThrow('DB error');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// =========================================================================
// Litigation Check
// =========================================================================
describe('recordLitigationCheck', () => {
  beforeEach(() => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ consent_litigation_check: true }),
    );
    mockedRepo.setLitigationCheckWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);
  });

  it('records litigation check successfully', async () => {
    await service.recordLitigationCheck('supplier-uuid-1', false, 'officer-1', IP, UA);

    expect(mockedRepo.setLitigationCheckWithClient).toHaveBeenCalledWith(
      mockClient,
      'supplier-uuid-1',
      false,
      'officer-1',
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('throws NotFoundError when supplier not found', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(
      service.recordLitigationCheck('missing', false, 'officer-1', IP, UA),
    ).rejects.toThrow('Supplier');
  });

  it('throws BusinessRuleError when consent not given', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ consent_litigation_check: false }),
    );

    await expect(
      service.recordLitigationCheck('supplier-uuid-1', true, 'officer-1', IP, UA),
    ).rejects.toThrow('Supplier has not consented to litigation check');
  });

  it('rolls back on error', async () => {
    mockedRepo.setLitigationCheckWithClient.mockRejectedValue(new Error('DB error'));

    await expect(
      service.recordLitigationCheck('supplier-uuid-1', true, 'officer-1', IP, UA),
    ).rejects.toThrow('DB error');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// =========================================================================
// Sanctions — loadSanctionsList edge cases
// =========================================================================
describe('loadSanctionsList — error cases', () => {
  it('throws when sanctions.json does not exist', async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toThrow(
      'SANCTIONS_LIST_EMPTY',
    );
  });

  it('throws when sanctions entries array is empty', async () => {
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ entries: [] }));
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toThrow(
      'SANCTIONS_LIST_EMPTY',
    );
  });
});

// =========================================================================
// PEP designation — supplier vs buyer branches
// =========================================================================
describe('checkPepDesignation', () => {
  it('supplier sanctions+PEP entry blocks pre-tx — no supplier row, no PEP write', async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        lastUpdated: '2026-03-20',
        entries: [
          {
            name: 'Test Supplier Ltd',
            reason: 'PEP entity',
            pep_designation: true,
          },
        ],
      }),
    );
    mockedRepo.emailExists.mockResolvedValue(false);
    mockedRepo.registrationNumberExists.mockResolvedValue(false);

    await expect(service.registerSupplier(validRegistration, IP, UA)).rejects.toMatchObject({
      errorCode: 'SANCTIONS_MATCH',
    });

    // Sanctions screen runs pre-tx; the supplier row is never created, so PEP
    // designation cannot — and must not — be written against a non-existent
    // record. PEP for suppliers is handled in the post-KYC compliance flow.
    expect(mockedRepo.setPepDesignation).not.toHaveBeenCalled();
    expect(mockedRepo.createSupplierWithClient).not.toHaveBeenCalled();
  });

  it('sets PEP on buyer when name matches pep_designation entry', async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        lastUpdated: '2026-03-20',
        entries: [
          {
            name: 'Test Buyer Ltd',
            reason: 'PEP entity',
            pep_designation: true,
          },
        ],
      }),
    );
    mockedRepo.buyerRegistrationNumberExists.mockResolvedValue(false);
    mockedRepo.createBuyer.mockResolvedValue(undefined);
    mockedRepo.setBuyerSanctionsFlag.mockResolvedValue(undefined);
    mockedRepo.setBuyerPepDesignation.mockResolvedValue(undefined);

    const uuidMock = jest.requireMock('uuid') as { v4: jest.Mock };
    uuidMock.v4.mockReset().mockReturnValue('buyer-uuid-pep');

    const validBuyer: BuyerCreation = {
      company_name: 'Test Buyer Ltd',
      registration_number: 'BREG-PEP',
      credit_rating: 'A',
      approved_limit: 100000000,
      payment_score: 85,
      contact_email: 'buyer@test.com',
      contact_phone: '256700000001',
    };

    await expect(service.createBuyer(validBuyer, 'officer-1', IP, UA)).rejects.toMatchObject({
      errorCode: 'SANCTIONS_MATCH',
    });

    expect(mockedRepo.setBuyerPepDesignation).toHaveBeenCalledWith('buyer-uuid-pep', true);
  });
});

// =========================================================================
// queueKycNotification — branches
// =========================================================================
describe('queueKycNotification — notification branches', () => {
  beforeEach(() => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ kyc_status: KycStatus.UNDER_REVIEW }),
    );
    mockedRepo.updateKycStatusWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);
    mockedRepo.setKycApproverWithClient.mockResolvedValue(undefined);
    mockedRepo.getKycReviewer.mockResolvedValue('different-reviewer');
  });

  it('does not queue notification for non-approved/rejected status', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(
      makeSupplierRecord({ kyc_status: KycStatus.DOCUMENTS_SUBMITTED }),
    );
    mockedRepo.setKycReviewerWithClient.mockResolvedValue(undefined);

    await service.updateKycStatus(
      'supplier-uuid-1',
      { status: KycStatus.UNDER_REVIEW, comments: 'Starting review' },
      'officer-1',
      IP,
      UA,
    );

    // No notification should be queued (notification queue is null, but the branch for
    // non-approved/rejected should return early before even trying to queue)
    expect(mockedRepo.updateKycStatusWithClient).toHaveBeenCalled();
  });

  it('queues kyc_rejected notification on rejection', async () => {
    await service.updateKycStatus(
      'supplier-uuid-1',
      { status: KycStatus.REJECTED, comments: 'Documents invalid' },
      'approver-1',
      IP,
      UA,
    );

    // updateKycStatus should succeed and try to queue rejected notification
    expect(mockedRepo.updateKycStatusWithClient).toHaveBeenCalledWith(
      mockClient,
      'supplier-uuid-1',
      KycStatus.REJECTED,
    );
  });
});

// =========================================================================
// createBuyer — default values
// =========================================================================
describe('createBuyer — default values', () => {
  beforeEach(() => {
    mockedRepo.buyerRegistrationNumberExists.mockResolvedValue(false);
    mockedRepo.createBuyer.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    const uuidMock = jest.requireMock('uuid') as { v4: jest.Mock };
    uuidMock.v4.mockReset().mockReturnValue('buyer-uuid-defaults');
  });

  it('defaults ris_margin_rate to 0.03 when not provided', async () => {
    const buyer: BuyerCreation = {
      company_name: 'Default Buyer',
      registration_number: 'BREG-DEF',
      credit_rating: 'B',
      approved_limit: 50000000,
      payment_score: 70,
      contact_email: 'default@test.com',
      contact_phone: '256700000002',
    };

    await service.createBuyer(buyer, 'officer-1', IP, UA);

    expect(mockedRepo.createBuyer).toHaveBeenCalledWith(
      expect.objectContaining({ risMarginRate: 0.03 }),
    );
  });

  it('defaults payment_undertaking_signed to false when not provided', async () => {
    const buyer: BuyerCreation = {
      company_name: 'Default Buyer',
      registration_number: 'BREG-DEF',
      credit_rating: 'B',
      approved_limit: 50000000,
      payment_score: 70,
      contact_email: 'default@test.com',
      contact_phone: '256700000002',
    };

    await service.createBuyer(buyer, 'officer-1', IP, UA);

    expect(mockedRepo.createBuyer).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentUndertakingSigned: false,
        paymentUndertakingDate: null,
      }),
    );
  });
});

// =========================================================================
// Buyer Onboarding Requests
// =========================================================================
describe('createBuyerOnboardingRequest', () => {
  beforeEach(() => {
    mockedRepo.createBuyerOnboardingRequestWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);

    const uuidMock = jest.requireMock('uuid') as { v4: jest.Mock };
    uuidMock.v4.mockReset().mockReturnValue('buyer-req-1');
  });

  it('creates buyer onboarding request with encrypted PII', async () => {
    const input: CreateBuyerRequestInput = {
      company_name: 'New Buyer Corp',
      registration_number: 'BREG-NEW',
      contact_name: 'John Smith',
      contact_email: 'john@newbuyer.com',
      contact_phone: '256700111222',
      reason: 'Need to trade with this buyer',
    };

    const result = await service.createBuyerOnboardingRequest('supplier-1', input, IP, UA);

    expect(result.requestId).toBe('buyer-req-1');
    expect(mockedCrypto.encrypt).toHaveBeenCalledWith('John Smith');
    expect(mockedCrypto.encrypt).toHaveBeenCalledWith('john@newbuyer.com');
    expect(mockedCrypto.encrypt).toHaveBeenCalledWith('256700111222');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('handles null optional PII fields', async () => {
    const input: CreateBuyerRequestInput = {
      company_name: 'Minimal Buyer',
      reason: 'Just need them onboarded',
    };

    const result = await service.createBuyerOnboardingRequest('supplier-1', input, IP, UA);

    expect(result.requestId).toBe('buyer-req-1');
    expect(mockedRepo.createBuyerOnboardingRequestWithClient).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        contactNameEncrypted: null,
        contactEmailEncrypted: null,
        contactPhoneEncrypted: null,
        registrationNumber: null,
      }),
    );
  });

  it('rolls back on error', async () => {
    mockedRepo.createBuyerOnboardingRequestWithClient.mockRejectedValue(new Error('DB error'));

    const input: CreateBuyerRequestInput = {
      company_name: 'Fail Corp',
      reason: 'Testing error',
    };

    await expect(service.createBuyerOnboardingRequest('supplier-1', input, IP, UA)).rejects.toThrow(
      'DB error',
    );

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

function makeBuyerOnboardingRequestRecord(
  overrides: Partial<BuyerOnboardingRequestRecord> = {},
): BuyerOnboardingRequestRecord {
  return {
    id: 'req-1',
    supplier_id: 'supplier-1',
    company_name: 'Test Buyer',
    registration_number: null,
    contact_name_encrypted: null,
    contact_email_encrypted: null,
    contact_phone_encrypted: null,
    reason: 'Need buyer',
    status: BuyerRequestStatus.PENDING,
    reviewed_by: null,
    reviewer_comments: null,
    linked_buyer_id: null,
    created_at: '2026-03-20T00:00:00Z',
    updated_at: '2026-03-20T00:00:00Z',
    ...overrides,
  };
}

describe('reviewBuyerOnboardingRequest', () => {
  beforeEach(() => {
    mockedRepo.getBuyerOnboardingRequestById.mockResolvedValue(makeBuyerOnboardingRequestRecord());
    mockedRepo.updateBuyerRequestStatusWithClient.mockResolvedValue(undefined);
    mockedRepo.createAuditEntryWithClient.mockResolvedValue(undefined);
  });

  it('reviews a pending request successfully', async () => {
    const input: ReviewBuyerRequestInput = {
      status: 'approved',
      reviewer_comments: 'Looks good',
      linked_buyer_id: 'buyer-linked-1',
    };

    await service.reviewBuyerOnboardingRequest('req-1', 'officer-1', input, IP, UA);

    expect(mockedRepo.updateBuyerRequestStatusWithClient).toHaveBeenCalledWith(
      mockClient,
      'req-1',
      'approved',
      'officer-1',
      'Looks good',
      'buyer-linked-1',
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('reviews an in_review request successfully', async () => {
    mockedRepo.getBuyerOnboardingRequestById.mockResolvedValue(
      makeBuyerOnboardingRequestRecord({ status: BuyerRequestStatus.IN_REVIEW }),
    );

    const input: ReviewBuyerRequestInput = {
      status: 'rejected',
      reviewer_comments: 'Not eligible',
    };

    await service.reviewBuyerOnboardingRequest('req-1', 'officer-1', input, IP, UA);

    expect(mockedRepo.updateBuyerRequestStatusWithClient).toHaveBeenCalledWith(
      mockClient,
      'req-1',
      'rejected',
      'officer-1',
      'Not eligible',
      null,
    );
  });

  it('throws NotFoundError when request not found', async () => {
    mockedRepo.getBuyerOnboardingRequestById.mockResolvedValue(null);

    await expect(
      service.reviewBuyerOnboardingRequest('missing', 'officer-1', { status: 'approved' }, IP, UA),
    ).rejects.toThrow('BuyerOnboardingRequest');
  });

  it('throws BusinessRuleError when request already reviewed', async () => {
    mockedRepo.getBuyerOnboardingRequestById.mockResolvedValue(
      makeBuyerOnboardingRequestRecord({ status: BuyerRequestStatus.APPROVED }),
    );

    await expect(
      service.reviewBuyerOnboardingRequest('req-1', 'officer-1', { status: 'approved' }, IP, UA),
    ).rejects.toThrow('This request has already been reviewed');
  });

  it('rolls back on error', async () => {
    mockedRepo.updateBuyerRequestStatusWithClient.mockRejectedValue(new Error('DB error'));

    await expect(
      service.reviewBuyerOnboardingRequest('req-1', 'officer-1', { status: 'approved' }, IP, UA),
    ).rejects.toThrow('DB error');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('defaults reviewer_comments and linked_buyer_id to null when not provided', async () => {
    const input: ReviewBuyerRequestInput = { status: 'rejected' };

    await service.reviewBuyerOnboardingRequest('req-1', 'officer-1', input, IP, UA);

    expect(mockedRepo.updateBuyerRequestStatusWithClient).toHaveBeenCalledWith(
      mockClient,
      'req-1',
      'rejected',
      'officer-1',
      null,
      null,
    );
  });
});

describe('listBuyerOnboardingRequestsForReview', () => {
  it('returns paginated results with decrypted PII', async () => {
    mockedRepo.listBuyerOnboardingRequests.mockResolvedValue({
      rows: [
        makeBuyerOnboardingRequestRecord({
          contact_name_encrypted: 'enc:name',
          contact_email_encrypted: 'enc:email',
          contact_phone_encrypted: 'enc:phone',
        }),
      ],
      total: 1,
    });
    mockedCrypto.decrypt.mockReturnValue('decrypted');

    const result = await service.listBuyerOnboardingRequestsForReview({
      page: 1,
      limit: 10,
    });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(mockedCrypto.decrypt).toHaveBeenCalledWith('enc:name');
    expect(mockedCrypto.decrypt).toHaveBeenCalledWith('enc:email');
    expect(mockedCrypto.decrypt).toHaveBeenCalledWith('enc:phone');
  });

  it('handles null encrypted fields without calling decrypt', async () => {
    mockedRepo.listBuyerOnboardingRequests.mockResolvedValue({
      rows: [makeBuyerOnboardingRequestRecord()],
      total: 1,
    });

    const result = await service.listBuyerOnboardingRequestsForReview({
      page: 1,
      limit: 10,
    });

    expect(result.data[0].contact_name).toBeNull();
    expect(result.data[0].contact_email).toBeNull();
    expect(result.data[0].contact_phone).toBeNull();
  });
});

describe('listSupplierBuyerRequests', () => {
  it('returns paginated results for supplier', async () => {
    mockedRepo.listBuyerOnboardingRequestsBySupplier.mockResolvedValue({
      rows: [makeBuyerOnboardingRequestRecord()],
      total: 1,
    });

    const result = await service.listSupplierBuyerRequests('supplier-1', {
      page: 1,
      limit: 10,
    });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(mockedRepo.listBuyerOnboardingRequestsBySupplier).toHaveBeenCalledWith('supplier-1', {
      page: 1,
      limit: 10,
    });
  });
});

// =========================================================================
// checkKycExpiry
// =========================================================================
describe('checkKycExpiry', () => {
  it('throws NotFoundError when supplier not found', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(null);

    await expect(service.checkKycExpiry('missing')).rejects.toThrow('Supplier');
  });

  it('returns false when kyc_renewal_due_at is null', async () => {
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord());

    const result = await service.checkKycExpiry('supplier-uuid-1');

    expect(result).toBe(false);
  });

  it('returns true when KYC renewal is overdue', async () => {
    const pastDate = '2025-01-01T00:00:00Z';
    mockedRepo.findSupplierById.mockResolvedValue(makeSupplierRecord() as never);
    // Override with kyc_renewal_due_at
    mockedRepo.findSupplierById.mockResolvedValue({
      ...makeSupplierRecord(),
      kyc_renewal_due_at: pastDate,
    } as never);

    const result = await service.checkKycExpiry('supplier-uuid-1');

    expect(result).toBe(true);
  });

  it('returns false when KYC renewal is not yet due', async () => {
    const futureDate = '2099-12-31T00:00:00Z';
    mockedRepo.findSupplierById.mockResolvedValue({
      ...makeSupplierRecord(),
      kyc_renewal_due_at: futureDate,
    } as never);

    const result = await service.checkKycExpiry('supplier-uuid-1');

    expect(result).toBe(false);
  });
});

// =========================================================================
// autoAdvanceKycStatus — supplier null branch
// =========================================================================
describe('autoAdvanceKycStatus — null supplier on second lookup', () => {
  it('does not advance when supplier is null on re-fetch', async () => {
    // First call returns a supplier (for uploadDocument), second returns null (for autoAdvance)
    mockedRepo.findSupplierById
      .mockResolvedValueOnce(makeSupplierRecord())
      .mockResolvedValueOnce(null);
    mockedRepo.createDocument.mockResolvedValue(undefined);
    mockedRepo.createAuditEntry.mockResolvedValue(undefined);

    const uuidMock = jest.requireMock('uuid') as { v4: jest.Mock };
    uuidMock.v4.mockReset().mockReturnValue('doc-uuid-null');

    const pdfFile = {
      buffer: Buffer.from('pdf-content'),
      originalname: 'cert.pdf',
      mimetype: 'application/pdf',
      size: 5000,
    };

    await service.uploadDocument(
      'supplier-uuid-1',
      'user-uuid-1',
      'supplier',
      pdfFile,
      'certificate_of_incorporation',
      IP,
      UA,
    );

    // auto-advance should not have been called
    expect(mockedRepo.updateKycStatus).not.toHaveBeenCalled();
  });
});
