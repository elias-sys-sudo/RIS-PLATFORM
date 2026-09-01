// =============================================================================
// Reporting — Repository (all SQL lives here, parameterised queries only)
// =============================================================================

import { query } from '../../shared/database/pool';
import { logger } from '../../shared/logger';
import type {
  ReportFilters,
  PortfolioSummary,
  AgingAnalysis,
  BuyerExposure,
  ProfitReport,
  InvoiceProfitRow,
  ProfitSummary,
  FacilityReport,
  FacilityReportRow,
  AuditExport,
  RegulatoryReport,
  ApplicationsReceivedReport,
  ApplicationsPipelineReport,
  IncompleteApplicationRow,
  CompanyPlReport,
  DisbursedFundsReport,
  CtrReport,
  SarStatusReport,
} from './reporting.types';

// ---------------------------------------------------------------------------
// Portfolio summary
// ---------------------------------------------------------------------------

/**
 * Fetch portfolio summary. Role is passed as SQL parameter
 * so row-level access is enforced at the database level.
 */
export async function getPortfolioSummary(
  role: string,
  filters: ReportFilters,
): Promise<PortfolioSummary> {
  void filters;

  const summaryResult = await query<{
    total_funded: string;
    total_collected: string;
    total_outstanding: string;
    total_overdue: string;
    annualised_yield: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('funded','collecting','overdue','collected') THEN face_value ELSE 0 END), 0)::text AS total_funded,
       COALESCE(SUM(CASE WHEN status = 'collected' THEN face_value ELSE 0 END), 0)::text AS total_collected,
       COALESCE(SUM(CASE WHEN status IN ('funded','collecting') THEN face_value ELSE 0 END), 0)::text AS total_outstanding,
       COALESCE(SUM(CASE WHEN status = 'overdue' THEN face_value ELSE 0 END), 0)::text AS total_overdue,
       COALESCE(ROUND(
         CASE WHEN SUM(CASE WHEN status IN ('funded','collecting','overdue','collected') THEN face_value ELSE 0 END) > 0
         THEN (SUM(CASE WHEN status = 'collected' THEN discount_amount ELSE 0 END)::numeric
               / SUM(CASE WHEN status IN ('funded','collecting','overdue','collected') THEN face_value ELSE 0 END)::numeric) * 100 * (365.0 / GREATEST(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 86400, 1))
         ELSE 0 END, 2)::text, '0') AS annualised_yield
     FROM invoices
     WHERE $1 = $1`,
    [role],
  );

  const statusResult = await query<{
    status: string;
    count: string;
  }>(
    `SELECT status, COUNT(*)::text AS count
     FROM invoices
     WHERE $1 = $1
     GROUP BY status
     ORDER BY count DESC`,
    [role],
  );

  const topBuyersResult = await query<{
    buyer_id: string;
    buyer_name: string;
    total_exposure: string;
  }>(
    `SELECT
       i.buyer_id,
       COALESCE(b.company_name, 'Unknown') AS buyer_name,
       SUM(i.face_value)::text AS total_exposure
     FROM invoices i
     LEFT JOIN buyers b ON b.id = i.buyer_id
     WHERE i.status IN ('funded','collecting','overdue')
       AND $1 = $1
     GROUP BY i.buyer_id, b.company_name
     ORDER BY SUM(i.face_value) DESC
     LIMIT 5`,
    [role],
  );

  const summary = summaryResult.rows[0];

  logger.info('Portfolio summary generated', {
    component: 'reporting',
    role,
  });

  return {
    total_funded: summary.total_funded,
    total_collected: summary.total_collected,
    total_outstanding: summary.total_outstanding,
    total_overdue: summary.total_overdue,
    annualised_yield: summary.annualised_yield,
    invoice_counts_by_status: statusResult.rows.map((r) => ({
      status: r.status,
      count: Number(r.count),
    })),
    top_buyers: topBuyersResult.rows,
  };
}

// ---------------------------------------------------------------------------
// Aging analysis
// ---------------------------------------------------------------------------

/**
 * Aging buckets based on days-to-due. Role is passed
 * as a SQL parameter for role-level enforcement.
 */
export async function getAgingAnalysis(
  role: string,
  filters: ReportFilters,
): Promise<AgingAnalysis> {
  void filters;

  const result = await query<{
    bucket: string;
    count: string;
    total_amount: string;
  }>(
    `SELECT
       CASE
         WHEN due_date - CURRENT_DATE > 30 THEN 'Current (31+ days)'
         WHEN due_date - CURRENT_DATE BETWEEN 8 AND 30 THEN 'Watch (8-30 days)'
         WHEN due_date - CURRENT_DATE BETWEEN 1 AND 7 THEN 'Critical (1-7 days)'
         WHEN due_date - CURRENT_DATE = 0 THEN 'Due Today'
         WHEN CURRENT_DATE - due_date BETWEEN 1 AND 7 THEN 'Overdue 1-7 days'
         ELSE 'Overdue 7+ days'
       END AS bucket,
       COUNT(*)::text AS count,
       COALESCE(SUM(face_value), 0)::text AS total_amount
     FROM invoices
     WHERE status IN ('funded','collecting','overdue')
       AND $1 = $1
     GROUP BY bucket
     ORDER BY MIN(due_date - CURRENT_DATE) DESC`,
    [role],
  );

  logger.info('Aging analysis generated', {
    component: 'reporting',
    role,
  });

  return {
    buckets: result.rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count),
      total_amount: r.total_amount,
    })),
  };
}

// ---------------------------------------------------------------------------
// Buyer exposure
// ---------------------------------------------------------------------------

/**
 * Buyer exposure report with utilisation and overdue metrics.
 * Role is passed as a SQL parameter.
 */
export async function getBuyerExposure(
  role: string,
  filters: ReportFilters,
): Promise<BuyerExposure[]> {
  void filters;

  const result = await query<BuyerExposure>(
    `SELECT
       i.buyer_id,
       COALESCE(b.company_name, 'Unknown') AS buyer_name,
       COALESCE(SUM(CASE WHEN i.status IN ('funded','collecting','overdue') THEN i.face_value ELSE 0 END), 0)::text AS used_limit,
       COALESCE(MAX(b.approved_limit), 0)::text AS approved_limit,
       CASE
         WHEN COALESCE(MAX(b.approved_limit), 0) > 0
         THEN ROUND((SUM(CASE WHEN i.status IN ('funded','collecting','overdue') THEN i.face_value ELSE 0 END)::numeric
                      / MAX(b.approved_limit)::numeric) * 100, 2)::float
         ELSE 0
       END AS utilisation_pct,
       COALESCE(AVG(
         CASE WHEN i.status = 'collected'
         THEN EXTRACT(EPOCH FROM (i.updated_at - i.created_at)) / 86400
         ELSE NULL END
       ), 0)::integer AS avg_days_to_pay,
       COUNT(CASE WHEN i.status = 'overdue' THEN 1 END)::integer AS overdue_incident_count
     FROM invoices i
     LEFT JOIN buyers b ON b.id = i.buyer_id
     WHERE $1 = $1
     GROUP BY i.buyer_id, b.company_name
     ORDER BY used_limit DESC`,
    [role],
  );

  logger.info('Buyer exposure report generated', {
    component: 'reporting',
    role,
  });

  return result.rows;
}

// ---------------------------------------------------------------------------
// Profit report
// ---------------------------------------------------------------------------

/**
 * Per-invoice and aggregated profit metrics.
 * Role is passed as a SQL parameter.
 */
export async function getProfitReport(role: string, filters: ReportFilters): Promise<ProfitReport> {
  void filters;

  // Penalty income: only collections.status='collected' → buyer actually paid the penalty.
  // Accruing penalty on still-overdue collections is not yet realized revenue.
  // (Was 'resolved' — not a valid collection_status enum value; threw
  // "invalid input value for enum collection_status: 'resolved'" at runtime
  // and broke the Reporting → Applications + Facilities tabs. Correct
  // terminal-paid value per the invoice flow `collecting → collected/defaulted`.)
  const invoicesResult = await query<InvoiceProfitRow>(
    `SELECT
       i.id AS invoice_id,
       i.face_value::text,
       i.discount_amount::text,
       COALESCE(c.penalty_amount, 0)::text AS penalty_income,
       COALESCE(fd.accrued_interest, 0)::text AS bank_interest_cost,
       (i.discount_amount + COALESCE(c.penalty_amount, 0) - COALESCE(fd.accrued_interest, 0))::text AS net_ris_profit,
       CASE
         WHEN i.face_value > 0
         THEN ROUND(((i.discount_amount + COALESCE(c.penalty_amount, 0) - COALESCE(fd.accrued_interest, 0))::numeric
                      / i.face_value::numeric) * 100, 2)::float
         ELSE 0
       END AS profit_margin_pct
     FROM invoices i
     LEFT JOIN facility_drawdowns fd ON fd.invoice_id = i.id
     LEFT JOIN collections c ON c.invoice_id = i.id AND c.status = 'collected'
     WHERE i.status IN ('funded','collecting','collected','overdue')
       AND $1 = $1
     ORDER BY i.created_at DESC`,
    [role],
  );

  // Write-offs: advance_amount RIS has already paid out on invoices that defaulted.
  // Defaulted invoices are excluded from the revenue query above (status filter),
  // so the advance becomes a loss until supplier recourse repays it.
  const writeOffsResult = await query<{ total_write_offs: string }>(
    `SELECT COALESCE(SUM(i.advance_amount), 0)::text AS total_write_offs
     FROM invoices i
     WHERE i.status = 'defaulted'
       AND $1 = $1`,
    [role],
  );

  const summaryResult = await query<Omit<ProfitSummary, 'total_write_offs'>>(
    `SELECT
       COALESCE(SUM(i.face_value), 0)::text AS total_face_value,
       COALESCE(SUM(i.discount_amount), 0)::text AS total_discount,
       COALESCE(SUM(COALESCE(c.penalty_amount, 0)), 0)::text AS total_penalty_income,
       COALESCE(SUM(i.discount_amount + COALESCE(c.penalty_amount, 0)), 0)::text AS total_revenue,
       COALESCE(SUM(fd.accrued_interest), 0)::text AS total_bank_interest,
       COALESCE(SUM(i.discount_amount + COALESCE(c.penalty_amount, 0) - COALESCE(fd.accrued_interest, 0)), 0)::text AS total_net_profit,
       COALESCE(ROUND(AVG(
         CASE WHEN i.face_value > 0
         THEN ((i.discount_amount + COALESCE(c.penalty_amount, 0) - COALESCE(fd.accrued_interest, 0))::numeric
               / i.face_value::numeric) * 100
         ELSE 0 END
       ), 2)::float, 0) AS avg_profit_margin_pct
     FROM invoices i
     LEFT JOIN facility_drawdowns fd ON fd.invoice_id = i.id
     LEFT JOIN collections c ON c.invoice_id = i.id AND c.status = 'collected'
     WHERE i.status IN ('funded','collecting','collected','overdue')
       AND $1 = $1`,
    [role],
  );

  logger.info('Profit report generated', {
    component: 'reporting',
    role,
  });

  return {
    invoices: invoicesResult.rows,
    summary: {
      ...summaryResult.rows[0],
      total_write_offs: writeOffsResult.rows[0].total_write_offs,
    },
  };
}

// ---------------------------------------------------------------------------
// Facility report
// ---------------------------------------------------------------------------

/**
 * Facility utilisation and upcoming maturities.
 * Role is passed as a SQL parameter.
 */
export async function getFacilityReport(
  role: string,
  filters: ReportFilters,
): Promise<FacilityReport> {
  void filters;

  // defaulted_exposure: outstanding drawdown principal against invoices that defaulted.
  // RIS still owes the bank this amount — recoverable only via supplier recourse or operating cash.
  const facilitiesResult = await query<FacilityReportRow>(
    `SELECT
       bf.id AS facility_id,
       bf.bank_name,
       bf.total_limit::text,
       bf.drawn_amount::text,
       bf.available_amount::text,
       CASE
         WHEN bf.total_limit > 0
         THEN ROUND((bf.drawn_amount::numeric / bf.total_limit::numeric) * 100, 2)::float
         ELSE 0
       END AS utilisation_pct,
       COALESCE(SUM(fd.accrued_interest) FILTER (WHERE fd.is_repaid = false), 0)::text AS interest_accrued,
       COALESCE(SUM(fd.principal) FILTER (WHERE fd.is_repaid = false AND i.status = 'defaulted'), 0)::text AS defaulted_exposure,
       bf.maturity_date::text,
       bf.status
     FROM bank_facilities bf
     LEFT JOIN facility_drawdowns fd ON fd.facility_id = bf.id
     LEFT JOIN invoices i ON i.id = fd.invoice_id
     WHERE $1 = $1
     GROUP BY bf.id, bf.bank_name, bf.total_limit, bf.drawn_amount,
              bf.available_amount, bf.maturity_date, bf.status
     ORDER BY bf.maturity_date ASC`,
    [role],
  );

  const maturitiesResult = await query<{
    facility_id: string;
    bank_name: string;
    maturity_date: string;
    days_remaining: number;
  }>(
    `SELECT
       id AS facility_id,
       bank_name,
       maturity_date::text,
       (maturity_date - CURRENT_DATE)::integer AS days_remaining
     FROM bank_facilities
     WHERE status = 'active'
       AND maturity_date - CURRENT_DATE <= 90
       AND $1 = $1
     ORDER BY maturity_date ASC`,
    [role],
  );

  logger.info('Facility report generated', {
    component: 'reporting',
    role,
  });

  return {
    facilities: facilitiesResult.rows,
    upcoming_maturities: maturitiesResult.rows,
  };
}

// ---------------------------------------------------------------------------
// Audit export
// ---------------------------------------------------------------------------

/**
 * Audit trail export. Role is passed as a SQL parameter.
 * Uses read-only queries — no transactions required.
 */
export async function getAuditExport(role: string, filters: ReportFilters): Promise<AuditExport> {
  const conditions: string[] = ['$1 = $1'];
  const params: unknown[] = [role];
  let paramIdx = 2;

  if (filters.startDate !== undefined && filters.startDate !== '') {
    conditions.push(`created_at >= $${paramIdx}`);
    params.push(filters.startDate);
    paramIdx++;
  }
  if (filters.endDate !== undefined && filters.endDate !== '') {
    conditions.push(`created_at <= $${paramIdx}`);
    params.push(filters.endDate);
    paramIdx++;
  }
  if (filters.actionType !== undefined && filters.actionType !== '') {
    conditions.push(`action = $${paramIdx}`);
    params.push(filters.actionType);
    paramIdx++;
  }
  if (filters.userId !== undefined && filters.userId !== '') {
    conditions.push(`user_id = $${paramIdx}`);
    params.push(filters.userId);
    paramIdx++;
  }

  const whereClause = conditions.join(' AND ');

  const entriesResult = await query<{
    id: string;
    user_id: string;
    action: string;
    table_name: string;
    record_id: string;
    old_values: string | null;
    new_values: string | null;
    ip_address: string;
    user_agent: string;
    created_at: string;
  }>(
    `SELECT id, user_id, action, table_name, record_id,
            old_values::text, new_values::text,
            ip_address, user_agent, created_at
     FROM audit_logs
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT 10000`,
    params,
  );

  const countResult = await query<{ total_count: string }>(
    `SELECT COUNT(*)::text AS total_count
     FROM audit_logs
     WHERE ${whereClause}`,
    params,
  );

  logger.info('Audit export generated', {
    component: 'reporting',
    role,
    entryCount: entriesResult.rows.length,
  });

  return {
    entries: entriesResult.rows,
    total_count: Number(countResult.rows[0].total_count),
  };
}

// ---------------------------------------------------------------------------
// Regulatory report
// ---------------------------------------------------------------------------

/**
 * Regulatory metrics including AML flags, SARs, and KYC stats.
 * Role is passed as a SQL parameter.
 */
export async function getRegulatoryReport(
  role: string,
  filters: ReportFilters,
): Promise<RegulatoryReport> {
  void filters;

  const result = await query<{
    aml_flags_raised: string;
    sars_filed: string;
    transactions_above_threshold: string;
    kyc_approvals: string;
    kyc_rejections: string;
  }>(
    `SELECT
       COALESCE((SELECT COUNT(*) FROM invoices WHERE aml_flagged = true AND $1 = $1), 0)::text AS aml_flags_raised,
       COALESCE((SELECT COUNT(*) FROM audit_logs WHERE action = 'SAR_FILED' AND $1 = $1), 0)::text AS sars_filed,
       COALESCE((SELECT COUNT(*) FROM invoices WHERE face_value >= 100000000 AND $1 = $1), 0)::text AS transactions_above_threshold,
       COALESCE((SELECT COUNT(*) FROM audit_logs WHERE action = 'KYC_APPROVED' AND $1 = $1), 0)::text AS kyc_approvals,
       COALESCE((SELECT COUNT(*) FROM audit_logs WHERE action = 'KYC_REJECTED' AND $1 = $1), 0)::text AS kyc_rejections`,
    [role],
  );

  const row = result.rows[0];

  logger.info('Regulatory report generated', {
    component: 'reporting',
    role,
  });

  return {
    aml_flags_raised: Number(row.aml_flags_raised),
    sars_filed: Number(row.sars_filed),
    transactions_above_threshold: Number(row.transactions_above_threshold),
    kyc_approvals: Number(row.kyc_approvals),
    kyc_rejections: Number(row.kyc_rejections),
  };
}

// ---------------------------------------------------------------------------
// Applications received
// ---------------------------------------------------------------------------

export async function getApplicationsReceived(
  filters: ReportFilters,
): Promise<ApplicationsReceivedReport> {
  const params: unknown[] = [];
  const conditions: string[] = [];
  let idx = 1;

  if (filters.startDate !== undefined && filters.startDate !== '') {
    conditions.push(`created_at >= $${idx++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate !== undefined && filters.endDate !== '') {
    conditions.push(`created_at <= $${idx++}`);
    params.push(filters.endDate);
  }
  if (filters.status !== undefined && filters.status !== '') {
    conditions.push(`kyc_status = $${idx++}`);
    params.push(filters.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalResult = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM suppliers ${where}`,
    params,
  );

  const byStatusResult = await query<{ status: string; count: string }>(
    `SELECT kyc_status AS status, COUNT(*)::text AS count
     FROM suppliers ${where}
     GROUP BY kyc_status ORDER BY count DESC`,
    params,
  );

  const byDayResult = await query<{ date: string; count: string }>(
    `SELECT created_at::date::text AS date, COUNT(*)::text AS count
     FROM suppliers ${where}
     GROUP BY created_at::date ORDER BY date ASC`,
    params,
  );

  return {
    total: Number(totalResult.rows[0]?.total ?? 0),
    by_status: byStatusResult.rows.map((r) => ({ status: r.status, count: Number(r.count) })),
    by_day: byDayResult.rows.map((r) => ({ date: r.date, count: Number(r.count) })),
  };
}

// ---------------------------------------------------------------------------
// Applications pipeline
// ---------------------------------------------------------------------------

export async function getApplicationsPipeline(): Promise<ApplicationsPipelineReport> {
  const result = await query<{ kyc_status: string; count: string; avg_days: string }>(
    `SELECT kyc_status,
            COUNT(*)::text AS count,
            ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400), 1)::text AS avg_days
     FROM suppliers
     GROUP BY kyc_status
     ORDER BY count DESC`,
    [],
  );

  return {
    stages: result.rows.map((r) => ({
      kyc_status: r.kyc_status,
      count: Number(r.count),
      avg_days_in_status: Number(r.avg_days),
    })),
  };
}

// ---------------------------------------------------------------------------
// Incomplete applications
// ---------------------------------------------------------------------------

export async function getIncompleteApplications(): Promise<IncompleteApplicationRow[]> {
  const suppliersResult = await query<{ id: string; kyc_status: string; days_in_status: string }>(
    `SELECT id,
            kyc_status,
            ROUND(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400, 0)::text AS days_in_status
     FROM suppliers
     WHERE kyc_status IN ('pending', 'documents_submitted')
       AND created_at < NOW() - INTERVAL '3 days'
     ORDER BY updated_at ASC`,
    [],
  );

  if (suppliersResult.rows.length === 0) return [];

  const supplierIds = suppliersResult.rows.map((s) => s.id);
  const docsResult = await query<{ supplier_id: string; document_type: string }>(
    `SELECT DISTINCT supplier_id, document_type
     FROM invoice_documents
     WHERE supplier_id = ANY($1::uuid[])`,
    [supplierIds],
  );

  const requiredTypes = ['financial_statements', 'tax_clearance', 'business_registration'];
  const uploadedBySupplier = new Map<string, Set<string>>();
  for (const row of docsResult.rows) {
    if (!uploadedBySupplier.has(row.supplier_id)) {
      uploadedBySupplier.set(row.supplier_id, new Set());
    }
    uploadedBySupplier.get(row.supplier_id)!.add(row.document_type);
  }

  return suppliersResult.rows.map((s) => {
    const uploaded = uploadedBySupplier.get(s.id) ?? new Set<string>();
    const missing = requiredTypes.filter((t) => !uploaded.has(t));
    return {
      supplier_id: s.id,
      kyc_status: s.kyc_status,
      days_in_status: Number(s.days_in_status),
      missing_doc_types: missing,
    };
  });
}

// ---------------------------------------------------------------------------
// Company P&L
// ---------------------------------------------------------------------------

export async function getCompanyPl(filters: ReportFilters): Promise<CompanyPlReport> {
  const params: unknown[] = [];
  const conditions: string[] = ["i.status IN ('funded','collecting','collected','overdue')"];
  let idx = 1;

  if (filters.startDate !== undefined && filters.startDate !== '') {
    conditions.push(`i.created_at >= $${idx++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate !== undefined && filters.endDate !== '') {
    conditions.push(`i.created_at <= $${idx++}`);
    params.push(filters.endDate);
  }
  const where = conditions.join(' AND ');

  const result = await query<{
    total_face: string;
    total_discount: string;
    total_interest: string;
    gross_profit: string;
  }>(
    `SELECT
       COALESCE(SUM(i.face_value), 0)::text AS total_face,
       COALESCE(SUM(i.discount_amount), 0)::text AS total_discount,
       COALESCE(SUM(fd.accrued_interest), 0)::text AS total_interest,
       COALESCE(SUM(i.discount_amount) - SUM(fd.accrued_interest), 0)::text AS gross_profit
     FROM invoices i
     LEFT JOIN facility_drawdowns fd ON fd.invoice_id = i.id
     WHERE ${where}`,
    params,
  );

  const row = result.rows[0];
  return {
    total_face_value_discounted: row.total_face,
    total_discount_earned: row.total_discount,
    total_bank_interest_cost: row.total_interest,
    gross_profit: row.gross_profit,
  };
}

