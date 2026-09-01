// =============================================================================
// Dashboard — Repository (all SQL lives here, parameterised queries only)
// =============================================================================

import { query } from '../../shared/database/pool';
import type {
  DashboardSummary,
  DashboardPeriod,
  DashboardStats,
  DashboardTrends,
  InvoiceStatusBreakdownItem,
  PaymentMethodBreakdownItem,
  TrendDataPoint,
  EscalationOverview,
  RecentActivityItem,
  PaymentHistoryRecord,
  PaymentHistorySummary,
  PaymentMethodBreakdown,
  PaymentHistoryFilters,
  DashboardPaymentFilters,
  ApprovalQueueItem,
  FundingPipelineItem,
  SupplierDashboardSummary,
  SupplierRecentPayment,
  SarFlaggedItem,
  Tier3EscalationItem,
  RiskDistributionEntry,
} from './dashboard.types';

// ---------------------------------------------------------------------------
// Dashboard summary
// ---------------------------------------------------------------------------

/**
 * Build a date filter clause for the period parameter.
 * Returns { clause, params, nextIdx } to append to queries.
 */
function buildPeriodFilter(
  period: DashboardPeriod,
  columnName: string,
  startIdx: number,
): { clause: string; params: unknown[]; nextIdx: number } {
  if (period === 'all') {
    return { clause: '', params: [], nextIdx: startIdx };
  }
  const intervalMap: Record<string, string> = {
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
    '12m': '12 months',
  };
  const interval = intervalMap[period];
  return {
    clause: ` AND ${columnName} >= NOW() - $${startIdx}::interval`,
    params: [interval],
    nextIdx: startIdx + 1,
  };
}

/**
 * Compute the previous period of equal length given a period.
 * Used to drive period-over-period delta calculations on trends.*.
 * Returns null for 'all' since there is no prior comparison range.
 */
function previousPeriodInterval(period: DashboardPeriod): string | null {
  const map: Record<string, string> = {
    '7d': '14 days',
    '30d': '60 days',
    '90d': '180 days',
    '12m': '24 months',
  };
  return period === 'all' ? null : map[period];
}

