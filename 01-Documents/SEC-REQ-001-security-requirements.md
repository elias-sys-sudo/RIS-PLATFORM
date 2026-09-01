# RIS Platform — Security Requirements

**Document ID:** SEC-REQ-001  
**Version:** 1.0  
**Date:** March 2026  
**Status:** Approved  
**Owner:** Compliance Officer / CTO

---

## Purpose

These security requirements constrain every design and implementation decision in the RIS Invoice Discounting Platform. No functional requirement may override a security requirement. Any conflict between a functional requirement and a security requirement must be escalated to the CTO and resolved in favour of security.

---

## 1. Authentication Controls

**SEC-001:** The system SHALL enforce a minimum password length of 12 characters containing at least one uppercase letter, one lowercase letter, one number, and one special character for all user accounts.

**SEC-002:** The system SHALL enforce Time-based One-Time Password (TOTP) 2FA using the SPEAKEASY library for all staff roles (credit_officer, finance_manager, management, compliance_officer, auditor). Supplier accounts SHALL have 2FA as optional at registration but mandatory once their first invoice is funded.

**SEC-003:** The system SHALL issue JSON Web Tokens (JWT) with a maximum expiry of 15 minutes. All tokens SHALL contain: userId, role, sessionId, and iat (issued-at timestamp). Tokens SHALL be signed with a secret of minimum 256 bits (32 bytes).

**SEC-004:** The system SHALL issue refresh tokens with a maximum expiry of 7 days, transmitted only via httpOnly, Secure, SameSite=Strict cookies. Refresh tokens SHALL be stored in Redis and invalidated immediately on logout.

**SEC-005:** The system SHALL lock any user account for 30 minutes after 5 consecutive failed login attempts from any IP address. The lockout SHALL be recorded in audit_logs with the triggering IP address. The locked account SHALL NOT reveal the reason for rejection beyond "Account temporarily locked."

**SEC-006:** The system SHALL apply rate limiting of 10 login attempts per IP address per 15-minute window. On the 10th attempt, the system SHALL return HTTP 429 with a Retry-After header specifying the exact seconds until the window resets.

**SEC-007:** The system SHALL maintain a Redis-based session blacklist. On logout, the current JWT SHALL be added to the blacklist and remain there until its natural expiry time. Every authenticated request SHALL check the blacklist before processing.

**SEC-008:** The system SHALL never reveal in any API response whether a specific email address exists in the system. All authentication failures SHALL return the generic message "Invalid credentials" regardless of whether the failure is due to wrong password, non-existent email, or locked account.

**SEC-009:** The system SHALL enforce 2FA re-verification for any finance_manager performing a payment authorisation, even if the session was recently authenticated, if more than 60 minutes have elapsed since last 2FA verification.

**SEC-010:** The system SHALL invalidate ALL active sessions for a user when their role is changed by an administrator, requiring full re-authentication.

---

## 2. Authorisation Controls

**SEC-011:** The system SHALL implement Role-Based Access Control (RBAC) with the following roles and no overlap between supplier and staff permissions: supplier, credit_officer, finance_manager, management, compliance_officer, auditor. No user SHALL hold more than one role simultaneously.

**SEC-012:** The system SHALL verify resource ownership on every API endpoint that accesses supplier-specific data. A supplier JWT SHALL never be permitted to access invoice, document, or payment records belonging to a different supplier, regardless of whether the resource ID is guessed or enumerated.

**SEC-013:** The system SHALL enforce the principle of least privilege. Each role SHALL have access ONLY to the endpoints explicitly listed in the role permission matrix. Any request to an endpoint not in a role's permission matrix SHALL return HTTP 403 immediately, before any business logic executes.

**SEC-014:** The system SHALL apply row-level security (RLS) at the PostgreSQL database level for the invoices, suppliers, and payments tables. Supplier database queries SHALL include a WHERE supplier_id = $userId clause enforced by the database, not only by application code.

**SEC-015:** The system SHALL prevent horizontal privilege escalation. A credit_officer SHALL NOT be able to access finance_manager endpoints by manipulating request headers, JWT claims, or URL parameters.

