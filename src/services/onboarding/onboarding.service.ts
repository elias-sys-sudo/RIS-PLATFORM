import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  RisError,
  ValidationError,
} from '../../shared/errors';
import { encrypt, decrypt } from '../../shared/crypto';
import { hashDocument } from '../../shared/crypto';
import { beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import * as repo from './onboarding.repository';
import type {
  SupplierRegistration,
  SupplierProfile,
  SupplierRecord,
  BuyerCreation,
  BuyerProfile,
  BuyerRecord,
  BuyerUpdate,
  DocumentRecord,
  KycStatusUpdate,
  PaginationParams,
  PaginatedResult,
  SanctionsList,
  SanctionsEntry,
  EligibilityCheckInput,
  EligibilityResult,
  EligibilityThrottleSignals,
  Director,
  CreateBuyerRequestInput,
  ReviewBuyerRequestInput,
  BuyerOnboardingRequestRecord,
  BuyerOnboardingRequestPublic,
  CreateUboInput,
  BeneficialOwner,
  BeneficialOwnerRecord,
  KycPageStatus,
  KycPageDocument,
  KycPageDocStatus,
  KycPageOverallStatus,
  KycPageDocumentType,
  DocumentReviewDecision,
} from './onboarding.types';
import {
  KycStatus,
  DocumentType,
  BuyerRequestStatus,
  BuyerRequestErrorCode,
  EligibilityErrorCode,
} from './onboarding.types';
import type { Queue } from 'bullmq';
import type { PoolClient } from 'pg';
import { issueEmailVerificationToken } from '../auth/auth.service';

const BCRYPT_ROUNDS = 12;
const UPLOAD_DIR = path.resolve('uploads', 'documents');
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
// =========================================================================
// Queue setup
// =========================================================================

let notificationQueue: Queue | null = null;

export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

/**
 * Required KYC document slots for auto-advance from PENDING →
 * DOCUMENTS_SUBMITTED. Each entry is a list of accepted aliases for that
 * slot — supplier counts as having uploaded the slot if any one of the
 * aliases is present. This handles both post-rebrand uploads (which use
 * the canonical FE names) and legacy DB rows (which may use the older
 * 'director_id' / 'signed_supplier_agreement' values).
 */
const REQUIRED_DOC_TYPE_GROUPS: string[][] = [
  [DocumentType.CERTIFICATE_OF_INCORPORATION],
  [DocumentType.TAX_REGISTRATION],
  [DocumentType.ID_DOCUMENT, 'director_id'],
  [DocumentType.SUPPLIER_AGREEMENT, 'signed_supplier_agreement'],
];

// =========================================================================
// Consent Validation
// =========================================================================

function validateConsents(data: SupplierRegistration): void {
  if (!data.consent_ursb_check) {
    throw new ValidationError('Consent for URSB check is required');
  }
  if (!data.consent_supplier_refs) {
    throw new ValidationError('Consent for supplier references is required');
  }
  if (!data.consent_litigation_check) {
    throw new ValidationError('Consent for litigation check is required');
  }
}

// =========================================================================
// Decrypt PII helpers (fallback to plaintext for pre-015 records)
// =========================================================================

function decryptOrFallback(encrypted: string | null, plaintext: string): string {
  if (encrypted !== null && encrypted !== '') {
    return decrypt(encrypted);
  }
  return plaintext;
}

function decryptDirectors(encrypted: string | null, plaintext: Director[]): Director[] {
  if (encrypted !== null && encrypted !== '') {
    const raw = decrypt(encrypted);
    return JSON.parse(raw) as Director[];
  }
  return plaintext;
}

// =========================================================================
// Eligibility Pre-Qualification
// =========================================================================

/**
 * D1 — Normalise years-in-business to a numeric floor.
 * Accepts either the new bucket string (from the dropdown) or the legacy raw
 * number. Bucket `0-1` resolves to 0 which still fails the `>= 1` policy.
 */
function yearsInBusinessToNumber(value: number | string): number {
  if (typeof value === 'number') return value;
  switch (value) {
    case '0-1':
      return 0;
    case '2-5':
      return 2;
    case '6-10':
      return 6;
    case '10+':
      return 10;
    default:
      return 0;
  }
}

/**
 * Run the eligibility questionnaire before full onboarding.
 * Returns a session token (valid 24 h) only when all criteria are met.
 */
/**
 * Progressive eligibility throttle (REQ-ELIG-006).
 *
 * Tiers (lookback window × fail-count threshold):
 *   - 2 fails in last 5 min   → 5-minute block
 *   - 3 fails in last 1 hour  → 1-hour block
 *   - 5 fails in last 24 hours → 24-hour block
 *   - 7 fails in last 30 days  → 30-day block (spec ceiling)
 *
 * Forgiveness: any `passed=true` row newer than the most recent failure
 * resets the slate. Genuine first-time mistakes don't lock anyone out;
 * automated abuse hits the curve quickly and is rate-limited.
 */
const THROTTLE_TIERS = [
  { tier: '5min', failsRequired: 2, retrySeconds: 300, label: '5 minutes' },
  { tier: '1hour', failsRequired: 3, retrySeconds: 3_600, label: '1 hour' },
  { tier: '24hour', failsRequired: 5, retrySeconds: 86_400, label: '24 hours' },
  { tier: '30day', failsRequired: 7, retrySeconds: 86_400 * 30, label: '30 days' },
] as const;

function pickThrottleTier(
  signals: EligibilityThrottleSignals,
): { tier: string; retrySeconds: number; label: string } | null {
  const counts: Record<string, number> = {
    '5min': signals.failCount5min,
    '1hour': signals.failCount1hour,
    '24hour': signals.failCount24hour,
    '30day': signals.failCount30day,
  };
  // Walk from the longest window down so the most lenient applicable tier wins
  // (i.e. if 5min count >= 2 we still emit the 5min block, but if the spike
  // already escalated to 30d we report 30d).
  for (let i = THROTTLE_TIERS.length - 1; i >= 0; i--) {
    const t = THROTTLE_TIERS[i];
    if (counts[t.tier] >= t.failsRequired) {
      return { tier: t.tier, retrySeconds: t.retrySeconds, label: t.label };
    }
  }
  return null;
}

async function enforceEligibilityThrottle(email: string | null, ipAddress: string): Promise<void> {
  const signals = await repo.getEligibilityThrottleSignals(email, ipAddress);

  // Clear-on-success: a passed attempt after the most recent fail forgives
  // all prior failures. Pure UX win — honest applicants are never punished
  // for a fail they later corrected.
  const forgiven =
    signals.mostRecentPassAt !== null &&
    (signals.mostRecentFailAt === null || signals.mostRecentPassAt > signals.mostRecentFailAt);
  if (forgiven) return;

  const block = pickThrottleTier(signals);
  if (block === null) return;

  logger.warn('Eligibility throttle triggered', {
    component: 'onboarding',
    tier: block.tier,
    failCount30day: signals.failCount30day,
  });
  throw new BusinessRuleError(
    EligibilityErrorCode.THROTTLED,
    `Too many failed eligibility attempts. Please try again in ${block.label}.`,
    { retryAfterSeconds: block.retrySeconds, tier: block.tier },
  );
}

export async function checkEligibility(
  data: EligibilityCheckInput,
  ipAddress: string,
): Promise<EligibilityResult> {
  const normalisedEmail = data.email !== undefined ? data.email.trim().toLowerCase() : null;
  await enforceEligibilityThrottle(normalisedEmail, ipAddress);

  const yearsNumeric = yearsInBusinessToNumber(data.years_in_business);
  const passed =
    data.registered_company === true && data.authorized_person === true && yearsNumeric >= 1;

  if (!passed) {
    return recordFailedEligibility(data, yearsNumeric, ipAddress, normalisedEmail);
  }
  return recordPassedEligibility(data, yearsNumeric, ipAddress, normalisedEmail);
}

async function recordFailedEligibility(
  data: EligibilityCheckInput,
  yearsNumeric: number,
  ipAddress: string,
  email: string | null,
): Promise<EligibilityResult> {
  await repo.createEligibilityCheck({
    id: uuidv4(),
    sessionToken: uuidv4(),
    registeredCompany: data.registered_company,
    authorizedPerson: data.authorized_person,
    yearsInBusiness: yearsNumeric,
    passed: false,
    ipAddress,
    email,
    fundingRequirement: data.funding_requirement ?? null,
  });
  return {
    passed: false,
    message:
      'Your organisation does not meet the minimum eligibility criteria. ' +
      'You must operate a registered company, be an authorised representative, ' +
      'and have been in business for at least 1 year.',
  };
}

async function recordPassedEligibility(
  data: EligibilityCheckInput,
  yearsNumeric: number,
  ipAddress: string,
  email: string | null,
): Promise<EligibilityResult> {
  const sessionToken = uuidv4();
  await repo.createEligibilityCheck({
    id: uuidv4(),
    sessionToken,
    registeredCompany: data.registered_company,
    authorizedPerson: data.authorized_person,
    yearsInBusiness: yearsNumeric,
    passed: true,
    ipAddress,
    email,
    fundingRequirement: data.funding_requirement ?? null,
  });
  logger.audit('ELIGIBILITY_PASSED', { component: 'onboarding' });
  return {
    passed: true,
    session_token: sessionToken,
    message: 'Eligibility confirmed. Please proceed with full registration.',
  };
}

// =========================================================================
// Supplier Registration
// =========================================================================

/**
 * Register a new supplier account and company profile.
 * Encrypts bank details before storage.
 */
export async function registerSupplier(
  data: SupplierRegistration,
  ipAddress: string,
  userAgent: string,
): Promise<{ userId: string; supplierId: string }> {
  await validateRegistrationPrereqs(data);
  validateConsents(data);
  await screenSanctionsBeforeRegistration(data, ipAddress, userAgent);

  const userId = uuidv4();
  const supplierId = uuidv4();
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

  await executeRegistrationTx(data, userId, supplierId, passwordHash, ipAddress, userAgent);
  await postRegistrationChecks(userId, supplierId, data.email, ipAddress, userAgent);

  return { userId, supplierId };
}

async function validateRegistrationPrereqs(data: SupplierRegistration): Promise<void> {
  const eligibility = await repo.findEligibilityByToken(data.eligibility_session_token);
  if (eligibility === null || !eligibility.passed) {
    throw new BusinessRuleError(
      'ELIGIBILITY_TOKEN_INVALID',
      'A valid eligibility session token is required before registration',
    );
  }

  const exists = await repo.emailExists(data.email);
  if (exists) {
    throw new BusinessRuleError('EMAIL_TAKEN', 'An account with this email already exists');
  }

  const regExists = await repo.registrationNumberExists(data.registration_number);
  if (regExists) {
    throw new BusinessRuleError(
      'REGISTRATION_NUMBER_TAKEN',
      'A supplier with this registration number already exists',
    );
  }
}

function encryptSupplierPii(data: SupplierRegistration): {
  encryptedBankAccNum: string;
  encryptedBankAccName: string;
  encryptedCompanyName: string;
  encryptedTaxId: string;
  encryptedDirectors: string;
} {
  return {
    encryptedBankAccNum: encrypt(data.bank_account_number),
    encryptedBankAccName: encrypt(data.bank_account_name),
    encryptedCompanyName: encrypt(data.company_name),
    encryptedTaxId: encrypt(data.tax_id),
    encryptedDirectors: encrypt(JSON.stringify(data.directors)),
  };
}

async function executeRegistrationTx(
  data: SupplierRegistration,
  userId: string,
  supplierId: string,
  passwordHash: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const pii = encryptSupplierPii(data);
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await writeRegistrationRows(
      client,
      data,
      userId,
      supplierId,
      passwordHash,
      pii,
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    mapPostgresUniqueViolation(err);
  } finally {
    client.release();
  }
}

async function writeRegistrationRows(
  client: PoolClient,
  data: SupplierRegistration,
  userId: string,
  supplierId: string,
  passwordHash: string,
  pii: ReturnType<typeof encryptSupplierPii>,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await createUserAndSupplier(client, data, userId, supplierId, passwordHash, pii);
  await repo.createAuditEntryWithClient(
    client,
    userId,
    'SUPPLIER_REGISTERED',
    'suppliers',
    supplierId,
    null,
    { kycStatus: KycStatus.PENDING },
    ipAddress,
    userAgent,
  );
}

/**
 * Map a Postgres unique-violation (SQLSTATE 23505) raised by the registration
 * INSERT into a friendly BusinessRuleError. Authoritative TOCTOU backstop —
 * concurrent registrations that pass the pre-flight check still hit this.
 * Always rethrows: returns `never`.
 */
function mapPostgresUniqueViolation(err: unknown): never {
  if (err instanceof Error && (err as { code?: string }).code === '23505') {
    const constraint = (err as { constraint?: string }).constraint ?? '';
    if (constraint.includes('email')) {
      throw new BusinessRuleError('EMAIL_TAKEN', 'An account with this email already exists');
    }
    if (constraint.includes('registration_number')) {
      throw new BusinessRuleError(
        'REGISTRATION_NUMBER_TAKEN',
        'A supplier with this registration number already exists',
      );
    }
  }
  throw err;
}

async function createUserAndSupplier(
  client: PoolClient,
  data: SupplierRegistration,
  userId: string,
  supplierId: string,
  passwordHash: string,
  pii: ReturnType<typeof encryptSupplierPii>,
): Promise<void> {
  await repo.createUserWithClient(client, {
    id: userId,
    email: data.email,
    passwordHash,
    role: 'supplier',
  });
  await repo.createSupplierWithClient(client, {
    id: supplierId,
    userId,
    // Plaintext goes in the display-source column; encrypted column kept
    // for backward compatibility with rows registered before this fix.
    companyName: data.company_name,
    companyNameEncrypted: pii.encryptedCompanyName,
    registrationNumber: data.registration_number,
    taxIdEncrypted: pii.encryptedTaxId,
    directorsEncrypted: pii.encryptedDirectors,
    bankName: data.bank_name,
    bankAccountNumberEncrypted: pii.encryptedBankAccNum,
    bankAccountNameEncrypted: pii.encryptedBankAccName,
    bankBranch: data.bank_branch,
    preferredPaymentMethod: data.preferred_payment_method,
    mobileMoneyNumberEncrypted: null,
    eligibilitySessionToken: data.eligibility_session_token,
    consentUrsbCheck: data.consent_ursb_check,
    consentSupplierRefs: data.consent_supplier_refs,
    consentLitigationCheck: data.consent_litigation_check,
    litigationDisclosure: data.litigation_disclosure ?? null,
    requiredFinancingAmount: data.required_financing_amount ?? null,
  });
}

/**
 * Post-commit side effects only. Sanctions screening now runs BEFORE the
 * transaction (see `screenSanctionsBeforeRegistration`); a sanctioned entity
 * never reaches this point because no rows were ever inserted. Notification
 * queue dispatch is fire-and-forget — failure must not throw.
 */
async function postRegistrationChecks(
  userId: string,
  supplierId: string,
  email: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  logger.audit('SUPPLIER_REGISTERED', {
    component: 'onboarding',
    userId,
    supplierId,
  });
  // Verification email goes out before the welcome — the welcome links into the
  // dashboard which the user can't reach until email_verified=true anyway.
  // Wrapped in try/catch so a queue outage cannot reverse a committed account.
  try {
    await issueEmailVerificationToken(userId, email, ipAddress, userAgent);
  } catch (err) {
    logger.error('Failed to issue email verification token', {
      component: 'onboarding',
      userId,
      errorMessage: err instanceof Error ? err.message : 'unknown',
    });
  }
  await queueOnboardingNotification('welcome', { userId, supplierId });
}

/**
 * Pre-transaction sanctions screening for supplier registration. The list is a
 * pure read against config/sanctions.json — no DB writes during the screen.
 * On match, audit the blocked attempt (no PII; just IP + hashed match key +
 * matchedEntryId) and throw SANCTIONS_MATCH BEFORE any user/supplier rows are
 * inserted. Atomic: either zero rows on disk, or a clean registration.
 */
async function screenSanctionsBeforeRegistration(
  data: SupplierRegistration,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const sanctions = loadSanctionsList();
  const match = findSanctionsMatch(sanctions.entries, data.company_name, data.registration_number);
  if (match === null) {
    return;
  }
  await auditBlockedSanctionsAttempt(match, data, ipAddress, userAgent);
  throw new BusinessRuleError(
    'SANCTIONS_MATCH',
    'Entity failed sanctions screening — registration blocked pending compliance review',
  );
}

/**
 * Audit a blocked sanctions registration attempt. Runs in its own small
 * transaction — there is nothing else to commit alongside since no user or
 * supplier row was ever created. PII-free metadata only: hashed match key and
 * the matched entry's registration number.
 */
async function auditBlockedSanctionsAttempt(
  match: SanctionsEntry,
  data: SupplierRegistration,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const matchedEntryId = match.registration_number ?? 'unknown';
  const metadata = buildBlockedSanctionsMetadata(match, data, matchedEntryId);
  await repo.createAuditEntry(
    null,
    'SANCTIONS_REGISTRATION_BLOCKED',
    'suppliers',
    'pre-insert',
    null,
    metadata,
    ipAddress,
    userAgent,
  );
  logger.audit('SANCTIONS_REGISTRATION_BLOCKED', { component: 'onboarding', matchedEntryId });
}

function buildBlockedSanctionsMetadata(
  match: SanctionsEntry,
  data: SupplierRegistration,
  matchedEntryId: string,
): Record<string, unknown> {
  const matchKeyHash = crypto
    .createHash('sha256')
    .update(`${data.company_name.toLowerCase()}|${data.registration_number}`)
    .digest('hex');
  return { matchedEntryId, matchKeyHash, reason: match.reason };
}

// =========================================================================
// Get Supplier Profile
// =========================================================================

/**
 * Get supplier profile with ownership check.
 */
export async function getSupplierProfile(
  supplierId: string,
  requestingUserId: string,
  requestingRole: string,
): Promise<SupplierProfile> {
  const supplier = await repo.findSupplierById(supplierId);
  if (supplier === null) {
    throw new NotFoundError('Supplier', supplierId);
  }

  if (requestingRole === 'supplier') {
    if (supplier.user_id !== requestingUserId) {
      throw new ForbiddenError();
    }
  }

  return toSupplierProfile(supplier);
}

// =========================================================================
// KYC Page Status (supplier-facing aggregate view)
// =========================================================================

// Read-only KYC access — finance_manager needs it to disburse against
// approved suppliers, auditor for compliance trail, legal for case prep.
// Write access (review/approve docs) is still restricted to the smaller
// set in KYC_DOC_REVIEWER_ROLES below.
const ADMIN_ROLES_FOR_KYC_READ = new Set([
  'credit_officer',
  'compliance_officer',
  'management',
  'finance_manager',
  'auditor',
  'legal',
]);

/**
 * Backend → frontend document_type mapping. Unknown values become `additional`.
 *
 * Every canonical FE value MUST have an identity entry below — without it,
 * a new upload (which writes the canonical value) gets mapped to
 * 'additional' by the ?? fallback and disappears from the required-docs
 * checklist. Legacy alias entries are kept on top of the identities to
 * normalise pre-rebrand DB rows.
 */
const KYC_PAGE_DOCUMENT_TYPE_MAP: Record<string, KycPageDocumentType> = {
  // Canonical identity entries — match what the FE Joi schema accepts.
  certificate_of_incorporation: 'certificate_of_incorporation',
  directors_shareholders: 'directors_shareholders',
  tax_registration: 'tax_registration',
  bank_account_details: 'bank_account_details',
  supplier_agreement: 'supplier_agreement',
  board_resolution: 'board_resolution',
  id_document: 'id_document',
  additional: 'additional',
  // Legacy aliases — translate pre-rebrand DB rows to canonical FE names.
  director_id: 'id_document',
  signed_supplier_agreement: 'supplier_agreement',
};

/**
 * Read-only fetch of a supplier's KYC status + documents in the shape the
 * frontend KYC page expects. Suppliers may only fetch their own; review-roles
 * may fetch any. Audit log is NOT written for read operations.
 */
export async function getSupplierKycStatus(
  idParam: string,
  requestingUserId: string,
  requestingUserRole: string,
): Promise<KycPageStatus> {
  // Accept either suppliers.id OR users.id — the FE login response only
  // exposes user.id, not supplier.id, so suppliers self-fetching their KYC
  // page pass their user_id. When the lookup-by-supplier-id fails, fall
  // back to user_id resolution if the requester is the matching supplier.
  let supplier = await repo.findSupplierById(idParam);
  if (supplier === null && requestingUserRole === 'supplier' && idParam === requestingUserId) {
    supplier = await repo.findSupplierByUserId(requestingUserId);
  }
  if (supplier === null) {
    throw new NotFoundError('Supplier', idParam);
  }
  authorizeKycRead(supplier, requestingUserId, requestingUserRole);

  const documents = await repo.findDocumentsBySupplierId(supplier.id);
  const overallStatus = mapKycOverallStatus(supplier.kyc_status);

  return {
    supplierId: supplier.id,
    overallStatus,
    documents: documents.map((d) => toKycPageDocument(d)),
  };
}

function authorizeKycRead(
  supplier: SupplierRecord,
  requestingUserId: string,
  requestingUserRole: string,
): void {
  if (ADMIN_ROLES_FOR_KYC_READ.has(requestingUserRole)) {
    return;
  }
  if (requestingUserRole === 'supplier' && supplier.user_id === requestingUserId) {
    return;
  }
  throw new ForbiddenError();
}

function mapKycOverallStatus(status: KycStatus): KycPageOverallStatus {
  switch (status) {
    case KycStatus.PENDING:
      return 'pending';
    case KycStatus.APPROVED:
      return 'approved';
    case KycStatus.REJECTED:
      return 'rejected';
    case KycStatus.DOCUMENTS_SUBMITTED:
    case KycStatus.UNDER_REVIEW:
      return 'in_progress';
    default:
      return 'pending';
  }
}

/**
 * Translate the per-document review_status (from migration 039) into
 * the frontend's KycPageDocStatus. Falls back to 'pending' if the column
 * is null on legacy rows uploaded before the migration ran.
 */
function mapDocReviewStatus(reviewStatus: string | null): KycPageDocStatus {
  if (reviewStatus === 'approved') return 'approved';
  if (reviewStatus === 'rejected') return 'rejected';
  return 'pending';
}

function toKycPageDocument(d: DocumentRecord): KycPageDocument {
  return {
    id: d.id,
    type: KYC_PAGE_DOCUMENT_TYPE_MAP[d.document_type] ?? 'additional',
    fileName: deriveDisplayFileName(d),
    uploadedAt: d.created_at,
    status: mapDocReviewStatus(d.review_status),
    reviewerComments: d.review_comments,
  };
}

/**
 * The encrypted_path column stores `${uuid}.enc` — never expose that to the
 * frontend. We synthesise a stable display name from the document type plus
 * a short hash of the file. No PII leaves the service.
 */
function deriveDisplayFileName(d: DocumentRecord): string {
  const ext = mimeToExtension(d.mime_type);
  const shortId = d.id.slice(0, 8);
  return `${d.document_type}_${shortId}${ext}`;
}

function mimeToExtension(mime: string): string {
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  return '';
}

// =========================================================================
// Document Upload
// =========================================================================

/**
 * Upload and encrypt a KYC document.
 */
export async function uploadDocument(
  idParam: string,
  userId: string,
  role: string,
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  documentType: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ documentId: string }> {
  // Same idParam-resolution policy as getSupplierKycStatus: accept either
  // suppliers.id OR users.id. The frontend login response only exposes
  // user.id (not supplier.id), so the KYC documents page passes user.id
  // when uploading. Resolve via user_id when the requester is the
  // matching supplier role.
  let supplier = await repo.findSupplierById(idParam);
  if (supplier === null && role === 'supplier' && idParam === userId) {
    supplier = await repo.findSupplierByUserId(userId);
  }
  if (supplier === null) {
    throw new NotFoundError('Supplier', idParam);
  }
  if (role === 'supplier' && supplier.user_id !== userId) {
    throw new ForbiddenError();
  }

  validateFile(file);
  const documentId = uuidv4();
  encryptAndStoreFile(documentId, file);
  await persistDocumentRecord(documentId, supplier.id, file, documentType, userId);
  await auditDocumentUpload(
    documentId,
    supplier.id,
    documentType,
    file,
    userId,
    ipAddress,
    userAgent,
  );
  // Post-commit, fire-and-forget: notify the reviewer pool (credit_officer
  // + compliance_officer) that a new KYC document is awaiting review.
  // Failures are logged inside the helper and never propagate — the upload
  // itself has already succeeded and we don't want notifier hiccups to
  // mask that.
  await notifyReviewersOfDocumentUpload(documentType, supplier.id);

  return { documentId };
}

/** Roles that should be alerted when a supplier uploads a KYC document. */
const KYC_REVIEWER_ROLES = ['credit_officer', 'compliance_officer'] as const;

/**
 * Fan a 'new_document_uploaded' email out to every active user whose role
 * is in the reviewer pool. One BullMQ job per recipient with the full
 * notification payload shape (channel + template + recipient + data).
 *
 * Treated as best-effort: any error is caught + logged, never thrown.
 * The upload itself has already committed and audit-logged before we
 * reach this point.
 */
async function notifyReviewersOfDocumentUpload(
  documentType: string,
  supplierId: string,
): Promise<void> {
  if (notificationQueue === null) {
    logger.warn('Notification queue not configured — skipping reviewer fan-out', {
      component: 'onboarding',
      supplierId,
      documentType,
    });
    return;
  }
  try {
    const reviewers = await repo.findActiveUsersByRoles(KYC_REVIEWER_ROLES);
    if (reviewers.length === 0) {
      logger.warn('No active reviewers for KYC upload notification', {
        component: 'onboarding',
        supplierId,
        documentType,
      });
      return;
    }
    const loginUrl = `${process.env.FRONTEND_URL ?? 'https://app.ris.ug'}/kyc-review`;
    await Promise.all(
      reviewers.map((reviewer) =>
        notificationQueue!.add(
          'new-kyc-document-uploaded',
          {
            id: uuidv4(),
            channel: 'email',
            template: 'new_document_uploaded',
            recipient: reviewer.email,
            data: {
              document_type: documentType,
              login_url: loginUrl,
            },
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
        ),
      ),
    );
    logger.info('KYC upload notification fanned out to reviewers', {
      component: 'onboarding',
      supplierId,
      documentType,
      reviewerCount: reviewers.length,
    });
  } catch (err) {
    logger.error('Failed to fan out KYC upload notification', {
      component: 'onboarding',
      supplierId,
      documentType,
      errorMessage: err instanceof Error ? err.message : 'unknown',
    });
  }
}

function encryptAndStoreFile(documentId: string, file: { buffer: Buffer }): void {
  const encryptedContent = encrypt(file.buffer.toString('base64'));
  ensureUploadDir();
  const encryptedPath = path.join(UPLOAD_DIR, `${documentId}.enc`);
  fs.writeFileSync(encryptedPath, encryptedContent, 'utf8');
}

async function persistDocumentRecord(
  documentId: string,
  supplierId: string,
  file: { buffer: Buffer; mimetype: string; size: number },
  documentType: string,
  userId: string,
): Promise<void> {
  await repo.createDocument({
    id: documentId,
    invoiceId: null,
    supplierId,
    documentType,
    encryptedPath: `${documentId}.enc`,
    fileHash: hashDocument(file.buffer),
    fileSizeBytes: file.size,
    mimeType: file.mimetype,
    uploadedBy: userId,
  });
}

async function auditDocumentUpload(
  documentId: string,
  supplierId: string,
  documentType: string,
  file: { buffer: Buffer },
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.createAuditEntry(
    userId,
    'DOCUMENT_UPLOADED',
    'invoice_documents',
    documentId,
    null,
    { supplierId, documentType, fileHash: hashDocument(file.buffer) },
    ipAddress,
    userAgent,
  );
  await autoAdvanceKycStatus(supplierId, userId, ipAddress, userAgent);
}

// =========================================================================
// Document file download (decrypted streaming)
// =========================================================================

/**
 * Roles allowed to download any supplier's KYC document. Suppliers downloading
 * their own files go through the user_id ownership check instead. Auditor is
 * included as a read-only role for compliance review trails — they cannot
 * change KYC state and they need to inspect what was actually submitted.
 */
const ADMIN_ROLES_FOR_DOCUMENT_DOWNLOAD = new Set([
  'credit_officer',
  'compliance_officer',
  'management',
  'auditor',
  // finance_manager needs to verify bank/identity docs before disbursing
  // against an approved supplier; legal needs the same for case prep.
  'finance_manager',
  'legal',
]);

/**
 * Resolve idParam to a supplier record using the same fallback policy as the
 * other supplier-scoped reads: accept either suppliers.id OR users.id. The
 * frontend login response only exposes user.id, so suppliers self-fetching
 * pass user.id. Returns the resolved supplier or null when neither lookup
 * matches.
 */
async function resolveSupplierForRequester(
  idParam: string,
  requestingUserId: string,
  requestingUserRole: string,
): Promise<SupplierRecord | null> {
  const supplier = await repo.findSupplierById(idParam);
  if (supplier !== null) {
    return supplier;
  }
  if (requestingUserRole === 'supplier' && idParam === requestingUserId) {
    return repo.findSupplierByUserId(requestingUserId);
  }
  return null;
}

/**
 * Authorise a document download. Suppliers may only download their own; the
 * admin set defined above may download any. Throws ForbiddenError on miss.
 */
function authorizeDocumentDownload(
  supplier: SupplierRecord,
  requestingUserId: string,
  requestingUserRole: string,
): void {
  if (ADMIN_ROLES_FOR_DOCUMENT_DOWNLOAD.has(requestingUserRole)) {
    return;
  }
  if (requestingUserRole === 'supplier' && supplier.user_id === requestingUserId) {
    return;
  }
  throw new ForbiddenError();
}

/**
 * Resolve the absolute on-disk path for a document's encrypted blob. The
 * `encrypted_path` column stores `${uuid}.enc` (see persistDocumentRecord),
 * so we anchor it against the same UPLOAD_DIR used at write time. Defends
 * against path traversal by rejecting anything that escapes UPLOAD_DIR.
 */
function resolveEncryptedFilePath(encryptedPath: string): string {
  const absolute = path.resolve(UPLOAD_DIR, encryptedPath);
  if (
    !absolute.startsWith(path.resolve(UPLOAD_DIR) + path.sep) &&
    absolute !== path.resolve(UPLOAD_DIR)
  ) {
    throw new RisError('Document path outside upload root', 500, 'DOCUMENT_PATH_INVALID');
  }
  return absolute;
}

/**
 * Read and decrypt a previously-uploaded KYC file. The on-disk format is the
 * base64-encoded plaintext encrypted via shared/crypto.ts (see
 * encryptAndStoreFile) — invert that here. Decryption errors are wrapped in
 * a domain-specific RisError so ops can debug without leaking buffer bytes.
 */
function readAndDecryptDocument(documentId: string, encryptedPath: string): Buffer {
  const absolute = resolveEncryptedFilePath(encryptedPath);
  if (!fs.existsSync(absolute)) {
    throw new NotFoundError('Document', documentId);
  }
  const encryptedContent = fs.readFileSync(absolute, 'utf8');
  try {
    const base64Plain = decrypt(encryptedContent);
    return Buffer.from(base64Plain, 'base64');
  } catch {
    // Never include the encrypted body or decrypted bytes in the error.
    throw new RisError('Failed to decrypt stored document', 500, 'DOCUMENT_DECRYPT_FAILED');
  }
}

/**
 * Build the user-facing filename for an inline preview / download. The
 * encrypted_path column stores `${uuid}.enc` which we never expose; instead
 * we synthesise `${document_type}_${shortId}.${ext}` so the browser shows a
 * meaningful name and file managers infer the right MIME from the extension.
 */
function buildDownloadFileName(record: DocumentRecord): string {
  const ext = mimeToExtension(record.mime_type);
  const shortId = record.id.slice(0, 8);
  return `${record.document_type}_${shortId}${ext}`;
}

/**
 * Read back a single uploaded KYC document, decrypted, for streaming to the
 * browser. Suppliers may only fetch their own; admin/auditor roles may fetch
 * any. Returns the raw plaintext bytes plus the metadata the controller
 * needs to set Content-Type and Content-Disposition. Read-only — no audit
 * row written (project convention: audit covers state changes only).
 */
export async function getSupplierDocumentFile(
  idParam: string,
  docId: string,
  requestingUserId: string,
  requestingUserRole: string,
): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const supplier = await resolveSupplierForRequester(idParam, requestingUserId, requestingUserRole);
  if (supplier === null) {
    throw new NotFoundError('Supplier', idParam);
  }
  authorizeDocumentDownload(supplier, requestingUserId, requestingUserRole);

  const record = await repo.findDocumentByIdAndSupplier(docId, supplier.id);
  if (record === null) {
    // Don't leak existence under a different supplier — same status code as
    // a truly missing id. Both paths surface as NotFoundError → 404.
    throw new NotFoundError('Document', docId);
  }

  const buffer = readAndDecryptDocument(docId, record.encrypted_path);
  const fileName = buildDownloadFileName(record);

  // PII-safe ops trail. Never log the buffer or decrypted contents.
  logger.info('KYC document downloaded', {
    component: 'onboarding',
    documentId: docId,
    supplierId: supplier.id,
    requesterId: requestingUserId,
    requesterRole: requestingUserRole,
    mimeType: record.mime_type,
    byteLength: buffer.length,
  });

  return { buffer, mimeType: record.mime_type, fileName };
}

/**
 * List documents for a supplier with ownership check.
 */
export async function listDocuments(
  idParam: string,
  requestingUserId: string,
  requestingRole: string,
): Promise<DocumentRecord[]> {
  // Accept either suppliers.id OR users.id (see getSupplierKycStatus
  // for the rationale — the FE login response exposes user.id only).
  let supplier = await repo.findSupplierById(idParam);
  if (supplier === null && requestingRole === 'supplier' && idParam === requestingUserId) {
    supplier = await repo.findSupplierByUserId(requestingUserId);
  }
  if (supplier === null) {
    throw new NotFoundError('Supplier', idParam);
  }

  if (requestingRole === 'supplier') {
    if (supplier.user_id !== requestingUserId) {
      throw new ForbiddenError();
    }
  }

  return repo.findDocumentsBySupplierId(supplier.id);
}

// =========================================================================
// KYC Status Update
// =========================================================================
// Per-document review (migration 039)
// =========================================================================

/** Roles allowed to approve / reject a single supplier KYC document. */
const KYC_DOC_REVIEWER_ROLES = new Set(['credit_officer', 'compliance_officer', 'management']);

/**
 * Approve or reject a single uploaded KYC document. Distinct from
 * `updateKycStatus`, which manages the supplier-level transition. This
 * function only writes per-row state to invoice_documents.
 *
 * Authorisation:
 *   - Reviewer role must be in KYC_DOC_REVIEWER_ROLES.
 *   - Reviewer cannot review their own upload (maker-checker discipline,
 *     same principle as the supplier-level state machine).
 *   - The document must belong to the named supplier (no cross-supplier
 *     drive-by reviews).
 *
 * Audit log: written inside the same transaction as the state change
 * (per src/CLAUDE.md rule 4 — audit before COMMIT, same client).
 */
export async function reviewSupplierDocument(
  supplierId: string,
  documentId: string,
  decision: DocumentReviewDecision,
  reviewerId: string,
  reviewerRole: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  if (!KYC_DOC_REVIEWER_ROLES.has(reviewerRole)) {
    throw new ForbiddenError();
  }
  const supplier = await repo.findSupplierById(supplierId);
  if (supplier === null) {
    throw new NotFoundError('Supplier', supplierId);
  }
  const existing = await repo.findDocumentByIdAndSupplier(documentId, supplier.id);
  if (existing === null) {
    throw new NotFoundError('Document', documentId);
  }
  if (existing.uploaded_by === reviewerId) {
    throw new BusinessRuleError(
      'KYC_DOC_SELF_REVIEW',
      'You cannot review a document you uploaded yourself.',
    );
  }

  const updated = await repo.updateDocumentReview(
    documentId,
    supplier.id,
    decision.decision,
    reviewerId,
    decision.comments,
  );
  if (updated === null) {
    // Race: doc was deleted between findDocumentByIdAndSupplier and the
    // UPDATE. Caller can retry. Don't leak existence beyond NotFoundError.
    throw new NotFoundError('Document', documentId);
  }

  await repo.createAuditEntry(
    reviewerId,
    'KYC_DOCUMENT_REVIEWED',
    'invoice_documents',
    documentId,
    { reviewStatus: existing.review_status, documentType: existing.document_type },
    { reviewStatus: decision.decision, supplierId: supplier.id },
    ipAddress,
    userAgent,
  );
  logger.audit('KYC_DOCUMENT_REVIEWED', {
    component: 'onboarding',
    documentId,
    supplierId: supplier.id,
    reviewerId,
    decision: decision.decision,
  });

  // Auto-promote supplier kyc_status to APPROVED when the LAST required
  // document gets approved. Best-effort: any failure here logs but never
  // rolls back the doc review itself (review is the source of truth).
  if (decision.decision === 'approved') {
    await maybeAutoApproveSupplierKyc(supplier, reviewerId, ipAddress, userAgent);
  } else if (decision.decision === 'rejected') {
    // Tell the supplier they need to re-upload. Best-effort; logged but
    // never thrown — the review itself is authoritative.
    await notifySupplierOfDocumentRejection(supplier.id, existing.document_type, decision.comments);
  }
}

/**
 * Send the supplier a "your document needs attention" email so they don't
 * have to keep refreshing the KYC page to discover the rejection. Uses the
 * existing document_comment_added template — the reviewer's comments are
 * the actionable content.
 */
async function notifySupplierOfDocumentRejection(
  supplierId: string,
  documentType: string,
  reviewerComments: string,
): Promise<void> {
  try {
    await queueOnboardingNotification('document_comment_added', {
      supplierId,
      documentType,
      reviewerComments: reviewerComments || 'Please re-upload a clearer document.',
    });
  } catch (err) {
    logger.error('Failed to queue document-rejection notification', {
      component: 'onboarding',
      supplierId,
      documentType,
      errorMessage: err instanceof Error ? err.message : 'unknown',
    });
  }
}

/**
 * Auto-promote a supplier's KYC status to APPROVED iff every required
 * document group has at least one approved upload. Idempotent — a no-op
 * when the supplier is already approved/rejected or when required groups
 * are incomplete. The most-recent approving reviewer becomes the recorded
 * approver (preserves the audit trail; maker-checker is already enforced
 * at the per-document review layer).
 */
async function maybeAutoApproveSupplierKyc(
  supplier: SupplierRecord,
  reviewerId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  // Skip terminal states. Only documents_submitted / under_review / pending
  // are eligible to auto-promote.
  if (supplier.kyc_status === KycStatus.APPROVED || supplier.kyc_status === KycStatus.REJECTED) {
    return;
  }

  const approvedTypes = await repo.getApprovedDocumentTypes(supplier.id);
  const allRequiredApproved = REQUIRED_DOC_TYPE_GROUPS.every((group) =>
    group.some((alias) => approvedTypes.includes(alias)),
  );
  if (!allRequiredApproved) return;

  try {
    await repo.updateKycStatus(supplier.id, KycStatus.APPROVED);
    await repo.createAuditEntry(
      reviewerId,
      'KYC_AUTO_APPROVED',
      'suppliers',
      supplier.id,
      { previousStatus: supplier.kyc_status },
      {
        newStatus: KycStatus.APPROVED,
        reason: 'All required documents approved',
        approvedBy: reviewerId,
      },
      ipAddress,
      userAgent,
    );
    logger.audit('KYC_AUTO_APPROVED', {
      component: 'onboarding',
      supplierId: supplier.id,
      reviewerId,
    });
    // Notify the supplier so they know they can start submitting invoices.
    await queueOnboardingNotification('kyc_approved', {
      supplierId: supplier.id,
      rejectionReason: '',
    });
  } catch (err) {
    // Surface but do NOT throw — the per-doc review already committed.
    logger.error('Auto-approve KYC failed', {
      component: 'onboarding',
      supplierId: supplier.id,
      errorMessage: err instanceof Error ? err.message : 'unknown',
    });
  }
}

// =========================================================================

/**
 * Update KYC status with state transition validation.
 * Enforces maker-checker: reviewer (under_review) != approver (approved).
 */
export async function updateKycStatus(
  supplierId: string,
  update: KycStatusUpdate,
  reviewerId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const supplier = await repo.findSupplierById(supplierId);
  if (supplier === null) {
    throw new NotFoundError('Supplier', supplierId);
  }

  const currentStatus = supplier.kyc_status;
  const newStatus = update.status;
  validateKycTransition(currentStatus, newStatus);

  if (newStatus === KycStatus.APPROVED) {
    await enforceKycMakerChecker(supplierId, reviewerId);
  }

  await executeKycStatusTx(
    supplierId,
    currentStatus,
    newStatus,
    update,
    reviewerId,
    ipAddress,
    userAgent,
  );
  await postKycStatusUpdate(supplierId, currentStatus, newStatus, reviewerId, update.comments);
}

async function executeKycStatusTx(
  supplierId: string,
  currentStatus: KycStatus,
  newStatus: KycStatus,
  update: KycStatusUpdate,
  reviewerId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await setKycRoleMarkers(client, supplierId, newStatus, reviewerId);
    await repo.createAuditEntryWithClient(
      client,
      reviewerId,
      'KYC_STATUS_CHANGED',
      'suppliers',
      supplierId,
      { previousStatus: currentStatus },
      { newStatus, comments: update.comments },
      ipAddress,
      userAgent,
    );
    await repo.updateKycStatusWithClient(client, supplierId, newStatus);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function setKycRoleMarkers(
  client: PoolClient,
  supplierId: string,
  newStatus: KycStatus,
  reviewerId: string,
): Promise<void> {
  if (newStatus === KycStatus.UNDER_REVIEW) {
    await repo.setKycReviewerWithClient(client, supplierId, reviewerId);
  }
  if (newStatus === KycStatus.APPROVED) {
    await repo.setKycApproverWithClient(client, supplierId, reviewerId);
  }
}

async function postKycStatusUpdate(
  supplierId: string,
  currentStatus: KycStatus,
  newStatus: KycStatus,
  reviewerId: string,
  comments?: string,
): Promise<void> {
  logger.audit('KYC_STATUS_CHANGED', {
    component: 'onboarding',
    supplierId,
    reviewerId,
    previousStatus: currentStatus,
    newStatus,
  });
  await queueKycNotification(supplierId, newStatus, comments);
}

/**
 * Enforce that the KYC approver is different from the reviewer.
 */
async function enforceKycMakerChecker(supplierId: string, approverId: string): Promise<void> {
  const reviewerId = await repo.getKycReviewer(supplierId);
  if (reviewerId !== null && reviewerId === approverId) {
    throw new BusinessRuleError(
      'KYC_SAME_REVIEWER_APPROVER',
      'KYC reviewer and approver must be different users',
    );
  }
}

// =========================================================================
// List Suppliers (staff only)
// =========================================================================

/**
 * List suppliers with pagination for staff.
 */
export async function listSuppliersForStaff(
  pagination: PaginationParams,
  kycStatusFilter?: string,
): Promise<PaginatedResult<SupplierProfile>> {
  const { rows, total } = await repo.listSuppliers(pagination, kycStatusFilter);

  return {
    data: rows.map(toSupplierProfile),
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(total / pagination.limit),
  };
}

// =========================================================================
// Buyer CRUD
// =========================================================================

/**
 * Create a new buyer profile. Credit officer only.
 */
export async function createBuyer(
  data: BuyerCreation,
  createdBy: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ buyerId: string }> {
  const regExists = await repo.buyerRegistrationNumberExists(data.registration_number);
  if (regExists) {
    throw new BusinessRuleError(
      'REGISTRATION_NUMBER_TAKEN',
      'A buyer with this registration number already exists',
    );
  }

  const buyerId = uuidv4();
  await insertBuyerRecord(buyerId, data, createdBy);
  await postBuyerCreation(buyerId, data, createdBy, ipAddress, userAgent);

  return { buyerId };
}

async function insertBuyerRecord(
  buyerId: string,
  data: BuyerCreation,
  createdBy: string,
): Promise<void> {
  await repo.createBuyer({
    id: buyerId,
    companyName: data.company_name,
    registrationNumber: data.registration_number,
    creditRating: data.credit_rating,
    approvedLimit: String(data.approved_limit),
    paymentScore: data.payment_score,
    contactEmailEncrypted: encrypt(data.contact_email),
    contactPhoneEncrypted: encrypt(data.contact_phone),
    risMarginRate: data.ris_margin_rate ?? 0.03,
    paymentUndertakingSigned: data.payment_undertaking_signed ?? false,
    paymentUndertakingDate: data.payment_undertaking_date ?? null,
    createdBy,
  });
}

async function postBuyerCreation(
  buyerId: string,
  data: BuyerCreation,
  createdBy: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await checkSanctions(
    data.company_name,
    data.registration_number,
    'buyers',
    buyerId,
    createdBy,
    ipAddress,
    userAgent,
  );
  await repo.createAuditEntry(
    createdBy,
    'BUYER_CREATED',
    'buyers',
    buyerId,
    null,
    { creditRating: data.credit_rating, approvedLimit: String(data.approved_limit) },
    ipAddress,
    userAgent,
  );
  logger.audit('BUYER_CREATED', {
    component: 'onboarding',
    buyerId,
    createdBy,
  });
}

/**
 * Get buyer by ID.
 */
export async function getBuyerProfile(buyerId: string): Promise<BuyerProfile> {
  const buyer = await repo.findBuyerById(buyerId);
  if (buyer === null) {
    throw new NotFoundError('Buyer', buyerId);
  }
  return toBuyerProfile(buyer);
}

/**
 * List buyers with pagination.
 */
export async function listBuyersForStaff(
  pagination: PaginationParams,
): Promise<PaginatedResult<BuyerProfile>> {
  const { rows, total } = await repo.listBuyers(pagination);

  return {
    data: rows.map(toBuyerProfile),
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(total / pagination.limit),
  };
}

/**
 * Update buyer fields. Credit officer only.
 */
export async function updateBuyerProfile(
  buyerId: string,
  data: BuyerUpdate,
  updatedBy: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const buyer = await repo.findBuyerById(buyerId);
  if (buyer === null) {
    throw new NotFoundError('Buyer', buyerId);
  }

  const fields = buildBuyerUpdateFields(data);
  if (Object.keys(fields).length === 0) {
    return;
  }

  await repo.updateBuyer(buyerId, fields);
  await auditBuyerUpdate(buyerId, fields, updatedBy, ipAddress, userAgent);
}

function buildBuyerUpdateFields(data: BuyerUpdate): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (data.company_name !== undefined) {
    fields.company_name = data.company_name;
  }
  if (data.credit_rating !== undefined) {
    fields.credit_rating = data.credit_rating;
  }
  if (data.approved_limit !== undefined) {
    fields.approved_limit = String(data.approved_limit);
  }
  if (data.payment_score !== undefined) {
    fields.payment_score = data.payment_score;
  }
  if (data.contact_email !== undefined) {
    fields.contact_email_encrypted = encrypt(data.contact_email);
  }
  if (data.contact_phone !== undefined) {
    fields.contact_phone_encrypted = encrypt(data.contact_phone);
  }
  if (data.ris_margin_rate !== undefined) {
    fields.ris_margin_rate = data.ris_margin_rate;
  }
  if (data.is_active !== undefined) {
    fields.is_active = data.is_active;
  }
  if (data.payment_undertaking_signed !== undefined) {
    fields.payment_undertaking_signed = data.payment_undertaking_signed;
  }
  if (data.payment_undertaking_date !== undefined) {
    fields.payment_undertaking_date = data.payment_undertaking_date;
  }
  return fields;
}

async function auditBuyerUpdate(
  buyerId: string,
  fields: Record<string, unknown>,
  updatedBy: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.createAuditEntry(
    updatedBy,
    'BUYER_UPDATED',
    'buyers',
    buyerId,
    null,
    { fieldsUpdated: Object.keys(fields) },
    ipAddress,
    userAgent,
  );
  logger.audit('BUYER_UPDATED', {
    component: 'onboarding',
    buyerId,
    updatedBy,
    fieldsUpdated: Object.keys(fields),
  });
}

// =========================================================================
// URSB Verification (Phase 3)
// =========================================================================

/**
 * Record the outcome of a URSB company-registration verification for a supplier.
 */
export async function recordUrsbVerification(
  supplierId: string,
  verified: boolean,
  reviewerId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const supplier = await repo.findSupplierById(supplierId);
  if (supplier === null) {
    throw new NotFoundError('Supplier', supplierId);
  }
  if (!supplier.consent_ursb_check) {
    throw new BusinessRuleError(
      'CONSENT_NOT_GIVEN',
      'Supplier has not consented to URSB verification',
    );
  }

  await executeUrsbVerificationTx(supplierId, verified, reviewerId, ipAddress, userAgent);
  logger.audit('URSB_VERIFIED', {
    component: 'onboarding',
    supplierId,
    reviewerId,
  });
}

async function executeUrsbVerificationTx(
  supplierId: string,
  verified: boolean,
  reviewerId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.setUrsbVerifiedWithClient(client, supplierId, verified, reviewerId);
    await repo.createAuditEntryWithClient(
      client,
      reviewerId,
      'URSB_VERIFIED',
      'suppliers',
      supplierId,
      null,
      { verified },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// Litigation Check (Phase 3)
// =========================================================================

/**
 * Record the outcome of a litigation screening for a supplier.
 */
export async function recordLitigationCheck(
  supplierId: string,
  flag: boolean,
  reviewerId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const supplier = await repo.findSupplierById(supplierId);
  if (supplier === null) {
    throw new NotFoundError('Supplier', supplierId);
  }
  if (!supplier.consent_litigation_check) {
    throw new BusinessRuleError(
      'CONSENT_NOT_GIVEN',
      'Supplier has not consented to litigation check',
    );
  }

  await executeLitigationCheckTx(supplierId, flag, reviewerId, ipAddress, userAgent);
  logger.audit('LITIGATION_CHECK_RECORDED', {
    component: 'onboarding',
    supplierId,
    reviewerId,
  });
}

async function executeLitigationCheckTx(
  supplierId: string,
  flag: boolean,
  reviewerId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.setLitigationCheckWithClient(client, supplierId, flag, reviewerId);
    await repo.createAuditEntryWithClient(
      client,
      reviewerId,
      'LITIGATION_CHECK_RECORDED',
      'suppliers',
      supplierId,
      null,
      { litigationFlag: flag },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// Sanctions Screening
// =========================================================================

/**
 * Check a name/registration against the sanctions list.
 * Non-blocking: flags but does not reject.
 */
async function checkSanctions(
  companyName: string,
  registrationNumber: string,
  tableName: string,
  recordId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const sanctions = loadSanctionsList();
  const match = findSanctionsMatch(sanctions.entries, companyName, registrationNumber);
  await checkPepDesignation(sanctions.entries, companyName, tableName, recordId);

  if (match === null) {
    return;
  }
  await raiseSanctionsFlag(tableName, recordId, match, userId, ipAddress, userAgent);
}

async function raiseSanctionsFlag(
  tableName: string,
  recordId: string,
  match: SanctionsEntry,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  if (tableName === 'suppliers') {
    await repo.setSanctionsFlag(recordId, true);
  } else {
    await repo.setBuyerSanctionsFlag(recordId, true);
  }
  await repo.createAuditEntry(
    userId,
    'SANCTIONS_FLAG_RAISED',
    tableName,
    recordId,
    null,
    { matchedEntryRegNo: match.registration_number ?? 'unknown', reason: match.reason },
    ipAddress,
    userAgent,
  );
  logger.audit('SANCTIONS_FLAG_RAISED', {
    component: 'onboarding',
    tableName,
    recordId,
  });
  throw new BusinessRuleError(
    'SANCTIONS_MATCH',
    'Entity failed sanctions screening — creation blocked pending compliance review',
  );
}

/**
 * Check if any sanctions entry flags PEP designation for a company name.
 * Sets pep_designation on the supplier or buyer record if matched.
 */
async function checkPepDesignation(
  entries: SanctionsEntry[],
  companyName: string,
  tableName: string,
  recordId: string,
): Promise<void> {
  const nameLower = companyName.toLowerCase();
  for (const entry of entries) {
    if (entry.pep_designation === true && entry.name.toLowerCase() === nameLower) {
      if (tableName === 'suppliers') {
        await repo.setPepDesignation(recordId, true);
      } else {
        await repo.setBuyerPepDesignation(recordId, true);
      }
      logger.audit('PEP_DESIGNATION_SET', {
        component: 'onboarding',
        tableName,
        recordId,
      });
      return;
    }
  }
}

function loadSanctionsList(): SanctionsList {
  const filePath = path.resolve('config', 'sanctions.json');
  if (!fs.existsSync(filePath)) {
    throw new RisError(
      `SANCTIONS_LIST_EMPTY: config/sanctions.json not found at ${filePath}`,
      500,
      'SANCTIONS_LIST_EMPTY',
    );
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const sanctions = JSON.parse(raw) as SanctionsList;
  if (!Array.isArray(sanctions.entries) || sanctions.entries.length === 0) {
    throw new RisError(
      'SANCTIONS_LIST_EMPTY: config/sanctions.json entries array is empty — populate before starting the server',
      500,
      'SANCTIONS_LIST_EMPTY',
    );
  }
  logger.info('Sanctions list loaded', {
    component: 'onboarding',
    entryCount: sanctions.entries.length,
  });
  return sanctions;
}

function findSanctionsMatch(
  entries: SanctionsEntry[],
  companyName: string,
  registrationNumber: string,
): SanctionsEntry | null {
  const nameLower = companyName.toLowerCase();
  for (const entry of entries) {
    if (entry.name.toLowerCase() === nameLower) {
      return entry;
    }
    if (
      entry.registration_number !== undefined &&
      entry.registration_number !== '' &&
      entry.registration_number === registrationNumber
    ) {
      return entry;
    }
  }
  return null;
}

// =========================================================================
// Private helpers
// =========================================================================

function validateFile(file: { mimetype: string; size: number }): void {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new ValidationError('Invalid file type. Allowed: PDF, JPEG, PNG', [
      { field: 'file', message: `Unsupported MIME type: ${file.mimetype}` },
    ]);
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new ValidationError('File too large. Maximum size: 10MB', [
      { field: 'file', message: `File size ${String(file.size)} exceeds 10MB limit` },
    ]);
  }
}

function validateKycTransition(current: KycStatus, next: KycStatus): void {
  const allowed: Record<string, string[]> = {
    [KycStatus.PENDING]: [KycStatus.DOCUMENTS_SUBMITTED],
    [KycStatus.DOCUMENTS_SUBMITTED]: [KycStatus.UNDER_REVIEW],
    [KycStatus.UNDER_REVIEW]: [KycStatus.APPROVED, KycStatus.REJECTED],
  };

  const validTransitions = allowed[current];
  if (validTransitions === undefined || !validTransitions.includes(next)) {
    throw new BusinessRuleError(
      'INVALID_KYC_TRANSITION',
      `Cannot transition from '${current}' to '${next}'`,
      { currentStatus: current, requestedStatus: next },
    );
  }
}

async function autoAdvanceKycStatus(
  supplierId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  if (!(await shouldAutoAdvance(supplierId))) {
    return;
  }
  await advanceToDocumentsSubmitted(supplierId, userId, ipAddress, userAgent);
}

async function shouldAutoAdvance(supplierId: string): Promise<boolean> {
  const supplier = await repo.findSupplierById(supplierId);
  if (supplier === null || supplier.kyc_status !== KycStatus.PENDING) {
    return false;
  }
  const existingTypes = await repo.getDocumentTypeCounts(supplierId);
  return REQUIRED_DOC_TYPE_GROUPS.every((group) =>
    group.some((alias) => existingTypes.includes(alias)),
  );
}

async function advanceToDocumentsSubmitted(
  supplierId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await repo.updateKycStatus(supplierId, KycStatus.DOCUMENTS_SUBMITTED);
  await repo.createAuditEntry(
    userId,
    'KYC_AUTO_ADVANCED',
    'suppliers',
    supplierId,
    { previousStatus: KycStatus.PENDING },
    { newStatus: KycStatus.DOCUMENTS_SUBMITTED, reason: 'All required documents uploaded' },
    ipAddress,
    userAgent,
  );
  logger.audit('KYC_AUTO_ADVANCED', {
    component: 'onboarding',
    supplierId,
  });
}

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function toSupplierProfile(s: SupplierRecord): SupplierProfile {
  return {
    id: s.id,
    user_id: s.user_id,
    company_name: decryptOrFallback(s.company_name_encrypted, s.company_name),
    registration_number: s.registration_number,
    tax_id: decryptOrFallback(s.tax_id_encrypted, s.tax_id),
    directors: decryptDirectors(s.directors_encrypted, s.directors),
    bank_name: s.bank_name,
    bank_branch: s.bank_branch,
    preferred_payment_method: s.preferred_payment_method,
    kyc_status: s.kyc_status,
    sanctions_flag: s.sanctions_flag,
    required_financing_amount: s.required_financing_amount,
    consent_ursb_check: s.consent_ursb_check,
    consent_supplier_refs: s.consent_supplier_refs,
    consent_litigation_check: s.consent_litigation_check,
    ursb_verified: s.ursb_verified,
    ursb_verified_at: s.ursb_verified_at,
    litigation_checked: s.litigation_checked,
    litigation_flag: s.litigation_flag,
    created_at: s.created_at,
  };
}

function toBuyerProfile(b: BuyerRecord): BuyerProfile {
  return {
    id: b.id,
    company_name: b.company_name,
    registration_number: b.registration_number,
    credit_rating: b.credit_rating,
    approved_limit: b.approved_limit,
    used_limit: b.used_limit,
    ris_margin_rate: b.ris_margin_rate,
    payment_score: b.payment_score,
    is_active: b.is_active,
    sanctions_flag: b.sanctions_flag,
    payment_undertaking_signed: b.payment_undertaking_signed,
    payment_undertaking_date: b.payment_undertaking_date,
    created_at: b.created_at,
  };
}

// =========================================================================
// Checkers §5b — General feedback to applicant
// =========================================================================

/**
 * Send a free-text feedback message from staff to a supplier outside of
 * approve/reject. Emails the supplier, audit-logs the event. Not gated on
 * KYC status — staff may send feedback at any point during the review.
 */
export async function sendSupplierFeedback(
  supplierId: string,
  reviewerUserId: string,
  message: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const trimmed = message.trim();
  if (trimmed.length < 10) {
    throw new ValidationError('Feedback message must be at least 10 characters');
  }
  if (trimmed.length > 2000) {
    throw new ValidationError('Feedback message must be 2000 characters or fewer');
  }

  const supplier = await repo.findSupplierById(supplierId);
  if (supplier === null) {
    throw new NotFoundError('Supplier', supplierId);
  }

  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.createAuditEntryWithClient(
      client,
      reviewerUserId,
      'SUPPLIER_FEEDBACK_SENT',
      'suppliers',
      supplierId,
      null,
      { supplierId, messageLength: trimmed.length },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await queueOnboardingNotification('supplier_feedback', {
    supplierId,
    message: trimmed,
    reviewerUserId,
  });

  logger.audit('SUPPLIER_FEEDBACK_SENT', {
    component: 'onboarding',
    supplierId,
    reviewerUserId,
  });
}

// =========================================================================
// Notification helpers
// =========================================================================

async function queueOnboardingNotification(
  type: string,
  payload: Record<string, string>,
): Promise<void> {
  if (notificationQueue === null) {
    logger.warn('Notification queue not configured', { component: 'onboarding', type });
    return;
  }
  await enqueueWithContext(notificationQueue, type, payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
  });
}

async function queueKycNotification(
  supplierId: string,
  newStatus: string,
  comments?: string,
): Promise<void> {
  const approved = KycStatus.APPROVED as string;
  const rejected = KycStatus.REJECTED as string;
  if (newStatus !== approved && newStatus !== rejected) {
    return;
  }
  const template = newStatus === approved ? 'kyc_approved' : 'kyc_rejected';
  await queueOnboardingNotification(template, {
    supplierId,
    rejectionReason: comments ?? '',
  });
}

// =========================================================================
// Buyer Onboarding Request helpers
// =========================================================================

function encryptOptionalPii(data: CreateBuyerRequestInput): {
  contactNameEnc: string | null;
  contactEmailEnc: string | null;
  contactPhoneEnc: string | null;
} {
  return {
    contactNameEnc: data.contact_name ? encrypt(data.contact_name) : null,
    contactEmailEnc: data.contact_email ? encrypt(data.contact_email) : null,
    contactPhoneEnc: data.contact_phone ? encrypt(data.contact_phone) : null,
  };
}

function decryptBuyerRequest(record: BuyerOnboardingRequestRecord): BuyerOnboardingRequestPublic {
  const { contact_name_encrypted, contact_email_encrypted, contact_phone_encrypted, ...rest } =
    record;
  return {
    ...rest,
    contact_name: contact_name_encrypted ? decrypt(contact_name_encrypted) : null,
    contact_email: contact_email_encrypted ? decrypt(contact_email_encrypted) : null,
    contact_phone: contact_phone_encrypted ? decrypt(contact_phone_encrypted) : null,
  };
}

// =========================================================================
// Buyer Onboarding Requests (Stage 4)
// =========================================================================

/**
 * Supplier requests onboarding for a new buyer.
 */
export async function createBuyerOnboardingRequest(
  supplierId: string,
  data: CreateBuyerRequestInput,
  ipAddress: string,
  userAgent: string,
): Promise<{ requestId: string }> {
  const requestId = uuidv4();
  const encrypted = encryptOptionalPii(data);

  await executeBuyerRequestTx(requestId, supplierId, data, encrypted, ipAddress, userAgent);
  logger.audit('BUYER_ONBOARDING_REQUESTED', {
    component: 'onboarding',
    requestId,
    supplierId,
  });
  await queueOnboardingNotification('buyer_request_submitted', {
    requestId,
    supplierId,
  });

  return { requestId };
}

async function executeBuyerRequestTx(
  requestId: string,
  supplierId: string,
  data: CreateBuyerRequestInput,
  encrypted: ReturnType<typeof encryptOptionalPii>,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.createBuyerOnboardingRequestWithClient(client, {
      id: requestId,
      supplierId,
      companyName: data.company_name,
      registrationNumber: data.registration_number ?? null,
      contactNameEncrypted: encrypted.contactNameEnc,
      contactEmailEncrypted: encrypted.contactEmailEnc,
      contactPhoneEncrypted: encrypted.contactPhoneEnc,
      reason: data.reason,
    });
    await repo.createAuditEntryWithClient(
      client,
      supplierId,
      'BUYER_ONBOARDING_REQUESTED',
      'buyer_onboarding_requests',
      requestId,
      null,
      { requestId },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Credit officer reviews a buyer onboarding request.
 */
export async function reviewBuyerOnboardingRequest(
  requestId: string,
  reviewerId: string,
  data: ReviewBuyerRequestInput,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const request = await repo.getBuyerOnboardingRequestById(requestId);
  if (request === null) {
    throw new NotFoundError('BuyerOnboardingRequest', requestId);
  }
  validateBuyerRequestReviewable(request.status);

  await executeReviewBuyerRequestTx(request, reviewerId, data, ipAddress, userAgent);
  logger.audit('BUYER_REQUEST_REVIEWED', {
    component: 'onboarding',
    requestId,
    reviewerId,
    status: data.status,
  });
  await queueOnboardingNotification('buyer_request_reviewed', {
    requestId,
    supplierId: request.supplier_id,
  });
}

function validateBuyerRequestReviewable(status: string): void {
  const pending = BuyerRequestStatus.PENDING as string;
  const inReview = BuyerRequestStatus.IN_REVIEW as string;
  if (status !== pending && status !== inReview) {
    throw new BusinessRuleError(
      BuyerRequestErrorCode.ALREADY_REVIEWED,
      'This request has already been reviewed',
    );
  }
}

async function executeReviewBuyerRequestTx(
  request: BuyerOnboardingRequestRecord,
  reviewerId: string,
  data: ReviewBuyerRequestInput,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const requestId = request.id;
  const client = await repo.getClient();
  try {
    await beginWithRls(client);

    // If the credit officer approves without nominating an existing buyer,
    // materialise one from the request data so the supplier dropdown and
    // /buyers list start to show it. linked_buyer_id then points to the new
    // record. Same transaction as the status flip — request never approves
    // without a usable buyer underneath it.
    let resolvedLinkedBuyerId: string | null = data.linked_buyer_id ?? null;
    if (data.status === 'approved' && resolvedLinkedBuyerId === null) {
      resolvedLinkedBuyerId = await materialiseBuyerFromRequest(client, request, reviewerId);
      await repo.createAuditEntryWithClient(
        client,
        reviewerId,
        'BUYER_CREATED',
        'buyers',
        resolvedLinkedBuyerId,
        null,
        { source: 'buyer_request_approval', requestId },
        ipAddress,
        userAgent,
      );
    }

    await repo.updateBuyerRequestStatusWithClient(
      client,
      requestId,
      data.status,
      reviewerId,
      data.reviewer_comments ?? null,
      resolvedLinkedBuyerId,
    );
    await repo.createAuditEntryWithClient(
      client,
      reviewerId,
      'BUYER_REQUEST_REVIEWED',
      'buyer_onboarding_requests',
      requestId,
      null,
      { requestId, status: data.status, linkedBuyerId: resolvedLinkedBuyerId },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Default starting credit for an auto-created buyer (UGX 50,000,000). The
 * credit officer can tighten or loosen via PUT /admin/buyers/:id afterwards.
 * Picked above the buyers.approved_limit > 0 CHECK constraint and well below
 * any realistic invoice ceiling.
 */
const DEFAULT_AUTO_BUYER_LIMIT = '50000000';
const DEFAULT_AUTO_BUYER_RATING = 'B';
const DEFAULT_AUTO_BUYER_PAYMENT_SCORE = 50;
const DEFAULT_RIS_MARGIN_RATE = 0.03;

/**
 * Build a stable, unique fallback registration number for buyers created from
 * a request that didn't supply one. Uses the request's UUID prefix to keep
 * the value short, deterministic, and easy to spot in audits.
 */
function autoRegistrationNumber(requestId: string): string {
  return `AUTO-${requestId.slice(0, 8).toUpperCase()}`;
}

/**
 * Insert a new buyer row from an onboarding request, sharing the caller's
 * transaction client. Reuses the request's encrypted contact ciphertext
 * directly — same KMS key, no need to round-trip through decrypt + encrypt.
 */
async function materialiseBuyerFromRequest(
  client: PoolClient,
  request: BuyerOnboardingRequestRecord,
  reviewerId: string,
): Promise<string> {
  const buyerId = uuidv4();
  await repo.createBuyerWithClient(client, {
    id: buyerId,
    companyName: request.company_name,
    registrationNumber: request.registration_number ?? autoRegistrationNumber(request.id),
    creditRating: DEFAULT_AUTO_BUYER_RATING,
    approvedLimit: DEFAULT_AUTO_BUYER_LIMIT,
    paymentScore: DEFAULT_AUTO_BUYER_PAYMENT_SCORE,
    contactEmailEncrypted: request.contact_email_encrypted,
    contactPhoneEncrypted: request.contact_phone_encrypted,
    risMarginRate: DEFAULT_RIS_MARGIN_RATE,
    paymentUndertakingSigned: false,
    paymentUndertakingDate: null,
    createdBy: reviewerId,
  });
  return buyerId;
}

/**
 * List buyer onboarding requests for staff review.
 */
export async function listBuyerOnboardingRequestsForReview(
  params: PaginationParams & { status?: string },
): Promise<PaginatedResult<BuyerOnboardingRequestPublic>> {
  const { rows, total } = await repo.listBuyerOnboardingRequests(params);
  return {
    data: rows.map(decryptBuyerRequest),
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}

/**
 * List buyer onboarding requests for a specific supplier.
 */
export async function listSupplierBuyerRequests(
  supplierId: string,
  params: PaginationParams,
): Promise<PaginatedResult<BuyerOnboardingRequestPublic>> {
  const { rows, total } = await repo.listBuyerOnboardingRequestsBySupplier(supplierId, params);
  return {
    data: rows.map(decryptBuyerRequest),
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}

// =========================================================================
// Beneficial Ownership (UBO) CRUD
// =========================================================================

/**
 * Add a beneficial owner to a supplier. Encrypts PII before storage.
 */
export async function addBeneficialOwner(
  supplierId: string,
  input: CreateUboInput,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ uboId: string }> {
  await validateSupplierExists(supplierId);
  const uboId = uuidv4();
  const encrypted = encryptUboPii(input);

  await executeAddUboTx(supplierId, uboId, encrypted, input, userId, ipAddress, userAgent);
  logger.audit('UBO_CREATED', {
    component: 'onboarding',
    supplierId,
    uboId,
  });
  return { uboId };
}

async function executeAddUboTx(
  supplierId: string,
  uboId: string,
  encrypted: ReturnType<typeof encryptUboPii>,
  input: CreateUboInput,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.createUboWithClient(client, supplierId, uboId, encrypted);
    await repo.createAuditEntryWithClient(
      client,
      userId,
      'UBO_CREATED',
      'beneficial_owners',
      uboId,
      null,
      { supplierId, ownershipPercentage: input.ownership_percentage, isPep: input.is_pep },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List beneficial owners for a supplier, decrypting PII.
 */
export async function listBeneficialOwners(supplierId: string): Promise<BeneficialOwner[]> {
  await validateSupplierExists(supplierId);
  const rows = await repo.getUbosBySupplier(supplierId);
  return rows.map(decryptUboRecord);
}

/**
 * Update a beneficial owner. Encrypts PII, enforces ownership.
 */
export async function updateBeneficialOwner(
  uboId: string,
  supplierId: string,
  input: CreateUboInput,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await validateSupplierExists(supplierId);
  const encrypted = encryptUboPii(input);

  await executeUpdateUboTx(uboId, supplierId, encrypted, input, userId, ipAddress, userAgent);
  logger.audit('UBO_UPDATED', {
    component: 'onboarding',
    supplierId,
    uboId,
  });
}

async function executeUpdateUboTx(
  uboId: string,
  supplierId: string,
  encrypted: ReturnType<typeof encryptUboPii>,
  input: CreateUboInput,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    const rowCount = await repo.updateUboWithClient(client, uboId, supplierId, encrypted);
    if (rowCount === 0) {
      throw new NotFoundError('BeneficialOwner', uboId);
    }
    await repo.createAuditEntryWithClient(
      client,
      userId,
      'UBO_UPDATED',
      'beneficial_owners',
      uboId,
      null,
      { supplierId, ownershipPercentage: input.ownership_percentage, isPep: input.is_pep },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Remove a beneficial owner. Enforces supplier ownership.
 */
export async function removeBeneficialOwner(
  uboId: string,
  supplierId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await executeDeleteUboTx(uboId, supplierId, userId, ipAddress, userAgent);
  logger.audit('UBO_DELETED', {
    component: 'onboarding',
    supplierId,
    uboId,
  });
}

async function executeDeleteUboTx(
  uboId: string,
  supplierId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    const rowCount = await repo.deleteUboWithClient(client, uboId, supplierId);
    if (rowCount === 0) {
      throw new NotFoundError('BeneficialOwner', uboId);
    }
    await repo.createAuditEntryWithClient(
      client,
      userId,
      'UBO_DELETED',
      'beneficial_owners',
      uboId,
      null,
      { supplierId },
      ipAddress,
      userAgent,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// KYC Renewal
// =========================================================================

/**
 * Check if a supplier's KYC renewal is overdue.
 */
export async function checkKycExpiry(supplierId: string): Promise<boolean> {
  const supplier = await repo.findSupplierById(supplierId);
  if (supplier === null) {
    throw new NotFoundError('Supplier', supplierId);
  }

  const record = supplier as SupplierRecord & { kyc_renewal_due_at?: string | null };
  if (!record.kyc_renewal_due_at) {
    return false;
  }

  return new Date(record.kyc_renewal_due_at) < new Date();
}

// =========================================================================
// UBO Private Helpers
// =========================================================================

function encryptUboPii(input: CreateUboInput): {
  fullNameEncrypted: string;
  nationality: string;
  idType: string;
  idNumberEncrypted: string;
  ownershipPercentage: number;
  isPep: boolean;
} {
  return {
    fullNameEncrypted: encrypt(input.full_name),
    nationality: input.nationality,
    idType: input.id_type,
    idNumberEncrypted: encrypt(input.id_number),
    ownershipPercentage: input.ownership_percentage,
    isPep: input.is_pep,
  };
}

function decryptUboRecord(r: BeneficialOwnerRecord): BeneficialOwner {
  return {
    id: r.id,
    supplier_id: r.supplier_id,
    full_name: decrypt(r.full_name_encrypted),
    nationality: r.nationality,
    id_type: r.id_type,
    id_number: decrypt(r.id_number_encrypted),
    ownership_percentage: r.ownership_percentage,
    is_pep: r.is_pep,
    verified_at: r.verified_at,
    verified_by: r.verified_by,
  };
}

async function validateSupplierExists(supplierId: string): Promise<void> {
  const supplier = await repo.findSupplierById(supplierId);
  if (supplier === null) {
    throw new NotFoundError('Supplier', supplierId);
  }
}
