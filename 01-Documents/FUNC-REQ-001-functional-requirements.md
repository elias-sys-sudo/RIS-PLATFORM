# RIS Platform — Functional Requirements

**Document ID:** FUNC-REQ-001
**Version:** 2.0
**Date:** March 2026
**Status:** Approved
**Standard:** ISO/IEC 29148:2018 Systems and Software Engineering — Requirements Engineering
**Owner:** CTO / Product Owner
**Change Log:** v2.0 — Aligned with RIS-Workflow-Registration-to-Funding.docx (source of truth). Added Module 0 (ELIGIBILITY), Module 12 (COLLATERAL), Module 13 (SETTLEMENT). Amended ONBOARD, VERIFY, RISK, PRICE, APPROVE, COLLECT, FACILITY, REPORT modules.

---

## MoSCoW Priority Key

- **M — Must Have:** System cannot go live without this. Non-negotiable.
- **S — Should Have:** Important but not critical for launch. Include in first release if possible.
- **C — Could Have:** Desirable. Include if time and budget allow.
- **W — Won't Have:** Explicitly out of scope for this release. Documented to prevent scope creep.

---

## Module 0: ELIGIBILITY — Pre-Registration Qualification Gate

> **Source:** Workflow Document Stage 1. The system presents eligibility questions before allowing an entity to create an account. Ineligible entities are blocked at this stage.

**REQ-ELIG-001 [M]:** The system SHALL present a public (unauthenticated) eligibility questionnaire requiring answers to: (1) Is the entity a registered company with a valid certificate of incorporation? (2) Is the respondent an authorized signatory or director? (3) How many years has the entity been in business? (4) What is the indicative funding requirement in UGX? All four fields are mandatory. The system SHALL reject the submission with HTTP 400 if any field is missing.

**REQ-ELIG-002 [M]:** The system SHALL evaluate eligibility as follows: registered_company must be TRUE, authorized_person must be TRUE, years_in_business must be >= 1. If ALL conditions pass, the system SHALL generate a cryptographic session token (UUID v4), store the eligibility check result with all answers in the eligibility_checks table, and return the session token. If ANY condition fails, the system SHALL display an ineligibility message, log the attempt (IP address, answers, timestamp) in eligibility_checks with passed=false, and block account creation.

**REQ-ELIG-003 [M]:** The eligibility session token SHALL expire after 24 hours. The system SHALL enforce expiry by storing expires_at in the eligibility_checks table and checking expires_at > NOW() when the token is presented during registration. An expired token SHALL return HTTP 401 with error code ELIGIBILITY_TOKEN_EXPIRED.

**REQ-ELIG-004 [M]:** The system SHALL store the indicative funding_requirement from the eligibility check and carry it forward to the supplier record upon registration, for use in initial credit sizing by the credit officer.

**REQ-ELIG-005 [M]:** The system SHALL write to audit_logs for every eligibility check: ELIGIBILITY_PASSED or ELIGIBILITY_FAILED with IP address, all answers provided (no PII — only boolean/numeric values), and timestamp.

**REQ-ELIG-006 [S]:** The system SHOULD allow an entity that failed eligibility to re-attempt after 30 days from the same IP/email, preventing repeated failed attempts from consuming system resources.

**REQ-ELIG-007 [W]:** The system WON'T support partial eligibility (e.g., provisional access for entities that fail one criterion) in this release.

---

## Module 1: AUTH — Authentication & Session Management

**REQ-AUTH-001 [M]:** The system SHALL authenticate users via email and bcrypt-hashed password (minimum 12 rounds), returning a signed JWT (RS256 or HS256, minimum 256-bit secret, 15-minute expiry) and an httpOnly Secure refresh token (7-day expiry) on successful authentication.

**REQ-AUTH-002 [M]:** The system SHALL enforce Time-based One-Time Password (TOTP) 2FA for all staff roles (credit_officer, finance_manager, management, compliance_officer, auditor). A login attempt that passes password validation SHALL return a partial_auth token; full access SHALL be granted only after successful TOTP verification within 5 minutes.

**REQ-AUTH-003 [M]:** The system SHALL lock any user account for exactly 30 minutes after 5 consecutive failed authentication attempts, returning HTTP 403 with the message "Account temporarily locked" and the unlock timestamp. The lockout SHALL apply regardless of IP address and SHALL be recorded in audit_logs as ACCOUNT_LOCKED.

**REQ-AUTH-004 [M]:** The system SHALL validate every incoming JWT on protected endpoints by: verifying the signature, checking the expiry claim, and querying the Redis session blacklist. Any token failing any check SHALL return HTTP 401 and log TOKEN_VALIDATION_FAILED.

**REQ-AUTH-005 [M]:** The system SHALL write the following events to audit_logs within 1 second of occurrence: LOGIN_SUCCESS, LOGIN_FAILED (with reason_code), ACCOUNT_LOCKED, TWO_FA_SUCCESS, TWO_FA_FAILED, LOGOUT, TOKEN_REFRESHED, PASSWORD_CHANGED, SESSION_INVALIDATED.

**REQ-AUTH-006 [M]:** The system SHALL respond to POST /auth/login within 2 seconds at the 95th percentile under 100 concurrent users. Rate limiting SHALL return HTTP 429 after 10 requests per IP per 15-minute window with a Retry-After header.

**REQ-AUTH-007 [S]:** The system SHOULD send an email notification to the registered address within 60 seconds when a login occurs from a new device (user_agent not seen in last 30 days) or new country.

**REQ-AUTH-008 [S]:** The system SHOULD support TOTP backup codes (8 single-use codes generated at 2FA setup) to allow account recovery when the TOTP device is lost, requiring identity re-verification before codes are issued.

**REQ-AUTH-009 [C]:** The system COULD support OAuth 2.0 login via Google Workspace for staff accounts in a future release, reducing password management burden for organisations using Google.

**REQ-AUTH-010 [W]:** The system WON'T support biometric authentication in this release due to browser API inconsistency across the target device range in Uganda.

---

## Module 2: ONBOARD — Supplier KYC & Buyer Profiles