**SEC-016:** The system SHALL prevent vertical privilege escalation. No user SHALL be able to modify their own role through any API endpoint. Role changes SHALL only be performed by management role through a dedicated admin endpoint with full audit logging.

**SEC-017:** The system SHALL apply role validation at two independent layers: (1) the route middleware layer using createRoleGuard(), and (2) the service layer before any database query executes. Both checks must pass independently.

**SEC-018:** The system SHALL enforce that the auditor role is read-only across all endpoints. An auditor JWT SHALL never be accepted on any POST, PUT, PATCH, or DELETE endpoint except audit-export.

---

## 3. Data Protection

**SEC-019:** The system SHALL encrypt all Personally Identifiable Information (PII) and financial data at rest using AES-256-GCM encryption via the shared/crypto.ts module before any write to disk or database. PII fields include: bank_account_number, bank_account_name, director ID numbers, mobile_money_number, and all uploaded documents.

**SEC-020:** The system SHALL enforce TLS 1.3 as the minimum protocol version for all data in transit. TLS 1.0 and TLS 1.1 SHALL be explicitly disabled. The system SHALL use HSTS with a minimum max-age of 31,536,000 seconds (1 year) and includeSubDomains.

**SEC-021:** The system SHALL never write PII to application logs. Log entries SHALL contain only: user_id (UUID), action code, resource_id (UUID), timestamp, and outcome. Names, email addresses, phone numbers, ID numbers, and bank details SHALL never appear in any log file.

**SEC-022:** The system SHALL store document files in encrypted form only. The encrypted file path and SHA-256 hash of the original content SHALL be stored in the database. The plaintext document SHALL never be written to disk, even temporarily.

**SEC-023:** The system SHALL retain all financial records, audit logs, and transaction data for a minimum of 7 years from the date of the transaction, in compliance with the Financial Institutions Act Uganda and FIA record-keeping requirements.

**SEC-024:** The system SHALL implement data minimisation. Only data fields required for the stated business purpose SHALL be collected and stored. Optional fields SHALL be clearly marked and their absence SHALL not block core workflows.

**SEC-025:** The system SHALL support the right of data subjects to request access to their personal data (Data Protection and Privacy Act 2019 Uganda, Section 24). A compliance officer SHALL be able to export all data held for a specific individual within 72 hours of a verified request.

**SEC-026:** The system SHALL store encryption keys separately from encrypted data. The ENCRYPTION_KEY environment variable SHALL never be committed to version control, logged, or included in any API response. Key rotation SHALL be possible without application downtime.

**SEC-027:** The system SHALL enforce a Content Security Policy (CSP) via Helmet middleware that prevents inline script execution, restricts resource loading to approved domains only, and disables framing (X-Frame-Options: DENY).

---

## 4. Audit and Monitoring

**SEC-028:** The system SHALL maintain an immutable audit log in the audit_logs PostgreSQL table. A database trigger SHALL prevent any UPDATE or DELETE operation on this table. Any attempt to modify an audit record SHALL raise a database error and be logged as a security event.

**SEC-029:** The system SHALL write an audit log entry BEFORE returning from any state-changing function. The audit entry SHALL include: event_type, user_id, resource_type, resource_id, previous_state, new_state, ip_address, user_agent, and timestamp with timezone.

**SEC-030:** The system SHALL log ALL of the following authentication events to audit_logs: LOGIN_SUCCESS, LOGIN_FAILED, ACCOUNT_LOCKED, TWO_FA_SUCCESS, TWO_FA_FAILED, LOGOUT, TOKEN_REFRESHED, PASSWORD_CHANGED, ROLE_CHANGED, SESSION_INVALIDATED.

**SEC-031:** The system SHALL detect and alert on anomalous authentication patterns in real time. Anomalies include: more than 10 failed logins across any accounts from a single IP in 5 minutes, a single account accessed from more than 2 different countries in 24 hours, and payment authorisation outside business hours (defined as 07:00–20:00 EAT).

