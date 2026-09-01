import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { query } from '../../shared/database/pool';
import { decrypt } from '../../shared/crypto';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import { NotFoundError, ForbiddenError } from '../../shared/errors';
import { listSupplierBuyersHandler } from '../auth/auth.controller';
import { getPaymentsBySupplierId } from '../payments/payments.repository';

const suppliersFacadeRouter = Router();

// =========================================================================
// Types
// =========================================================================

interface SupplierListRow {
  id: string;
  company_name: string | null;
  company_name_encrypted: string | null;
  user_id: string;
  registration_number: string;
  kyc_status: string;
  risk_tier: string;
  created_at: Date;
  email: string;
  total_invoices: string;
  total_outstanding_ugx: string;
}

interface SupplierListItem {
  id: string;
  name: string;
  company: string;
  contact_email: string;
  registration_date: string;
  status: string;
  risk_band: string;
  total_invoices: number;
  total_outstanding_ugx: string;
}

interface SupplierDetailRow {
  id: string;
  user_id: string;
  company_name: string | null;
  company_name_encrypted: string | null;
  registration_number: string;
  tax_id: string | null;
  tax_id_encrypted: string | null;
  kyc_status: string;
  risk_tier: string;
  preferred_payment_method: string;
  bank_name: string;
  bank_branch: string;
  mobile_money_number_encrypted: string | null;
  sanctions_flag: boolean;
  created_at: Date;
  updated_at: Date;
  email: string;
  first_name_encrypted: string | null;
  last_name_encrypted: string | null;
  phone_encrypted: string | null;
}

interface SupplierMetricsRow {
  total_invoices: string;
  total_face_value: string;
  total_funded: string;
  avg_tenor_days: string;
  total_outstanding: string;
}

// =========================================================================
// Validation
// =========================================================================

const listSuppliersSchema = {
  query: Joi.object({
    search: Joi.string().max(255).optional().allow(''),
    status: Joi.string().max(50).optional().allow(''),
    page: Joi.number().integer().min(1).default(1),
    page_size: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const supplierIdSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
};

const supplierBuyersSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().max(255).optional().allow(''),
    status: Joi.string().valid('active', 'inactive').optional(),
  }),
};

const supplierPaymentsSchema = {
  params: Joi.object({
    id: Joi.string().uuid().required(),
  }),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    page_size: Joi.number().integer().min(1).max(100).default(20),
  }),
};

// =========================================================================
// Helpers
// =========================================================================

/**
 * Safely decrypt a value, returning empty string on failure.
 */
function safeDecrypt(encrypted: string | null): string {
  if (encrypted === null || encrypted === undefined || encrypted === '') {
    return '';
  }
  try {
    return decrypt(encrypted);
  } catch {
    return '';
  }
}

/**
 * Resolve a supplier's display name. New registrations (post-encryption migration)
 * write only company_name_encrypted; legacy rows have plaintext company_name.
 * Decrypt the encrypted column if populated, otherwise fall back to plaintext,
 * otherwise empty string (never null — the FE expects a string).
 */
function resolveCompanyName(encrypted: string | null, plaintext: string | null): string {
  const decrypted = safeDecrypt(encrypted);
  if (decrypted !== '') return decrypted;
  return plaintext ?? '';
}

/**
 * Map a supplier row to the list response shape.
 */
function toSupplierListItem(row: SupplierListRow): SupplierListItem {
  const company = resolveCompanyName(row.company_name_encrypted, row.company_name);
  return {
    id: row.id,
    name: company,
    company,
    contact_email: row.email,
    registration_date: row.created_at.toISOString(),
    status: row.kyc_status,
    risk_band: row.risk_tier,
    total_invoices: parseInt(row.total_invoices ?? '0', 10),
    total_outstanding_ugx: row.total_outstanding_ugx ?? '0',
  };
}

// =========================================================================
// Query functions
// =========================================================================

/**
 * Build WHERE conditions for supplier list queries.
 */
