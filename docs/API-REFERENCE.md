# RIS Platform — API Reference

Base URL: `http://localhost:4000/api`

All endpoints require `Authorization: Bearer <token>` unless noted.
All monetary values are integer strings (BIGINT). Example: `"45000000"` = UGX 45,000,000.

---

## Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /auth/login | Public | Returns access + refresh tokens |
| POST | /auth/refresh | Public | Rotates refresh token (httpOnly cookie) |
| POST | /auth/logout | Required | Invalidates session + blacklists token |
| POST | /auth/2fa/verify | Required | Verify TOTP code (staff roles) |

Login body: `{ "email": "supplier@ris.ug", "password": "Supplier@1234" }`

---

## Eligibility

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /eligibility/check | Public | Eligibility gate before registration — returns token |

Body: `{ "annual_revenue": 500000000, "years_in_business": 3, "industry": "Manufacturing", "funding_requirement": 100000000 }`

---

## Onboarding

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | /onboarding/register | Public | Register supplier (requires eligibility token) |
| POST | /onboarding/documents | supplier | Upload KYC document |
| GET | /onboarding/status | supplier | My KYC status |
| PUT | /onboarding/kyc/:supplierId | credit_officer | Approve/reject KYC |
| POST | /onboarding/buyers | credit_officer | Create buyer |
| GET | /onboarding/buyers | Any | List buyers |

---

## Invoices

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | /invoices | Any | List invoices (paginated) |
| GET | /invoices/:id | Any | Invoice detail with risk, timeline, docs |
| POST | /invoices/submit | supplier | Create + submit invoice (5-step validation) |
| POST | /invoices/:id/confirm-buyer | credit_officer | submitted → buyer_confirmed |
| POST | /invoices/:id/score | credit_officer | buyer_confirmed → scored |
| POST | /invoices/:id/price | credit_officer | scored → priced |
| POST | /invoices/:id/approve | credit_officer | priced → approved |
| POST | /invoices/:id/reject | credit_officer | Any active status → rejected |
| POST | /invoices/:id/accept-pricing | supplier | Accept pricing offer |
| POST | /invoices/:id/reject-pricing | supplier | Reject pricing offer |
| POST | /invoices/:id/mark-funded | finance_manager | executing → funded (collecting) |

---

## Approvals

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | /approvals | credit_officer+ | List approval queue |
| GET | /approvals/:invoiceId | credit_officer+ | Approval detail with tier decisions |
| POST | /approvals/:invoiceId/approve | credit_officer | Approve invoice (with comments) |
| POST | /approvals/:invoiceId/reject | credit_officer | Reject invoice (with comments) |

---

## Payments

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | /payments | finance_manager+ | List payments |
| GET | /payments/:id | finance_manager+ | Payment detail |
| POST | /payments/:invoiceId/initiate | finance_manager | Create payment record (approved → pending_first_auth) |
| POST | /payments/:id/first-auth | finance_manager | First dual-auth (pending_first_auth → pending_second_auth) |
| POST | /payments/:id/second-auth | finance_manager | Second dual-auth — different user required (→ executing) |
| POST | /payments/:id/execute | finance_manager | Execute disbursement to provider |
| POST | /payments/webhook/mtn | Public (HMAC) | MTN MoMo webhook — HMAC-SHA256 verified |
| POST | /payments/webhook/airtel | Public (HMAC) | Airtel Money webhook — HMAC-SHA256 verified |

---

## Collections

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | /collections | Any | List collections |
| GET | /collections/:id | Any | Collection detail + payment history |
| POST | /collections/:id/payments | finance_manager | Record a buyer payment |
| POST | /collections/:id/escalate | credit_officer+ | Escalate overdue collection |

---

## Facilities

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | /facilities | finance_manager+ | List facilities |
| GET | /facilities/:id | finance_manager+ | Facility detail + utilisation |
| POST | /facilities | finance_manager | Create facility |
| PUT | /facilities/:id | finance_manager | Update facility |
| POST | /facilities/:id/drawdowns | finance_manager | Create drawdown against facility |
| POST | /facilities/:id/repayments | finance_manager | Record facility repayment |

---

## Collateral

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | /collateral | credit_officer+ | List collateral records |
| GET | /collateral/:id | credit_officer+ | Collateral detail |
| POST | /collateral | credit_officer | Create collateral record |
| PUT | /collateral/:id | credit_officer | Update collateral |
| DELETE | /collateral/:id | credit_officer | Remove collateral record |

---

## Settlements

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | /settlements | finance_manager+ | List settlements with summary stats |
| GET | /settlements/:id | finance_manager+ | Settlement detail with profit breakdown |
| POST | /settlements/:invoiceId/initiate | finance_manager | Create settlement (collections → pending) |
| POST | /settlements/:id/repay-facility | finance_manager | pending → facility_repaid |
| POST | /settlements/:id/book-profit | finance_manager | facility_repaid → profit_booked (immutable profit record) |
| POST | /settlements/:id/close | management | profit_booked → closed (notifies supplier) |

`repay-facility` body: `{ "facility_repayment_amount": 31112500, "accrued_interest": 640000 }`
`book-profit` body: `{ "discount_earned": 1637500, "bank_cost_paid": 640000 }`

---

## Reporting

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | /reporting/portfolio-summary | finance_manager+ | Portfolio overview |
| GET | /reporting/aging-analysis | credit_officer+ | Receivables aging buckets |
| GET | /reporting/audit-export | auditor | CSV audit log export |
| GET | /reporting/regulatory | compliance_officer+ | AML flags, SARs, KYC rates |
| GET | /reporting/profit | finance_manager+ | P&L per invoice + aggregated |
| GET | /reporting/facility | finance_manager+ | Facility utilisation + maturity |

---

## Buyers

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | /buyers | Any | List buyers |
| POST | /buyer-requests | supplier | Submit buyer onboarding request |
| GET | /buyer-requests/mine | supplier | My buyer requests |
| GET | /admin/buyer-requests | credit_officer | All buyer requests |
| PUT | /admin/buyer-requests/:id | credit_officer | Approve/reject buyer request |

---

## Error Response Format

```json
{ "error": "VALIDATION_ERROR", "message": "Human-readable description" }
```

| Status | Meaning |
|--------|---------|
| 200 | OK |
| 201 | Created |
| 400 | Bad Request (Joi validation failed) |
| 401 | Unauthorized (missing or expired token) |
| 403 | Forbidden (wrong role) |
| 404 | Not Found |
| 409 | Conflict (wrong status, duplicate, lock contention) |
| 422 | Business Rule Violation (custom error classes) |
| 429 | Rate Limited |
| 500 | Server Error |
