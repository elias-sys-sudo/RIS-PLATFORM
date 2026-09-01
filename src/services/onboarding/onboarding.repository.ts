import type { PoolClient } from 'pg';
import { query, pool } from '../../shared/database/pool';
import type {
  SupplierRecord,
  BuyerRecord,
  DocumentRecord,
  PaginationParams,
  EligibilityCheckRecord,
  EligibilityThrottleSignals,
  BuyerOnboardingRequestRecord,
  BeneficialOwnerRecord,
} from './onboarding.types';

/**
 * Acquire a client from the pool for transactional operations.
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

// =========================================================================
// Supplier queries
// =========================================================================

/**
 * Create a new supplier record.
 */
export async function createSupplier(data: {
  id: string;
  userId: string;
  companyNameEncrypted: string;
  registrationNumber: string;
  taxIdEncrypted: string;
  directorsEncrypted: string;
  bankName: string;
  bankAccountNumberEncrypted: string;
  bankAccountNameEncrypted: string;
  bankBranch: string;
  preferredPaymentMethod: string;
  mobileMoneyNumberEncrypted: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO suppliers (
      id, user_id, company_name_encrypted, registration_number,
      tax_id_encrypted, directors_encrypted, bank_name,
      bank_account_number_encrypted, bank_account_name_encrypted,
      bank_branch, preferred_payment_method,
      mobile_money_number_encrypted
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      data.id,
      data.userId,
      data.companyNameEncrypted,
      data.registrationNumber,
      data.taxIdEncrypted,
      data.directorsEncrypted,
      data.bankName,
      data.bankAccountNumberEncrypted,
      data.bankAccountNameEncrypted,
      data.bankBranch,
      data.preferredPaymentMethod,
      data.mobileMoneyNumberEncrypted,
    ],
  );
}

/**
 * Find supplier by primary key.
 */