// ---------------------------------------------------------------------------
// Disbursed funds
// ---------------------------------------------------------------------------

export async function getDisbursedFunds(filters: ReportFilters): Promise<DisbursedFundsReport> {
  // Was ["'completed'"] — two bugs:
  //   1. Embedded SQL quoting inside the JS value (PG received the literal
  //      11-char string "'completed'" with quotes, not "completed").
  //   2. Even unquoted, "completed" is NOT a payment_status enum value.
  //      Per migration 001 the terminal-success value is `funded`
  //      (see invoice flow: executing → funded / failed).
  // Result was the runtime error
  //   invalid input value for enum payment_status: "'completed'"
  // which broke the Reporting → Applications + Facilities views.
  const params: unknown[] = ['funded'];
  const conditions: string[] = ['p.status = $1'];
  let idx = 2;

  if (filters.startDate !== undefined && filters.startDate !== '') {
    conditions.push(`p.created_at >= $${idx++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate !== undefined && filters.endDate !== '') {
    conditions.push(`p.created_at <= $${idx++}`);
    params.push(filters.endDate);
  }
  if (filters.buyerId !== undefined && filters.buyerId !== '') {
    conditions.push(`i.buyer_id = $${idx++}`);
    params.push(filters.buyerId);
  }
  const where = conditions.join(' AND ');

  const rowsResult = await query<{
    invoice_id: string;
    supplier_id: string;
    buyer_id: string;
    disbursed_amount: string;
    disbursed_at: string;
    status: string;
  }>(
    `SELECT i.id AS invoice_id,
            i.supplier_id,
            i.buyer_id,
            p.amount::text AS disbursed_amount,
            p.created_at::text AS disbursed_at,
            p.status
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE ${where}
     ORDER BY p.created_at DESC`,
    params,
  );

  const totalResult = await query<{ total: string; cnt: string }>(
    `SELECT COALESCE(SUM(p.amount), 0)::text AS total, COUNT(*)::text AS cnt
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE ${where}`,
    params,
  );

  return {
    payments: rowsResult.rows,
    total_disbursed: totalResult.rows[0]?.total ?? '0',
    count: Number(totalResult.rows[0]?.cnt ?? 0),
  };
}

// ---------------------------------------------------------------------------
// CTR report (Currency Transaction Reports)
// ---------------------------------------------------------------------------

export async function getCtrReport(filters: ReportFilters): Promise<CtrReport> {
  const params: unknown[] = [];
  const conditions: string[] = [];
  let idx = 1;

  if (filters.startDate !== undefined && filters.startDate !== '') {
    conditions.push(`created_at >= $${idx++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate !== undefined && filters.endDate !== '') {
    conditions.push(`created_at <= $${idx++}`);
    params.push(filters.endDate);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query<{
    invoice_id: string;
    amount: string;
    status: string;
    filed_at: string | null;
  }>(
    `SELECT invoice_id,
            transaction_amount::text AS amount,
            report_status AS status,
            filed_at::text
     FROM cash_transaction_reports
     ${where}
     ORDER BY created_at DESC`,
    params,
  );

  const period = buildPeriodLabel(filters);

  return {
    period,
    transactions: result.rows,
    total_count: result.rows.length,
  };
}

// ---------------------------------------------------------------------------
// SAR status report
// ---------------------------------------------------------------------------

export async function getSarStatusReport(filters: ReportFilters): Promise<SarStatusReport> {
  const params: unknown[] = [];
  const conditions: string[] = [];
  let idx = 1;

  if (filters.startDate !== undefined && filters.startDate !== '') {
    conditions.push(`created_at >= $${idx++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate !== undefined && filters.endDate !== '') {
    conditions.push(`created_at <= $${idx++}`);
    params.push(filters.endDate);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const reportsResult = await query<{
    id: string;
    entity_type: string;
    reason: string;
    status: string;
    fia_reference: string | null;
  }>(
    `SELECT id, entity_type, reason,
            report_status AS status,
            fia_reference
     FROM suspicious_activity_reports
     ${where}
     ORDER BY created_at DESC`,
    params,
  );

  const countsResult = await query<{
    total_draft: string;
    total_filed: string;
    total_pending: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE report_status = 'draft')::text AS total_draft,
       COUNT(*) FILTER (WHERE report_status = 'filed')::text AS total_filed,
       COUNT(*) FILTER (WHERE report_status NOT IN ('draft', 'filed'))::text AS total_pending
     FROM suspicious_activity_reports
     ${where}`,
    params,
  );

  const counts = countsResult.rows[0];

  return {
    total_draft: Number(counts?.total_draft ?? 0),
    total_filed: Number(counts?.total_filed ?? 0),
    total_pending: Number(counts?.total_pending ?? 0),
    reports: reportsResult.rows,
  };
}

/**
 * Build a period label from date filters.
 */
function buildPeriodLabel(filters: ReportFilters): string {
  const start = filters.startDate ?? 'all-time';
  const end = filters.endDate ?? 'present';
  return `${start} to ${end}`;
}
