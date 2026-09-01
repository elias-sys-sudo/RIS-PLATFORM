# RIS Platform — Engineering Constitution

RIS (Rapha Integrated Solutions) buys approved invoices from suppliers at a discount, pays within 72h, collects from buyers at maturity. **This system handles real money.**

## Bash commands

- `npm run typecheck` — run after every TypeScript change
- `npm run lint` — run before every commit
- `npm run test:unit -- --testPathPattern=tests/unit/[module]` — test one module
- `npm run test:unit -- --coverage --collectCoverageFrom="src/services/[module]/**/*.ts"` — module coverage
- `npm run test:integration` — requires running Postgres + Redis (uses test schema)
- `git commit -m "feat([module]): description"` — commit format

## NON-NEGOTIABLE RULES — violation = blocking issue

1. **Zero `any` types** — TypeScript strict mode, no exceptions
2. **Parameterised SQL only** — zero string concatenation in queries, ever
3. **No PII in logs** — log IDs and status values only; never names, emails, phone, bank details
4. **Audit log inside transaction** — `INSERT INTO audit_logs` before `COMMIT`, same client
5. **Dual auth on payments** — `dual_auth_user_1 ≠ dual_auth_user_2`, enforced at app + DB trigger + provider
6. **Encrypt all PII** — via `shared/crypto.ts` before any DB INSERT; decrypt in service layer after SELECT
7. **Ownership in SQL** — `WHERE id=$1 AND supplier_id=$2` in every supplier query
8. **Joi validation first** — `validate(schema)` middleware before controller, before all business logic
9. **Custom error classes only** — `ValidationError` `AuthError` `ForbiddenError` `NotFoundError` `BusinessRuleError` `PaymentError` `RisError`
10. **25-line function limit** — payments: 40 lines max; split into private helpers
11. **BEGIN/COMMIT wraps all multi-table writes** — ROLLBACK on any error; `client.release()` in finally
12. **External API failure** → status=`failed`, audit log, notify `finance_manager`, max 3 BullMQ retries (exponential: 30s/120s/480s)

## Task Decomposition — mandatory for large tasks

Auto-decompose **before starting** whenever a task:
- Touches > 2 `.ts` files, mixes a migration with service logic, or spans > 1 module layer
- Involves dual-auth, a new BullMQ queue, a new PII field, or a DB migration
- Touches any protected financial path (`payments/` `pricing/` `risk-engine/` `approvals/` `invoices/`)
- Would produce > 150 lines in one response

**Announce the breakdown first — never start silently:**
```
This is a multi-step task. Breaking it into:
  Step 1: [file] → [outcome + rule satisfied]
  Step 2: ...
Starting with Step 1 now.
```

Run `npm run typecheck` after every step. Do not advance until it is clean.
After each step confirm it is done and state what comes next.
Full build sequence and stop conditions → `src/services/CLAUDE.md`.

---

## Module file pattern

```
[name].routes.ts      auth → role → validate → controller (no logic)
[name].controller.ts  parse req → call service → next(err)  (no SQL, no business logic)
[name].service.ts     business logic + audit log + queue     (no Express, no SQL)
[name].repository.ts  ALL SQL, parameterised only            (no logic)
[name].types.ts       interfaces, enums, error codes
```

## Build order & status

```
1. auth ✓   2. onboarding ✓   3. invoices ✓   4. verification ✓
5. risk-engine ✓   6. pricing ✓   7. approvals ✓   8. payments ✓
9. collections ✓   10. facilities ✓   11. reporting ✓
12. notifications ✓   13. settlements ✓
```

## Roles

`supplier` | `credit_officer` | `finance_manager` | `management` | `compliance_officer` | `auditor`

## Invoice status flow

> **Source of truth for transaction flow → [`01-Documents/TRANSACTION-FLOW.md`](01-Documents/TRANSACTION-FLOW.md)** (canonical, version-controlled mirror of `RIS-Transaction-Flow-Complete.docx` v2.0). The 10-stage flow, role-to-stage authorization matrix, queue handoffs, and reconciliation notes live there. When in doubt about who-does-what or status transitions, that file wins.

