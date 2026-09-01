# Contributing to RIS Platform

## Getting Started

1. Clone the repo and follow the [README](README.md) setup instructions
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes following the rules below
4. Submit a pull request against `develop`

## Branch Naming

- `feat/description` — new features
- `fix/description` — bug fixes
- `refactor/description` — code restructuring
- `test/description` — test additions
- `docs/description` — documentation only

## Commit Format

```
type(module): description

feat(invoices): add AML structuring detection
fix(payments): handle timeout in MTN MoMo callback
test(settlements): raise unit coverage to 100%
refactor(collateral): move threshold to risk_config
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`, `ci`

## Code Rules

All rules are documented in [CLAUDE.md](CLAUDE.md). The critical ones:

1. **TypeScript strict** — zero `any` types
2. **Parameterised SQL** — no string concatenation in queries
3. **No PII in logs** — log IDs and status only
4. **Audit log inside transaction** — INSERT before COMMIT
5. **25-line function limit** — split into private helpers
6. **Custom error classes** — ValidationError, AuthError, ForbiddenError, NotFoundError, BusinessRuleError, PaymentError

## Module Pattern

Every module follows a 5-file structure:

```
[name].routes.ts      — routing + middleware
[name].controller.ts  — HTTP layer (no business logic)
[name].service.ts     — business logic (no SQL, no Express)
[name].repository.ts  — database queries (parameterised only)
[name].types.ts       — TypeScript interfaces and enums
```

## Before Submitting

```bash
npm run typecheck
npm run lint
npm run test:unit -- --testPathPattern=tests/unit/[your-module]
```

All three must pass. The pre-commit hook will verify.

## Request-ID Propagation in BullMQ

Every HTTP request gets a `request_id` (UUIDv4 by default, or a client-supplied
`X-Request-Id` header). It rides through the request via AsyncLocalStorage so
every log line carries it — invaluable for incident triage.

When a service enqueues a BullMQ job, the request_id must travel with the job
so the worker logs the same ID. **Use `enqueueWithContext` instead of `queue.add`:**

```typescript
import { enqueueWithContext } from '../../shared/workers/queue-helpers';

// ❌ Direct .add() loses the request_id at the queue boundary
await notificationQueue.add('payment_failed', payload, opts);

// ✅ enqueueWithContext stamps the active request_id onto data._meta
await enqueueWithContext(notificationQueue, 'payment_failed', payload, opts);
```

All existing services are migrated — every `.add(...)` call on a BullMQ Queue
in `src/` now flows through `enqueueWithContext`. **Any new enqueue site must
use the helper.** Direct `.add()` calls are an oversight, not an option.

Workers themselves are already wrapped via `withJobContext(...)` in every
`new Worker(...)` call. New workers must follow the same pattern.

## Secret Scanning — gitleaks

Every commit is scanned for credentials at two gates:

1. **Pre-commit hook** (local) — runs `gitleaks protect --staged` against your
   staged content before the typecheck/lint/test gates. Blocks the commit on
   any finding. Install once:
   ```bash
   git config core.hooksPath .githooks
   # Install gitleaks itself: https://github.com/gitleaks/gitleaks#installation
   ```
2. **CI Stage 0** (GitHub Actions) — runs `gitleaks-action` on every push and
   PR. Same ruleset, same `.gitleaks.toml` config, no path to bypass.

If gitleaks reports a finding:

- **If it's a real credential**, ROTATE IT first (Stanbic API key, SendGrid key,
  JWT/encryption key, etc.). Removing it from the diff is not enough — anything
  pushed to a remote should be treated as exposed. Then rebase the offending
  commit out of history.
- **If it's a false positive on a known-safe placeholder**, add a narrowly
  scoped entry to `.gitleaks.toml` (path or regex). Document the justification
  in the commit message — every allowlist addition is a security trade-off.

Do not pass `--no-verify` to skip the local gate; CI will still block the push.

## Dependency Vulnerability Scanning — Trivy

A second CI gate (`Stage 0.5 — Trivy Dependency Scan`) runs `aquasecurity/trivy-action`
in filesystem mode against the repo. It blocks the build on any `HIGH` or
`CRITICAL` severity finding with a known fix available (`ignore-unfixed: true`).

Trivy and `npm audit` (Stage 2) overlap deliberately. Trivy catches issues
that npm's advisory DB doesn't (e.g. transitive CVEs picked up from upstream
CVE feeds before npm has indexed them). If a Trivy finding is a real
vulnerability without a fix, document it in the npm-audit acknowledgment
block in `deploy.yml` Stage 2 and reference the GHSA / CVE id.

## Review Process

All PRs require review. Payments, approvals, and pricing modules require security review.