function buildSupplierConditions(
  search: string | undefined,
  status: string | undefined,
): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (search !== undefined && search !== '') {
    conditions.push(`s.company_name ILIKE $${String(idx)}`);
    params.push(`%${search}%`);
    idx++;
  }
  if (status !== undefined && status !== '') {
    conditions.push(`s.kyc_status = $${String(idx)}`);
    params.push(status);
  }
  return { conditions, params };
}

/**
 * Count suppliers matching filters.
 */
async function countSuppliers(
  search: string | undefined,
  status: string | undefined,
): Promise<number> {
  const { conditions, params } = buildSupplierConditions(search, status);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM suppliers s ${where}`,
    params,
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Fetch a page of suppliers with invoice metrics.
 */
async function fetchSupplierPage(
  search: string | undefined,
  status: string | undefined,
  limit: number,
  offset: number,
): Promise<SupplierListRow[]> {
  const { conditions, params } = buildSupplierConditions(search, status);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const idx = params.length + 1;
  // Select BOTH plaintext company_name and company_name_encrypted — display
  // logic decrypts the encrypted column first and falls back to plaintext
  // for legacy rows. Search-by-name (ILIKE) still hits the plaintext column;
  // encrypted-row search is a known limitation, will need a separate index.
  const sql = `
    SELECT s.id, s.company_name, s.company_name_encrypted,
           s.user_id, s.registration_number,
           s.kyc_status, s.risk_tier, s.created_at,
           u.email,
           COALESCE(inv.total_invoices, 0) AS total_invoices,
           COALESCE(inv.total_outstanding_ugx, 0) AS total_outstanding_ugx
    FROM suppliers s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total_invoices,
             SUM(CASE WHEN i.status IN ('funded','collecting','overdue')
                      THEN i.face_value ELSE 0 END) AS total_outstanding_ugx
      FROM invoices i WHERE i.supplier_id = s.id
    ) inv ON true
    ${where}
    ORDER BY s.created_at DESC
    LIMIT $${String(idx)} OFFSET $${String(idx + 1)}`;

  const result = await query<SupplierListRow>(sql, [...params, limit, offset]);
  return result.rows;
}

/**
 * Fetch a single supplier with user details.
 */
async function fetchSupplierDetail(id: string): Promise<SupplierDetailRow | null> {
  const result = await query<SupplierDetailRow>(
    `SELECT s.*, u.email, u.first_name_encrypted,
            u.last_name_encrypted, u.phone_encrypted
     FROM suppliers s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch invoice metrics for a supplier.
 */
async function fetchSupplierMetrics(supplierId: string): Promise<SupplierMetricsRow> {
  const result = await query<SupplierMetricsRow>(
    `SELECT COUNT(*) AS total_invoices,
            COALESCE(SUM(face_value), 0) AS total_face_value,
            COALESCE(SUM(CASE WHEN status = 'funded' THEN face_value ELSE 0 END), 0) AS total_funded,
            COALESCE(AVG(tenor_days), 0) AS avg_tenor_days,
            COALESCE(SUM(CASE WHEN status IN ('funded','collecting','overdue')
                              THEN face_value ELSE 0 END), 0) AS total_outstanding
     FROM invoices WHERE supplier_id = $1`,
    [supplierId],
  );
  return (
    result.rows[0] ?? {
      total_invoices: '0',
      total_face_value: '0',
      total_funded: '0',
      avg_tenor_days: '0',
      total_outstanding: '0',
    }
  );
}

// =========================================================================
// Handlers
// =========================================================================

/**
 * GET /suppliers — paginated supplier list.
 */
