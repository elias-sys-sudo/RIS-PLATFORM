import { v4 as uuidv4 } from 'uuid';
import { Queue } from 'bullmq';
import type { PoolClient } from 'pg';
import { BusinessRuleError, ForbiddenError, NotFoundError, RisError } from '../../shared/errors';
import { beginWithRls } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { enqueueWithContext } from '../../shared/workers/queue-helpers';
import * as repo from './invoices.repository';
import { InvoiceStatus, ValidationErrorCode } from './invoices.types';
import type {
  InvoiceSubmission,
  InvoiceDetail,
  InvoiceRecord,
  InvoiceFilters,
  InvoiceBankDetailsInput,
  PaginationParams,
  PaginatedResult,
  ValidationResult,
  AuditTimelineEntry,
  BuyerLimits,
  EnrichedInvoiceListItem,
  EnrichedInvoiceListRow,
  EnrichedInvoiceDetailRow,
  ApprovalHistoryRow,
  InvoiceDocumentRow,
  InvoiceCollateralRow,
  InvoiceDetailResponse,
  StatusTransition,
  ApprovalDecision,
  RiskBreakdown,
  InvoiceDocumentRef,
  InvoiceCollateralRef,
  BuyerInfoResponse,
  SupplierInfoResponse,
} from './invoices.types';
import { encrypt, decrypt, hashDocument } from '../../shared/crypto';
import { addWorkingDays } from '../../shared/working-days';
import * as onboardingRepo from '../onboarding/onboarding.repository';
import fs from 'fs';
import path from 'path';

// Same upload directory KYC uploads use — shared encrypted blob store on
// disk. Layout: <UPLOAD_DIR>/<documentId>.enc. The documents service's
// download endpoint reads from this same path; keeping the directory
// constant in lockstep across both writers prevents path mismatches.
const INVOICE_DOC_UPLOAD_DIR = path.resolve('uploads', 'documents');

// Per the invoice-create flow's document_type select. Authoritative list
// here (not in Joi alone) so the service rejects unknown types even if a
// new route bypasses Joi.
const ALLOWED_INVOICE_DOC_TYPES = new Set([
  'tax_invoice',
  'proforma_invoice',
  'purchase_order',
  'delivery_note',
  'contract',
]);

const ADMIN_INVOICE_DOC_UPLOAD_ROLES = new Set([
  'credit_officer',
  'compliance_officer',
  'management',
]);

const MAX_INVOICE_DOC_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_INVOICE_DOC_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

/** G7 — assessment SLA window in working days (submission → buyer confirmation). */
const ASSESSMENT_SLA_WORKING_DAYS = 7;

const MIN_TENOR_DAYS = parseInt(process.env.MIN_INVOICE_TENOR_DAYS ?? '7', 10);
const MAX_TENOR_DAYS = parseInt(process.env.MAX_INVOICE_TENOR_DAYS ?? '90', 10);
const AML_THRESHOLD_UGX = BigInt(process.env.AML_FLAG_THRESHOLD_UGX ?? '100000000');
const AML_STRUCTURING_THRESHOLD = BigInt(process.env.AML_FLAG_THRESHOLD_UGX ?? '100000000');

let notificationQueue: Queue | null = null;

