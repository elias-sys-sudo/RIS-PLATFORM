# facilities/ — Bank Credit Line Management

## Bash commands

- `npm run test:unit -- --testPathPattern=tests/unit/facilities --verbose`
- `npm run typecheck`

## RATE_PRECISION — different from pricing module

```typescript
const RATE_PRECISION = 1_000_000_000n; // 1e9 (9 decimal places — higher than pricing's 1e8)
const DAYS_PER_YEAR = 365n;

function parseRateToScaled(annualRate: string): bigint {
  return BigInt(Math.round(parseFloat(annualRate) * Number(RATE_PRECISION)));
}

// daily_interest = principal × (annual_rate / 365)
export function calculateDailyInterest(principal: string, annualRate: string): string {
  const p = BigInt(principal);
  const rateScaled = parseRateToScaled(annualRate);
  const daily = (p * rateScaled) / (DAYS_PER_YEAR * RATE_PRECISION);
  return daily.toString();
}
```

❌ WRONG — reusing pricing module's `PRECISION = 100_000_000n`: facilities uses `1_000_000_000n` (10×more precise) due to smaller interest rate differentials.

## Utilisation thresholds — alert levels

```typescript
const UTILISATION_WARNING  = 80; // % — notify finance_manager
const UTILISATION_CRITICAL = 90; // % — block new drawdowns
const MATURITY_ALERT_DAYS  = 5;  // days before facility expires — escalate

export function calculateUtilisation(drawnAmount: string, totalLimit: string): number {
  const drawn = BigInt(drawnAmount);
  const limit = BigInt(totalLimit);
  if (limit === 0n) return 0;
  return Number((drawn * 10000n) / limit) / 100; // 2 decimal places
}
```

When `utilisation >= UTILISATION_CRITICAL`: throw `BusinessRuleError` blocking the drawdown.
When `utilisation >= UTILISATION_WARNING`: log warn + queue notification to `finance_manager`, then allow.

## Drawdown lifecycle

```
facility: active
  ↓ createDrawdown()
drawdown: active   → interest accrues daily (scheduled job)
  ↓ repayFacility() — called by collections module via facilityRepaymentQueue
drawdown: repaid
```

Repayment is triggered by `collections` module via BullMQ (`facilityRepaymentQueue`), not by a direct HTTP call. Do not add an HTTP repayment endpoint without management approval.

## Facility status — only one ACTIVE at a time

```typescript
// Before creating a new facility, check none is already active:
const active = await repo.getActiveFacility();
if (active) throw new BusinessRuleError(FacilityErrorCode.FACILITY_ALREADY_ACTIVE,
  'A facility is already active. Deactivate it before creating a new one.'
);
```

`pricing` module reads `getActiveFacility()` to get the current `bank_cost_rate`. If no active facility exists, pricing throws `NO_ACTIVE_FACILITY`. Keep exactly one active at all times in production.

## Amounts — all BigInt, stored as string

`total_limit`, `drawn_amount`, `available_amount`, `daily_interest` — all BIGINT columns, serialised as string in API responses. Never use `parseFloat()` on these.