**REQ-ONBOARD-001 [M]:** The system SHALL accept supplier registration with the following required fields: company_name, registration_number, tax_id, at least one director (name, id_type, id_number), bank_name, bank_account_number, bank_account_name, bank_branch, preferred_payment_method (MTN_MOMO / AIRTEL / EFT), mobile_money_number (required if MTN_MOMO or AIRTEL selected), and required_financing_amount (carried from eligibility check). The system SHALL require a valid eligibility session token (from Module 0) before accepting registration. Missing required fields SHALL return HTTP 400 with field-level error details.

**REQ-ONBOARD-002 [M]:** The system SHALL encrypt bank_account_number, bank_account_name, company_name, tax_id, all director names and ID numbers, and mobile_money_number using AES-256-GCM via shared/crypto.ts before writing to the database. Plaintext values SHALL never be written to the database, logs, or any intermediate storage. Registration_number is stored as plaintext for duplicate checking.

**REQ-ONBOARD-003 [M]:** The system SHALL enforce a KYC document checklist before any supplier invoice can be submitted. Required documents are: certificate_of_incorporation, tax_registration, director_id (minimum 1), signed_supplier_agreement. Invoice submission SHALL return HTTP 422 with error code SUPPLIER_NOT_APPROVED if any document is missing or KYC status is not 'approved'.

**REQ-ONBOARD-004 [M]:** The system SHALL perform sanctions screening on every new supplier and buyer registration against the sanctions list at config/sanctions.json within 10 seconds of registration. A match SHALL set sanctions_flag=true, prevent the entity from transacting, and send a SANCTIONS_MATCH notification to the compliance_officer within 60 seconds.

**REQ-ONBOARD-005 [M]:** The system SHALL write to audit_logs for every KYC status change: KYC_STATUS_CHANGED with reviewer_id, previous_status, new_status, comments, and timestamp. KYC status changes SHALL only be accepted from credit_officer or compliance_officer roles.

**REQ-ONBOARD-006 [M]:** The system SHALL allow a credit_officer to create buyer profiles with: company_name, registration_number, credit_rating (A/B/C/D), approved_limit (BIGINT UGX), payment_score, contact_email, contact_phone, payment_undertaking_signed (BOOLEAN, default false), payment_undertaking_date (TIMESTAMPTZ, set when signed). Initial used_limit SHALL be set to 0 and is_active to true automatically. Buyer status SHALL be set to APPROVED, SUSPENDED, or BLOCKED. No invoice against an unapproved or blocked buyer SHALL be accepted by the system.

**REQ-ONBOARD-007 [M]:** The system SHALL process document uploads within 30 seconds for files up to 10MB. Accepted formats are PDF, JPEG, and PNG only. The system SHALL compute a SHA-256 hash of the file content and store only the encrypted_path and hash — never the plaintext file path.

**REQ-ONBOARD-008 [S]:** The system SHOULD send an email to the supplier within 60 seconds of KYC approval or rejection, including the decision reason. Rejection emails SHALL not include any information that could assist a fraudulent applicant in re-applying.

**REQ-ONBOARD-009 [S]:** The system SHOULD support re-upload of individual KYC documents without requiring re-submission of the entire registration. Replacing a document SHALL log DOCUMENT_REPLACED in audit_logs with the old and new document hashes.

**REQ-ONBOARD-010 [C]:** The system COULD integrate with the Uganda Registration Services Bureau (URSB) API to automatically verify company registration numbers in a future release.

**REQ-ONBOARD-011 [W]:** The system WON'T support individual (non-corporate) supplier registration in this release. All suppliers must be registered legal entities.

**REQ-ONBOARD-012 [M]:** The system SHALL send a welcome email to the supplier within 60 seconds of successful registration, including: login URL, document upload requirements, expected timeline for KYC review, and RIS contact details. The system SHALL also activate the due diligence checklist and notify the account owner of document requirements.

**REQ-ONBOARD-013 [M]:** The system SHALL support reviewer comments on individual KYC documents. Each document SHALL have a comment field. When a reviewer (credit_officer or compliance_officer) adds a comment, the system SHALL automatically email the comment to the supplier's registered email address within 60 seconds. When a supplier uploads additional documents, the system SHALL email an alert to the assigned reviewer. Comments SHALL be immutable once created (database trigger prevents UPDATE/DELETE on document_comments table).

**REQ-ONBOARD-014 [M]:** The system SHALL require explicit consent from the supplier for: (1) URSB registration verification check, (2) litigation screening check, (3) contacting previous buyers/suppliers for references. All three consents must be TRUE before registration is accepted. Consent values SHALL be stored in the suppliers table and audited.

**REQ-ONBOARD-015 [M]:** The system SHALL maintain buyer payment behavior history, recording for each collected invoice: buyer_id, invoice_id, expected_payment_date, actual_payment_date, days_late, amount. The buyer's payment_score SHALL be recalculated automatically when a new payment is recorded, based on the ratio of on-time to late payments across all historical invoices.

**REQ-ONBOARD-016 [M]:** The system SHALL enforce concentration risk limits at the buyer level. If a single buyer's total active exposure (sum of all funded, non-collected invoices) exceeds 25% of RIS's total funded portfolio, the system SHALL flag the invoice for manual review. If exposure exceeds 30%, the system SHALL auto-reject the invoice with error code CONCENTRATION_RISK_EXCEEDED.

---

## Module 3: INTAKE — Invoice Submission

**REQ-INTAKE-001 [M]:** The system SHALL execute a 5-check validation chain on every invoice submission in the following mandatory order, stopping and returning the specific error code on first failure: (1) SUPPLIER_NOT_APPROVED, (2) DUPLICATE_INVOICE, (3) BUYER_NOT_APPROVED, (4) TENOR_OUT_OF_RANGE, (5) CREDIT_LIMIT_EXCEEDED. Each check SHALL complete within 500ms.

**REQ-INTAKE-002 [M]:** The system SHALL validate that the invoice tenor (days between submission date and due_date) is between MIN_INVOICE_TENOR_DAYS (7) and MAX_INVOICE_TENOR_DAYS (90). The error response SHALL include the exact calculated tenor in days to help the supplier understand the rejection.