**SEC-032:** The system SHALL log every payment event individually to audit_logs: PAYMENT_INSTRUCTION_CREATED, PAYMENT_FIRST_AUTH, PAYMENT_SECOND_AUTH, PAYMENT_EXECUTING, PAYMENT_FUNDED, PAYMENT_FAILED, PAYMENT_REVERSED.

**SEC-033:** The system SHALL generate a security alert to the compliance_officer and management roles within 60 seconds of: any transaction above the AML threshold, any failed dual-authorisation attempt, any account lockout, and any attempt to access another user's resources (403 on ownership check).

**SEC-034:** The system SHALL retain all audit_logs entries for a minimum of 7 years. Audit logs SHALL be exportable in CSV format by the auditor role only. The export query SHALL use a read-only database connection with a separate PostgreSQL role that has SELECT-only privileges on audit_logs.

**SEC-035:** The system SHALL record response time for every API request in the audit_logs table. Any request exceeding 5 seconds SHALL trigger an alert to the engineering team.

---

## 5. Payment Controls

**SEC-036:** The system SHALL enforce dual authorisation on every payment instruction. Two separate finance_manager users — with different user IDs — SHALL each independently authorise a payment before execution. The database SHALL enforce this via a CHECK constraint: dual_auth_user_1 != dual_auth_user_2 WHEN both are NOT NULL.

**SEC-037:** The system SHALL enforce dual authorisation at three independent layers: (1) application logic in PaymentService validating that both user IDs differ, (2) a PostgreSQL CHECK constraint on the payments table, and (3) the payment provider API rejecting any payment without a verified dual-auth reference. All three layers SHALL independently reject single-authorised payments.

**SEC-038:** The system SHALL implement a payment kill switch accessible only to the management role. When activated, the kill switch SHALL immediately halt all payment processing, set all executing payments to status='suspended', and send an emergency alert to all finance_manager and management users. The kill switch SHALL be logged as a KILL_SWITCH_ACTIVATED audit event.

**SEC-039:** The system SHALL enforce transaction limits by role. A finance_manager SHALL be unable to authorise a single payment exceeding UGX 500,000,000 without an additional MD approval recorded in the approvals table. The system SHALL reject the payment instruction at the service layer if this approval is absent.

**SEC-040:** The system SHALL generate a unique idempotency key (UUID v4) for every payment instruction at creation time. The payment provider SHALL receive this key on every execution attempt. If the same key is received twice, the provider SHALL return the original result without re-executing the payment, preventing double payments on network retry.

**SEC-041:** The system SHALL verify HMAC-SHA256 signatures on all incoming payment provider webhooks before processing. Webhooks with invalid or missing signatures SHALL be rejected with HTTP 401 and logged as WEBHOOK_SIGNATURE_INVALID in audit_logs.

**SEC-042:** The system SHALL enforce the 72-hour supplier payment SLA. A Bull cron job SHALL check every 30 minutes for approved invoices not yet funded. If the deadline is within 6 hours and status is not 'funded', an URGENT escalation SHALL be sent to MD and logged as SLA_BREACH_RISK.

---

## 6. Availability

**SEC-043:** The system SHALL maintain 99.5% uptime measured on a rolling 30-day basis, equating to a maximum of 3 hours 39 minutes downtime per month. Planned maintenance windows SHALL be excluded if communicated to users 48 hours in advance.

**SEC-044:** The system SHALL achieve a Recovery Time Objective (RTO) of 4 hours maximum. In the event of complete system failure, the platform SHALL be restored to full operational status within 4 hours. Restoration procedures SHALL be documented and tested quarterly.

**SEC-045:** The system SHALL achieve a Recovery Point Objective (RPO) of 15 minutes maximum. PostgreSQL WAL (Write-Ahead Logging) streaming replication to a hot standby SHALL ensure no more than 15 minutes of transaction data can be lost in any failure scenario.

**SEC-046:** The system SHALL implement automatic failover to the PostgreSQL replica within 60 seconds of primary database failure, without manual intervention. The replica SHALL be promoted to primary automatically using pg_auto_failover or equivalent.

