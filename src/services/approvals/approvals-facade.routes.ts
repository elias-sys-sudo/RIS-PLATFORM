import { Router } from 'express';
import type { Request, Response } from 'express';
import Joi from 'joi';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import { query } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import { NotFoundError } from '../../shared/errors';
import { decrypt } from '../../shared/crypto';
import * as approvalsService from './approvals.service';

// =========================================================================
// Types
// =========================================================================

interface ApprovalListRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  face_value: string;
  risk_score: number;
  risk_level: string;
  submitted_at: string;
  status: string;
  days_in_queue: number;
  current_tier: 'AUTO' | 'TIER_2' | 'TIER_3' | 'TIER_4';
}

interface ApprovalStatsRow {
  pending_count: string;
  approved_today: string;
  rejected_today: string;
  avg_days_in_queue: string;
}

interface ApprovalHistoryRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  face_value: string;
  decision: string;
  decided_by: string;
  decided_at: string;
  tier: string;
  comments: string;
}

interface InvoiceDetailRow {
  id: string;
  invoice_number: string;
  supplier_name: string;
  buyer_name: string;
  face_value: string;
  status: string;
  due_date: string;
  created_at: string;
  supplier_id: string;
  buyer_id: string;
  supplier_email: string | null;
  supplier_phone_enc: string | null;
  buyer_email_enc: string | null;
  buyer_phone_enc: string | null;
}

interface ContactInfo {
  contact_email: string;
  contact_phone: string;
}

interface TierDecisionRow {
  tier: string;
  decision: string;
  decided_by: string;
  actor_name: string;
  actor_role: string;
  decided_at: string;
  reason: string;
}

interface RiskBreakdownRow {
  final_score: number;
  buyer_credit_score: number;
  supplier_track_record_score: number;
  collateral_score: number;
  concentration_risk_score: number;
  tenor_score: number;
}

interface CountRow {
  count: string;
}

// =========================================================================
// Joi Schemas
// =========================================================================