**REQ-INTAKE-003 [M]:** The system SHALL validate that invoice face_value + buyer.used_limit does not exceed buyer.approved_limit. The HTTP 422 response for CREDIT_LIMIT_EXCEEDED SHALL include remaining_availability (approved_limit - used_limit) to inform the supplier of the maximum submittable amount.

**REQ-INTAKE-004 [M]:** The system SHALL store all monetary values as BIGINT raw UGX integers. Any invoice submission containing a face_value with decimal places SHALL be rejected with HTTP 400 and error INVALID_AMOUNT_FORMAT.

**REQ-INTAKE-005 [M]:** The system SHALL log every individual validation step result to audit_logs as VALIDATION_PASSED or VALIDATION_FAILED with the check name and result details — not just the final pass/fail outcome.

**REQ-INTAKE-006 [M]:** On successful validation, the system SHALL: create the invoice record with status='submitted', compute 72hr_sla_deadline = submission_timestamp + 72 hours, queue a Notice of Assignment email to the buyer via Bull queue, and log INVOICE_SUBMITTED with SHA-256 hash of invoice data.

**REQ-INTAKE-007 [M]:** The system SHALL flag any invoice with face_value exceeding AML_FLAG_THRESHOLD_UGX (100,000,000) within 60 seconds of submission. The flag SHALL: create an AML_FLAG record in audit_logs, notify the compliance_officer, and allow the invoice to proceed but mark it for mandatory manual review.

**REQ-INTAKE-008 [S]:** The system SHOULD respond to POST /invoices/submit within 3 seconds at the 95th percentile, including all 5 validation checks and Bull queue job creation.

**REQ-INTAKE-009 [S]:** The system SHOULD send an SMS confirmation to the supplier's registered mobile number within 2 minutes of successful invoice submission, including invoice reference and expected payment timeline.

**REQ-INTAKE-010 [C]:** The system COULD support bulk invoice submission (up to 10 invoices in a single API call) in a future release, with per-invoice validation results returned in the response.

**REQ-INTAKE-011 [W]:** The system WON'T support invoice submission in currencies other than UGX in this release.

---

## Module 4: VERIFY — Buyer Confirmation & Notice of Assignment

**REQ-VERIFY-001 [M]:** The system SHALL generate a cryptographically random UUID v4 buyer confirmation token for each invoice. The token SHALL be stored as a SHA-256 hash in the database — the raw token SHALL only appear in the confirmation email sent to the buyer's registered contact_email.

**REQ-VERIFY-002 [M]:** The system SHALL enforce a 48-hour expiry on all buyer confirmation tokens. Any confirmation attempt using an expired token SHALL return HTTP 401 with error code TOKEN_EXPIRED and log BUYER_CONFIRMATION_FAILED.

**REQ-VERIFY-003 [M]:** The system SHALL enforce single-use tokens. Once a buyer confirmation token is used, it SHALL be immediately invalidated. Any second use of the same token SHALL return HTTP 401 with error code TOKEN_ALREADY_USED.

**REQ-VERIFY-004 [M]:** The system SHALL enforce that an invoice cannot advance past status='buyer_confirmed' without buyer_confirmed_at being NOT NULL. This SHALL be enforced by a PostgreSQL CHECK constraint at the database level, independent of application code.

**REQ-VERIFY-005 [M]:** On successful buyer confirmation, the system SHALL: update invoice status to 'buyer_confirmed', record buyer_confirmed_at timestamp, generate and store the Notice of Assignment document (SHA-256 hash stored in invoice_documents), queue risk scoring via Bull, and log BUYER_CONFIRMED with the confirming IP address and user_agent.

**REQ-VERIFY-006 [M]:** The system SHALL send a post-confirmation summary email to the buyer within 60 seconds of confirmation, detailing: invoice reference, face_value, due_date, and RIS bank details for payment at maturity. This email constitutes part of the non-repudiation evidence chain.

**REQ-VERIFY-007 [M]:** The system SHALL send automated follow-up reminders to the buyer if the confirmation token has not been used: first reminder at T+2 days after issuance, second reminder at T+5 days after issuance. If the buyer has not responded after the token expires (48 hours from issuance), the system SHALL flag the invoice as CONFIRMATION_OVERDUE and notify the credit_officer for manual follow-up. Note: these are buyer verification reminders (T+2/T+5 from token issuance), distinct from the collections reminders in Module 9 (T-7/T-3/T+0/T+1/T+3/T+7 relative to invoice due date).

**REQ-VERIFY-008 [S]:** The system SHOULD generate the Notice of Assignment as a PDF document using the supplier's and buyer's registered details, with RIS letterhead, and store it encrypted in the document store.

**REQ-VERIFY-009 [C]:** The system COULD support WhatsApp delivery of the buyer confirmation link via Africa's Talking WhatsApp API as an alternative to email, for buyers without reliable email access.

**REQ-VERIFY-010 [W]:** The system WON'T allow buyers to partially confirm an invoice (confirm some line items but not others) in this release.

**REQ-VERIFY-011 [M]:** The system SHALL support buyer dispute routing during the confirmation process. If a buyer disputes an invoice (via the public confirmation page), the system SHALL: record the dispute reason and type (amount, validity, delivery, other), flag the invoice as DISPUTED, route the dispute to the credit_officer and legal role for resolution, and notify the supplier that a dispute has been raised. The invoice SHALL NOT advance past submitted status until the dispute is resolved. Dispute records SHALL be immutable and audited.

---

## Module 5: RISK — Risk Scoring Engine

**REQ-RISK-001 [M]:** The system SHALL score every confirmed invoice using exactly 5 factors with the following fixed weights: buyer_credit_score (0.30, HIGH — primary risk driver), tenor_score (0.10, MEDIUM), supplier_track_record (0.25, MEDIUM), concentration_risk (0.15, MEDIUM), collateral_score (0.20, HIGH — security coverage). The sum of weights SHALL equal 1.0. These weights reflect the workflow document's risk hierarchy where buyer credit and collateral are HIGH-weight factors.

**REQ-RISK-002 [M]:** The system SHALL compute the final risk score as the weighted sum of all 5 factor scores, rounded to the nearest integer. The system SHALL store all 5 individual factor scores AND the final weighted score in the risk_scores table.