/** Compute tenor in days from today to dueDate (ceiling). */
function computeTenorDays(dueDate: string): number {
  const diffMs = new Date(dueDate).getTime() - new Date().getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Set the Bull queue instance for notifications.
 */
export function setNotificationQueue(queue: Queue): void {
  notificationQueue = queue;
}

// =========================================================================
// AML/CFT — Structuring Detection + Velocity Monitoring
// =========================================================================

/** Audit-log a compliance event, then throw. */
async function auditAndThrowCompliance(
  action: string,
  message: string,
  userId: string,
  supplierId: string,
  details: Record<string, unknown>,
  ip: string,
  ua: string,
): Promise<never> {
  await repo.createAuditEntry(userId, action, 'invoices', supplierId, null, details, ip, ua);
  logger.audit(action, { component: 'invoices', supplierId });
  throw new BusinessRuleError(action, message);
}

/**
 * Detect invoice structuring: individual invoices below threshold
 * but combined 30-day total exceeds threshold for the same pair.
 */
async function checkStructuring(
  supplierId: string,
  buyerId: string,
  faceValue: string,
  userId: string,
  ip: string,
  ua: string,
): Promise<void> {
  const { total, count } = await repo.get30DayRollingTotal(supplierId, buyerId);
  const combinedTotal = BigInt(total) + BigInt(faceValue);
  const invoiceValue = BigInt(faceValue);
  if (combinedTotal >= AML_STRUCTURING_THRESHOLD && invoiceValue < AML_STRUCTURING_THRESHOLD) {
    await auditAndThrowCompliance(
      'STRUCTURING_RISK_DETECTED',
      'Potential invoice structuring detected — compliance review required',
      userId,
      supplierId,
      {
        buyerId,
        combinedTotal: combinedTotal.toString(),
        invoiceCount: count + 1,
        threshold: AML_STRUCTURING_THRESHOLD.toString(),
      },
      ip,
      ua,
    );
  }
}

/**
 * Detect velocity spikes: current month count >= 3x the 6-month average.
 */
async function checkVelocitySpike(
  supplierId: string,
  userId: string,
  ip: string,
  ua: string,
): Promise<void> {
  const sixMonth = await repo.get6MonthVelocityAverage(supplierId);
  if (sixMonth.total_count < 6) return;
  const avgMonthly = Math.ceil(sixMonth.total_count / 6);
  const currentMonth = await repo.getCurrentMonthCount(supplierId);
  if (currentMonth.count >= avgMonthly * 3) {
    await auditAndThrowCompliance(
      'VELOCITY_SPIKE_DETECTED',
      'Unusual invoice volume — compliance review required',
      userId,
      supplierId,
      { currentMonthCount: currentMonth.count, avgMonthly, multiplier: 3 },
      ip,
      ua,
    );
  }
}

// =========================================================================
// Invoice Submission
// =========================================================================

// ---------------------------------------------------------------------------
// submitInvoice — validation step helpers
// ---------------------------------------------------------------------------

/** Step 1: Supplier must exist and have approved KYC. */
async function validateSupplierActive(
  userId: string,
  results: ValidationResult[],
  ip: string,
  ua: string,
): Promise<{ id: string; kyc_status: string }> {
  const supplier = await repo.findSupplierByUserId(userId);
  const passed = supplier !== null && supplier.kyc_status === 'approved';
  results.push({
    step: 'supplier_active_check',
    passed,
    errorCode: passed ? undefined : ValidationErrorCode.SUPPLIER_NOT_APPROVED,
  });
  if (!passed) {
    await logValidationResults(userId, 'new', results, ip, ua);
    throw new BusinessRuleError(
      ValidationErrorCode.SUPPLIER_NOT_APPROVED,
      'Supplier KYC status must be approved to submit invoices',
    );
  }
  return supplier;
}

/** Step 2: No duplicate invoice_number for this supplier. */
async function validateNoDuplicate(
  invoiceNumber: string,
  supplierId: string,
  userId: string,
  results: ValidationResult[],
  ip: string,
  ua: string,
): Promise<void> {
  const existing = await repo.findInvoiceByNumberAndSupplier(invoiceNumber, supplierId);
  const passed = existing === null;
  results.push({
    step: 'duplicate_check',
    passed,
    errorCode: passed ? undefined : ValidationErrorCode.DUPLICATE_INVOICE,
  });
  if (!passed) {
    await logValidationResults(userId, 'new', results, ip, ua);
    throw new BusinessRuleError(
      ValidationErrorCode.DUPLICATE_INVOICE,
      'An invoice with this number already exists for this supplier',
    );
  }
}

/** Step 3: Buyer must exist and be active. */
async function validateBuyerEligibility(
  buyerId: string,
  userId: string,
  results: ValidationResult[],
  ip: string,
  ua: string,
): Promise<BuyerLimits> {
  const buyer = await repo.findBuyerWithLimits(buyerId);
  const passed = buyer !== null && buyer.is_active;
  results.push({
    step: 'buyer_eligibility',
    passed,
    errorCode: passed ? undefined : ValidationErrorCode.BUYER_NOT_APPROVED,
  });
  if (!passed) {
    await logValidationResults(userId, 'new', results, ip, ua);
    throw new BusinessRuleError(
      ValidationErrorCode.BUYER_NOT_APPROVED,
      'Buyer does not exist or is not active',
    );
  }
  return buyer;
}

/** Step 4: Tenor must be within allowed range. */
function validateTenor(dueDate: string, results: ValidationResult[]): number {
  const tenorDays = computeTenorDays(dueDate);
  const passed = tenorDays >= MIN_TENOR_DAYS && tenorDays <= MAX_TENOR_DAYS;
  results.push({
    step: 'tenor_check',
    passed,
    errorCode: passed ? undefined : ValidationErrorCode.TENOR_OUT_OF_RANGE,
    details: { actual_days: tenorDays, min_days: MIN_TENOR_DAYS, max_days: MAX_TENOR_DAYS },
  });
  if (!passed) {
    throw new BusinessRuleError(
      ValidationErrorCode.TENOR_OUT_OF_RANGE,
      `Invoice tenor of ${String(tenorDays)} days is outside the allowed range (${String(MIN_TENOR_DAYS)}-${String(MAX_TENOR_DAYS)} days)`,
      { actual_days: tenorDays, min_days: MIN_TENOR_DAYS, max_days: MAX_TENOR_DAYS },
    );
  }
  return tenorDays;
}

/** Step 5: Face value must not exceed remaining buyer credit. */
function validateCreditLimit(
  faceValue: bigint,
  buyer: BuyerLimits,
  results: ValidationResult[],
): void {
  const usedLimit = BigInt(buyer.used_limit);
  const approvedLimit = BigInt(buyer.approved_limit);
  const totalExposure = faceValue + usedLimit;
  const passed = totalExposure <= approvedLimit;
  const remaining = approvedLimit - usedLimit;
  results.push({
    step: 'credit_limit_check',
    passed,
    errorCode: passed ? undefined : ValidationErrorCode.CREDIT_LIMIT_EXCEEDED,
    details: {
      requested: faceValue.toString(),
      used: buyer.used_limit,
      limit: buyer.approved_limit,
      remaining: remaining.toString(),
    },
  });
  if (!passed) {
    throw new BusinessRuleError(
      ValidationErrorCode.CREDIT_LIMIT_EXCEEDED,
      'Invoice face value exceeds available buyer credit limit',
      {
        requested: faceValue.toString(),
        used: buyer.used_limit,
        limit: buyer.approved_limit,
        remaining: remaining.toString(),
      },
    );
  }
}

// ---------------------------------------------------------------------------
// submitInvoice — transaction + post-commit helpers
// ---------------------------------------------------------------------------

interface SubmitTxParams {
  invoiceId: string;
  userId: string;
  data: InvoiceSubmission;
  supplierId: string;
  faceValue: bigint;
  tenorDays: number;
  validationResults: ValidationResult[];
  ipAddress: string;
  userAgent: string;
  /** Pre-computed ISO string for the 7-working-day assessment deadline (G7). */
  assessmentDueAt?: string | null;
}

/** Persist invoice, audit validation results, set AML flag — all in one tx. */
async function executeSubmitTransaction(p: SubmitTxParams): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.createInvoiceWithClient(client, {
      id: p.invoiceId,
      invoiceNumber: p.data.invoice_number,
      supplierId: p.supplierId,
      buyerId: p.data.buyer_id,
      faceValue: p.faceValue.toString(),
      dueDate: p.data.due_date,
      description: p.data.description,
      tenorDays: p.tenorDays,
      uraEfrisRef: p.data.ura_efris_ref,
      fundingTimelineDays: p.data.funding_timeline_days ?? null,
      assessmentDueAt: p.assessmentDueAt ?? null,
    });
    await auditValidationResultsWithClient(
      client,
      p.userId,
      p.invoiceId,
      p.validationResults,
      p.ipAddress,
      p.userAgent,
    );
    await auditInvoiceSubmittedWithClient(client, p);
    await applyAmlFlagWithClient(client, p);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Write each validation step to audit_logs inside the transaction. */
async function auditValidationResultsWithClient(
  client: PoolClient,
  userId: string,
  invoiceId: string,
  results: ValidationResult[],
  ip: string,
  ua: string,
): Promise<void> {
  for (const result of results) {
    await repo.createAuditEntryWithClient(
      client,
      userId,
      `VALIDATION_${result.step.toUpperCase()}`,
      'invoices',
      invoiceId,
      null,
      {
        passed: result.passed,
        errorCode: result.errorCode ?? null,
        details: result.details ?? null,
      },
      ip,
      ua,
    );
  }
}

/** Audit the INVOICE_SUBMITTED event inside the transaction. */
async function auditInvoiceSubmittedWithClient(
  client: PoolClient,
  p: SubmitTxParams,
): Promise<void> {
  await repo.createAuditEntryWithClient(
    client,
    p.userId,
    'INVOICE_SUBMITTED',
    'invoices',
    p.invoiceId,
    null,
    {
      invoiceNumber: p.data.invoice_number,
      supplierId: p.supplierId,
      buyerId: p.data.buyer_id,
      faceValue: p.faceValue.toString(),
      status: InvoiceStatus.SUBMITTED,
    },
    p.ipAddress,
    p.userAgent,
  );
}

/** Set AML flag + audit if face value exceeds threshold (inside tx). */
async function applyAmlFlagWithClient(client: PoolClient, p: SubmitTxParams): Promise<void> {
  if (p.faceValue <= AML_THRESHOLD_UGX) return;
  await repo.setAmlFlagWithClient(client, p.invoiceId, true);
  await repo.createAuditEntryWithClient(
    client,
    p.userId,
    'AML_FLAG',
    'invoices',
    p.invoiceId,
    null,
    {
      faceValue: p.faceValue.toString(),
      thresholdUgx: AML_THRESHOLD_UGX.toString(),
      reason: 'Invoice face value exceeds AML threshold',
    },
    p.ipAddress,
    p.userAgent,
  );
}

/** Queue AML compliance notification after commit (outside transaction). */
async function notifyAmlCompliance(invoiceId: string, faceValue: bigint): Promise<void> {
  if (faceValue <= AML_THRESHOLD_UGX) return;
  logger.audit('AML_FLAG', { component: 'invoices', invoiceId });
  if (notificationQueue === null) return;
  await enqueueWithContext(
    notificationQueue,
    'notify-compliance-aml',
    { invoiceId, faceValue: faceValue.toString() },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  );
}

// ---------------------------------------------------------------------------
// submitInvoice — public orchestrator
// ---------------------------------------------------------------------------

/**
 * Submit an invoice through the 5-step validation chain.
 * Every validation step is individually logged to audit_logs.
 */
export async function submitInvoice(
  userId: string,
  data: InvoiceSubmission,
  ipAddress: string,
  userAgent: string,
): Promise<{ invoiceId: string }> {
  const faceValue = BigInt(data.face_value);
  const results: ValidationResult[] = [];

  const supplier = await validateSupplierActive(userId, results, ipAddress, userAgent);
  await validateNoDuplicate(
    data.invoice_number,
    supplier.id,
    userId,
    results,
    ipAddress,
    userAgent,
  );
  const buyer = await validateBuyerEligibility(
    data.buyer_id,
    userId,
    results,
    ipAddress,
    userAgent,
  );
  const tenorDays = validateTenor(data.due_date, results);
  validateCreditLimit(faceValue, buyer, results);

  await checkStructuring(
    supplier.id,
    data.buyer_id,
    faceValue.toString(),
    userId,
    ipAddress,
    userAgent,
  );
  await checkVelocitySpike(supplier.id, userId, ipAddress, userAgent);

  const invoiceId = uuidv4();
  // G7 — deadline = submittedAt + 7 working days (Mon-Fri, skipping Uganda holidays).
  const assessmentDueAt = addWorkingDays(new Date(), ASSESSMENT_SLA_WORKING_DAYS).toISOString();
  await executeSubmitTransaction({
    invoiceId,
    userId,
    data,
    supplierId: supplier.id,
    faceValue,
    tenorDays,
    validationResults: results,
    ipAddress,
    userAgent,
    assessmentDueAt,
  });

  logger.audit('INVOICE_SUBMITTED', { component: 'invoices', invoiceId, supplierId: supplier.id });
  await notifyAmlCompliance(invoiceId, faceValue);
  await queueBuyerConfirmation(invoiceId, data.buyer_id);
  await scheduleAssessmentReminders(invoiceId, supplier.id);
  await scheduleFundingTimelineReminder(invoiceId, supplier.id, data.funding_timeline_days);
  return { invoiceId };
}

// =========================================================================
// Draft Invoice CRUD
// =========================================================================

/**
 * Save a new draft invoice (no full validation chain — just store).
 */
export async function saveDraft(
  userId: string,
  data: InvoiceSubmission,
  ipAddress: string,
  userAgent: string,
): Promise<{ invoiceId: string }> {
  const supplier = await repo.findSupplierByUserId(userId);
  if (supplier === null) {
    throw new NotFoundError('Supplier', userId);
  }
  const invoiceId = uuidv4();
  const tenorDays = computeTenorDays(data.due_date);
  await repo.createDraftInvoice({
    id: invoiceId,
    invoiceNumber: data.invoice_number,
    supplierId: supplier.id,
    buyerId: data.buyer_id,
    faceValue: String(data.face_value),
    dueDate: data.due_date,
    description: data.description,
    tenorDays,
  });
  await repo.createAuditEntry(
    userId,
    'INVOICE_DRAFT_SAVED',
    'invoices',
    invoiceId,
    null,
    { invoiceNumber: data.invoice_number, supplierId: supplier.id, status: InvoiceStatus.DRAFT },
    ipAddress,
    userAgent,
  );
  return { invoiceId };
}

/** Verify that the invoice exists, is a draft, and belongs to the calling supplier. */
async function guardDraftOwnership(
  invoiceId: string,
  userId: string,
  draftMessage: string,
): Promise<{ invoice: InvoiceRecord; supplierId: string }> {
  const invoice = await repo.findInvoiceById(invoiceId);
  if (invoice === null) throw new NotFoundError('Invoice', invoiceId);
  if (invoice.status !== InvoiceStatus.DRAFT) {
    throw new BusinessRuleError('NOT_DRAFT', draftMessage);
  }
  const supplier = await repo.findSupplierByUserId(userId);
  if (supplier === null || supplier.id !== invoice.supplier_id) throw new ForbiddenError();
  return { invoice, supplierId: supplier.id };
}

/**
 * Update editable fields on an owned draft invoice.
 */
export async function updateDraft(
  invoiceId: string,
  userId: string,
  data: Partial<InvoiceSubmission>,
  ipAddress: string,
  userAgent: string,
): Promise<InvoiceDetail> {
  const { supplierId } = await guardDraftOwnership(
    invoiceId,
    userId,
    'Only draft invoices can be updated',
  );
  const tenorDays = data.due_date !== undefined ? computeTenorDays(data.due_date) : undefined;
  const updated = await repo.updateDraftFields(invoiceId, supplierId, {
    description: data.description,
    faceValue: data.face_value !== undefined ? String(data.face_value) : undefined,
    dueDate: data.due_date,
    tenorDays,
  });
  if (updated === null) throw new NotFoundError('Draft Invoice', invoiceId);
  await repo.createAuditEntry(
    userId,
    'INVOICE_DRAFT_UPDATED',
    'invoices',
    invoiceId,
    null,
    { fields: Object.keys(data) },
    ipAddress,
    userAgent,
  );
  return toInvoiceDetail(updated);
}

/**
 * Run buyer/tenor/credit validations (used by submitDraft).
 */
async function validateForSubmit(
  buyerId: string,
  faceValue: bigint,
  dueDate: string,
): Promise<void> {
  const buyer = await repo.findBuyerWithLimits(buyerId);
  if (buyer === null || !buyer.is_active) {
    throw new BusinessRuleError(ValidationErrorCode.BUYER_NOT_APPROVED, 'Buyer not active');
  }
  const tenorDays = computeTenorDays(dueDate);
  if (tenorDays < MIN_TENOR_DAYS || tenorDays > MAX_TENOR_DAYS) {
    throw new BusinessRuleError(
      ValidationErrorCode.TENOR_OUT_OF_RANGE,
      `Tenor ${String(tenorDays)} days out of allowed range (${String(MIN_TENOR_DAYS)}-${String(MAX_TENOR_DAYS)})`,
    );
  }
  const totalExposure = faceValue + BigInt(buyer.used_limit);
  if (totalExposure > BigInt(buyer.approved_limit)) {
    throw new BusinessRuleError(ValidationErrorCode.CREDIT_LIMIT_EXCEEDED, 'Credit limit exceeded');
  }
}

/** Validate KYC on the supplier for draft-to-submit promotion. */
async function guardSubmitDraftKyc(userId: string): Promise<{ id: string; kyc_status: string }> {
  const supplier = await repo.findSupplierByUserId(userId);
  if (supplier === null) throw new ForbiddenError();
  if (supplier.kyc_status !== 'approved') {
    throw new BusinessRuleError(
      ValidationErrorCode.SUPPLIER_NOT_APPROVED,
      'Supplier KYC must be approved',
    );
  }
  return supplier;
}

/** Promote draft to submitted inside a transaction. */
async function executePromoteTransaction(
  invoiceId: string,
  userId: string,
  faceValue: bigint,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.promoteToSubmitted(client, invoiceId);
    await repo.createAuditEntryWithClient(
      client,
      userId,
      'INVOICE_SUBMITTED',
      'invoices',
      invoiceId,
      { status: InvoiceStatus.DRAFT },
      { status: InvoiceStatus.SUBMITTED },
      ipAddress,
      userAgent,
    );
    if (faceValue > AML_THRESHOLD_UGX) {
      await repo.setAmlFlagWithClient(client, invoiceId, true);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Promote a draft invoice to submitted after running validation checks.
 */
export async function submitDraft(
  invoiceId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<InvoiceDetail> {
  const { invoice } = await guardDraftOwnership(
    invoiceId,
    userId,
    'Only draft invoices can be submitted this way',
  );
  const supplier = await guardSubmitDraftKyc(userId);
  const faceValue = BigInt(invoice.face_value);
  await validateForSubmit(invoice.buyer_id, faceValue, invoice.due_date);
  await executePromoteTransaction(invoiceId, userId, faceValue, ipAddress, userAgent);
  logger.audit('INVOICE_SUBMITTED', { component: 'invoices', invoiceId, supplierId: supplier.id });
  const updated = await repo.findInvoiceById(invoiceId);
  return toInvoiceDetail(updated!);
}

// =========================================================================
// Invoice Retrieval
// =========================================================================

/**
 * Get enriched invoice detail with ownership check.
 * Returns the full nested response (suppliers, buyers, risk breakdown,
 * approval history, documents, collateral, status timeline) matching the
 * frontend InvoiceDetail interface.
 */
export async function getInvoiceDetail(
  invoiceId: string,
  userId: string,
  role: string,
): Promise<InvoiceDetailResponse> {
  const row = await repo.getEnrichedInvoiceDetail(invoiceId);
  if (row === null) throw new NotFoundError('Invoice', invoiceId);
  await enforceOwnershipBySupplierId(row.supplier_id, userId, role);
  const [approvals, documents, collateral, timeline] = await Promise.all([
    repo.getInvoiceApprovalHistory(invoiceId),
    repo.getInvoiceDocumentRefs(invoiceId),
    repo.getInvoiceCollateralRefs(invoiceId),
    repo.getInvoiceTimeline(invoiceId),
  ]);
  return assembleInvoiceDetail(row, approvals, documents, collateral, timeline);
}

/** Compose the final response object from raw row data (≤25 lines). */
function assembleInvoiceDetail(
  row: EnrichedInvoiceDetailRow,
  approvals: ApprovalHistoryRow[],
  documents: InvoiceDocumentRow[],
  collateral: InvoiceCollateralRow[],
  timeline: AuditTimelineEntry[],
): InvoiceDetailResponse {
  return {
    ...toEnrichedListItem(row),
    supplier_info: buildSupplierInfo(row),
    buyer_info: buildBuyerInfo(row),
    status_timeline: mapStatusTimeline(timeline),
    approval_history: approvals.map(mapApprovalDecision),
    risk_breakdown: buildRiskBreakdown(row),
    documents: documents.map(mapDocumentRef),
    collateral: collateral.map(mapCollateralRef),
    approved_at: row.approved_at,
    dual_auth_user_1_id: row.dual_auth_user_1_id,
    dual_auth_user_1_name: row.dual_auth_user_1_name,
    dual_auth_user_1_at: row.dual_auth_user_1_at,
    dual_auth_user_2_id: row.dual_auth_user_2_id,
    dual_auth_user_2_name: row.dual_auth_user_2_name,
    dual_auth_user_2_at: row.dual_auth_user_2_at,
    pricing_accepted_at: row.pricing_accepted_at,
  };
}

/** Map a single enriched DB row to the wire-shape list item. */
function toEnrichedListItem(row: EnrichedInvoiceListRow): EnrichedInvoiceListItem {
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name ?? '',
    buyer_id: row.buyer_id,
    buyer_name: row.buyer_name ?? '',
    face_value: parseInt(row.face_value, 10),
    advance_amount: row.advance_amount !== null ? parseInt(row.advance_amount, 10) : null,
    discount_amount: row.discount_amount !== null ? parseInt(row.discount_amount, 10) : null,
    net_payment_to_supplier:
      row.net_payment_to_supplier !== null ? parseInt(row.net_payment_to_supplier, 10) : null,
    advance_percentage: row.advance_percentage !== null ? Number(row.advance_percentage) * 100 : 0,
    discount_rate: row.discount_rate !== null ? Number(row.discount_rate) * 100 : 0,
    tenor: row.tenor_days ?? 0,
    status: row.status,
    risk_score: row.risk_score,
    risk_level: mapRiskLevel(row.risk_recommendation, row.risk_score),
    issue_date: row.created_at,
    due_date: row.due_date,
    funded_at: row.funded_at,
    collected_at: row.collected_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    bank_details_captured_at: row.bank_details_captured_at,
  };
}

/** Derive RiskLevel from numeric score; recommendation column is informational. */
function mapRiskLevel(
  _recommendation: string | null,
  score: number | null,
): 'low' | 'medium' | 'high' | 'critical' | null {
  if (score === null) return null;
  if (score >= 75) return 'low';
  if (score >= 50) return 'medium';
  if (score >= 25) return 'high';
  return 'critical';
}

/** Build SupplierInfoResponse — decrypts supplier phone PII at service layer (Rule 6). */
function buildSupplierInfo(row: EnrichedInvoiceDetailRow): SupplierInfoResponse {
  return {
    id: row.supplier_id,
    name: row.supplier_name ?? '',
    industry: '',
    registration_number: row.registration_number ?? '',
    contact_email: row.supplier_email ?? '',
    contact_phone: safeDecrypt(row.supplier_phone_enc),
  };
}

/** Build BuyerInfoResponse — decrypts contact PII at service layer (Rule 6). */
function buildBuyerInfo(row: EnrichedInvoiceDetailRow): BuyerInfoResponse {
  return {
    id: row.buyer_id,
    name: row.buyer_name ?? '',
    industry: '',
    credit_limit: row.buyer_credit_limit !== null ? parseInt(row.buyer_credit_limit, 10) : 0,
    payment_terms_days: 0,
    contact_email: safeDecrypt(row.buyer_email_enc),
    contact_phone: safeDecrypt(row.buyer_phone_enc),
  };
}

/** Decrypt an encrypted value, returning '' on null/error to keep the response stable. */
function safeDecrypt(value: string | null): string {
  if (value === null || value === '') return '';
  try {
    return decrypt(value);
  } catch {
    return '';
  }
}

/** Map an audit_logs row to a status timeline entry (status changes only). */
function mapStatusTimeline(rows: AuditTimelineEntry[]): StatusTransition[] {
  return rows
    .filter((r) => typeof r.new_values?.status === 'string')
    .map((r) => ({
      status: r.new_values.status as InvoiceStatus,
      transitioned_at: r.created_at,
      actor_name: r.user_id ?? 'SYSTEM',
      actor_role: typeof r.action === 'string' ? r.action : 'system',
      notes: null,
    }));
}

/** Map an approval row to a decision wire entry. */
function mapApprovalDecision(row: ApprovalHistoryRow): ApprovalDecision {
  return {
    tier: row.tier,
    decision: row.decision,
    actor_name: row.actor_name ?? 'SYSTEM',
    actor_role: row.actor_role ?? 'system',
    decided_at: row.created_at,
    reason: row.comments,
  };
}

/** Build risk breakdown from risk_scores columns; null if no score yet. */
function buildRiskBreakdown(row: EnrichedInvoiceDetailRow): RiskBreakdown | null {
  if (row.risk_score === null) return null;
  return {
    composite: row.risk_score,
    buyer_credit: row.buyer_credit_score !== null ? Number(row.buyer_credit_score) : 0,
    supplier_track_record: row.track_record_score !== null ? Number(row.track_record_score) : 0,
    concentration_risk: row.concentration_score !== null ? Number(row.concentration_score) : 0,
    collateral: row.collateral_score !== null ? Number(row.collateral_score) : 0,
    tenor: row.tenor_score !== null ? Number(row.tenor_score) : 0,
  };
}

/** Map invoice_documents row to wire-format InvoiceDocumentRef. */
function mapDocumentRef(row: InvoiceDocumentRow): InvoiceDocumentRef {
  return {
    id: row.id,
    name: row.document_type,
    type: row.document_type,
    uploaded_at: row.created_at,
    size_bytes: row.file_size_bytes,
  };
}

/** Map collateral row to wire-format InvoiceCollateralRef. */
function mapCollateralRef(row: InvoiceCollateralRow): InvoiceCollateralRef {
  return {
    id: row.id,
    type: row.collateral_type,
    description: row.description,
    estimated_value: parseInt(row.value, 10),
    status: row.is_active ? 'verified' : 'rejected',
    expiry_date: row.expiry_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Build a paginated result envelope from enriched rows. */
function buildPaginatedResult(
  rows: EnrichedInvoiceListRow[],
  total: number,
  pagination: PaginationParams,
): PaginatedResult<EnrichedInvoiceListItem> {
  return {
    data: rows.map(toEnrichedListItem),
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(total / pagination.limit),
  };
}

/**
 * List invoices: supplier sees own, staff see all with filters.
 * Returns enriched rows with supplier_name/buyer_name/risk_score populated.
 */
export async function listInvoices(
  userId: string,
  role: string,
  filters: InvoiceFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<EnrichedInvoiceListItem>> {
  if (role === 'supplier') {
    const supplier = await repo.findSupplierByUserId(userId);
    if (supplier === null) throw new NotFoundError('Supplier', userId);
    const { rows, total } = await repo.findEnrichedInvoicesBySupplier(supplier.id, pagination);
    return buildPaginatedResult(rows, total, pagination);
  }
  const { rows, total } = await repo.findEnrichedAllInvoices(filters, pagination);
  return buildPaginatedResult(rows, total, pagination);
}

/**
 * Get full audit timeline for an invoice (staff only).
 */
export async function getInvoiceTimeline(
  invoiceId: string,
  role: string,
): Promise<AuditTimelineEntry[]> {
  if (role === 'supplier') {
    throw new ForbiddenError('Only staff can view the invoice audit timeline');
  }

  const invoice = await repo.findInvoiceById(invoiceId);
  if (invoice === null) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  return repo.getInvoiceTimeline(invoiceId);
}

// =========================================================================
// Invoice Withdrawal (Cooling-Off Period)
// =========================================================================

const COOLING_OFF_HOURS = 48;

/** Execute withdrawal status change + audit inside a transaction. */
async function executeWithdrawTransaction(
  invoiceId: string,
  userId: string,
  currentStatus: InvoiceStatus,
  reason: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    await repo.withdrawInvoiceWithClient(client, invoiceId, reason);
    await repo.createAuditEntryWithClient(
      client,
      userId,
      'INVOICE_WITHDRAWN',
      'invoices',
      invoiceId,
      { status: currentStatus },
      { status: InvoiceStatus.WITHDRAWN, reason },
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
 * Withdraw a submitted invoice within the cooling-off period.
 * Only the owning supplier can withdraw, and only before buyer confirmation.
 */
export async function withdrawInvoice(
  invoiceId: string,
  userId: string,
  reason: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const supplier = await repo.findSupplierByUserId(userId);
  if (!supplier) throw new ForbiddenError();
  const invoice = await repo.findInvoiceByIdForSupplier(invoiceId, supplier.id);
  if (!invoice) throw new NotFoundError('Invoice', invoiceId);
  validateWithdrawalEligibility(invoice);
  await executeWithdrawTransaction(invoiceId, userId, invoice.status, reason, ipAddress, userAgent);
  logger.audit('INVOICE_WITHDRAWN', { component: 'invoices', invoiceId });
}

/** Validate that the invoice is eligible for withdrawal. */
function validateWithdrawalEligibility(invoice: InvoiceRecord): void {
  if (invoice.status !== InvoiceStatus.SUBMITTED) {
    throw new BusinessRuleError('INVOICE_WRONG_STATUS', 'Only submitted invoices can be withdrawn');
  }
  if (invoice.buyer_confirmed_at !== null) {
    throw new BusinessRuleError(
      'INVOICE_ALREADY_CONFIRMED',
      'Cannot withdraw after buyer confirmation',
    );
  }
  const submittedAt = new Date(invoice.created_at).getTime();
  const elapsed = Date.now() - submittedAt;
  if (elapsed > COOLING_OFF_HOURS * 3_600_000) {
    throw new BusinessRuleError('COOLING_OFF_EXPIRED', 'Cooling-off period has expired');
  }
}

// =========================================================================
// Private helpers
// =========================================================================

/**
 * Log each validation step to audit_logs individually.
 */
async function logValidationResults(
  userId: string,
  invoiceId: string,
  results: ValidationResult[],
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  for (const result of results) {
    await repo.createAuditEntry(
      userId,
      `VALIDATION_${result.step.toUpperCase()}`,
      'invoices',
      invoiceId,
      null,
      {
        passed: result.passed,
        errorCode: result.errorCode ?? null,
        details: result.details ?? null,
      },
      ipAddress,
      userAgent,
    );
  }
}

/**
 * Queue buyer confirmation email via Bull.
 */
async function queueBuyerConfirmation(invoiceId: string, buyerId: string): Promise<void> {
  if (notificationQueue === null) {
    logger.warn('Notification queue not configured — skipping buyer confirmation email', {
      component: 'invoices',
      invoiceId,
    });
    return;
  }

  await enqueueWithContext(
    notificationQueue,
    'send-buyer-confirmation',
    {
      invoiceId,
      buyerId,
    },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );

  logger.audit('BUYER_CONFIRMATION_QUEUED', {
    component: 'invoices',
    invoiceId,
  });
}

/**
 * G7 — Schedule two delayed jobs that warn the credit team when an invoice is
 * approaching (day 3) or has breached (day 7) the assessment SLA. Both fire
 * unconditionally and workers de-duplicate if the invoice has already moved
 * past `submitted` by then.
 */
async function scheduleAssessmentReminders(invoiceId: string, supplierId: string): Promise<void> {
  if (notificationQueue === null) {
    logger.warn('Notification queue not configured — skipping assessment SLA reminders', {
      component: 'invoices',
      invoiceId,
    });
    return;
  }
  const day = 24 * 60 * 60 * 1000;
  await enqueueWithContext(
    notificationQueue,
    'assessment_sla_reminder',
    { invoiceId, supplierId, tier: 'warn_day_3' },
    { delay: 3 * day, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
  await enqueueWithContext(
    notificationQueue,
    'assessment_sla_overdue',
    { invoiceId, supplierId, tier: 'overdue_day_7' },
    { delay: 7 * day, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}

/**
 * G9 — Schedule a one-off reminder when the supplier's declared funding window
 * lapses. No reminder is scheduled if the supplier did not supply a timeline.
 */
async function scheduleFundingTimelineReminder(
  invoiceId: string,
  supplierId: string,
  timelineDays?: number,
): Promise<void> {
  if (!timelineDays || timelineDays <= 0) return;
  if (notificationQueue === null) {
    logger.warn('Notification queue not configured — skipping funding timeline reminder', {
      component: 'invoices',
      invoiceId,
    });
    return;
  }
  await enqueueWithContext(
    notificationQueue,
    'funding_timeline_due',
    { invoiceId, supplierId, timelineDays },
    {
      delay: timelineDays * 24 * 60 * 60 * 1000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );
}

/**
 * Enforce resource ownership: suppliers see only their own invoices.
 * Returns silently for non-supplier roles; throws ForbiddenError otherwise.
 */
async function enforceOwnershipBySupplierId(
  invoiceSupplierId: string,
  userId: string,
  role: string,
): Promise<void> {
  if (role !== 'supplier') return;
  const supplier = await repo.findSupplierByUserId(userId);
  if (supplier === null || supplier.id !== invoiceSupplierId) {
    throw new ForbiddenError();
  }
}

/**
 * Convert DB record to API detail.
 */
function toInvoiceDetail(record: InvoiceRecord): InvoiceDetail {
  return {
    id: record.id,
    invoice_number: record.invoice_number,
    supplier_id: record.supplier_id,
    buyer_id: record.buyer_id,
    face_value: parseInt(record.face_value, 10),
    due_date: record.due_date,
    description: record.description,
    status: record.status,
    sla_deadline: record.sla_deadline,
    buyer_confirmed_at: record.buyer_confirmed_at,
    aml_flagged: record.aml_flagged,
    created_at: record.created_at,
  };
}

// =========================================================================
// G11 — Application assignment + tracking
// =========================================================================

/**
 * Assign an invoice to a credit_officer or finance_manager for review.
 * Pass `assigneeUserId = null` to clear the current assignment.
 * Writes an audit entry so assignments are traceable.
 */
export async function assignInvoice(
  invoiceId: string,
  assigneeUserId: string | null,
  assignerUserId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    const rows = await repo.assignInvoiceWithClient(client, invoiceId, assigneeUserId);
    if (rows === 0) {
      throw new NotFoundError('Invoice', invoiceId);
    }
    await repo.createAuditEntryWithClient(
      client,
      assignerUserId,
      'INVOICE_ASSIGNED',
      'invoices',
      invoiceId,
      null,
      { assignedTo: assigneeUserId ?? null, assignedBy: assignerUserId },
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
  logger.audit('INVOICE_ASSIGNED', {
    component: 'invoices',
    invoiceId,
    assignedTo: assigneeUserId,
  });
}

// =========================================================================
// G6 — Per-invoice bank details captured post-approval
// =========================================================================

/**
 * Capture bank destination for a single invoice after it reaches `approved`.
 * Uganda reality: suppliers may route different invoices to different
 * accounts — onboarding is no longer the right place to collect these.
 *
 * Gate: invoice.status === 'approved' (enforced in SQL WHERE clause).
 * Encrypts all three fields via shared/crypto before INSERT.
 */
export async function setInvoiceBankDetails(
  userId: string,
  invoiceId: string,
  input: InvoiceBankDetailsInput,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const encNum = encrypt(input.bank_account_number);
  const encName = encrypt(input.bank_account_name);
  const encBank = encrypt(input.bank_name);

  const client = await repo.getClient();
  try {
    await beginWithRls(client);
    const rows = await repo.setInvoiceBankDetailsWithClient(
      client,
      invoiceId,
      userId,
      encNum,
      encName,
      encBank,
    );
    if (rows === 0) {
      throw new BusinessRuleError(
        ValidationErrorCode.INVOICE_WRONG_STATUS,
        'Bank details can only be captured on an approved invoice you own',
      );
    }
    await repo.createAuditEntryWithClient(
      client,
      userId,
      'INVOICE_BANK_DETAILS_SET',
      'invoices',
      invoiceId,
      null,
      { invoiceId, bankDetailsCapturedAt: new Date().toISOString() },
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
  logger.audit('INVOICE_BANK_DETAILS_SET', { component: 'invoices', invoiceId });
}

// =========================================================================
// Invoice document upload (delivery notes, proforma, PO, contracts)
// =========================================================================

/**
 * Upload a document attached to an invoice (delivery_note, proforma_invoice,
 * purchase_order, contract). Encrypted on disk, persisted to invoice_documents
 * with `invoice_id` set so it appears in the invoice detail page's documents
 * list.
 *
 * Authorisation:
 *   - supplier role: must own the invoice (invoice.supplier_id matches the
 *     supplier looked up via users.id = supplier.user_id).
 *   - credit_officer / compliance_officer / management: any invoice (used
 *     for staff back-fill scenarios — e.g. courier-delivered hardcopy
 *     scanned in by ops).
 *   - all other roles: ForbiddenError.
 *
 * Audit log written via the existing repo helper. PII-free metadata only:
 * the document_type, byte length, and the invoice + document IDs.
 */
export async function uploadInvoiceDocument(
  invoiceId: string,
  userId: string,
  role: string,
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  documentType: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ documentId: string }> {
  if (!ALLOWED_INVOICE_DOC_TYPES.has(documentType)) {
    throw new BusinessRuleError(
      ValidationErrorCode.INVOICE_WRONG_STATUS,
      `Unknown document_type: ${documentType}`,
    );
  }
  if (file.size === 0) {
    throw new BusinessRuleError(
      ValidationErrorCode.INVOICE_WRONG_STATUS,
      'Uploaded file is empty.',
    );
  }
  if (file.size > MAX_INVOICE_DOC_SIZE_BYTES) {
    throw new BusinessRuleError(
      ValidationErrorCode.INVOICE_WRONG_STATUS,
      `File too large. Maximum size is ${MAX_INVOICE_DOC_SIZE_BYTES / (1024 * 1024)} MB.`,
    );
  }
  if (!ALLOWED_INVOICE_DOC_MIME.has(file.mimetype)) {
    throw new BusinessRuleError(
      ValidationErrorCode.INVOICE_WRONG_STATUS,
      `Unsupported file type: ${file.mimetype}`,
    );
  }

  const invoice = await repo.findInvoiceById(invoiceId);
  if (invoice === null) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  // Ownership for supplier role: resolve their supplier.id from user_id and
  // compare to invoice.supplier_id. Admin roles can upload to any invoice.
  if (role === 'supplier') {
    const supplier = await onboardingRepo.findSupplierByUserId(userId);
    if (supplier === null || supplier.id !== invoice.supplier_id) {
      throw new ForbiddenError();
    }
  } else if (!ADMIN_INVOICE_DOC_UPLOAD_ROLES.has(role)) {
    throw new ForbiddenError();
  }

  const documentId = uuidv4();
  encryptAndStoreInvoiceDocumentFile(documentId, file);
  const fileHash = hashDocument(file.buffer);
  await onboardingRepo.createDocument({
    id: documentId,
    invoiceId: invoice.id,
    supplierId: invoice.supplier_id,
    documentType,
    encryptedPath: `${documentId}.enc`,
    fileHash,
    fileSizeBytes: file.size,
    mimeType: file.mimetype,
    uploadedBy: userId,
  });
  await repo.createAuditEntry(
    userId,
    'INVOICE_DOCUMENT_UPLOADED',
    'invoices',
    invoice.id,
    null,
    {
      documentId,
      documentType,
      byteLength: file.size,
      mimeType: file.mimetype,
    },
    ipAddress,
    userAgent,
  );
  logger.audit('INVOICE_DOCUMENT_UPLOADED', {
    component: 'invoices',
    invoiceId: invoice.id,
    documentId,
    documentType,
  });

  return { documentId };
}

/** Encrypt + write the file under <UPLOAD_DIR>/<docId>.enc. */
function encryptAndStoreInvoiceDocumentFile(documentId: string, file: { buffer: Buffer }): void {
  const encryptedContent = encrypt(file.buffer.toString('base64'));
  if (!fs.existsSync(INVOICE_DOC_UPLOAD_DIR)) {
    fs.mkdirSync(INVOICE_DOC_UPLOAD_DIR, { recursive: true });
  }
  const encryptedPath = path.join(INVOICE_DOC_UPLOAD_DIR, `${documentId}.enc`);
  fs.writeFileSync(encryptedPath, encryptedContent, 'utf8');
}

/**
 * Resolve + decrypt a stored invoice document. Same on-disk format as
 * uploadInvoiceDocument writes (base64 plaintext encrypted via shared/crypto).
 * Defends against path traversal by anchoring against INVOICE_DOC_UPLOAD_DIR
 * and rejecting absolute paths that escape it.
 */
function readAndDecryptInvoiceDocument(documentId: string, encryptedPath: string): Buffer {
  const absolute = path.resolve(INVOICE_DOC_UPLOAD_DIR, encryptedPath);
  const root = path.resolve(INVOICE_DOC_UPLOAD_DIR);
  if (!absolute.startsWith(root + path.sep) && absolute !== root) {
    throw new RisError('Document path outside upload root', 500, 'DOCUMENT_PATH_INVALID');
  }
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
 * Stream a previously-uploaded invoice document, decrypted, for inline
 * preview / download.
 *
 * Authorization mirrors getInvoiceDetail:
 *   - supplier role: must own the invoice (supplier_id resolved from user_id)
 *   - credit_officer / management / compliance_officer / legal / auditor:
 *     may fetch any invoice's documents (read-only oversight roles)
 *
 * The (docId, invoice_id) scope in the repo prevents cross-invoice leaks even
 * if an attacker guesses a document UUID belonging to another invoice.
 *
 * Read-only — no audit row written (project convention: audit covers state
 * changes only).
 */
export async function getInvoiceDocumentFile(
  invoiceId: string,
  docId: string,
  userId: string,
  role: string,
): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const invoice = await repo.findInvoiceById(invoiceId);
  if (invoice === null) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  const VIEWER_ROLES = new Set([
    'credit_officer',
    'finance_manager',
    'management',
    'compliance_officer',
    'legal',
    'auditor',
  ]);

  if (role === 'supplier') {
    const supplier = await onboardingRepo.findSupplierByUserId(userId);
    if (supplier === null || supplier.id !== invoice.supplier_id) {
      throw new ForbiddenError();
    }
  } else if (!VIEWER_ROLES.has(role)) {
    throw new ForbiddenError();
  }

  const record = await onboardingRepo.findDocumentByIdAndInvoice(docId, invoice.id);
  if (record === null) {
    // Don't leak existence under another invoice — same status as missing id.
    throw new NotFoundError('Document', docId);
  }

  const buffer = readAndDecryptInvoiceDocument(docId, record.encrypted_path);
  const ext = invoiceMimeToExtension(record.mime_type);
  const shortId = record.id.slice(0, 8);
  const fileName = `${record.document_type}_${shortId}${ext}`;

  return { buffer, mimeType: record.mime_type, fileName };
}

/** Map MIME → extension for the user-visible filename in Content-Disposition. */
function invoiceMimeToExtension(mime: string): string {
  switch (mime) {
    case 'application/pdf':
      return '.pdf';
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    default:
      return '';
  }
}
