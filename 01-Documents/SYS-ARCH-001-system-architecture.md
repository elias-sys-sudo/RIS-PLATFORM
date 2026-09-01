# RIS Platform — System Architecture Reference

**Document ID:** SYS-ARCH-001
**Version:** 1.0
**Date:** March 2026
**Owner:** CTO
**Purpose:** Operational reference for developers — what runs where, how modules connect, queue topology, data flows. Complements ARCH-C4-001 (diagrams), ARCH-ADR-001 (decisions), ARCH-SVC-001 (service contracts).

---

## 1. Runtime Architecture

Single Node.js process (modular monolith). All modules share one Express server, one PostgreSQL connection pool (min 5 / max 20), one Redis instance (BullMQ + sessions + rate limiting).

```
                    ┌─────────────────────────────────────────────┐
                    │              Express Server (port 3000)      │
                    │                                             │
                    │  Middleware Chain:                           │
                    │  helmet → cors → rateLimiter → jsonBody     │
                    │  → urlencoded → cookieParser → xssSanitize  │
                    │  → auditMiddleware                          │
                    │                                             │
                    │  Route Mounts:                              │
                    │  /auth          → authRouter                │
                    │  /onboarding    → onboardingRouter          │
                    │  /invoices      → invoicesRouter            │
                    │  /invoices      → riskEngineRouter          │
                    │  /invoices      → pricingRouter             │
                    │  /invoices      → approvalsRouter           │
                    │  /verify        → verificationRouter        │
                    │  /approvals     → approvalsFacadeRouter     │
                    │  /payments      → paymentsRouter            │
                    │  /payments/hist → paymentHistoryRouter      │
                    │  /collections   → collectionsRouter         │
                    │  /facilities    → facilitiesRouter          │
                    │  /reports       → reportingRouter           │
                    │  /dashboard     → dashboardRouter           │
                    │  /documents     → documentsRouter           │
                    │  /collateral    → collateralRouter          │
                    │  /settings      → settingsRouter            │
                    │  /buyers        → buyersFacadeRouter        │
                    │  /suppliers     → suppliersFacadeRouter     │
                    │  /admin         → adminRouter               │
                    │  /assignments   → assignmentsRouter         │
                    │  /settlements   → settlementsRouter        │
                    │                                             │
                    │  globalErrorHandler (catches all)           │
                    └─────────────────────────────────────────────┘
                              │              │
                    ┌─────────┘              └──────────┐
                    ▼                                   ▼
            ┌──────────────┐                   ┌──────────────┐
            │  PostgreSQL  │                   │    Redis      │
            │  (pool 5-20) │                   │  (BullMQ +    │
            │  17 migrations│                   │   sessions +  │
            │  RLS enabled │                   │   rate limits) │
            └──────────────┘                   └──────────────┘
```

All module routers are mounted. Settlements wired at `/settlements`.

---

## 2. Module Dependency Graph

Arrows mean "imports repository from". No module imports another module's service (except notifications for fire-and-forget).

```
auth ◄─── onboarding ◄─── invoices ◄─── verification ◄─── risk-engine
                                │              │               │
                                │              │               ▼
                                │              │           pricing
                                │              │               │
                                │              │               ▼
                                │              │          approvals
                                │              │               │
                                ▼              │               ▼
                           collections ◄───────┤          payments
                                │                             │
                                ▼                             ▼
                           settlements                   facilities
                                                              │
                           reporting ◄── reads all ───────────┘
                           collateral (standalone + enforced in payments)
                           documents (standalone)
                           notifications (consumed by all via queue)
```

### Cross-Module Repository Imports (read-only)

| Importing Module | Imported Repository | Purpose |
|---|---|---|
| invoices | onboarding.repository | `findSupplierByUserId()` |
| pricing | invoices.repository | `findSupplierByUserId()` for accept/reject |
| payments | invoices.repository | Invoice lookup for payment |
| payments | approvals.repository | Approval status check |
| payments | collateral.repository | Coverage ratio check |
| payments | facilities.repository | Utilisation check |
| collections | invoices.repository | Invoice data for reminders |
| collections | facilities.repository | `getDrawdownByInvoiceId()` for repayment |
| risk-engine | invoices.repository | Invoice data for scoring |

---