**REQ-RISK-003 [M]:** The system SHALL determine recommendation based on final score: score ≥ 75 → AUTO_APPROVE, score 50–74 → REFER_TO_MANAGER, score < 50 → REJECT. On REJECT, the system SHALL update invoice status to 'rejected' and notify the supplier with the rejection reason within 60 seconds.

**REQ-RISK-004 [M]:** The system SHALL determine max_advance_pct: score ≥ 75 → 95%, score 60–74 → 90%, score 50–59 → 85%, score < 50 → 0%. The system SHALL determine risk_premium: score ≥ 75 → 0%, score 65–74 → 0.5%, score 55–64 → 1.0%, score 50–54 → 1.5%.

**REQ-RISK-005 [M]:** The system SHALL complete risk scoring within 5 seconds of the Bull job being picked up, including all database queries for buyer utilisation, supplier track record, and collateral data.

**REQ-RISK-006 [M]:** The system SHALL write INVOICE_SCORED to audit_logs including all 5 individual factor scores, the final score, recommendation, max_advance_pct, and risk_premium before returning.

**REQ-RISK-007 [M]:** The system SHALL produce exactly the following results for the Developer Handbook Worked Example 1: buyer_score=22.5, tenor_score=15.0, track_record=20.0, concentration=11.25, collateral=9.0, final=78, recommendation=AUTO_APPROVE, max_advance=95%, risk_premium=0.5%.

**REQ-RISK-008 [S]:** The system SHOULD recalculate concentration_risk in real time when a new invoice is submitted by the same supplier to the same buyer, reflecting the updated buyer utilisation including the pending invoice.

**REQ-RISK-009 [C]:** The system COULD support a configurable scoring model where factor weights can be adjusted by management without code deployment, subject to the constraint that weights must sum to 1.0.

**REQ-RISK-010 [W]:** The system WON'T use machine learning models for risk scoring in this release. All scoring is deterministic and rule-based.

---

## Module 6: PRICE — Discount Rate Calculation

**REQ-PRICE-001 [M]:** The system SHALL calculate the total discount rate using the formula: Total_Discount_Rate = (Bank_Cost_of_Funds% + Risk_Premium% + RIS_Margin%) × (Tenor_Days / 365). All intermediate calculations SHALL use sufficient precision to avoid rounding errors. Final monetary amounts SHALL be rounded to the nearest integer UGX.

**REQ-PRICE-002 [M]:** The system SHALL compute: advance_amount = face_value × max_advance_pct, discount_amount = face_value × total_discount_rate, net_payment_to_supplier = advance_amount − discount_amount. All calculations SHALL use integer arithmetic on BIGINT values — no floating point in final monetary amounts.

**REQ-PRICE-003 [M]:** The system SHALL store all pricing components in the risk_scores record: bank_cost_rate, risk_premium_rate, mms_margin_rate, total_discount_rate, advance_amount, discount_amount, net_payment_to_supplier, vat_amount, wht_amount.

**REQ-PRICE-004 [M]:** The system SHALL produce exactly the following results for Developer Handbook Worked Example 1 (±1 UGX rounding tolerance): advance=47,500,000, discount=1,325,342, net_payment=46,174,658, bank_interest_cost=1,053,082, mms_net_profit=272,260.

**REQ-PRICE-005 [M]:** The system SHALL generate a transparent fee breakdown for supplier display showing: face_value, advance_amount, discount_amount, VAT on discount, WHT deducted, net_payment_after_deductions, and payment method details.

**REQ-PRICE-006 [M]:** The system SHALL complete pricing calculation within 2 seconds of the Bull job being picked up, including facility rate lookup and buyer margin retrieval.

**REQ-PRICE-007 [S]:** The system SHOULD support per-buyer RIS margin rate overrides (default 3% annual) configurable by the finance_manager role, stored in the buyers table as mms_margin_override.

**REQ-PRICE-008 [C]:** The system COULD generate a pricing sensitivity analysis showing the supplier the net payment at three scenarios: current score, score +5, score −5, to illustrate the financial benefit of collateral improvement.

**REQ-PRICE-009 [W]:** The system WON'T support dynamic pricing that adjusts discount rates in real time based on market conditions in this release.

**REQ-PRICE-010 [M]:** The system SHALL present a clear pricing breakdown to the supplier before funding proceeds, showing: face_value, advance_percentage, advance_amount, discount_percentage, discount_amount, VAT on discount, WHT deducted, net_payment_to_supplier. The supplier SHALL explicitly accept or reject the pricing terms. Acceptance SHALL be recorded as a timestamped event (pricing_accepted_at, pricing_accepted_by) in the database. The approval workflow SHALL NOT proceed unless pricing has been accepted by the supplier. If the supplier rejects pricing, the system SHALL record the rejection reason and notify the credit_officer.

**REQ-PRICE-011 [M]:** The pricing formula SHALL be: Discount = (Cost of Funds + Risk Premium + RIS Margin) x (Tenor / 365). Example calculation per workflow document: Bank interest 18% annualized + Risk premium 2% + RIS margin 3% = 23% total. For 60-day tenor on 100,000,000 UGX invoice at 95% advance: advance = 95,000,000 UGX, discount = 5,000,000 UGX, net to supplier = 90,000,000 UGX.

---

## Module 7: APPROVE — 3-Tier Approval Workflow

**REQ-APPROVE-001 [M]:** The system SHALL route every scored invoice to one of four approval tiers based on risk and value: (1) TIER_1 AUTO — face_value < 10,000,000 AND score >= 75 AND no AML flags: system auto-approves within limits; (2) TIER_2 — face_value 10M-50M OR score 50-74 OR AML flag: Credit Manager review and sign-off; (3) TIER_3 — face_value > 50M OR score < 50 OR manual escalation: full Credit Committee with quorum of 2 required; (4) TIER_4 — face_value > 200M OR score < 30 OR disputed invoices: Legal & Compliance Officer involvement required alongside management approval. Each tier SHALL enforce that approval is logged by an authorized role before payment is triggered.

