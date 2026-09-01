# RIS Platform — Pre-Go-Live Deployment Checklist

**Document ID:** DEPLOY-CHECK-001
**Version:** 1.0
**Date:** March 2026
**Owner:** CTO
**Purpose:** Every gate that must pass before the RIS platform handles real money. Each item has a verification command or manual check. No item is optional.

---

## Gate 1: Code Quality

| # | Check | Command / Verification | Pass Criteria |
|---|---|---|---|
| 1.1 | TypeScript strict mode | `npm run typecheck` | Zero errors |
| 1.2 | ESLint clean | `npm run lint` | Zero errors, zero warnings |
| 1.3 | Unit test pass | `npm run test:unit` | All suites green |
| 1.4 | Unit test coverage | `npm run test:unit -- --coverage` | >= 80% all modules, >= 95% payments + risk-engine |
| 1.5 | Integration tests | `npm run test:integration` | All suites green (requires Postgres + Redis) |
| 1.6 | No `any` types | `grep -r ": any" src/ --include="*.ts" \| grep -v node_modules` | Zero matches (excluding type assertions in test files) |
| 1.7 | No string-concatenated SQL | `grep -rn "query(\`" src/ --include="*.ts"` | Zero matches — all queries use parameterised `$1, $2` |
| 1.8 | npm audit | `npm audit --production` | Zero CRITICAL or HIGH vulnerabilities |

---

## Gate 2: Database

| # | Check | Verification | Pass Criteria |
|---|---|---|---|
| 2.1 | All 17 migrations applied | Check `schema_migrations` table | 001 through 017 all present |
| 2.2 | RLS enabled | `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'` | RLS active on all data tables |
| 2.3 | Audit log immutability | Attempt `UPDATE audit_logs SET action='test'` | Trigger blocks with error |
| 2.4 | Profit booking immutability | Attempt `UPDATE profit_bookings SET net_profit=0` | Trigger blocks with error |
| 2.5 | Dual auth trigger | Attempt `UPDATE payments SET dual_auth_user_1='x', dual_auth_user_2='x'` | CHECK constraint blocks |
| 2.6 | Indexes verified | `\di+` in psql | All indexes from migrations 001-017 present |
| 2.7 | Connection pool config | Check env: `DB_POOL_MIN=5`, `DB_POOL_MAX=20` | Matches NFR-PERF-008 |
| 2.8 | Backup configured | Verify daily backup at 02:00 EAT | WAL archiving every 15 minutes |
| 2.9 | Retention policy | Verify no DELETE triggers allow removal within 7 years | NFR-COMP-004 |

---

## Gate 3: Security

| # | Check | Verification | Pass Criteria |
|---|---|---|---|
| 3.1 | PII encryption active | Query suppliers table — `company_name_encrypted` populated, `company_name` empty for new records | No plaintext PII in DB |
| 3.2 | Encryption key in env | `RIS_ENCRYPTION_KEY` set in production env | 256-bit key, not in code |
| 3.3 | JWT secret strength | `JWT_SECRET` in production env | Minimum 256-bit, unique to production |
| 3.4 | Bcrypt rounds | Check auth config | 12 rounds (NFR-PERF-002) |
| 3.5 | TLS certificate | `curl -vI https://[domain]` | Valid cert, not expiring within 30 days |
| 3.6 | OWASP ZAP scan | Run baseline scan against staging | Zero HIGH findings (NFR-SEC-002) |
| 3.7 | Helmet headers | Check response headers | CSP, HSTS, X-Frame-Options present |
| 3.8 | CORS config | Check `CORS_ORIGIN` env | Restricted to production domain only |
| 3.9 | Rate limiting active | Test login with 11 rapid requests | 429 returned after 10 (NFR-PERF-002) |
| 3.10 | No PII in logs | Search application logs for email/phone patterns | Zero matches |
| 3.11 | XSS sanitization | Submit `<script>alert(1)</script>` in form field | Sanitized/rejected |
| 3.12 | Cookie security | Check Set-Cookie header | `Secure; HttpOnly; SameSite=Strict` |

---

## Gate 4: Business Logic

| # | Check | Verification | Pass Criteria |
|---|---|---|---|
| 4.1 | Invoice 5-step validation | Submit invoice missing required field | Rejected with field-level errors |
| 4.2 | AML flag threshold | Submit invoice >= UGX 100,000,000 | AML_FLAG audit entry within 60s |
| 4.3 | KYC gate | Submit invoice with supplier KYC != approved | Rejected |
| 4.4 | Buyer confirmation flow | Send verification email, click token | Status changes to buyer_confirmed |
| 4.5 | Risk scoring | Trigger scoring on confirmed invoice | 5 factors calculated, score persisted |
| 4.6 | Pricing BigInt accuracy | Price an invoice, verify fee breakdown sums | bankCost + riskPremium + mmsMargin = discountAmount |
| 4.7 | Pricing acceptance | Supplier accepts pricing terms | `pricing_accepted_at` set, audit logged |
| 4.8 | Approval 4-tier matrix | Submit invoices at each tier threshold | Correct tier triggered |
| 4.9 | Dual auth enforcement | Attempt payment with same user for both auths | Rejected at all 3 layers |
| 4.10 | Collateral coverage | Attempt payment with insufficient collateral | Blocked with COLLATERAL_INSUFFICIENT |
| 4.11 | Facility utilisation | Attempt payment exceeding facility limit | Blocked |
| 4.12 | Collection reminders | Verify reminder schedule | T-7, T-3, T+0, T+1, T+3, T+7 all fire |
| 4.13 | Auto-default | Collection at level 3, 90+ days overdue | Status → defaulted, audit logged |
| 4.14 | Settlement flow | Complete: initiate → repay → book profit → close | All 4 statuses reached, profit_bookings created |
| 4.15 | Buyer dispute | Submit dispute via token endpoint | Dispute created, credit_officer notified |
| 4.16 | Penalty calculation | Overdue invoice, verify penalty BigInt | Correct to 1 UGX |
| 4.17 | Buyer payment score | Record on-time payment | Score increases by 5 |
| 4.18 | Buyer payment score (late) | Record late payment | Score decreases (capped -20) |