const listSchema = {
  query: Joi.object({
    tab: Joi.string().valid('pending', 'approved', 'rejected', 'all').default('pending'),
    tier: Joi.number().integer().valid(1, 2, 3).optional(),
    search: Joi.string().max(200).optional().allow(''),
    page: Joi.number().integer().min(1).default(1),
    page_size: Joi.number().integer().min(1).max(100).default(20),
    sort_by: Joi.string()
      .valid('submitted_at', 'face_value', 'risk_score', 'days_in_queue')
      .default('submitted_at'),
    sort_dir: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};

const historySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    page_size: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const invoiceIdParamSchema = {
  params: Joi.object({
    invoiceId: Joi.string().uuid().required(),
  }),
};

const approveBodySchema = {
  params: Joi.object({
    invoiceId: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    reason: Joi.string().max(2000).optional().allow(''),
  }),
};

const rejectBodySchema = {
  params: Joi.object({
    invoiceId: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    reason: Joi.string().min(10).max(2000).required(),
  }),
};

const requestInfoBodySchema = {
  params: Joi.object({
    invoiceId: Joi.string().uuid().required(),
  }),
  body: Joi.object({
    message: Joi.string().min(10).max(2000).required(),
  }),
};

// =========================================================================
// Allowed roles
// =========================================================================

const APPROVAL_ROLES = ['credit_officer', 'management', 'compliance_officer', 'legal'];
const DECISION_ROLES = ['credit_officer', 'management'];

// =========================================================================
// Helper: risk level from score
// =========================================================================

/** Map a numeric risk score to a human-readable level. */
function riskLevel(score: number): string {
  if (score >= 75) return 'low';
  if (score >= 50) return 'medium';
  return 'high';
}

// =========================================================================
// Helper: build status filter clause
// =========================================================================

/** Return SQL WHERE fragment and params for status tab filter. */
function buildTabFilter(tab: string, params: unknown[]): { clause: string; nextIdx: number } {
  const idx = params.length + 1;
  if (tab === 'approved') {
    params.push('approved');
    return { clause: `i.status = $${String(idx)}`, nextIdx: idx + 1 };
  }
  if (tab === 'rejected') {
    params.push('rejected');
    return { clause: `i.status = $${String(idx)}`, nextIdx: idx + 1 };
  }
  if (tab === 'all') {
    return { clause: `i.status IN ('scored','approved','rejected')`, nextIdx: idx };
  }
  // default: pending
  params.push('scored');
  return { clause: `i.status = $${String(idx)}`, nextIdx: idx + 1 };
}

// =========================================================================
// Handler: GET /approvals (paginated list)
// =========================================================================

/** Fetch paginated approvals list with filters and stats. */
async function listApprovals(req: Request, res: Response): Promise<void> {
  const qp = req.query as Record<string, string>;
  const tab = qp.tab ?? 'pending';
  const tier = qp.tier ? parseInt(qp.tier, 10) : undefined;
  const search = qp.search ?? '';
  const page = parseInt(qp.page ?? '1', 10);
  const pageSize = parseInt(qp.page_size ?? '20', 10);
  const sortBy = qp.sort_by ?? 'submitted_at';
  const sortDir = qp.sort_dir ?? 'desc';

  const { rows, total } = await queryApprovalList(
    tab,
    tier,
    search,
    page,
    pageSize,
    sortBy,
    sortDir,
  );
  const stats = await queryApprovalStats();
  const totalPages = Math.ceil(total / pageSize);

  res.status(200).json({
    data: rows,
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    stats,
  });
}

// =========================================================================
// Query: approval list
// =========================================================================

/** Build and execute the paginated approval list query. */
async function queryApprovalList(
  tab: string,
  tier: number | undefined,
  search: string,
  page: number,
  pageSize: number,
  sortBy: string,
  sortDir: string,
): Promise<{ rows: ApprovalListRow[]; total: number }> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  const { clause } = buildTabFilter(tab, params);
  conditions.push(clause);

  if (tier !== undefined) {
    conditions.push(buildTierCondition(tier));
  }

  if (search.trim() !== '') {
    const idx = params.length + 1;
    params.push(`%${search.trim()}%`);
    conditions.push(
      `(i.invoice_number ILIKE $${String(idx)} OR s.company_name ILIKE $${String(idx)} OR b.company_name ILIKE $${String(idx)})`,
    );
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = await countApprovals(where, params);
  const rows = await fetchApprovalPage(where, params, sortBy, sortDir, page, pageSize);

  return { rows, total };
}

// =========================================================================
// Query: tier condition builder
// =========================================================================

/** Return raw SQL condition for tier filtering. */
function buildTierCondition(tier: number): string {
  if (tier === 3) {
    return `(i.face_value > 50000000 OR rs.final_score < 50)`;
  }
  if (tier === 2) {
    return `(i.face_value >= 10000000 AND i.face_value <= 50000000 AND rs.final_score >= 50 AND rs.final_score < 75)`;
  }
  return `(i.face_value < 10000000 AND rs.final_score >= 75 AND i.aml_flagged = false)`;
}

// =========================================================================
// Query: count approvals
// =========================================================================

/** Count matching approval rows for pagination. */
async function countApprovals(where: string, params: unknown[]): Promise<number> {
  const sql = `
    SELECT COUNT(*)::text AS count
    FROM invoices i
    LEFT JOIN risk_scores rs ON rs.invoice_id = i.id
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    LEFT JOIN buyers b ON b.id = i.buyer_id
    ${where}`;

  const result = await query<CountRow>(sql, params);
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

// =========================================================================
// Query: fetch approval page
// =========================================================================

/** Fetch one page of approval rows. */
async function fetchApprovalPage(
  where: string,
  baseParams: unknown[],
  sortBy: string,
  sortDir: string,
  page: number,
  pageSize: number,
): Promise<ApprovalListRow[]> {
  const sortColumn = mapSortColumn(sortBy);
  const direction = sortDir === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  const params = [...baseParams, pageSize, offset];
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const sql = `
    SELECT
      i.id,
      i.id AS invoice_id,
      i.invoice_number,
      COALESCE(s.company_name, '') AS supplier_name,
      COALESCE(b.company_name, '') AS buyer_name,
      i.face_value::text AS face_value,
      COALESCE(rs.final_score, 0) AS risk_score,
      i.created_at AS submitted_at,
      i.status,
      GREATEST(0, EXTRACT(DAY FROM NOW() - i.created_at))::int AS days_in_queue,
      CASE
        WHEN i.face_value > 50000000 OR COALESCE(rs.final_score, 0) < 50 THEN 'TIER_3'
        WHEN i.face_value >= 10000000
          OR (COALESCE(rs.final_score, 0) >= 50 AND COALESCE(rs.final_score, 0) < 75)
          OR i.aml_flagged = true THEN 'TIER_2'
        ELSE 'AUTO'
      END AS current_tier
    FROM invoices i
    LEFT JOIN risk_scores rs ON rs.invoice_id = i.id
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    LEFT JOIN buyers b ON b.id = i.buyer_id
    ${where}
    ORDER BY ${sortColumn} ${direction}
    LIMIT $${String(limitIdx)} OFFSET $${String(offsetIdx)}`;

  const result = await query<ApprovalListRow>(sql, params);

  return result.rows.map((row) => ({
    ...row,
    risk_level: riskLevel(row.risk_score),
  }));
}

/** Map API sort field names to SQL columns. */
function mapSortColumn(sortBy: string): string {
  const mapping: Record<string, string> = {
    submitted_at: 'i.created_at',
    face_value: 'i.face_value',
    risk_score: 'rs.final_score',
    days_in_queue: 'i.created_at',
  };
  return mapping[sortBy] ?? 'i.created_at';
}

// =========================================================================
// Query: approval stats
// =========================================================================

/** Fetch aggregate approval stats for the dashboard header. */
async function queryApprovalStats(): Promise<{
  pending_count: number;
  approved_today: number;
  rejected_today: number;
  avg_days_in_queue: number;
}> {
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM invoices WHERE status = 'scored')::text AS pending_count,
      (SELECT COUNT(*) FROM approvals
         WHERE decision = 'APPROVED'
           AND created_at >= CURRENT_DATE)::text AS approved_today,
      (SELECT COUNT(*) FROM approvals
         WHERE decision = 'REJECTED'
           AND created_at >= CURRENT_DATE)::text AS rejected_today,
      COALESCE(
        (SELECT AVG(EXTRACT(DAY FROM NOW() - created_at))
         FROM invoices WHERE status = 'scored'),
        0
      )::text AS avg_days_in_queue`;

  const result = await query<ApprovalStatsRow>(sql, []);
  const row = result.rows[0];

  return {
    pending_count: parseInt(row?.pending_count ?? '0', 10),
    approved_today: parseInt(row?.approved_today ?? '0', 10),
    rejected_today: parseInt(row?.rejected_today ?? '0', 10),
    avg_days_in_queue: parseFloat(row?.avg_days_in_queue ?? '0'),
  };
}

// =========================================================================
// Handler: GET /approvals/history
// =========================================================================

/** Fetch paginated approval decision history. */
async function listHistory(req: Request, res: Response): Promise<void> {
  const qp = req.query as Record<string, string>;
  const page = parseInt(qp.page ?? '1', 10);
  const pageSize = parseInt(qp.page_size ?? '20', 10);

  const { rows, total } = await queryHistory(page, pageSize);
  const totalPages = Math.ceil(total / pageSize);

  res.status(200).json({
    data: rows,
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
  });
}

/** Count and fetch approval history rows. */
async function queryHistory(
  page: number,
  pageSize: number,
): Promise<{ rows: ApprovalHistoryRow[]; total: number }> {
  const countResult = await query<CountRow>(`SELECT COUNT(*)::text AS count FROM approvals`, []);
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const offset = (page - 1) * pageSize;
  const result = await query<ApprovalHistoryRow>(
    `SELECT
       a.id,
       a.invoice_id,
       COALESCE(i.invoice_number, '') AS invoice_number,
       COALESCE(s.company_name, '') AS supplier_name,
       COALESCE(b.company_name, '') AS buyer_name,
       i.face_value::text AS face_value,
       a.decision,
       a.approver_id AS decided_by,
       a.created_at AS decided_at,
       a.tier,
       a.comments
     FROM approvals a
     JOIN invoices i ON i.id = a.invoice_id
     LEFT JOIN suppliers s ON s.id = i.supplier_id
     LEFT JOIN buyers b ON b.id = i.buyer_id
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
    [pageSize, offset],
  );

  return { rows: result.rows, total };
}

// =========================================================================
// Handler: GET /approvals/:invoiceId
// =========================================================================

/** Fetch detailed approval info for a single invoice. */
async function getApprovalDetail(req: Request, res: Response): Promise<void> {
  const { invoiceId } = req.params;
  const invoice = await queryInvoiceDetail(invoiceId);
  const tierDecisions = await queryTierDecisions(invoiceId);
  const riskBreakdown = await queryRiskBreakdown(invoiceId);

  const tierStr = computeTierFromInvoice(invoice, riskBreakdown);

  res.status(200).json({
    id: invoice.id,
    invoice_id: invoice.id,
    invoice,
    supplier_info: buildSupplierInfo(invoice),
    buyer_info: buildBuyerInfo(invoice),
    current_tier: tierStr, // canonical enum: AUTO | TIER_2 | TIER_3 | TIER_4
    status: invoice.status === 'scored' ? 'pending' : invoice.status,
    tier_decisions: tierDecisions,
    risk_breakdown: riskBreakdown,
    submitted_at: invoice.created_at,
    days_in_queue: daysInQueue(invoice.created_at),
  });
}

/** Build supplier contact card — decrypts phone PII at service layer (Rule 6). */
function buildSupplierInfo(invoice: InvoiceDetailRow): ContactInfo {
  return {
    contact_email: invoice.supplier_email ?? '',
    contact_phone: safeDecrypt(invoice.supplier_phone_enc),
  };
}

/** Build buyer contact card — decrypts email + phone PII at service layer (Rule 6). */
function buildBuyerInfo(invoice: InvoiceDetailRow): ContactInfo {
  return {
    contact_email: safeDecrypt(invoice.buyer_email_enc),
    contact_phone: safeDecrypt(invoice.buyer_phone_enc),
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

/** Query invoice detail by ID. */
async function queryInvoiceDetail(invoiceId: string): Promise<InvoiceDetailRow> {
  const result = await query<InvoiceDetailRow>(
    `SELECT
       i.id,
       i.invoice_number,
       COALESCE(s.company_name, '') AS supplier_name,
       COALESCE(b.company_name, '') AS buyer_name,
       i.face_value::text AS face_value,
       i.status,
       i.due_date,
       i.created_at,
       i.supplier_id,
       i.buyer_id,
       sus.email AS supplier_email,
       sus.phone_encrypted AS supplier_phone_enc,
       b.contact_email_encrypted AS buyer_email_enc,
       b.contact_phone_encrypted AS buyer_phone_enc
     FROM invoices i
     LEFT JOIN suppliers s ON s.id = i.supplier_id
     LEFT JOIN users sus ON sus.id = s.user_id
     LEFT JOIN buyers b ON b.id = i.buyer_id
     WHERE i.id = $1`,
    [invoiceId],
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Invoice', invoiceId);
  }
  return result.rows[0];
}

/** Query tier decisions for an invoice — JOINs users for actor name + role. */
async function queryTierDecisions(invoiceId: string): Promise<TierDecisionRow[]> {
  const result = await query<TierDecisionRow>(
    `SELECT
       a.tier,
       a.decision,
       a.approver_id AS decided_by,
       COALESCE(u.email, 'Unknown user') AS actor_name,
       COALESCE(u.role::text, '') AS actor_role,
       a.created_at AS decided_at,
       a.comments AS reason
     FROM approvals a
     LEFT JOIN users u ON u.id = a.approver_id
     WHERE a.invoice_id = $1
     ORDER BY a.created_at ASC`,
    [invoiceId],
  );
  return result.rows;
}

/** Query risk score breakdown for an invoice. */
async function queryRiskBreakdown(invoiceId: string): Promise<RiskBreakdownRow | null> {
  const result = await query<RiskBreakdownRow>(
    `SELECT
       final_score,
       COALESCE(buyer_credit_score, 0) AS buyer_credit_score,
       COALESCE(track_record_score, 0) AS supplier_track_record_score,
       COALESCE(collateral_score, 0) AS collateral_score,
       COALESCE(concentration_score, 0) AS concentration_risk_score,
       COALESCE(tenor_score, 0) AS tenor_score
     FROM risk_scores
     WHERE invoice_id = $1`,
    [invoiceId],
  );
  return result.rows[0] ?? null;
}

/** Compute tier string from invoice and risk data. */
function computeTierFromInvoice(invoice: InvoiceDetailRow, risk: RiskBreakdownRow | null): string {
  const faceValue = BigInt(invoice.face_value);
  const score = risk?.final_score ?? 0;

  if (faceValue > 50_000_000n || score < 50) return 'TIER_3';
  if (faceValue >= 10_000_000n || (score >= 50 && score < 75)) return 'TIER_2';
  return 'AUTO';
}

/** Calculate days in queue from a date string. */
function daysInQueue(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

// =========================================================================
// Handler: POST /approvals/:invoiceId/approve
// =========================================================================

/** Approve an invoice, delegating to the existing approvals service. */
async function approveInvoice(req: Request, res: Response): Promise<void> {
  const { invoiceId } = req.params;
  const userId = req.user?.userId ?? '';
  const role = req.user?.role ?? '';
  const ip = req.ip ?? 'unknown';
  const ua = req.get('user-agent') ?? 'unknown';
  const { reason } = req.body as { reason?: string };

  const comments = reason ?? 'Approved via approvals dashboard';

  const result = await approvalsService.approveInvoice(invoiceId, userId, role, ip, ua, comments);

  logger.info('Invoice approved via facade', {
    component: 'approvals-facade',
    invoiceId,
  });

  res.status(200).json(result);
}

// =========================================================================
// Handler: POST /approvals/:invoiceId/reject
// =========================================================================

/** Reject an invoice, delegating to the existing approvals service. */
async function rejectInvoice(req: Request, res: Response): Promise<void> {
  const { invoiceId } = req.params;
  const userId = req.user?.userId ?? '';
  const role = req.user?.role ?? '';
  const ip = req.ip ?? 'unknown';
  const ua = req.get('user-agent') ?? 'unknown';
  const { reason } = req.body as { reason: string };

  const result = await approvalsService.rejectInvoice(invoiceId, userId, role, ip, ua, reason);

  logger.info('Invoice rejected via facade', {
    component: 'approvals-facade',
    invoiceId,
  });

  res.status(200).json(result);
}

// =========================================================================
// Handler: POST /approvals/:invoiceId/request-info
// =========================================================================

/** Request additional information for an invoice under review. */
async function requestInfo(req: Request, res: Response): Promise<void> {
  const { invoiceId } = req.params;
  const { message } = req.body as { message: string };

  if (!message || message.length < 10) {
    res
      .status(400)
      .json({ code: 'VALIDATION_ERROR', message: 'message must be at least 10 characters' });
    return;
  }

  const result = await approvalsService.createInfoRequest(invoiceId, req.user!.userId, message);

  res.status(201).json(result);
}

// =========================================================================
// Router
// =========================================================================

const router = Router();

router.get(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard(APPROVAL_ROLES),
  validate(listSchema),
  asyncHandler(listApprovals),
);

router.get(
  '/history',
  asyncHandler(authenticateJwt),
  createRoleGuard(APPROVAL_ROLES),
  validate(historySchema),
  asyncHandler(listHistory),
);

router.get(
  '/:invoiceId',
  asyncHandler(authenticateJwt),
  createRoleGuard(APPROVAL_ROLES),
  validate(invoiceIdParamSchema),
  asyncHandler(getApprovalDetail),
);

router.post(
  '/:invoiceId/approve',
  asyncHandler(authenticateJwt),
  createRoleGuard(DECISION_ROLES),
  validate(approveBodySchema),
  asyncHandler(approveInvoice),
);

router.post(
  '/:invoiceId/reject',
  asyncHandler(authenticateJwt),
  createRoleGuard(DECISION_ROLES),
  validate(rejectBodySchema),
  asyncHandler(rejectInvoice),
);

router.post(
  '/:invoiceId/request-info',
  asyncHandler(authenticateJwt),
  createRoleGuard(DECISION_ROLES),
  validate(requestInfoBodySchema),
  asyncHandler(requestInfo),
);

export { router as approvalsFacadeRouter };