**REQ-APPROVE-002 [M]:** The system SHALL auto-approve TIER_1 invoices without human intervention, creating an approval record with approver_id='SYSTEM' and comments='Auto-approved: score [X], value [Y]', and triggering the payment engine via Bull queue within 30 seconds.

**REQ-APPROVE-003 [M]:** The system SHALL prevent concurrent approval of the same TIER_2 invoice by two credit officers using SELECT FOR UPDATE on the invoice record. The first officer to open the invoice SHALL lock it exclusively. Any subsequent attempt by another officer SHALL return HTTP 409 with INVOICE_LOCKED.

**REQ-APPROVE-004 [M]:** The system SHALL enforce minimum 20-character written comments on all TIER_2 and TIER_3 approval and rejection decisions, validated at the Joi schema level before any database write.

**REQ-APPROVE-005 [M]:** The system SHALL require exactly 2 separate credit officers for TIER_3 approval. A single officer SHALL be unable to provide both approvals. The system SHALL only trigger payment when quorum (2 approvals) is reached. A single rejection SHALL NOT auto-reject — MD can override with documented reason.

**REQ-APPROVE-006 [M]:** The system SHALL write to audit_logs for every approval decision: INVOICE_APPROVED or INVOICE_REJECTED with approver_id, tier, comments_hash, and timestamp. All decisions SHALL be immutable once recorded.

**REQ-APPROVE-007 [M]:** The system SHALL send an escalation alert to management if any invoice remains in the approval queue for more than 24 hours without a decision, logging SLA_BREACH_APPROVAL.

**REQ-APPROVE-008 [S]:** The system SHOULD notify all available credit officers within 5 minutes of a new TIER_2 invoice entering the approval queue, via email and in-app notification.

**REQ-APPROVE-009 [C]:** The system COULD support an approval delegation mechanism where a credit officer can formally delegate their approval authority to a named colleague during leave, subject to management approval.

**REQ-APPROVE-010 [W]:** The system WON'T support approval via SMS or WhatsApp in this release. All approvals must be made through the authenticated web interface.

---

## Module 8: PAYMENT — Dual Auth, SLA & Multi-Rail Execution

**REQ-PAYMENT-001 [M]:** The system SHALL create a payment instruction with status='pending_first_auth' on invoice approval, recording: amount=net_payment_to_supplier, provider=supplier.preferred_payment_method, idempotency_key=UUID v4, dual_auth_user_1=null, dual_auth_user_2=null, 72hr_sla_deadline.

**REQ-PAYMENT-002 [M]:** The system SHALL record first authorisation from a finance_manager: set dual_auth_user_1=userId, dual_auth_timestamp_1=now(), status='pending_second_auth'. The system SHALL immediately reject the authorisation if the authorising user_id matches dual_auth_user_2 (where set), returning HTTP 403 with SAME_USER_DUAL_AUTH.

**REQ-PAYMENT-003 [M]:** The system SHALL enforce dual authorisation at three independent layers: (1) application service validation, (2) PostgreSQL CHECK constraint (dual_auth_user_1 ≠ dual_auth_user_2), (3) payment provider API rejection of single-authorised requests. All three layers SHALL independently enforce this constraint.

**REQ-PAYMENT-004 [M]:** The system SHALL pass the idempotency_key to the payment provider on every execution attempt. Before executing, the system SHALL check for an existing payment with the same idempotency_key and return the previous result without re-executing, preventing double payments on retry.

**REQ-PAYMENT-005 [M]:** On payment execution failure, the system SHALL: set status='failed', log PAYMENT_FAILED with the full provider error to audit_logs, notify the finance_manager, and NOT retry automatically without manual intervention. The idempotency_key SHALL be preserved for safe manual retry.

**REQ-PAYMENT-006 [M]:** The system SHALL send SMS and email to the supplier within 5 minutes of status='funded', including: amount disbursed, transaction reference, provider reference, and expected mobile money arrival time.

**REQ-PAYMENT-007 [M]:** The system SHALL run a Bull cron job every 30 minutes checking for invoices where 72hr_sla_deadline is within 6 hours and status is not 'funded'. Each such invoice SHALL trigger an URGENT escalation to MD and log SLA_BREACH_RISK.

**REQ-PAYMENT-008 [M]:** The system SHALL verify HMAC-SHA256 signatures on all incoming MTN MoMo and Airtel webhook payloads before processing. Invalid signatures SHALL return HTTP 401 and log WEBHOOK_SIGNATURE_INVALID.

**REQ-PAYMENT-009 [S]:** The system SHOULD generate a Uganda ACH-format payment instruction file for EFT payments, conforming to the Bank of Uganda interbank settlement format.

**REQ-PAYMENT-010 [S]:** The system SHOULD support a payment kill switch accessible only to management role that immediately halts all payment processing and suspends all executing payments with a single action, logging KILL_SWITCH_ACTIVATED.

**REQ-PAYMENT-011 [C]:** The system COULD support scheduled future-dated payments for EFT where the payment instruction is prepared in advance and submitted to the bank at a specified future time.

**REQ-PAYMENT-012 [W]:** The system WON'T support cryptocurrency payments in this release.

---

## Module 9: COLLECT — Reminders, Escalation & Penalty

**REQ-COLLECT-001 [M]:** The system SHALL execute Bull cron jobs for the following reminder schedule: T−7 days (email + SMS to buyer), T−3 days (email + SMS + WhatsApp if configured), T=due date at 08:00 EAT (final reminder), T+1 day (mark overdue, create collections record, notify credit_officer), T+3 days (formal demand notice, escalate to credit_manager), T+7 days (escalate to MD, initiate legal notice, SAR review if above AML threshold).

**REQ-COLLECT-002 [M]:** The system SHALL calculate penalty using integer arithmetic: penalty = face_value × daily_penalty_rate × days_overdue. Default daily_penalty_rate = 0.001 (0.1%). Penalty SHALL be stored in the collections table and charged to the buyer — never deducted from the supplier's original payment.

**REQ-COLLECT-003 [M]:** The system SHALL produce exactly penalty = 700,000 UGX for: face_value=50,000,000, days_overdue=14, daily_rate=0.1%.

