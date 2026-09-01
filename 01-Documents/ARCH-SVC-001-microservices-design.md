# RIS Platform — Microservices Design

**Document ID:** ARCH-SVC-001  
**Version:** 1.0  
**Date:** March 2026  
**Owner:** CTO

**Core Principle:** Each service owns its tables exclusively. No other service may query those tables directly — only through the owning service's API or Bull queue events.

---

## Service 1: Auth Service

**Single Responsibility:** Authenticate users and issue/validate JWT tokens.

**Security Level:** 🔒 Internal

**Database Tables Owned (exclusive):**

- `users` — user credentials, roles, lockout state
- `sessions` — active session tracking in Redis (not PostgreSQL)

**API Endpoints Exposed:**

| Method | Path             | Roles              | Rate Limited  |
| ------ | ---------------- | ------------------ | ------------- |
| POST   | /auth/login      | Public             | 10/min per IP |
| POST   | /auth/2fa/verify | Partial auth token | 5/min per IP  |
| POST   | /auth/logout     | Any authenticated  | No            |
| POST   | /auth/refresh    | Refresh token      | No            |

**Events Published:** None (synchronous only)  
**Events Consumed:** None  
**External Dependencies:** Redis (session blacklist, rate limiting)

**Access Control:**

- Login endpoint: public (no JWT required)
- All other endpoints: requires valid partial_auth or full JWT

---

## Service 2: Onboarding Service (KYC/KYB)

**Single Responsibility:** Manage supplier registration, KYC document collection, buyer profile creation, and sanctions screening.

**Security Level:** 🔒 Internal (registration endpoint public-facing via gateway)

**Database Tables Owned (exclusive):**

- `suppliers` — supplier profiles, KYC status, encrypted PII
- `buyers` — buyer profiles, credit limits, payment history
- `invoice_documents` — encrypted document paths and hashes

**API Endpoints Exposed:**

| Method | Path                            | Roles                                              |
| ------ | ------------------------------- | -------------------------------------------------- |
| POST   | /suppliers/register             | Public                                             |
| GET    | /suppliers/:id                  | supplier (own only), credit_officer, management    |
| PUT    | /suppliers/:id/documents        | supplier (own only)                                |
| GET    | /suppliers/:id/documents        | supplier (own), credit_officer, compliance_officer |
| PUT    | /admin/suppliers/:id/kyc-status | credit_officer, compliance_officer                 |
| GET    | /admin/suppliers                | credit_officer, compliance_officer, management     |
| POST   | /admin/buyers                   | credit_officer                                     |
| GET    | /admin/buyers                   | credit_officer, management                         |
| GET    | /admin/buyers/:id               | credit_officer, management                         |
| PUT    | /admin/buyers/:id               | credit_officer                                     |

**Events Published:**

- `onboarding.kyc_approved` → Invoice Service (supplier now eligible to submit)
- `onboarding.sanctions_match` → Notification Service (alert compliance_officer)

**Events Consumed:** None  
**External Dependencies:** config/sanctions.json (sanctions list)

---

## Service 3: Invoice Service

**Single Responsibility:** Accept invoice submissions, run 5-check validation chain, manage invoice lifecycle status.

**Security Level:** 🔒 Internal

**Database Tables Owned (exclusive):**

- `invoices` — invoice records, status, validation results, SLA deadlines

**API Endpoints Exposed:**

| Method | Path                   | Roles                                      |
| ------ | ---------------------- | ------------------------------------------ |
| POST   | /invoices/submit       | supplier                                   |
| GET    | /invoices              | supplier (own), credit_officer, management |
| GET    | /invoices/:id          | supplier (own), credit_officer, management |
| GET    | /invoices/:id/timeline | supplier (own), credit_officer, management |

**Events Published:**

- `invoice.submitted` → Notification Service (buyer confirmation email)
- `invoice.buyer_confirmed` → Risk Engine Service (trigger scoring)
- `invoice.rejected` → Notification Service (supplier rejection notice)

**Events Consumed:**

- `onboarding.kyc_approved` (updates eligible supplier list cache)

**External Dependencies:**

- Calls Onboarding Service to validate supplier KYC status and buyer credit limit

---

## Service 4: Risk Engine Service

