# reporting/ — Compliance Reports & Audit Export

## Role access — enforced before every report

`REPORT_ROLE_ACCESS` in `reporting.types.ts` is the authoritative gate. Do not add role checks anywhere else.

```typescript
// reporting.service.ts — first line of every report function
validateRoleAccess(reportType, role); // throws ForbiddenError if not in allowed list

// The access matrix:
PORTFOLIO_SUMMARY  → management, auditor
AGING_ANALYSIS     → credit_officer, management, auditor
BUYER_EXPOSURE     → credit_officer, management
PROFIT             → finance_manager, management
FACILITY           → finance_manager, management
AUDIT_EXPORT       → auditor only
REGULATORY         → compliance_officer, management
```

❌ WRONG — adding a new report type without adding it to `REPORT_ROLE_ACCESS`:
```typescript
case ReportType.MY_NEW_REPORT:
  return repo.getMyNewReport(); // REPORT_ROLE_ACCESS doesn't cover it → always throws ForbiddenError
```

## Audit export — 7-year retention requirement

`AUDIT_EXPORT` report type returns audit_logs entries. The query MUST:
1. Accept a date range filter — regulators specify the period they want
2. Never paginate out records — return all matching records (export, not display)
3. Convert to CSV for download — `exportAuditLogsToCsv()` in service

```typescript
// ✅ CORRECT — date range is mandatory for audit export
if (!filters.dateFrom || !filters.dateTo) {
  throw new ValidationError('Audit export requires dateFrom and dateTo');
}
// Max range: 1 year per export request (prevents OOM on 7-year full export)
const maxRange = 365 * 24 * 60 * 60 * 1000; // ms
if (new Date(filters.dateTo).getTime() - new Date(filters.dateFrom).getTime() > maxRange) {
  throw new BusinessRuleError(ReportingErrorCode.DATE_RANGE_TOO_LARGE,
    'Audit export range cannot exceed 365 days per request'
  );
}
```

## CSV export format

```typescript
// Headers match AuditExportRow interface fields exactly
const CSV_HEADERS = 'id,user_id,action,entity_type,entity_id,ip_address,created_at';
// One row per audit_logs record — no aggregation
// Encoding: UTF-8 with BOM for Excel compatibility
// Response header: Content-Type: text/csv; charset=utf-8
//                  Content-Disposition: attachment; filename="audit-export-{dateFrom}-{dateTo}.csv"
```

## This module is read-only — no state changes

Reporting queries data only. It:
- Never writes to `audit_logs` (no user-triggered state changes to log)
- Never modifies invoices, payments, or any business entity
- Has no `WithClient` repository variants needed
- Has no queue dependencies

Exception: `generateReport()` writes one audit entry: `REPORT_GENERATED` with `{ reportType, userId, filters }`. This is the only write and it uses the standalone `pool.query()` (no transaction needed — single table).

## Monetary values in reports

All amounts in reports are BIGINT from DB, returned as strings. Format as UGX in frontend using `formatUGX()`. Do NOT format in the backend — return raw integer strings.

For CSV export: include raw integer strings, not formatted UGX. Analysts import into Excel and format themselves.