/** Aggregate stats query — one pass over invoices, plus a collected sum and a facility count. */
async function fetchStats(
  supplierId: string | null,
  period: DashboardPeriod,
): Promise<DashboardStats> {
  const pf = buildPeriodFilter(period, 'i.created_at', 2);
  const ownerFilter = supplierId !== null ? ' AND i.supplier_id = $1' : ' AND $1 = $1';

  const r = await query<{
    total_invoices: string;
    total_face_value: string;
    total_funded: string;
    overdue_count: string;
    overdue_amount: string;
    avg_tenor_days: string;
    total_collected: string;
  }>(
    `SELECT
       COUNT(*)::text AS total_invoices,
       COALESCE(SUM(i.face_value), 0)::text AS total_face_value,
       COALESCE(SUM(i.advance_amount) FILTER (
         WHERE i.status IN ('funded','collecting','overdue','collected')
       ), 0)::text AS total_funded,
       COUNT(*) FILTER (
         WHERE i.status = 'overdue'
            OR (i.due_date < CURRENT_DATE
                AND i.status = 'collecting')
       )::text AS overdue_count,
       COALESCE(SUM(i.face_value) FILTER (
         WHERE i.status = 'overdue'
            OR (i.due_date < CURRENT_DATE
                AND i.status = 'collecting')
       ), 0)::text AS overdue_amount,
       COALESCE(AVG(
         (i.due_date - i.created_at::date)
       )::integer, 0)::text AS avg_tenor_days,
       (SELECT COALESCE(SUM(cp.amount), 0)::text
          FROM collection_payments cp
          JOIN collections c ON c.id = cp.collection_id
          JOIN invoices ii ON ii.id = c.invoice_id
         WHERE 1=1
           ${supplierId !== null ? 'AND ii.supplier_id = $1' : 'AND $1 = $1'}
           ${pf.clause.replace(/i\./g, 'ii.')}
       ) AS total_collected
     FROM invoices i
     WHERE 1=1${ownerFilter}${pf.clause}`,
    [supplierId ?? 'all', ...pf.params],
  );

  const facilities = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM bank_facilities WHERE is_active = true`,
    [],
  );

  const row = r.rows[0];
  const totalFace = Number(row.total_face_value);
  const totalCollected = Number(row.total_collected);
  const collectionRate = totalFace > 0 ? Math.round((totalCollected / totalFace) * 10000) / 100 : 0;

  return {
    total_invoices: Number(row.total_invoices),
    total_face_value: totalFace,
    total_funded: Number(row.total_funded),
    collection_rate: collectionRate,
    overdue_count: Number(row.overdue_count),
    overdue_amount: Number(row.overdue_amount),
    avg_tenor_days: Number(row.avg_tenor_days),
    active_facilities: Number(facilities.rows[0].count),
  };
}

/** Period-over-period delta percentages. Returns zeros for period='all'. */
async function fetchTrends(
  supplierId: string | null,
  period: DashboardPeriod,
  current: DashboardStats,
): Promise<DashboardTrends> {
  const previous = previousPeriodInterval(period);
  if (previous === null) {
    return {
      total_face_value_change: 0,
      total_funded_change: 0,
      collection_rate_change: 0,
      overdue_amount_change: 0,
    };
  }
  const ownerFilter = supplierId !== null ? ' AND i.supplier_id = $1' : ' AND $1 = $1';
  const r = await query<{
    prev_face_value: string;
    prev_funded: string;
    prev_overdue_amount: string;
    prev_collected: string;
  }>(
    `SELECT
       COALESCE(SUM(i.face_value), 0)::text AS prev_face_value,
       COALESCE(SUM(i.advance_amount) FILTER (
         WHERE i.status IN ('funded','collecting','overdue','collected')
       ), 0)::text AS prev_funded,
       COALESCE(SUM(i.face_value) FILTER (
         WHERE i.status = 'overdue'
       ), 0)::text AS prev_overdue_amount,
       (SELECT COALESCE(SUM(cp.amount), 0)::text
          FROM collection_payments cp
          JOIN collections c ON c.id = cp.collection_id
          JOIN invoices ii ON ii.id = c.invoice_id
         WHERE ii.created_at >= NOW() - $2::interval
           AND ii.created_at < NOW() - $3::interval
           ${supplierId !== null ? 'AND ii.supplier_id = $1' : 'AND $1 = $1'}
       ) AS prev_collected
     FROM invoices i
     WHERE 1=1${ownerFilter}
       AND i.created_at >= NOW() - $2::interval
       AND i.created_at < NOW() - $3::interval`,
    [supplierId ?? 'all', previous, periodAsInterval(period)],
  );

  const row = r.rows[0];
  const prevFace = Number(row.prev_face_value);
  const prevFunded = Number(row.prev_funded);
  const prevOverdue = Number(row.prev_overdue_amount);
  const prevCollected = Number(row.prev_collected);
  const prevRate = prevFace > 0 ? Math.round((prevCollected / prevFace) * 10000) / 100 : 0;

  return {
    total_face_value_change: pctChange(current.total_face_value, prevFace),
    total_funded_change: pctChange(current.total_funded, prevFunded),
    collection_rate_change: Math.round((current.collection_rate - prevRate) * 100) / 100,
    overdue_amount_change: pctChange(current.overdue_amount, prevOverdue),
  };
}

function periodAsInterval(period: DashboardPeriod): string {
  const map: Record<string, string> = {
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
    '12m': '12 months',
  };
  return map[period] ?? '0 days';
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

/** Daily/monthly time series of funded vs collected vs overdue amounts. */
async function fetchTrendData(
  supplierId: string | null,
  period: DashboardPeriod,
): Promise<TrendDataPoint[]> {
  const monthly = period === '12m' || period === 'all';
  const trunc = monthly ? 'month' : 'day';
  const fmt = monthly ? 'YYYY-MM' : 'YYYY-MM-DD';
  const pf = buildPeriodFilter(period, 'i.created_at', 2);
  const ownerFilter = supplierId !== null ? ' AND i.supplier_id = $1' : ' AND $1 = $1';

  const r = await query<{ date: string; funded: string; collected: string; overdue: string }>(
    `SELECT
       to_char(date_trunc('${trunc}', i.created_at), '${fmt}') AS date,
       COALESCE(SUM(i.advance_amount) FILTER (
         WHERE i.status IN ('funded','collecting','overdue','collected')
       ), 0)::text AS funded,
       COALESCE(SUM(i.advance_amount) FILTER (
         WHERE i.status = 'collected'
       ), 0)::text AS collected,
       COALESCE(SUM(i.face_value) FILTER (
         WHERE i.status = 'overdue'
       ), 0)::text AS overdue
     FROM invoices i
     WHERE 1=1${ownerFilter}${pf.clause}
     GROUP BY date_trunc('${trunc}', i.created_at)
     ORDER BY date_trunc('${trunc}', i.created_at) ASC`,
    [supplierId ?? 'all', ...pf.params],
  );

  return r.rows.map((row) => ({
    date: row.date,
    funded: Number(row.funded),
    collected: Number(row.collected),
    overdue: Number(row.overdue),
  }));
}

/** GROUP BY status — count + face_value sum. */
async function fetchStatusBreakdown(
  supplierId: string | null,
  period: DashboardPeriod,
): Promise<InvoiceStatusBreakdownItem[]> {
  const pf = buildPeriodFilter(period, 'i.created_at', 2);
  const ownerFilter = supplierId !== null ? ' AND i.supplier_id = $1' : ' AND $1 = $1';
  const r = await query<{ status: string; count: string; amount: string }>(
    `SELECT i.status,
            COUNT(*)::text AS count,
            COALESCE(SUM(i.face_value), 0)::text AS amount
     FROM invoices i
     WHERE 1=1${ownerFilter}${pf.clause}
     GROUP BY i.status
     ORDER BY count DESC`,
    [supplierId ?? 'all', ...pf.params],
  );
  return r.rows.map((row) => ({
    status: row.status,
    count: Number(row.count),
    amount: Number(row.amount),
  }));
}

/** GROUP BY payment provider — count + sum of funded amounts. */
async function fetchPaymentMethodBreakdown(
  supplierId: string | null,
  period: DashboardPeriod,
): Promise<PaymentMethodBreakdownItem[]> {
  const pf = buildPeriodFilter(period, 'p.funded_at', 2);
  const ownerFilter = supplierId !== null ? ' AND i.supplier_id = $1' : ' AND $1 = $1';
  const r = await query<{ method: string; count: string; amount: string }>(
    `SELECT p.provider AS method,
            COUNT(*)::text AS count,
            COALESCE(SUM(p.amount), 0)::text AS amount
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE p.status = 'funded'${ownerFilter}${pf.clause}
     GROUP BY p.provider
     ORDER BY count DESC`,
    [supplierId ?? 'all', ...pf.params],
  );

  const labels: Record<string, string> = {
    EFT: 'EFT / RTGS',
    EFT_RTGS: 'EFT / RTGS',
  };
  return r.rows.map((row) => ({
    method: row.method,
    label: labels[row.method] ?? row.method,
    count: Number(row.count),
    amount: Number(row.amount),
  }));
}

/** Aggregate collection escalation levels into the named overview buckets. */
async function fetchEscalationOverview(supplierId: string | null): Promise<EscalationOverview> {
  const ownerFilter = supplierId !== null ? ' AND i.supplier_id = $1' : ' AND $1 = $1';
  const r = await query<{ escalation_level: number; count: string }>(
    `SELECT c.escalation_level, COUNT(*)::text AS count
     FROM collections c
     JOIN invoices i ON i.id = c.invoice_id
     WHERE 1=1${ownerFilter}
     GROUP BY c.escalation_level`,
    [supplierId ?? 'all'],
  );
  const out: EscalationOverview = { none: 0, reminder: 0, formal: 0, legal: 0 };
  for (const row of r.rows) {
    const c = Number(row.count);
    if (row.escalation_level === 0) out.none = c;
    else if (row.escalation_level === 1) out.reminder = c;
    else if (row.escalation_level === 2) out.formal = c;
    else if (row.escalation_level >= 3) out.legal += c;
  }
  return out;
}

/** UNION ALL of the latest 10 events across invoices, payments, collections. */
async function fetchRecentActivity(supplierId: string | null): Promise<RecentActivityItem[]> {
  const ownerFilter = supplierId !== null ? ' AND i.supplier_id = $1' : ' AND $1 = $1';
  const r = await query<{
    id: string;
    type: RecentActivityItem['type'];
    description: string;
    amount: string | null;
    timestamp: string;
    invoice_id: string | null;
    status: string | null;
  }>(
    `SELECT id, type, description, amount, timestamp, invoice_id, status
     FROM (
       (
         SELECT i.id::text AS id,
                'invoice_funded'::text AS type,
                ('Invoice ' || i.invoice_number || ' funded') AS description,
                i.advance_amount::text AS amount,
                i.funded_at::text AS timestamp,
                i.id::text AS invoice_id,
                i.status::text AS status
           FROM invoices i
          WHERE i.funded_at IS NOT NULL${ownerFilter}
          ORDER BY i.funded_at DESC LIMIT 5
       )
       UNION ALL
       (
         SELECT cp.id::text AS id,
                'collection_received'::text AS type,
                ('Collection received for ' || i.invoice_number) AS description,
                cp.amount::text AS amount,
                cp.paid_at::text AS timestamp,
                i.id::text AS invoice_id,
                c.status::text AS status
           FROM collection_payments cp
           JOIN collections c ON c.id = cp.collection_id
           JOIN invoices i ON i.id = c.invoice_id
          WHERE 1=1${ownerFilter}
          ORDER BY cp.paid_at DESC LIMIT 5
       )
     ) AS combined
     ORDER BY timestamp DESC NULLS LAST
     LIMIT 10`,
    [supplierId ?? 'all'],
  );
  return r.rows.map((row) => ({
    id: row.id,
    type: row.type,
    description: row.description,
    amount: row.amount === null ? null : Number(row.amount),
    timestamp: row.timestamp,
    invoice_id: row.invoice_id,
    status: row.status,
  }));
}

/**
 * Fetch the rich dashboard summary — composes 7 parallel aggregate queries.
 * Returns the nested shape consumed directly by the frontend (after the
 * controller wrap and the deepCamelCase axios interceptor).
 */
export async function getDashboardSummary(
  supplierId: string | null,
  period: DashboardPeriod,
): Promise<DashboardSummary> {
  const stats = await fetchStats(supplierId, period);
  const [trends, trendData, statusBreakdown, methodBreakdown, escalations, activity] =
    await Promise.all([
      fetchTrends(supplierId, period, stats),
      fetchTrendData(supplierId, period),
      fetchStatusBreakdown(supplierId, period),
      fetchPaymentMethodBreakdown(supplierId, period),
      fetchEscalationOverview(supplierId),
      fetchRecentActivity(supplierId),
    ]);

  return {
    period,
    cached_at: new Date().toISOString(),
    stats,
    trends,
    invoice_status_breakdown: statusBreakdown,
    payment_method_breakdown: methodBreakdown,
    trend_data: trendData,
    escalation_overview: escalations,
    recent_activity: activity,
  };
}

// ---------------------------------------------------------------------------
// Payment history
// ---------------------------------------------------------------------------

/**
 * Fetch paginated payment history for a supplier.
 * Uses parameterised dynamic WHERE clauses.
 */
export async function getPaymentHistory(
  filters: PaymentHistoryFilters,
): Promise<{ data: PaymentHistoryRecord[]; total: number }> {
  const conditions: string[] = ['p.status = $1'];
  const params: unknown[] = ['funded'];
  let idx = 2;

  conditions.push(
    `i.supplier_id = (SELECT id FROM suppliers WHERE user_id = $${idx} OR id = $${idx} LIMIT 1)`,
  );
  params.push(filters.supplierId);
  idx++;

  if (filters.from !== undefined) {
    conditions.push(`p.funded_at >= $${idx}`);
    params.push(filters.from);
    idx++;
  }
  if (filters.to !== undefined) {
    conditions.push(`p.funded_at <= $${idx}`);
    params.push(filters.to);
    idx++;
  }
  if (filters.method !== undefined) {
    conditions.push(`p.provider = $${idx}`);
    params.push(filters.method);
    idx++;
  }
  if (filters.minAmount !== undefined) {
    conditions.push(`p.amount >= $${idx}`);
    params.push(filters.minAmount);
    idx++;
  }

  const whereClause = conditions.join(' AND ');
  const sortCol = filters.sort === 'amount' ? 'p.amount' : 'p.funded_at';
  const sortOrder = filters.order === 'asc' ? 'ASC' : 'DESC';

  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const offset = (page - 1) * limit;

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE ${whereClause}`,
    params,
  );

  const dataResult = await query<PaymentHistoryRecord>(
    `SELECT p.id, p.invoice_id, i.invoice_number,
            p.amount, p.provider, p.status,
            p.funded_at, p.created_at
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE ${whereClause}
     ORDER BY ${sortCol} ${sortOrder}
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  return {
    data: dataResult.rows,
    total: Number(countResult.rows[0].total),
  };
}

/**
 * Fetch payment summary for a supplier.
 */
export async function getPaymentSummary(supplierId: string): Promise<PaymentHistorySummary> {
  const summaryResult = await query<{
    total_paid: string;
    payment_count: string;
    last_payment_date: string | null;
  }>(
    `SELECT
       COALESCE(SUM(p.amount), 0)::text AS total_paid,
       COUNT(*)::text AS payment_count,
       MAX(p.funded_at)::text AS last_payment_date
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE p.status = $1
       AND i.supplier_id = (SELECT id FROM suppliers WHERE user_id = $2 OR id = $2 LIMIT 1)`,
    ['funded', supplierId],
  );

  const breakdownResult = await query<PaymentMethodBreakdown>(
    `SELECT
       p.provider AS method,
       COUNT(*)::integer AS count,
       COALESCE(SUM(p.amount), 0)::text AS total
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE p.status = $1
       AND i.supplier_id = (SELECT id FROM suppliers WHERE user_id = $2 OR id = $2 LIMIT 1)
     GROUP BY p.provider`,
    ['funded', supplierId],
  );

  const s = summaryResult.rows[0];
  return {
    total_paid: s.total_paid,
    payment_count: Number(s.payment_count),
    last_payment_date: s.last_payment_date,
    by_method: breakdownResult.rows,
  };
}

// ---------------------------------------------------------------------------
// Dashboard payment history (broader filters, no supplier_id required)
// ---------------------------------------------------------------------------

/** Build WHERE conditions for dashboard payment filters. */
function buildPaymentConditions(filters: DashboardPaymentFilters): {
  conditions: string[];
  params: unknown[];
  nextIdx: number;
} {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.status !== undefined) {
    conditions.push(`p.status = $${idx}`);
    params.push(filters.status);
    idx++;
  }
  if (filters.method !== undefined) {
    conditions.push(`p.provider = $${idx}`);
    params.push(filters.method);
    idx++;
  }
  if (filters.direction !== undefined) {
    conditions.push(`p.direction = $${idx}`);
    params.push(filters.direction);
    idx++;
  }
  if (filters.from !== undefined) {
    conditions.push(`p.created_at >= $${idx}`);
    params.push(filters.from);
    idx++;
  }
  if (filters.to !== undefined) {
    conditions.push(`p.created_at <= $${idx}`);
    params.push(filters.to);
    idx++;
  }

  return { conditions, params, nextIdx: idx };
}

/**
 * Fetch paginated dashboard payment history.
 * Accessible to finance_manager, management, credit_officer roles.
 */
export async function getDashboardPayments(
  filters: DashboardPaymentFilters,
): Promise<{ data: PaymentHistoryRecord[]; total: number }> {
  const { conditions, params, nextIdx } = buildPaymentConditions(filters);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = (page - 1) * limit;

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     ${where}`,
    params,
  );

  const dataResult = await query<PaymentHistoryRecord>(
    `SELECT p.id, p.invoice_id, i.invoice_number,
            p.amount, p.provider, p.status,
            p.funded_at, p.created_at
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
    [...params, limit, offset],
  );

  return {
    data: dataResult.rows,
    total: Number(countResult.rows[0].total),
  };
}

// ---------------------------------------------------------------------------
// Approval queue — top 5 invoices awaiting auth
// ---------------------------------------------------------------------------

/**
 * Fetch top 5 invoices awaiting authorisation.
 * Returns invoices in pending_first_auth or pending_second_auth status.
 */
export async function getApprovalQueue(): Promise<ApprovalQueueItem[]> {
  const result = await query<ApprovalQueueItem>(
    `SELECT i.id,
            i.invoice_number AS invoice_ref,
            s.company_name   AS supplier_name,
            b.company_name   AS buyer_name,
            i.face_value::text AS face_value,
            i.created_at::text AS submitted_at,
            i.status,
            CASE
              WHEN rs.final_score IS NULL THEN 'unscored'
              WHEN rs.final_score < 40    THEN 'critical'
              WHEN rs.final_score < 60    THEN 'high'
              WHEN rs.final_score < 75    THEN 'medium'
              ELSE 'low'
            END AS risk_level
     FROM invoices i
     JOIN suppliers s ON s.id = i.supplier_id
     JOIN buyers    b ON b.id = i.buyer_id
     LEFT JOIN risk_scores rs ON rs.invoice_id = i.id
     WHERE i.status IN ('pending_first_auth', 'pending_second_auth')
     ORDER BY i.created_at ASC
     LIMIT 5`,
    [],
  );

  return result.rows;
}

// ---------------------------------------------------------------------------
// Funding pipeline — approved invoices waiting to be funded
// ---------------------------------------------------------------------------

/**
 * Fetch approved invoices pending funding disbursement.
 */
export async function getFundingPipeline(): Promise<FundingPipelineItem[]> {
  const result = await query<FundingPipelineItem>(
    `SELECT i.id,
            i.invoice_number       AS invoice_ref,
            s.company_name         AS supplier_name,
            b.company_name         AS buyer_name,
            i.face_value::text     AS face_value,
            i.advance_amount::text AS advance_amount,
            i.updated_at::text     AS approved_at,
            COALESCE(s.preferred_payment_method, 'EFT') AS payment_method
     FROM invoices i
     JOIN suppliers s ON s.id = i.supplier_id
     JOIN buyers    b ON b.id = i.buyer_id
     WHERE i.status = 'approved'
     ORDER BY i.updated_at ASC`,
    [],
  );

  return result.rows;
}

// ---------------------------------------------------------------------------
// Supplier-specific dashboard
// ---------------------------------------------------------------------------

/** Fetch supplier dashboard stats — matches frontend SupplierDashboardStats shape. */
export async function getSupplierStats(
  supplierId: string,
  period: DashboardPeriod,
): Promise<SupplierDashboardSummary['stats']> {
  const pf = buildPeriodFilter(period, 'i.created_at', 2);

  const result = await query<{
    total_submitted: string;
    total_funded: string;
    outstanding_amount: string;
    overdue_count: string;
    avg_payment_days: string;
  }>(
    `SELECT
       COUNT(*)::text AS total_submitted,
       COALESCE(SUM(i.advance_amount) FILTER (
         WHERE i.status IN ('funded','collecting','collected','overdue')
       ), 0)::text AS total_funded,
       COALESCE(SUM(i.face_value) FILTER (
         WHERE i.status IN ('funded','collecting','overdue')
       ), 0)::text AS outstanding_amount,
       COUNT(*) FILTER (
         WHERE i.status = 'overdue'
            OR (i.due_date < CURRENT_DATE
                AND i.status = 'collecting')
       )::text AS overdue_count,
       COALESCE(AVG(
         CASE WHEN i.funded_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (i.funded_at - i.created_at)) / 86400
         ELSE NULL END
       )::integer, 0)::text AS avg_payment_days
     FROM invoices i
     WHERE i.supplier_id = $1${pf.clause}`,
    [supplierId, ...pf.params],
  );

  const s = result.rows[0];
  return {
    total_submitted: Number(s.total_submitted),
    total_funded: Number(s.total_funded),
    outstanding_amount: Number(s.outstanding_amount),
    overdue_count: Number(s.overdue_count),
    avg_payment_days: Number(s.avg_payment_days),
  };
}

/** Fetch supplier invoice status breakdown — count + amount per status. */
export async function getSupplierStatusBreakdown(
  supplierId: string,
): Promise<InvoiceStatusBreakdownItem[]> {
  const result = await query<{ status: string; count: string; amount: string }>(
    `SELECT i.status,
            COUNT(*)::text AS count,
            COALESCE(SUM(i.face_value), 0)::text AS amount
     FROM invoices i
     WHERE i.supplier_id = $1
     GROUP BY i.status
     ORDER BY count DESC`,
    [supplierId],
  );
  return result.rows.map((r) => ({
    status: r.status,
    count: Number(r.count),
    amount: Number(r.amount),
  }));
}

/** Fetch supplier recent payments (last 10). */
export async function getSupplierRecentPayments(
  supplierId: string,
): Promise<SupplierRecentPayment[]> {
  const result = await query<SupplierRecentPayment>(
    `SELECT p.id,
            i.invoice_number AS invoice_ref,
            p.amount::text   AS amount,
            p.funded_at::text AS funded_at,
            p.provider
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE i.supplier_id = $1 AND p.status = 'funded'
     ORDER BY p.funded_at DESC NULLS LAST
     LIMIT 10`,
    [supplierId],
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Legal dashboard — SAR flagged + tier 3 escalations
// ---------------------------------------------------------------------------

/** Fetch SAR flagged invoices for legal dashboard. */
export async function getSarFlaggedItems(): Promise<{
  count: number;
  totalAmount: string;
  items: SarFlaggedItem[];
}> {
  const result = await query<SarFlaggedItem & { total_count: string; total_amount: string }>(
    `SELECT i.id,
            i.invoice_number  AS invoice_ref,
            s.company_name    AS supplier_name,
            b.company_name    AS buyer_name,
            i.face_value::text AS face_value,
            i.updated_at::text AS aml_flagged_at,
            i.status,
            COUNT(*) OVER()::text AS total_count,
            COALESCE(SUM(i.face_value) OVER(), 0)::text AS total_amount
     FROM invoices i
     JOIN suppliers s ON s.id = i.supplier_id
     JOIN buyers    b ON b.id = i.buyer_id
     WHERE i.aml_flagged = true
     ORDER BY i.updated_at DESC`,
    [],
  );

  if (result.rows.length === 0) {
    return { count: 0, totalAmount: '0', items: [] };
  }

  return {
    count: Number(result.rows[0].total_count),
    totalAmount: result.rows[0].total_amount,
    items: result.rows.map((r) => ({
      id: r.id,
      invoice_ref: r.invoice_ref,
      supplier_name: r.supplier_name,
      buyer_name: r.buyer_name,
      face_value: r.face_value,
      aml_flagged_at: r.aml_flagged_at,
      status: r.status,
    })),
  };
}

/** Fetch tier 3 collection escalations for legal dashboard. */
export async function getTier3Escalations(): Promise<Tier3EscalationItem[]> {
  const result = await query<Tier3EscalationItem>(
    `SELECT i.id,
            i.invoice_number     AS invoice_ref,
            s.company_name       AS supplier_name,
            b.company_name       AS buyer_name,
            i.face_value::text   AS face_value,
            c.escalation_level AS escalation_tier,
            c.escalation_date::text AS escalated_at
     FROM collections c
     JOIN invoices  i ON i.id = c.invoice_id
     JOIN suppliers s ON s.id = i.supplier_id
     JOIN buyers    b ON b.id = i.buyer_id
     WHERE c.escalation_level >= 3
     ORDER BY c.escalation_date DESC NULLS LAST`,
    [],
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Risk distribution
// ---------------------------------------------------------------------------

/**
 * Group invoices by risk level derived from risk_scores.final_score.
 * critical (<40), high (40-59), medium (60-74), low (>=75).
 */
export async function getRiskDistribution(
  period: DashboardPeriod,
): Promise<RiskDistributionEntry[]> {
  const pf = buildPeriodFilter(period, 'i.created_at', 1);

  const result = await query<RiskDistributionEntry>(
    `SELECT
       CASE
         WHEN rs.final_score < 40 THEN 'critical'
         WHEN rs.final_score < 60 THEN 'high'
         WHEN rs.final_score < 75 THEN 'medium'
         ELSE 'low'
       END AS risk_level,
       COUNT(*)::integer AS count,
       COALESCE(SUM(i.face_value), 0)::text AS amount
     FROM invoices i
     JOIN risk_scores rs ON rs.invoice_id = i.id
     WHERE 1=1${pf.clause}
     GROUP BY risk_level
     ORDER BY count DESC`,
    [...pf.params],
  );

  return result.rows;
}

// ---------------------------------------------------------------------------
// Supplier ID lookup
// ---------------------------------------------------------------------------

/** Look up supplier record ID from user ID. */
export async function getSupplierIdByUserId(userId: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT id FROM suppliers WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return result.rows.length > 0 ? result.rows[0].id : null;
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

/**
 * Insert audit log entry for dashboard actions.
 */
export async function createAuditEntry(
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      action,
      tableName,
      recordId,
      JSON.stringify(oldValues),
      JSON.stringify(newValues),
      ipAddress ?? null,
      userAgent ?? null,
    ],
  );
}
