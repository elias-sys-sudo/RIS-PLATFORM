# RIS Platform — Non-Functional Requirements

**Document ID:** NFR-001
**Version:** 2.0
**Date:** March 2026
**Standard:** ISO/IEC 25010:2011
**Owner:** CTO
**Change Log:** v2.1 — Added NFR-SEC-006 (explicit PII encryption), NFR-PERF-015 (dispute SLAs), NFR-PERF-016 (buyer payment score performance), NFR-COMP-012 (dispute resolution compliance). v2.0 — Aligned with RIS-Workflow-Registration-to-Funding.docx (source of truth). Added performance, reliability, and compliance requirements for eligibility, collateral, and settlement modules.

---

## 1. Performance

**NFR-PERF-001:** POST /invoices/submit SHALL respond within 2 seconds at the 95th percentile under 100 concurrent users, including all 5 validation checks and Bull queue job creation. Measured by k6 load test.

**NFR-PERF-002:** POST /auth/login SHALL respond within 1 second at the 95th percentile under 100 concurrent users. Bcrypt comparison (12 rounds) SHALL complete within 500ms on the production server.

**NFR-PERF-003:** The risk scoring engine SHALL complete all 5 factor calculations and write results within 5 seconds of Bull job pickup. Measured by job completion timestamp minus pickup timestamp.

**NFR-PERF-004:** The pricing engine SHALL complete within 2 seconds of Bull job pickup including facility rate lookup and buyer margin retrieval.

**NFR-PERF-005:** All report endpoints SHALL return data within 10 seconds at the 95th percentile for datasets up to 10,000 invoices. Larger datasets SHALL be generated asynchronously and delivered by email within 5 minutes.

**NFR-PERF-006:** Document upload up to 10MB SHALL complete within 30 seconds including AES-256-GCM encryption and SHA-256 hash computation.

**NFR-PERF-007:** All audit log writes SHALL complete within 1 second of the triggering event and SHALL never block the main business logic response.

**NFR-PERF-008:** Database indexed lookups by invoice_id, supplier_id, or buyer_id SHALL respond under 100ms at the 95th percentile. Connection pool: minimum 5, maximum 20 connections.

**NFR-PERF-009:** Bull queue job pickup latency SHALL be under 500ms from job creation to worker pickup under normal load (queue depth < 100 jobs).

**NFR-PERF-010:** Buyer confirmation token validation SHALL respond within 500ms including token hash comparison and database lookup.

**NFR-PERF-011:** POST /eligibility/check SHALL respond within 1 second at the 95th percentile. Eligibility token generation, database write, and audit log entry SHALL complete within this window.

**NFR-PERF-012:** Settlement initiation (from collection recorded to settlement record created) SHALL complete within 5 seconds. Profit booking calculation (facility repayment + profit computation) SHALL complete within 3 seconds. All settlement operations use BigInt arithmetic with zero floating-point intermediate values.

**NFR-PERF-013:** Collateral coverage ratio check SHALL complete within 500ms including aggregation of all active collateral for an invoice and comparison against minimum thresholds. This check runs synchronously during payment initiation and must not block the 72-hour SLA.

**NFR-PERF-014:** Welcome email, KYC decision email, and document comment notification emails SHALL be queued within 1 second of the triggering event and delivered within 60 seconds via the notification queue.

**NFR-PERF-015:** Buyer dispute submission (POST /:token/dispute) SHALL respond within 2 seconds at the 95th percentile. The system SHALL acknowledge the dispute to the buyer immediately, route to credit_officer within 1 business day, and target resolution within 5 business days. Disputes unresolved after 10 business days SHALL auto-escalate to management with SLA_BREACH_DISPUTE logged.

**NFR-PERF-016:** Buyer payment score recalculation (triggered on payment receipt) SHALL complete within 500ms including the score adjustment query. The adjustment runs inside the collection payment transaction and must not extend the total transaction time beyond 3 seconds.

---

## 2. Reliability

**NFR-REL-001:** The system SHALL maintain 99.5% uptime on a rolling 30-day basis — maximum 3 hours 39 minutes unplanned downtime per month. Measured by external health check to GET /health every 60 seconds.

**NFR-REL-002:** Zero data loss on any completed financial transaction. Any transaction not receiving COMMIT acknowledgement SHALL rollback completely with no partial state persisted.

