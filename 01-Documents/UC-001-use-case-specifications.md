# RIS Platform — Use Case Specifications

**Document ID:** UC-001  
**Version:** 1.0  
**Date:** March 2026  
**Owner:** Product Owner / CTO

---

## UC-001: Supplier Submits Invoice and Receives Early Payment

**Primary Actor:** Supplier  
**Secondary Actors:** Buyer, Credit Officer, Finance Manager, Bull Workers, Payment Provider

**Preconditions:**

- Supplier KYC status = 'approved', all required documents uploaded
- Buyer exists, is_active = true, sufficient approved_limit
- Supplier authenticated with valid JWT
- Bank facility available with maturity ≥ invoice due date

**Main Success Flow:**

1. Supplier submits POST /invoices/submit (invoice_number, buyer_id, face_value, due_date, documents)
2. System runs 5-check validation chain — all pass
3. System creates invoice (status='submitted'), computes 72hr_sla_deadline
4. System queues Notice of Assignment email to buyer via Bull
5. Buyer receives email, clicks confirmation link with UUID v4 token
6. System validates token — records buyer_confirmed_at, status='buyer_confirmed'
7. System queues risk scoring Bull job → risk engine scores (5 factors), recommendation=AUTO_APPROVE
8. System queues pricing Bull job → calculates advance_amount, discount_amount, net_payment
9. TIER_1 auto-approval: creates approval record (approver_id='SYSTEM'), status='approved'
10. Payment instruction created (status='pending_first_auth')
11. Finance Manager 1 reviews and authorises (dual_auth_user_1 recorded), status='pending_second_auth'
12. Finance Manager 2 (different person) authorises (dual_auth_user_2 recorded), status='executing'
13. Provider executes payment, returns transaction_reference, status='funded'
14. Supplier receives SMS + email with amount, reference, expected arrival

**Alternative Flows:**

- A1: Score 50–74 → TIER_2 credit officer approval before step 10
- A2: face_value > 50M → TIER_3, requires 2 credit officers
- A3: Token expired → HTTP 401, new token sent, resume from step 5

**Exception Flows:**

- E1: CREDIT_LIMIT_EXCEEDED → HTTP 422 with remaining_availability, invoice not created
- E2: Payment provider failure → status='failed', finance_manager notified, idempotency_key preserved
- E3: 72hr SLA at risk → urgent escalation to MD

**Business Rules:**

- BR1: buyer_confirmed_at NOT NULL enforced by DB constraint before status can advance
- BR2: dual_auth_user_1 ≠ dual_auth_user_2 enforced at app + DB + provider levels
- BR3: All monetary values stored as BIGINT UGX

**Security Controls:**

- Step 1: JWT verified, role=supplier, resource ownership confirmed
- Step 5: Token rate limited (5 attempts/hour), stored as SHA-256 hash
- Steps 11–12: finance_manager role verified, 2FA re-checked if >60 min
- Step 13: HMAC-SHA256 webhook signature verified on provider callback

**Audit Events:**

- Step 2: VALIDATION_PASSED/FAILED per check (5 entries)
- Step 3: INVOICE_SUBMITTED with SHA-256 hash of invoice data
- Step 6: BUYER_CONFIRMED with IP and user_agent
- Step 7: INVOICE_SCORED with all 5 factor scores
- Step 9: INVOICE_APPROVED (approver_id=SYSTEM)
- Steps 11–12: PAYMENT_FIRST_AUTH, PAYMENT_SECOND_AUTH with userId, IP, timestamp
- Step 13: PAYMENT_FUNDED with transaction_reference

**Postconditions:**

- Invoice status = 'funded', buyer.used_limit increased, facility.drawn_amount updated
- Supplier has received funds, all 9+ audit events in immutable audit_logs

---

## UC-002: Credit Officer Reviews Risk Score and Approves Funding

**Primary Actor:** Credit Officer  
**Secondary Actors:** System (Bull queue), Supplier, Second Credit Officer (TIER_3)

**Preconditions:**

- Invoice status = 'scored', recommendation = REFER_TO_MANAGER
- Credit officer authenticated, 2FA completed, role=credit_officer

**Main Success Flow:**

1. System notifies all credit officers of pending invoice via email and in-app alert
2. Credit officer selects invoice from approval queue
3. System executes SELECT FOR UPDATE to lock record exclusively
4. Credit officer reviews: risk score breakdown, buyer exposure, pricing, fee breakdown
5. Credit officer enters approval comments (minimum 20 characters)
6. Credit officer clicks Approve
7. System validates: role, comments ≥ 20 chars, invoice locked to this officer
8. System creates approval record, invoice status='approved'
9. System triggers payment engine via Bull queue, releases lock

**Alternative Flows:**

- A1: Rejection — status='rejected', buyer.used_limit released, supplier notified with reason
- A2: TIER_3 — second different credit officer repeats steps 3–7, system checks quorum
- A3: Escalation — credit officer escalates to TIER_3, MD override possible with documented reason