```
draft → submitted → buyer_confirmed → scored → priced → approved/rejected
→ pending_first_auth → pending_second_auth → executing → funded
→ collecting → overdue → collected/defaulted
→ settlement: pending → facility_repaid → profit_booked → closed
```

## CLAUDE.md map — loaded automatically per directory

| Directory | File | Covers |
|---|---|---|
| `src/` | [src/CLAUDE.md](src/CLAUDE.md) | Patterns: WithClient, transactions, error codes, encrypt layering |
| `src/services/` | [src/services/CLAUDE.md](src/services/CLAUDE.md) | Status ownership, cross-module imports, queue pattern |
| `src/services/` | [MODULE-SCAFFOLD.md](src/services/MODULE-SCAFFOLD.md) | Full 5-file template — read when creating a new module |
| `src/services/auth/` | [CLAUDE.md](src/services/auth/CLAUDE.md) | Timing-safe login, token lifecycle, startup validation |
| `src/services/onboarding/` | [CLAUDE.md](src/services/onboarding/CLAUDE.md) | PII fields, document upload, KYC flow, sanctions |
| `src/services/invoices/` | [CLAUDE.md](src/services/invoices/CLAUDE.md) | 5-step validation, tenor calc, AML gate |
| `src/services/verification/` | [CLAUDE.md](src/services/verification/CLAUDE.md) | Token hashing, PII-never-in-queue |
| `src/services/pricing/` | [CLAUDE.md](src/services/pricing/CLAUDE.md) | PRECISION=1e8, BigInt formula, toScaled |
| `src/services/approvals/` | [CLAUDE.md](src/services/approvals/CLAUDE.md) | 4-tier matrix, FOR UPDATE NOWAIT, quorum |
| `src/services/payments/` | [CLAUDE.md](src/services/payments/CLAUDE.md) | Dual auth 3 layers, webhook security, idempotency |
| `src/services/payments/providers/` | [CLAUDE.md](src/services/payments/providers/CLAUDE.md) | IPaymentProvider, EFT (bank ACH), mock |
| `src/services/risk-engine/` | [CLAUDE.md](src/services/risk-engine/CLAUDE.md) | RiskFactor interface, scorer template, 95% coverage |
| `src/services/collections/` | [CLAUDE.md](src/services/collections/CLAUDE.md) | Penalty bigint, escalation, SAR trigger |
| `src/services/facilities/` | [CLAUDE.md](src/services/facilities/CLAUDE.md) | Facility CRUD, drawdown, utilisation |
| `src/services/reporting/` | [CLAUDE.md](src/services/reporting/CLAUDE.md) | Report types, role-based access |
| `src/services/notifications/` | [CLAUDE.md](src/services/notifications/CLAUDE.md) | Circuit breaker, idempotency set, init pattern |
| `src/services/settlements/` | [CLAUDE.md](src/services/settlements/CLAUDE.md) | Settlement flow, profit booking |
| `src/shared/` | [CLAUDE.md](src/shared/CLAUDE.md) | logger.audit(), risk-config, audit metadata rules |
| `src/shared/database/` | [CLAUDE.md](src/shared/database/CLAUDE.md) | Transaction checklist, ownership SQL, migrations |
| `tests/` | [CLAUDE.md](tests/CLAUDE.md) | Service/repo templates, cross-supplier isolation |
| `frontend/` | [CLAUDE.md](frontend/CLAUDE.md) | formatUGX, token storage, Zod mirrors Joi |

## After every module

```bash
npm run test:unit -- --coverage --collectCoverageFrom="src/services/[module]/**/*.ts"
npm run typecheck && npm run lint
git add -p && git commit -m "feat([module]): description"
git push origin develop
```

---

## Design System
Always read [DESIGN.md](DESIGN.md) before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

---

> Tech stack · safeguard system · CI/CD pipeline · architecture decisions → [`.claude/reference.md`](.claude/reference.md)