export async function findSupplierById(id: string): Promise<SupplierRecord | null> {
  const result = await query<SupplierRecord>(`SELECT * FROM suppliers WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

/**
 * Find supplier by the linked user account.
 */
export async function findSupplierByUserId(userId: string): Promise<SupplierRecord | null> {
  const result = await query<SupplierRecord>(`SELECT * FROM suppliers WHERE user_id = $1`, [
    userId,
  ]);
  return result.rows[0] ?? null;
}

/**
 * Update KYC status with reviewer attribution.
 */
export async function updateKycStatus(supplierId: string, status: string): Promise<void> {
  await query(`UPDATE suppliers SET kyc_status = $1 WHERE id = $2`, [status, supplierId]);
}

/**
 * Set sanctions flag on a supplier and record check timestamp.
 */
export async function setSanctionsFlag(supplierId: string, flagged: boolean): Promise<void> {
  await query(
    `UPDATE suppliers SET sanctions_flag = $1, sanctions_last_checked_at = NOW() WHERE id = $2`,
    [flagged, supplierId],
  );
}

/**
 * List suppliers with pagination and optional KYC status filter.
 */
export async function listSuppliers(
  pagination: PaginationParams,
  kycStatusFilter?: string,
): Promise<{ rows: SupplierRecord[]; total: number }> {
  const offset = (pagination.page - 1) * pagination.limit;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (kycStatusFilter !== undefined) {
    conditions.push(`kyc_status = $${String(paramIdx)}`);
    params.push(kycStatusFilter);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM suppliers ${whereClause}`,
    params,
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const dataResult = await query<SupplierRecord>(
    `SELECT * FROM suppliers ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${String(paramIdx)} OFFSET $${String(paramIdx + 1)}`,
    [...params, pagination.limit, offset],
  );

  return { rows: dataResult.rows, total };
}

// =========================================================================
// Document queries
// =========================================================================

/**
 * Insert a document record.
 */
export async function createDocument(data: {
  id: string;
  invoiceId: string | null;
  supplierId: string;
  documentType: string;
  encryptedPath: string;
  fileHash: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedBy: string;
}): Promise<void> {
  await query(
    `INSERT INTO invoice_documents (
      id, invoice_id, supplier_id, document_type,
      encrypted_path, file_hash, file_size_bytes,
      mime_type, uploaded_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      data.id,
      data.invoiceId,
      data.supplierId,
      data.documentType,
      data.encryptedPath,
      data.fileHash,
      data.fileSizeBytes,
      data.mimeType,
      data.uploadedBy,
    ],
  );
}

/**
 * Find all documents belonging to a supplier.
 */
export async function findDocumentsBySupplierId(supplierId: string): Promise<DocumentRecord[]> {
  const result = await query<DocumentRecord>(
    `SELECT * FROM invoice_documents
     WHERE supplier_id = $1
     ORDER BY created_at DESC`,
    [supplierId],
  );
  return result.rows;
}

/**
 * Find a single document by id, scoped to a supplier. Used by the download
 * endpoint to serve back encrypted KYC files: the supplier-id scope prevents
 * cross-tenant leaks (supplier B cannot fetch supplier A's documentId even
 * if guessed). Returns `null` when the (id, supplier_id) pair has no match —
 * the service layer maps that to `NotFoundError`, never leaking whether the
 * row exists under a different supplier.
 */
export async function findDocumentByIdAndSupplier(
  documentId: string,
  supplierId: string,
): Promise<DocumentRecord | null> {
  const result = await query<DocumentRecord>(
    `SELECT * FROM invoice_documents
     WHERE id = $1 AND supplier_id = $2
     LIMIT 1`,
    [documentId, supplierId],
  );
  return result.rows[0] ?? null;
}

/**
 * Find a single document scoped by id + invoice_id. Mirror of
 * findDocumentByIdAndSupplier but for the invoice-scoped fetch path
 * (GET /invoices/:id/documents/:docId/file). The invoice-id scope prevents
 * cross-invoice leaks: a supplier with access to invoice A cannot fetch a
 * documentId attached to invoice B even by guessing. Returns `null` when
 * (id, invoice_id) has no match — the service layer maps that to NotFoundError.
 */
export async function findDocumentByIdAndInvoice(
  documentId: string,
  invoiceId: string,
): Promise<DocumentRecord | null> {
  const result = await query<DocumentRecord>(
    `SELECT * FROM invoice_documents
     WHERE id = $1 AND invoice_id = $2
     LIMIT 1`,
    [documentId, invoiceId],
  );
  return result.rows[0] ?? null;
}

/**
 * Count distinct document types a supplier has uploaded.
 */
export async function getDocumentTypeCounts(supplierId: string): Promise<string[]> {
  const result = await query<{ document_type: string }>(
    `SELECT DISTINCT document_type FROM invoice_documents
     WHERE supplier_id = $1`,
    [supplierId],
  );
  return result.rows.map((r) => r.document_type);
}

/**
 * Returns the distinct document types for a supplier whose MOST-RECENTLY
 * uploaded instance is approved. Used by the service-layer auto-promote
 * logic to decide whether all required KYC groups are now satisfied
 * (i.e. should the supplier kyc_status flip from documents_submitted /
 * under_review → approved).
 *
 * "Most recent" matters because of re-uploads: a doc that was rejected,
 * then re-uploaded and approved, should count. The CTE picks the latest
 * row per (supplier_id, document_type) before filtering on review_status.
 */
export async function getApprovedDocumentTypes(supplierId: string): Promise<string[]> {
  const result = await query<{ document_type: string }>(
    `WITH latest_per_type AS (
       SELECT DISTINCT ON (document_type)
              document_type, review_status
       FROM invoice_documents
       WHERE supplier_id = $1
       ORDER BY document_type, created_at DESC
     )
     SELECT document_type
     FROM latest_per_type
     WHERE review_status = 'approved'`,
    [supplierId],
  );
  return result.rows.map((r) => r.document_type);
}

/**
 * Set the per-document review state. Returns the updated row, or null
 * if the (docId, supplierId) tuple doesn't match (no info leak between
 * suppliers). Caller is responsible for authorising the reviewer.
 */
export async function updateDocumentReview(
  documentId: string,
  supplierId: string,
  decision: 'approved' | 'rejected',
  reviewerId: string,
  comments: string,
): Promise<DocumentRecord | null> {
  const result = await query<DocumentRecord>(
    `UPDATE invoice_documents
        SET review_status = $1,
            reviewed_by_user_id = $2,
            reviewed_at = NOW(),
            review_comments = $3
      WHERE id = $4 AND supplier_id = $5
  RETURNING *`,
    [decision, reviewerId, comments, documentId, supplierId],
  );
  return result.rows[0] ?? null;
}

/**
 * Find every active user whose role is in the supplied list. Used to
 * fan out KYC review notifications to the reviewer pool (credit_officer +
 * compliance_officer). Returns id + email only — no PII beyond what is
 * already in `users.email`.
 */
export async function findActiveUsersByRoles(
  roles: readonly string[],
): Promise<{ id: string; email: string }[]> {
  if (roles.length === 0) return [];
  const placeholders = roles.map((_, i) => `$${i + 1}`).join(', ');
  const result = await query<{ id: string; email: string }>(
    `SELECT id, email
       FROM users
      WHERE role::text IN (${placeholders})
        AND is_active = true`,
    roles as unknown as string[],
  );
  return result.rows;
}

// =========================================================================
// Buyer queries
// =========================================================================

/**
 * Create a new buyer record.
 */
export async function createBuyer(data: {
  id: string;
  companyName: string;
  registrationNumber: string;
  creditRating: string;
  approvedLimit: string;
  paymentScore: number;
  contactEmailEncrypted: string;
  contactPhoneEncrypted: string;
  risMarginRate: number;
  paymentUndertakingSigned: boolean;
  paymentUndertakingDate: string | null;
  createdBy: string;
}): Promise<void> {
  await query(
    `INSERT INTO buyers (
      id, company_name, registration_number, credit_rating,
      approved_limit, used_limit, payment_score,
      contact_email_encrypted, contact_phone_encrypted,
      ris_margin_rate, is_active,
      payment_undertaking_signed, payment_undertaking_date,
      created_by
    ) VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,true,$10,$11,$12)`,
    [
      data.id,
      data.companyName,
      data.registrationNumber,
      data.creditRating,
      data.approvedLimit,
      data.paymentScore,
      data.contactEmailEncrypted,
      data.contactPhoneEncrypted,
      data.risMarginRate,
      data.paymentUndertakingSigned,
      data.paymentUndertakingDate,
      data.createdBy,
    ],
  );
}

/**
 * Same as createBuyer but runs on a caller-provided client so it can join a
 * surrounding BEGIN/COMMIT (e.g. the buyer-request approval transaction that
 * also flips the request status and writes an audit entry — must all-or-nothing).
 */
export async function createBuyerWithClient(
  client: PoolClient,
  data: {
    id: string;
    companyName: string;
    registrationNumber: string;
    creditRating: string;
    approvedLimit: string;
    paymentScore: number;
    contactEmailEncrypted: string | null;
    contactPhoneEncrypted: string | null;
    risMarginRate: number;
    paymentUndertakingSigned: boolean;
    paymentUndertakingDate: string | null;
    createdBy: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO buyers (
      id, company_name, registration_number, credit_rating,
      approved_limit, used_limit, payment_score,
      contact_email_encrypted, contact_phone_encrypted,
      ris_margin_rate, is_active,
      payment_undertaking_signed, payment_undertaking_date,
      created_by
    ) VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,true,$10,$11,$12)`,
    [
      data.id,
      data.companyName,
      data.registrationNumber,
      data.creditRating,
      data.approvedLimit,
      data.paymentScore,
      data.contactEmailEncrypted,
      data.contactPhoneEncrypted,
      data.risMarginRate,
      data.paymentUndertakingSigned,
      data.paymentUndertakingDate,
      data.createdBy,
    ],
  );
}

