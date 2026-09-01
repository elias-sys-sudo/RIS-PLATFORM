import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { query } from '../../shared/database/pool';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { authenticateJwt } from '../../shared/middleware/auth.middleware';
import { createRoleGuard } from '../../shared/middleware/role.middleware';
import { validate } from '../../shared/middleware/validate';
import * as onboardingService from './onboarding.service';
import type { BuyerCreation } from './onboarding.types';

const buyersFacadeRouter = Router();

// =========================================================================
// Types
// =========================================================================

interface BuyerRow {
  id: string;
  company_name: string;
  credit_rating: string;
  approved_limit: string;
  used_limit: string;
  ris_margin_rate: string;
  payment_score: number;
  is_active: boolean;
  created_at: Date;
}

interface BuyerListItem {
  id: string;
  name: string;
  credit_rating: string;
  credit_limit: string;
  used_limit: string;
  payment_score: number;
  is_active: boolean;
  created_at: string;
}

// =========================================================================
// Validation
// =========================================================================

const listBuyersSchema = {
  query: Joi.object({
    search: Joi.string().max(255).optional().allow(''),
    page: Joi.number().integer().min(1).default(1),
    page_size: Joi.number().integer().min(1).max(100).default(20),
  }),
};

// =========================================================================
// Handlers
// =========================================================================

/**
 * Map a raw buyer DB row to the API response shape.
 */
function toBuyerListItem(row: BuyerRow): BuyerListItem {
  return {
    id: row.id,
    name: row.company_name,
    credit_rating: row.credit_rating,
    credit_limit: row.approved_limit,
    used_limit: row.used_limit,
    payment_score: row.payment_score,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Count buyers matching an optional search filter.
 */
async function countBuyers(search?: string): Promise<number> {
  if (search !== undefined && search !== '') {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM buyers
       WHERE company_name ILIKE $1`,
      [`%${search}%`],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }
  const result = await query<{ count: string }>(`SELECT COUNT(*) AS count FROM buyers`, []);
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Fetch a page of buyers with optional search filter.
 */
async function fetchBuyers(
  search: string | undefined,
  limit: number,
  offset: number,
): Promise<BuyerRow[]> {
  if (search !== undefined && search !== '') {
    const result = await query<BuyerRow>(
      `SELECT id, company_name, credit_rating, approved_limit,
              used_limit, ris_margin_rate, payment_score,
              is_active, created_at
       FROM buyers
       WHERE company_name ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [`%${search}%`, limit, offset],
    );
    return result.rows;
  }
  const result = await query<BuyerRow>(
    `SELECT id, company_name, credit_rating, approved_limit,
            used_limit, ris_margin_rate, payment_score,
            is_active, created_at
     FROM buyers
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

/**
 * GET /buyers — list buyers with optional search.
 */
async function listBuyersHandler(req: Request, res: Response): Promise<void> {
  const search = req.query.search as string | undefined;
  const page = parseInt(req.query.page as string, 10) || 1;
  const pageSize = parseInt(req.query.page_size as string, 10) || 20;
  const offset = (page - 1) * pageSize;

  const searchTerm = search !== undefined && search.trim() !== '' ? search.trim() : undefined;

  const [total, rows] = await Promise.all([
    countBuyers(searchTerm),
    fetchBuyers(searchTerm, pageSize, offset),
  ]);

  res.status(200).json({
    data: rows.map(toBuyerListItem),
    total,
  });
}

// =========================================================================
// Create-buyer (FE-friendly shape)
// =========================================================================
//
// The canonical create endpoint is POST /onboarding/admin/buyers, which
// validates the strict risk-engine fields (registration_number,
// credit_rating, payment_score, ris_margin_rate). The FE buyer-create form,
// however, captures only a simpler operator-facing shape — name, industry,
// credit limit, payment terms, contact details. This adapter accepts that
// shape, fills sensible defaults for the missing risk fields, and delegates
// to the same onboardingService.createBuyer used by the strict route.

const createBuyerFriendlySchema = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(255).required(),
    industry: Joi.string().trim().max(100).optional().allow(''),
    credit_limit: Joi.number().integer().min(1_000_000).required(),
    payment_terms_days: Joi.number().integer().min(7).max(120).optional(),
    contact_person: Joi.string().trim().max(255).optional().allow(''),
    contact_email: Joi.string().email().required().max(255),
    contact_phone: Joi.string().trim().max(20).required(),
    registration_number: Joi.string().trim().max(100).optional(),
    credit_rating: Joi.string().valid('A', 'B', 'C', 'D').optional(),
    payment_score: Joi.number().integer().min(0).max(100).optional(),
  }),
};

interface CreateBuyerFriendlyBody {
  name: string;
  industry?: string;
  credit_limit: number;
  payment_terms_days?: number;
  contact_person?: string;
  contact_email: string;
  contact_phone: string;
  registration_number?: string;
  credit_rating?: 'A' | 'B' | 'C' | 'D';
  payment_score?: number;
}

/**
 * Generate a deterministic, unique fallback registration number when the
 * operator didn't supply one. Slug from the company name plus a short
 * timestamp suffix keeps it human-readable and unique enough for non-prod.
 */
function autoRegistrationNumber(companyName: string): string {
  const slug = companyName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 24);
  const stamp = Date.now().toString(36).toUpperCase();
  return `AUTO-${slug || 'BUYER'}-${stamp}`;
}

async function createBuyerFriendlyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as CreateBuyerFriendlyBody;
    const createdBy = req.user?.userId ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const payload: BuyerCreation = {
      company_name: body.name,
      registration_number: body.registration_number ?? autoRegistrationNumber(body.name),
      credit_rating: body.credit_rating ?? 'B',
      approved_limit: body.credit_limit,
      payment_score: body.payment_score ?? 50,
      contact_email: body.contact_email,
      contact_phone: body.contact_phone,
    };

    const result = await onboardingService.createBuyer(payload, createdBy, ip, ua);
    res.status(201).json({
      buyerId: result.buyerId,
      message: 'Buyer created successfully',
    });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// Route registration
// =========================================================================

buyersFacadeRouter.get(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard(['supplier', 'credit_officer', 'finance_manager', 'management']),
  validate(listBuyersSchema),
  asyncHandler(listBuyersHandler),
);

buyersFacadeRouter.post(
  '/',
  asyncHandler(authenticateJwt),
  createRoleGuard(['credit_officer', 'management']),
  validate(createBuyerFriendlySchema),
  asyncHandler(createBuyerFriendlyHandler),
);

export { buyersFacadeRouter };