**Single Responsibility:** Score invoices using 5-factor weighted algorithm and determine approval recommendation.

**Security Level:** 🔒 Internal (no direct external access)

**Database Tables Owned (exclusive):**

- `risk_scores` — individual factor scores, final score, recommendation, max_advance_pct, risk_premium

**API Endpoints Exposed:**

| Method | Path                     | Roles                      |
| ------ | ------------------------ | -------------------------- |
| GET    | /invoices/:id/risk-score | credit_officer, management |

**Events Published:**

- `risk.scored` → Pricing Service (trigger pricing calculation)
- `risk.rejected` → Notification Service (supplier rejection with score details)

**Events Consumed:**

- `invoice.buyer_confirmed` → triggers scoring job

**External Dependencies:**

- Calls Onboarding Service for buyer credit rating and supplier track record
- Reads collateral data from Invoice Service

---

## Service 5: Approval Service

**Single Responsibility:** Route scored invoices to correct approval tier and manage human approval workflow.

**Security Level:** 🔒 Internal

**Database Tables Owned (exclusive):**

- `approvals` — approval records, tier, officer identity, comments, timestamps

**API Endpoints Exposed:**

| Method | Path                  | Roles                      |
| ------ | --------------------- | -------------------------- |
| POST   | /invoices/:id/approve | credit_officer, management |
| POST   | /invoices/:id/reject  | credit_officer, management |
| GET    | /approvals/queue      | credit_officer, management |
| GET    | /approvals/:id        | credit_officer, management |

**Events Published:**

- `approval.approved` → Payment Service (trigger payment instruction creation)
- `approval.rejected` → Notification Service + Invoice Service
- `approval.sla_breach` → Notification Service (management escalation)

**Events Consumed:**

- `risk.scored` → determines tier, routes to queue

**External Dependencies:** None

**⚠ Critical Notes:**

- SELECT FOR UPDATE used on invoice lock to prevent concurrent approvals
- TIER_3 quorum logic entirely within this service
- MD override recorded as a special approval record type

---

## Service 6: Payment Service ⚠ MOST RESTRICTED

**Single Responsibility:** Execute dual-authorised payments to suppliers via MTN MoMo, Airtel, or EFT.

**Security Level:** 🚫 RESTRICTED — strictest access controls in the entire system

**Database Tables Owned (exclusive — isolated schema `payments_schema`):**

- `payments` — payment instructions, dual auth records, idempotency keys, transaction references

**⚠ Payment Service has its own isolated database schema with separate PostgreSQL credentials. No other service's database user can access `payments_schema`.**

**API Endpoints Exposed:**

| Method | Path                     | Roles                       | Notes                            |
| ------ | ------------------------ | --------------------------- | -------------------------------- |
| POST   | /payments/:id/authorise  | finance_manager ONLY        | Records auth, enforces dual-auth |
| GET    | /payments/pending        | finance_manager, management | View pending payments            |
| GET    | /payments/:id            | finance_manager, management | Payment detail                   |
| POST   | /payments/webhook/mtn    | Public (signature verified) | MTN async confirmation           |
| POST   | /payments/webhook/airtel | Public (signature verified) | Airtel async confirmation        |

**Events Published:**

- `payment.funded` → Collections Service (setup collection schedule)
- `payment.funded` → Facilities Service (record drawdown)
- `payment.funded` → Notification Service (supplier payment confirmation)
- `payment.failed` → Notification Service (finance_manager alert)

**Events Consumed:**

- `approval.approved` → ONLY source that can trigger payment instruction creation

**External Dependencies:**

- MTN Mobile Money API v1.0
- Airtel Money API
- Uganda Bank EFT/RTGS interface

**⚠ Strict Access Rules:**

1. Payment instructions can ONLY be created by the Approval Service via Bull queue event — no API endpoint exists for payment creation
2. Only finance_manager role can call /payments/:id/authorise — no exceptions
3. Dual authorisation enforced at application layer, database trigger, AND provider API
4. idempotency_key generated at creation, passed to provider on every call
5. Kill switch accessible only to management role — halts all processing immediately

---

## Service 7: Collections Service

**Single Responsibility:** Track invoice maturity, send buyer reminders, manage overdue escalation and penalty calculation.