/**
 * Find buyer by primary key.
 */
export async function findBuyerById(id: string): Promise<BuyerRecord | null> {
  const result = await query<BuyerRecord>(`SELECT * FROM buyers WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

/**
 * Set sanctions flag on a buyer and record check timestamp.
 */
export async function setBuyerSanctionsFlag(buyerId: string, flagged: boolean): Promise<void> {
  await query(
    `UPDATE buyers SET sanctions_flag = $1, sanctions_last_checked_at = NOW() WHERE id = $2`,
    [flagged, buyerId],
  );
}

/**
 * List buyers with pagination.
 */
export async function listBuyers(
  pagination: PaginationParams,
): Promise<{ rows: BuyerRecord[]; total: number }> {
  const offset = (pagination.page - 1) * pagination.limit;

  const countResult = await query<{ count: string }>(`SELECT COUNT(*) as count FROM buyers`, []);
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const dataResult = await query<BuyerRecord>(
    `SELECT * FROM buyers ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [pagination.limit, offset],
  );

  return { rows: dataResult.rows, total };
}

/** Column allowlist for buyer updates — prevents SQL injection via dynamic keys. */
const BUYER_UPDATABLE_COLUMNS: ReadonlySet<string> = new Set([
  'company_name',
  'credit_rating',
  'approved_limit',
  'payment_score',
  'contact_email_encrypted',
  'contact_phone_encrypted',
  'ris_margin_rate',
  'is_active',
  'payment_undertaking_signed',
  'payment_undertaking_date',
]);