## 3. BullMQ Queue Topology

All queues use: `{ attempts: 3, backoff: { type: 'exponential', delay: 30_000 } }`
Retry schedule: 30s → 120s → 480s. After 3 failures: dead letter + notify finance_manager.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  risk-scoring    │────►│  pricing         │────►│  payment        │
│  (verification   │     │  (risk-engine    │     │  (approvals     │
│   triggers)      │     │   triggers)      │     │   triggers)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                                  ┌─────────────────┐
                                                  │ facility-       │
                                                  │ drawdown        │
                                                  │ (payments       │
                                                  │  triggers)      │
                                                  └─────────────────┘
                                                         │
              ┌──────────────────────────────────────────┘
              ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ facility-       │     │  settlement-     │     │  notification   │
│ repayment       │     │  initiate        │     │  (all modules   │
│ (collections    │     │  (collections    │     │   trigger)      │
│  triggers)      │     │   triggers)      │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Queue Registry

| Queue Name | Producer | Consumer | Payload |
|---|---|---|---|
| `risk-scoring` | verification | risk-engine worker | `{ invoiceId }` |
| `pricing` | risk-engine | pricing worker | `{ invoiceId }` |
| `payment` | approvals | payments worker | `{ invoiceId }` |
| `facility-drawdown` | payments | facilities worker | `{ invoiceId, amount }` |
| `facility-repayment` | collections | facilities worker | `{ invoiceId, drawdownId }` |
| `settlement-initiate` | collections | settlements worker | `{ invoiceId }` |
| `notification` | all modules | notifications worker | `{ userId, type, payload }` |

### Queue Setter Functions by Module

| Module | Setters |
|---|---|
| auth | `setNotificationQueue` |
| onboarding | `setNotificationQueue` |
| invoices | `setNotificationQueue` |
| verification | `setNotificationQueue`, `setRiskScoringQueue` |
| risk-engine | `setNotificationQueue`, `setPricingQueue` |
| approvals | `setPaymentQueue`, `setNotificationQueue` |
| payments | `setNotificationQueue`, `setFacilityDrawdownQueue` |
| collections | `setNotificationQueue`, `setFacilityRepaymentQueue`, `setSettlementQueue` |
| collateral | `setNotificationQueue` |
| facilities | `setNotificationQueue` |
| settlements | `setNotificationQueue` |
| documents | `setNotificationQueue` |

---

## 4. Database Schema — Migration Inventory

17 migrations, append-only. Never edit existing migrations.

| # | File | Key Changes |
|---|---|---|
| 001 | `initial_schema.sql` | users, suppliers, buyers, invoices, risk_scores, audit_logs, buyer_mms_margins |
| 002 | `add_invoices_description_and_fix_tenor.sql` | Invoice description column, tenor fix |
| 003 | `add_missing_indexes.sql` | Performance indexes |
| 004 | `create_approvals_table.sql` | approvals, approval_decisions tables |
| 005 | `add_payments_idempotency_key.sql` | Payment idempotency |
| 006 | `create_facilities_tables.sql` | facilities, facility_drawdowns |
| 007 | `reconcile_schema_conflicts.sql` | Schema alignment fixes |
| 008 | `add_legal_role.sql` | Legal role for collections escalation |
| 009 | `collection_payments_and_collections_columns.sql` | collections, collection_payments tables |
| 010 | `create_password_reset_tokens.sql` | Password reset flow |
| 011 | `add_collateral_crud_and_documents_download.sql` | collateral table, document downloads |
| 012 | `risk_config_funded_at_escalation_xss.sql` | Risk config table, funded_at, XSS columns |
| 013 | `checkers_gap_closure.sql` | Gap closure patches |
| 014 | `user_settings_and_approval_info_requests.sql` | User settings, approval info requests |
| 015 | `pii_encryption_and_eligibility_expiry.sql` | PII encrypted columns, eligibility expiry, buyer undertaking |
| 016 | `settlements_and_collateral_enforcement.sql` | settlements, profit_bookings, collateral enforcement, pricing acceptance |
| 017 | `invoice_disputes.sql` | invoice_disputes table |

### Key Tables by Domain

