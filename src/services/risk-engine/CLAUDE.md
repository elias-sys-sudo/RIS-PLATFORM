# risk-engine/ — Scoring Architecture

> Coverage requirement: **95% minimum** (vs 80% platform standard).
> Every scoring path, boundary value, and edge case must be tested.

## Bash commands

- `npm run test:unit -- --coverage --collectCoverageFrom="src/services/risk-engine/**/*.ts"` — must reach 95%
- `npm run test:unit -- --testPathPattern=tests/unit/risk-engine --verbose` — see each test result
- `npm run typecheck` — scorers must be fully typed, no implicit returns

---

## RiskFactor Interface — All Scorers Must Implement This

```typescript
// risk-engine.types.ts
export interface RiskFactor {
  /** Unique identifier used in risk_assessments metadata */
  readonly name: string;
  /** Weight as decimal: 0.30 = 30%. All registered factors must sum to 1.0 */
  readonly weight: number;
  /** Returns score 0–100. Must never throw — return 0 on error. */
  score(context: RiskContext): Promise<number>;
}

export interface RiskContext {
  invoiceId: string;
  supplierId: string;
  buyerId: string;
  faceValue: bigint;       // BIGINT — raw UGX
  tenorDays: number;
  invoiceDate: Date;
  dueDate: Date;
}
```

---

## Five-Factor Registry — Weights Must Sum to Exactly 1.0

```typescript
// risk-engine.service.ts
const FACTORS: RiskFactor[] = [
  { ...buyerCreditScorer,       weight: 0.30 },
  { ...supplierTrackRecord,     weight: 0.25 },
  { ...collateralScorer,        weight: 0.20 },
  { ...concentrationRiskScorer, weight: 0.15 },
  { ...tenorScorer,             weight: 0.10 },
];
// Assert at startup:
const totalWeight = FACTORS.reduce((sum, f) => sum + f.weight, 0);
if (Math.abs(totalWeight - 1.0) > 0.001) throw new Error('Risk factor weights must sum to 1.0');
```

---

## Scorer Template — Copy This for Any New Factor

```typescript
// factors/[name]-scorer.ts
import { RiskFactor, RiskContext } from '../risk-engine.types';
import { logger } from '../../../shared/logger';

export const myNewScorer: RiskFactor = {
  name: 'my_new_factor',
  weight: 0.00, // set in registry, not here

  async score(ctx: RiskContext): Promise<number> {
    try {
      // 1. Fetch data needed for this factor
      // 2. Apply scoring logic
      // 3. Clamp result to 0–100
      const raw = computeScore(ctx);
      return Math.min(100, Math.max(0, raw));
    } catch (err) {
      // NEVER let a single factor crash the whole scoring run
      logger.error('myNewScorer failed', { invoiceId: ctx.invoiceId, errorCode: (err as {code?:string}).code });
      return 0; // penalise but continue
    }
  },
};
```

---

## Scoring Decision Thresholds

```
composite ≥ 70  → eligible for approval (credit_officer still must sign off)
composite 50–69 → manual review required — do NOT auto-approve
composite < 50  → auto-reject — status → rejected
```

❌ WRONG — auto-approving based on score alone:
```typescript
if (composite >= 70) await repo.updateStatus(id, 'approved'); // credit_officer must confirm
```

---

## Concentration Risk — Hard Cap Logic

```typescript
// concentration-risk-scorer.ts
const buyerPortfolioTotal = await repo.getActiveBuyerExposure(ctx.buyerId);
const newTotal = buyerPortfolioTotal + ctx.faceValue;
const portfolioTotal = await repo.getTotalActivePortfolio();

const concentrationPct = portfolioTotal > 0n
  ? Number((newTotal * 100n) / portfolioTotal)
  : 0;

if (concentrationPct > 30) return 0; // hard cap — buyer exposure exceeds 30%
// Scale: 0% exposure → 100 score, 30% exposure → 0 score
return Math.round(100 - (concentrationPct / 30) * 100);
```

Note: All portfolio values are `bigint`. Use bigint arithmetic throughout — do not cast to `number` until the final percentage.

---

## Score Persistence — Exact Order

```typescript
// Inside a single transaction:
// 1. Write all factor scores + composite to risk_assessments
await repo.createRiskAssessmentWithClient(client, {
  invoiceId, compositeScore, recommendation,
  factorScores: { buyer_credit: 85, supplier_track: 70, ... }, // IDs/numbers only
});

// 2. Update invoice status to 'scored'
await repo.updateInvoiceStatusWithClient(client, invoiceId, 'scored');

// 3. Audit log (still inside transaction)
await repo.createAuditEntryWithClient(client, scoredByUserId, 'INVOICE_SCORED',
  'invoices', invoiceId,
  { compositeScore, recommendation } // no PII, no names
);
// 4. COMMIT
```

❌ WRONG — persisting score outside a transaction (partial state on crash):
```typescript
await repo.createRiskAssessment(invoiceId, scores);
await repo.updateInvoiceStatus(invoiceId, 'scored'); // crash here → score saved but status wrong
```

---

## Test Requirements for Each Scorer

Every scorer in `factors/` must have tests for:

```typescript
describe('MyScorer', () => {
  it('returns 100 at best-case input');
  it('returns 0 at worst-case input');
  it('returns 0 and does not throw when data fetch fails');  // ← critical
  it('clamps score to 0 when result would be negative');
  it('clamps score to 100 when result would exceed 100');
  it('boundary: just below threshold → correct band');
  it('boundary: exactly at threshold → correct band');
  it('boundary: just above threshold → correct band');
});
```

Service-level tests must additionally cover:
```typescript
it('rejects if factor weights do not sum to 1.0');
it('persists all 5 factor scores and composite in one transaction');
it('sets invoice status to scored after successful run');
it('sets invoice status to rejected when composite < 50');
it('does not auto-approve when composite ≥ 70 — only marks eligible');
```
