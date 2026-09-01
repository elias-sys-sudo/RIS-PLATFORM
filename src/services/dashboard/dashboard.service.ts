// =============================================================================
// Dashboard — Service (business logic, caching, audit logging)
// =============================================================================

import { createClient } from 'redis';
import { logger } from '../../shared/logger';
import { ForbiddenError, NotFoundError } from '../../shared/errors';
import * as repo from './dashboard.repository';
import type {
  DashboardPeriod,
  DashboardSummary,
  DashboardPaymentFilters,
  PaymentHistoryFilters,
  PaymentHistoryRecord,
  PaymentHistorySummary,
  PaginationMeta,
  ApprovalQueueItem,
  FundingPipelineItem,
  SupplierDashboardSummary,
  LegalDashboardSummary,
  RiskDistributionEntry,
} from './dashboard.types';

// ---------------------------------------------------------------------------
// Redis client reference (injected from server.ts)
// ---------------------------------------------------------------------------

let redisClient: ReturnType<typeof createClient> | null = null;

/** Set the Redis client for dashboard caching. */
export function setRedisClient(client: ReturnType<typeof createClient>): void {
  redisClient = client;
}

// ---------------------------------------------------------------------------
// In-memory LRU cache fallback
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  cachedAt: string;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry<DashboardSummary>>();
const MAX_CACHE_SIZE = 100;

/** Evict oldest entries when cache exceeds max size. */
function evictIfNeeded(): void {
  if (memoryCache.size <= MAX_CACHE_SIZE) {
    return;
  }
  const oldest = memoryCache.keys().next().value as string;
  memoryCache.delete(oldest);
}

// ---------------------------------------------------------------------------
// Dashboard summary with caching
// ---------------------------------------------------------------------------

/**
 * Get dashboard summary with 5-minute cache per org+period.
 * Tries Redis first, falls back to in-memory LRU cache.
 */
export async function getDashboardSummary(
  userId: string,
  supplierId: string | null,
  period: DashboardPeriod,
  ipAddress: string,
  userAgent: string,
): Promise<DashboardSummary> {
  // v2 prefix invalidates pre-rewrite cached entries (flat shape).
  const cacheKey = `dashboard:summary:v2:${supplierId ?? 'all'}:${period}`;

  const cached = await getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  const summary = await repo.getDashboardSummary(supplierId, period);

  await setInCache(cacheKey, summary);

  await repo.createAuditEntry(
    userId,
    'DASHBOARD_SUMMARY_VIEWED',
    'dashboard',
    cacheKey,
    {},
    { period },
    ipAddress,
    userAgent,
  );

  logger.info('Dashboard summary generated', {
    component: 'dashboard',
    userId,
    period,
  });

  return summary;
}

// ---------------------------------------------------------------------------
// Payment history
// ---------------------------------------------------------------------------

/**
 * Get paginated payment history for a supplier.
 * Validates user access to supplier data.
 */
export async function getPaymentHistory(
  userId: string,
  role: string,
  filters: PaymentHistoryFilters,
  ipAddress: string,
  userAgent: string,
): Promise<{
  data: PaymentHistoryRecord[];
  pagination: PaginationMeta;
  summary: PaymentHistorySummary;
}> {
  validatePaymentAccess(role, filters.supplierId, userId);

  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);

  const { data, total } = await repo.getPaymentHistory({
    ...filters,
    page,
    limit,
  });

  const summary = await repo.getPaymentSummary(filters.supplierId);

  const pagination: PaginationMeta = {
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
  };

  await repo.createAuditEntry(
    userId,
    'PAYMENT_HISTORY_VIEWED',
    'payments',
    filters.supplierId,
    {},
    { period: `${filters.from ?? 'all'} to ${filters.to ?? 'all'}` },
    ipAddress,
    userAgent,
  );

  return { data, pagination, summary };
}

// ---------------------------------------------------------------------------
// Access validation
// ---------------------------------------------------------------------------

/** Validate role-based access to supplier payment data. */
function validatePaymentAccess(role: string, _supplierId: string, _userId: string): void {
  const viewRoles = [
    'finance_manager',
    'management',
    'credit_officer',
    'auditor',
    'legal',
    'compliance_officer',
    'supplier',
  ];

  if (!viewRoles.includes(role)) {
    throw new ForbiddenError(`Role '${role}' cannot access payment history`);
  }
}

// ---------------------------------------------------------------------------
// Dashboard payments (broader filter, all roles)
// ---------------------------------------------------------------------------

/**
 * Get paginated payment history for the dashboard view.
 * Accessible to finance_manager, management, credit_officer.
 */
export async function getDashboardPayments(
  userId: string,
  filters: DashboardPaymentFilters,
  ipAddress: string,
  userAgent: string,
): Promise<{ data: PaymentHistoryRecord[]; pagination: PaginationMeta }> {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);

  const { data, total } = await repo.getDashboardPayments({
    ...filters,
    page,
    limit,
  });

  const pagination: PaginationMeta = {
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
  };

  await repo.createAuditEntry(
    userId,
    'DASHBOARD_PAYMENTS_VIEWED',
    'payments',
    'dashboard',
    {},
    { filters },
    ipAddress,
    userAgent,
  );

  return { data, pagination };
}