| Domain | Tables |
|---|---|
| Identity | `users`, `sessions` (Redis), `password_reset_tokens`, `user_settings` |
| Onboarding | `suppliers`, `buyers`, `eligibility_checks`, `documents` |
| Invoice Lifecycle | `invoices`, `risk_scores`, `buyer_mms_margins`, `invoice_disputes` |
| Approvals | `approvals`, `approval_decisions`, `approval_info_requests` |
| Payments | `payments` (with dual_auth columns and idempotency_key) |
| Facilities | `facilities`, `facility_drawdowns` |
| Collections | `collections`, `collection_payments` |
| Collateral | `collateral` |
| Settlement | `settlements`, `profit_bookings` |
| Audit | `audit_logs` (immutable — no UPDATE/DELETE) |
| Config | `risk_config` |

---

## 5. Invoice Lifecycle — Complete Data Flow

```
SUPPLIER submits invoice
    │
    ▼
[invoices.service] ── 5-step validation ── AML check ── status: submitted
    │                                                    audit: INVOICE_SUBMITTED
    ▼
[verification.service] ── email token to BUYER
    │
    ▼
BUYER clicks token link ── confirms/disputes
    │
    ├─ confirm → status: buyer_confirmed     audit: BUYER_CONFIRMED
    │              └─► queue: risk-scoring
    │
    └─ dispute → creates invoice_dispute     audit: DISPUTE_RAISED
                   └─► notify credit_officer
    │
    ▼
[risk-engine.worker] ── 5-factor scoring ── status: scored
    │                                        audit: INVOICE_SCORED
    └─► queue: pricing
    │
    ▼
[pricing.worker] ── BigInt arithmetic ── persist to risk_scores + invoices
    │                                    audit: INVOICE_PRICED
    ▼
SUPPLIER accepts/rejects pricing terms
    │
    ├─ accept → pricing_accepted_at set     audit: PRICING_ACCEPTED
    └─ reject → pricing_rejected_at set     audit: PRICING_REJECTED
    │
    ▼
[approvals.service] ── 4-tier matrix (AUTO/TIER_2/TIER_3/TIER_4)
    │                   status: approved or rejected
    │                   audit: APPROVAL_DECISION
    └─► queue: payment (if approved)
    │
    ▼
[payments.service] ── collateral check ── facility utilisation check
    │                  dual auth (2 signatories)
    │                  status: pending_first_auth → pending_second_auth → executing
    │                  audit: PAYMENT_INITIATED, FIRST_AUTH, SECOND_AUTH
    └─► queue: facility-drawdown
    │
    ▼
[payment provider callback] ── status: funded or failed
    │                           audit: PAYMENT_FUNDED or PAYMENT_FAILED
    ▼
[collections.service] ── status: collecting
    │                     reminders: T-7, T-3, T+0, T+1, T+3, T+7
    │                     escalation: level 0→1→2→3
    │
    ├─ payment received → status: collected    audit: PAYMENT_RECEIVED
    │                      └─► queue: facility-repayment
    │                      └─► queue: settlement-initiate
    │                      └─► update buyer payment_score
    │
    └─ 90 days overdue at level 3 → status: defaulted
                                     audit: INVOICE_DEFAULTED
    │
    ▼
[settlements.service] ── initiate → repay facility → book profit → close
    │                     status: pending → facility_repaid → profit_booked → closed
    │                     audit: SETTLEMENT_INITIATED, FACILITY_REPAID,
    │                            PROFIT_BOOKED, SETTLEMENT_CLOSED
    │
    ▼
SETTLEMENT_CLOSED = terminal state (no further status changes)
    Minimum 14 audit_log entries per invoice lifecycle
```

---

## 6. Security Architecture

### Authentication Flow
1. `POST /auth/login` — bcrypt verify (12 rounds) → JWT access token (15min) + refresh token (7d)
2. All routes: `authMiddleware` validates JWT, populates `req.user: { userId, role, sessionId }`
3. Role checked by `requireRole([...])` middleware
4. Session blacklist in Redis for logout/revocation

### PII Encryption
- Algorithm: AES-256-GCM via `shared/crypto.ts`
- Encrypted fields: company_name, tax_id, directors, bank_account_number, bank_account_name, mobile_money_number, contact_email, contact_phone
- Encrypt: service layer before repository INSERT
- Decrypt: service layer after repository SELECT
- Never in: logs, queue payloads, error messages