async function listSuppliersHandler(req: Request, res: Response): Promise<void> {
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;
  const page = parseInt(req.query.page as string, 10) || 1;
  const pageSize = parseInt(req.query.page_size as string, 10) || 20;
  const offset = (page - 1) * pageSize;

  const searchTerm = search !== undefined && search.trim() !== '' ? search.trim() : undefined;
  const statusTerm = status !== undefined && status.trim() !== '' ? status.trim() : undefined;

  const [total, rows] = await Promise.all([
    countSuppliers(searchTerm, statusTerm),
    fetchSupplierPage(searchTerm, statusTerm, pageSize, offset),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  res.status(200).json({
    data: rows.map(toSupplierListItem),
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
  });
}

/**
 * GET /suppliers/:id — supplier detail with metrics.
 */
async function getSupplierDetailHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const [detail, metrics] = await Promise.all([fetchSupplierDetail(id), fetchSupplierMetrics(id)]);

  if (!detail) {
    throw new NotFoundError('Supplier', id);
  }

  res.status(200).json({
    id: detail.id,
    company_name: resolveCompanyName(detail.company_name_encrypted, detail.company_name),
    registration_number: detail.registration_number,
    tax_id: safeDecrypt(detail.tax_id_encrypted) || detail.tax_id || '',
    contact_email: detail.email,
    contact_name: buildContactName(detail),
    contact_phone: safeDecrypt(detail.phone_encrypted),
    kyc_status: detail.kyc_status,
    risk_tier: detail.risk_tier,
    preferred_payment_method: detail.preferred_payment_method,
    bank_name: detail.bank_name,
    bank_branch: detail.bank_branch,
    sanctions_flag: detail.sanctions_flag,
    created_at: detail.created_at.toISOString(),
    updated_at: detail.updated_at.toISOString(),
    metrics: {
      total_invoices: parseInt(metrics.total_invoices, 10),
      total_face_value: metrics.total_face_value,
      total_funded: metrics.total_funded,
      avg_tenor_days: Math.round(parseFloat(metrics.avg_tenor_days)),
      total_outstanding: metrics.total_outstanding,
    },
  });
}

/**
 * Build a contact display name from encrypted name fields. Falls back to
 * the supplier's company name (decrypted) so the cell is never blank.
 */
function buildContactName(detail: SupplierDetailRow): string {
  const first = safeDecrypt(detail.first_name_encrypted);
  const last = safeDecrypt(detail.last_name_encrypted);
  const fullName = `${first} ${last}`.trim();
  return fullName || resolveCompanyName(detail.company_name_encrypted, detail.company_name);
}

/**
 * GET /suppliers/:id/buyers — delegate to auth handler.
 * Rewrites param name from :id to :supplier_id.
 */
async function supplierBuyersProxy(req: Request, res: Response): Promise<void> {
  req.params.supplier_id = req.params.id;
  await listSupplierBuyersHandler(req, res, () => {});
}

/**
 * GET /suppliers/:id/payments — returns paginated payments for a supplier.
 */
async function supplierPaymentsHandler(
  req: Request,
  res: Response,
  next: (err?: unknown) => void,
): Promise<void> {
  try {
    const supplierId = req.params.id;
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.page_size as string, 10) || 20;

    if (req.user!.role === 'supplier' && req.user!.userId !== supplierId) {
      throw new ForbiddenError('Access denied');
    }

    const { rows, total } = await getPaymentsBySupplierId(supplierId, page, pageSize);
    const totalPages = Math.ceil(total / pageSize);

    res.status(200).json({
      data: rows,
      total,
      page,
      page_size: pageSize,
      total_pages: totalPages,
    });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// Route registration
// =========================================================================

const staffRoles = ['credit_officer', 'finance_manager', 'management', 'compliance_officer'];

suppliersFacadeRouter.get(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard(staffRoles),
  validate(listSuppliersSchema),
  asyncHandler(listSuppliersHandler),
);

suppliersFacadeRouter.get(
  '/:id',
  asyncHandler(authenticateJwt),
  createRoleGuard([...staffRoles, 'supplier']),
  validate(supplierIdSchema),
  asyncHandler(getSupplierDetailHandler),
);

suppliersFacadeRouter.get(
  '/:id/buyers',
  asyncHandler(authenticateJwt),
  createRoleGuard([...staffRoles, 'supplier']),
  validate(supplierBuyersSchema),
  asyncHandler(supplierBuyersProxy),
);

suppliersFacadeRouter.get(
  '/:id/payments',
  asyncHandler(authenticateJwt),
  createRoleGuard([...staffRoles, 'supplier']),
  validate(supplierPaymentsSchema),
  asyncHandler(supplierPaymentsHandler),
);

export { suppliersFacadeRouter };