/**
 * Update buyer fields. Only allowlisted columns are accepted.
 */
export async function updateBuyer(id: string, fields: Record<string, unknown>): Promise<void> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const [col, val] of Object.entries(fields)) {
    if (!BUYER_UPDATABLE_COLUMNS.has(col)) {
      continue;
    }
    setClauses.push(`${col} = $${String(idx)}`);
    params.push(val);
    idx++;
  }

  if (setClauses.length === 0) {
    return;
  }

  params.push(id);
  await query(`UPDATE buyers SET ${setClauses.join(', ')} WHERE id = $${String(idx)}`, params);
}

// =========================================================================
// User queries (for supplier registration)
// =========================================================================

/**
 * Create a new user record during supplier registration.
 */
export async function createUser(data: {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
}): Promise<void> {
  await query(
    `INSERT INTO users (id, email, password_hash, role)
     VALUES ($1, $2, $3, $4)`,
    [data.id, data.email, data.passwordHash, data.role],
  );
}

/**
 * Check if email already exists.
 */
export async function emailExists(email: string): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM users WHERE email = $1`,
    [email],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
}

/**
 * Check if a supplier registration number already exists.
 */
export async function registrationNumberExists(regNumber: string): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM suppliers
     WHERE registration_number = $1`,
    [regNumber],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
}

/**
 * Check if a buyer registration number already exists.
 */