**REQ-COLLECT-004 [M]:** On payment received from buyer, the system SHALL atomically within a single database transaction: record amount_received and received_date, reduce buyer.used_limit by face_value, update invoice status='collected', and queue bank facility repayment calculation. Any failure SHALL rollback all changes.

**REQ-COLLECT-005 [M]:** The system SHALL flag any overdue invoice for SAR review if face_value exceeds AML_FLAG_THRESHOLD_UGX and the invoice is more than 7 days overdue, logging SAR_REVIEW_REQUIRED in audit_logs.

**REQ-COLLECT-006 [M]:** The system SHALL write to audit_logs for every collection event: REMINDER_SENT, INVOICE_OVERDUE, DEMAND_NOTICE_SENT, LEGAL_ESCALATION, PAYMENT_RECEIVED, with the responsible action trigger (cron job ID or user ID).

**REQ-COLLECT-007 [S]:** The system SHOULD generate a formal demand letter PDF for T+3 overdue invoices using buyer and invoice details, stored encrypted and accessible to the credit_manager and management roles.

**REQ-COLLECT-008 [C]:** The system COULD integrate with a Uganda-licensed debt collection agency API in a future release, automatically referring invoices overdue more than 90 days.

**REQ-COLLECT-009 [W]:** The system WON'T support instalment-based collection (partial payments against a single invoice) in this release. Collection is treated as full payment only.

**REQ-COLLECT-010 [M]:** The system SHALL automatically transition a collection to 'defaulted' status when: the invoice has been overdue for more than 90 days AND the escalation level has reached level 3 (legal). Default SHALL: update invoice status to 'defaulted', trigger collateral enforcement review, notify finance_manager and management, and log INVOICE_DEFAULTED in audit_logs. The full_recourse flag on the invoice enables RIS to pursue the supplier for recovery — this is a manual process initiated by finance_manager.

---

## Module 10: FACILITY — Bank Facility Management

**REQ-FACILITY-001 [M]:** The system SHALL automatically create a drawdown record against a bank facility when a payment transitions to 'funded' status. The drawdown SHALL be triggered by the payment module via a facility-drawdown queue job. The system SHALL match facility maturity to invoice due date (facility_maturity_date >= invoice_due_date), reject the drawdown with TENOR_MISMATCH if no eligible facility exists, record the invoice_id against the drawdown for reconciliation, and begin interest accrual from the drawdown date. The system SHALL also check facility utilisation before payment initiation — if the drawdown would cause utilisation to exceed 90%, the payment SHALL be blocked with error FACILITY_UTILISATION_EXCEEDED.

**REQ-FACILITY-002 [M]:** The system SHALL run a Bull cron job at 00:00 EAT daily, computing daily_interest = principal × (annual_rate / 365) for each active drawdown using integer arithmetic, and accumulating to accrued_interest in the facility_drawdowns table.

**REQ-FACILITY-003 [M]:** The system SHALL produce exactly: utilisation=49.5%, daily_interest=488,219 UGX for Developer Handbook Worked Example 3 (facility_limit=2,000,000,000, drawn=990,000,000, annual_rate=18%).

**REQ-FACILITY-004 [M]:** The system SHALL monitor facility utilisation and trigger: ≥80% → email to finance_manager, ≥90% → email to MD AND set facility status='suspended' preventing new drawdowns, maturity−5 days → email to finance_manager to arrange repayment or renewal.

**REQ-FACILITY-005 [M]:** On buyer payment received, the system SHALL calculate repayment = principal + accrued_interest + bank_fees and atomically update drawn_amount and create a repayment record within a single database transaction. Rollback SHALL occur if either update fails.

**REQ-FACILITY-006 [M]:** The system SHALL write to audit_logs for every facility event: DRAWDOWN_CREATED, INTEREST_ACCRUED, FACILITY_SUSPENDED, REPAYMENT_RECORDED, MATURITY_ALERT.

**REQ-FACILITY-007 [S]:** The system SHOULD provide a facility dashboard visible to finance_manager and management showing all facilities with: utilisation%, days to maturity, total accrued interest, available capacity, and total funded portfolio per facility.

**REQ-FACILITY-008 [C]:** The system COULD support multiple bank facilities simultaneously, with automatic selection of the optimal facility (lowest rate, best maturity match) for each invoice drawdown.

**REQ-FACILITY-009 [W]:** The system WON'T support foreign-currency bank facilities in this release. All facilities are denominated in UGX.

---

## Module 12: COLLATERAL — Security Recording & Enforcement

> **Source:** Workflow Document Stage 10. Before payment is released, collateral details are recorded and verified. The system alerts if collateral coverage is insufficient. Insufficient coverage blocks disbursement.

**REQ-COLLATERAL-001 [M]:** The system SHALL support recording the following collateral types against an invoice or supplier: post-dated cheques (must match invoice maturity), bank guarantees, fixed deposit lien, corporate guarantees, assignment of receivables, and performance bonds. Each collateral record SHALL include: collateral_type, value (BIGINT UGX), description, expiry_date, and enforceability status (is_active).

**REQ-COLLATERAL-002 [M]:** The system SHALL compute a collateral coverage ratio for each invoice: coverage_ratio = SUM(active collateral value for invoice) / invoice face_value. Minimum required coverage ratios: post-dated cheques = 100%, bank guarantees = 50%, fixed deposit lien = 50%, corporate guarantees = 50%, assignment of receivables = 50%, performance bonds = 50%. The system SHALL set invoices.collateral_coverage_met = true only when the ratio meets or exceeds the minimum for the applicable collateral type.

**REQ-COLLATERAL-003 [M]:** The system SHALL block payment disbursement if collateral_coverage_met = false on the invoice. The payment initiation endpoint SHALL return HTTP 422 with error code COLLATERAL_INSUFFICIENT, including the current coverage ratio and the required minimum. This check SHALL be enforced in the payment service layer before creating the payment instruction.

**REQ-COLLATERAL-004 [M]:** The system SHALL run a scheduled job daily to check for collateral nearing expiry. Collateral expiring within 30 days SHALL trigger an email alert to the finance_manager. Collateral expiring within 7 days SHALL trigger an URGENT alert to both finance_manager and management. Expired collateral SHALL be automatically deactivated (is_active=false) and the invoice's collateral_coverage_met recalculated.

