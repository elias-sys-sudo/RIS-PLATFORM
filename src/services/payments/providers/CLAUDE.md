# payments/providers/ — Provider Integration Guide

> Only EFT (bank ACH) and the MOCK test provider are supported. Mobile-money
> providers (MTN MoMo, Airtel Money) were retired — the DB enum keeps the
> historical values for audit immutability but the application never emits
> them again.

---

## IPaymentProvider Interface — All Providers Must Implement This

```typescript
interface IPaymentProvider {
  readonly name: PaymentProvider;
  execute(payment: PaymentRecord, idempotencyKey: string): Promise<PaymentProviderResult>;
}

interface PaymentProviderResult {
  success: boolean;
  transactionReference: string;  // always = idempotencyKey (our reference)
  providerReference: string;     // provider's own reference (from response header)
  failureReason?: string;        // only present when success=false
  pendingConfirmation?: boolean; // EFT: bank confirms via batch reconciliation
}
```

Providers NEVER throw. They return `{ success: false, failureReason }` on error. The service layer decides what to do with failure results.

---

## Bank EFT — Uganda ACH Format

```typescript
// bank-eft.provider.ts
// Generates a fixed-width Uganda ACH record for batch processing by the
// settlement bank. The provider returns `pendingConfirmation: true` so the
// payment stays in EXECUTING until the bank's reconciliation file lands —
// status only flips to FUNDED via the manual-confirm endpoint
// (POST /invoices/:id/mark-funded) or a future bank webhook.
//
// Record format: [TxnType(2)][Amount(15)][Currency(3)][Reference(36)][Date(8)]
```

Required env vars in production:
- `EFT_BANK_API_URL` — settlement bank's EFT endpoint base URL
- `EFT_BANK_API_KEY` — credential for the bank API (placeholder until real wiring)
- `EFT_OUTPUT_DIR` — local directory where ACH files are written

The registry refuses to boot in `NODE_ENV=production` if any of these are
missing (`src/services/payments/providers/registry.ts`). In non-production
the MockProvider is registered against both EFT and MOCK channels so the
test suite runs without real credentials.

---

## Mock Provider — Tests Only

```typescript
// providers/mock.provider.ts
// Used in unit and integration tests — never registered in production app
export class MockProvider implements IPaymentProvider {
  public readonly name = PaymentProvider.MOCK;
  async execute(_payment: PaymentRecord, idempotencyKey: string): Promise<PaymentProviderResult> {
    return { success: true, transactionReference: idempotencyKey, providerReference: 'mock-ref' };
  }
}
```

`NODE_ENV=test` → service selects MockProvider automatically.
`NODE_ENV=production` → MockProvider must not be registered. If it is: startup error.

The MockProvider also implements a deterministic failure path: any payment
whose amount string ends in `'999'` returns `success: false` so failure-path
tests do not need to mock the provider separately.

---

## Amount Format — String, Not Number

```typescript
// ✅ CORRECT — amount passed as string (UGX integer serialised to string)
body: JSON.stringify({ amount: payment.amount }) // payment.amount is "5000000"

// ❌ WRONG — parsing to number (loses precision on amounts > Number.MAX_SAFE_INTEGER)
body: JSON.stringify({ amount: parseInt(payment.amount) }) // 9007199254740993 becomes 9007199254740992
```

Bank APIs accept amount as a string. Keep it as string end-to-end.

---

## Error Logging in Providers — No PII in Error Messages

```typescript
// ✅ CORRECT — log error code not message (message may contain account number)
logger.error('EFT disbursement failed', {
  component: 'payments',
  paymentId: payment.id,
  errorMessage: err instanceof Error ? err.message : 'Unknown', // may be safe — review per-provider
});

// ✅ CORRECT — return failureReason without bank account fields
return {
  success: false,
  failureReason: `EFT API ${response.status}: ${sanitisedErrorBody}`,
};
```

Strip any bank account number, payee name, or contact fields from provider error responses before storing in `failureReason`.