---

## Gate 5: Infrastructure

| # | Check | Verification | Pass Criteria |
|---|---|---|---|
| 5.1 | Health endpoint | `GET /health` | Returns 200 with uptime info |
| 5.2 | Redis connected | Health check includes Redis ping | Connected |
| 5.3 | BullMQ workers running | Check worker process logs | All 7 queue consumers active |
| 5.4 | Graceful shutdown | Send SIGTERM | In-flight requests complete within 30s |
| 5.5 | Environment variables | All required env vars present | See env checklist below |
| 5.6 | Document storage | Upload 10MB file | Completes within 30s, encrypted |
| 5.7 | Email delivery | Trigger welcome email | Delivered within 60s |

### Required Environment Variables

```
# Database
DATABASE_URL=postgresql://...
DB_POOL_MIN=5
DB_POOL_MAX=20

# Redis
REDIS_URL=redis://...

# Security
JWT_SECRET=<256-bit minimum>
JWT_REFRESH_SECRET=<256-bit minimum>
RIS_ENCRYPTION_KEY=<256-bit AES key>
BCRYPT_ROUNDS=12

# External Services
SENDGRID_API_KEY=
AFRICAS_TALKING_API_KEY=
AFRICAS_TALKING_USERNAME=
MTN_MOMO_API_KEY=
MTN_MOMO_API_SECRET=
MTN_MOMO_SUBSCRIPTION_KEY=
AIRTEL_CLIENT_ID=
AIRTEL_CLIENT_SECRET=

# Application
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://[production-domain]
BASE_URL=https://[production-domain]

# Compliance
AML_THRESHOLD_UGX=100000000
SAR_AUTO_FLAG_THRESHOLD=100000000
```

---

## Gate 6: Performance

| # | Check | Tool | Pass Criteria |
|---|---|---|---|
| 6.1 | Invoice submission p95 | k6 (100 VUs, 10min) | < 2 seconds |
| 6.2 | Login p95 | k6 (100 VUs, 10min) | < 1 second |
| 6.3 | DB indexed lookup p95 | k6 query test | < 100ms |
| 6.4 | Queue pickup latency | BullMQ metrics | < 500ms (queue < 100 jobs) |
| 6.5 | Risk scoring duration | Job timestamp delta | < 5 seconds |
| 6.6 | Concurrent sessions | k6 sustain 100 VUs | No degradation for 10 minutes |

---

## Gate 7: Compliance

| # | Check | Verification | Pass Criteria |
|---|---|---|---|
| 7.1 | Audit trail completeness | Process invoice end-to-end | >= 14 audit_log entries |
| 7.2 | SETTLEMENT_CLOSED is terminal | Attempt status change after close | Rejected |
| 7.3 | VAT/WHT accuracy | Run pricing acceptance test | Accurate to 1 UGX |
| 7.4 | SAR generation | Flag collection at threshold | SAR data generated within 60s |
| 7.5 | Data subject access | Trigger DSAR export | Completes within 2 hours |
| 7.6 | 7-year retention | Attempt delete of financial record | Blocked by trigger |
| 7.7 | Separation of duties | Same user approve + authorize payment | Blocked |
| 7.8 | Dispute immutability | Check dispute records | reason, type, timestamp, IP all recorded |

---

## Gate 8: Operational Readiness

| # | Check | Verification | Pass Criteria |
|---|---|---|---|
| 8.1 | Monitoring alerts | Trigger health check failure | Alert fires within 60s |
| 8.2 | Dead letter alerts | Force BullMQ job failure x3 | finance_manager notified |
| 8.3 | DB replica lag alert | Check monitoring config | Alert at 60s lag |
| 8.4 | Certificate expiry alert | Check monitoring config | Alert at 30 days |
| 8.5 | Failover drill | Document RTO procedure | < 4 hours recovery |
| 8.6 | Backup restoration test | Restore from latest backup | Data integrity verified |
| 8.7 | Incident response plan | Document exists | Roles and escalation defined |
| 8.8 | Circuit breaker test | Kill external API | Circuit opens after 5 failures, recovers after 30s |

---

## Sign-Off

| Role | Name | Date | Signature |
|---|---|---|---|
| CTO | | | |
| Lead Developer | | | |
| Compliance Officer | | | |
| Finance Manager | | | |

---

## Post-Launch (First 30 Days)

- [ ] Monitor p95 latencies daily — compare to Gate 6 targets
- [ ] Review dead letter queue daily — zero tolerance for stuck jobs
- [ ] Weekly audit log review by compliance_officer
- [ ] First penetration test within 90 days (NFR-SEC-005)
- [ ] First backup restoration drill within 30 days
- [ ] Monitor queue depths — alert threshold at 100 pending jobs
- [ ] Review and rotate JWT secrets at 90 days
- [ ] Verify email delivery rates > 99%