**REQ-COLLATERAL-005 [M]:** The system SHALL write to audit_logs for every collateral event: COLLATERAL_CREATED, COLLATERAL_UPDATED, COLLATERAL_DEACTIVATED, COLLATERAL_EXPIRED, COLLATERAL_COVERAGE_CHECK with coverage ratio and result. Collateral records linked to funded invoices SHALL NOT be deleted.

**REQ-COLLATERAL-006 [M]:** The system SHALL enforce supplier ownership on all collateral operations — a supplier can only view, create, update, or delete collateral linked to their own invoices. SQL queries SHALL include AND supplier_id = $supplierId in all collateral queries.

**REQ-COLLATERAL-007 [S]:** The system SHOULD support collateral document attachments (scanned copies of cheques, guarantee letters, lien confirmations) encrypted and stored using the same document upload mechanism as KYC documents.

**REQ-COLLATERAL-008 [W]:** The system WON'T support automated collateral valuation or appraisal in this release. All collateral values are entered manually by the credit_officer or finance_manager.

---

## Module 13: SETTLEMENT — Profit Booking & Cycle Closure

> **Source:** Workflow Document Stage 13. When the buyer pays RIS at maturity, the system automatically repays the bank facility, accrues interest, and books the net profit per invoice. This is the final stage that closes the financing cycle.

**REQ-SETTLE-001 [M]:** The system SHALL initiate settlement automatically when a buyer payment is recorded and the collection status transitions to 'collected'. Settlement initiation SHALL: create a settlement record linking the invoice, collection, and facility drawdown; record the buyer_payment_amount (BIGINT UGX); and set settlement status to 'pending'.

**REQ-SETTLE-002 [M]:** The system SHALL repay the bank facility as part of settlement. Repayment amount = drawdown principal + accrued_interest + bank_fees. The system SHALL atomically within a single database transaction: update the facility drawdown status to 'repaid', reduce the facility drawn_amount, record the facility_repayment_amount, and update the settlement status to 'facility_repaid'. The settlement SHALL reference the specific drawdown_id for reconciliation.

**REQ-SETTLE-003 [M]:** The system SHALL book profit after facility repayment. Profit calculation: net_profit = discount_earned - bank_cost_paid + penalty_income (if any penalties collected from buyer). The system SHALL create an immutable profit_bookings record with: discount_earned, bank_cost_paid, penalty_income, net_profit, booked_by (user_id), booked_at (timestamp). Profit bookings table SHALL have database triggers preventing UPDATE and DELETE.

**REQ-SETTLE-004 [M]:** The system SHALL close the settlement after profit is booked. Closing SHALL: update settlement status to 'closed', set settled_at timestamp, notify the supplier that "Your invoice financing cycle is complete" with a summary (invoice reference, face_value, amount received, collection date), and finalize the audit trail. A closed settlement SHALL have a minimum of 14 audit_log entries covering the full lifecycle from submission to closure.

**REQ-SETTLE-005 [M]:** The system SHALL store all settlement monetary values as BIGINT UGX. The sample economics from the workflow document SHALL be reproducible: Invoice face value 100,000,000 UGX, RIS payment to supplier (95%) = 95,000,000 UGX, RIS gross margin = 5,000,000 UGX, Bank interest (60 days) = 1,200,000 UGX, Net RIS profit = 3,800,000 UGX.

**REQ-SETTLE-006 [M]:** The system SHALL write to audit_logs for every settlement event: SETTLEMENT_INITIATED, FACILITY_REPAID, PROFIT_BOOKED, SETTLEMENT_CLOSED. Each entry SHALL include the settlement_id, invoice_id, amounts involved, and the user who performed the action. The SETTLEMENT_CLOSED audit entry SHALL be the final entry in the invoice's lifecycle, marking the audit trail as complete.

**REQ-SETTLE-007 [M]:** Settlement status flow SHALL be strictly enforced: pending -> facility_repaid -> profit_booked -> closed. No status may be skipped. Only finance_manager role can initiate settlement and repay facility. Only finance_manager can book profit. Only management can close settlement. Each transition SHALL be recorded in audit_logs.

**REQ-SETTLE-008 [S]:** The system SHOULD provide a settlement dashboard (management, finance_manager, auditor) showing: total settlements this period, total profit booked, average profit per invoice, facility repayment totals, and pending settlements awaiting closure.

**REQ-SETTLE-009 [W]:** The system WON'T support partial settlement (buyer pays less than face value) in this release. Settlement is treated as full payment only — partial payments are handled by the collections module.

---

## Module 11: REPORT — Portfolio, Aging & Audit Export

**REQ-REPORT-001 [M]:** The system SHALL enforce role-based data access at the SQL query level for all reports — data filtering SHALL occur inside the WHERE clause of the database query, never in application code after a full-data fetch.

**REQ-REPORT-002 [M]:** The system SHALL provide a Portfolio Summary report (management, auditor) showing: total funded amount, total collected, total outstanding, total overdue, annualised portfolio yield, invoice count by status, and top 5 buyers by exposure.

**REQ-REPORT-003 [M]:** The system SHALL provide an Aging Analysis report (credit_officer, management, auditor) grouping invoices by days to maturity: Current (31+ days), Watch (8–30 days), Critical (1–7 days), Due Today, Overdue 1–7 days, Overdue 7+ days.

**REQ-REPORT-004 [M]:** The system SHALL provide an Audit Trail Export (auditor only) of all audit_log entries, filterable by date range, user_id, and action_type, exportable to CSV. The query SHALL use a read-only PostgreSQL database role with SELECT-only privilege on audit_logs.

**REQ-REPORT-005 [M]:** The system SHALL provide a Regulatory Report (compliance_officer, management) showing: AML flags raised, SARs filed, transactions above threshold, KYC approval and rejection rates, exportable in CSV and PDF.

**REQ-REPORT-006 [M]:** The system SHALL return all report data within 10 seconds at the 95th percentile for a dataset of up to 10,000 invoices. Reports exceeding this dataset size SHALL be generated asynchronously and delivered via email.

**REQ-REPORT-007 [M]:** The system SHALL return HTTP 403 immediately if a user requests a report for which their role does not have access, before any database query is executed, and log UNAUTHORISED_REPORT_ACCESS.

