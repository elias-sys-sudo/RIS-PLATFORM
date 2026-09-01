# pricing/ — Financial Arithmetic Rules

> Floating point is NEVER used for amount calculations. Rates use float only as input, then are immediately scaled to BigInt.

---

## The PRECISION Constant — Why It Exists

Rates (interest, risk premium, RIS margin) are decimal percentages (e.g. `0.045` = 4.5%).
BigInt cannot represent decimals, so every rate is scaled by `PRECISION = 100_000_000n` (1×10⁸).

```typescript
const PRECISION = 100_000_000n;   // 8 decimal places of rate precision
const DAYS_PER_YEAR = 365n;

function toScaled(rate: number): bigint {
  return BigInt(Math.round(rate * Number(PRECISION)));
}
// toScaled(0.045) → 4_500_000n (i.e. 4.5% × 1e8)
```

❌ WRONG — floating point arithmetic on amounts:
```typescript
const advance = invoice.faceValue * 0.95;          // float — loses precision on large UGX amounts
const discount = faceValue * (bankRate + riskRate); // float — rounding errors accumulate
```

---

## The Pricing Formula — Exact Implementation

```
Total Annual Rate  = bank_cost_rate + risk_premium_rate + mms_margin_rate
Total Discount Rate = Total Annual Rate × (tenor_days / 365)   ← pro-rated to tenor
Advance Amount      = face_value × max_advance_pct
Discount Amount     = face_value × Total Discount Rate
Net Payment         = Advance Amount − Discount Amount
Bank Cost Amount    = Advance Amount × (bank_cost_rate × tenor / 365)
RIS Net Profit      = Discount Amount − Bank Cost Amount
```

In code (BigInt throughout):
```typescript
const totalAnnualScaled = bankScaled + riskScaled + mmsScaled;
const discountRateScaled = (totalAnnualScaled * tenor) / DAYS_PER_YEAR;

const advanceAmount         = (faceValue * advPctScaled) / PRECISION;
const discountAmount        = (faceValue * discountRateScaled) / PRECISION;
const netPaymentToSupplier  = advanceAmount - discountAmount;

const bankCostRateScaled    = (bankScaled * tenor) / DAYS_PER_YEAR;
const bankCostAmount        = (advanceAmount * bankCostRateScaled) / PRECISION;
const mmsNetProfit          = discountAmount - bankCostAmount;
```

---

## Rate Inputs — Source of Truth

| Rate | Source | Who sets it |
|---|---|---|
| `bank_cost_rate` | `facilities` table → active facility's `interest_rate_annual` | finance_manager |
| `risk_premium_rate` | `risk_scores` table → set by risk-engine after scoring | system (risk-engine) |
| `mms_margin_rate` | `buyer_mms_margins` table → per-buyer RIS margin | management |
| `max_advance_pct` | `risk_scores` table → set by risk-engine based on score | system (risk-engine) |

If ANY of these is missing: throw `BusinessRuleError`. Do NOT default to zero — zero rates produce incorrect pricing that RIS cannot recover.

```typescript
// ✅ CORRECT — explicit guard
const facility = await repo.getActiveFacility();
if (!facility) throw new BusinessRuleError(PricingErrorCode.NO_ACTIVE_FACILITY, 'No active facility');
```

---

## Prerequisites — Invoice Must Be in 'scored' Status

```typescript
if (invoice.status !== 'scored') {
  throw new BusinessRuleError(PricingErrorCode.INVOICE_WRONG_STATUS,
    `Invoice status is '${invoice.status}', expected 'scored'`
  );
}
if (riskScore.bank_cost_rate !== null) {
  throw new BusinessRuleError(PricingErrorCode.ALREADY_PRICED, 'Invoice has already been priced');
}
```

Pricing runs exactly once per invoice. The `ALREADY_PRICED` check prevents double-pricing on queue retries.

---

## Persistence — Two Tables, One Transaction

```typescript
await repo.updateRiskScoreWithPricing(client, riskScoreId, {
  bank_cost_rate, mms_margin_rate, total_discount_rate,
  advance_amount, discount_amount, net_payment_to_supplier,
});
await repo.updateInvoiceWithPricing(client, invoiceId, {
  advance_amount, discount_amount, net_payment_to_supplier,
});
// Audit log inside same transaction:
await repo.createAuditEntry(client, null, 'INVOICE_PRICED', 'risk_scores', invoiceId,
  { status: 'scored' },
  { advanceAmount, discountAmount, netPaymentToSupplier, bankCostRate, mmsMarginRate, totalDiscountRate }
);
```

Note: `userId` is `null` in the audit log — pricing is a system action, not user-triggered.

---

## Return Types — BigInt Serialised as String

The API response converts bigint to string (JSON cannot represent BigInt):
```typescript
return {
  advanceAmount: calcResult.advanceAmount.toString(),   // "4750000" not 4750000n
  discountAmount: calcResult.discountAmount.toString(),
  // ...
};
```

Frontend receives strings and must NOT parse with `parseInt` (loses precision on >53-bit values). Use `BigInt(str)` or display with `formatUGX(str)` directly.

---

## Fee Breakdown — Transparency Requirement

The `feeBreakdown` object is shown to the supplier so they can verify charges. It must decompose the total discount into:
- `bankCostComponent` — what RIS pays the bank
- `riskPremiumComponent` — risk charge
- `mmsMarginComponent` — RIS profit component

These must sum to `discountAmount`. If they don't, the BigInt arithmetic has a bug.
