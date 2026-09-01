import { apiClient } from '@/lib/axios';

interface ReportFilters { startDate?: string; endDate?: string; buyerId?: string; }

// Backend wraps every reporting response as:
//   { data: { reportType, generatedAt, data: <ActualReport> } }
// The outer envelope is the controller's `res.json({ data: result })`; the
// inner `result.data` is the actual payload the components consume. Unwrap
// here once so callers see the report shape directly.
interface ReportEnvelope<T> { data: { reportType: string; generatedAt: string; data: T } }

async function fetchReport<T>(path: string, params: object = {}): Promise<T> {
  const { data } = await apiClient.get<ReportEnvelope<T>>(path, { params });
  return data.data.data;
}

export async function fetchPortfolioReport(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/portfolio', f);
}
export async function fetchAgingReport(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/aging', f);
}
export async function fetchBuyerExposure(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/buyer-exposure', f);
}
export async function fetchProfitReport(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/profit', f);
}
export async function fetchFacilitiesReport(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/facilities', f);
}
export async function fetchAuditExport(
  f: ReportFilters & { format?: 'json' | 'csv' } = {},
): Promise<unknown> {
  return fetchReport('/reports/audit-export', f);
}
export async function fetchRegulatoryReport(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/regulatory', f);
}

// ── Checkers §6 — 5 new application / funds reports ──────────────────────────

export async function fetchApplicationsReceived(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/applications-received', f);
}
export async function fetchApplicationsPipeline(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/applications-pipeline', f);
}
export async function fetchApplicationsIncomplete(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/applications-incomplete', f);
}
export async function fetchCompanyPl(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/company-pl', f);
}
export async function fetchDisbursedFunds(f: ReportFilters = {}): Promise<unknown> {
  return fetchReport('/reports/disbursed-funds', f);
}