**NFR-REL-003:** Failed Bull jobs SHALL retry with exponential backoff: 30 seconds, 2 minutes, 10 minutes. After 3 failures the job moves to dead letter queue and finance_manager is notified.

**NFR-REL-004:** PostgreSQL replica lag SHALL not exceed 30 seconds under normal load. Alert fires if lag exceeds 60 seconds.

**NFR-REL-005:** Recovery Time Objective (RTO): 4 hours maximum from complete system failure to full operation. Tested quarterly via documented failover drill.

**NFR-REL-006:** Recovery Point Objective (RPO): 15 minutes maximum. WAL archiving to off-site encrypted storage ensures no more than 15 minutes of committed transactions can be lost.

**NFR-REL-007:** Circuit breakers on all external APIs. If a service fails 5 consecutive calls within 60 seconds, circuit opens. Recovery attempted after 30 seconds with single test request.

**NFR-REL-008:** Full database backups daily at 02:00 EAT, retained 90 days. WAL continuous archiving every 15 minutes. Restoration tested monthly.

**NFR-REL-009:** Redis persisted via RDB snapshots every 15 minutes AND AOF. Replica promoted to primary automatically within 30 seconds of primary failure.

**NFR-REL-010:** Graceful shutdown on SIGTERM — complete in-flight requests within 30-second grace period before closing connections and stopping workers.

**NFR-REL-011:** Settlement operations (facility repayment + profit booking) SHALL be atomic within a single database transaction. If any step fails (drawdown update, repayment record, profit booking), the entire settlement SHALL rollback with zero partial state. Settlement status SHALL only advance on successful COMMIT.

**NFR-REL-012:** Collateral expiry processing SHALL be idempotent — running the expiry check job multiple times on the same day SHALL produce the same result (deactivate expired collateral, send alerts only once per expiry event).

---

## 3. Scalability

**NFR-SCALE-001:** Support 100 concurrent authenticated supplier sessions without response time degradation. Measured by k6 sustaining 100 VUs for 10 minutes.

**NFR-SCALE-002:** Process minimum 500 invoices/month at launch. Scale to 5,000/month without architectural redesign — only horizontal scaling of existing components.

**NFR-SCALE-003:** Bull worker pool scales horizontally. Adding worker processes increases throughput linearly up to DB connection pool limit. Worker count configurable via environment variable.

**NFR-SCALE-004:** Database supports 500 invoice/month workload on single server at launch. Read replica addition requires only connection string configuration — no code changes.

**NFR-SCALE-005:** Schema supports minimum: 100,000 invoices, 10,000 suppliers, 5,000 buyers, 10,000,000 audit log entries without query degradation. All relevant columns indexed at schema creation.

**NFR-SCALE-006:** Document storage supports minimum 1TB encrypted documents without architectural change. Storage volume separate from application server.

**NFR-SCALE-007:** Notification service processes minimum 1,000 email/SMS per hour without queue backlog. Alert fires when queue exceeds 500 pending jobs.

---

## 4. Security

**NFR-SEC-001:** All 57 requirements in SEC-REQ-001 are incorporated by reference as non-functional requirements of this system.

**NFR-SEC-002:** Zero HIGH findings on OWASP ZAP baseline scan before each production deployment. CI/CD pipeline fails on any HIGH finding.

**NFR-SEC-003:** npm audit runs before each deployment. Build fails on any CRITICAL or HIGH dependency vulnerability. Resolution required within 7 days of discovery.

**NFR-SEC-004:** TLS certificate monitored. Alert 30 days before expiry. Renewal automated via Let's Encrypt or equivalent.

**NFR-SEC-005:** Independent penetration test annually. CRITICAL/HIGH findings remediated within 30 days. Medium within 90 days.

**NFR-SEC-006:** All personally identifiable information (PII) SHALL be encrypted using AES-256-GCM via shared/crypto.ts before any database INSERT. Encrypted fields: company_name, tax_id, director names and ID numbers, bank_account_number, bank_account_name, mobile_money_number, contact_email, contact_phone. Plaintext SHALL never be written to the database, application logs, queue payloads, or any intermediate storage. Decryption SHALL occur only in the service layer after SELECT, never in repository or controller layers.

---

## 5. Compliance

**NFR-COMP-001:** AML monitoring SHALL flag transactions exceeding UGX 100,000,000 within 60 seconds of invoice submission. Measured by timestamp delta between invoice created_at and AML_FLAG audit entry.

