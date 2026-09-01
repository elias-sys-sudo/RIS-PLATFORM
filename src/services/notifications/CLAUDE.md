# notifications/ — Email & SMS Dispatch

> It is a worker, not a REST service.

---

## Initialisation — Call Once at Startup

```typescript
import { initialiseNotificationService } from './notifications.service';

// In app entry point (before workers start consuming jobs):
initialiseNotificationService(); // initialises both email (SendGrid) and SMS (Africa's Talking) providers
```

❌ WRONG — calling individual provider init functions directly:
```typescript
initialiseEmailProvider();  // bypasses circuit breaker setup
initialiseSmsProvider();
```

---

## Circuit Breaker — 5 Failures → 60s Pause

Both email and SMS channels have independent circuit breakers:

```
threshold: 5 consecutive failures
pause:     60_000ms (60 seconds)
```

```typescript
// Before sending, check circuit
if (isCircuitOpen('email')) {
  logger.warn('Email circuit breaker open — skipping send', { jobId });
  return { success: false, channel: 'email', reason: 'circuit_open' };
}
```

When a send succeeds: reset consecutive failure counter to 0.
When a send fails: increment counter. At threshold: set `pausedUntil = Date.now() + 60_000`.

Do NOT throw from notification sends. Always return a `SendResult` — callers should not crash because a notification failed.

---

## Job Idempotency — In-Memory Set

```typescript
const processedJobs = new Set<string>();
const MAX_PROCESSED_CACHE = 10_000;

// At start of every job handler:
if (processedJobs.has(job.id)) {
  logger.info('Duplicate notification job skipped', { jobId: job.id });
  return;
}
processedJobs.add(job.id);
if (processedJobs.size > MAX_PROCESSED_CACHE) {
  // evict oldest entries (Set insertion order preserved)
  const first = processedJobs.values().next().value;
  processedJobs.delete(first);
}
```

This prevents double-sends when BullMQ retries a job that actually succeeded but the worker crashed before acknowledging.

---

## Job Payload Shape — Standardised

Every module that queues a notification must use this shape:

```typescript
interface NotificationJobPayload {
  type: 'invoice-rejected' | 'overdue-notification' | 'sla-escalation' | 'payment-failed' | string;
  recipientId: string;   // user UUID — notifications.service resolves contact details
  // NO email addresses, NO phone numbers — resolve from DB, never pass in payload
  data: Record<string, string | number | boolean>; // template variables (no PII)
}
```

❌ WRONG — passing PII in queue payload (queue payloads are logged):
```typescript
await queue.add('notify', {
  email: 'supplier@example.com',  // PII in queue payload
  phone: '+256700000000',
  message: `Dear ${supplierName}`, // PII
});
```

The notification service resolves the recipient's contact details from DB using `recipientId`.

---

## Template System

```
email.templates.ts  — SendGrid dynamic template IDs + variable mapping
sms.templates.ts    — Africa's Talking message string builders
```

Each template function receives business IDs and status values — never raw PII.
The service layer decrypts PII (names, phone) from DB immediately before send, not before queuing.

---

## Provider Credentials (env vars)

```
# Email — AWS SES via SMTP (nodemailer)
SES_SMTP_HOST           — e.g. email-smtp.eu-central-1.amazonaws.com
SES_SMTP_PORT           — 587 (STARTTLS) or 465 (implicit TLS)
SES_SMTP_USER           — SES SMTP user (NOT IAM access key; derived via SES console)
SES_SMTP_PASS           — SES SMTP password
SES_FROM_DEFAULT        — fallback sender when a template has no FROM_BY_TEMPLATE mapping
SES_FROM_CONFIRM        — confirm@raphaintegrated.com (buyer magic-link)
SES_FROM_PAYMENTS       — payments@raphaintegrated.com (invoice / money flows)
SES_FROM_KYC            — kyc@raphaintegrated.com (KYC + onboarding)
SES_FROM_COLLECTIONS    — collections@raphaintegrated.com (overdue / escalation)
SES_FROM_SUPPORT        — support@raphaintegrated.com (password reset, generic)

# SMS — Africa's Talking
AT_API_KEY              — Africa's Talking SMS
AT_USERNAME             — Africa's Talking account username
AT_SENDER_ID            — registered short code / sender ID
```