**Exception Flows:**

- E1: Invoice locked by another officer → HTTP 409 INVOICE_LOCKED
- E2: Comments < 20 chars → HTTP 400 field-level error, approval not recorded
- E3: SLA > 24 hours → escalation alert to management, invoice remains in queue
- E4: JWT expires during review → HTTP 401, re-authenticate, SELECT FOR UPDATE lock auto-released

**Business Rules:**

- BR1: Comments ≥ 20 chars validated at Joi level before any DB write
- BR2: Same officer cannot provide both TIER_3 approvals
- BR3: Approval decision immutable once recorded
- BR4: Single TIER_3 rejection does not auto-reject — MD can override

**Security Controls:**

- All steps: JWT verified, role=credit_officer at route AND service layer
- Step 3: SELECT FOR UPDATE prevents concurrent approval race condition
- Approval record includes: userId, sessionId, IP, user_agent (non-repudiation)

**Audit Events:**

- Step 3: INVOICE_REVIEW_STARTED with officer_id, lock_timestamp
- Step 8: INVOICE_APPROVED/REJECTED with officer_id, comments_hash, tier, timestamp
- Step 9: PAYMENT_INSTRUCTION_CREATED

**Postconditions (Approval):** Invoice status='approved', payment instruction created, supplier notified  
**Postconditions (Rejection):** Invoice status='rejected', buyer.used_limit released, supplier notified

---

## UC-003: Finance Manager Performs Dual Authorisation on Payment

**Primary Actor:** Finance Manager 1  
**Secondary Actor:** Finance Manager 2 (different person, different user_id)

**Preconditions:**

- Payment status = 'pending_first_auth'
- Both Finance Managers authenticated, 2FA completed within 60 minutes
- Kill switch NOT active

**Main Success Flow:**

1. Finance Manager 1 notified of pending payment
2. Finance Manager 1 reviews: supplier, invoice ref, amount, provider, fee breakdown
3. System verifies: JWT, role=finance_manager, 2FA ≤ 60 min, kill switch inactive
4. Finance Manager 1 authorises → dual_auth_user_1 recorded, status='pending_second_auth'
5. Finance Manager 2 notified independently
6. Finance Manager 2 reviews same details independently
7. System verifies: JWT, role, 2FA, AND user_id ≠ dual_auth_user_1
8. Finance Manager 2 authorises → dual_auth_user_2 recorded, status='executing'
9. System calls IPaymentProvider.execute() with idempotency_key
10. Provider returns success + transaction_reference → status='funded'
11. Supplier notified within 5 minutes via SMS + email

**Alternative Flows:**

- A1: EFT — generate Uganda ACH file, submit to bank, await bank confirmation webhook
- A2: Async MTN/Airtel — provider returns 202, webhook received, HMAC verified, status updated

**Exception Flows:**

- E1: Same user attempts both auths → HTTP 403 SAME_USER_DUAL_AUTH, logged as DUAL_AUTH_VIOLATION
- E2: Provider failure → status='failed', finance_manager notified, idempotency_key preserved, no auto-retry
- E3: Idempotency check on retry → return previous result without re-executing (prevents double payment)
- E4: Kill switch active → HTTP 503 PAYMENT_SUSPENDED
- E5: DB CHECK constraint fires → transaction rollback (defence-in-depth)

**Business Rules:**

- BR1: Dual auth enforced at THREE layers: application, DB constraint, provider API
- BR2: idempotency_key generated at payment creation, never changes
- BR3: Payment amount cannot be modified after instruction creation

**Security Controls:**

- Steps 3 and 7: JWT, role=finance_manager, 2FA re-verified if >60 min
- Step 7: Application validates user_id ≠ dual_auth_user_1 before any DB write
- Step 8: PostgreSQL CHECK constraint independently enforces same rule
- Step 9: Provider independently verifies dual-auth reference
- Async callbacks: HMAC-SHA256 signature verified before processing

**Audit Events:**

- Step 4: PAYMENT_FIRST_AUTH with userId, IP, user_agent, amount, timestamp
- Step 8: PAYMENT_SECOND_AUTH with userId, IP, timestamp
- Step 9: PAYMENT_EXECUTING with idempotency_key
- Step 10: PAYMENT_FUNDED with transaction_reference, funded_at
- Exception E1: DUAL_AUTH_VIOLATION with attempting userId and IP

**Postconditions:**

- Payment status='funded', invoice status='funded'
- Supplier notified, facility updated, collection schedule created
- Both auth records permanently stored and immutable

---

## UC-004: System Detects Overdue Invoice and Escalates to Management

**Primary Actor:** System (Bull cron jobs)  
**Secondary Actors:** Credit Officer, Credit Manager, MD, Compliance Officer, Buyer

**Preconditions:**

- Invoice status = 'funded', current date past invoice due_date
- Buyer has not made payment, Bull cron jobs running

