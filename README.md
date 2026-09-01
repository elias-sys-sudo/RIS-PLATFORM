# RIS Platform

Invoice Discounting & Early Payment Platform for Uganda. RIS buys approved invoices from suppliers at a discount, pays within 72 hours, and collects from buyers at maturity.

## Tech Stack

- **Backend:** Node.js 20, Express, TypeScript (strict), PostgreSQL 15, Redis 7, BullMQ
- **Frontend:** React 19, Vite, TanStack Query v5, shadcn/ui, Tailwind CSS
- **Auth:** JWT access tokens (memory) + refresh tokens (httpOnly cookie)
- **Money:** All monetary values stored as BIGINT (no floating point)
- **Encryption:** AES-256-GCM for all PII fields

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+

### Setup

```bash
git clone https://github.com/256MMcode/MMS-Platform.git
cd MMS-Platform
npm install
cp .env.example .env          # edit with your database credentials
npm run migrate                # apply 30 database migrations
npm run dev                    # start backend on :4000
cd frontend/ris-frontend
npm install
npm run dev                    # start frontend on :3001
```

### Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Supplier | supplier@ris.ug | Supplier@1234 |
| Credit Officer | officer@ris.ug | Officer@1234 |
| Finance Manager | admin@ris.ug | Admin@1234 |
| Finance Manager 2 | finance2@ris.ug | Finance2@1234 |

### Invoice Lifecycle

```
draft → submitted → buyer_confirmed → scored → priced → approved
→ pending_first_auth → pending_second_auth → executing → funded
→ collecting → collected → settled
```

## Architecture

14 modules following a 5-file pattern per module:

```
[name].routes.ts      — auth, role guard, Joi validation, controller
[name].controller.ts  — parse request, call service, error handling
[name].service.ts     — business logic, audit logging, queue dispatch
[name].repository.ts  — all SQL (parameterised only, no concatenation)
[name].types.ts       — interfaces, enums, error codes
```

**Modules:** auth · onboarding · invoices · verification · risk-engine · pricing · approvals · payments · collections · facilities · collateral · reporting · notifications · settlements

**Key financial flows:**
- Collateral coverage checked before every payment disbursement (`checkCoverageRatio()`)
- Dual authorisation on all payments: enforced at app layer + DB trigger + provider
- Settlement lifecycle: pending → facility_repaid → profit_booked → closed (manual, audited)

## Engineering Rules

See [CLAUDE.md](CLAUDE.md) for the full engineering constitution. Key rules:

- Zero `any` types (TypeScript strict)
- Parameterised SQL only (no string concatenation)
- No PII in logs (IDs and status values only)
- Audit log inside every transaction, before COMMIT
- Dual authorisation on payments (3 independent layers)
- AES-256-GCM encryption for all PII fields
- 25-line function limit (40 for payments)
- BEGIN/COMMIT wraps all multi-table writes

## Testing

```bash
npm run typecheck                                          # TypeScript check
npm run lint                                               # ESLint
npm run test:unit                                          # all unit tests (2152 tests)
npm run test:unit -- --testPathPattern=tests/unit/[module] # single module
npm run test:integration                                   # requires Postgres + Redis
```

## License

Proprietary. All rights reserved.