**REQ-REPORT-008 [S]:** The system SHOULD provide a Profit Per Invoice report (finance_manager, management) showing: face_value, discount_amount, bank_interest_cost, net_mms_profit, profit_margin_pct — both per invoice and aggregated by period.

**REQ-REPORT-009 [S]:** The system SHOULD provide a Bank Facility Report (finance_manager, management) showing: all facilities, utilisation%, accrued interest, upcoming maturities, and repayment schedule.

**REQ-REPORT-010 [C]:** The system COULD support scheduled reports sent automatically to nominated email addresses daily, weekly, or monthly for management and compliance purposes.

**REQ-REPORT-011 [W]:** The system WON'T support real-time dashboard streaming (WebSocket-based live updates) in this release. All reports are point-in-time snapshots.

**REQ-REPORT-012 [M]:** The system SHALL provide an Applications Received report (credit_officer, management) showing: all invoice submissions by date, supplier, amount, and current status (submitted, under review, approved, rejected, funded).

**REQ-REPORT-013 [M]:** The system SHALL provide an Incomplete Applications report (credit_officer, compliance_officer) showing: suppliers with missing KYC documents, incomplete eligibility checks, and pending document comments awaiting supplier response.

**REQ-REPORT-014 [M]:** The system SHALL provide a Disbursed Funds report (finance_manager, management) showing: all funded invoices with amounts, payment dates, payment channels, and supplier details.

**REQ-REPORT-015 [M]:** The system SHALL provide a Company Financial Performance (P&L) report (management, auditor) showing: profit per invoice, portfolio yield, aging analysis, total discount fees earned, total bank interest costs, and net RIS profit by period.

**REQ-REPORT-016 [M]:** The system SHALL provide a Bank Facility Utilization report (finance_manager, management) showing: all facilities with drawdowns, interest accruals, repayments, available balance, and utilization percentage.

---

## Requirements Summary

| Module       | Must   | Should | Could  | Won't  | Total   |
| ------------ | ------ | ------ | ------ | ------ | ------- |
| ELIGIBILITY  | 5      | 1      | 0      | 1      | 7       |
| AUTH         | 6      | 2      | 1      | 1      | 10      |
| ONBOARD      | 12     | 2      | 1      | 1      | 16      |
| INTAKE       | 7      | 2      | 1      | 1      | 11      |
| VERIFY       | 7      | 1      | 1      | 1      | 10      |
| RISK         | 7      | 1      | 1      | 1      | 10      |
| PRICE        | 8      | 1      | 1      | 1      | 11      |
| APPROVE      | 7      | 1      | 1      | 1      | 10      |
| PAYMENT      | 8      | 2      | 1      | 1      | 12      |
| COLLECT      | 7      | 1      | 1      | 1      | 10      |
| FACILITY     | 6      | 1      | 1      | 1      | 9       |
| COLLATERAL   | 6      | 1      | 0      | 1      | 8       |
| SETTLEMENT   | 7      | 1      | 0      | 1      | 9       |
| REPORT       | 12     | 2      | 1      | 1      | 16      |
| **Total**    | **105**| **20** | **11** | **14** | **150** |

---

## Traceability Matrix

| Requirement              | SEC Reference      | COMP Reference       | STRIDE Threat       | Workflow Stage |
| ------------------------ | ------------------ | -------------------- | ------------------- | -------------- |
| REQ-ELIG-001 to 005      | —                  | COMP-FIA-009         | —                   | Stage 1        |
| REQ-AUTH-001 to 008      | SEC-001 to SEC-010 | —                    | THREAT-S-001, S-002 | —              |
| REQ-ONBOARD-001 to 016   | SEC-019            | COMP-FIA-009, COMP-PDPA-003 | THREAT-I-003  | Stages 2, 3, 4 |
| REQ-ONBOARD-002          | SEC-019            | COMP-PDPA-018        | THREAT-I-003        | Stage 2        |
| REQ-ONBOARD-012          | —                  | —                    | —                   | Stage 2        |
| REQ-ONBOARD-013          | —                  | —                    | —                   | Stage 3        |
| REQ-ONBOARD-014          | —                  | COMP-PDPA-003        | —                   | Stage 2        |
| REQ-ONBOARD-016          | —                  | COMP-BOU-007         | —                   | Stage 4        |
| REQ-INTAKE-001 to 007    | SEC-050, SEC-051   | COMP-FIA-004         | —                   | Stage 5        |
| REQ-VERIFY-001 to 011    | SEC-037            | —                    | THREAT-T-001        | Stage 6        |
| REQ-VERIFY-011           | —                  | —                    | —                   | Stage 6        |
| REQ-RISK-001 to 007      | —                  | —                    | —                   | Stage 7        |
| REQ-PRICE-001 to 011     | —                  | COMP-URA-001 to 003  | —                   | Stage 8        |
| REQ-PRICE-010            | —                  | —                    | —                   | Stage 8        |
| REQ-APPROVE-001 to 007   | SEC-036, SEC-037   | —                    | THREAT-T-001        | Stage 9        |
| REQ-COLLATERAL-001 to 006| —                  | —                    | —                   | Stage 10       |
| REQ-PAYMENT-001 to 008   | SEC-036 to SEC-042 | —                    | THREAT-T-001, T-002 | Stage 11       |
| REQ-COLLECT-001 to 010   | SEC-050            | COMP-FIA-004, FIA-014| —                   | Stage 12       |
| REQ-FACILITY-001 to 006  | —                  | COMP-BOU-009         | —                   | Stage 11       |
| REQ-SETTLE-001 to 007    | SEC-028, SEC-029   | COMP-URA-011         | —                   | Stage 13       |
| REQ-REPORT-001 to 016    | SEC-013, SEC-014   | COMP-BOU-010, BOU-011| THREAT-I-001        | Reporting      |

---

## Sign-off

| Role               | Name | Signature | Date |
| ------------------ | ---- | --------- | ---- |
| CTO                |      |           |      |
| Product Owner      |      |           |      |
| Compliance Officer |      |           |      |
| Managing Director  |      |           |      |