**Main Success Flow:**

1. T−7 days: email + SMS to buyer (invoice ref, amount, payment details)
2. T−3 days: email + SMS + WhatsApp (if configured)
3. T=due date 08:00 EAT: final reminder email + SMS
4. T+1: status='overdue', collections record created (days_overdue=1), penalty calculated, credit_officer alerted
5. T+3: formal demand notice to buyer, escalate to credit_manager, flag potential bad debt
6. T+7: escalate to MD, generate demand letter, SAR review if above AML threshold
7. On payment received: atomically update buyer.used_limit, status='collected', trigger facility repayment

**Exception Flows:**

- E1: Notification failure → NOTIFICATION_FAILED logged, retry 3× via Bull, does NOT block status progression
- E2: WhatsApp not configured → silently skipped, email+SMS fallback, WHATSAPP_SKIPPED logged

**Business Rules:**

- BR1: penalty = face_value × daily_penalty_rate × days_overdue (integer arithmetic)
- BR2: Default rate = 0.001 (0.1%/day), configurable without code deployment
- BR3: Penalty charged to buyer — never deducted from supplier
- BR4: Payment receipt at step 7 is atomic — all updates in single transaction

**Audit Events:**

- Each reminder: REMINDER_SENT with channel, delivery status, timestamp
- Step 4: INVOICE_OVERDUE, PENALTY_CALCULATED with face_value, rate, days, amount
- Steps 5–6: DEMAND_NOTICE_SENT, CREDIT_MANAGER_ESCALATED, MD_ESCALATED, SAR_REVIEW_REQUIRED
- Step 7: PAYMENT_RECEIVED, INVOICE_COLLECTED

**Postconditions (Collected):** status='collected', buyer.used_limit reduced, facility repayment triggered  
**Postconditions (T+7 unresolved):** SAR flagged, legal process initiated, MD managing

---

## UC-005: Auditor Exports Full Audit Trail for Regulatory Inspection

**Primary Actor:** Auditor  
**Secondary Actors:** FIA Inspector, Bank of Uganda Examiner, Compliance Officer

**Preconditions:**

- Auditor authenticated with valid JWT (role=auditor), 2FA completed
- Date range for export specified by inspector
- Audit_logs database uses read-only connection for this query

**Main Success Flow:**

1. Auditor navigates to Reports → Audit Trail Export
2. Auditor selects filters: date_from, date_to (required, max 366 days), user_id (optional), action_type (optional)
3. Auditor clicks Export
4. System validates: role=auditor, date range ≤ 366 days, filters well-formed
5. System opens read-only database connection (SELECT-only privilege on audit_logs)
6. System executes parameterised query with applied filters
7. System streams CSV with headers: id, event_type, user_id, resource_type, resource_id, previous_state, new_state, ip_address, user_agent, timestamp
8. Auditor downloads CSV, provides to inspector
9. System logs AUDIT_EXPORT_GENERATED with auditor_id, date range, row_count, SHA-256 hash of file

**Alternative Flows:**

- A1: >100,000 rows → async generation, emailed download link (expires 24 hours)
- A2: Filter by user_id for individual employee investigation
- A3: Filter by action*type='PAYMENT*\*' for financial review

**Exception Flows:**

- E1: Non-auditor role → HTTP 403 before any DB query, UNAUTHORISED_REPORT_ACCESS logged
- E2: Date range > 366 days → HTTP 400 DATE_RANGE_EXCEEDED
- E3: Read-only connection fails → HTTP 503, write pool NOT used as fallback, engineering alerted
- E4: Tamper attempt (POST/PUT/DELETE on audit_logs) → HTTP 403 + DB trigger blocks it + AUDIT_TAMPER_ATTEMPT logged

**Business Rules:**

- BR1: Read-only DB connection only — never write pool
- BR2: Audit_logs immutable — DB trigger prevents UPDATE and DELETE
- BR3: Export action itself is logged (meta-audit trail)
- BR4: Maximum 366 days per export to prevent memory exhaustion
- BR5: Data retained 7 years — exports possible for any period within window

**Security Controls:**

- Step 4: role=auditor verified at route middleware AND service layer independently
- Step 5: Read-only PostgreSQL role — database-level write prevention
- Step 6: Parameterised query — SQL injection impossible
- Step 7: Streamed response — server never holds entire dataset in memory

**Audit Events:**

- Step 3: AUDIT_EXPORT_INITIATED with auditor_id, filters
- Step 9: AUDIT_EXPORT_GENERATED with auditor_id, row_count, date_range, file_hash
- Exception E1: UNAUTHORISED_REPORT_ACCESS with userId, role, IP
- Exception E4: AUDIT_TAMPER_ATTEMPT with userId, IP

**Postconditions:**

- CSV downloaded by auditor, inspector has complete tamper-evident audit trail
- File hash allows inspector to verify file not modified after export
- AUDIT_EXPORT_GENERATED entry in immutable audit_logs
