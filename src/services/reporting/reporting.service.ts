// =============================================================================
// Reporting — Service (business logic, role validation, CSV export)
// =============================================================================

import { BusinessRuleError, ForbiddenError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { ReportType, REPORT_ROLE_ACCESS } from './reporting.types';
import type {
  ReportFilters,
  ReportData,
  ReportResult,
  AuditExport,
  AuditExportRow,
} from './reporting.types';
import * as repo from './reporting.repository';

// ---------------------------------------------------------------------------
// Role validation
// ---------------------------------------------------------------------------

/**
 * Validate that a role is authorised to access a report type.
 * Throws ForbiddenError if not.
 */
export function validateRoleAccess(reportType: ReportType, role: string): void {
  const allowed: string[] | undefined = REPORT_ROLE_ACCESS[reportType];
  if (allowed === undefined || !allowed.includes(role)) {
    throw new ForbiddenError(`Role '${role}' is not authorised to access ${reportType}`);
  }
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

/**
 * Generate a report by type. Validates role access first,
 * then delegates to the appropriate repository query.
 */
export async function generateReport(
  type: ReportType,
  userId: string,
  role: string,
  filters: ReportFilters,
  ipAddress: string,
  userAgent: string,
): Promise<ReportResult> {
  void userAgent;
  validateRoleAccess(type, role);

  let data: ReportData;

  switch (type) {
    case ReportType.PORTFOLIO_SUMMARY:
      data = await repo.getPortfolioSummary(role, filters);
      break;
    case ReportType.AGING_ANALYSIS:
      data = await repo.getAgingAnalysis(role, filters);
      break;
    case ReportType.BUYER_EXPOSURE:
      data = await repo.getBuyerExposure(role, filters);
      break;
    case ReportType.PROFIT:
      data = await repo.getProfitReport(role, filters);
      break;
    case ReportType.FACILITY:
      data = await repo.getFacilityReport(role, filters);
      break;
    case ReportType.AUDIT_EXPORT:
      data = await repo.getAuditExport(role, filters);
      break;
    case ReportType.REGULATORY:
      data = await repo.getRegulatoryReport(role, filters);
      break;
    case ReportType.APPLICATIONS_RECEIVED:
      data = await repo.getApplicationsReceived(filters);
      break;
    case ReportType.APPLICATIONS_PIPELINE:
      data = await repo.getApplicationsPipeline();
      break;
    case ReportType.APPLICATIONS_INCOMPLETE:
      data = await repo.getIncompleteApplications();
      break;
    case ReportType.COMPANY_PL:
      data = await repo.getCompanyPl(filters);
      break;
    case ReportType.DISBURSED_FUNDS:
      data = await repo.getDisbursedFunds(filters);
      break;
    case ReportType.CTR:
      data = await repo.getCtrReport(filters);
      break;
    case ReportType.SAR_STATUS:
      data = await repo.getSarStatusReport(filters);
      break;
    default: {
      const exhaustive: never = type;
      throw new BusinessRuleError(
        'UNKNOWN_REPORT_TYPE',
        `Unknown report type: ${String(exhaustive)}`,
      );
    }
  }

  logger.info('Report generated', {
    component: 'reporting',
    reportType: type,
    userId,
    role,
    ipAddress,
  });

  return {
    reportType: type,
    generatedAt: new Date().toISOString(),
    data,
  };
}

// ---------------------------------------------------------------------------
// CSV export (audit trail only)
// ---------------------------------------------------------------------------

/**
 * Convert audit export data to CSV string.
 * Never returns partial data — either complete export or error.
 */
export function exportToCsv(data: AuditExport): string {
  const headers = [
    'id',
    'user_id',
    'action',
    'table_name',
    'record_id',
    'old_values',
    'new_values',
    'ip_address',
    'user_agent',
    'created_at',
  ];

  const headerLine = headers.join(',');

  if (data.entries.length === 0) {
    return headerLine + '\n';
  }

  const rows = data.entries.map((entry: AuditExportRow) =>
    headers
      .map((h) => {
        const val = entry[h as keyof AuditExportRow];
        if (val === null || val === undefined) {
          return '';
        }
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(','),
  );

  return headerLine + '\n' + rows.join('\n') + '\n';
}