### Row-Level Security (RLS)
- `beginWithRls(client)` sets session context for every transaction
- Supplier queries always include `AND supplier_id = $N`

### Payment Dual Authorization
Three independent layers — all must agree:
1. **Application**: `dual_auth_user_1 !== dual_auth_user_2` enforced in service
2. **Database**: CHECK trigger prevents same user in both auth columns
3. **Provider**: Payment API requires two distinct signatory tokens

---

## 7. External System Integrations

| System | Protocol | Module | Status |
|---|---|---|---|
| MTN Mobile Money | HTTPS REST | payments/providers/mtn | Provider interface implemented |
| Airtel Money | HTTPS REST | payments/providers/airtel | Provider interface implemented |
| Bank EFT/RTGS | SFTP/API | payments/providers/eft | Stub only |
| SendGrid | HTTPS REST | notifications | Circuit breaker + idempotency |
| Africa's Talking | HTTPS REST | notifications | SMS/WhatsApp templates |
| FIA goAML | Secure upload | compliance (manual) | SAR generation in collections |

---

## 8. Monitoring & Observability

### Health Check
- `GET /health` — external uptime monitoring (60s interval)
- Target: 99.5% uptime (max 3h39m/month unplanned downtime)

### Audit Trail
- Every state change produces an `audit_logs` entry
- Written inside the same transaction as the state change
- Immutable — database trigger prevents UPDATE/DELETE
- Minimum 14 entries per invoice lifecycle
- `logger.audit()` call after COMMIT for structured logging

### Queue Monitoring
- BullMQ dashboard for job status
- Alert on queue depth > 100 jobs
- Alert on dead letter queue entries (requires manual investigation)

---

## 9. Performance Budgets

| Operation | Target | Measured By |
|---|---|---|
| Invoice submission | < 2s p95 | k6 load test |
| Login | < 1s p95 | k6 load test |
| Risk scoring | < 5s from pickup | Job timestamp delta |
| Pricing calculation | < 2s from pickup | Job timestamp delta |
| Payment score recalc | < 500ms | Transaction timing |
| Collateral coverage check | < 500ms | Inline timing |
| Audit log write | < 1s | Never blocks response |
| Queue job pickup | < 500ms | Queue depth < 100 |
| DB indexed lookup | < 100ms p95 | Query timing |

---

## 10. File Structure Reference

```
src/
├── server.ts                          # Express app setup, route mounting
├── shared/
│   ├── database/
│   │   ├── pool.ts                    # PostgreSQL pool + beginWithRls
│   │   └── migrations/               # 001-017 SQL migrations
│   ├── crypto.ts                      # AES-256-GCM encrypt/decrypt
│   ├── logger.ts                      # Winston + audit() method
│   ├── errors.ts                      # Custom error classes
│   ├── middleware/                     # auth, rbac, validate, rateLimiter, xss
│   └── queue.ts                       # BullMQ connection factory
├── services/
│   ├── auth/                          # Login, JWT, sessions, password reset
│   ├── onboarding/                    # Supplier/buyer registration, KYC, documents
│   ├── invoices/                      # Invoice CRUD, 5-step validation, AML gate
│   ├── verification/                  # Buyer confirmation tokens, disputes
│   ├── risk-engine/                   # 5-factor scoring, strategy pattern
│   ├── pricing/                       # BigInt discount calculation, accept/reject
│   ├── approvals/                     # 4-tier approval matrix, quorum
│   ├── payments/                      # Dual auth, provider abstraction, webhooks
│   │   └── providers/                 # EFT, Mock (MTN/Airtel retired — see TRANSACTION-FLOW.md RN-2)
│   ├── collections/                   # Overdue tracking, penalties, reminders, default
│   ├── facilities/                    # Bank facility management, drawdowns
│   ├── settlements/                   # Facility repayment, profit booking
│   ├── collateral/                    # Collateral CRUD, coverage enforcement
│   ├── documents/                     # Document upload/download, comments
│   ├── notifications/                 # Email/SMS circuit breaker, templates
│   └── reporting/                     # Dashboard, reports, data export
tests/
├── unit/                              # Jest mocks, per-module test suites
└── integration/                       # Real DB, end-to-end flows
```