export async function buyerRegistrationNumberExists(regNumber: string): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM buyers
     WHERE registration_number = $1`,
    [regNumber],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
}

// =========================================================================
// Audit
// =========================================================================

/**
 * Write an audit log entry for an onboarding event.
 */
export async function createAuditEntry(
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown>,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id,
        old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      action,
      tableName,
      recordId,
      oldValues !== null ? JSON.stringify(oldValues) : null,
      JSON.stringify(newValues),
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );
}

// =========================================================================
// Transaction-aware variants (WithClient)
// =========================================================================

/**
 * Create a user record within an existing transaction.
 */
export async function createUserWithClient(
  client: PoolClient,
  data: { id: string; email: string; passwordHash: string; role: string },
): Promise<void> {
  await client.query(
    `INSERT INTO users (id, email, password_hash, role)
     VALUES ($1, $2, $3, $4)`,
    [data.id, data.email, data.passwordHash, data.role],
  );
}

/**
 * Create a supplier record within an existing transaction.
 *
 * NOTE on company_name: stored in BOTH the plaintext column (display-safe)
 * AND the encrypted column (legacy + audit redundancy). Company names are
 * publicly searchable in the Uganda URSB business registry — encrypting
 * them for "PII protection" was compliance theatre that broke every list
 * view that JOINs to suppliers. The plaintext column is the canonical
 * display source going forward; the encrypted column is kept for backward
 * compatibility with older rows but is no longer the single source of truth.
 */
export async function createSupplierWithClient(
  client: PoolClient,
  data: {
    id: string;
    userId: string;
    companyName: string;
    companyNameEncrypted: string;
    registrationNumber: string;
    taxIdEncrypted: string;
    directorsEncrypted: string;
    bankName: string;
    bankAccountNumberEncrypted: string;
    bankAccountNameEncrypted: string;
    bankBranch: string;
    preferredPaymentMethod: string;
    mobileMoneyNumberEncrypted: string | null;
    eligibilitySessionToken: string;
    consentUrsbCheck: boolean;
    consentSupplierRefs: boolean;
    consentLitigationCheck: boolean;
    /** G3: optional free-text disclosure. Stored as-is (not encrypted — see migration 034). */
    litigationDisclosure?: string | null;
    requiredFinancingAmount: number | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO suppliers (
      id, user_id, company_name, company_name_encrypted,
      registration_number, tax_id_encrypted,
      directors_encrypted, bank_name,
      bank_account_number_encrypted, bank_account_name_encrypted,
      bank_branch, preferred_payment_method,
      mobile_money_number_encrypted,
      eligibility_session_token, consent_ursb_check,
      consent_supplier_refs, consent_litigation_check,
      litigation_disclosure,
      required_financing_amount
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      data.id,
      data.userId,
      data.companyName,
      data.companyNameEncrypted,
      data.registrationNumber,
      data.taxIdEncrypted,
      data.directorsEncrypted,
      data.bankName,
      data.bankAccountNumberEncrypted,
      data.bankAccountNameEncrypted,
      data.bankBranch,
      data.preferredPaymentMethod,
      data.mobileMoneyNumberEncrypted,
      data.eligibilitySessionToken,
      data.consentUrsbCheck,
      data.consentSupplierRefs,
      data.consentLitigationCheck,
      data.litigationDisclosure ?? null,
      data.requiredFinancingAmount ?? null,
    ],
  );
}

/**
 * Update KYC status within an existing transaction.
 */
export async function updateKycStatusWithClient(
  client: PoolClient,
  supplierId: string,
  status: string,
): Promise<void> {
  await client.query(`UPDATE suppliers SET kyc_status = $1 WHERE id = $2`, [status, supplierId]);
}

// =========================================================================
// Eligibility pre-qualification
// =========================================================================

/**
 * Insert a new eligibility check record.
 */
export async function createEligibilityCheck(data: {
  id: string;
  sessionToken: string;
  registeredCompany: boolean;
  authorizedPerson: boolean;
  yearsInBusiness: number;
  passed: boolean;
  ipAddress: string | null;
  email: string | null;
  fundingRequirement: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO eligibility_checks
       (id, session_token, registered_company, authorized_person,
        years_in_business, passed, ip_address, email,
        expires_at, funding_requirement)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             NOW() + INTERVAL '24 hours', $9)`,
    [
      data.id,
      data.sessionToken,
      data.registeredCompany,
      data.authorizedPerson,
      data.yearsInBusiness,
      data.passed,
      data.ipAddress,
      data.email,
      data.fundingRequirement,
    ],
  );
}

/**
 * Throttle signal collection (REQ-ELIG-006). Returns failure counts across
 * four progressive lookback windows plus the most-recent-pass timestamp.
 * Service-layer logic decides whether to block based on these signals.
 *
 * Match key: email (case-insensitive) primary, ip_address fallback. Either
 * matching is sufficient — covers shared-NAT + email-rotation abuse.
 *
 * Single query (5 aggregates) so the throttle adds at most one round-trip
 * on the hot path.
 */