**SEC-047:** The system SHALL maintain a hot standby Redis instance. On Redis primary failure, the system SHALL fail over to the standby within 30 seconds. Session data and job queues SHALL be replicated continuously.

**SEC-048:** The system SHALL implement circuit breakers on all external API calls (MTN MoMo, Airtel, SendGrid, Africa's Talking). If an external service fails 5 consecutive calls within 60 seconds, the circuit SHALL open, queue all pending operations, and retry with exponential backoff starting at 30 seconds.

**SEC-049:** The system SHALL perform automated database backups every 15 minutes using PostgreSQL continuous archiving (WAL archiving) to encrypted off-site storage. Full backups SHALL be taken daily and retained for 90 days. Backup restoration SHALL be tested monthly.

---

## 7. Compliance

**SEC-050:** The system SHALL flag any single transaction exceeding UGX 100,000,000 for AML review within 60 seconds of invoice submission. The flag SHALL create an AML_FLAG record in audit_logs, notify the compliance_officer, and allow the invoice to proceed — but mark it for mandatory manual review before funding.

**SEC-051:** The system SHALL enforce Know Your Customer (KYC) document requirements before any supplier invoice can be submitted. Required documents are: certificate_of_incorporation, tax_registration, director_id (minimum 1), signed_supplier_agreement. The system SHALL block invoice submission if any required document is absent or if KYC status is not 'approved'.

**SEC-052:** The system SHALL support Suspicious Activity Report (SAR) generation for the compliance_officer role. A SAR SHALL be generatable for any supplier, buyer, or transaction. The SAR SHALL include: entity details, all associated transactions, AML flags, and a narrative field. Generated SARs SHALL be logged as SAR_GENERATED in audit_logs and retained for 7 years.

**SEC-053:** The system SHALL perform sanctions screening on every new supplier and buyer registration against a configurable sanctions list (config/sanctions.json). A match SHALL set sanctions_flag=true on the entity record, notify the compliance_officer immediately, and prevent the entity from transacting until manually cleared. The sanctions list SHALL be updatable without system redeployment.

**SEC-054:** The system SHALL enforce Customer Due Diligence (CDD) tiers based on transaction size in compliance with the FIA Uganda AML Act 2013. Transactions under UGX 5,000,000: standard CDD (basic KYC documents). Transactions UGX 5,000,000–100,000,000: enhanced CDD (source of funds declaration required). Transactions above UGX 100,000,000: Enhanced Due Diligence (EDD) with manual compliance officer sign-off required.

**SEC-055:** The system SHALL generate regulatory reports for the compliance_officer and management roles showing: total transaction volume by period, count and value of AML-flagged transactions, SARs filed, KYC approval and rejection rates, and transactions by payment rail. Reports SHALL be exportable in PDF and CSV formats.

**SEC-056:** The system SHALL notify the compliance_officer within 72 hours of any personal data breach as required by the Data Protection and Privacy Act 2019 Uganda, Section 30. The notification SHALL include: nature of the breach, categories and approximate number of data subjects affected, likely consequences, and measures taken or proposed.

**SEC-057:** The system SHALL maintain records of all KYC decisions (approved/rejected) including the identity of the reviewing officer, the date of decision, and the reason for rejection. These records SHALL be retained for 7 years and be accessible to the auditor role.

---

## Requirement Traceability

| Category           | Requirements       | Count  |
| ------------------ | ------------------ | ------ |
| Authentication     | SEC-001 to SEC-010 | 10     |
| Authorisation      | SEC-011 to SEC-018 | 8      |
| Data Protection    | SEC-019 to SEC-027 | 9      |
| Audit & Monitoring | SEC-028 to SEC-035 | 8      |
| Payment Controls   | SEC-036 to SEC-042 | 7      |
| Availability       | SEC-043 to SEC-049 | 7      |
| Compliance         | SEC-050 to SEC-057 | 8      |
| **Total**          |                    | **57** |

---

## Sign-off

| Role               | Name | Signature | Date |
| ------------------ | ---- | --------- | ---- |
| CTO                |      |           |      |
| Compliance Officer |      |           |      |
| Managing Director  |      |           |      |