**Security Level:** 🔒 Internal

**Database Tables Owned (exclusive):**

- `collections` — collection records, penalty amounts, received payments, escalation status

**API Endpoints Exposed:**

| Method | Path                            | Roles                                       |
| ------ | ------------------------------- | ------------------------------------------- |
| GET    | /collections/overdue            | credit_officer, management                  |
| POST   | /collections/:id/record-payment | credit_officer, finance_manager             |
| GET    | /collections/:invoiceId/penalty | credit_officer, finance_manager, management |

**Events Published:**

- `collection.payment_received` → Facilities Service (trigger repayment)
- `collection.payment_received` → Invoice Service (status='collected')
- `collection.overdue` → Notification Service (MD escalation)

**Events Consumed:**

- `payment.funded` → creates collection schedule (T−7, T−3, T=due, T+1, T+3, T+7 cron jobs)

**External Dependencies:**

- Africa's Talking (SMS/WhatsApp via Notification Service)

---

## Service 8: Notification Service

**Single Responsibility:** Dispatch email, SMS, and WhatsApp notifications from Bull queue jobs — no business logic.

**Security Level:** 🔒 Internal (no direct external API access, only via queue)

**Database Tables Owned:** None (stateless — uses Bull queue only)

**API Endpoints Exposed:** None (queue consumer only)

**Events Published:** None  
**Events Consumed:**

- All `*.notify` events from every other service

**External Dependencies:**

- SendGrid (email)
- Africa's Talking (SMS, WhatsApp)

**Design Principle:** This service knows nothing about business logic. It receives a notification job with: recipient, template_id, template_variables. It renders and sends. No financial data flows through this service beyond what's needed for the notification.

---

## Service 9: Reporting Service

**Single Responsibility:** Generate role-filtered financial and compliance reports — read-only access only.

**Security Level:** 🔒 Internal

**Database Tables Owned:** None — reads from all tables via read-only database role.

**⚠ Critical:** Role-based filtering applied at SQL WHERE clause level — never in application code.

**API Endpoints Exposed:**

| Method | Path                    | Roles                               |
| ------ | ----------------------- | ----------------------------------- |
| GET    | /reports/portfolio      | management, auditor                 |
| GET    | /reports/aging          | credit_officer, management, auditor |
| GET    | /reports/buyer-exposure | credit_officer, management          |
| GET    | /reports/profit         | finance_manager, management         |
| GET    | /reports/facilities     | finance_manager, management         |
| GET    | /reports/audit-export   | auditor ONLY                        |
| GET    | /reports/regulatory     | compliance_officer, management      |

**Events Published:** None  
**Events Consumed:** None  
**External Dependencies:** None

**Special Rules:**

- audit-export endpoint uses a dedicated read-only PostgreSQL role with SELECT-only on audit_logs
- All queries parameterised — no SQL injection possible via filter parameters
- Large report generation (>10,000 rows) done asynchronously, delivered by email

---

## Service Dependency Map

```
Public → API Gateway → Auth Service
                    → Onboarding Service
                    → Invoice Service → Risk Engine → Pricing → Approval → Payment
                                                                         ↓
                                                                Collections → Facilities
                    → Reporting Service (read-only, all data)
                    → Notification Service (queue consumer)
```

**Allowed inter-service calls:**

| From                               | To                    | Method                                    |
| ---------------------------------- | --------------------- | ----------------------------------------- |
| Invoice Service                    | Onboarding Service    | HTTP API (KYC check, credit limit)        |
| Risk Engine                        | Onboarding Service    | HTTP API (buyer rating, supplier history) |
| Approval Service → Payment Service | Bull queue event only | NOT HTTP                                  |
| Payment Service → Collections      | Bull queue event      | NOT HTTP                                  |
| Payment Service → Facilities       | Bull queue event      | NOT HTTP                                  |
| Any service → Notification         | Bull queue event      | NOT HTTP                                  |

**Forbidden inter-service access:**

- ❌ No service may query another service's database tables directly
- ❌ No service may call Payment Service via HTTP (only Approval via Bull queue)
- ❌ Reporting Service may not write to any table
- ❌ Notification Service may not read financial tables