export async function getEligibilityThrottleSignals(
  email: string | null,
  ipAddress: string | null,
): Promise<EligibilityThrottleSignals> {
  const { rows } = await query<{
    f5m: string;
    f1h: string;
    f24h: string;
    f30d: string;
    pass_at: Date | null;
    fail_at: Date | null;
  }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE passed = false AND created_at > NOW() - INTERVAL '5 minutes'
       )::TEXT AS f5m,
       COUNT(*) FILTER (
         WHERE passed = false AND created_at > NOW() - INTERVAL '1 hour'
       )::TEXT AS f1h,
       COUNT(*) FILTER (
         WHERE passed = false AND created_at > NOW() - INTERVAL '24 hours'
       )::TEXT AS f24h,
       COUNT(*) FILTER (
         WHERE passed = false AND created_at > NOW() - INTERVAL '30 days'
       )::TEXT AS f30d,
       MAX(created_at) FILTER (WHERE passed = true)  AS pass_at,
       MAX(created_at) FILTER (WHERE passed = false) AS fail_at
     FROM eligibility_checks
     WHERE created_at > NOW() - INTERVAL '30 days'
       AND (
         ($1::varchar IS NOT NULL AND LOWER(email) = LOWER($1))
         OR ($2::varchar IS NOT NULL AND ip_address = $2)
       )`,
    [email, ipAddress],
  );
  const row = rows[0];
  return {
    failCount5min: row ? Number(row.f5m) : 0,
    failCount1hour: row ? Number(row.f1h) : 0,
    failCount24hour: row ? Number(row.f24h) : 0,
    failCount30day: row ? Number(row.f30d) : 0,
    mostRecentPassAt: row?.pass_at ?? null,
    mostRecentFailAt: row?.fail_at ?? null,
  };
}

/**
 * Look up an eligibility check by session token.
 */
export async function findEligibilityByToken(
  token: string,
): Promise<EligibilityCheckRecord | null> {
  const result = await query<EligibilityCheckRecord>(
    `SELECT * FROM eligibility_checks
     WHERE session_token = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [token],
  );
  return result.rows[0] ?? null;
}

// =========================================================================
// Due diligence: URSB + litigation
// =========================================================================

/**
 * Mark URSB verification result on a supplier (within transaction).
 */
export async function setUrsbVerifiedWithClient(
  client: PoolClient,
  supplierId: string,
  verified: boolean,
  verifiedBy: string,
): Promise<void> {
  await client.query(
    `UPDATE suppliers
     SET ursb_verified = $1, ursb_verified_at = NOW(), ursb_verified_by = $2
     WHERE id = $3`,
    [verified, verifiedBy, supplierId],
  );
}

/**
 * Mark litigation check result on a supplier (within transaction).
 */
export async function setLitigationCheckWithClient(
  client: PoolClient,
  supplierId: string,
  flag: boolean,
  checkedBy: string,
): Promise<void> {
  await client.query(
    `UPDATE suppliers
     SET litigation_checked = TRUE,
         litigation_checked_at = NOW(),
         litigation_checked_by = $1,
         litigation_flag = $2
     WHERE id = $3`,
    [checkedBy, flag, supplierId],
  );
}

/**
 * Write an audit log entry within an existing transaction.
 */
export async function createAuditEntryWithClient(
  client: PoolClient,
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown>,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id,
        old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      action,
      tableName,
      recordId,
      oldValues !== null ? JSON.stringify(oldValues) : null,
      JSON.stringify(newValues),
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );
}

// =========================================================================
// KYC maker-checker
// =========================================================================

/**
 * Set the KYC reviewer (first compliance officer to review) within a transaction.
 */
export async function setKycReviewerWithClient(
  client: PoolClient,
  supplierId: string,
  reviewerId: string,
): Promise<void> {
  await client.query(`UPDATE suppliers SET kyc_reviewer_id = $1 WHERE id = $2`, [
    reviewerId,
    supplierId,
  ]);
}

/**
 * Set the KYC approver within a transaction.
 */
export async function setKycApproverWithClient(
  client: PoolClient,
  supplierId: string,
  approverId: string,
): Promise<void> {
  await client.query(`UPDATE suppliers SET kyc_approver_id = $1 WHERE id = $2`, [
    approverId,
    supplierId,
  ]);
}

/**
 * Get the KYC reviewer ID for a supplier.
 */
export async function getKycReviewer(supplierId: string): Promise<string | null> {
  const result = await query<{ kyc_reviewer_id: string | null }>(
    `SELECT kyc_reviewer_id FROM suppliers WHERE id = $1`,
    [supplierId],
  );
  return result.rows[0]?.kyc_reviewer_id ?? null;
}