// ---------------------------------------------------------------------------
// Approval queue
// ---------------------------------------------------------------------------

/** Get top 5 invoices awaiting auth for dashboard. */
export async function getApprovalQueue(
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<ApprovalQueueItem[]> {
  const items = await repo.getApprovalQueue();

  await repo.createAuditEntry(
    userId,
    'APPROVAL_QUEUE_VIEWED',
    'invoices',
    'dashboard',
    {},
    {},
    ipAddress,
    userAgent,
  );

  logger.info('Approval queue viewed', {
    component: 'dashboard',
    userId,
  });

  return items;
}

// ---------------------------------------------------------------------------
// Funding pipeline
// ---------------------------------------------------------------------------

/** Get approved invoices waiting to be funded. */
export async function getFundingPipeline(
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<FundingPipelineItem[]> {
  const items = await repo.getFundingPipeline();

  await repo.createAuditEntry(
    userId,
    'FUNDING_PIPELINE_VIEWED',
    'invoices',
    'dashboard',
    {},
    {},
    ipAddress,
    userAgent,
  );

  logger.info('Funding pipeline viewed', {
    component: 'dashboard',
    userId,
  });

  return items;
}

// ---------------------------------------------------------------------------
// Supplier dashboard
// ---------------------------------------------------------------------------

/** Get supplier-specific dashboard summary. */
export async function getSupplierSummary(
  userId: string,
  period: DashboardPeriod,
  ipAddress: string,
  userAgent: string,
): Promise<SupplierDashboardSummary> {
  const supplierId = await repo.getSupplierIdByUserId(userId);
  if (supplierId === null) {
    throw new NotFoundError('Supplier', userId);
  }

  const [stats, breakdown, payments] = await Promise.all([
    repo.getSupplierStats(supplierId, period),
    repo.getSupplierStatusBreakdown(supplierId),
    repo.getSupplierRecentPayments(supplierId),
  ]);

  await repo.createAuditEntry(
    userId,
    'SUPPLIER_DASHBOARD_VIEWED',
    'dashboard',
    supplierId,
    {},
    { period },
    ipAddress,
    userAgent,
  );

  return {
    stats,
    invoice_status_breakdown: breakdown,
    recent_payments: payments,
  };
}

// ---------------------------------------------------------------------------
// Legal dashboard
// ---------------------------------------------------------------------------

/** Get SAR flagged invoices and tier 3 escalations. */
export async function getLegalSummary(
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<LegalDashboardSummary> {
  const [sarData, escalations] = await Promise.all([
    repo.getSarFlaggedItems(),
    repo.getTier3Escalations(),
  ]);

  await repo.createAuditEntry(
    userId,
    'LEGAL_DASHBOARD_VIEWED',
    'dashboard',
    'legal',
    {},
    {},
    ipAddress,
    userAgent,
  );

  logger.info('Legal dashboard viewed', {
    component: 'dashboard',
    userId,
  });

  return {
    sar_flagged_count: sarData.count,
    sar_total_amount: sarData.totalAmount,
    sar_items: sarData.items,
    tier3_escalations: escalations,
  };
}

// ---------------------------------------------------------------------------
// Risk distribution
// ---------------------------------------------------------------------------

/** Get risk distribution grouped by risk level. */
export async function getRiskDistribution(
  userId: string,
  period: DashboardPeriod,
  ipAddress: string,
  userAgent: string,
): Promise<RiskDistributionEntry[]> {
  const items = await repo.getRiskDistribution(period);

  await repo.createAuditEntry(
    userId,
    'RISK_DISTRIBUTION_VIEWED',
    'risk_scores',
    'dashboard',
    {},
    { period },
    ipAddress,
    userAgent,
  );

  logger.info('Risk distribution viewed', {
    component: 'dashboard',
    userId,
    period,
  });

  return items;
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

async function getFromCache(key: string): Promise<DashboardSummary | null> {
  if (redisClient) {
    try {
      const cached = await redisClient.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as DashboardSummary;
      }
    } catch {
      // Redis unavailable — fall through to memory cache
    }
  }

  const entry = memoryCache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data;
  }
  if (entry) {
    memoryCache.delete(key);
  }
  return null;
}

async function setInCache(key: string, data: DashboardSummary): Promise<void> {
  const cachedAt = new Date().toISOString();
  const dataWithCache = { ...data, cached_at: cachedAt };

  if (redisClient) {
    try {
      await redisClient.setEx(key, 300, JSON.stringify(dataWithCache));
      return;
    } catch {
      // Redis unavailable — fall through to memory cache
    }
  }

  evictIfNeeded();
  memoryCache.set(key, {
    data: dataWithCache,
    cachedAt,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}
