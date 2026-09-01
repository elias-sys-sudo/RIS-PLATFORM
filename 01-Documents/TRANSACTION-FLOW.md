# Rapha Integrated Solutions (RIS) — Full Transaction Flow

> **SOURCE OF TRUTH for transaction flow.** Version-controlled mirror of
> `RIS-Transaction-Flow-Complete.docx` (v2.0, March 2026). When code and this file disagree,
> **this file wins** — unless a [Reconciliation Note](#appendix-a--reconciliation-notes)
> records a deliberate divergence. Endpoint/role tables and status enums in this document have
> been verified against the live codebase (`src/services/**/*.routes.ts`, `*.types.ts`).
>
> The original `.docx` is retained alongside this file as the historical artifact. Edit **this
> markdown**, not the `.docx`.
>
> **Branding:** the platform is **Rapha Integrated Solutions (RIS)**. The v2.0 `.docx` body still
> reads "MMS" internally (it predates the rebrand), but the file has been renamed to
> `RIS-…` and this canonical copy uses the current RIS branding (e.g. the buyer-confirmation field
> is `agrees_to_pay_ris`, the pricing component is the `ris_margin_rate`), matching the live code.

From eligibility to funding to collections & settlement, including role ownership and the
authorization matrix.

---

## 1. Overview

This document traces the complete lifecycle of an invoice through the RIS Platform — from
initial supplier eligibility checks, through risk scoring, pricing, approval, payment
disbursement, buyer collection, and final settlement with profit booking. Each stage identifies
the responsible role(s) and authorization requirements.

### End-to-End Status Flow

```
draft → submitted → buyer_confirmed → scored → priced → approved
→ pending_first_auth → pending_second_auth → executing → funded
→ collecting / overdue → collected / defaulted
→ settlement: pending → facility_repaid → profit_booked → closed
```

> **Note (see [RN-3](#rn-3--escalated-is-a-collection-state-not-an-invoice-status)):** the
> original `.docx` listed `escalated` as an invoice status between `overdue` and
> `collected/defaulted`. In the implementation, escalation is tracked on the **collection
> record** (`CollectionStatus.escalated`), not on the invoice. The invoice remains `collecting`
> or `overdue` while its collection escalates. This flow string reflects the code.

`InvoiceStatus` enum (`src/services/invoices/invoices.types.ts`) also defines `cancelled` and
`withdrawn` (supplier cooling-off within 24h of submission) — terminal off-ramps not shown in
the happy path above.

### Platform Roles

| Role | Primary Responsibility | Key Stages |
|---|---|---|
| `supplier` | Submit invoices, accept/reject pricing | 1, 5 |
| `buyer` (external) | Confirm invoices via token link | 2 |
| `credit_officer` | Review risk, approve low-to-mid risk invoices, manage collections | 2, 3, 5, 6, 9 |
| `finance_manager` | Authorise payments (dual-sig), manage facilities, book settlements | 7, 8, 9, 10 |
| `management` | Override approvals, close settlements, strategic decisions | 6, 9, 10 |
| `compliance_officer` | AML clearance, SAR filing for flagged invoices/collections | 1, 7, 9 |
| `auditor` | Read-only access to timelines, settlements, and audit logs | All (read-only) |
| `legal` | Read-only access to collections/payments/approval queues; collection document workflow | 9 (read), 7 (read) |

> `legal` is present in the code but was not in the `.docx` role list — see
> [RN-6](#rn-6--legal-role-exists-in-code).

---

## 2. Role-to-Stage Authorization Matrix

`(A)` = primary actor · `(V)` = view/read-only · `—` = no access · `System` = automated.

| Stage | Action | supplier | credit_officer | finance_mgr | management | compliance | auditor |
|---|---|---|---|---|---|---|---|
| 1. Submit | Create & submit invoice | A | — | — | — | — | — |
| 1. Submit | View invoices | A (own) | V | — | V | V | — |
| 1. Submit | AML flag review | — | — | — | — | A | — |
| 2. Confirm | Confirm invoice (token) | buyer | — | — | — | — | — |
| 2. Confirm | Resend confirmation link | — | A | — | — | — | — |
| 2. Confirm | View pending confirmations | — | V | — | — | — | — |
| 3. Score | Trigger scoring | — | System | — | — | — | — |
| 3. Score | View risk score | — | V | — | V | — | — |
| 4. Price | Calculate pricing | — | System | — | — | — | — |
| 4. Price | View pricing details | — | V | V | V | — | — |
| 5. Decision | Accept pricing | A | — | — | — | — | — |
| 5. Decision | Reject pricing | A | — | — | — | — | — |
| 6. Approve | AUTO tier (< 10M, low risk) | — | System | — | — | — | — |
| 6. Approve | TIER 2 (10M–50M) | — | A (1 sig) | — | — | — | — |
| 6. Approve | TIER 3 (50M–200M) | — | A (2 sigs) | — | A (override: 1 sig) | — | — |
| 6. Approve | TIER 4 (> 200M) | — | A (1 of 2) | — | A (1 of 2) | — | — |
| 6. Approve | Reject invoice | — | A | — | A | — | — |
| 7. Payment | 1st authorisation | — | — | A | — | — | — |
| 7. Payment | 2nd authorisation (diff user) | — | — | A | — | — | — |
| 7. Payment | AML clearance gate | — | — | — | — | A | — |
| 7. Payment | View payment status | — | — | V | V | — | — |
| 8. Drawdown | Facility drawdown | — | — | A (system-queued) | — | — | — |
| 8. Drawdown | View facility dashboard | — | — | V | V | — | — |
| 9. Collect | Record buyer payment | — | A | A | — | — | — |
| 9. Collect | Escalate collection | — | A | A | A | — | — |
| 9. Collect | De-escalate collection | — | A | A | A | — | — |
| 9. Collect | SAR review (flagged) | — | — | — | — | A | — |
| 9. Collect | View collections | — | V | V | V | — | V |
| 10. Settle | Initiate settlement | — | — | System | — | — | — |
| 10. Settle | Repay facility | — | — | A | — | — | — |
| 10. Settle | Book profit | — | — | A | — | — | — |
| 10. Settle | Close settlement (final) | — | — | — | A | — | — |
| 10. Settle | View settlements | — | — | V | V | — | V |

*(The `legal` role additionally has read access to collections/payments and the approval queue;
omitted from the grid above to mirror the `.docx`. See [RN-6](#rn-6--legal-role-exists-in-code).)*

---

## 3. Stage 1: Invoice Submission & Eligibility

**Module:** `invoices.service.ts` · supplier submits | compliance_officer reviews AML flags |
credit_officer, management, compliance_officer can view.

### Who Does What

| Action | Role | Endpoint |
|---|---|---|
| Create invoice draft | supplier | `POST /invoices` |
| Submit invoice (triggers 5-step validation) | supplier | `POST /invoices/:id/submit` |
| View own invoices | supplier | `GET /invoices` (filtered to own) |
| View all invoices | credit_officer, finance_manager, management, compliance_officer, legal | `GET /invoices` |
| View invoice timeline | credit_officer, management, compliance_officer, auditor | `GET /invoices/:id/timeline` |
| Withdraw (24h cooling-off) | supplier | `POST /invoices/:id/withdraw` |
| Review AML-flagged invoices | compliance_officer | Dashboard / manual review |

### 5-Step Validation Chain

| Step | Check | Error Code |
|---|---|---|
| 1 | Supplier KYC status = approved | `SUPPLIER_NOT_APPROVED` |
| 2 | Invoice number unique per supplier | `DUPLICATE_INVOICE` |
| 3 | Buyer exists AND `is_active = true` | `BUYER_NOT_APPROVED` |
| 4 | Tenor within 7–90 days (configurable) | `TENOR_OUT_OF_RANGE` |
| 5 | `faceValue + used_limit ≤ approved_limit` | `CREDIT_LIMIT_EXCEEDED` |

### AML Gate

If `face_value` exceeds **100,000,000 UGX**, the invoice is flagged (`aml_flagged = true`). This
blocks auto-approval and requires compliance_officer review before the invoice can proceed
through the approval tier.

- **Status transition:** `draft → submitted`
- **SLA:** 72 hours from creation
- **Handoff:** Queue `send-buyer-confirmation` → Verification module

---

## 4. Stage 2: Buyer Confirmation

**Module:** `verification.service.ts` · buyer (external, via token link) confirms |
credit_officer resends tokens & monitors pending.

### Who Does What

| Action | Role | Endpoint |
|---|---|---|
| View confirmation page | buyer (public, token-gated) | `GET /verify/:token` |
| Confirm invoice (4 fields) | buyer (public, token-gated) | `POST /verify/:token/confirm` |
| Dispute invoice | buyer (public, token-gated) | `POST /verify/:token/dispute` |
| View pending confirmations | credit_officer | `GET /verify/admin/invoices/pending-confirmation` |
| Resend confirmation link | credit_officer | `POST /verify/admin/invoices/:id/resend-confirmation` |

### Confirmation Fields

| Field | Description |
|---|---|
| `invoice_is_valid` | Buyer confirms the invoice is legitimate |
| `amount_is_correct` | Face value matches buyer records |
| `due_date_is_correct` | Payment due date is accurate |
| `agrees_to_pay_ris` | Buyer agrees to pay RIS (not the supplier) on the due date |

All four fields must be `true`. If any is `false`, the system throws `CONFIRMATION_INCOMPLETE`.
Tokens are SHA-256 hashed for DB storage; the raw token is sent via email with 48-hour expiry.

- **Status transition:** `submitted → buyer_confirmed`
- **Handoff:** Queue `score-invoice` → Risk Engine

---

## 5. Stage 3: Risk Scoring

**Module:** `risk-engine.service.ts` · System (automatic, BullMQ worker) scores |
credit_officer, management can view results.

### Who Does What

| Action | Role | Endpoint |
|---|---|---|
| Trigger scoring | System (auto after buyer confirms) | BullMQ worker: `score-invoice` |
| View risk score & factor breakdown | credit_officer, management | `GET /risk-engine/:id/risk-score` |

### 5-Factor Scoring (weights from `risk_config`, must sum to 1.0)

| Factor | Weight | Scoring Logic |
|---|---|---|
| Buyer Credit Rating | 0.30 | A=100, B=75, C=50, D=25 |
| Supplier Track Record | 0.25 | On-time history, default count |
| Collateral Coverage | 0.20 | Active collateral vs face value |
| Concentration Risk | 0.15 | Buyer exposure %; >30% = score 0 |
| Tenor | 0.10 | Shorter tenor = higher score |

### Threshold Routing

| Score | Recommendation | Max Advance | Risk Premium | Next Step |
|---|---|---|---|---|
| ≥ 75 | AUTO_APPROVE | 95% | 0% | Auto-price, auto-approve eligible |
| 60–74 | REFER_TO_MANAGER | 90% | 0.5–1% | Manual approval required |
| 50–59 | REFER_TO_MANAGER | 85% | 1.5% | Manual approval required |
| < 50 | REJECT | 0% | N/A | Invoice auto-rejected |

Thresholds (`threshold_auto_approve`, `threshold_refer_manager`) are read from `risk_config` —
defaults shown. See [RN-4](#rn-4--score--50-tier-branches-are-config-gated) for the interaction
with the approval tier matrix.

- **Status transition:** `buyer_confirmed → scored` (or `rejected` if score < 50)
- **Handoff:** Queue `price-invoice` → Pricing (or `invoice-rejected` notification)

---

## 6. Stage 4: Pricing Calculation

**Module:** `pricing.service.ts` · System (automatic) calculates | credit_officer,
finance_manager, management can view | finance_manager sets bank rate | management sets RIS
margin.

### Who Does What

| Action | Role | Detail |
|---|---|---|
| Calculate pricing | System (auto after scoring) | BullMQ worker: `price-invoice` |
| View pricing breakdown | supplier (own), credit_officer, finance_manager, management | `GET /pricing/:id/pricing` |
| Set `bank_cost_rate` (facility interest) | finance_manager | Via facility creation/config |
| Set `ris_margin_rate` (per buyer) | management | Via buyer configuration |
| Set `risk_premium_rate` | System (risk engine output) | Automatic from risk score |

### Pricing Formula (BigInt, `PRECISION = 1e8`, `DAYS_PER_YEAR = 365`)

```
totalAnnualRate  = bankCost + riskPremium + risMargin
discountRate     = totalAnnualRate × (tenor / 365)
advanceAmount    = faceValue × maxAdvancePct
discountAmount   = faceValue × discountRate
netPayment       = advanceAmount − discountAmount
```

A rate cap of **15% max annual discount rate** (`MAX_ANNUAL_RATE`) is enforced
(`RATE_CAP_EXCEEDED`).

- **Status transition:** `scored → priced`
- **Handoff:** None — awaits supplier decision

---

## 7. Stage 5: Supplier Pricing Decision

**Module:** `pricing.service.ts` · supplier accepts or rejects pricing terms.

### Who Does What

| Action | Role | Endpoint | Result |
|---|---|---|---|
| Accept pricing | supplier | `POST /pricing/:id/pricing/accept` | Queues `approve-invoice` |
| Reject pricing (with reason) | supplier | `POST /pricing/:id/pricing/reject` | Invoice → `rejected` |
| Dispute pricing | supplier | `POST /pricing/:id/pricing/dispute` | Opens dispute (24h SLA) |

The supplier sees a transparent fee breakdown: face value, advance %, discount amount, net
payment to supplier, and the three fee components (bank cost, risk premium, RIS margin).

---

## 8. Stage 6: Approval Routing

**Module:** `approvals.service.ts` · credit_officer approves TIER 2–4 | management overrides
TIER 3, required for TIER 4 | System auto-approves AUTO tier.

### Who Does What

| Action | Role | Endpoint |
|---|---|---|
| Approve invoice | credit_officer, management | `POST /approvals/:id/approve` |
| Reject invoice (with comments) | credit_officer, management | `POST /approvals/:id/reject` |
| View approval queue | credit_officer, management, legal | `GET /approvals/queue` |

### 4-Tier Approval Matrix

`determineTier()` evaluates highest-priority first (`approvals.service.ts`):

| Tier | Trigger | Who Approves | Quorum | Management Override? |
|---|---|---|---|---|
| AUTO | `< 10M` AND score `≥ 75` AND no AML | SYSTEM (immediate) | Instant | N/A |
| TIER 2 | `≥ 10M`–50M **or** score 50–74 **or** AML flagged | 1 credit_officer | 1 sig | Not needed |
| TIER 3 | `> 50M`–200M **or** score `< 50` | 2 different credit_officers | 2 sigs | Yes: 1 management = approved |
| TIER 4 | `> 200M` **or** score `< 30` | 1 management + 1 credit_officer | 2 sigs (both roles) | management required |

**CRITICAL:** the same user cannot provide both signatures in TIER 3 / TIER 4 — enforced at the
application layer. Concurrency lock: `SELECT ... FOR UPDATE NOWAIT`. SLA: 24 hours from `scored`
to final decision.

> The score-based triggers (`TIER 3 = score < 50`, `TIER 4 = score < 30`) are defense-in-depth.
> With default config, the risk engine auto-rejects at `score < 50`, so these branches are only
> reachable if `threshold_refer_manager` is lowered in `risk_config`. See
> [RN-4](#rn-4--score--50-tier-branches-are-config-gated).

- **Status transition:** `priced → approved` (or `rejected`)
- **Handoff:** Queue `process-payment` → Payments module

---

## 9. Stage 7: Payment & Dual Authorization

**Module:** `payments.service.ts` · finance_manager (×2, different users) authorises payments |
compliance_officer clears AML gate | management can view.

### Who Does What

| Action | Role | Endpoint | Constraint |
|---|---|---|---|
| 1st payment authorisation | finance_manager | `POST /payments/:id/authorise` | Creates payment, sets `user_1` |
| 2nd payment authorisation | finance_manager (different person) | `POST /payments/:id/authorise` | `user_1 ≠ user_2` (enforced 3 ways) |
| AML clearance (if flagged) | compliance_officer | `POST /admin/aml/clear/:id` (compliance module) | Required if face ≥ 100M UGX |
| View pending payments | finance_manager, management, legal | `GET /payments/pending` | Read-only |
| View payment details | finance_manager, management, legal | `GET /payments/:id` | Read-only |
| Manual retry (after failure) | finance_manager | `POST /payments/:id/authorise` | Re-enters dual-auth flow |

> AML clearance is enforced as a **service-layer gate** (`guardAmlCleared()`) plus a **separate
> compliance admin endpoint** — it is not an RBAC check on the payment routes themselves. See
> [RN-5](#rn-5--aml-gate-is-service-layer--admin-endpoint).

### Pre-Payment Gates (all must pass)

| Gate | Business Rule | Error if Failed |
|---|---|---|
| Collateral | Coverage ratio ≥ 50% of face value | `COLLATERAL_INSUFFICIENT` |
| Facility | Active facility `available_amount ≥ payment` | `FACILITY_INSUFFICIENT` |
| Idempotency | No duplicate payment for same invoice | Returns existing record |

### Dual Authorization — Three-Layer Enforcement

| Layer | Mechanism | What It Enforces |
|---|---|---|
| 1. Application | `authoriseFirstAuth()` / `authoriseSecondAuth()` | `dual_auth_user_1 ≠ dual_auth_user_2` |
| 2. DB Trigger | `payments_dual_auth_check` PostgreSQL trigger | Same check at database level (defence in depth) |
| 3. Provider | Only webhook callback can set `funded` status | Prevents false-positive funding without real money movement |

### Payment Status Flow

```
approved → pending_first_auth    (payment record created by finance_manager #1)
         → pending_second_auth   (finance_manager #1 authorises)
         → executing             (finance_manager #2 authorises, MUST be a different person)
         → funded / failed       (EFT webhook callback)
```

### Provider Integration

Supplier advances are funded via **Bank EFT (ACH)** only. `mapProvider()` returns
`PaymentProvider.EFT` unconditionally; the test/dev `MOCK` provider mirrors it.

| Provider | Mechanism | Idempotency | Status |
|---|---|---|---|
| Bank EFT | Uganda ACH fixed-width batch record | Embedded in ACH record | **Active** |
| Mock | Deterministic test provider (fails if amount ends in `999`) | — | Test/dev only |
| MTN MoMo | `/disbursement/v1_0/transfer` | `X-Reference-Id` header | **Retired** — historical, see [RN-2](#rn-2--payment-providers-are-eft-only) |
| Airtel Money | `/merchant/v2/payments` | `reference` field | **Retired** — historical, see [RN-2](#rn-2--payment-providers-are-eft-only) |

All webhooks are verified with HMAC-SHA256 using `crypto.timingSafeEqual` (timing-safe).
Duplicate webhooks are discarded via the `webhook_events` table.

**SLA:** 72 hours from payment creation. Escalation warning at 66 hours to management.

---

## 10. Stage 8: Facility Drawdown

**Module:** `facilities.service.ts` · System (automatic queue) draws down | finance_manager
manages facilities & views dashboard | management views dashboard.

### Who Does What

| Action | Role | Detail |
|---|---|---|
| Create facility drawdown | System (BullMQ: `facility-drawdown`) | Automatic after funding confirmed |
| Create bank facility | finance_manager | `POST /facilities` (one active at a time) |
| View facility dashboard | finance_manager, management | `GET /facilities/dashboard` |
| Initiate drawdown | finance_manager | `POST /facilities/:id/drawdown` |
| Repay drawdown | finance_manager | `POST /facilities/:id/repay` |

### Utilisation Thresholds

| Utilisation | Action | Notified Role |
|---|---|---|
| ≥ 90% | BLOCK new drawdowns (`UTILISATION_EXCEEDED`) | finance_manager, management |
| ≥ 80% | WARNING notification (allow drawdown) | finance_manager |
| < 80% | Normal operation | None |

Interest accrues nightly (`RATE_PRECISION = 1e9`): `daily = principal × (annual_rate / 365)`.
Only one facility can be active at a time.

---

## 11. Stage 9: Collections

**Module:** `collections.service.ts` · credit_officer and finance_manager record payments &
escalate | management escalates/de-escalates | compliance_officer handles SAR reviews | auditor
& legal view.

### Who Does What

| Action | Role | Endpoint |
|---|---|---|
| View all collections | credit_officer, finance_manager, management, legal | `GET /collections` |
| Record buyer payment received | credit_officer, finance_manager | `POST /collections/:id/payments` |
| Escalate collection | credit_officer, finance_manager, management | `POST /collections/:id/escalate` |
| De-escalate collection | credit_officer, finance_manager, management | `POST /collections/:id/de-escalate` |
| Resolve collection | credit_officer, finance_manager, management | `POST /collections/:id/resolve` |
| SAR review (flagged collections) | compliance_officer | Manual review + FIA Uganda filing |
| View overdue invoices | credit_officer, management, legal | `GET /collections/overdue` |

### Escalation Ladder & SAR Trigger

| Days Overdue | Level | Action | SAR Flag? | Notified Role |
|---|---|---|---|---|
| ≥ 3 | 1 | Formal reminder | No | credit_officer |
| ≥ 7 | 2 | Demand notice | Yes (if ≥ 100M UGX) | management |
| ≥ 14 | 3 | Legal action | Yes (if ≥ 100M UGX) | management + legal |
| ≥ 90 | — | Auto-default (`bad_debt`) | Yes (if flagged) | finance_manager + management |

Penalty: 0.1% per day (BigInt, `PENALTY_PRECISION = 1,000,000`). SAR trigger: escalation level
≥ 2 AND `face_value ≥ 100M UGX`. compliance_officer must manually file the SAR with FIA Uganda.

> Escalation is recorded on the **collection record** (`CollectionStatus`:
> `pending → reminded → overdue → escalated → collected / bad_debt`). The parent invoice stays
> `collecting`/`overdue`. See
> [RN-3](#rn-3--escalated-is-a-collection-state-not-an-invoice-status).

### Payment Received → Triple Queue Dispatch

When credit_officer or finance_manager records a buyer payment, three queues fire in parallel
**after COMMIT**:

| Queue | Target | Purpose |
|---|---|---|
| `facility-repayment` | Facilities | Repay drawdown principal + accrued interest |
| `settlement-initiate` | Settlements | Begin profit booking workflow |
| `supplier-payment-notification` | Notifications | Inform supplier of buyer payment |

---

## 12. Stage 10: Settlement & Profit Booking

**Module:** `settlements.service.ts` · finance_manager repays facility & books profit |
management closes settlement (final sign-off) | auditor views.

### Who Does What

| Action | Role | Endpoint | Status After |
|---|---|---|---|
| Initiate settlement | System (queue worker) | BullMQ: `settlement-initiate` | `pending` |
| Repay facility | finance_manager | `POST /settlements/:id/repay-facility` | `facility_repaid` |
| Book profit (immutable record) | finance_manager | `POST /settlements/:id/book-profit` | `profit_booked` |
| Close settlement (final) | management | `POST /settlements/:id/close` | `closed` |
| View settlement details | finance_manager, management, auditor | `GET /settlements/:id` | — |
| View all settlements | finance_manager, management, auditor | `GET /settlements` | — |

### Settlement Status Flow

```
pending             [System creates after buyer payment received]
  → facility_repaid [finance_manager records bank repayment]
  → profit_booked   [finance_manager books: netProfit = discount − bankCost + penalty]
  → closed          [management final sign-off; supplier notified]
```

The `profit_bookings` table is **immutable** — a PostgreSQL trigger prevents `UPDATE` or
`DELETE`. This is a compliance requirement ensuring financial records are tamper-proof.

---

## 13. Cross-Module Queue Architecture

All modules communicate via BullMQ queues. Queue jobs are dispatched **AFTER COMMIT** (never
inside transactions). All jobs use 3 retries with exponential backoff (30s / 120s / 480s).

| From | Queue Job | To | Trigger |
|---|---|---|---|
| Invoices | `send-buyer-confirmation` | Verification | After invoice submitted |
| Verification | `score-invoice` | Risk Engine | After buyer confirmed |
| Risk Engine | `price-invoice` | Pricing | After scoring (if not rejected) |
| Pricing | `approve-invoice` | Approvals | After supplier accepts pricing |
| Approvals | `process-payment` | Payments | After approval (any tier) |
| Payments | `facility-drawdown` | Facilities | After funding confirmed |
| Collections | `facility-repayment` | Facilities | After buyer payment received |
| Collections | `settlement-initiate` | Settlements | After buyer payment received |
| Settlements | `settlement_complete` | Notifications | After management closes |

---

## 14. Platform-Wide Invariants

| # | Rule | Enforcement |
|---|---|---|
| 1 | All money is BigInt | No floating-point arithmetic on monetary values, ever |
| 2 | Audit log inside every transaction | `INSERT INTO audit_logs` before `COMMIT` |
| 3 | Supplier ownership in SQL | `WHERE id=$1 AND supplier_id=$2` in every supplier query |
| 4 | No PII in queues or logs | Only IDs in payloads; worker fetches encrypted PII from DB |
| 5 | Status transitions are atomic | Single PostgreSQL transaction per status change |
| 6 | Queue jobs fire after COMMIT | Never dispatch jobs inside a transaction |
| 7 | Parameterised SQL only | Zero string concatenation in queries |
| 8 | AES-256 encryption on all PII | Encrypt before INSERT; decrypt after SELECT in service layer |
| 9 | Dual auth on all payments | 3 independent enforcement layers (app + DB trigger + provider) |
| 10 | Immutable profit bookings | DB trigger prevents UPDATE/DELETE on `profit_bookings` |

---

## 15. Complete Status Transition Diagram (with Roles)

```
draft
  └─> submitted                          [supplier submits]
       ├─> withdrawn                     [supplier withdraws within 24h cooling-off]
       └─> buyer_confirmed               [buyer confirms via token link]
            └─> scored                   [System: risk-engine auto-scores]
                 ├─> rejected            [System: if score < 50]
                 └─> priced              [System: pricing auto-calculates]
                      ├─> rejected       [supplier rejects pricing]
                      └─> approved       [credit_officer / management approves]
                           └─> pending_first_auth     [finance_manager #1 creates payment]
                                └─> pending_second_auth [finance_manager #1 authorises]
                                     └─> executing      [finance_manager #2 authorises]
                                          ├─> funded    [EFT webhook confirms]
                                          └─> failed    [EFT webhook fails → manual retry]
  funded
    └─> collecting                       [collections begins monitoring]
         └─> overdue                     [System: T+1 auto-detection]
              ├─> collected              [credit_officer / finance_manager records payment]
              └─> defaulted              [System: 90+ days auto-default]
              (collection record escalates: reminded → overdue → escalated)

  settlement: pending                    [System: auto-initiated on payment received]
    └─> facility_repaid                  [finance_manager records repayment]
         └─> profit_booked               [finance_manager books profit]
              └─> closed                 [management final sign-off]
```

---

## Appendix A — Reconciliation Notes

Where this document deliberately differs from the original `RIS-Transaction-Flow-Complete.docx`
(v2.0), the chosen direction and reason are recorded here. The code matches **this** document.

### RN-2 — Payment providers are EFT-only
The `.docx` listed MTN MoMo, Airtel Money, and Bank EFT as live providers. **Decision: code
wins.** Mobile-money providers were retired; every supplier advance is funded via Bank EFT
(ACH). The database `payment_method` enum retains the historical `MTN_MOMO` / `AIRTEL` values
for audit immutability, but the application never emits them. Re-introducing mobile money is
explicitly out of scope.

### RN-3 — `escalated` is a collection state, not an invoice status
The `.docx` status flow placed `escalated` between `overdue` and `collected/defaulted` as an
**invoice** status. In the implementation, `escalated` is a `CollectionStatus`
(`pending → reminded → overdue → escalated → collected / bad_debt`); the parent invoice remains
`collecting` or `overdue`. **Decision: code wins** — the collection-level escalation model is
sound. Promoting `escalated` to an `InvoiceStatus` would be a separate change on a protected
financial path.

### RN-4 — Score `< 50` tier branches are config-gated
The `.docx` Stage 6 matrix lists `TIER 3 = score < 50` and `TIER 4 = score < 30`, but Stage 3
auto-rejects at `score < 50`. With default `risk_config` thresholds these tier branches are
**unreachable** (rejected invoices never reach approval). They remain in `determineTier()` as
defense-in-depth and become reachable only if `threshold_refer_manager` is lowered below 50.
**Decision:** documented, no code change.

### RN-5 — AML gate is service-layer + admin endpoint
The `.docx` presents "AML clearance gate" as a payment step. In code it is enforced as a
service-layer guard (`guardAmlCleared()`) before `pending_first_auth`, with compliance clearing
flags via a separate admin endpoint (`POST /admin/aml/clear/:id`) — not an RBAC check on the
payment routes. Functionally equivalent. **Decision:** documented, no code change.

### RN-6 — `legal` role exists in code
The `.docx` named six roles. The code also defines a `legal` role with read access to
collections, payments, and the approval queue, plus participation in the collection-document
workflow. **Decision:** documented; `legal` is included in the per-stage endpoint tables above.

---

*Canonical since 2026-06-20. Supersedes the binary `.docx` for engineering reference. Update
this file when transaction-flow behavior changes, and keep `CLAUDE.md` pointing here.*