**NFR-COMP-002:** KYC status checked on every invoice submission as first validation step, completing within 200ms.

**NFR-COMP-003:** All audit events written to audit_logs within 1 second of triggering action. Audit write failure causes entire transaction to rollback.

**NFR-COMP-004:** Financial records retained minimum 7 years. Database trigger prevents deletion of any record within retention window.

**NFR-COMP-005:** SAR generation for any customer completes within 60 seconds including all related transaction history aggregation.

**NFR-COMP-006:** Data subject access request export completes within 2 hours of compliance officer initiation.

**NFR-COMP-007:** VAT and WHT calculations accurate to within 1 UGX. Verified by pricing module acceptance test before each deployment.

**NFR-COMP-008:** Collateral coverage SHALL be verified before every payment disbursement. The system SHALL NOT release funds for any invoice where collateral_coverage_met = false. This is a non-negotiable control per the workflow document: "Insufficient coverage flag blocks disbursement."

**NFR-COMP-009:** Every invoice lifecycle SHALL produce a minimum of 14 audit_log entries from submission through settlement closure. The SETTLEMENT_CLOSED audit entry SHALL be the terminal entry, after which no further status changes are permitted on the invoice. Audit trail completeness SHALL be verifiable by the auditor role.

**NFR-COMP-010:** Dual authorization on all payments SHALL be enforced at three independent layers per the workflow document: (1) application service validation, (2) PostgreSQL CHECK/trigger constraint, (3) payment provider API. Payment cannot proceed with a single signatory under any circumstance.

**NFR-COMP-011:** Separation of duties SHALL be enforced system-wide — no single user can both approve an invoice and authorize its payment. The system SHALL block any user who holds both credit_officer and finance_manager responsibilities from performing both actions on the same invoice.

**NFR-COMP-012:** Invoice disputes raised by buyers SHALL be recorded immutably with: dispute_reason, dispute_type, timestamp, and IP address. The system SHALL route disputes to credit_officer and legal roles within 1 business day. Dispute records SHALL be retained for the full 7-year retention period. The invoice SHALL NOT advance past submitted status while a dispute is open. Dispute resolution (accepted/rejected) SHALL be audited with resolver_id, resolution_notes, and timestamp.

---

## 6. Usability

**NFR-USE-001:** Supplier completes full invoice submission (login → submit → upload documents) in under 5 minutes on first attempt. Verified by usability testing with 5 representative users.

**NFR-USE-002:** System functions correctly on Chrome 110+, Safari 15+, Firefox 110+, Edge 110+ on mobile (iOS 15+, Android 10+) and desktop without polyfills.

**NFR-USE-003:** API error messages in plain English, actionable, and specific. Never expose stack traces, SQL text, internal paths, or server version.

**NFR-USE-004:** Validation errors returned at field level simultaneously — errors array of {field, message} objects. Never stops at first error.

**NFR-USE-005:** System supports screen sizes 320px, 768px, 1280px, 1920px without horizontal scrolling or layout breakage.

**NFR-USE-006:** All destructive actions (rejection, authorisation, suspension) require explicit confirmation with consequences described before execution.

**NFR-USE-007:** API responses use camelCase consistently. Dates in ISO 8601 format. Monetary amounts as integers with separate currency field always "UGX".

---

## 7. Maintainability

**NFR-MAINT-001:** Unit test coverage minimum 80% for all modules. Risk-engine and payments minimum 95%. CI/CD fails below these thresholds.

**NFR-MAINT-002:** TypeScript strict mode — zero type errors. CI/CD runs tsc --noEmit and fails on any error.

**NFR-MAINT-003:** ESLint zero errors and zero warnings. CI/CD fails on any finding.

**NFR-MAINT-004:** All exported functions have JSDoc: description, @param, @returns, @throws.

**NFR-MAINT-005:** No function exceeds 25 lines (40 for payment execution). Enforced by ESLint max-lines-per-function rule.

**NFR-MAINT-006:** Database migrations append-only. Existing files never edited. Migration runner tracks completion in schema_migrations table.

---

## Summary

| Category        | Count  |
| --------------- | ------ |
| Performance     | 16     |
| Reliability     | 12     |
| Scalability     | 7      |
| Security        | 6      |
| Compliance      | 12     |
| Usability       | 7      |
| Maintainability | 6      |
| **Total**       | **66** |