If any credential is missing: `isEmailConfigured()` / `isSmsConfigured()` returns false. Log a warning at startup, degrade gracefully — do NOT crash the server.

## From-address routing

Each `EmailTemplate` maps to one of 6 sender aliases via `FROM_BY_TEMPLATE` in `email.provider.ts`. The aliases are configured at two layers:

1. **AWS SES**: the sender domain `raphaintegrated.com` is verified once (3 DKIM CNAME records). Every alias on that domain is then automatically allowed without per-alias verification.
2. **GoDaddy email forwarding**: each alias (`confirm@`, `payments@`, `kyc@`, `collections@`, `support@`, plus role-based `credit@`, `finance@`, `compliance@`, `legal@`, `directors@`) forwards inbound mail to the operator's Gmail.

Per-template override: `sendEmail(to, template, data, { from: 'someone@raphaintegrated.com', replyTo: 'reply@raphaintegrated.com' })` — escape hatch for one-offs (e.g. compliance officer wants replies routed to their personal inbox during a specific complaint).

Full setup runbook: `deploy/email-setup-runbook.md`.

## Worker Terminal Failure — Loud, Auditable

The BullMQ `notifications` worker retries each failed send 3 times
(30s/120s/480s backoff). On the 4th failure the `'failed'` event fires
with `job.attemptsMade >= job.opts.attempts`. The worker:

1. Logs `terminal: true` to `app.log` (operator visibility on the host)
2. Delegates to `notifications.service.handleNotificationTerminalFailure`
   which opens a transaction and writes an `audit_logs` row inside it
3. Audit action is `EMAIL_VERIFICATION_DELIVERY_FAILED` for the
   `email_verification` template, `NOTIFICATION_DELIVERY_FAILED` for
   everything else
4. Audit `new_values` are PII-free: `{ jobName, template, channel,
   errorCode, attemptsMade, retriesExhausted: true, recipientUserId }`
   — the recipient EMAIL is used only to resolve the user UUID and is
   dropped before the row is persisted

Operator triage: `GET /admin/email/failed-verifications` (management +
finance_manager + compliance_officer) — surfaces unverified suppliers
who have at least one `EMAIL_VERIFICATION_DELIVERY_FAILED` audit row in
the lookback window (default 72h, max 720h / 30 days). Returns:

```
{ failed: [{ userId, email, attempts, lastErrorCode, lastFailedAt, lastJobId }],
  count, lookbackHours }
```

The endpoint is the read-only counterpart to `/admin/approvals/orphans`
in the payments module — both surface invoices/users left stranded by
terminal worker failures so finance / management can intervene.

## Email Provider Production Gate (startup)

`src/server.ts:validateEmailProviderConfig()` refuses to start the server
in `NODE_ENV=production` or `NODE_ENV=staging` if either:

1. Any of `SES_SMTP_HOST` / `SES_SMTP_PORT` / `SES_SMTP_USER` /
   `SES_SMTP_PASS` is missing or empty (the `SES_` prefix is historical
   — these are plain SMTP credentials and accept any provider), OR
2. `EMAIL_PROVIDER_VERIFIED !== 'true'`

The second flag is an operator attestation: the transactional email
provider (Resend, Postmark, SES, SendGrid, Mailgun — any SMTP-compatible
provider) is production-ready. Concretely:

- Domain verified at the provider (DKIM CNAMEs / TXT records live, SPF aligned)
- Out of sandbox / development mode (e.g. Resend domain Verified;
  AWS SES "Production access = Granted"; Postmark sending approved)
- At least one smoke-test email landed in Gmail Inbox (not Spam)

This gate makes it impossible to deploy with a sandboxed provider, which
silently rejects delivery to any recipient that isn't on the provider's
allowlist — the exact failure mode that caused our supplier-registration
incident.

Development mode is unaffected — devs can boot with
`NODE_ENV=development` and missing SMTP creds.

## Smoke testing

```typescript
import { sendSmokeTestEmail } from './email.provider';

const result = await sendSmokeTestEmail('myAICloudSystem@gmail.com');
console.log(result); // { success, provider: 'ses', messageId, durationMs }
```

Refuses to run if `NODE_ENV === 'production'` (avoid accidental spam during deploys). Use this after the SES credentials are first wired to verify the whole chain (auth + DNS + DKIM) without waiting for a real triggering event.
