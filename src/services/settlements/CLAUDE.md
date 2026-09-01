# settlements/ — Settlement & Profit Booking Module

## Bash commands

- `npm run test:unit -- --testPathPattern=tests/unit/settlements --verbose`
- `npm run test:unit -- --coverage --collectCoverageFrom="src/services/settlements/**/*.ts"`

---

## Settlement Status Flow

```
pending → facility_repaid → profit_booked → closed
```

Only `finance_manager` can initiate, repay, and book profit.
Only `management` can close a settlement (final sign-off).

---

## Lifecycle

1. **Initiate** — created when a collection reaches `collected` status. Links to invoice, collection, and drawdown.
2. **Repay facility** — records actual facility repayment (principal + interest) to the bank.
3. **Book profit** — calculates net_profit = discount_earned - bank_cost + penalty_income. Creates immutable `profit_bookings` record.
4. **Close** — final status. Triggers supplier notification. Audit trail complete.

---

## BigInt Arithmetic — Net Profit Calculation

```typescript
// All monetary values are BIGINT strings (no floating point)
const netProfit = BigInt(discountEarned) - BigInt(bankCostPaid) + BigInt(penaltyIncome);
```

---

## Profit Bookings — Immutable

The `profit_bookings` table has a DB trigger preventing UPDATE and DELETE.
Once booked, profit records cannot be modified. This is a compliance requirement.

---

## Queue Pattern

```typescript
let notificationQueue: Queue | null = null;
export function setNotificationQueue(queue: Queue): void { notificationQueue = queue; }
```

Notification sent on settlement close: `settlement_complete` with `{ invoiceId, settlementId, netProfit }`.

---

## Status Transitions This Module Owns

```
collected (invoice) → settlement initiated (pending)
pending              → facility_repaid
facility_repaid      → profit_booked
profit_booked        → closed
```

---

## Audit Actions

| Action | When |
|---|---|
| `SETTLEMENT_INITIATED` | Settlement created |
| `SETTLEMENT_FACILITY_REPAID` | Facility repayment recorded |
| `SETTLEMENT_PROFIT_BOOKED` | Profit calculated and booked |
| `SETTLEMENT_CLOSED` | Settlement finalized |