// =========================================================================
// Buyer onboarding requests
// =========================================================================

export async function createBuyerOnboardingRequest(data: {
  id: string;
  supplierId: string;
  companyName: string;
  registrationNumber: string | null;
  contactNameEncrypted: string | null;
  contactEmailEncrypted: string | null;
  contactPhoneEncrypted: string | null;
  reason: string;
}): Promise<void> {
  await query(
    `INSERT INTO buyer_onboarding_requests (
      id, supplier_id, company_name, registration_number,
      contact_name_encrypted, contact_email_encrypted, contact_phone_encrypted,
      reason
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      data.id,
      data.supplierId,
      data.companyName,
      data.registrationNumber,
      data.contactNameEncrypted,
      data.contactEmailEncrypted,
      data.contactPhoneEncrypted,
      data.reason,
    ],
  );
}

export async function createBuyerOnboardingRequestWithClient(
  client: PoolClient,
  data: {
    id: string;
    supplierId: string;
    companyName: string;
    registrationNumber: string | null;
    contactNameEncrypted: string | null;
    contactEmailEncrypted: string | null;
    contactPhoneEncrypted: string | null;
    reason: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO buyer_onboarding_requests (
      id, supplier_id, company_name, registration_number,
      contact_name_encrypted, contact_email_encrypted, contact_phone_encrypted,
      reason
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      data.id,
      data.supplierId,
      data.companyName,
      data.registrationNumber,
      data.contactNameEncrypted,
      data.contactEmailEncrypted,
      data.contactPhoneEncrypted,
      data.reason,
    ],
  );
}

export async function listBuyerOnboardingRequests(params: {
  page: number;
  limit: number;
  status?: string;
}): Promise<{ rows: BuyerOnboardingRequestRecord[]; total: number }> {
  const conditions = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;

  if (params.status) {
    conditions.push(`status = $${idx++}`);
    values.push(params.status);
  }

  const where = conditions.join(' AND ');
  const offset = (params.page - 1) * params.limit;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM buyer_onboarding_requests WHERE ${where}`,
    values,
  );

  const dataResult = await query<BuyerOnboardingRequestRecord>(
    `SELECT * FROM buyer_onboarding_requests WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    [...values, params.limit, offset],
  );

  return { rows: dataResult.rows, total: parseInt(countResult.rows[0].count, 10) };
}

export async function listBuyerOnboardingRequestsBySupplier(
  supplierId: string,
  params: { page: number; limit: number },
): Promise<{ rows: BuyerOnboardingRequestRecord[]; total: number }> {
  const offset = (params.page - 1) * params.limit;

  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM buyer_onboarding_requests WHERE supplier_id = $1',
    [supplierId],
  );

  const dataResult = await query<BuyerOnboardingRequestRecord>(
    'SELECT * FROM buyer_onboarding_requests WHERE supplier_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [supplierId, params.limit, offset],
  );

  return { rows: dataResult.rows, total: parseInt(countResult.rows[0].count, 10) };
}

export async function getBuyerOnboardingRequestById(
  id: string,
): Promise<BuyerOnboardingRequestRecord | null> {
  const { rows } = await query<BuyerOnboardingRequestRecord>(
    'SELECT * FROM buyer_onboarding_requests WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function getBuyerOnboardingRequestByIdForSupplier(
  id: string,
  supplierId: string,
): Promise<BuyerOnboardingRequestRecord | null> {
  const { rows } = await query<BuyerOnboardingRequestRecord>(
    'SELECT * FROM buyer_onboarding_requests WHERE id = $1 AND supplier_id = $2',
    [id, supplierId],
  );
  return rows[0] ?? null;
}

export async function updateBuyerRequestStatusWithClient(
  client: PoolClient,
  id: string,
  status: string,
  reviewedBy: string,
  reviewerComments: string | null,
  linkedBuyerId: string | null,
): Promise<void> {
  await client.query(
    `UPDATE buyer_onboarding_requests
     SET status = $1, reviewed_by = $2, reviewer_comments = $3, linked_buyer_id = $4, updated_at = NOW()
     WHERE id = $5`,
    [status, reviewedBy, reviewerComments, linkedBuyerId, id],
  );
}

// =========================================================================
// Beneficial Ownership (UBO) queries
// =========================================================================

/**
 * Insert a beneficial owner record within a transaction.
 */
export async function createUboWithClient(
  client: PoolClient,
  supplierId: string,
  id: string,
  data: {
    fullNameEncrypted: string;
    nationality: string;
    idType: string;
    idNumberEncrypted: string;
    ownershipPercentage: number;
    isPep: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO beneficial_owners
       (id, supplier_id, full_name_encrypted, nationality,
        id_type, id_number_encrypted, ownership_percentage, is_pep)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      supplierId,
      data.fullNameEncrypted,
      data.nationality,
      data.idType,
      data.idNumberEncrypted,
      data.ownershipPercentage,
      data.isPep,
    ],
  );
}

/**
 * Fetch all beneficial owners for a supplier.
 */
export async function getUbosBySupplier(supplierId: string): Promise<BeneficialOwnerRecord[]> {
  const result = await query<BeneficialOwnerRecord>(
    `SELECT * FROM beneficial_owners WHERE supplier_id = $1 ORDER BY created_at ASC`,
    [supplierId],
  );
  return result.rows;
}

/**
 * Update a beneficial owner within a transaction (ownership check via supplier_id).
 */
export async function updateUboWithClient(
  client: PoolClient,
  uboId: string,
  supplierId: string,
  data: {
    fullNameEncrypted: string;
    nationality: string;
    idType: string;
    idNumberEncrypted: string;
    ownershipPercentage: number;
    isPep: boolean;
  },
): Promise<number> {
  const result = await client.query(
    `UPDATE beneficial_owners
     SET full_name_encrypted = $1, nationality = $2,
         id_type = $3, id_number_encrypted = $4,
         ownership_percentage = $5, is_pep = $6,
         updated_at = NOW()
     WHERE id = $7 AND supplier_id = $8`,
    [
      data.fullNameEncrypted,
      data.nationality,
      data.idType,
      data.idNumberEncrypted,
      data.ownershipPercentage,
      data.isPep,
      uboId,
      supplierId,
    ],
  );
  return result.rowCount ?? 0;
}

/**
 * Delete a beneficial owner within a transaction (ownership check via supplier_id).
 */
export async function deleteUboWithClient(
  client: PoolClient,
  uboId: string,
  supplierId: string,
): Promise<number> {
  const result = await client.query(
    `DELETE FROM beneficial_owners WHERE id = $1 AND supplier_id = $2`,
    [uboId, supplierId],
  );
  return result.rowCount ?? 0;
}

// =========================================================================
// KYC Renewal queries
// =========================================================================

/**
 * Find suppliers with expired KYC renewal dates.
 */
export async function getSuppliersWithExpiredKyc(): Promise<SupplierRecord[]> {
  const result = await query<SupplierRecord>(
    `SELECT * FROM suppliers
     WHERE kyc_renewal_due_at < NOW()
       AND kyc_status = $1`,
    ['approved'],
  );
  return result.rows;
}

/**
 * Update KYC renewal due date for a supplier.
 */
export async function updateKycRenewalDate(supplierId: string, date: string): Promise<void> {
  await query(`UPDATE suppliers SET kyc_renewal_due_at = $1 WHERE id = $2`, [date, supplierId]);
}

// =========================================================================
// PEP designation
// =========================================================================

/**
 * Set PEP designation on a supplier.
 */
export async function setPepDesignation(supplierId: string, isPep: boolean): Promise<void> {
  await query(
    `UPDATE suppliers
     SET pep_designation = $1, pep_checked_at = NOW()
     WHERE id = $2`,
    [isPep, supplierId],
  );
}

/**
 * Set PEP designation on a buyer.
 */
export async function setBuyerPepDesignation(buyerId: string, isPep: boolean): Promise<void> {
  await query(
    `UPDATE buyers
     SET pep_designation = $1, pep_checked_at = NOW()
     WHERE id = $2`,
    [isPep, buyerId],
  );
}
